import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import {
  claimNextMission,
  scanBin,
  scanItem,
  scanTote,
} from '../../services/engine3-inventory/src/domain/pickerRepo.js';
import { postLedger, ensureLot } from '../../services/engine3-inventory/src/ledger/postLedger.js';

describe('Phase 5: 3-Step Picking Flow Integration Tests', () => {
  let db: Database.Database;
  let missionRef: string;
  let stopRef1: string;
  let stopRef2: string;

  beforeEach(() => {
    db = makeTestDb();
    seedMinimal(db);

    ensureLot(db, {
      lotId: 'LOT-TEST-001',
      sku: 'SKU-TEST-001',
      supplier: 'Test Supplier',
    });

    // 1. Putaway 20 units into BIN-A01-1 and 20 into BIN-A01-2
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
          {
            sku: 'SKU-TEST-001',
            lotId: 'LOT-TEST-001',
            qty: 20,
            from: 'EXT',
            to: 'BIN:BIN-A01-2',
            type: 'PUTAWAY',
          },
        ],
        { id: '1' }
      );
    })();

    // 2. Create customer order ORD-1001
    const orderRes = db.prepare(`
      INSERT INTO orders (ref, customer_ref, status, priority, order_type, requested_by)
      VALUES ('ORD-1001', 'Alice Customer', 'RESERVED', 'NORMAL', 'CUSTOMER', 1)
    `).run();
    const orderId = Number(orderRes.lastInsertRowid);

    const lineRes = db.prepare(`
      INSERT INTO order_lines (order_id, line_no, sku, qty_ordered)
      VALUES (?, 1, 'SKU-TEST-001', 5)
    `).run(orderId);
    const lineId = Number(lineRes.lastInsertRowid);

    // 3. Create reservations
    const res1 = db.prepare(`
      INSERT INTO reservations (order_id, order_line_id, sku, bin_code, qty, consumed_qty, released_qty, status)
      VALUES (?, ?, 'SKU-TEST-001', 'BIN-A01-1', 2, 0, 0, 'HELD')
    `).run(orderId, lineId);

    const res2 = db.prepare(`
      INSERT INTO reservations (order_id, order_line_id, sku, bin_code, qty, consumed_qty, released_qty, status)
      VALUES (?, ?, 'SKU-TEST-001', 'BIN-A01-2', 3, 0, 0, 'HELD')
    `).run(orderId, lineId);

    // 4. Create QUEUED mission
    missionRef = 'MIS-1001';
    stopRef1 = `${missionRef}-S01`;
    stopRef2 = `${missionRef}-S02`;

    const mRes = db.prepare(`
      INSERT INTO missions (
        ref, order_id, status, route_json, route_distance, route_algorithm,
        priority, version
      ) VALUES (?, ?, 'QUEUED', '[]', 10.5, 'TRIVIAL', 10, 0)
    `).run(missionRef, orderId);
    const missionId = Number(mRes.lastInsertRowid);

    // Insert pick stops in sequence
    db.prepare(`
      INSERT INTO pick_stops (
        mission_id, stop_no, stop_ref, seq, reservation_id,
        bin_code, sku, qty_required, qty_picked, step, status
      ) VALUES (?, 1, ?, 1, ?, 'BIN-A01-1', 'SKU-TEST-001', 2, 0, 'PENDING', 'PENDING')
    `).run(missionId, stopRef1, Number(res1.lastInsertRowid));

    db.prepare(`
      INSERT INTO pick_stops (
        mission_id, stop_no, stop_ref, seq, reservation_id,
        bin_code, sku, qty_required, qty_picked, step, status
      ) VALUES (?, 2, ?, 2, ?, 'BIN-A01-2', 'SKU-TEST-001', 3, 0, 'PENDING', 'PENDING')
    `).run(missionId, stopRef2, Number(res2.lastInsertRowid));
  });

  it('runs complete 3-step picking flow with all guards, state transitions, and ledger reconciliation', () => {
    const picker1 = { id: 1, username: 'picker1', role: 'PICKER' };
    const picker2 = { id: 2, username: 'picker2', role: 'PICKER' };

    // 1. Claim mission
    const claimedDto = claimNextMission(db, picker1);
    expect(claimedDto.missionRef).toBe(missionRef);
    expect(claimedDto.status).toBe('CLAIMED');
    expect(claimedDto.stops).toHaveLength(2);
    expect(claimedDto.stops[0].step).toBe('SCAN_BIN');

    // 2. Negative guard checks on Stop 1
    // (a) Other picker scanning
    expect(() => {
      scanBin(db, stopRef1, 'BIN-A01-1', picker2);
    }).toThrow(/MISSION_NOT_OWNED/);

    // (b) Out-of-sequence: trying to scan stop 2 before stop 1 is done
    expect(() => {
      scanBin(db, stopRef2, 'BIN-A01-2', picker1);
    }).toThrow(/SCAN_OUT_OF_SEQUENCE/);

    // (c) Wrong bin barcode
    expect(() => {
      scanBin(db, stopRef1, 'BIN-WRONG-99', picker1);
    }).toThrow(/SCAN_WRONG_BIN/);

    // Verify scan rejection was logged in order_events
    const event1 = db.prepare("SELECT * FROM order_events WHERE event = 'scan.rejected'").get();
    expect(event1).toBeDefined();

    // 3. Step 1: Scan Bin successfully
    const binOkRes = scanBin(db, stopRef1, 'BIN-A01-1', picker1);
    expect(binOkRes.ok).toBe(true);
    expect(binOkRes.step).toBe('SCAN_ITEM');
    expect(binOkRes.mission.status).toBe('IN_PROGRESS');

    // Order transitioned to PICKING
    const orderAfterBin = db.prepare('SELECT status FROM orders WHERE ref = ?').get('ORD-1001') as any;
    expect(orderAfterBin.status).toBe('PICKING');

    // 4. Step 2: Scan Item guards and success
    // (a) Wrong item SKU
    expect(() => {
      scanItem(db, stopRef1, 'SKU-WRONG-ITEM', 2, picker1);
    }).toThrow(/SCAN_WRONG_ITEM/);

    // (b) Exceeds quantity
    expect(() => {
      scanItem(db, stopRef1, 'SKU-TEST-001', 5, picker1);
    }).toThrow(/SCAN_QTY_EXCEEDS/);

    // (c) Success item scan
    const itemOkRes = scanItem(db, stopRef1, 'SKU-TEST-001', 2, picker1);
    expect(itemOkRes.ok).toBe(true);
    expect(itemOkRes.step).toBe('SCAN_TOTE');

    // 5. Step 3: Scan Tote guards and success
    // (a) Tote in use guard
    db.prepare("UPDATE totes SET status = 'IN_USE' WHERE tote_code = 'TOTE-001'").run();
    expect(() => {
      scanTote(db, stopRef1, 'TOTE-001', picker1);
    }).toThrow(/TOTE_IN_USE/);

    // (b) Successful tote scan with free tote TOTE-002
    const toteOkRes = scanTote(db, stopRef1, 'TOTE-002', picker1);
    expect(toteOkRes.ok).toBe(true);
    expect(toteOkRes.mission.toteCode).toBe('TOTE-002');
    expect(toteOkRes.mission.doneStops).toBe(1);

    // Check ledger entry for Stop 1 pick: BIN -> TOTE
    const ledgerPick1 = db.prepare(`
      SELECT * FROM ledger_entries
      WHERE from_loc = 'BIN:BIN-A01-1' AND to_loc = 'TOTE:TOTE-002' AND entry_type = 'PICK'
    `).get() as any;
    expect(ledgerPick1).toBeDefined();
    expect(ledgerPick1.qty).toBe(2);

    // 6. Complete Stop 2
    // Scan Bin
    scanBin(db, stopRef2, 'BIN-A01-2', picker1);

    // Scan Item
    scanItem(db, stopRef2, 'SKU-TEST-001', 3, picker1);

    // Wrong tote guard: mission is assigned TOTE-002, scanning TOTE-003 fails
    expect(() => {
      scanTote(db, stopRef2, 'TOTE-003', picker1);
    }).toThrow(/SCAN_WRONG_TOTE/);

    // Scan matching Tote TOTE-002
    const finalRes = scanTote(db, stopRef2, 'TOTE-002', picker1);
    expect(finalRes.ok).toBe(true);
    expect(finalRes.mission.doneStops).toBe(2);

    // 7. Verify mission and order completion
    const finalMission = db.prepare('SELECT status, completed_at FROM missions WHERE ref = ?').get(missionRef) as any;
    expect(finalMission.status).toBe('COMPLETED');
    expect(finalMission.completed_at).toBeTruthy();

    const finalOrder = db.prepare('SELECT status FROM orders WHERE ref = ?').get('ORD-1001') as any;
    expect(finalOrder.status).toBe('PICKED');

    const finalTote = db.prepare('SELECT status FROM totes WHERE tote_code = ?').get('TOTE-002') as any;
    expect(finalTote.status).toBe('AWAITING_PACK');

    // 8. Reconcile check: verify inventory table matches location_balances exactly
    const mismatches = db.prepare(`
      WITH ledger_bins AS (
        SELECT substr(location_key, 5) AS bin_code, sku, SUM(qty) AS ledger_qty
        FROM location_balances WHERE location_key GLOB 'BIN:*'
        GROUP BY location_key, sku HAVING SUM(qty) <> 0
      ),
      inv_bins AS (
        SELECT bin_code, sku, qty AS proj_qty
        FROM inventory WHERE qty > 0 AND sku IS NOT NULL
      ),
      all_keys AS (
        SELECT bin_code, sku FROM ledger_bins UNION SELECT bin_code, sku FROM inv_bins
      )
      SELECT k.bin_code AS binCode, k.sku, COALESCE(i.proj_qty, 0) AS projectionQty, COALESCE(l.ledger_qty, 0) AS ledgerQty
      FROM all_keys k
      LEFT JOIN inv_bins i ON i.bin_code = k.bin_code AND i.sku = k.sku
      LEFT JOIN ledger_bins l ON l.bin_code = k.bin_code AND l.sku = k.sku
      WHERE COALESCE(i.proj_qty, 0) <> COALESCE(l.ledger_qty, 0)
    `).all();

    expect(mismatches).toHaveLength(0);
  });
});
