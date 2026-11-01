CREATE TABLE products (
  sku             TEXT PRIMARY KEY COLLATE NOCASE CHECK (length(sku) BETWEEN 3 AND 32),
  name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category        TEXT NOT NULL,
  storage_class   TEXT NOT NULL DEFAULT 'STANDARD' CHECK (storage_class IN ('STANDARD','HAZMAT')),
  unit            TEXT NOT NULL DEFAULT 'EA',
  max_receive_qty INTEGER NOT NULL DEFAULT 5000 CHECK (max_receive_qty > 0),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_products_name ON products(name COLLATE NOCASE);

CREATE TABLE nav_nodes (
  id   TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('DOCK','PACK','CROSS','AISLE')),
  x    REAL NOT NULL,
  y    REAL NOT NULL
);
CREATE TABLE nav_edges (
  from_node TEXT NOT NULL REFERENCES nav_nodes(id),
  to_node   TEXT NOT NULL REFERENCES nav_nodes(id),
  distance  REAL NOT NULL CHECK (distance > 0),
  PRIMARY KEY (from_node, to_node),
  CHECK (from_node <> to_node)
);

CREATE TABLE shelves (
  code          TEXT PRIMARY KEY,
  aisle         TEXT NOT NULL,
  bay           INTEGER NOT NULL CHECK (bay >= 1),
  side          TEXT NOT NULL CHECK (side IN ('L','R')),
  storage_class TEXT NOT NULL DEFAULT 'STANDARD' CHECK (storage_class IN ('STANDARD','HAZMAT')),
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','MAINTENANCE','BLOCKED')),
  nav_node_id   TEXT NOT NULL REFERENCES nav_nodes(id),
  x             REAL NOT NULL,
  y             REAL NOT NULL,
  UNIQUE (aisle, bay, side)
);

CREATE TABLE bins (
  code             TEXT PRIMARY KEY,
  shelf_code       TEXT NOT NULL REFERENCES shelves(code),
  level            INTEGER NOT NULL CHECK (level BETWEEN 1 AND 6),
  capacity         INTEGER NOT NULL CHECK (capacity > 0),
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED','DAMAGED')),
  recount_required INTEGER NOT NULL DEFAULT 0 CHECK (recount_required IN (0,1)),
  UNIQUE (shelf_code, level)
);
CREATE INDEX idx_bins_shelf ON bins(shelf_code);
