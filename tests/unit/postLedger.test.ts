import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { postLedger, ensureLot } from '../../services/engine3-inventory/src/ledger/postLedger.js';

describe('postLedger Unit Tests', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
    seedMinimal(db);
    ensureLot(db, {
      lotId: 'LOT-TEST-001',
      sku: 'SKU-TEST-001',
      supplier: 'Test Supplier',
    });
  });

  it('throws if called outside an open transaction', () => {
    expect(() => {
      postLedger(
        db,
        [
          {
            sku: 'SKU-TEST-001',
            lotId: 'LOT-TEST-001',
            qty: 5,
            from: 'EXT',
            to: 'BIN:BIN-A01-1',
            type: 'RECEIVE',
          },
        ],
        { id: '1' }
      );
    }).toThrow('postLedger must be called inside an open transaction');
  });

  it('moves 5 units EXT -> BIN then BIN -> TOTE successfully', () => {
    // 1. EXT -> BIN
    const entries1 = db.transaction(() => {
      return postLedger(
        db,
        [
          {
            sku: 'SKU-TEST-001',
            lotId: 'LOT-TEST-001',
            qty: 5,
            from: 'EXT',
            to: 'BIN:BIN-A01-1',
            type: 'PUTAWAY',
          },
        ],
        { id: '1' }
      );
    })();

    expect(entries1).toHaveLength(1);
    expect(entries1[0].entryRef).toMatch(/^LED-/);

    // Verify projection in inventory table
    const inv1 = db.prepare('SELECT qty, sku, lot_id FROM inventory WHERE bin_code = ?').get('BIN-A01-1') as any;
    expect(inv1.qty).toBe(5);
    expect(inv1.sku).toBe('SKU-TEST-001');
    expect(inv1.lot_id).toBe('LOT-TEST-001');

    // Verify balance in location_balances
    const balBin = db.prepare('SELECT qty FROM location_balances WHERE location_key = ?').get('BIN:BIN-A01-1') as any;
    expect(balBin.qty).toBe(5);

    const balExt = db.prepare('SELECT qty FROM location_balances WHERE location_key = ?').get('EXT') as any;
    expect(balExt.qty).toBe(-5); // EXT is allowed to be negative

    // 2. BIN -> TOTE (3 units)
    const entries2 = db.transaction(() => {
      return postLedger(
        db,
        [
          {
            sku: 'SKU-TEST-001',
            lotId: 'LOT-TEST-001',
            qty: 3,
            from: 'BIN:BIN-A01-1',
            to: 'TOTE:TOTE-001',
            type: 'PICK',
          },
        ],
        { id: '1' }
      );
    })();

    expect(entries2).toHaveLength(1);

    // Verify projection updated
    const inv2 = db.prepare('SELECT qty, sku, lot_id FROM inventory WHERE bin_code = ?').get('BIN-A01-1') as any;
    expect(inv2.qty).toBe(2);
    expect(inv2.sku).toBe('SKU-TEST-001');

    const balTote = db.prepare('SELECT qty FROM location_balances WHERE location_key = ?').get('TOTE:TOTE-001') as any;
    expect(balTote.qty).toBe(3);
  });

  it('throws NEGATIVE_BALANCE when attempting to move more than present in non-EXT location', () => {
    // Put 5 units into BIN
    db.transaction(() => {
      postLedger(
        db,
        [
          {
            sku: 'SKU-TEST-001',
            lotId: 'LOT-TEST-001',
            qty: 5,
            from: 'EXT',
            to: 'BIN:BIN-A01-1',
            type: 'PUTAWAY',
          },
        ],
        { id: '1' }
      );
    })();

    // Try to move 6 units out of BIN
    expect(() => {
      db.transaction(() => {
        postLedger(
          db,
          [
            {
              sku: 'SKU-TEST-001',
              lotId: 'LOT-TEST-001',
              qty: 6,
              from: 'BIN:BIN-A01-1',
              to: 'TOTE:TOTE-001',
              type: 'PICK',
            },
          ],
          { id: '1' }
        );
      })();
    }).toThrow(/NEGATIVE_BALANCE/);

    // Assert bin balance still 5
    const inv = db.prepare('SELECT qty FROM inventory WHERE bin_code = ?').get('BIN-A01-1') as any;
    expect(inv.qty).toBe(5);
  });

  it('maintains projection inventory = 0, sku = null when completely emptied', () => {
    db.transaction(() => {
      postLedger(
        db,
        [
          {
            sku: 'SKU-TEST-001',
            lotId: 'LOT-TEST-001',
            qty: 5,
            from: 'EXT',
            to: 'BIN:BIN-A01-1',
            type: 'PUTAWAY',
          },
        ],
        { id: '1' }
      );
    })();

    db.transaction(() => {
      postLedger(
        db,
        [
          {
            sku: 'SKU-TEST-001',
            lotId: 'LOT-TEST-001',
            qty: 5,
            from: 'BIN:BIN-A01-1',
            to: 'TOTE:TOTE-001',
            type: 'PICK',
          },
        ],
        { id: '1' }
      );
    })();

    const inv = db.prepare('SELECT qty, sku, lot_id FROM inventory WHERE bin_code = ?').get('BIN-A01-1') as any;
    expect(inv.qty).toBe(0);
    expect(inv.sku).toBeNull();
    expect(inv.lot_id).toBeNull();
  });

  it('blocks updates and deletes on ledger_entries with LEDGER_IMMUTABLE', () => {
    let entryId: number;
    db.transaction(() => {
      const res = postLedger(
        db,
        [
          {
            sku: 'SKU-TEST-001',
            lotId: 'LOT-TEST-001',
            qty: 5,
            from: 'EXT',
            to: 'BIN:BIN-A01-1',
            type: 'PUTAWAY',
          },
        ],
        { id: '1' }
      );
      entryId = res[0].id;
    })();

    expect(() => {
      db.prepare('UPDATE ledger_entries SET qty = 10 WHERE id = ?').run(entryId!);
    }).toThrow(/LEDGER_IMMUTABLE/);

    expect(() => {
      db.prepare('DELETE FROM ledger_entries WHERE id = ?').run(entryId!);
    }).toThrow(/LEDGER_IMMUTABLE/);
  });
});
