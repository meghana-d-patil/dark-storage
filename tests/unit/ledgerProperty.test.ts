import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { postLedger, ensureLot, EntryType } from '../../services/engine3-inventory/src/ledger/postLedger.js';

describe('P4-T8: Ledger Property Tests', () => {
  it('performs 200 random valid movements across 5 bins and 2 SKUs with zero conservation drift and no negative balance', () => {
    const db = makeTestDb();
    seedMinimal(db);

    // Setup 2 SKUs
    db.prepare(`
      INSERT OR IGNORE INTO products (sku, name, category, storage_class, unit, max_receive_qty, active, barcode, weight_g, price_paise)
      VALUES ('SKU-TEST-002', 'Second Test Item', 'Testing', 'STANDARD', 'EA', 500, 1, 'SKU-TEST-002', 200, 25000)
    `).run();

    // Update all bins on SH-A01 to capacity 1000 for high volume property test
    db.prepare("UPDATE bins SET capacity = 1000 WHERE shelf_code = 'SH-A01'").run();

    // Setup 5 bins on SH-A01
    const bins = ['BIN-A01-1', 'BIN-A01-2', 'BIN-A01-3', 'BIN-A01-4', 'BIN-A01-5'];
    for (let i = 4; i <= 5; i++) {
      db.prepare(`
        INSERT OR IGNORE INTO bins (code, shelf_code, level, capacity, status, recount_required)
        VALUES (?, 'SH-A01', ?, 1000, 'ACTIVE', 0)
      `).run(`BIN-A01-${i}`, i);
      db.prepare(`
        INSERT OR IGNORE INTO inventory (bin_code, sku, qty, reserved_qty)
        VALUES (?, NULL, 0, 0)
      `).run(`BIN-A01-${i}`);
    }

    const skus = [
      { sku: 'SKU-TEST-001', lot: 'LOT-PROP-001' },
      { sku: 'SKU-TEST-002', lot: 'LOT-PROP-002' },
    ];

    for (const item of skus) {
      ensureLot(db, {
        lotId: item.lot,
        sku: item.sku,
        supplier: 'PROP_TEST',
      });
    }

    // Seed initial stock from EXT into bins
    db.transaction(() => {
      postLedger(
        db,
        [
          {
            sku: skus[0].sku,
            lotId: skus[0].lot,
            qty: 100,
            from: 'EXT',
            to: `BIN:${bins[0]}`,
            type: 'PUTAWAY',
          },
          {
            sku: skus[1].sku,
            lotId: skus[1].lot,
            qty: 100,
            from: 'EXT',
            to: `BIN:${bins[1]}`,
            type: 'PUTAWAY',
          },
        ],
        { id: '1' }
      );
    })();

    const totes = ['TOTE:TOTE-001', 'TOTE:TOTE-002', 'TOTE:TOTE-003'];
    const staged = ['STAGED:RCV-PROP-1'];

    // Possible valid movement patterns:
    // 1. EXT -> BIN (Receive/Putaway)
    // 2. BIN -> TOTE (Pick)
    // 3. TOTE -> BIN (Putback)
    // 4. BIN -> BIN (Relocate within same SKU/lot)
    // 5. EXT -> STAGED (Receive)
    // 6. STAGED -> BIN (Putaway)
    // 7. BIN -> LOST (Adjust out / damage)
    // 8. EXT -> BIN (Adjust in)

    const checkBalances = db.prepare(`
      SELECT location_key, sku, lot_id, qty
      FROM location_balances
    `);

    const checkConservation = db.prepare(`
      SELECT sku, lot_id, SUM(qty) AS total_sum
      FROM location_balances
      GROUP BY sku, lot_id
    `);

    for (let step = 0; step < 200; step++) {
      // Pick a random SKU
      const currentItem = skus[step % 2];

      // Query current balances with qty > 0 for this SKU
      const balances = db
        .prepare(
          `
        SELECT location_key, qty
        FROM location_balances
        WHERE sku = ? AND lot_id = ? AND qty > 0
      `
        )
        .all(currentItem.sku, currentItem.lot) as Array<{ location_key: string; qty: number }>;

      db.transaction(() => {
        const action = Math.floor(Math.random() * 5);

        if (action === 0 || balances.length === 0) {
          // Inbound from EXT to a bin holding this SKU or an empty bin
          // Find empty bin or bin with this SKU
          const candidateBin = bins.find((b) => {
            const inv = db.prepare('SELECT sku, qty FROM inventory WHERE bin_code = ?').get(b) as any;
            return !inv || inv.qty === 0 || inv.sku === currentItem.sku;
          }) || bins[0];

          postLedger(
            db,
            [
              {
                sku: currentItem.sku,
                lotId: currentItem.lot,
                qty: Math.floor(Math.random() * 10) + 1,
                from: 'EXT',
                to: `BIN:${candidateBin}`,
                type: 'PUTAWAY',
              },
            ],
            { id: '1' }
          );
        } else if (action === 1) {
          // Move from positive location to TOTE
          const source = balances[Math.floor(Math.random() * balances.length)];
          const moveQty = Math.max(1, Math.min(source.qty, Math.floor(Math.random() * 5) + 1));
          const targetTote = totes[Math.floor(Math.random() * totes.length)];

          if (source.location_key !== targetTote) {
            postLedger(
              db,
              [
                {
                  sku: currentItem.sku,
                  lotId: currentItem.lot,
                  qty: moveQty,
                  from: source.location_key,
                  to: targetTote,
                  type: 'PICK',
                },
              ],
              { id: '1' }
            );
          }
        } else if (action === 2) {
          // Move from TOTE or source to a candidate BIN
          const source = balances[Math.floor(Math.random() * balances.length)];
          const moveQty = Math.max(1, Math.min(source.qty, Math.floor(Math.random() * 5) + 1));
          const candidateBin = bins.find((b) => {
            const inv = db.prepare('SELECT sku, qty FROM inventory WHERE bin_code = ?').get(b) as any;
            return (!inv || inv.qty === 0 || inv.sku === currentItem.sku) && `BIN:${b}` !== source.location_key;
          });

          if (candidateBin) {
            postLedger(
              db,
              [
                {
                  sku: currentItem.sku,
                  lotId: currentItem.lot,
                  qty: moveQty,
                  from: source.location_key,
                  to: `BIN:${candidateBin}`,
                  type: 'PUTBACK',
                },
              ],
              { id: '1' }
            );
          }
        } else if (action === 3) {
          // Write off / lose a small amount from a positive non-EXT balance
          const nonExtBalances = balances.filter((b) => b.location_key !== 'EXT' && !b.location_key.startsWith('LOST'));
          if (nonExtBalances.length > 0) {
            const source = nonExtBalances[Math.floor(Math.random() * nonExtBalances.length)];
            const moveQty = Math.max(1, Math.min(source.qty, Math.floor(Math.random() * 3) + 1));

            postLedger(
              db,
              [
                {
                  sku: currentItem.sku,
                  lotId: currentItem.lot,
                  qty: moveQty,
                  from: source.location_key,
                  to: 'LOST',
                  type: 'WRITE_OFF',
                },
              ],
              { id: '1' }
            );
          }
        } else {
          // Staged inbound flow: EXT -> STAGED -> candidate BIN
          const stg = staged[0];
          const moveQty = Math.floor(Math.random() * 5) + 1;
          const candidateBin = bins.find((b) => {
            const inv = db.prepare('SELECT sku, qty FROM inventory WHERE bin_code = ?').get(b) as any;
            return !inv || inv.qty === 0 || inv.sku === currentItem.sku;
          }) || bins[0];

          postLedger(
            db,
            [
              {
                sku: currentItem.sku,
                lotId: currentItem.lot,
                qty: moveQty,
                from: 'EXT',
                to: stg,
                type: 'RECEIVE',
              },
              {
                sku: currentItem.sku,
                lotId: currentItem.lot,
                qty: moveQty,
                from: stg,
                to: `BIN:${candidateBin}`,
                type: 'PUTAWAY',
              },
            ],
            { id: '1' }
          );
        }
      })();

      // 1. Assert NO negative non-EXT balance
      const negativeNonExt = checkBalances
        .all()
        .filter((r: any) => r.location_key !== 'EXT' && r.qty < 0);
      expect(
        negativeNonExt,
        `Negative non-EXT balance found at step ${step}: ${JSON.stringify(negativeNonExt)}`
      ).toHaveLength(0);

      // 2. Assert sum over all locations == 0 per (sku, lot) (Stock Conservation Law)
      const conservation = checkConservation.all() as Array<{ sku: string; lot_id: string; total_sum: number }>;
      for (const row of conservation) {
        expect(
          row.total_sum,
          `Conservation broken for ${row.sku} / ${row.lot_id} at step ${step}: sum is ${row.total_sum}`
        ).toBe(0);
      }
    }

    // Final reconciliation check: verify inventory table matches location_balances exactly for all bins
    for (const b of bins) {
      const invRow = db.prepare('SELECT sku, qty, lot_id FROM inventory WHERE bin_code = ?').get(b) as any;
      const balRow = db
        .prepare('SELECT SUM(qty) AS total_qty FROM location_balances WHERE location_key = ? AND qty > 0')
        .get(`BIN:${b}`) as any;
      const expectedQty = balRow?.total_qty || 0;
      expect(invRow.qty).toBe(expectedQty);
    }
  });
});
