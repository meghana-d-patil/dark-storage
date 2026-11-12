-- 018_exceptions_adjustments.sql
-- Migration 018: Exception loop, dual-control adjustments, blind counts, and bin freeze

-- 1. Extend bins with freeze & counting columns
ALTER TABLE bins ADD COLUMN pick_frozen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bins ADD COLUMN frozen_reason TEXT;
ALTER TABLE bins ADD COLUMN frozen_at TEXT;
ALTER TABLE bins ADD COLUMN frozen_exception_ref TEXT;
ALTER TABLE bins ADD COLUMN last_counted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_bins_frozen ON bins(pick_frozen) WHERE pick_frozen = 1;

-- 2. Rebuild pick_exceptions to support modern state machine (OPEN -> COUNT_REQUESTED -> COUNT_SUBMITTED -> RESOLVED)
PRAGMA foreign_keys = OFF;

CREATE TABLE pick_exceptions_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ref               TEXT NOT NULL UNIQUE,
  exc_ref           TEXT,
  mission_id        INTEGER REFERENCES missions(id),
  order_id          INTEGER REFERENCES orders(id),
  stop_id           INTEGER REFERENCES pick_stops(id),
  order_ref         TEXT,
  bin_code          TEXT NOT NULL,
  sku               TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK(kind IN('MISSING','DAMAGED','BIN_BLOCKED','PACK_MISSING','PACK_DAMAGED','COUNT_VARIANCE')),
  status            TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','COUNT_REQUESTED','COUNT_SUBMITTED','RESOLVED')),
  expected_qty      INTEGER,
  actual_qty        INTEGER,
  notes             TEXT,
  raised_by         TEXT NOT NULL,
  raised_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  escalated         INTEGER NOT NULL DEFAULT 0,
  due_at            TEXT,
  resolved_by       TEXT,
  resolution        TEXT,
  resolution_reason TEXT,
  resolved_at       TEXT,
  count_task_ref    TEXT,
  version           INTEGER NOT NULL DEFAULT 0
);

INSERT INTO pick_exceptions_new (
  id, ref, exc_ref, mission_id, order_id, stop_id, bin_code, sku,
  kind, status, expected_qty, actual_qty, notes, raised_by, raised_at,
  resolved_by, resolution, resolved_at, version
)
SELECT
  id,
  ref,
  ref,
  mission_id,
  order_id,
  stop_id,
  bin_code,
  sku,
  CASE
    WHEN exception_type = 'BIN_EMPTY' THEN 'MISSING'
    WHEN exception_type = 'SHORT_PICK' THEN 'MISSING'
    WHEN exception_type = 'DAMAGED' THEN 'DAMAGED'
    WHEN exception_type = 'WRONG_PRODUCT' THEN 'MISSING'
    ELSE 'BIN_BLOCKED'
  END,
  status,
  expected_qty,
  actual_qty,
  notes,
  CAST(reported_by AS TEXT),
  reported_at,
  CAST(resolved_by AS TEXT),
  resolution,
  resolved_at,
  0
FROM pick_exceptions;

DROP TABLE pick_exceptions;
ALTER TABLE pick_exceptions_new RENAME TO pick_exceptions;

CREATE INDEX IF NOT EXISTS idx_exc_status ON pick_exceptions(status);
CREATE INDEX IF NOT EXISTS idx_exc_bin ON pick_exceptions(bin_code);
CREATE INDEX IF NOT EXISTS idx_exc_order ON pick_exceptions(order_ref);
CREATE INDEX IF NOT EXISTS idx_exc_escalated ON pick_exceptions(escalated, raised_at) WHERE status <> 'RESOLVED';

PRAGMA foreign_keys = ON;

-- 3. Inventory adjustments table (dual control)
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  adj_ref          TEXT UNIQUE NOT NULL,
  kind             TEXT NOT NULL CHECK(kind IN('COUNT_VARIANCE','DAMAGE_WRITE_OFF','EXPIRY_WRITE_OFF','RTV')),
  status           TEXT NOT NULL DEFAULT 'PENDING_MANAGER' CHECK(status IN('PENDING_MANAGER','PENDING_ADMIN','APPLIED','REJECTED','CANCELLED')),
  bin_code         TEXT,
  sku              TEXT,
  lot_id           TEXT,
  delta_qty        INTEGER NOT NULL,
  value_paise      INTEGER NOT NULL DEFAULT 0,
  reason_code      TEXT NOT NULL,
  note             TEXT,
  requested_by     TEXT NOT NULL,
  requested_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  manager_id       TEXT,
  manager_at       TEXT,
  admin_id         TEXT,
  admin_at         TEXT,
  reject_reason    TEXT,
  source_ref       TEXT,
  version          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_adj_status ON inventory_adjustments(status);
CREATE INDEX IF NOT EXISTS idx_adj_bin ON inventory_adjustments(bin_code);
CREATE INDEX IF NOT EXISTS idx_adj_sku ON inventory_adjustments(sku);

-- 4. Count results table
CREATE TABLE IF NOT EXISTS count_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_ref    TEXT NOT NULL,
  bin_code    TEXT NOT NULL,
  sku         TEXT,
  counted_qty INTEGER NOT NULL,
  system_qty  INTEGER NOT NULL,
  variance    INTEGER NOT NULL,
  counted_by  TEXT NOT NULL,
  counted_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  round       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_count_results_task ON count_results(task_ref);
CREATE INDEX IF NOT EXISTS idx_count_results_bin ON count_results(bin_code);

-- 5. Rebuild v_available_stock to exclude pick_frozen bins
DROP VIEW IF EXISTS v_available_stock;

CREATE VIEW v_available_stock AS
SELECT i.bin_code, i.sku, i.qty, i.reserved_qty, (i.qty - i.reserved_qty) AS available_qty,
       b.shelf_code, b.level, b.capacity, s.nav_node_id
FROM inventory i
JOIN bins b    ON b.code = i.bin_code
JOIN shelves s ON s.code = b.shelf_code
WHERE i.sku IS NOT NULL AND b.status = 'ACTIVE' AND s.status = 'ACTIVE'
  AND b.recount_required = 0 AND (i.qty - i.reserved_qty) > 0
  AND COALESCE(b.pick_frozen, 0) = 0;
