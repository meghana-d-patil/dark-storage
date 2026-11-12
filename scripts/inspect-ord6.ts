import Database from 'better-sqlite3';

const db = new Database('./data/warehouse.db', { readonly: true });
console.log('ORD-0006:', db.prepare("SELECT * FROM orders WHERE ref = 'ORD-0006'").get());
console.log('Missions for ORD-0006:', db.prepare("SELECT * FROM missions WHERE order_id = (SELECT id FROM orders WHERE ref = 'ORD-0006')").all());
console.log('Order lines for ORD-0006:', db.prepare("SELECT * FROM order_lines WHERE order_id = (SELECT id FROM orders WHERE ref = 'ORD-0006')").all());
console.log('Reservations for ORD-0006:', db.prepare("SELECT * FROM reservations WHERE order_id = (SELECT id FROM orders WHERE ref = 'ORD-0006')").all());
db.close();
