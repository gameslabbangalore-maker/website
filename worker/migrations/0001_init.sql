CREATE TABLE IF NOT EXISTS events (
  slug                TEXT PRIMARY KEY,
  title               TEXT    NOT NULL,
  default_capacity    INTEGER NOT NULL DEFAULT 20,
  default_price_paise INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS occurrences (
  id            TEXT PRIMARY KEY,
  event_slug    TEXT    NOT NULL REFERENCES events(slug),
  starts_at_utc TEXT    NOT NULL,
  timezone      TEXT    NOT NULL DEFAULT 'Asia/Kolkata',
  venue_name    TEXT    NOT NULL DEFAULT 'To be Announced',
  venue_map_url TEXT    NOT NULL DEFAULT '',
  capacity      INTEGER NOT NULL,
  price_paise   INTEGER NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'draft',
  gcal_uid      TEXT,
  synced_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_occurrences_start  ON occurrences(starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_occurrences_slug   ON occurrences(event_slug, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_occurrences_gcal   ON occurrences(gcal_uid);

CREATE TABLE IF NOT EXISTS bookings (
  id                  TEXT PRIMARY KEY,
  access_token        TEXT    NOT NULL,
  occurrence_id       TEXT    NOT NULL REFERENCES occurrences(id),
  qty                 INTEGER NOT NULL CHECK (qty > 0),
  amount_paise        INTEGER NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'pending',
  name                TEXT    NOT NULL,
  email               TEXT    NOT NULL,
  phone               TEXT    NOT NULL,
  razorpay_order_id   TEXT    UNIQUE,
  razorpay_payment_id TEXT,
  hold_expires_at     TEXT    NOT NULL,
  created_at          TEXT    NOT NULL,
  paid_at             TEXT,
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_occurrence ON bookings(occurrence_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_hold       ON bookings(status, hold_expires_at);
CREATE INDEX IF NOT EXISTS idx_bookings_email      ON bookings(email);

CREATE TABLE IF NOT EXISTS tickets (
  code          TEXT PRIMARY KEY,
  booking_id    TEXT    NOT NULL REFERENCES bookings(id),
  seat_no       INTEGER NOT NULL,
  checked_in_at TEXT,
  checked_in_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_booking ON tickets(booking_id);

CREATE TABLE IF NOT EXISTS webhook_log (
  event_id    TEXT PRIMARY KEY,
  event_type  TEXT,
  received_at TEXT NOT NULL,
  outcome     TEXT
);
