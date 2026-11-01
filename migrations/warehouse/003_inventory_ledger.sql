CREATE TABLE inventory (
  bin_code     TEXT PRIMARY KEY REFERENCES bins(code),
  sku          TEXT COLLATE NOCASE REFERENCES products(sku),
  qty          INTEGER NOT NULL DEFAULT 0,
  reserved_qty INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (qty >= 0),
  CHECK (reserved_qty >= 0),
  CHECK (reserved_qty <= qty),
  CHECK ((qty = 0 AND sku IS NULL) OR (qty > 0 AND sku IS NOT NULL))
);
CREATE INDEX idx_inventory_sku ON inventory(sku);

-- capacity: never exceed bin capacity (INSERT and UPDATE)
CREATE TRIGGER inventory_capacity_upd BEFORE UPDATE ON inventory
WHEN NEW.qty > (SELECT capacity FROM bins WHERE code = NEW.bin_code)
BEGIN SELECT RAISE(ABORT,'CAPACITY_EXCEEDED'); END;

CREATE TRIGGER inventory_capacity_ins BEFORE INSERT ON inventory
WHEN NEW.qty > (SELECT capacity FROM bins WHERE code = NEW.bin_code)
BEGIN SELECT RAISE(ABORT,'CAPACITY_EXCEEDED'); END;

-- single SKU per bin: a non-empty bin can never change SKU
CREATE TRIGGER inventory_sku_mix BEFORE UPDATE ON inventory
WHEN OLD.sku IS NOT NULL AND NEW.sku IS NOT NULL AND NEW.sku <> OLD.sku AND NEW.qty > 0
BEGIN SELECT RAISE(ABORT,'SKU_CONFLICT'); END;

-- stock may only increase in ACTIVE bins on ACTIVE shelves
CREATE TRIGGER inventory_receivable BEFORE UPDATE ON inventory
WHEN NEW.qty > OLD.qty AND (
      (SELECT status FROM bins WHERE code = NEW.bin_code) <> 'ACTIVE'
   OR (SELECT s.status FROM shelves s JOIN bins b ON b.shelf_code = s.code WHERE b.code = NEW.bin_code) <> 'ACTIVE')
BEGIN SELECT RAISE(ABORT,'BIN_NOT_RECEIVABLE'); END;

-- storage class: HAZMAT product only on HAZMAT shelf (and vice versa)
CREATE TRIGGER inventory_storage_class BEFORE UPDATE ON inventory
WHEN NEW.sku IS NOT NULL AND NEW.qty > OLD.qty AND
     (SELECT p.storage_class FROM products p WHERE p.sku = NEW.sku) <>
     (SELECT s.storage_class FROM shelves s JOIN bins b ON b.shelf_code = s.code WHERE b.code = NEW.bin_code)
BEGIN SELECT RAISE(ABORT,'STORAGE_CLASS_MISMATCH'); END;

CREATE TABLE stock_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ref           TEXT NOT NULL UNIQUE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('RECEIVE','PUTAWAY','RELOCATE','PICK','ADJUSTMENT')),
  sku           TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  qty           INTEGER NOT NULL CHECK (qty > 0),
  from_kind     TEXT NOT NULL CHECK (from_kind IN ('EXTERNAL','STAGING','BIN','ADJUSTMENT')),
  from_ref      TEXT,
  to_kind       TEXT NOT NULL CHECK (to_kind IN ('STAGING','BIN','ORDER_PACKING','ADJUSTMENT')),
  to_ref        TEXT,
  related_type  TEXT,
  related_ref   TEXT,
  performed_by  INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_mov_sku  ON stock_movements(sku);
CREATE INDEX idx_mov_time ON stock_movements(created_at);
CREATE INDEX idx_mov_type ON stock_movements(movement_type);
CREATE INDEX idx_mov_to   ON stock_movements(to_kind, to_ref);
CREATE INDEX idx_mov_from ON stock_movements(from_kind, from_ref);

CREATE TRIGGER mov_no_update BEFORE UPDATE ON stock_movements
  BEGIN SELECT RAISE(ABORT,'STOCK_MOVEMENTS_ARE_APPEND_ONLY'); END;
CREATE TRIGGER mov_no_delete BEFORE DELETE ON stock_movements
  BEGIN SELECT RAISE(ABORT,'STOCK_MOVEMENTS_ARE_APPEND_ONLY'); END;

-- the ONE definition of sellable stock (used by ATP and by reservation allocation)
CREATE VIEW v_available_stock AS
SELECT i.bin_code, i.sku, i.qty, i.reserved_qty, (i.qty - i.reserved_qty) AS available_qty,
       b.shelf_code, b.level, b.capacity, s.nav_node_id
FROM inventory i
JOIN bins b    ON b.code = i.bin_code
JOIN shelves s ON s.code = b.shelf_code
WHERE i.sku IS NOT NULL AND b.status = 'ACTIVE' AND s.status = 'ACTIVE'
  AND b.recount_required = 0 AND (i.qty - i.reserved_qty) > 0;
