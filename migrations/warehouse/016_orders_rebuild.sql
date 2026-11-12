-- 016_orders_rebuild.sql
-- Rebuild orders table to support packing and dispatch lifecycles, SLA tracking, and optimistic locking

PRAGMA foreign_keys = OFF;

CREATE TABLE orders_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ref              TEXT NOT NULL UNIQUE,
  order_type       TEXT NOT NULL CHECK (order_type IN ('CUSTOMER','TRANSFER','PRODUCTION')),
  priority         TEXT NOT NULL CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status           TEXT NOT NULL CHECK (status IN ('PENDING','RESERVED','ASSIGNED','PICKING','PICKED','PACKING','PACKED','DISPATCHED','COMPLETED','CANCELLED')),
  customer_ref     TEXT,
  notes            TEXT,
  requested_by     INTEGER NOT NULL REFERENCES users(id),
  assigned_picker  INTEGER REFERENCES users(id),
  fulfilment_type  TEXT CHECK (fulfilment_type IN ('FULL','PARTIAL')),
  cancelled_reason TEXT,
  promised_at      TEXT,
  sla_due_at       TEXT,
  picked_at        TEXT,
  packed_at        TEXT,
  dispatched_at    TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at     TEXT,
  version          INTEGER NOT NULL DEFAULT 0
);

INSERT INTO orders_new (
  id, ref, order_type, priority, status, customer_ref, notes, requested_by,
  assigned_picker, fulfilment_type, cancelled_reason, created_at, updated_at, completed_at, version
)
SELECT
  id,
  ref,
  order_type,
  priority,
  CASE
    WHEN status = 'PARTIALLY_FULFILLED' THEN 'PACKED'
    ELSE status
  END,
  customer_ref,
  notes,
  requested_by,
  assigned_picker,
  fulfilment_type,
  cancelled_reason,
  created_at,
  updated_at,
  completed_at,
  0
FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, priority);
CREATE INDEX IF NOT EXISTS idx_orders_ref ON orders(ref);
CREATE INDEX IF NOT EXISTS idx_orders_sla ON orders(sla_due_at, status);

PRAGMA foreign_keys = ON;
