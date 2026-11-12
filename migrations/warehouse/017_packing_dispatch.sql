-- 017_packing_dispatch.sql
-- Pack sessions, pack item scans, dispatch slots and OTP handovers

-- 1. Pack sessions table
CREATE TABLE IF NOT EXISTS pack_sessions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  order_ref          TEXT NOT NULL,
  tote_code          TEXT NOT NULL,
  bench_code         TEXT NOT NULL DEFAULT 'BENCH-1',
  opened_by          TEXT NOT NULL,
  opened_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at       TEXT,
  status             TEXT NOT NULL CHECK(status IN('OPEN','COMPLETE','ABORTED')),
  weight_g           INTEGER,
  expected_weight_g  INTEGER,
  weight_ok          INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pack_sessions_order ON pack_sessions(order_ref, status);
CREATE INDEX IF NOT EXISTS idx_pack_sessions_tote ON pack_sessions(tote_code, status);

-- 2. Pack item scans table
CREATE TABLE IF NOT EXISTS pack_scans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES pack_sessions(id),
  sku        TEXT NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 1,
  kind       TEXT NOT NULL CHECK(kind IN('SCANNED','MISSING','DAMAGED')),
  lot_id     TEXT,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_id   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pack_scans_session ON pack_scans(session_id);

-- 3. Dispatch slots table
CREATE TABLE IF NOT EXISTS dispatch_slots (
  slot_code TEXT PRIMARY KEY,
  status    TEXT NOT NULL CHECK(status IN('FREE','OCCUPIED')) DEFAULT 'FREE',
  order_ref TEXT
);

INSERT OR IGNORE INTO dispatch_slots (slot_code, status) VALUES
  ('D-1', 'FREE'),
  ('D-2', 'FREE'),
  ('D-3', 'FREE'),
  ('D-4', 'FREE'),
  ('D-5', 'FREE'),
  ('D-6', 'FREE'),
  ('D-7', 'FREE'),
  ('D-8', 'FREE');

-- 4. Dispatch handovers table
CREATE TABLE IF NOT EXISTS dispatch_handovers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_ref      TEXT UNIQUE NOT NULL,
  slot_code      TEXT NOT NULL,
  otp_hash       TEXT NOT NULL,
  otp_expires_at TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  locked         INTEGER NOT NULL DEFAULT 0,
  rider_name     TEXT,
  handed_by      TEXT,
  handed_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_dispatch_handovers_order ON dispatch_handovers(order_ref);
CREATE INDEX IF NOT EXISTS idx_dispatch_handovers_slot ON dispatch_handovers(slot_code);

-- 5. Extend packing_records with session_id
ALTER TABLE packing_records ADD COLUMN session_id INTEGER;
