CREATE TABLE missions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ref             TEXT NOT NULL UNIQUE,
  order_id        INTEGER NOT NULL REFERENCES orders(id),
  picker_id       INTEGER NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL CHECK (status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  route_json      TEXT NOT NULL,
  route_distance  REAL NOT NULL,
  route_algorithm TEXT NOT NULL CHECK (route_algorithm IN ('HELD_KARP','TWO_OPT','TRIVIAL')),
  assigned_by     INTEGER NOT NULL REFERENCES users(id),
  assigned_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at      TEXT,
  completed_at    TEXT
);
CREATE UNIQUE INDEX uq_mission_active_order ON missions(order_id) WHERE status IN ('ASSIGNED','IN_PROGRESS');
CREATE INDEX idx_missions_picker ON missions(picker_id, status);

CREATE TABLE pick_stops (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id     INTEGER NOT NULL REFERENCES missions(id),
  stop_no        INTEGER NOT NULL,
  stop_ref       TEXT NOT NULL UNIQUE,
  seq            INTEGER NOT NULL,
  reservation_id INTEGER NOT NULL UNIQUE REFERENCES reservations(id),
  bin_code       TEXT NOT NULL REFERENCES bins(code),
  sku            TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  qty_required   INTEGER NOT NULL CHECK (qty_required > 0),
  qty_picked     INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PICKED','EXCEPTION_OPEN','RESOLVED')),
  confirmed_at   TEXT,
  CHECK (qty_picked >= 0 AND qty_picked <= qty_required),
  UNIQUE (mission_id, stop_no)
);
CREATE INDEX idx_stops_mission ON pick_stops(mission_id, seq);
