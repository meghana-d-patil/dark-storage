import path from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../scripts/migrate.js';

export function makeTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const migrationsDir = path.resolve(process.cwd(), 'migrations/warehouse');
  applyMigrations(db, migrationsDir);

  return db;
}

export function seedMinimal(db: Database.Database): void {
  // 1 Product
  db.prepare(`
    INSERT OR IGNORE INTO products (sku, name, category, storage_class, unit, max_receive_qty, active, barcode, weight_g, price_paise)
    VALUES ('SKU-TEST-001', 'Test Standard Item', 'Testing', 'STANDARD', 'EA', 500, 1, 'SKU-TEST-001', 100, 10000)
  `).run();

  // 1 Nav node for shelf access
  db.prepare(`
    INSERT OR IGNORE INTO nav_nodes (id, kind, x, y)
    VALUES ('NODE-TEST-01', 'AISLE', 10.0, 10.0)
  `).run();

  // 1 Shelf
  db.prepare(`
    INSERT OR IGNORE INTO shelves (code, aisle, bay, side, storage_class, status, nav_node_id, x, y)
    VALUES ('SH-A01', 'A', 1, 'L', 'STANDARD', 'ACTIVE', 'NODE-TEST-01', 10.0, 10.0)
  `).run();

  // 3 Bins on that shelf
  const insertBin = db.prepare(`
    INSERT OR IGNORE INTO bins (code, shelf_code, level, capacity, status, recount_required)
    VALUES (?, 'SH-A01', ?, 50, 'ACTIVE', 0)
  `);

  insertBin.run('BIN-A01-1', 1);
  insertBin.run('BIN-A01-2', 2);
  insertBin.run('BIN-A01-3', 3);

  // Initialize inventory rows for these bins
  const insertInv = db.prepare(`
    INSERT OR IGNORE INTO inventory (bin_code, sku, qty, reserved_qty)
    VALUES (?, NULL, 0, 0)
  `);
  insertInv.run('BIN-A01-1');
  insertInv.run('BIN-A01-2');
  insertInv.run('BIN-A01-3');

  // Seed 1 user per role
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (username, display_name, password_hash, role, badge_id, pin_hash, zones, shift, active)
    VALUES (?, ?, 'dummy_hash', ?, ?, 'pin_hash', '[]', 'MORNING', 1)
  `);

  insertUser.run('test-admin', 'Test Admin', 'ADMIN', 'BDG-ADMIN');
  insertUser.run('test-manager', 'Test Manager', 'MANAGER', 'BDG-MGR');
  insertUser.run('test-operator', 'Test Operator', 'OPERATOR', 'BDG-OP');
  insertUser.run('test-picker', 'Test Picker', 'PICKER', 'BDG-PK');
  insertUser.run('test-staff', 'Test Staff', 'STAFF', 'BDG-STF');
  insertUser.run('test-dispatch', 'Test Dispatch', 'DISPATCH', 'BDG-DSP');
  insertUser.run('test-auditor', 'Test Auditor', 'AUDITOR', 'BDG-AUD');
}
