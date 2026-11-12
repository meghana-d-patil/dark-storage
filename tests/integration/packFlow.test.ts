import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { postLedger, ensureLot, reconcileLedger } from '../../services/engine3-inventory/src/ledger/postLedger.js';
import {
  openPackSession,
  scanPackItem,
  flagPackItem,
  weighPackSession,
  completePackSession,
  demoOtpStore,
} from '../../services/engine3-inventory/src/domain/packingRepo.js';
import { handoverDispatch, regenOtp } from '../../services/engine3-inventory/src/domain/dispatchRepo.js';

describe('Phase 6: Packing and Dispatch Integration Tests', () => {
  let db: Database.Database;

  const staff = { id: 5, role: 'STAFF', username: 'test-staff' };
  const dispatch = { id: 6, role: 'DISPATCH', username: 'test-dispatch' };

  beforeEach(() => {
    db = makeTestDb();
    seedMinimal(db);

    ensureLot(db, {
      lotId: 'LOT-TEST-001',
      sku: 'SKU-TEST-001',
      supplier: 'Test Supplier',
    });

    // Putaway 10 units into BIN-A01-1
    db.transaction(() => {
      postLedger(
        db,
        [
          {
            sku: 'SKU-TEST-001',
            lotId: 'LOT-TEST-001',
            qty: 10,
            from: 'EXT',
            to: 'BIN:BIN-A01-1',
            type: 'PUTAWAY',
          },
        ],
        { id: '1' }
      );
    })();
  });

  function setupPickedOrder(ref: string, qty: number, toteCode = 'TOTE-001') {
    const orderRes = db.prepare(`
      INSERT INTO orders (ref, customer_ref, status, priority, order_type, requested_by)
      VALUES (?, 'Cust-Pack', 'PICKED', 'NORMAL', 'CUSTOMER', 1)
    `).run(ref);
    const orderId = Number(orderRes.lastInsertRowid);

    db.prepare(`
      INSERT INTO order_lines (order_id, line_no, sku, qty_ordered, qty_picked)
      VALUES (?, 1, 'SKU-TEST-001', ?, ?)
    `).run(orderId, qty, qty);

    // Pick into TOTE
    db.transaction(() => {
      postLedger(
        db,
        [
          {
            sku: 'SKU-TEST-001',
            lotId: 'LOT-TEST-001',
            qty,
            from: 'BIN:BIN-A01-1',
            to: `TOTE:${toteCode}`,
            type: 'PICK',
            orderRef: ref,
          },
        ],
        { id: '4' }
      );
    })();

    // Tote is AWAITING_PACK
    db.prepare(`
      UPDATE totes
      SET status = 'AWAITING_PACK', order_ref = ?, mission_ref = 'MIS-PACK-01'
      WHERE tote_code = ?
    `).run(ref, toteCode);

    return { orderId, ref, toteCode, qty };
  }

  it('runs complete packing and dispatch happy path with ledger reconciliation', () => {
    const { ref, toteCode } = setupPickedOrder('ORD-PACK-001', 2, 'TOTE-001');

    // 1. Open pack session
    const session = openPackSession(db, {
      toteScan: toteCode,
      benchCode: 'BENCH-1',
      actor: staff,
    });
    expect(session.orderRef).toBe(ref);
    expect(session.toteCode).toBe(toteCode);
    expect(session.lines[0].expectedQty).toBe(2);
    expect(session.lines[0].scannedQty).toBe(0);
    expect(session.canComplete).toBe(false);

    // Verify order and tote moved to PACKING
    const orderInPacking = db.prepare('SELECT status FROM orders WHERE ref = ?').get(ref) as any;
    expect(orderInPacking.status).toBe('PACKING');
    const toteInPacking = db.prepare('SELECT status FROM totes WHERE tote_code = ?').get(toteCode) as any;
    expect(toteInPacking.status).toBe('PACKING');

    // 2. Scan items (2 units)
    const scan1 = scanPackItem(db, Number(session.sessionId), 'SKU-TEST-001', staff);
    expect(scan1.lines[0].scannedQty).toBe(1);
    expect(scan1.canComplete).toBe(false);

    const scan2 = scanPackItem(db, Number(session.sessionId), 'SKU-TEST-001', staff);
    expect(scan2.lines[0].scannedQty).toBe(2);

    // 3. Weigh package
    // Product weight = 100g each x 2 = 200g. Bag tare = 40g. Expected = 240g.
    const weighRes = weighPackSession(db, Number(session.sessionId), 245);
    expect(weighRes.ok).toBe(true);
    expect(weighRes.weight_ok).toBe(true);

    // 4. Complete pack session into slot D-1
    const completeRes = completePackSession(db, Number(session.sessionId), 'D-1', staff);
    expect(completeRes.ok).toBe(true);
    expect(completeRes.status).toBe('PACKED');
    expect(completeRes.slot).toBe('D-1');

    // Verify tote is freed
    const freedTote = db.prepare('SELECT status, order_ref FROM totes WHERE tote_code = ?').get(toteCode) as any;
    expect(freedTote.status).toBe('FREE');
    expect(freedTote.order_ref).toBeNull();

    // Verify slot is occupied
    const slotD1 = db.prepare('SELECT status, order_ref FROM dispatch_slots WHERE slot_code = ?').get('D-1') as any;
    expect(slotD1.status).toBe('OCCUPIED');
    expect(slotD1.order_ref).toBe(ref);

    // Verify dispatch handover record created
    const handover = db.prepare('SELECT * FROM dispatch_handovers WHERE order_ref = ?').get(ref) as any;
    expect(handover).toBeDefined();
    expect(handover.slot_code).toBe('D-1');

    // 5. Complete dispatch handover using stored demo OTP
    const plainOtp = demoOtpStore.get(ref)!;
    expect(plainOtp).toBeDefined();

    const dispatchRes = handoverDispatch(db, ref, { slotScan: 'D-1', otp: plainOtp, riderName: 'Rider Dave' }, dispatch);
    expect(dispatchRes.ok).toBe(true);
    expect(dispatchRes.status).toBe('DISPATCHED');

    // Verify order is DISPATCHED
    const finalOrder = db.prepare('SELECT status, dispatched_at FROM orders WHERE ref = ?').get(ref) as any;
    expect(finalOrder.status).toBe('DISPATCHED');
    expect(finalOrder.dispatched_at).toBeDefined();

    // Verify slot is freed
    const finalSlot = db.prepare('SELECT status, order_ref FROM dispatch_slots WHERE slot_code = ?').get('D-1') as any;
    expect(finalSlot.status).toBe('FREE');
    expect(finalSlot.order_ref).toBeNull();

    // Verify ledger movements: PUTAWAY, PICK, PACK, STAGE_DISPATCH, HANDOVER
    const entries = db.prepare('SELECT entry_type, qty, from_loc, to_loc FROM ledger_entries WHERE order_ref = ?').all(ref) as any[];
    const types = entries.map((e) => e.entry_type);
    expect(types).toContain('PICK');
    expect(types).toContain('PACK');
    expect(types).toContain('STAGE_DISPATCH');
    expect(types).toContain('HANDOVER');

    // Verify SHIPPED balance equals ordered quantity (2)
    const shippedBal = db.prepare("SELECT qty FROM location_balances WHERE location_key = 'SHIPPED' AND sku = 'SKU-TEST-001'").get() as any;
    expect(shippedBal.qty).toBe(2);

    // Reconcile check
    const rec = reconcileLedger(db);
    expect(rec.ok).toBe(true);
    expect(rec.drift_count).toBe(0);
  });

  it('negative cases: non-picked order, wrong item, overscan, weight mismatch, slot mismatch, OTP lockout', () => {
    // 1. Open pack on non-picked order
    const orderRes = db.prepare(`
      INSERT INTO orders (ref, customer_ref, status, priority, order_type, requested_by)
      VALUES ('ORD-UNPICKED', 'Cust', 'ASSIGNED', 'NORMAL', 'CUSTOMER', 1)
    `).run();
    db.prepare(`
      UPDATE totes SET status = 'AWAITING_PACK', order_ref = 'ORD-UNPICKED' WHERE tote_code = 'TOTE-002'
    `).run();

    expect(() => {
      openPackSession(db, { toteScan: 'TOTE-002', actor: staff });
    }).toThrowError(/ORDER_NOT_PICKED/);

    // 2. Setup valid order
    setupPickedOrder('ORD-NEG-01', 1, 'TOTE-003');
    const session = openPackSession(db, { toteScan: 'TOTE-003', actor: staff });
    const sId = Number(session.sessionId);

    // 3. Scan wrong item
    expect(() => {
      scanPackItem(db, sId, 'UNKNOWN-ITEM-BARCODE', staff);
    }).toThrowError(/PACK_ITEM_NOT_IN_ORDER/);

    // 4. Scan correct item
    scanPackItem(db, sId, 'SKU-TEST-001', staff);

    // 5. Overscan item
    expect(() => {
      scanPackItem(db, sId, 'SKU-TEST-001', staff);
    }).toThrowError(/PACK_ITEM_OVERSCAN/);

    // 6. Complete before weigh
    expect(() => {
      completePackSession(db, sId, 'D-2', staff);
    }).toThrowError(/WEIGHT_MISMATCH/);

    // 7. Weight mismatch
    expect(() => {
      weighPackSession(db, sId, 9999);
    }).toThrowError(/WEIGHT_MISMATCH/);

    // Pass weigh (100g product + 40g tare = 140g)
    weighPackSession(db, sId, 140);

    // 8. Slot mismatch (non-existent slot)
    expect(() => {
      completePackSession(db, sId, 'INVALID-SLOT', staff);
    }).toThrowError(/SLOT_MISMATCH/);

    // Complete packing into D-2
    completePackSession(db, sId, 'D-2', staff);

    // 9. Handover wrong slot
    expect(() => {
      handoverDispatch(db, 'ORD-NEG-01', { slotScan: 'D-8', otp: '1234' }, dispatch);
    }).toThrowError(/SLOT_MISMATCH/);

    // 10. Wrong OTP 3 times locks handover
    expect(() => {
      handoverDispatch(db, 'ORD-NEG-01', { slotScan: 'D-2', otp: '0000' }, dispatch);
    }).toThrowError(/OTP_INVALID/);

    expect(() => {
      handoverDispatch(db, 'ORD-NEG-01', { slotScan: 'D-2', otp: '0000' }, dispatch);
    }).toThrowError(/OTP_INVALID/);

    expect(() => {
      handoverDispatch(db, 'ORD-NEG-01', { slotScan: 'D-2', otp: '0000' }, dispatch);
    }).toThrowError(/OTP_LOCKED/);

    // Once locked, subsequent calls fail with OTP_LOCKED
    expect(() => {
      handoverDispatch(db, 'ORD-NEG-01', { slotScan: 'D-2', otp: '0000' }, dispatch);
    }).toThrowError(/OTP_LOCKED/);

    // Manager regenerates OTP
    const mgr = { id: 2, role: 'MANAGER', username: 'test-manager' };
    regenOtp(db, 'ORD-NEG-01', 'CUSTOMER_REQUEST', mgr);

    // Unlocked and new OTP works
    const newOtp = demoOtpStore.get('ORD-NEG-01')!;
    const handRes = handoverDispatch(db, 'ORD-NEG-01', { slotScan: 'D-2', otp: newOtp }, dispatch);
    expect(handRes.ok).toBe(true);
    expect(handRes.status).toBe('DISPATCHED');
  });

  it('partial fulfillment path: flagging missing item generates REPICK task and records PARTIAL packing record', () => {
    setupPickedOrder('ORD-PARTIAL-01', 2, 'TOTE-004');
    const session = openPackSession(db, { toteScan: 'TOTE-004', actor: staff });
    const sId = Number(session.sessionId);

    // Scan 1 item
    scanPackItem(db, sId, 'SKU-TEST-001', staff);

    // Flag 1 item as MISSING
    const flagged = flagPackItem(db, sId, { sku: 'SKU-TEST-001', qty: 1, kind: 'MISSING', note: 'Not found in tote' }, staff);
    expect(flagged.lines[0].scannedQty).toBe(1);
    expect(flagged.lines[0].flaggedQty).toBe(1);

    // Verify REPICK floor task was created
    const repickTask = db.prepare("SELECT * FROM floor_tasks WHERE type = 'REPICK' AND order_ref = 'ORD-PARTIAL-01'").get() as any;
    expect(repickTask).toBeDefined();
    expect(repickTask.sku).toBe('SKU-TEST-001');
    expect(repickTask.qty).toBe(1);

    // Weigh 1 item: 100g + 40g = 140g
    weighPackSession(db, sId, 140);

    // Complete pack into D-3
    const completeRes = completePackSession(db, sId, 'D-3', staff);
    expect(completeRes.ok).toBe(true);
    expect(completeRes.status).toBe('PACKED');

    // Verify packing_records has fulfilment_type = 'PARTIAL'
    const record = db.prepare("SELECT fulfilment_type, total_ordered, total_picked FROM packing_records WHERE order_id = (SELECT id FROM orders WHERE ref = 'ORD-PARTIAL-01')").get() as any;
    expect(record.fulfilment_type).toBe('PARTIAL');
    expect(record.total_ordered).toBe(2);
    expect(record.total_picked).toBe(1);
  });
});
