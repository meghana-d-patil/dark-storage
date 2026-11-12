import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { postLedger, ensureLot, reconcileLedger } from '../../services/engine3-inventory/src/ledger/postLedger.js';
import { claimNextMission } from '../../services/engine3-inventory/src/domain/pickerRepo.js';
import { reportPickException } from '../../services/engine3-inventory/src/domain/exceptionsRepo.js';

describe('Phase 7: No Alternate Bin / Short Fallback Integration Test', () => {
  let db: Database.Database;
  let missionRef: string;
  let stopRef1: string;

  const picker = { id: 4, role: 'PICKER', username: 'test-picker' };

  beforeEach(() => {
    db = makeTestDb();
    seedMinimal(db);

    ensureLot(db, {
      lotId: 'LOT-TEST-001',
      sku: 'SKU-TEST-001',
      supplier: 'Test Supplier',
    });

    // Stock ONLY in BIN-A01-1 (2 units) - no other bin has this SKU
    db.transaction(() => {
      postLedger(
        db,
        [
          {
            sku: 'SKU-TEST-001',
            lotId: 'LOT-TEST-001',
            qty: 2,
            from: 'EXT',
            to: 'BIN:BIN-A01-1',
            type: 'PUTAWAY',
          },
        ],
        { id: '1' }
      );
    })();

    // Create order for 2 units
    const orderRes = db.prepare(`
      INSERT INTO orders (ref, customer_ref, status, priority, order_type, requested_by)
      VALUES ('ORD-SHORT-01', 'Short Customer', 'RESERVED', 'NORMAL', 'CUSTOMER', 1)
    `).run();
    const orderId = Number(orderRes.lastInsertRowid);

    const lineRes = db.prepare(`
      INSERT INTO order_lines (order_id, line_no, sku, qty_ordered)
      VALUES (?, 1, 'SKU-TEST-001', 2)
    `).run(orderId);
    const lineId = Number(lineRes.lastInsertRowid);

    const res = db.prepare(`
      INSERT INTO reservations (order_id, order_line_id, sku, bin_code, qty, consumed_qty, released_qty, status)
      VALUES (?, ?, 'SKU-TEST-001', 'BIN-A01-1', 2, 0, 0, 'HELD')
    `).run(orderId, lineId);
    const reservationId = Number(res.lastInsertRowid);

    missionRef = 'MIS-SHORT-01';
    stopRef1 = `${missionRef}-S01`;

    const mRes = db.prepare(`
      INSERT INTO missions (ref, order_id, status, route_json, route_distance, route_algorithm, priority, version)
      VALUES (?, ?, 'QUEUED', '[]', 5, 'TRIVIAL', 10, 0)
    `).run(missionRef, orderId);
    const missionId = Number(mRes.lastInsertRowid);

    db.prepare(`
      INSERT INTO pick_stops (
        mission_id, stop_no, stop_ref, seq, reservation_id,
        bin_code, sku, qty_required, qty_picked, step, status
      ) VALUES (?, 1, ?, 1, ?, 'BIN-A01-1', 'SKU-TEST-001', 2, 0, 'PENDING', 'PENDING')
    `).run(missionId, stopRef1, reservationId);
  });

  it('marks stop SHORT and records order shortfall when no alternate bin exists', () => {
    claimNextMission(db, picker);

    // Picker reports MISSING on stop 1
    const refreshedMission = reportPickException(
      db,
      stopRef1,
      { kind: 'MISSING', note: 'No stock in bin and no other location exists' },
      picker
    );

    // Stop is marked SHORT
    const stop = db.prepare('SELECT step FROM pick_stops WHERE stop_ref = ?').get(stopRef1) as any;
    expect(stop.step).toBe('SHORT');

    // Order line shortfall recorded
    const line = db.prepare("SELECT qty_short FROM order_lines WHERE sku = 'SKU-TEST-001'").get() as any;
    expect(line.qty_short).toBe(2);

    // Reservation released
    const res = db.prepare("SELECT status, released_qty FROM reservations WHERE sku = 'SKU-TEST-001'").get() as any;
    expect(res.status).toBe('RELEASED');
    expect(res.released_qty).toBe(2);

    // Bin is frozen
    const bin = db.prepare("SELECT pick_frozen, frozen_reason FROM bins WHERE code = 'BIN-A01-1'").get() as any;
    expect(bin.pick_frozen).toBe(1);
    expect(bin.frozen_reason).toBe('MISSING');

    // COUNT floor task created
    const countTask = db.prepare("SELECT * FROM floor_tasks WHERE bin_code = 'BIN-A01-1' AND type = 'COUNT'").get() as any;
    expect(countTask).toBeDefined();

    // Refreshed mission reflects done/short
    expect(refreshedMission.stops[0].step).toBe('SHORT');
    expect(refreshedMission.doneStops).toBe(1);
  });
});
