ALTER TABLE occurrences ADD COLUMN ends_at_utc TEXT;
ALTER TABLE occurrences ADD COLUMN price_overridden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE occurrences ADD COLUMN capacity_overridden INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_occurrences_end ON occurrences(ends_at_utc);
