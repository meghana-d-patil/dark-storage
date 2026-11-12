-- Migration 015: Totes, missions extension, pick stops extension, and floor tasks

-- 1. Totes table
CREATE TABLE IF NOT EXISTS totes (
  tote_code   TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'FREE' CHECK(status IN('FREE','IN_USE','AWAITING_PACK','PACKING','QUARANTINED')),
  mission_ref TEXT,
  order_ref   TEXT,
  updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO totes (tote_code, status) VALUES
  ('TOTE-001','FREE'),('TOTE-002','FREE'),('TOTE-003','FREE'),('TOTE-004','FREE'),('TOTE-005','FREE'),
  ('TOTE-006','FREE'),('TOTE-007','FREE'),('TOTE-008','FREE'),('TOTE-009','FREE'),('TOTE-010','FREE'),
  ('TOTE-011','FREE'),('TOTE-012','FREE'),('TOTE-013','FREE'),('TOTE-014','FREE'),('TOTE-015','FREE'),
  ('TOTE-016','FREE'),('TOTE-017','FREE'),('TOTE-018','FREE'),('TOTE-019','FREE'),('TOTE-020','FREE'),
  ('TOTE-021','FREE'),('TOTE-022','FREE'),('TOTE-023','FREE'),('TOTE-024','FREE'),('TOTE-025','FREE'),
  ('TOTE-026','FREE'),('TOTE-027','FREE'),('TOTE-028','FREE'),('TOTE-029','FREE'),('TOTE-030','FREE');

-- 2. Rebuild missions table to support QUEUED, CLAIMED, nullable picker_id, and floor picking attributes
CREATE TABLE missions_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ref               TEXT NOT NULL UNIQUE,
  order_id          INTEGER NOT NULL REFERENCES orders(id),
  picker_id         INTEGER REFERENCES users(id),
  status            TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','CLAIMED','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  route_json        TEXT NOT NULL,
  route_distance    REAL NOT NULL,
  route_algorithm   TEXT NOT NULL CHECK (route_algorithm IN ('HELD_KARP','TWO_OPT','TRIVIAL')),
  assigned_by       INTEGER REFERENCES users(id),
  assigned_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at        TEXT,
  completed_at      TEXT,
  assigned_to       TEXT,
  claimed_at        TEXT,
  lease_expires_at  TEXT,
  last_heartbeat_at TEXT,
  tote_code         TEXT,
  priority          INTEGER NOT NULL DEFAULT 0,
  sla_due_at        TEXT,
  version           INTEGER NOT NULL DEFAULT 0,
  batch_id          TEXT
);

INSERT INTO missions_new (
  id, ref, order_id, picker_id, status, route_json, route_distance, route_algorithm,
  assigned_by, assigned_at, started_at, completed_at, priority, version
)
SELECT
  id, ref, order_id, picker_id, status, route_json, route_distance, route_algorithm,
  assigned_by, assigned_at, started_at, completed_at, 0, 0
FROM missions;

DROP TABLE missions;
ALTER TABLE missions_new RENAME TO missions;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mission_active_order ON missions(order_id) WHERE status IN ('QUEUED','CLAIMED','ASSIGNED','IN_PROGRESS');
CREATE INDEX IF NOT EXISTS idx_missions_picker ON missions(picker_id, status);
CREATE INDEX IF NOT EXISTS idx_missions_assigned_to ON missions(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_missions_queue ON missions(status, priority, sla_due_at, assigned_at);

-- 3. Extend pick_stops table
ALTER TABLE pick_stops ADD COLUMN step TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE pick_stops ADD COLUMN bin_scanned_at TEXT;
ALTER TABLE pick_stops ADD COLUMN item_scanned_at TEXT;
ALTER TABLE pick_stops ADD COLUMN tote_scanned_at TEXT;
ALTER TABLE pick_stops ADD COLUMN lot_id TEXT;
ALTER TABLE pick_stops ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

UPDATE pick_stops SET step = 'DONE' WHERE status IN ('PICKED', 'RESOLVED');
UPDATE pick_stops SET step = 'PENDING' WHERE step IS NULL OR step = '';

-- 4. Floor tasks table
CREATE TABLE IF NOT EXISTS floor_tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  task_ref         TEXT UNIQUE NOT NULL,
  type             TEXT NOT NULL CHECK(type IN('COUNT','RELOCATE','REPLENISH','PUTBACK','REPICK','EXPIRY_REMOVE')),
  status           TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','CLAIMED','IN_PROGRESS','DONE','CANCELLED')),
  bin_code         TEXT,
  dest_bin_code    TEXT,
  sku              TEXT,
  lot_id           TEXT,
  qty              INTEGER,
  order_ref        TEXT,
  source_ref       TEXT,
  priority         INTEGER NOT NULL DEFAULT 0,
  due_at           TEXT,
  assigned_to      TEXT,
  lease_expires_at TEXT,
  payload          TEXT,
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at     TEXT,
  version          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_floor_tasks_status_prio ON floor_tasks(status, priority);
CREATE INDEX IF NOT EXISTS idx_floor_tasks_type_status ON floor_tasks(type, status);
CREATE INDEX IF NOT EXISTS idx_floor_tasks_assigned ON floor_tasks(assigned_to, status);
