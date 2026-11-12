import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { createReceipt } from '../../services/engine3-inventory/src/domain/receivingRepo.js';
import { executePutaway, executeRelocate } from '../../services/engine3-inventory/src/domain/putawayRepo.js';
import { ensureLot } from '../../services/engine3-inventory/src/ledger/postLedger.js';

describe('Phase 4 Full Inbound and Movement Integration Test', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
    seedMinimal(db);
    ensureLot(db, {
      lotId: 'LOT-TEST-001',
      sku: 'SKU-TEST-001',
      supplier: 'Integration Supplier',
    });
  });

  it('runs receive -> putaway -> relocate, maintaining perfect ledger reconciliation', () => {
    // 1. Receive 10 units of SKU-TEST-001
    const receipt = db.transaction(() => {
      return createReceipt(db, {
        supplier: 'Acme Test Corp',
        reference_no: 'PO-TEST-999',
        lines: [{ sku: 'SKU-TEST-001', qty: 10 }],
        actor: { id: 1, name: 'Operator 1', role: 'OPERATOR' },
      });
    })();

    expect(receipt.ref).toMatch(/^RCV-/);
    const lineId = receipt.lines[0].line_id;

    // Verify STAGED balance is 10
    const stagedBal = db
      .prepare('SELECT qty FROM location_balances WHERE location_key = ?')
      .get(`STAGED:${receipt.ref}`) as any;
    expect(stagedBal.qty).toBe(10);

    // 2. Putaway 6 units to BIN-A01-1
    const putawayRes = executePutaway(db, {
      receipt_line_id: lineId,
      dest_bin: 'BIN-A01-1',
      qty: 6,
      actor: { id: 1, display_name: 'Operator 1', role: 'OPERATOR' },
    });

    expect(putawayRes.ref).toMatch(/^PUT-/);

    // Check balances after putaway
    const stagedAfter = db
      .prepare('SELECT qty FROM location_balances WHERE location_key = ?')
      .get(`STAGED:${receipt.ref}`) as any;
    expect(stagedAfter.qty).toBe(4);

    const bin1Bal = db
      .prepare('SELECT qty FROM location_balances WHERE location_key = ?')
      .get('BIN:BIN-A01-1') as any;
    expect(bin1Bal.qty).toBe(6);

    const invBin1 = db.prepare('SELECT qty, sku FROM inventory WHERE bin_code = ?').get('BIN-A01-1') as any;
    expect(invBin1.qty).toBe(6);
    expect(invBin1.sku).toBe('SKU-TEST-001');

    // 3. Relocate 3 units from BIN-A01-1 to BIN-A01-2
    const relocateRes = executeRelocate(db, {
      from_bin: 'BIN-A01-1',
      to_bin: 'BIN-A01-2',
      qty: 3,
      actor: { id: 1, display_name: 'Operator 1', role: 'OPERATOR' },
    });

    expect(relocateRes.movement_ref).toMatch(/^MOV-/);

    // Check balances after relocate
    const bin1After = db
      .prepare('SELECT qty FROM location_balances WHERE location_key = ?')
      .get('BIN:BIN-A01-1') as any;
    expect(bin1After.qty).toBe(3);

    const bin2After = db
      .prepare('SELECT qty FROM location_balances WHERE location_key = ?')
      .get('BIN:BIN-A01-2') as any;
    expect(bin2After.qty).toBe(3);

    const invBin1After = db.prepare('SELECT qty FROM inventory WHERE bin_code = ?').get('BIN-A01-1') as any;
    expect(invBin1After.qty).toBe(3);

    const invBin2After = db.prepare('SELECT qty, sku FROM inventory WHERE bin_code = ?').get('BIN-A01-2') as any;
    expect(invBin2After.qty).toBe(3);
    expect(invBin2After.sku).toBe('SKU-TEST-001');

    // 4. Reconcile check: compare projection to location_balances
    const mismatches = db
      .prepare(
        `
      WITH ledger_bins AS (
        SELECT
          substr(location_key, 5) AS bin_code,
          sku,
          SUM(qty) AS ledger_qty
        FROM location_balances
        WHERE location_key GLOB 'BIN:*'
        GROUP BY location_key, sku
        HAVING SUM(qty) <> 0
      ),
      inv_bins AS (
        SELECT
          bin_code,
          sku,
          qty AS proj_qty
        FROM inventory
        WHERE qty > 0 AND sku IS NOT NULL
      ),
      all_keys AS (
        SELECT bin_code, sku FROM ledger_bins
        UNION
        SELECT bin_code, sku FROM inv_bins
      )
      SELECT
        k.bin_code AS binCode,
        k.sku,
        COALESCE(i.proj_qty, 0) AS projectionQty,
        COALESCE(l.ledger_qty, 0) AS ledgerQty
      FROM all_keys k
      LEFT JOIN inv_bins i ON i.bin_code = k.bin_code AND i.sku = k.sku
      LEFT JOIN ledger_bins l ON l.bin_code = k.bin_code AND l.sku = k.sku
      WHERE COALESCE(i.proj_qty, 0) <> COALESCE(l.ledger_qty, 0)
    `
      )
      .all();

    expect(mismatches).toHaveLength(0);
  });
});
