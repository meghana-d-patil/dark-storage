CREATE TABLE pick_exceptions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ref              TEXT NOT NULL UNIQUE,
  mission_id       INTEGER NOT NULL REFERENCES missions(id),
  order_id         INTEGER NOT NULL REFERENCES orders(id),
  stop_id          INTEGER NOT NULL REFERENCES pick_stops(id),
  bin_code         TEXT NOT NULL REFERENCES bins(code),
  sku              TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  exception_type   TEXT NOT NULL CHECK (exception_type IN ('BIN_EMPTY','DAMAGED','SHORT_PICK','WRONG_PRODUCT','OTHER')),
  expected_qty     INTEGER NOT NULL CHECK (expected_qty > 0),
  actual_qty       INTEGER NOT NULL CHECK (actual_qty >= 0),
  notes            TEXT,
  reported_by      INTEGER NOT NULL REFERENCES users(id),
  reported_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status           TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  resolution       TEXT CHECK (resolution IN ('REALLOCATE','ACCEPT_SHORT','ORDER_CANCELLED')),
  resolved_by      INTEGER REFERENCES users(id),
  resolved_at      TEXT,
  resolution_notes TEXT,
  CHECK ((status = 'OPEN' AND resolution IS NULL) OR (status = 'RESOLVED' AND resolution IS NOT NULL))
);
CREATE UNIQUE INDEX uq_exc_open_stop ON pick_exceptions(stop_id) WHERE status = 'OPEN';
CREATE INDEX idx_exc_status ON pick_exceptions(status);
