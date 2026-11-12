import Database from 'better-sqlite3';

const db = new Database('./data/warehouse.db', { readonly: true });

console.log('=== INVENTORY TABLE COLUMNS ===');
console.log(db.prepare("PRAGMA table_info(inventory)").all());

console.log('\n=== INVENTORY SUMMARY ===');
const invTotals = db.prepare(`
  SELECT 
    COUNT(*) as total_bins,
    COUNT(sku) as occupied_bins,
    COALESCE(SUM(qty), 0) as total_quantity,
    COALESCE(SUM(reserved_qty), 0) as total_reserved
  FROM inventory
`).get();
console.log(invTotals);

console.log('\n=== ORDERS SUMMARY ===');
const orderTotals = db.prepare(`
  SELECT status, COUNT(*) as count FROM orders GROUP BY status
`).all();
console.log(orderTotals);

console.log('\n=== MISSIONS SUMMARY ===');
const missionTotals = db.prepare(`
  SELECT status, COUNT(*) as count FROM missions GROUP BY status
`).all();
console.log(missionTotals);

console.log('\n=== RECEIPTS SUMMARY ===');
const receiptTotals = db.prepare(`
  SELECT status, COUNT(*) as count FROM receipts GROUP BY status
`).all();
console.log(receiptTotals);

console.log('\n=== USERS ===');
console.log(db.prepare('SELECT id, username, role, active FROM users').all());

db.close();
