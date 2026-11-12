import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { postLedger, ensureLot, reconcileLedger } from '../../services/engine3-inventory/src/ledger/postLedger.js';
import {
  requestAdjustment,
  approveAdjustment,
  rejectAdjustment,
  flagDamageStock,
} from '../../services/engine3-inventory/src/domain/adjustmentsRepo.js';

describe('Phase 7: Adjustments & Dual-Control Integration Tests', () => {
  let db: Database.Database;

  const operator = { id: 3, role: 'OPERATOR', username: 'test-operator' };
  const manager = { id: 2, role: 'MANAGER', username: 'test-manager' };
  const admin = { id: 1, role: 'ADMIN', username: 'test-admin' };

  beforeEach(() => {
    db = makeTestDb();
    seedMinimal(db);

    ensureLot(db, {
      lotId: 'LOT-TEST-001',
      sku: 'SKU-TEST-001',
      supplier: 'Test Supplier',
    });
    db.prepare('UPDATE products SET price_paise = ? WHERE sku = ?').run(60000, 'SKU-TEST-001');

    // Stock 20 units in BIN-A01-1
    db.transaction(() => {
      postLedger(
        db,
        [
          {
            sku: 'SKU-TEST-001',
            lotId: 'LOT-TEST-001',
            qty: 20,
            from: 'EXT',
            to: 'BIN:BIN-A01-1',
            type: 'PUTAWAY',
          },
        ],
        { id: '1' }
      );
    })();
  });

  it('promotes high-value adjustment (>= 5000 INR) to PENDING_ADMIN, prevents same-user second approval, and completes on admin approval', () => {
    // 1. Operator requests adjustment for -10 units (Value = 10 * 600 = 6,000 INR >= 5,000 INR)
    const reqRes = requestAdjustment(
      db,
      {
        binCode: 'BIN-A01-1',
        sku: 'SKU-TEST-001',
        deltaQty: -10,
        reasonCode: 'CYCLE_COUNT',
        note: 'High-value variance detected',
      },
      operator
    );
    expect(reqRes.ok).toBe(true);
    expect(reqRes.status).toBe('PENDING_MANAGER');
    const adjRef = reqRes.adjRef;

    // 2. Requester cannot approve their own adjustment
    expect(() => {
      approveAdjustment(db, adjRef, {}, operator);
    }).toThrow(/SELF_APPROVAL_FORBIDDEN/);

    // 3. Manager approves: since value >= 5,000 INR, promoted to PENDING_ADMIN
    const mgrApproveRes = approveAdjustment(db, adjRef, { note: 'Manager verification ok' }, manager);
    expect(mgrApproveRes.ok).toBe(true);
    expect(mgrApproveRes.status).toBe('PENDING_ADMIN');

    const adjAfterMgr = db.prepare('SELECT status, manager_id FROM inventory_adjustments WHERE adj_ref = ?').get(adjRef) as any;
    expect(adjAfterMgr.status).toBe('PENDING_ADMIN');
    expect(adjAfterMgr.manager_id).toBe(manager.username);

    // 4. Same manager cannot perform second approval
    expect(() => {
      approveAdjustment(db, adjRef, {}, manager);
    }).toThrow(/SELF_APPROVAL_FORBIDDEN/);

    // 5. Admin performs second approval
    const adminApproveRes = approveAdjustment(db, adjRef, { note: 'Admin signoff' }, admin);
    expect(adminApproveRes.ok).toBe(true);
    expect(adminApproveRes.status).toBe('APPLIED');

    const adjAfterAdmin = db.prepare('SELECT status, admin_id FROM inventory_adjustments WHERE adj_ref = ?').get(adjRef) as any;
    expect(adjAfterAdmin.status).toBe('APPLIED');
    expect(adjAfterAdmin.admin_id).toBe(admin.username);

    // 6. Verify ledger entry ADJUST_OUT
    const ledgerEntry = db.prepare(`
      SELECT * FROM ledger_entries
      WHERE sku = 'SKU-TEST-001' AND from_loc = 'BIN:BIN-A01-1' AND to_loc = 'LOST'
    `).get() as any;
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry.qty).toBe(10);
    expect(ledgerEntry.entry_type).toBe('ADJUST_OUT');

    // 7. Verify inventory balance updated to 10
    const inv = db.prepare('SELECT qty FROM inventory WHERE bin_code = ?').get('BIN-A01-1') as any;
    expect(inv.qty).toBe(10);

    const recon = reconcileLedger(db);
    expect(recon.ok).toBe(true);
    expect(recon.drift_count).toBe(0);
  });

  it('quarantines stock on damage flag and restores stock from QUAR to BIN if write-off is rejected', () => {
    // 1. Flag 3 units in BIN-A01-1 as damaged
    const flagRes = flagDamageStock(
      db,
      { binCode: 'BIN-A01-1', qty: 3, note: 'Water leak from ceiling' },
      operator
    );
    expect(flagRes.ok).toBe(true);
    expect(flagRes.quarantinedQty).toBe(3);

    // Verify stock moved from BIN:BIN-A01-1 to QUAR
    const invAfterFlag = db.prepare('SELECT qty FROM inventory WHERE bin_code = ?').get('BIN-A01-1') as any;
    expect(invAfterFlag.qty).toBe(17); // 20 - 3 = 17

    const quarBal = db.prepare("SELECT qty FROM location_balances WHERE location_key = 'QUAR' AND sku = 'SKU-TEST-001'").get() as any;
    expect(quarBal.qty).toBe(3);

    // 2. Find created DAMAGE_WRITE_OFF adjustment
    const adj = db.prepare("SELECT * FROM inventory_adjustments WHERE bin_code = 'BIN-A01-1' AND kind = 'DAMAGE_WRITE_OFF'").get() as any;
    expect(adj).toBeDefined();
    expect(adj.status).toBe('PENDING_MANAGER');
    expect(adj.delta_qty).toBe(-3);

    // 3. Manager rejects the damage write-off (e.g. items inspected and found undamaged)
    const rejectRes = rejectAdjustment(
      db,
      adj.adj_ref,
      { reasonCode: 'FALSE_ALARM', note: 'Packaging slightly damp, products intact' },
      manager
    );
    expect(rejectRes.ok).toBe(true);
    expect(rejectRes.status).toBe('REJECTED');

    // 4. Verify stock released from QUAR back to BIN:BIN-A01-1
    const invAfterReject = db.prepare('SELECT qty FROM inventory WHERE bin_code = ?').get('BIN-A01-1') as any;
    expect(invAfterReject.qty).toBe(20); // Restored!

    const quarBalAfterReject = db.prepare("SELECT qty FROM location_balances WHERE location_key = 'QUAR' AND sku = 'SKU-TEST-001'").get() as any;
    expect(quarBalAfterReject.qty).toBe(0);

    // Verify ledger has QUARANTINE_RELEASE entry
    const releaseEntry = db.prepare(`
      SELECT * FROM ledger_entries
      WHERE sku = 'SKU-TEST-001' AND from_loc = 'QUAR' AND to_loc = 'BIN:BIN-A01-1'
    `).get() as any;
    expect(releaseEntry).toBeDefined();
    expect(releaseEntry.entry_type).toBe('QUARANTINE_RELEASE');
    expect(releaseEntry.qty).toBe(3);

    const recon = reconcileLedger(db);
    expect(recon.ok).toBe(true);
    expect(recon.drift_count).toBe(0);
  });
});
