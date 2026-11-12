import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { postLedger, ensureLot, reconcileLedger } from '../../services/engine3-inventory/src/ledger/postLedger.js';
import { claimNextMission, claimFloorTask } from '../../services/engine3-inventory/src/domain/pickerRepo.js';
import {
  reportPickException,
  resolveException,
} from '../../services/engine3-inventory/src/domain/exceptionsRepo.js';
import {
  submitBlindCount,
  approveAdjustment,
} from '../../services/engine3-inventory/src/domain/adjustmentsRepo.js';

describe('Phase 7: Full Flow B Exception Loop Integration Test', () => {
  let db: Database.Database;
  let missionRef: string;
  let stopRef1: string;

  const picker = { id: 4, role: 'PICKER', username: 'test-picker' };
  const operator1 = { id: 3, role: 'OPERATOR', username: 'test-operator-1' };
  const operator2 = { id: 5, role: 'OPERATOR', username: 'test-operator-2' };
  const manager = { id: 2, role: 'MANAGER', username: 'test-manager' };

  beforeEach(() => {
    db = makeTestDb();
    seedMinimal(db);

    ensureLot(db, {
      lotId: 'LOT-TEST-001',
      sku: 'SKU-TEST-001',
      supplier: 'Test Supplier',
      pricePaise: 5000, // 50 INR per unit
    });

    // 1. Put stock in two bins:
    // BIN-A01-1 (2 units) - will have missing stock reported
    // BIN-A01-2 (10 units) - alternate bin for reroute
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
          {
            sku: 'SKU-TEST-001',
            lotId: 'LOT-TEST-001',
            qty: 10,
            from: 'EXT',
            to: 'BIN:BIN-A01-2',
            type: 'PUTAWAY',
          },
        ],
        { id: '1' }
      );
    })();

    // 2. Create customer order for 2 units
    const orderRes = db.prepare(`
      INSERT INTO orders (ref, customer_ref, status, priority, order_type, requested_by)
      VALUES ('ORD-EXC-01', 'Test Customer', 'RESERVED', 'NORMAL', 'CUSTOMER', 1)
    `).run();
    const orderId = Number(orderRes.lastInsertRowid);

    const lineRes = db.prepare(`
      INSERT INTO order_lines (order_id, line_no, sku, qty_ordered)
      VALUES (?, 1, 'SKU-TEST-001', 2)
    `).run(orderId);
    const lineId = Number(lineRes.lastInsertRowid);

    // 3. Reserve 2 units in BIN-A01-1
    const res = db.prepare(`
      INSERT INTO reservations (order_id, order_line_id, sku, bin_code, qty, consumed_qty, released_qty, status)
      VALUES (?, ?, 'SKU-TEST-001', 'BIN-A01-1', 2, 0, 0, 'HELD')
    `).run(orderId, lineId);
    const reservationId = Number(res.lastInsertRowid);

    // 4. Create Mission
    missionRef = 'MIS-EXC-01';
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

  it('executes full Flow B: report missing -> freeze bin -> reroute stop -> blind count round 1 -> round 2 verification -> variance adjustment -> manager approval -> resolution & unfreeze', () => {
    // Step 1: Picker claims mission
    const claimedMission = claimNextMission(db, picker);
    expect(claimedMission.missionRef).toBe(missionRef);
    expect(claimedMission.stops[0].binCode).toBe('BIN-A01-1');

    // Step 2: Picker reports MISSING on stop 1
    const refreshedMission = reportPickException(
      db,
      stopRef1,
      { kind: 'MISSING', note: 'Shelf empty, box not found' },
      picker
    );

    // Verify bin is frozen
    const bin1 = db.prepare('SELECT pick_frozen, frozen_reason FROM bins WHERE code = ?').get('BIN-A01-1') as any;
    expect(bin1.pick_frozen).toBe(1);
    expect(bin1.frozen_reason).toBe('MISSING');

    // Verify pick stop 1 was cancelled/rerouted and replacement stop was created
    const oldStop = db.prepare('SELECT id, step FROM pick_stops WHERE stop_ref = ?').get(stopRef1) as any;
    expect(oldStop.step).toBe('CANCELLED');

    const stops = db.prepare('SELECT * FROM pick_stops WHERE mission_id = (SELECT id FROM missions WHERE ref = ?) ORDER BY seq ASC').all(missionRef) as any[];
    expect(stops).toHaveLength(2);
    const newStop = stops[1];
    expect(newStop.status).toBe('PENDING');
    expect(newStop.bin_code).toBe('BIN-A01-2'); // Rerouted to alternate bin
    expect(newStop.qty_required).toBe(2);

    // Verify refreshed mission DTO reflects the new stop
    expect(refreshedMission.stops).toHaveLength(1);
    expect(refreshedMission.stops[0].binCode).toBe('BIN-A01-2');
    expect(refreshedMission.stops[0].step).toBe('SCAN_BIN');

    // Verify exception record
    const exc = db.prepare('SELECT * FROM pick_exceptions WHERE stop_id = ?').get(oldStop.id) as any;
    expect(exc).toBeDefined();
    expect(exc.status).toBe('COUNT_REQUESTED');
    expect(exc.count_task_ref).toBeDefined();

    // Verify COUNT floor task was created
    const countTask1 = db.prepare('SELECT * FROM floor_tasks WHERE task_ref = ?').get(exc.count_task_ref) as any;
    expect(countTask1).toBeDefined();
    expect(countTask1.type).toBe('COUNT');
    expect(countTask1.bin_code).toBe('BIN-A01-1');
    expect(countTask1.priority).toBe(90);

    // Step 3: Operator 1 claims count task and submits blind count = 0 (Round 1)
    claimFloorTask(db, countTask1.task_ref, operator1);

    const countResult1 = submitBlindCount(
      db,
      countTask1.task_ref,
      { binScan: 'BIN-A01-1', countedQty: 0 },
      operator1
    );
    expect(countResult1.ok).toBe(true);
    // Ensure response does NOT leak system_qty or variance (D15/D23)
    expect((countResult1 as any).system_qty).toBeUndefined();
    expect((countResult1 as any).variance).toBeUndefined();

    // Since variance is 100% (>10%), Round 1 spawns Round 2
    const excAfterRound1 = db.prepare('SELECT count_task_ref FROM pick_exceptions WHERE ref = ?').get(exc.ref) as any;
    const countTask2Ref = excAfterRound1.count_task_ref;
    expect(countTask2Ref).not.toBe(countTask1.task_ref);

    // Operator 1 cannot claim round 2 (COUNTER_MUST_DIFFER)
    expect(() => {
      claimFloorTask(db, countTask2Ref, operator1);
    }).toThrow(/COUNTER_MUST_DIFFER/);

    // Operator 2 claims round 2 task and submits count = 0
    claimFloorTask(db, countTask2Ref, operator2);
    const countResult2 = submitBlindCount(
      db,
      countTask2Ref,
      { binScan: 'BIN-A01-1', countedQty: 0 },
      operator2
    );
    expect(countResult2.ok).toBe(true);

    // Verify exception status updated to COUNT_SUBMITTED
    const excAfterCount = db.prepare('SELECT status FROM pick_exceptions WHERE ref = ?').get(exc.ref) as any;
    expect(excAfterCount.status).toBe('COUNT_SUBMITTED');

    // Step 4: Verify COUNT_VARIANCE adjustment was created
    const adj = db.prepare('SELECT * FROM inventory_adjustments WHERE source_ref = ?').get(countTask2Ref) as any;
    expect(adj).toBeDefined();
    expect(adj.status).toBe('PENDING_MANAGER');
    expect(adj.delta_qty).toBe(-2); // Variance: 0 counted - 2 system
    expect(adj.requested_by).toBe(operator2.username);

    // Step 5: Dual control - operator cannot approve their own adjustment
    expect(() => {
      approveAdjustment(db, adj.adj_ref, {}, operator2);
    }).toThrow(/SELF_APPROVAL_FORBIDDEN/);

    // Step 6: Manager approves the adjustment
    const approveRes = approveAdjustment(db, adj.adj_ref, { note: 'Confirmed shrinkage' }, manager);
    expect(approveRes.ok).toBe(true);
    expect(approveRes.status).toBe('APPLIED');

    // Verify ledger has ADJUST_OUT
    const ledgerEntry = db.prepare(`
      SELECT * FROM ledger_entries
      WHERE sku = 'SKU-TEST-001' AND from_loc = 'BIN:BIN-A01-1' AND to_loc = 'LOST'
    `).get() as any;
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry.qty).toBe(2);
    expect(ledgerEntry.entry_type).toBe('ADJUST_OUT');

    // Step 7: Manager resolves the exception and unfreezes the bin
    const resolveRes = resolveException(
      db,
      exc.ref,
      { reasonCode: 'INVENTORY_ADJUSTED', note: 'Shrinkage posted and bin verified empty', unfreeze: true },
      manager
    );
    expect(resolveRes.ok).toBe(true);

    const excResolved = db.prepare('SELECT status, resolution, resolution_reason FROM pick_exceptions WHERE ref = ?').get(exc.ref) as any;
    expect(excResolved.status).toBe('RESOLVED');
    expect(excResolved.resolution).toBe('INVENTORY_ADJUSTED');

    const bin1AfterResolve = db.prepare('SELECT pick_frozen, frozen_reason FROM bins WHERE code = ?').get('BIN-A01-1') as any;
    expect(bin1AfterResolve.pick_frozen).toBe(0);
    expect(bin1AfterResolve.frozen_reason).toBeNull();

    // Step 8: Complete ledger reconciliation
    const recon = reconcileLedger(db);
    expect(recon.ok).toBe(true);
    expect(recon.drift_count).toBe(0);
    expect(recon.drifts).toHaveLength(0);
  });
});
