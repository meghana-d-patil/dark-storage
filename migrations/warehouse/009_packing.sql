CREATE TABLE packing_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ref             TEXT NOT NULL UNIQUE,
  order_id        INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  mission_id      INTEGER REFERENCES missions(id),
  packed_by       INTEGER NOT NULL REFERENCES users(id),
  packed_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  fulfilment_type TEXT NOT NULL CHECK (fulfilment_type IN ('FULL','PARTIAL')),
  total_ordered   INTEGER NOT NULL CHECK (total_ordered > 0),
  total_picked    INTEGER NOT NULL CHECK (total_picked > 0),
  notes           TEXT
);
