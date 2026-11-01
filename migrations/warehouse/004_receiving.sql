CREATE TABLE receipts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ref          TEXT NOT NULL UNIQUE,
  supplier     TEXT,
  reference_no TEXT,
  notes        TEXT,
  received_at  TEXT NOT NULL,
  received_by  INTEGER NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'STAGED' CHECK (status IN ('STAGED','PARTIALLY_PUT_AWAY','PUT_AWAY')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE receipt_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id    INTEGER NOT NULL REFERENCES receipts(id),
  line_no       INTEGER NOT NULL,
  sku           TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  qty_received  INTEGER NOT NULL CHECK (qty_received > 0),
  qty_put_away  INTEGER NOT NULL DEFAULT 0,
  movement_ref  TEXT NOT NULL,
  CHECK (qty_put_away >= 0 AND qty_put_away <= qty_received),
  UNIQUE (receipt_id, line_no)
);

CREATE INDEX idx_rl_sku ON receipt_lines(sku);
CREATE INDEX idx_rl_receipt ON receipt_lines(receipt_id);
