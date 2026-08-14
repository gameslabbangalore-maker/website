import sqlite3, io, sys, re

import os
_HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATION = io.open(os.path.join(_HERE, '..', 'migrations', '0001_init.sql'), encoding='utf-8').read()
MIGRATION += '\n' + io.open(os.path.join(_HERE, '..', 'migrations', '0002_occurrence_end_and_overrides.sql'), encoding='utf-8').read()

COMMITTED = """
  COALESCE((SELECT SUM(b.qty) FROM bookings b
            WHERE b.occurrence_id = o.id AND b.status = 'paid'), 0)
  + COALESCE((SELECT SUM(b.qty) FROM bookings b
              WHERE b.occurrence_id = o.id
                AND b.status = 'pending'
                AND b.hold_expires_at > ?1), 0)
"""
COMMITTED_FOR_UPDATE = COMMITTED.replace('o.id', 'occurrences.id')

HOLD_SQL = f"""
INSERT INTO bookings (
  id, access_token, occurrence_id, qty, amount_paise, status,
  name, email, phone, hold_expires_at, created_at
)
SELECT ?2, ?3, o.id, ?4, o.price_paise * ?4, 'pending',
       ?5, ?6, ?7, ?8, ?1
  FROM occurrences o
 WHERE o.id = ?9
   AND o.status = 'open'
   AND o.price_paise > 0
   AND COALESCE(o.ends_at_utc, o.starts_at_utc) > ?1
   AND (o.capacity - ({COMMITTED})) >= ?4
"""

NOW = '2026-08-01T10:00:00Z'
FUTURE_HOLD = '2026-08-01T10:10:00Z'
PAST_HOLD = '2026-08-01T09:50:00Z'

db = sqlite3.connect(':memory:')
db.executescript(MIGRATION)
db.execute("INSERT INTO events (slug,title,default_capacity,default_price_paise) VALUES ('nom','Night of Mafias',2,35000)")
db.execute("""INSERT INTO occurrences (id,event_slug,starts_at_utc,ends_at_utc,venue_name,capacity,price_paise,status)
              VALUES ('nom-20260807','nom','2026-08-07T14:00:00Z','2026-08-07T17:00:00Z','Big Bean Cafe',2,35000,'open')""")
db.commit()

def hold(bid, qty, expires=FUTURE_HOLD, occ='nom-20260807'):
    cur = db.execute(HOLD_SQL, (NOW, bid, 'tok-'+bid, qty, 'Guest', f'{bid}@x.com', '+919000000000', expires, occ))
    db.commit()
    return cur.rowcount

def available():
    row = db.execute(f"SELECT o.capacity - ({COMMITTED}) FROM occurrences o WHERE o.id='nom-20260807'", (NOW,)).fetchone()
    return row[0]

failures = []
def check(label, got, want):
    ok = got == want
    print(('  PASS  ' if ok else '  FAIL  ') + f'{label}: got {got!r}, want {want!r}')
    if not ok: failures.append(label)

print('capacity 2, price 35000 paise\n')

check('available starts at 2', available(), 2)

check('hold 2 seats succeeds', hold('b1', 2), 1)
check('available now 0', available(), 0)

check('3rd seat REFUSED when full', hold('b2', 1), 0)
check('still 0 available', available(), 0)

amount = db.execute("SELECT amount_paise FROM bookings WHERE id='b1'").fetchone()[0]
check('amount derived from DB price (2 x 35000)', amount, 70000)

db.execute("UPDATE bookings SET status='expired' WHERE id='b1'"); db.commit()
check('available back to 2 after expiry', available(), 2)
check('booking succeeds after release', hold('b3', 1), 1)
check('available 1', available(), 1)

db.execute("UPDATE bookings SET status='pending', hold_expires_at=? WHERE id='b3'", (PAST_HOLD,)); db.commit()
check('lapsed pending hold frees its seat', available(), 2)

db.execute("UPDATE bookings SET status='paid' WHERE id='b3'"); db.commit()
check('paid seat counts against capacity', available(), 1)

check('qty exceeding remaining is refused', hold('b4', 2), 0)
check('exact remaining qty is allowed', hold('b5', 1), 1)
check('unknown occurrence refused', hold('b6', 1, occ='nope-20260807'), 0)

db.execute("UPDATE occurrences SET status='closed' WHERE id='nom-20260807'"); db.commit()
db.execute("UPDATE bookings SET status='expired' WHERE id IN ('b3','b5')"); db.commit()
check('closed occurrence refuses booking', hold('b7', 1), 0)

db.execute("UPDATE occurrences SET status='open', price_paise=0 WHERE id='nom-20260807'"); db.commit()
check('zero-price (draft) occurrence refuses booking', hold('b8', 1), 0)

db.execute("UPDATE occurrences SET price_paise=35000, starts_at_utc='2026-07-01T14:00:00Z', ends_at_utc='2026-08-07T17:00:00Z' WHERE id='nom-20260807'"); db.commit()
check('booking remains open after start but before end', hold('b9', 1), 1)
db.execute("UPDATE bookings SET status='expired' WHERE id='b9'")
db.execute("UPDATE occurrences SET ends_at_utc='2026-07-01T17:00:00Z' WHERE id='nom-20260807'"); db.commit()
check('ended occurrence refuses booking', hold('b10', 1), 0)

print()
print('occurrence controls\n')

db.execute("UPDATE occurrences SET status='open', price_paise=35000, capacity=2, ends_at_utc='2026-08-07T17:00:00Z' WHERE id='nom-20260807'")
db.execute("DELETE FROM bookings")
db.commit()

pause = db.execute("""UPDATE occurrences SET status='closed'
                       WHERE id=? AND status='open'
                         AND COALESCE(ends_at_utc, starts_at_utc) > ?""",
                   ('nom-20260807', NOW))
db.commit()
check('open occurrence can be paused', pause.rowcount, 1)
check('paused occurrence refuses booking', hold('ctl-closed', 1), 0)

resume = db.execute(f"""UPDATE occurrences SET status='open'
                          WHERE id=?2 AND status='closed' AND price_paise > 0
                            AND COALESCE(ends_at_utc, starts_at_utc) > ?1
                            AND (capacity - ({COMMITTED_FOR_UPDATE})) > 0""",
                    (NOW, 'nom-20260807'))
db.commit()
check('paused occurrence can resume while seats remain', resume.rowcount, 1)

assert hold('ctl-paid', 1) == 1, 'setup failed: could not create control booking'
db.execute("UPDATE bookings SET status='paid' WHERE id='ctl-paid'")
db.commit()

settings_sql = f"""UPDATE occurrences
                       SET price_paise = CASE WHEN ?2 IS NULL THEN price_paise ELSE ?2 END,
                           capacity = CASE WHEN ?3 IS NULL THEN capacity ELSE ?3 END,
                           price_overridden = CASE WHEN ?2 IS NULL THEN price_overridden ELSE 1 END,
                           capacity_overridden = CASE WHEN ?3 IS NULL THEN capacity_overridden ELSE 1 END
                     WHERE COALESCE(ends_at_utc, starts_at_utc) > ?1
                       AND id = ?4
                       AND status NOT IN ('cancelled', 'hidden')
                       AND (?3 IS NULL OR ?3 >= ({COMMITTED_FOR_UPDATE}))"""

below_sold = db.execute(settings_sql, (NOW, None, 0, 'nom-20260807'))
db.commit()
check('capacity cannot be reduced below committed seats', below_sold.rowcount, 0)

one_off = db.execute(settings_sql, (NOW, 42500, 1, 'nom-20260807'))
db.commit()
check('one-off price and capacity update succeeds', one_off.rowcount, 1)
updated = db.execute("SELECT price_paise, capacity, price_overridden, capacity_overridden FROM occurrences WHERE id='nom-20260807'").fetchone()
check('one-off values and override flags are stored', updated, (42500, 1, 1, 1))

db.execute("UPDATE occurrences SET ends_at_utc='2026-07-01T17:00:00Z' WHERE id='nom-20260807'")
ended_settings = db.execute(settings_sql, (NOW, 50000, None, 'nom-20260807'))
db.commit()
check('ended occurrence cannot be edited', ended_settings.rowcount, 0)

auto_close = db.execute("""UPDATE occurrences SET status='closed'
                             WHERE status='open'
                               AND COALESCE(ends_at_utc, starts_at_utc) <= ?""", (NOW,))
db.commit()
check('ended open occurrence is moved to closed', auto_close.rowcount, 1)

PAID_SQL = """
UPDATE bookings
   SET status = 'paid', razorpay_payment_id = ?1, paid_at = ?2,
       notes = CASE WHEN ?3 IS NULL THEN notes
                    ELSE COALESCE(notes || ' | ', '') || ?3 END
 WHERE id = ?4 AND status IN ('pending', 'failed', 'expired')
"""

def try_pay(bid, from_status):
    db.execute("UPDATE bookings SET status=?, razorpay_payment_id=NULL, paid_at=NULL WHERE id=?",
               (from_status, bid))
    db.commit()
    cur = db.execute(PAID_SQL, ('pay_x', NOW, 'note', bid))
    db.commit()
    return cur.rowcount

print()
print('paid-transition (regression: retry on the same Razorpay order)\n')

db.execute("""UPDATE occurrences SET status='open', price_paise=35000,
              starts_at_utc='2026-08-07T14:00:00Z', ends_at_utc='2026-08-07T17:00:00Z', capacity=20
              WHERE id='nom-20260807'""")
db.execute("DELETE FROM bookings")
db.commit()

assert hold('p1', 1) == 1, 'setup failed: could not create booking p1'

check('pending -> paid', try_pay('p1', 'pending'), 1)
check('failed  -> paid (first attempt failed, retry succeeded)', try_pay('p1', 'failed'), 1)
check('expired -> paid (webhook landed after hold lapsed)', try_pay('p1', 'expired'), 1)
check('paid    -> paid is a no-op (webhook retry mints nothing)', try_pay('p1', 'paid'), 0)
check('refunded stays refunded', try_pay('p1', 'refunded'), 0)

print()
if failures:
    print(f'{len(failures)} FAILED: ' + ', '.join(failures)); sys.exit(1)
print('all checks passed')
