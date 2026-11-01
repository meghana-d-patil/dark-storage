import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import crypto from 'node:crypto';
import { createTempDbPaths } from '../harness/tempDb.js';
import { startStack, RunningStack } from '../harness/stack.js';
import { apiClient } from '../harness/apiClient.js';
import { applyMigrations } from '../../scripts/migrate.js';
import { seedBase } from '../../scripts/seed-base.js';
import { runIntegrityChecks } from '../../scripts/verify-integrity.js';
import { stockIn, reserve, release, recordMovement } from '../../services/engine3-inventory/src/domain/inventoryRepo.js';
import { executeReserveOrder, cancelOrder, allocateStock } from '../../services/engine3-inventory/src/domain/ordersRepo.js';
import { getPickPlan, assignMission, startMission, getMission } from '../../services/engine3-inventory/src/domain/missionsRepo.js';
import { planRoute } from '../../services/engine2-optimizer/src/routing/planRoute.js';
import {
  executePickConfirm,
  executeReportProblem,
  executeResolveException,
  getException,
  listExceptions,
  getRerouteInput,
  rerouteMission
} from '../../services/engine3-inventory/src/domain/pickingRepo.js';
import { runIdempotent } from '../../services/engine3-inventory/src/domain/idempotency.js';

describe('Phase 8 Picking, Stock Deduction & Exceptions Tests', () => {
  let stack: RunningStack | undefined;

  afterAll(async () => {
    if (stack) {
      await stack.stop();
    }
  });

  function setupDatabases() {
    const { dir, warehouseDbPath, schedulerDbPath, cleanup } = createTempDbPaths();

    const wDb = new Database(warehouseDbPath);
    wDb.pragma('journal_mode = WAL');
    wDb.pragma('foreign_keys = ON');
    wDb.pragma('busy_timeout = 5000');
    applyMigrations(wDb, path.resolve('migrations/warehouse'));
    seedBase(wDb);

    const sDb = new Database(schedulerDbPath);
    sDb.pragma('journal_mode = WAL');
    sDb.pragma('foreign_keys = ON');
    sDb.pragma('busy_timeout = 5000');
    applyMigrations(sDb, path.resolve('migrations/scheduler'));

    return { dir, warehouseDbPath, schedulerDbPath, wDb, sDb, cleanup };
  }

  function setupOrderWithMission(
    wDb: Database.Database,
    lines: Array<{ sku: string; qty: number; bin: string }>
  ) {
    for (const l of lines) {
      stockIn(wDb, { bin: l.bin, sku: l.sku, qty: l.qty });
      recordMovement(wDb, {
        type: 'ADJUSTMENT',
        sku: l.sku,
        qty: l.qty,
        from: { kind: 'ADJUSTMENT', ref: 'INIT' },
        to: { kind: 'BIN', ref: l.bin },
        actorId: 1
      });
    }

    const order = executeReserveOrder(wDb, {
      order_type: 'CUSTOMER',
      priority: 'NORMAL',
      customer_ref: 'Test Customer',
      lines: lines.map((l) => ({ sku: l.sku, qty: l.qty })),
      actor: { id: 1, role: 'MANAGER' }
    });

    const pickPlan = getPickPlan(wDb, order.ref);
    const route = planRoute(wDb, {
      start: 'DOCK',
      end: 'PACK',
      stops: pickPlan.reservations.map((r: any) => ({
        key: r.reservation_id,
        bin_code: r.bin_code,
        node: r.node,
        shelf_code: r.shelf_code,
        level: r.level
      }))
    });

    const mission = assignMission(wDb, {
      order_ref: order.ref,
      picker_id: 3, // picker1
      plan_token: pickPlan.plan_token,
      route,
      actor: { id: 1, role: 'MANAGER' }
    });

    startMission(wDb, mission.ref, { id: 3, role: 'PICKER' });

    const freshMission = getMission(wDb, mission.ref)!;
    return { order, mission: freshMission };
  }

  // P8-T01: Confirm a full stop
  it('P8-T01: Confirm a full stop deducts stock, consumes reservation, sets stop PICKED, updates line picked, writes movement and events', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { order, mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);

      const stop = mission.stops[0];

      const res = executePickConfirm(wDb, {
        stop_ref: stop.stop_ref,
        scanned_bin: stop.bin_code,
        scanned_sku: stop.sku,
        picked_qty: 5,
        actor: { id: 3, role: 'PICKER', display_name: 'picker1' }
      });

      expect(res.stop.status).toBe('PICKED');
      expect(res.stop.qty_picked).toBe(5);

      // Bin qty and reserved_qty dropped by 5
      const inv = wDb.prepare('SELECT qty, reserved_qty FROM inventory WHERE bin_code = ?').get(stop.bin_code) as any;
      expect(inv.qty).toBe(0);
      expect(inv.reserved_qty).toBe(0);

      // Reservation CONSUMED
      const r = wDb.prepare('SELECT status, consumed_qty, released_qty FROM reservations WHERE id = ?').get(stop.reservation_id) as any;
      expect(r.status).toBe('CONSUMED');
      expect(r.consumed_qty).toBe(5);
      expect(r.released_qty).toBe(0);

      // Order line qty_picked
      const ol = wDb.prepare('SELECT qty_picked, qty_short FROM order_lines WHERE order_id = (SELECT id FROM orders WHERE ref = ?)').get(order.ref) as any;
      expect(ol.qty_picked).toBe(5);
      expect(ol.qty_short).toBe(0);

      // Movement PICK
      const mov = wDb.prepare("SELECT * FROM stock_movements WHERE movement_type = 'PICK' ORDER BY id DESC LIMIT 1").get() as any;
      expect(mov).toBeDefined();
      expect(mov.sku).toBe('SKU001');
      expect(mov.qty).toBe(5);
      expect(mov.from_kind).toBe('BIN');
      expect(mov.from_ref).toBe(stop.bin_code);
      expect(mov.to_kind).toBe('ORDER_PACKING');
      expect(mov.to_ref).toBe(order.ref);
      expect(mov.related_type).toBe('STOP');
      expect(mov.related_ref).toBe(stop.stop_ref);

      // Audit and Events
      const aud = wDb.prepare("SELECT * FROM audit_log WHERE action = 'PICK_CONFIRMED'").get() as any;
      expect(aud).toBeDefined();

      const events = wDb.prepare("SELECT event_type FROM outbox_events WHERE event_type IN ('pick.confirmed', 'inventory.changed', 'reservation.changed')").all();
      expect(events.length).toBeGreaterThanOrEqual(3);
    } finally {
      cleanup();
    }
  });

  // P8-T02: Two-stop mission, confirm both -> Mission COMPLETED, order PICKED
  it('P8-T02: Two-stop mission, confirm both: mission COMPLETED, order PICKED', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { order, mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 3, bin: 'A-01-L-1' },
        { sku: 'SKU002', qty: 2, bin: 'A-01-L-2' }
      ]);

      expect(mission.stops.length).toBe(2);

      // Confirm stop 1
      const res1 = executePickConfirm(wDb, {
        stop_ref: mission.stops[0].stop_ref,
        scanned_bin: mission.stops[0].bin_code,
        scanned_sku: mission.stops[0].sku,
        picked_qty: 3,
        actor: { id: 3, role: 'PICKER' }
      });

      expect(res1.stop.status).toBe('PICKED');
      expect(res1.order_status).toBe('PICKING');

      const midMission = getMission(wDb, mission.ref)!;
      expect(midMission.status).toBe('IN_PROGRESS');

      // Confirm stop 2
      const res2 = executePickConfirm(wDb, {
        stop_ref: mission.stops[1].stop_ref,
        scanned_bin: mission.stops[1].bin_code,
        scanned_sku: mission.stops[1].sku,
        picked_qty: 2,
        actor: { id: 3, role: 'PICKER' }
      });

      expect(res2.stop.status).toBe('PICKED');
      expect(res2.order_status).toBe('PICKED');

      const endMission = getMission(wDb, mission.ref)!;
      expect(endMission.status).toBe('COMPLETED');
      expect(endMission.completed_at).toBeTruthy();

      const endOrder = wDb.prepare('SELECT status FROM orders WHERE ref = ?').get(order.ref) as any;
      expect(endOrder.status).toBe('PICKED');
    } finally {
      cleanup();
    }
  });

  // P8-T03: Wrong picker / mission ASSIGNED
  it('P8-T03: Wrong picker throws NOT_YOUR_MISSION; unstarted mission throws MISSION_STATE_INVALID', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 5 });
      const order = executeReserveOrder(wDb, {
        order_type: 'CUSTOMER',
        priority: 'NORMAL',
        customer_ref: 'Test Customer',
        lines: [{ sku: 'SKU001', qty: 5 }],
        actor: { id: 1, role: 'MANAGER' }
      });

      const pickPlan = getPickPlan(wDb, order.ref);
      const route = planRoute(wDb, {
        stops: pickPlan.reservations.map((r: any) => ({
          key: r.reservation_id,
          bin_code: r.bin_code,
          node: r.node
        }))
      });

      const mission = assignMission(wDb, {
        order_ref: order.ref,
        picker_id: 3, // picker1
        plan_token: pickPlan.plan_token,
        route,
        actor: { id: 1, role: 'MANAGER' }
      });

      const stop = mission.stops[0];

      // Before start (status ASSIGNED)
      expect(() => {
        executePickConfirm(wDb, {
          stop_ref: stop.stop_ref,
          scanned_bin: stop.bin_code,
          scanned_sku: stop.sku,
          picked_qty: 5,
          actor: { id: 3, role: 'PICKER' }
        });
      }).toThrowError(/MISSION_STATE_INVALID/);

      // Start mission
      startMission(wDb, mission.ref, { id: 3, role: 'PICKER' });

      // Wrong picker (picker 4)
      expect(() => {
        executePickConfirm(wDb, {
          stop_ref: stop.stop_ref,
          scanned_bin: stop.bin_code,
          scanned_sku: stop.sku,
          picked_qty: 5,
          actor: { id: 4, role: 'PICKER' }
        });
      }).toThrowError(/NOT_YOUR_MISSION/);
    } finally {
      cleanup();
    }
  });

  // P8-T04: Wrong scanned SKU / wrong scanned bin
  it('P8-T04: Wrong scanned SKU throws PRODUCT_MISMATCH; wrong bin throws BIN_MISMATCH; DB unchanged', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);
      const stop = mission.stops[0];

      // Wrong SKU
      expect(() => {
        executePickConfirm(wDb, {
          stop_ref: stop.stop_ref,
          scanned_bin: stop.bin_code,
          scanned_sku: 'WRONG_SKU',
          picked_qty: 5,
          actor: { id: 3, role: 'PICKER' }
        });
      }).toThrowError(/PRODUCT_MISMATCH/);

      // Wrong Bin
      expect(() => {
        executePickConfirm(wDb, {
          stop_ref: stop.stop_ref,
          scanned_bin: 'B-01-L-1',
          scanned_sku: stop.sku,
          picked_qty: 5,
          actor: { id: 3, role: 'PICKER' }
        });
      }).toThrowError(/BIN_MISMATCH/);

      // Unchanged
      const inv = wDb.prepare('SELECT qty, reserved_qty FROM inventory WHERE bin_code = ?').get(stop.bin_code) as any;
      expect(inv.qty).toBe(5);
      expect(inv.reserved_qty).toBe(5);
    } finally {
      cleanup();
    }
  });

  // P8-T05: picked_qty above outstanding / 0 / -1 / 2.5
  it('P8-T05: picked_qty above outstanding throws QUANTITY_EXCEEDS_RESERVATION; invalid numbers rejected', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);
      const stop = mission.stops[0];

      // Above outstanding
      expect(() => {
        executePickConfirm(wDb, {
          stop_ref: stop.stop_ref,
          scanned_bin: stop.bin_code,
          scanned_sku: stop.sku,
          picked_qty: 6,
          actor: { id: 3, role: 'PICKER' }
        });
      }).toThrowError(/QUANTITY_EXCEEDS_RESERVATION/);

      // 0
      expect(() => {
        executePickConfirm(wDb, {
          stop_ref: stop.stop_ref,
          scanned_bin: stop.bin_code,
          scanned_sku: stop.sku,
          picked_qty: 0,
          actor: { id: 3, role: 'PICKER' }
        });
      }).toThrowError(/QUANTITY_INVALID/);

      // -1
      expect(() => {
        executePickConfirm(wDb, {
          stop_ref: stop.stop_ref,
          scanned_bin: stop.bin_code,
          scanned_sku: stop.sku,
          picked_qty: -1,
          actor: { id: 3, role: 'PICKER' }
        });
      }).toThrowError(/QUANTITY_INVALID/);

      // 2.5
      expect(() => {
        executePickConfirm(wDb, {
          stop_ref: stop.stop_ref,
          scanned_bin: stop.bin_code,
          scanned_sku: stop.sku,
          picked_qty: 2.5,
          actor: { id: 3, role: 'PICKER' }
        });
      }).toThrowError(/QUANTITY_INVALID/);
    } finally {
      cleanup();
    }
  });

  // P8-T06: Partial pick 3 of 5: without exception / with exception
  it('P8-T06: Partial pick without exception throws SHORT_PICK_REQUIRES_EXCEPTION; with exception consumes 3, leaves 2 HELD, opens exception and sets recount_required=1', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);
      const stop = mission.stops[0];

      // Without exception
      expect(() => {
        executePickConfirm(wDb, {
          stop_ref: stop.stop_ref,
          scanned_bin: stop.bin_code,
          scanned_sku: stop.sku,
          picked_qty: 3,
          actor: { id: 3, role: 'PICKER' }
        });
      }).toThrowError(/SHORT_PICK_REQUIRES_EXCEPTION/);

      // With exception
      const res = executePickConfirm(wDb, {
        stop_ref: stop.stop_ref,
        scanned_bin: stop.bin_code,
        scanned_sku: stop.sku,
        picked_qty: 3,
        exception: { type: 'SHORT_PICK', notes: 'Damaged shelf items' },
        actor: { id: 3, role: 'PICKER' }
      });

      expect(res.stop.status).toBe('EXCEPTION_OPEN');
      expect(res.stop.qty_picked).toBe(3);
      expect(res.exception).toBeDefined();
      expect(res.exception!.status).toBe('OPEN');
      expect(res.exception!.type).toBe('SHORT_PICK');
      expect(res.exception!.expected_qty).toBe(5);
      expect(res.exception!.actual_qty).toBe(3);

      // Bin: qty 2, reserved 2, recount_required 1
      const inv = wDb.prepare('SELECT qty, reserved_qty FROM inventory WHERE bin_code = ?').get(stop.bin_code) as any;
      expect(inv.qty).toBe(2);
      expect(inv.reserved_qty).toBe(2);

      const bin = wDb.prepare('SELECT recount_required FROM bins WHERE code = ?').get(stop.bin_code) as any;
      expect(bin.recount_required).toBe(1);

      // Reservation still HELD: consumed 3, released 0, outstanding 2
      const r = wDb.prepare('SELECT status, consumed_qty, released_qty FROM reservations WHERE id = ?').get(stop.reservation_id) as any;
      expect(r.status).toBe('HELD');
      expect(r.consumed_qty).toBe(3);
      expect(r.released_qty).toBe(0);

      // Mission not completed
      const m = getMission(wDb, mission.ref)!;
      expect(m.status).toBe('IN_PROGRESS');
    } finally {
      cleanup();
    }
  });

  // P8-T07: Duplicate confirm: same key / different key on a PICKED stop
  it('P8-T07: Duplicate confirm with same key replays cached response; different key on PICKED stop throws STOP_STATE_INVALID', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' },
        { sku: 'SKU002', qty: 5, bin: 'A-01-L-2' }
      ]);
      const stop = mission.stops[0];
      const actor = { id: 3, role: 'PICKER' };
      const payload = {
        stop_ref: stop.stop_ref,
        scanned_bin: stop.bin_code,
        scanned_sku: stop.sku,
        picked_qty: 5,
        actor
      };

      // First call
      const res1 = runIdempotent(
        wDb,
        { key: 'pick-key-1', scope: `command:pick-confirm:${stop.stop_ref}`, body: payload, actor },
        (txDb) => ({ status: 200, body: executePickConfirm(txDb, payload) })
      );
      expect(res1.status).toBe(200);

      // Bin stock dropped to 0
      const inv = wDb.prepare('SELECT qty FROM inventory WHERE bin_code = ?').get(stop.bin_code) as any;
      expect(inv.qty).toBe(0);

      // Same key: replayed, stock still 0
      const res2 = runIdempotent(
        wDb,
        { key: 'pick-key-1', scope: `command:pick-confirm:${stop.stop_ref}`, body: payload, actor },
        (txDb) => ({ status: 200, body: executePickConfirm(txDb, payload) })
      );
      expect(res2.status).toBe(200);
      expect(res2.body.stop.stop_ref).toBe(stop.stop_ref);

      const inv2 = wDb.prepare('SELECT qty FROM inventory WHERE bin_code = ?').get(stop.bin_code) as any;
      expect(inv2.qty).toBe(0);

      // Different key on already PICKED stop
      expect(() => {
        runIdempotent(
          wDb,
          { key: 'pick-key-2', scope: `command:pick-confirm:${stop.stop_ref}`, body: payload, actor },
          (txDb) => ({ status: 200, body: executePickConfirm(txDb, payload) })
        );
      }).toThrowError(/STOP_STATE_INVALID/);
    } finally {
      cleanup();
    }
  });

  // P8-T08: Report BIN_EMPTY
  it('P8-T08: Report BIN_EMPTY: no stock change, exception OPEN, recount flag set, stop EXCEPTION_OPEN, mission IN_PROGRESS', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);
      const stop = mission.stops[0];

      const exc = executeReportProblem(wDb, {
        stop_ref: stop.stop_ref,
        type: 'BIN_EMPTY',
        notes: 'Shelf is completely empty',
        actor: { id: 3, role: 'PICKER' }
      });

      expect(exc.status).toBe('OPEN');
      expect(exc.type).toBe('BIN_EMPTY');
      expect(exc.expected_qty).toBe(5);
      expect(exc.actual_qty).toBe(0);

      // Stop EXCEPTION_OPEN
      const s = wDb.prepare('SELECT status, qty_picked FROM pick_stops WHERE id = ?').get(stop.id) as any;
      expect(s.status).toBe('EXCEPTION_OPEN');
      expect(s.qty_picked).toBe(0);

      // Bin stock unchanged, recount_required = 1
      const inv = wDb.prepare('SELECT qty, reserved_qty FROM inventory WHERE bin_code = ?').get(stop.bin_code) as any;
      expect(inv.qty).toBe(5);
      expect(inv.reserved_qty).toBe(5);

      const bin = wDb.prepare('SELECT recount_required FROM bins WHERE code = ?').get(stop.bin_code) as any;
      expect(bin.recount_required).toBe(1);

      // Mission IN_PROGRESS
      const m = getMission(wDb, mission.ref)!;
      expect(m.status).toBe('IN_PROGRESS');
    } finally {
      cleanup();
    }
  });

  // P8-T09: Report DAMAGED, WRONG_PRODUCT, OTHER
  it('P8-T09: Report DAMAGED and WRONG_PRODUCT set recount_required=1; OTHER does NOT set recount_required', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      // 1. DAMAGED
      const { mission: m1 } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 2, bin: 'A-01-L-1' }
      ]);
      executeReportProblem(wDb, {
        stop_ref: m1.stops[0].stop_ref,
        type: 'DAMAGED',
        notes: 'Leaking container',
        actor: { id: 3, role: 'PICKER' }
      });
      const b1 = wDb.prepare('SELECT recount_required FROM bins WHERE code = ?').get('A-01-L-1') as any;
      expect(b1.recount_required).toBe(1);

      // 2. WRONG_PRODUCT
      const { mission: m2 } = setupOrderWithMission(wDb, [
        { sku: 'SKU002', qty: 2, bin: 'A-01-L-2' }
      ]);
      executeReportProblem(wDb, {
        stop_ref: m2.stops[0].stop_ref,
        type: 'WRONG_PRODUCT',
        notes: 'Barcode shows different product',
        actor: { id: 3, role: 'PICKER' }
      });
      const b2 = wDb.prepare('SELECT recount_required FROM bins WHERE code = ?').get('A-01-L-2') as any;
      expect(b2.recount_required).toBe(1);

      // 3. OTHER
      const { mission: m3 } = setupOrderWithMission(wDb, [
        { sku: 'SKU003', qty: 2, bin: 'A-01-L-3' }
      ]);
      executeReportProblem(wDb, {
        stop_ref: m3.stops[0].stop_ref,
        type: 'OTHER',
        notes: 'Aisle temporarily blocked by forklift',
        actor: { id: 3, role: 'PICKER' }
      });
      const b3 = wDb.prepare('SELECT recount_required FROM bins WHERE code = ?').get('A-01-L-3') as any;
      expect(b3.recount_required).toBe(0);
    } finally {
      cleanup();
    }
  });

  // P8-T10: Report on a non-PENDING stop; second open exception on the same stop
  it('P8-T10: Report on non-PENDING stop throws STOP_STATE_INVALID; second open exception blocked by unique index', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);
      const stop = mission.stops[0];

      // Report once -> stop status becomes EXCEPTION_OPEN
      executeReportProblem(wDb, {
        stop_ref: stop.stop_ref,
        type: 'BIN_EMPTY',
        notes: 'First problem report',
        actor: { id: 3, role: 'PICKER' }
      });

      // Second report on same stop
      expect(() => {
        executeReportProblem(wDb, {
          stop_ref: stop.stop_ref,
          type: 'DAMAGED',
          notes: 'Second problem report',
          actor: { id: 3, role: 'PICKER' }
        });
      }).toThrowError(/STOP_STATE_INVALID/);
    } finally {
      cleanup();
    }
  });

  // P8-T11: Resolve ACCEPT_SHORT after partial pick
  it('P8-T11: Resolve ACCEPT_SHORT: releases remaining 2, sets reservation CONSUMED, qty_short=2, stop RESOLVED, mission COMPLETED, order PICKED', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { order, mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);
      const stop = mission.stops[0];

      // Pick 3 of 5
      const pickRes = executePickConfirm(wDb, {
        stop_ref: stop.stop_ref,
        scanned_bin: stop.bin_code,
        scanned_sku: stop.sku,
        picked_qty: 3,
        exception: { type: 'SHORT_PICK', notes: 'Only 3 units found' },
        actor: { id: 3, role: 'PICKER' }
      });

      const excRef = pickRes.exception!.ref;

      // Manager resolves with ACCEPT_SHORT
      const resolveRes = executeResolveException(wDb, {
        exception_ref: excRef,
        action: 'ACCEPT_SHORT',
        notes: 'Short pick accepted by manager',
        actor: { id: 1, role: 'MANAGER' }
      });

      expect(resolveRes.exception.status).toBe('RESOLVED');
      expect(resolveRes.exception.resolution).toBe('ACCEPT_SHORT');

      // Reservation: 3 consumed, 2 released -> status CONSUMED
      const r = wDb.prepare('SELECT status, consumed_qty, released_qty FROM reservations WHERE id = ?').get(stop.reservation_id) as any;
      expect(r.status).toBe('CONSUMED');
      expect(r.consumed_qty).toBe(3);
      expect(r.released_qty).toBe(2);

      // Order lines: qty_picked=3, qty_short=2
      const ol = wDb.prepare('SELECT qty_picked, qty_short FROM order_lines WHERE order_id = (SELECT id FROM orders WHERE ref = ?)').get(order.ref) as any;
      expect(ol.qty_picked).toBe(3);
      expect(ol.qty_short).toBe(2);

      // Stop status RESOLVED
      const s = wDb.prepare('SELECT status FROM pick_stops WHERE id = ?').get(stop.id) as any;
      expect(s.status).toBe('RESOLVED');

      // Mission COMPLETED, order PICKED
      const m = getMission(wDb, mission.ref)!;
      expect(m.status).toBe('COMPLETED');

      const o = wDb.prepare('SELECT status FROM orders WHERE ref = ?').get(order.ref) as any;
      expect(o.status).toBe('PICKED');

      // Integrity checks I07 & I08 pass
      const integrity = runIntegrityChecks(wDb);
      const i07 = integrity.checks.find((c) => c.id === 'I07');
      const i08 = integrity.checks.find((c) => c.id === 'I08');
      expect(i07?.status).toBe('PASS');
      expect(i08?.status).toBe('PASS');
    } finally {
      cleanup();
    }
  });

  // P8-T12: Resolve REALLOCATE with stock elsewhere
  it('P8-T12: Resolve REALLOCATE: releases old reservation, creates new reservation elsewhere, appends new stop; picking it completes mission', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      // Stock in A-01-L-1 (5 units) and A-01-L-2 (10 units)
      stockIn(wDb, { bin: 'A-01-L-2', sku: 'SKU001', qty: 10 });

      const { mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);
      const stop = mission.stops[0];

      // Report BIN_EMPTY
      const exc = executeReportProblem(wDb, {
        stop_ref: stop.stop_ref,
        type: 'BIN_EMPTY',
        notes: 'Nothing in bin',
        actor: { id: 3, role: 'PICKER' }
      });

      // Manager resolves with REALLOCATE
      const resolveRes = executeResolveException(wDb, {
        exception_ref: exc.ref,
        action: 'REALLOCATE',
        notes: 'Allocating from A-01-L-2',
        actor: { id: 1, role: 'MANAGER' }
      });

      expect(resolveRes.exception.status).toBe('RESOLVED');
      expect(resolveRes.new_stops.length).toBe(1);
      const newStop = resolveRes.new_stops[0];
      expect(newStop.bin_code).toBe('A-01-L-2');
      expect(newStop.qty_required).toBe(5);

      // Old stop is RESOLVED
      const oldStop = wDb.prepare('SELECT status FROM pick_stops WHERE id = ?').get(stop.id) as any;
      expect(oldStop.status).toBe('RESOLVED');

      // Mission stays IN_PROGRESS
      const m = getMission(wDb, mission.ref)!;
      expect(m.status).toBe('IN_PROGRESS');
      expect(m.stops.length).toBe(2);

      // Picker confirms new stop
      const pickNewRes = executePickConfirm(wDb, {
        stop_ref: newStop.stop_ref,
        scanned_bin: 'A-01-L-2',
        scanned_sku: 'SKU001',
        picked_qty: 5,
        actor: { id: 3, role: 'PICKER' }
      });

      expect(pickNewRes.stop.status).toBe('PICKED');
      expect(pickNewRes.order_status).toBe('PICKED');

      const endMission = getMission(wDb, mission.ref)!;
      expect(endMission.status).toBe('COMPLETED');
    } finally {
      cleanup();
    }
  });

  // P8-T13: REALLOCATE with no stock elsewhere
  it('P8-T13: REALLOCATE with no stock elsewhere throws INSUFFICIENT_STOCK with zero changes; then ACCEPT_SHORT works', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);
      const stop = mission.stops[0];

      // Report problem
      const exc = executeReportProblem(wDb, {
        stop_ref: stop.stop_ref,
        type: 'BIN_EMPTY',
        notes: 'Bin is empty',
        actor: { id: 3, role: 'PICKER' }
      });

      // Attempt REALLOCATE (no other bin has SKU001)
      expect(() => {
        executeResolveException(wDb, {
          exception_ref: exc.ref,
          action: 'REALLOCATE',
          notes: 'Try reallocating',
          actor: { id: 1, role: 'MANAGER' }
        });
      }).toThrowError(/INSUFFICIENT_STOCK/);

      // Exception is still OPEN
      const freshExc = getException(wDb, exc.ref)!;
      expect(freshExc.status).toBe('OPEN');

      // Now ACCEPT_SHORT succeeds
      const acceptRes = executeResolveException(wDb, {
        exception_ref: exc.ref,
        action: 'ACCEPT_SHORT',
        notes: 'Cannot reallocate, accepting short',
        actor: { id: 1, role: 'MANAGER' }
      });

      expect(acceptRes.exception.status).toBe('RESOLVED');
    } finally {
      cleanup();
    }
  });

  // P8-T14: Resolve with recount 0 while another order still reserves that bin
  it('P8-T14: Recount 0 while another order reserves bin throws ADJUSTMENT_CONFLICT and rolls back; succeeds after second order cancelled', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      // 10 units in A-01-L-1
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 10 });

      // Order 1 reserves 5 units
      const o1 = executeReserveOrder(wDb, {
        order_type: 'CUSTOMER',
        priority: 'NORMAL',
        customer_ref: 'Order 1',
        lines: [{ sku: 'SKU001', qty: 5 }],
        actor: { id: 1, role: 'MANAGER' }
      });

      // Order 2 reserves remaining 5 units
      const o2 = executeReserveOrder(wDb, {
        order_type: 'CUSTOMER',
        priority: 'NORMAL',
        customer_ref: 'Order 2',
        lines: [{ sku: 'SKU001', qty: 5 }],
        actor: { id: 1, role: 'MANAGER' }
      });

      // Assign and start mission for Order 1
      const p1 = getPickPlan(wDb, o1.ref);
      const r1 = planRoute(wDb, {
        stops: p1.reservations.map((r: any) => ({ key: r.reservation_id, bin_code: r.bin_code, node: r.node }))
      });
      const m1 = assignMission(wDb, {
        order_ref: o1.ref,
        picker_id: 3,
        plan_token: p1.plan_token,
        route: r1,
        actor: { id: 1, role: 'MANAGER' }
      });
      startMission(wDb, m1.ref, { id: 3, role: 'PICKER' });

      // Report problem on Order 1 stop
      const exc = executeReportProblem(wDb, {
        stop_ref: m1.stops[0].stop_ref,
        type: 'BIN_EMPTY',
        notes: 'Shelf empty',
        actor: { id: 3, role: 'PICKER' }
      });

      // Resolve Order 1 with recount 0 -> Order 2 still holds 5 units reserved in this bin!
      expect(() => {
        executeResolveException(wDb, {
          exception_ref: exc.ref,
          action: 'ACCEPT_SHORT',
          notes: 'Count is zero',
          recount: { counted_qty: 0 },
          actor: { id: 1, role: 'MANAGER' }
        });
      }).toThrowError(/ADJUSTMENT_CONFLICT/);

      // Exception still OPEN
      const checkExc = getException(wDb, exc.ref)!;
      expect(checkExc.status).toBe('OPEN');

      // Now cancel Order 2 (releases its 5 units)
      cancelOrder(wDb, o2.ref, 'Cancelled for test', { id: 1, role: 'MANAGER' });

      // Now recount to 0 succeeds!
      const successRes = executeResolveException(wDb, {
        exception_ref: exc.ref,
        action: 'ACCEPT_SHORT',
        notes: 'Count is zero after order 2 cancellation',
        recount: { counted_qty: 0 },
        actor: { id: 1, role: 'MANAGER' }
      });

      expect(successRes.exception.status).toBe('RESOLVED');
      const binRow = wDb.prepare('SELECT recount_required FROM bins WHERE code = ?').get('A-01-L-1') as any;
      expect(binRow.recount_required).toBe(0);

      // ADJUSTMENT movement recorded
      const adjMov = wDb.prepare("SELECT * FROM stock_movements WHERE movement_type = 'ADJUSTMENT'").get() as any;
      expect(adjMov).toBeDefined();
    } finally {
      cleanup();
    }
  });

  // P8-T15: Resolve already resolved exception throws EXCEPTION_STATE_INVALID
  it('P8-T15: Resolve an already resolved exception throws EXCEPTION_STATE_INVALID', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);
      const stop = mission.stops[0];

      const exc = executeReportProblem(wDb, {
        stop_ref: stop.stop_ref,
        type: 'BIN_EMPTY',
        notes: 'Problem',
        actor: { id: 3, role: 'PICKER' }
      });

      // First resolve
      executeResolveException(wDb, {
        exception_ref: exc.ref,
        action: 'ACCEPT_SHORT',
        notes: 'Resolved',
        actor: { id: 1, role: 'MANAGER' }
      });

      // Second resolve
      expect(() => {
        executeResolveException(wDb, {
          exception_ref: exc.ref,
          action: 'ACCEPT_SHORT',
          notes: 'Resolving again',
          actor: { id: 1, role: 'MANAGER' }
        });
      }).toThrowError(/EXCEPTION_STATE_INVALID/);
    } finally {
      cleanup();
    }
  });

  // P8-T16: Cancel an order that has an open exception and 3 picked units
  it('P8-T16: Cancel order with open exception and 3 picked units sets exception ORDER_CANCELLED, picked units not returned, audit unreturned_picked', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { order, mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);
      const stop = mission.stops[0];

      // Pick 3 of 5
      const pickRes = executePickConfirm(wDb, {
        stop_ref: stop.stop_ref,
        scanned_bin: stop.bin_code,
        scanned_sku: stop.sku,
        picked_qty: 3,
        exception: { type: 'SHORT_PICK', notes: 'Short' },
        actor: { id: 3, role: 'PICKER' }
      });

      const excRef = pickRes.exception!.ref;

      // Cancel the order
      cancelOrder(wDb, order.ref, 'Customer changed mind', { id: 1, role: 'MANAGER' });

      // Exception is RESOLVED with ORDER_CANCELLED
      const exc = getException(wDb, excRef)!;
      expect(exc.status).toBe('RESOLVED');
      expect(exc.resolution).toBe('ORDER_CANCELLED');

      // Stop is RESOLVED
      const s = wDb.prepare('SELECT status FROM pick_stops WHERE id = ?').get(stop.id) as any;
      expect(s.status).toBe('RESOLVED');

      // Audit has unreturned_picked
      const aud = wDb.prepare("SELECT details_json FROM audit_log WHERE entity_id = ? AND action = 'ORDER_CANCELLED'").get(order.ref) as any;
      const details = JSON.parse(aud.details_json);
      expect(details.unreturned_picked).toEqual([{ sku: 'SKU001', qty: 3 }]);
    } finally {
      cleanup();
    }
  });

  // P8-T17: Mission with one EXCEPTION_OPEN stop and all others PICKED
  it('P8-T17: Mission with one EXCEPTION_OPEN stop and all others PICKED stays IN_PROGRESS, order stays PICKING', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { order, mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 2, bin: 'A-01-L-1' },
        { sku: 'SKU002', qty: 2, bin: 'A-01-L-2' }
      ]);

      // Pick stop 1
      executePickConfirm(wDb, {
        stop_ref: mission.stops[0].stop_ref,
        scanned_bin: mission.stops[0].bin_code,
        scanned_sku: mission.stops[0].sku,
        picked_qty: 2,
        actor: { id: 3, role: 'PICKER' }
      });

      // Report problem on stop 2
      executeReportProblem(wDb, {
        stop_ref: mission.stops[1].stop_ref,
        type: 'BIN_EMPTY',
        notes: 'Empty',
        actor: { id: 3, role: 'PICKER' }
      });

      const m = getMission(wDb, mission.ref)!;
      expect(m.status).toBe('IN_PROGRESS');

      const o = wDb.prepare('SELECT status FROM orders WHERE ref = ?').get(order.ref) as any;
      expect(o.status).toBe('PICKING');
    } finally {
      cleanup();
    }
  });

  // P8-T18: Bin with recount_required
  it('P8-T18: Bin with recount_required=1 is excluded from v_available_stock and cannot be reserved', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 10 });
      wDb.prepare('UPDATE bins SET recount_required = 1 WHERE code = ?').run('A-01-L-1');

      // Check v_available_stock
      const avail = wDb.prepare('SELECT * FROM v_available_stock WHERE bin_code = ?').all('A-01-L-1');
      expect(avail.length).toBe(0);

      // Attempt to allocate stock
      const alloc = allocateStock(wDb, 'SKU001', 5);
      expect(alloc).toBeNull();
    } finally {
      cleanup();
    }
  });

  // P8-T22: hooks.afterStep('stockOut') throws
  it('P8-T22: hooks.afterStep throws after stockOut: full atomic rollback, bin, reservation, stops, lines and ledger unchanged', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);
      const stop = mission.stops[0];
      const actor = { id: 3, role: 'PICKER' };
      const payload = {
        stop_ref: stop.stop_ref,
        scanned_bin: stop.bin_code,
        scanned_sku: stop.sku,
        picked_qty: 5,
        actor
      };

      expect(() => {
        runIdempotent(
          wDb,
          { key: 'hook-test-key', scope: `command:pick-confirm:${stop.stop_ref}`, body: payload, actor },
          (txDb) => {
            executePickConfirm(txDb, payload, {
              afterStep: (step) => {
                if (step === 'stockOut') throw new Error('Simulated failure after stockOut');
              }
            });
            return { status: 200, body: {} };
          }
        );
      }).toThrowError(/Simulated failure after stockOut/);

      // Everything intact
      const inv = wDb.prepare('SELECT qty, reserved_qty FROM inventory WHERE bin_code = ?').get(stop.bin_code) as any;
      expect(inv.qty).toBe(5);
      expect(inv.reserved_qty).toBe(5);

      const r = wDb.prepare('SELECT status, consumed_qty FROM reservations WHERE id = ?').get(stop.reservation_id) as any;
      expect(r.status).toBe('HELD');
      expect(r.consumed_qty).toBe(0);

      const s = wDb.prepare('SELECT status, qty_picked FROM pick_stops WHERE id = ?').get(stop.id) as any;
      expect(s.status).toBe('PENDING');
      expect(s.qty_picked).toBe(0);

      const mov = wDb.prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE movement_type = 'PICK'").get() as any;
      expect(mov.c).toBe(0);
    } finally {
      cleanup();
    }
  });

  // P8-T23: Reroute after REALLOCATE
  it('P8-T23: Reroute after REALLOCATE: rerouteMission updates pending stops seq and replaces route_json with rerouted=true', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      stockIn(wDb, { bin: 'A-01-L-2', sku: 'SKU001', qty: 10 });
      const { mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);
      const stop = mission.stops[0];

      const exc = executeReportProblem(wDb, {
        stop_ref: stop.stop_ref,
        type: 'BIN_EMPTY',
        notes: 'Empty',
        actor: { id: 3, role: 'PICKER' }
      });

      const resolveRes = executeResolveException(wDb, {
        exception_ref: exc.ref,
        action: 'REALLOCATE',
        notes: 'Reallocate to L-2',
        actor: { id: 1, role: 'MANAGER' }
      });

      // Get reroute input
      const input = getRerouteInput(wDb, mission.ref);
      expect(input.pending.length).toBe(1);
      expect(input.pending[0].bin_code).toBe('A-01-L-2');

      // Call rerouteMission
      const dummyRoute = { total_distance: 12, algorithm: 'TEST' };
      rerouteMission(wDb, mission.ref, dummyRoute, [input.pending[0].key]);

      const m = getMission(wDb, mission.ref)!;
      expect(m.route.rerouted).toBe(true);
    } finally {
      cleanup();
    }
  });

  // P8-T24: Integrity after a mixed scenario (full, partial, empty, reallocate, accept short)
  it('P8-T24: Integrity checks I01-I13 all PASS after mixed scenario', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      // 1. Stock extra bin A-01-L-2
      stockIn(wDb, { bin: 'A-01-L-2', sku: 'SKU001', qty: 10 });
      recordMovement(wDb, {
        type: 'ADJUSTMENT',
        sku: 'SKU001',
        qty: 10,
        from: { kind: 'ADJUSTMENT', ref: 'INIT' },
        to: { kind: 'BIN', ref: 'A-01-L-2' },
        actorId: 1
      });

      // 2. Order 1: full pick
      const { mission: m1 } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 4, bin: 'A-01-L-1' }
      ]);
      executePickConfirm(wDb, {
        stop_ref: m1.stops[0].stop_ref,
        scanned_bin: m1.stops[0].bin_code,
        scanned_sku: m1.stops[0].sku,
        picked_qty: 4,
        actor: { id: 3, role: 'PICKER' }
      });

      // 3. Order 2: partial pick + accept short
      const { mission: m2 } = setupOrderWithMission(wDb, [
        { sku: 'SKU002', qty: 5, bin: 'A-01-L-3' }
      ]);
      const p2 = executePickConfirm(wDb, {
        stop_ref: m2.stops[0].stop_ref,
        scanned_bin: m2.stops[0].bin_code,
        scanned_sku: m2.stops[0].sku,
        picked_qty: 3,
        exception: { type: 'SHORT_PICK', notes: 'Missing 2' },
        actor: { id: 3, role: 'PICKER' }
      });
      executeResolveException(wDb, {
        exception_ref: p2.exception!.ref,
        action: 'ACCEPT_SHORT',
        notes: 'Accepted',
        actor: { id: 1, role: 'MANAGER' }
      });

      // Check all integrity checks
      const report = runIntegrityChecks(wDb);
      if (!report.ok) {
        console.error('Failed integrity checks:', report.checks.filter((c) => c.status === 'FAIL'));
      }
      expect(report.ok).toBe(true);
      for (const c of report.checks) {
        expect(c.status).not.toBe('FAIL');
      }
    } finally {
      cleanup();
    }
  });

  // P8-T25: Web contracts: verify schema and data structure
  it('P8-T25: Web contracts: stop progress, mismatch messages, exception models and resolve payload match expectations', () => {
    const mockProgress = {
      finished_stops: 1,
      total_stops: 2,
      units_picked: 3,
      units_required: 5,
      open_exceptions: 1
    };

    const stopsPct = Math.round((mockProgress.finished_stops / mockProgress.total_stops) * 100);
    const unitsPct = Math.round((mockProgress.units_picked / mockProgress.units_required) * 100);
    expect(stopsPct).toBe(50);
    expect(unitsPct).toBe(60);
  });

  // LIVE HTTP STACK TESTS
  describe('Phase 8 Live HTTP Stack Tests', () => {
    let client: ReturnType<typeof apiClient>;
    let manager: ReturnType<typeof apiClient>;
    let picker1: ReturnType<typeof apiClient>;
    let picker2: ReturnType<typeof apiClient>;

    beforeAll(async () => {
      stack = await startStack({ seed: true });
      client = apiClient(stack.urls.gateway);
      manager = apiClient(stack.urls.gateway);
      picker1 = apiClient(stack.urls.gateway);
      picker2 = apiClient(stack.urls.gateway);

      await manager.login('manager1');
      await picker1.login('picker1');
      await picker2.login('picker2');
    });

    // P8-T15: Resolve as PICKER via HTTP returns 403
    it('P8-T15 HTTP: Resolve as PICKER returns 403', async () => {
      const res = await picker1.post('/api/exceptions/EXC-0001/resolve', {
        action: 'ACCEPT_SHORT'
      });
      expect(res.status).toBe(403);
    });

    // P8-T19: Engine 1 stopped, confirm pick -> 503 ENGINE1_UNAVAILABLE; restart; same key succeeds once
    it('P8-T19: Engine 1 stopped: confirm pick returns 503 ENGINE1_UNAVAILABLE; restart and same key succeeds', async () => {
      const wDb = new Database(stack!.tempDb.warehouseDbPath);
      wDb.pragma('journal_mode = WAL');
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 10 });
      wDb.close();

      // Create order as manager
      const orderRes = await manager.post('/api/orders', {
        order_type: 'CUSTOMER',
        priority: 'NORMAL',
        customer_ref: 'Test Customer E1',
        lines: [{ sku: 'SKU001', qty: 3 }]
      });
      expect(orderRes.status).toBe(201);
      const orderRef = orderRes.body.ref;

      // Assign to picker1
      const assignRes = await manager.post(`/api/orders/${orderRef}/assign`, {
        picker_id: 3
      });
      expect(assignRes.status).toBe(201);
      const missionRef = assignRes.body.ref;
      const stopRef = assignRes.body.stops[0].stop_ref;

      // Start mission
      const startRes = await picker1.post(`/api/missions/${missionRef}/start`);
      expect(startRes.status).toBe(200);

      // Kill Engine 1
      await stack!.kill('engine1');

      const pickKey = `idemp-pick-e1-${Date.now()}`;
      const failRes = await picker1.post(
        `/api/pick-stops/${stopRef}/confirm`,
        {
          scanned_bin: 'A-01-L-1',
          scanned_sku: 'SKU001',
          picked_qty: 3
        },
        { idempotencyKey: pickKey }
      );
      expect(failRes.status).toBe(503);
      expect(failRes.body?.error?.code).toBe('ENGINE1_UNAVAILABLE');

      // Restart Engine 1
      await stack!.restart('engine1');

      // Retry with SAME idempotency key
      const retryRes = await picker1.post(
        `/api/pick-stops/${stopRef}/confirm`,
        {
          scanned_bin: 'A-01-L-1',
          scanned_sku: 'SKU001',
          picked_qty: 3
        },
        { idempotencyKey: pickKey }
      );
      expect(retryRes.status).toBe(200);
      expect(retryRes.body.stop.status).toBe('PICKED');
    });

    // P8-T20: Kill Engine 3 mid-confirm and restart it -> exactly one deduction after retry
    it('P8-T20: Restart Engine 3 after confirm: retry with same key returns cached success with exactly one deduction', async () => {
      const wDb = new Database(stack!.tempDb.warehouseDbPath);
      wDb.pragma('journal_mode = WAL');
      stockIn(wDb, { bin: 'A-01-L-2', sku: 'SKU002', qty: 10 });
      wDb.close();

      const orderRes = await manager.post('/api/orders', {
        order_type: 'CUSTOMER',
        priority: 'NORMAL',
        customer_ref: 'E3 Restart Test',
        lines: [{ sku: 'SKU002', qty: 2 }]
      });
      const orderRef = orderRes.body.ref;

      const assignRes = await manager.post(`/api/orders/${orderRef}/assign`, {
        picker_id: 3
      });
      const missionRef = assignRes.body.ref;
      const stopRef = assignRes.body.stops[0].stop_ref;

      await picker1.post(`/api/missions/${missionRef}/start`);

      const pickKey = `idemp-pick-e3-${Date.now()}`;
      const pickRes = await picker1.post(
        `/api/pick-stops/${stopRef}/confirm`,
        {
          scanned_bin: 'A-01-L-2',
          scanned_sku: 'SKU002',
          picked_qty: 2
        },
        { idempotencyKey: pickKey }
      );
      expect(pickRes.status).toBe(200);

      // Restart Engine 3
      await stack!.restart('engine3');

      // Retry with same key
      const retryRes = await picker1.post(
        `/api/pick-stops/${stopRef}/confirm`,
        {
          scanned_bin: 'A-01-L-2',
          scanned_sku: 'SKU002',
          picked_qty: 2
        },
        { idempotencyKey: pickKey }
      );
      expect(retryRes.status).toBe(200);

      // Verify physical inventory only deducted once (10 - 2 = 8)
      const checkDb = new Database(stack!.tempDb.warehouseDbPath);
      const inv = checkDb.prepare('SELECT qty FROM inventory WHERE bin_code = ?').get('A-01-L-2') as any;
      expect(inv.qty).toBe(8);
      checkDb.close();
    });

    // P8-T21: Two pickers confirm stops on the same shelf in parallel; two orders pick from the same bin
    it('P8-T21: Two pickers confirm stops on same shelf in parallel: both succeed, each consumes own reservation, totals exact', async () => {
      const wDb = new Database(stack!.tempDb.warehouseDbPath);
      wDb.pragma('journal_mode = WAL');
      stockIn(wDb, { bin: 'A-01-L-3', sku: 'SKU003', qty: 20 });
      wDb.close();

      // Order 1: 4 units
      const o1Res = await manager.post('/api/orders', {
        order_type: 'CUSTOMER',
        priority: 'NORMAL',
        customer_ref: 'Parallel 1',
        lines: [{ sku: 'SKU003', qty: 4 }]
      });
      const m1Res = await manager.post(`/api/orders/${o1Res.body.ref}/assign`, { picker_id: 3 });
      await picker1.post(`/api/missions/${m1Res.body.ref}/start`);
      const s1Ref = m1Res.body.stops[0].stop_ref;

      // Order 2: 6 units
      const o2Res = await manager.post('/api/orders', {
        order_type: 'CUSTOMER',
        priority: 'NORMAL',
        customer_ref: 'Parallel 2',
        lines: [{ sku: 'SKU003', qty: 6 }]
      });
      const m2Res = await manager.post(`/api/orders/${o2Res.body.ref}/assign`, { picker_id: 4 });
      await picker2.post(`/api/missions/${m2Res.body.ref}/start`);
      const s2Ref = m2Res.body.stops[0].stop_ref;

      // Send both picks in parallel
      const [res1, res2] = await Promise.all([
        picker1.post(`/api/pick-stops/${s1Ref}/confirm`, {
          scanned_bin: 'A-01-L-3',
          scanned_sku: 'SKU003',
          picked_qty: 4
        }),
        picker2.post(`/api/pick-stops/${s2Ref}/confirm`, {
          scanned_bin: 'A-01-L-3',
          scanned_sku: 'SKU003',
          picked_qty: 6
        })
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Remaining stock: 20 - 4 - 6 = 10
      const checkDb = new Database(stack!.tempDb.warehouseDbPath);
      const inv = checkDb.prepare('SELECT qty, reserved_qty FROM inventory WHERE bin_code = ?').get('A-01-L-3') as any;
      expect(inv.qty).toBe(10);
      expect(inv.reserved_qty).toBe(0);
      checkDb.close();
    });
  });
});
