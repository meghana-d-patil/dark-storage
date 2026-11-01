CREATE TABLE orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ref              TEXT NOT NULL UNIQUE,
  order_type       TEXT NOT NULL CHECK (order_type IN ('CUSTOMER','TRANSFER','PRODUCTION')),
  priority         TEXT NOT NULL CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status           TEXT NOT NULL CHECK (status IN ('RESERVED','ASSIGNED','PICKING','PICKED','COMPLETED','CANCELLED')),
  customer_ref     TEXT,
  notes            TEXT,
  requested_by     INTEGER NOT NULL REFERENCES users(id),
  assigned_picker  INTEGER REFERENCES users(id),
  fulfilment_type  TEXT CHECK (fulfilment_type IN ('FULL','PARTIAL')),
  cancelled_reason TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at     TEXT
);
CREATE INDEX idx_orders_status ON orders(status, priority);

CREATE TABLE order_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  line_no     INTEGER NOT NULL,
  sku         TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  qty_ordered INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_picked  INTEGER NOT NULL DEFAULT 0,
  qty_short   INTEGER NOT NULL DEFAULT 0,    -- accepted shortfall (Phase 8)
  CHECK (qty_picked >= 0 AND qty_short >= 0 AND qty_picked + qty_short <= qty_ordered),
  UNIQUE (order_id, line_no),
  UNIQUE (order_id, sku)
);

CREATE TABLE reservations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id),
  order_line_id INTEGER NOT NULL REFERENCES order_lines(id),
  sku           TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  bin_code      TEXT NOT NULL REFERENCES bins(code),
  qty           INTEGER NOT NULL CHECK (qty > 0),
  consumed_qty  INTEGER NOT NULL DEFAULT 0,
  released_qty  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD','CONSUMED','RELEASED')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (consumed_qty >= 0 AND released_qty >= 0 AND consumed_qty + released_qty <= qty),
  CHECK (status <> 'HELD' OR consumed_qty + released_qty < qty),
  CHECK (status = 'HELD' OR consumed_qty + released_qty = qty)
);
CREATE INDEX idx_res_bin   ON reservations(bin_code, status);
CREATE INDEX idx_res_order ON reservations(order_id);
