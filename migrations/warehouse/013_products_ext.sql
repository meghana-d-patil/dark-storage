-- Migration 013: Product extended attributes for WMS physical operations and ledger
ALTER TABLE products ADD COLUMN barcode TEXT;
ALTER TABLE products ADD COLUMN weight_g INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN volume_cc INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN fragile INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN temp_zone TEXT NOT NULL DEFAULT 'AMBIENT' CHECK(temp_zone IN('AMBIENT','CHILLED','FROZEN'));
ALTER TABLE products ADD COLUMN abc_class TEXT NOT NULL DEFAULT 'C' CHECK(abc_class IN('A','B','C'));
ALTER TABLE products ADD COLUMN shelf_life_days INTEGER;
ALTER TABLE products ADD COLUMN price_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN compat_group TEXT;

UPDATE products SET barcode = sku WHERE barcode IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
