-- 012_audit_chain.sql
-- Hash-chained audit log and order events history

-- 1. Add hash columns to audit_log
ALTER TABLE audit_log ADD COLUMN seq INTEGER;
ALTER TABLE audit_log ADD COLUMN prev_hash TEXT;
ALTER TABLE audit_log ADD COLUMN row_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_seq ON audit_log(seq);

-- 2. Create audit_head table
CREATE TABLE IF NOT EXISTS audit_head (
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_seq INTEGER NOT NULL,
  last_hash TEXT NOT NULL
);

INSERT OR IGNORE INTO audit_head (id, last_seq, last_hash) VALUES (1, 0, 'GENESIS');

-- 3. Replace old triggers with condition that allows backfill when row_hash IS NULL
DROP TRIGGER IF EXISTS audit_no_update;
DROP TRIGGER IF EXISTS audit_no_delete;
DROP TRIGGER IF EXISTS trg_audit_no_update;
DROP TRIGGER IF EXISTS trg_audit_no_delete;

CREATE TRIGGER trg_audit_no_update
BEFORE UPDATE ON audit_log
WHEN OLD.row_hash IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
END;

CREATE TRIGGER trg_audit_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
END;

-- 4. Create order_events table and indexes
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_ref TEXT NOT NULL,
  event TEXT NOT NULL,
  actor_id TEXT,
  actor_role TEXT,
  payload TEXT,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_ref, id);

CREATE TRIGGER IF NOT EXISTS trg_order_events_no_update
BEFORE UPDATE ON order_events
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_order_events_no_delete
BEFORE DELETE ON order_events
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
END;
