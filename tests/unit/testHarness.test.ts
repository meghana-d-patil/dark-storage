import { describe, it, expect } from 'vitest';
import { makeTestDb, seedMinimal } from '../helpers/db.js';

describe('Test Harness (P1-T1)', () => {
  it('creates an in-memory SQLite db with migrations applied and seeds minimal layout', () => {
    const db = makeTestDb();
    expect(db).toBeDefined();

    seedMinimal(db);

    const product = db.prepare('SELECT * FROM products WHERE sku = ?').get('SKU-TEST-001') as any;
    expect(product).toBeDefined();
    expect(product.name).toBe('Test Standard Item');

    const bins = db.prepare('SELECT * FROM bins WHERE shelf_code = ?').all('SH-A01');
    expect(bins.length).toBe(3);

    const inv = db.prepare('SELECT * FROM inventory').all();
    expect(inv.length).toBe(3);

    db.close();
  });
});
