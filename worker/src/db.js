import { ticketCode } from './ids.js';

const COMMITTED_SEATS = `
  COALESCE((SELECT SUM(b.qty) FROM bookings b
            WHERE b.occurrence_id = o.id AND b.status = 'paid'), 0)
  + COALESCE((SELECT SUM(b.qty) FROM bookings b
              WHERE b.occurrence_id = o.id
                AND b.status = 'pending'
                AND b.hold_expires_at > ?1), 0)
`;

export async function getOccurrence(db, occurrenceId, now) {
  return await db
    .prepare(
      `SELECT o.id, o.event_slug, o.starts_at_utc, o.timezone, o.venue_name,
              o.venue_map_url, o.capacity, o.price_paise, o.status,
              e.title AS event_title,
              o.capacity - (${COMMITTED_SEATS}) AS available
         FROM occurrences o
         JOIN events e ON e.slug = o.event_slug
        WHERE o.id = ?2`,
    )
    .bind(now, occurrenceId)
    .first();
}

export async function listAvailability(db, now) {
  const { results } = await db
    .prepare(
      `SELECT o.id, o.event_slug, o.starts_at_utc, o.venue_name, o.price_paise,
              o.capacity, o.status,
              o.capacity - (${COMMITTED_SEATS}) AS available
         FROM occurrences o
        WHERE o.starts_at_utc >= ?1
          AND o.status != 'cancelled'
        ORDER BY o.starts_at_utc ASC`,
    )
    .bind(now)
    .all();
  return results || [];
}

/**
 * Every upcoming date with its seat maths broken out, for the staff dashboard.
 * `sold` counts paid seats, `held` counts live (unexpired) pending holds.
 */
export async function listOccurrencesForStaff(db, now) {
  const { results } = await db
    .prepare(
      `SELECT o.id, o.event_slug, o.starts_at_utc, o.timezone, o.venue_name,
              o.venue_map_url, o.capacity, o.price_paise, o.status,
              e.title AS event_title,
              COALESCE((SELECT SUM(b.qty) FROM bookings b
                         WHERE b.occurrence_id = o.id AND b.status = 'paid'), 0) AS sold,
              COALESCE((SELECT SUM(b.qty) FROM bookings b
                         WHERE b.occurrence_id = o.id AND b.status = 'pending'
                           AND b.hold_expires_at > ?1), 0) AS held,
              COALESCE((SELECT SUM(b.amount_paise) FROM bookings b
                         WHERE b.occurrence_id = o.id AND b.status = 'paid'), 0) AS revenue_paise,
              o.capacity - (${COMMITTED_SEATS}) AS available
         FROM occurrences o
         JOIN events e ON e.slug = o.event_slug
        WHERE o.status != 'hidden'
        ORDER BY o.starts_at_utc ASC`,
    )
    .bind(now)
    .all();
  return results || [];
}

export async function getOccurrenceForStaff(db, occurrenceId, now) {
  return await db
    .prepare(
      `SELECT o.id, o.event_slug, o.starts_at_utc, o.timezone, o.venue_name,
              o.venue_map_url, o.capacity, o.price_paise, o.status, o.gcal_uid,
              e.title AS event_title,
              COALESCE((SELECT SUM(b.qty) FROM bookings b
                         WHERE b.occurrence_id = o.id AND b.status = 'paid'), 0) AS sold,
              COALESCE((SELECT SUM(b.amount_paise) FROM bookings b
                         WHERE b.occurrence_id = o.id AND b.status = 'paid'), 0) AS revenue_paise,
              o.capacity - (${COMMITTED_SEATS}) AS available
         FROM occurrences o
         JOIN events e ON e.slug = o.event_slug
        WHERE o.id = ?2`,
    )
    .bind(now, occurrenceId)
    .first();
}

export async function cancelOccurrence(db, occurrenceId) {
  const result = await db.prepare(
    `UPDATE occurrences SET status = 'cancelled'
      WHERE id = ?1 AND status NOT IN ('cancelled', 'hidden')`,
  ).bind(occurrenceId).run();
  return Boolean(result.meta && result.meta.changes === 1);
}

export async function hideOccurrence(db, occurrenceId) {
  const result = await db.prepare(
    `UPDATE occurrences SET status = 'hidden'
      WHERE id = ?1 AND status = 'cancelled'`,
  ).bind(occurrenceId).run();
  return Boolean(result.meta && result.meta.changes === 1);
}

export async function createHold(db, {
  id, token, occurrenceId, qty, name, email, phone, now, holdExpiresAt,
}) {
  const insert = await db
    .prepare(
      `INSERT INTO bookings (
         id, access_token, occurrence_id, qty, amount_paise, status,
         name, email, phone, hold_expires_at, created_at
       )
       SELECT ?2, ?3, o.id, ?4, o.price_paise * ?4, 'pending',
              ?5, ?6, ?7, ?8, ?1
         FROM occurrences o
        WHERE o.id = ?9
          AND o.status = 'open'
          AND o.price_paise > 0
          AND o.starts_at_utc > ?1
          AND (o.capacity - (${COMMITTED_SEATS})) >= ?4`,
    )
    .bind(now, id, token, qty, name, email, phone, holdExpiresAt, occurrenceId)
    .run();

  if (!insert.meta || insert.meta.changes !== 1) return null;

  return await db.prepare(`SELECT * FROM bookings WHERE id = ?1`).bind(id).first();
}

export async function attachOrderId(db, bookingId, orderId) {
  await db
    .prepare(`UPDATE bookings SET razorpay_order_id = ?1 WHERE id = ?2`)
    .bind(orderId, bookingId)
    .run();
}

export async function abandonBooking(db, bookingId, reason) {
  await db
    .prepare(
      `UPDATE bookings SET status = 'failed', notes = ?1
        WHERE id = ?2 AND status = 'pending'`,
    )
    .bind(reason || 'abandoned', bookingId)
    .run();
}

export async function getBookingByToken(db, bookingId, token) {
  return await db
    .prepare(
      `SELECT b.*, o.starts_at_utc, o.venue_name, o.venue_map_url, o.timezone,
              e.title AS event_title, e.slug AS event_slug
         FROM bookings b
         JOIN occurrences o ON o.id = b.occurrence_id
         JOIN events e      ON e.slug = o.event_slug
        WHERE b.id = ?1 AND b.access_token = ?2`,
    )
    .bind(bookingId, token)
    .first();
}

export async function getBookingByOrderId(db, orderId) {
  return await db
    .prepare(`SELECT * FROM bookings WHERE razorpay_order_id = ?1`)
    .bind(orderId)
    .first();
}

export async function listTickets(db, bookingId) {
  const { results } = await db
    .prepare(
      `SELECT code, seat_no FROM tickets
        WHERE booking_id = ?1 ORDER BY seat_no ASC`,
    )
    .bind(bookingId)
    .all();
  return results || [];
}

export async function markPaidAndMintTickets(db, { orderId, paymentId, now }) {
  const booking = await getBookingByOrderId(db, orderId);
  if (!booking) return { minted: false, late: false, missing: true };

  const late = booking.hold_expires_at <= now;

  const flags = [];
  if (late) flags.push('paid after hold expiry - verify capacity');
  if (booking.status !== 'pending') {
    flags.push(`paid from status=${booking.status} (retry on same order) - verify capacity`);
  }
  const note = flags.length ? flags.join('; ') : null;

  const update = await db
    .prepare(
      `UPDATE bookings
          SET status = 'paid', razorpay_payment_id = ?1, paid_at = ?2,
              notes = CASE WHEN ?3 IS NULL THEN notes
                           ELSE COALESCE(notes || ' | ', '') || ?3 END
        WHERE id = ?4 AND status IN ('pending', 'failed', 'expired')`,
    )
    .bind(paymentId, now, note, booking.id)
    .run();

  if (!update.meta || update.meta.changes !== 1) {
    return { minted: false, late, booking };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const statements = [];
    for (let seat = 1; seat <= booking.qty; seat += 1) {
      statements.push(
        db.prepare(`INSERT INTO tickets (code, booking_id, seat_no) VALUES (?1, ?2, ?3)`)
          .bind(ticketCode(), booking.id, seat),
      );
    }
    try {
      await db.batch(statements);
      return { minted: true, late, booking };
    } catch (err) {
      if (attempt === 4) throw err;
    }
  }
  return { minted: false, late, booking };
}

export async function markFailed(db, orderId, reason, now) {
  await db
    .prepare(
      `UPDATE bookings SET status = 'failed', notes = ?1
        WHERE razorpay_order_id = ?2 AND status = 'pending'`,
    )
    .bind(`${reason || 'payment failed'} @ ${now}`, orderId)
    .run();
}

export async function markRefunded(db, paymentId, now) {
  await db
    .prepare(
      `UPDATE bookings SET status = 'refunded', notes = ?1
        WHERE razorpay_payment_id = ?2`,
    )
    .bind(`refunded @ ${now}`, paymentId)
    .run();
}

export async function expireStaleHolds(db, now) {
  const res = await db
    .prepare(
      `UPDATE bookings SET status = 'expired'
        WHERE status = 'pending' AND hold_expires_at <= ?1`,
    )
    .bind(now)
    .run();
  return res.meta ? res.meta.changes : 0;
}

export async function wasWebhookSeen(db, eventId, eventType, now) {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO webhook_log (event_id, event_type, received_at)
       VALUES (?1, ?2, ?3)`,
    )
    .bind(eventId, eventType || null, now)
    .run();
  return !res.meta || res.meta.changes === 0;
}

export async function upsertOccurrence(db, occ) {
  await db
    .prepare(
      `INSERT INTO occurrences (
         id, event_slug, starts_at_utc, timezone, venue_name, venue_map_url,
         capacity, price_paise, status, gcal_uid, synced_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT(id) DO UPDATE SET
         starts_at_utc = excluded.starts_at_utc,
         venue_name    = excluded.venue_name,
         venue_map_url = excluded.venue_map_url,
         gcal_uid      = COALESCE(occurrences.gcal_uid, excluded.gcal_uid),
         synced_at     = excluded.synced_at`,
    )
    .bind(
      occ.id, occ.event_slug, occ.starts_at_utc, occ.timezone, occ.venue_name,
      occ.venue_map_url, occ.capacity, occ.price_paise, occ.status,
      occ.gcal_uid || null, occ.synced_at,
    )
    .run();
}

export async function applyCalendarOverrides(db, id, { capacity, pricePaise }) {
  const sets = [];
  const binds = [];
  let n = 1;
  if (Number.isInteger(capacity) && capacity > 0) {
    sets.push(`capacity = ?${n}`); binds.push(capacity); n += 1;
  }
  if (Number.isInteger(pricePaise) && pricePaise > 0) {
    sets.push(`price_paise = ?${n}`); binds.push(pricePaise); n += 1;
    sets.push(`status = CASE WHEN status = 'draft' THEN 'open' ELSE status END`);
  }
  if (!sets.length) return;
  binds.push(id);
  await db.prepare(`UPDATE occurrences SET ${sets.join(', ')} WHERE id = ?${n}`)
    .bind(...binds)
    .run();
}

export async function knownEventSlugs(db) {
  const { results } = await db
    .prepare(`SELECT slug, default_capacity, default_price_paise FROM events WHERE active = 1`)
    .all();
  return results || [];
}

export async function upsertEventDefaults(db, ev) {
  const res = await db
    .prepare(
      `INSERT INTO events (slug, title, default_price_paise, default_capacity, active)
       VALUES (?1, ?2, ?3, ?4, 1)
       ON CONFLICT(slug) DO UPDATE SET
         title               = excluded.title,
         default_price_paise = excluded.default_price_paise,
         default_capacity    = excluded.default_capacity,
         active              = 1`,
    )
    .bind(ev.slug, ev.title, ev.pricePaise, ev.capacity)
    .run();
  return Boolean(res.meta && res.meta.changes);
}

/**
 * Push a new default onto occurrences that were never priced.
 *
 * Only rows still at the untouched state (draft AND price_paise = 0) are
 * changed. A date that already has a price - set via a calendar directive or by
 * hand - keeps it, so repricing an event never silently changes what a future
 * sitting already advertises.
 */
export async function applyDefaultsToUnpricedOccurrences(db, slug, { pricePaise, capacity, now }) {
  if (!Number.isInteger(pricePaise) || pricePaise <= 0) return 0;
  const res = await db
    .prepare(
      `UPDATE occurrences
          SET price_paise = ?1,
              capacity    = ?2,
              status      = 'open'
        WHERE event_slug = ?3
          AND status = 'draft'
          AND price_paise = 0
          AND starts_at_utc > ?4`,
    )
    .bind(pricePaise, capacity, slug, now)
    .run();
  return res.meta ? res.meta.changes : 0;
}
