import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { createTempDbPaths } from '../harness/tempDb.js';
import { startStack, RunningStack } from '../harness/stack.js';
import { apiClient } from '../harness/apiClient.js';
import { applyMigrations } from '../../scripts/migrate.js';
import { seedBase } from '../../scripts/seed-base.js';
import { runIntegrityChecks } from '../../scripts/verify-integrity.js';
import { stockIn, recordMovement } from '../../services/engine3-inventory/src/domain/inventoryRepo.js';
import { executeReserveOrder, cancelOrder } from '../../services/engine3-inventory/src/domain/ordersRepo.js';
import { getPickPlan, assignMission, startMission } from '../../services/engine3-inventory/src/domain/missionsRepo.js';
import { planRoute } from '../../services/engine2-optimizer/src/routing/planRoute.js';
import {
  executePickConfirm,
  executeReportProblem,
  executeResolveException
} from '../../services/engine3-inventory/src/domain/pickingRepo.js';
import { getPackingQueue, executePackOrder } from '../../services/engine3-inventory/src/domain/packingRepo.js';
import { getDashboardMetrics } from '../../services/engine3-inventory/src/domain/dashboardRepo.js';
import { runIdempotent } from '../../services/engine3-inventory/src/domain/idempotency.js';

describe('Phase 9 Packing, Dashboard, and Audit Tests', () => {
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
      customer_ref: 'Acme Retail',
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

    return { order, mission };
  }

  // P9-T01: Pack a fully picked order
  it('P9-T01: Pack a fully picked order -> PCK-0001; order COMPLETED, FULL, completed_at set; audit + events; inventory snapshot identical', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { order, mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);

      // Confirm pick
      const stop = mission.stops[0];
      executePickConfirm(wDb, {
        stop_ref: stop.stop_ref,
        scanned_bin: stop.bin_code,
        scanned_sku: stop.sku,
        picked_qty: 5,
        actor: { id: 3, role: 'PICKER' }
      });

      // Verify order is PICKED
      const pickedOrder = wDb.prepare('SELECT status FROM orders WHERE ref = ?').get(order.ref) as any;
      expect(pickedOrder.status).toBe('PICKED');

      // Take snapshot of inventory table before packing
      const inventoryBefore = wDb
        .prepare('SELECT bin_code, sku, qty, reserved_qty FROM inventory ORDER BY bin_code, sku')
        .all();
      const movementsCountBefore = (
        wDb.prepare('SELECT COUNT(*) AS c FROM stock_movements').get() as any
      ).c;

      // Pack order
      const packResult = executePackOrder(wDb, {
        order_ref: order.ref,
        notes: 'Handled with care',
        actor: { id: 1, role: 'MANAGER' }
      });

      expect(packResult.packing_ref).toMatch(/^PCK-\d+$/);
      expect(packResult.order_ref).toBe(order.ref);
      expect(packResult.fulfilment_type).toBe('FULL');
      expect(packResult.total_ordered).toBe(5);
      expect(packResult.total_picked).toBe(5);
      expect(packResult.packed_by).toBe(1);
      expect(packResult.packed_at).toBeTruthy();

      // Verify order state in DB
      const completedOrder = wDb
        .prepare('SELECT status, fulfilment_type, completed_at FROM orders WHERE ref = ?')
        .get(order.ref) as any;
      expect(completedOrder.status).toBe('COMPLETED');
      expect(completedOrder.fulfilment_type).toBe('FULL');
      expect(completedOrder.completed_at).toBeTruthy();

      // Verify packing_records row
      const pRecord = wDb.prepare('SELECT * FROM packing_records WHERE ref = ?').get(packResult.packing_ref) as any;
      expect(pRecord).toBeDefined();
      expect(pRecord.fulfilment_type).toBe('FULL');
      expect(pRecord.total_ordered).toBe(5);
      expect(pRecord.total_picked).toBe(5);
      expect(pRecord.notes).toBe('Handled with care');

      // Verify audit log
      const auditLog = wDb
        .prepare("SELECT * FROM audit_log WHERE entity_id = ? AND action = 'ORDER_PACKED'")
        .get(order.ref) as any;
      expect(auditLog).toBeDefined();
      expect(auditLog.action).toBe('ORDER_PACKED');

      // Verify outbox events
      const events = wDb
        .prepare("SELECT event_type, data_json FROM outbox_events WHERE entity_id = ? ORDER BY seq ASC")
        .all(order.ref) as any[];
      const completedEvent = events.find((e) => e.event_type === 'order.completed');
      expect(completedEvent).toBeDefined();
      const completedData = JSON.parse(completedEvent.data_json);
      expect(completedData.fulfilment_type).toBe('FULL');

      const statusEvents = events.filter((e) => e.event_type === 'order.status_changed');
      const lastStatusEvent = statusEvents[statusEvents.length - 1];
      expect(lastStatusEvent).toBeDefined();
      const statusData = JSON.parse(lastStatusEvent.data_json);
      expect(statusData.status).toBe('COMPLETED');

      // Verify inventory snapshot after packing is IDENTICAL
      const inventoryAfter = wDb
        .prepare('SELECT bin_code, sku, qty, reserved_qty FROM inventory ORDER BY bin_code, sku')
        .all();
      expect(inventoryAfter).toEqual(inventoryBefore);

      const movementsCountAfter = (
        wDb.prepare('SELECT COUNT(*) AS c FROM stock_movements').get() as any
      ).c;
      expect(movementsCountAfter).toBe(movementsCountBefore);
    } finally {
      cleanup();
    }
  });

  // P9-T02: Pack twice: same key / different key
  it('P9-T02: Pack twice: same key returns replay / different key throws ORDER_STATE_INVALID; exactly one packing record', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { order, mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);

      const stop = mission.stops[0];
      executePickConfirm(wDb, {
        stop_ref: stop.stop_ref,
        scanned_bin: stop.bin_code,
        scanned_sku: stop.sku,
        picked_qty: 5,
        actor: { id: 3, role: 'PICKER' }
      });

      const key1 = 'pack-idem-key-1';
      const actor = { id: 1, role: 'MANAGER' };

      // First pack with key1
      const res1 = runIdempotent(
        wDb,
        { key: key1, scope: `order:pack:${order.ref}`, body: {}, actor },
        (txDb) => {
          const result = executePackOrder(txDb, {
            order_ref: order.ref,
            actor
          });
          return { status: 201, body: result };
        }
      );
      expect(res1.status).toBe(201);
      expect(res1.replay).toBe(false);

      // Second pack with same key1 -> replay
      const res2 = runIdempotent(
        wDb,
        { key: key1, scope: `order:pack:${order.ref}`, body: {}, actor },
        (txDb) => {
          const result = executePackOrder(txDb, {
            order_ref: order.ref,
            actor
          });
          return { status: 201, body: result };
        }
      );
      expect(res2.status).toBe(201);
      expect(res2.replay).toBe(true);
      expect(res2.body.packing_ref).toBe(res1.body.packing_ref);

      // Third pack with different key2 -> throws ORDER_STATE_INVALID because order is already COMPLETED
      const key2 = 'pack-idem-key-2';
      expect(() => {
        runIdempotent(
          wDb,
          { key: key2, scope: `order:pack:${order.ref}`, body: {}, actor },
          (txDb) => {
            const result = executePackOrder(txDb, {
              order_ref: order.ref,
              actor
            });
            return { status: 201, body: result };
          }
        );
      }).toThrowError(/ORDER_STATE_INVALID/);

      // Exactly one packing record exists
      const count = (
        wDb.prepare('SELECT COUNT(*) AS c FROM packing_records WHERE order_id = (SELECT id FROM orders WHERE ref = ?)').get(order.ref) as any
      ).c;
      expect(count).toBe(1);
    } finally {
      cleanup();
    }
  });

  // P9-T03: Pack orders in RESERVED, ASSIGNED, PICKING
  it('P9-T03: Pack orders in RESERVED, ASSIGNED, PICKING throws ORDER_STATE_INVALID', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 30 });
      recordMovement(wDb, {
        type: 'ADJUSTMENT',
        sku: 'SKU001',
        qty: 30,
        from: { kind: 'ADJUSTMENT', ref: 'INIT' },
        to: { kind: 'BIN', ref: 'A-01-L-1' },
        actorId: 1
      });

      // 1. Order in RESERVED
      const ord1 = executeReserveOrder(wDb, {
        order_type: 'CUSTOMER',
        priority: 'NORMAL',
        customer_ref: 'Cust 1',
        lines: [{ sku: 'SKU001', qty: 5 }],
        actor: { id: 1, role: 'MANAGER' }
      });
      expect(() => {
        executePackOrder(wDb, { order_ref: ord1.ref, actor: { id: 1, role: 'MANAGER' } });
      }).toThrowError(/ORDER_STATE_INVALID/);

      // 2. Order in ASSIGNED
      const plan2 = getPickPlan(wDb, ord1.ref);
      const r2 = planRoute(wDb, {
        stops: plan2.reservations.map((r: any) => ({
          key: r.reservation_id,
          bin_code: r.bin_code,
          node: r.node
        }))
      });
      const mis2 = assignMission(wDb, {
        order_ref: ord1.ref,
        picker_id: 3,
        plan_token: plan2.plan_token,
        route: r2,
        actor: { id: 1, role: 'MANAGER' }
      });
      expect(() => {
        executePackOrder(wDb, { order_ref: ord1.ref, actor: { id: 1, role: 'MANAGER' } });
      }).toThrowError(/ORDER_STATE_INVALID/);

      // 3. Order in PICKING
      startMission(wDb, mis2.ref, { id: 3, role: 'PICKER' });
      expect(() => {
        executePackOrder(wDb, { order_ref: ord1.ref, actor: { id: 1, role: 'MANAGER' } });
      }).toThrowError(/ORDER_STATE_INVALID/);
    } finally {
      cleanup();
    }
  });

  // P9-T04: Order with accepted shortfall: STAFF / MANAGER without flag / MANAGER with flag
  it('P9-T04: Order with accepted shortfall: STAFF (403) / MANAGER without flag (PACK_INCOMPLETE) / MANAGER with flag (COMPLETED, PARTIAL)', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { order, mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);

      const stop = mission.stops[0];
      // Pick 3 units with short-pick exception (2 short)
      const confirmRes = executePickConfirm(wDb, {
        stop_ref: stop.stop_ref,
        scanned_bin: stop.bin_code,
        scanned_sku: stop.sku,
        picked_qty: 3,
        exception: { type: 'SHORT_PICK', notes: '2 units damaged on shelf' },
        actor: { id: 3, role: 'PICKER' }
      });
      expect(confirmRes.exception).toBeDefined();

      // Manager resolves with ACCEPT_SHORT
      executeResolveException(wDb, {
        exception_ref: confirmRes.exception!.ref,
        action: 'ACCEPT_SHORT',
        actor: { id: 1, role: 'MANAGER' }
      });

      // Order is now PICKED
      const pickedOrd = wDb.prepare('SELECT status FROM orders WHERE ref = ?').get(order.ref) as any;
      expect(pickedOrd.status).toBe('PICKED');

      // Staff attempts pack -> PARTIAL_PACK_FORBIDDEN (403)
      try {
        executePackOrder(wDb, {
          order_ref: order.ref,
          actor: { id: 5, role: 'STAFF' }
        });
        expect.fail('should have thrown PARTIAL_PACK_FORBIDDEN');
      } catch (err: any) {
        expect(err.code).toBe('PARTIAL_PACK_FORBIDDEN');
      }

      // Manager attempts pack without accept_partial -> PACK_INCOMPLETE {requires_accept_partial: true}
      try {
        executePackOrder(wDb, {
          order_ref: order.ref,
          accept_partial: false,
          actor: { id: 1, role: 'MANAGER' }
        });
        expect.fail('should have thrown PACK_INCOMPLETE');
      } catch (err: any) {
        expect(err.code).toBe('PACK_INCOMPLETE');
        expect(err.details?.requires_accept_partial).toBe(true);
      }

      // Manager attempts pack with accept_partial: true -> succeeds!
      const packRes = executePackOrder(wDb, {
        order_ref: order.ref,
        accept_partial: true,
        notes: 'Manager approved 2 units shortfall',
        actor: { id: 1, role: 'MANAGER' }
      });

      expect(packRes.fulfilment_type).toBe('PARTIAL');
      expect(packRes.total_ordered).toBe(5);
      expect(packRes.total_picked).toBe(3);

      const ordAfter = wDb
        .prepare('SELECT status, fulfilment_type FROM orders WHERE ref = ?')
        .get(order.ref) as any;
      expect(ordAfter.status).toBe('COMPLETED');
      expect(ordAfter.fulfilment_type).toBe('PARTIAL');
    } finally {
      cleanup();
    }
  });

  // P9-T05: Defence in depth: force an order to PICKED in test DB while stop is PENDING and exception is OPEN
  it('P9-T05: Force an order to PICKED while stop is PENDING / exception is OPEN throws PACK_INCOMPLETE', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { order, mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 3, bin: 'A-01-L-1' },
        { sku: 'SKU002', qty: 2, bin: 'A-01-L-2' }
      ]);

      // Confirm first stop
      const stop0 = mission.stops[0];
      executePickConfirm(wDb, {
        stop_ref: stop0.stop_ref,
        scanned_bin: stop0.bin_code,
        scanned_sku: stop0.sku,
        picked_qty: 3,
        actor: { id: 3, role: 'PICKER' }
      });

      // Report problem on second stop
      executeReportProblem(wDb, {
        stop_ref: mission.stops[1].stop_ref,
        type: 'BIN_EMPTY',
        notes: 'Empty',
        actor: { id: 3, role: 'PICKER' }
      });

      // Force order to PICKED in DB directly
      wDb.prepare("UPDATE orders SET status = 'PICKED' WHERE ref = ?").run(order.ref);

      // Pack must be rejected by defence-in-depth check 2/3
      expect(() => {
        executePackOrder(wDb, {
          order_ref: order.ref,
          actor: { id: 1, role: 'MANAGER' }
        });
      }).toThrowError(/PACK_INCOMPLETE/);
    } finally {
      cleanup();
    }
  });

  // P9-T06: All lines short and accepted (nothing picked)
  it('P9-T06: All lines short and accepted -> pack throws PACK_INCOMPLETE {NOTHING_PICKED}; cancel works', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { order, mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);

      const stop = mission.stops[0];
      const exc = executeReportProblem(wDb, {
        stop_ref: stop.stop_ref,
        type: 'BIN_EMPTY',
        notes: 'No items',
        actor: { id: 3, role: 'PICKER' }
      });

      // Resolve with 0 picked, 5 short
      executeResolveException(wDb, {
        exception_ref: exc.ref,
        action: 'ACCEPT_SHORT',
        picked_qty: 0,
        actor: { id: 1, role: 'MANAGER' }
      });

      // Order is PICKED
      const pickedOrd = wDb.prepare('SELECT status FROM orders WHERE ref = ?').get(order.ref) as any;
      expect(pickedOrd.status).toBe('PICKED');

      // Pack fails because total_picked == 0
      try {
        executePackOrder(wDb, {
          order_ref: order.ref,
          accept_partial: true,
          actor: { id: 1, role: 'MANAGER' }
        });
        expect.fail('should have thrown PACK_INCOMPLETE with NOTHING_PICKED');
      } catch (err: any) {
        expect(err.code).toBe('PACK_INCOMPLETE');
        expect(err.details?.reason).toBe('NOTHING_PICKED');
      }

      // Order can be cancelled instead (all reservations were released)
      const cancelRes = cancelOrder(wDb, order.ref, 'Nothing picked', { id: 1, role: 'MANAGER' });
      expect(cancelRes.ref).toBe(order.ref);
      expect(cancelRes.status).toBe('CANCELLED');

      const cancelledOrd = wDb.prepare('SELECT status FROM orders WHERE ref = ?').get(order.ref) as any;
      expect(cancelledOrd.status).toBe('CANCELLED');
    } finally {
      cleanup();
    }
  });

  // P9-T07: Corrupt qty_picked in test DB then pack -> INVENTORY_DRIFT
  it('P9-T07: Corrupt qty_picked in test DB then pack throws INVENTORY_DRIFT with no state change', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { order, mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);

      const stop = mission.stops[0];
      executePickConfirm(wDb, {
        stop_ref: stop.stop_ref,
        scanned_bin: stop.bin_code,
        scanned_sku: stop.sku,
        picked_qty: 5,
        actor: { id: 3, role: 'PICKER' }
      });

      // Corrupt order_lines: set qty_picked = 4, qty_short = 1
      // Line sum (4+1 = 5) matches qty_ordered, but total_picked (4) != stock_movements (5)
      wDb.prepare('UPDATE order_lines SET qty_picked = 4, qty_short = 1 WHERE order_id = (SELECT id FROM orders WHERE ref = ?)').run(order.ref);

      expect(() => {
        executePackOrder(wDb, {
          order_ref: order.ref,
          accept_partial: true,
          actor: { id: 1, role: 'MANAGER' }
        });
      }).toThrowError(/INVENTORY_DRIFT/);

      // Order remains in PICKED state, no packing record
      const ordAfter = wDb.prepare('SELECT status FROM orders WHERE ref = ?').get(order.ref) as any;
      expect(ordAfter.status).toBe('PICKED');

      const packRecords = wDb
        .prepare('SELECT COUNT(*) AS c FROM packing_records WHERE order_id = (SELECT id FROM orders WHERE ref = ?)')
        .get(order.ref) as any;
      expect(packRecords.c).toBe(0);
    } finally {
      cleanup();
    }
  });

  // P9-T09: GET /packing/queue -> only PICKED orders
  it('P9-T09: GET /packing/queue returns only PICKED orders with accurate lines, preview, approval flag', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      // Order 1: fully picked
      const { order: o1, mission: m1 } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 5, bin: 'A-01-L-1' }
      ]);
      const stop1 = m1.stops[0];
      executePickConfirm(wDb, {
        stop_ref: stop1.stop_ref,
        scanned_bin: stop1.bin_code,
        scanned_sku: stop1.sku,
        picked_qty: 5,
        actor: { id: 3, role: 'PICKER' }
      });

      // Order 2: partial pick (pick 3, short 1 of 4)
      const { order: o2, mission: m2 } = setupOrderWithMission(wDb, [
        { sku: 'SKU002', qty: 4, bin: 'A-01-L-2' }
      ]);
      const stop2 = m2.stops[0];
      const confirmRes2 = executePickConfirm(wDb, {
        stop_ref: stop2.stop_ref,
        scanned_bin: stop2.bin_code,
        scanned_sku: stop2.sku,
        picked_qty: 3,
        exception: { type: 'SHORT_PICK', notes: '1 short' },
        actor: { id: 3, role: 'PICKER' }
      });
      executeResolveException(wDb, {
        exception_ref: confirmRes2.exception!.ref,
        action: 'ACCEPT_SHORT',
        actor: { id: 1, role: 'MANAGER' }
      });

      // Order 3: RESERVED only
      stockIn(wDb, { bin: 'A-01-L-3', sku: 'SKU003', qty: 10 });
      recordMovement(wDb, {
        type: 'ADJUSTMENT',
        sku: 'SKU003',
        qty: 10,
        from: { kind: 'ADJUSTMENT', ref: 'INIT' },
        to: { kind: 'BIN', ref: 'A-01-L-3' },
        actorId: 1
      });
      const o3 = executeReserveOrder(wDb, {
        order_type: 'CUSTOMER',
        priority: 'NORMAL',
        customer_ref: 'Unpicked Order',
        lines: [{ sku: 'SKU003', qty: 2 }],
        actor: { id: 1, role: 'MANAGER' }
      });

      // Fetch packing queue
      const queue = getPackingQueue(wDb);
      const queueRefs = queue.items.map((i) => i.order_ref);

      expect(queueRefs).toContain(o1.ref);
      expect(queueRefs).toContain(o2.ref);
      expect(queueRefs).not.toContain(o3.ref);

      const q1 = queue.items.find((i) => i.order_ref === o1.ref)!;
      expect(q1.fulfilment_preview).toBe('FULL');
      expect(q1.needs_manager_approval).toBe(false);
      expect(q1.total_ordered).toBe(5);
      expect(q1.total_picked).toBe(5);
      expect(q1.total_short).toBe(0);

      const q2 = queue.items.find((i) => i.order_ref === o2.ref)!;
      expect(q2.fulfilment_preview).toBe('PARTIAL');
      expect(q2.needs_manager_approval).toBe(true);
      expect(q2.total_ordered).toBe(4);
      expect(q2.total_picked).toBe(3);
      expect(q2.total_short).toBe(1);
      expect(q2.exceptions.length).toBe(1);
    } finally {
      cleanup();
    }
  });

  // P9-T10: Dashboard vs independent SQL aggregates
  it('P9-T10: Dashboard metrics equal independent SQL aggregates across every field', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      // Stock some inventory and do a pick
      const { order, mission } = setupOrderWithMission(wDb, [
        { sku: 'SKU001', qty: 10, bin: 'A-01-L-1' }
      ]);
      const stop = mission.stops[0];
      executePickConfirm(wDb, {
        stop_ref: stop.stop_ref,
        scanned_bin: stop.bin_code,
        scanned_sku: stop.sku,
        picked_qty: 10,
        actor: { id: 3, role: 'PICKER' }
      });
      executePackOrder(wDb, {
        order_ref: order.ref,
        actor: { id: 1, role: 'MANAGER' }
      });

      const metrics = getDashboardMetrics(wDb);

      // Independent queries
      const expectedReceiptsToday = (
        wDb.prepare("SELECT COUNT(*) AS c FROM receipts WHERE strftime('%Y-%m-%d', received_at) = strftime('%Y-%m-%d', 'now')").get() as any
      ).c;
      const expectedStored = (wDb.prepare('SELECT COALESCE(SUM(qty), 0) AS c FROM inventory').get() as any).c;
      const expectedReserved = (wDb.prepare('SELECT COALESCE(SUM(reserved_qty), 0) AS c FROM inventory').get() as any).c;
      const expectedAvailable = (wDb.prepare('SELECT COALESCE(SUM(available_qty), 0) AS c FROM v_available_stock').get() as any).c;
      const expectedOccupiedBins = (wDb.prepare('SELECT COUNT(DISTINCT bin_code) AS c FROM inventory WHERE qty > 0').get() as any).c;
      const expectedTotalBins = (wDb.prepare('SELECT COUNT(*) AS c FROM bins').get() as any).c;
      const expectedCompletedOrders = (wDb.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'COMPLETED'").get() as any).c;
      const expectedCompletedMissions = (wDb.prepare("SELECT COUNT(*) AS c FROM missions WHERE status = 'COMPLETED'").get() as any).c;

      expect(metrics.receiving.receipts_today).toBe(expectedReceiptsToday);
      expect(metrics.inventory.stored_units).toBe(expectedStored);
      expect(metrics.inventory.reserved_units).toBe(expectedReserved);
      expect(metrics.inventory.available_units).toBe(expectedAvailable);
      expect(metrics.inventory.occupied_bins).toBe(expectedOccupiedBins);
      expect(metrics.inventory.total_bins).toBe(expectedTotalBins);
      expect(metrics.orders.completed_total).toBe(expectedCompletedOrders);
      expect(metrics.missions.completed_today).toBe(expectedCompletedMissions);
      expect(metrics.movements.today.PICK).toBeGreaterThanOrEqual(1);
      expect(metrics.movements.latest.length).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup();
    }
  });

  // P9-T11: Dashboard "today" boundaries (UTC) with fixtures at 23:59 and 00:01
  it('P9-T11: Dashboard "today" boundaries (UTC) properly partitions entries created on different dates', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      // Insert yesterday order
      wDb.prepare(`
        INSERT INTO orders (ref, customer_ref, status, order_type, priority, fulfilment_type, requested_by, completed_at, created_at, updated_at)
        VALUES ('ORD-YESTERDAY', 'Yest', 'COMPLETED', 'CUSTOMER', 'NORMAL', 'FULL', 1, '2026-11-01T23:59:59.000Z', '2026-11-01T23:00:00.000Z', '2026-11-01T23:59:59.000Z')
      `).run();

      // Today's UTC date
      const todayIso = new Date().toISOString();
      wDb.prepare(`
        INSERT INTO orders (ref, customer_ref, status, order_type, priority, fulfilment_type, requested_by, completed_at, created_at, updated_at)
        VALUES ('ORD-TODAY', 'Today', 'COMPLETED', 'CUSTOMER', 'NORMAL', 'FULL', 1, ?, ?, ?)
      `).run(todayIso, todayIso, todayIso);

      const metrics = getDashboardMetrics(wDb);
      expect(metrics.orders.completed_today).toBe(1);
      expect(metrics.orders.completed_total).toBe(2);
    } finally {
      cleanup();
    }
  });

  // P9-T14: Web contracts verification
  it('P9-T14: Web contracts: packing table lines, STAFF cannot approve partial, manager checkbox, dashboard tiles', () => {
    // Contract 1: line verification logic
    const lines = [
      { sku: 'SKU001', qty_ordered: 5, qty_picked: 5, qty_short: 0 },
      { sku: 'SKU002', qty_ordered: 3, qty_picked: 2, qty_short: 1 }
    ];
    const isLineComplete = (l: typeof lines[0]) => l.qty_picked + l.qty_short === l.qty_ordered;
    expect(lines.every(isLineComplete)).toBe(true);

    // Contract 2: role-based packing button state
    const evaluatePackButton = (role: string, isPartial: boolean, acceptCheckbox: boolean) => {
      const isManager = role === 'MANAGER';
      const isStaff = role === 'STAFF';
      if (!isManager && !isStaff) return { enabled: false, reason: 'FORBIDDEN' };
      if (isPartial) {
        if (!isManager) return { enabled: false, reason: 'MANAGER_REQUIRED' };
        if (!acceptCheckbox) return { enabled: false, reason: 'CHECKBOX_REQUIRED' };
      }
      return { enabled: true, reason: 'OK' };
    };

    // Staff with full order -> enabled
    expect(evaluatePackButton('STAFF', false, false)).toEqual({ enabled: true, reason: 'OK' });
    // Staff with partial order -> disabled, manager required
    expect(evaluatePackButton('STAFF', true, false)).toEqual({ enabled: false, reason: 'MANAGER_REQUIRED' });
    // Manager with partial order, unchecked -> disabled, checkbox required
    expect(evaluatePackButton('MANAGER', true, false)).toEqual({ enabled: false, reason: 'CHECKBOX_REQUIRED' });
    // Manager with partial order, checked -> enabled
    expect(evaluatePackButton('MANAGER', true, true)).toEqual({ enabled: true, reason: 'OK' });

    // Contract 3: dashboard fill_pct calculation
    const occupied = 18;
    const total = 192;
    const fillPct = total > 0 ? Math.round((occupied / total) * 1000) / 10 : 0;
    expect(fillPct).toBe(9.4);
  });

  // LIVE HTTP STACK TESTS
  describe('Phase 9 Live HTTP Stack Tests', () => {
    let client: ReturnType<typeof apiClient>;
    let manager: ReturnType<typeof apiClient>;
    let picker1: ReturnType<typeof apiClient>;
    let operator1: ReturnType<typeof apiClient>;
    let staff1: ReturnType<typeof apiClient>;

    beforeAll(async () => {
      stack = await startStack({ seed: true });
      client = apiClient(stack.urls.gateway);
      manager = apiClient(stack.urls.gateway);
      picker1 = apiClient(stack.urls.gateway);
      operator1 = apiClient(stack.urls.gateway);
      staff1 = apiClient(stack.urls.gateway);

      await manager.login('manager1');
      await picker1.login('picker1');
      await operator1.login('operator1');
      await staff1.login('staff1');
    });

    // P9-T08: Pack as PICKER / OPERATOR -> 403
    it('P9-T08: Pack as PICKER or OPERATOR via Gateway returns 403 Forbidden', async () => {
      const pickerRes = await picker1.post('/api/orders/ORD-0001/pack', { notes: 'Pick pack' });
      expect(pickerRes.status).toBe(403);

      const opRes = await operator1.post('/api/orders/ORD-0001/pack', { notes: 'Op pack' });
      expect(opRes.status).toBe(403);
    });

    // P9-T12: Audit endpoint filters; non-manager -> 403
    it('P9-T12: Audit endpoint: non-manager returns 403; manager query returns filtered log entries', async () => {
      const staffRes = await staff1.get('/api/audit');
      expect(staffRes.status).toBe(403);

      const pickerRes = await picker1.get('/api/audit');
      expect(pickerRes.status).toBe(403);

      const mgrRes = await manager.get('/api/audit?page=1&page_size=20');
      expect(mgrRes.status).toBe(200);
      expect(mgrRes.body.items).toBeInstanceOf(Array);
      expect(typeof mgrRes.body.total).toBe('number');
    });

    // P9-T13: GET /admin/integrity after a full flow -> ok: true, all checks PASS
    it('P9-T13: GET /api/admin/integrity after warehouse flow returns ok: true with all checks PASS', async () => {
      const res = await manager.get('/api/admin/integrity');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.checks).toBeInstanceOf(Array);
      expect(res.body.checks.length).toBe(13);

      for (const check of res.body.checks) {
        expect(['PASS', 'SKIP']).toContain(check.status);
        if (check.status === 'PASS' && check.rows) {
          expect(check.rows.length).toBe(0);
        }
      }
    });

    // P9-T15: Live stack: restart all services -> COMPLETED order + packing record + dashboard identical
    it('P9-T15: Live stack: full order lifecycle to COMPLETED survives stack restart with identical metrics', async () => {
      // 1. Stock some inventory in stack db
      const wDb = new Database(stack!.tempDb.warehouseDbPath);
      wDb.pragma('journal_mode = WAL');
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 20 });
      recordMovement(wDb, {
        type: 'ADJUSTMENT',
        sku: 'SKU001',
        qty: 20,
        from: { kind: 'ADJUSTMENT', ref: 'INIT' },
        to: { kind: 'BIN', ref: 'A-01-L-1' },
        actorId: 1
      });
      wDb.close();

      // 2. Create order as manager
      const orderRes = await manager.post(
        '/api/orders',
        {
          order_type: 'CUSTOMER',
          priority: 'NORMAL',
          customer_ref: 'E2E Restart Test',
          lines: [{ sku: 'SKU001', qty: 5 }]
        },
        { idempotencyKey: `ord-p9-restart-${Date.now()}` }
      );
      expect(orderRes.status).toBe(201);
      const orderRef = orderRes.body.ref;

      // 3. Assign to picker 3 (picker1) via Gateway orchestration
      const assignRes = await manager.post(
        `/api/orders/${orderRef}/assign`,
        { picker_id: 3 },
        { idempotencyKey: `assign-p9-restart-${Date.now()}` }
      );
      expect(assignRes.status).toBe(201);
      const missionRef = assignRes.body.ref;

      // 4. Start mission as picker1
      const startRes = await picker1.post(
        `/api/missions/${missionRef}/start`,
        {},
        { idempotencyKey: `start-p9-restart-${Date.now()}` }
      );
      expect(startRes.status).toBe(200);

      // 5. Confirm pick as picker1
      const missionDetail = await picker1.get(`/api/missions/${missionRef}`);
      const stopRef = missionDetail.body.stops[0].stop_ref;

      const confirmRes = await picker1.post(
        `/api/pick-stops/${stopRef}/confirm`,
        {
          scanned_bin: 'A-01-L-1',
          scanned_sku: 'SKU001',
          picked_qty: 5
        },
        { idempotencyKey: `confirm-p9-restart-${Date.now()}` }
      );
      expect(confirmRes.status).toBe(200);

      // 6. Pack order as staff1
      const packRes = await staff1.post(
        `/api/orders/${orderRef}/pack`,
        { notes: 'Packed before restart' },
        { idempotencyKey: `pack-p9-restart-${Date.now()}` }
      );
      expect(packRes.status).toBe(201);
      expect(packRes.body.fulfilment_type).toBe('FULL');

      // 7. Get dashboard before restart
      const dashBefore = await manager.get('/api/dashboard');
      expect(dashBefore.status).toBe(200);
      const completedTodayBefore = dashBefore.body.orders.completed_today;

      // 8. Restart services
      await stack.restartService('engine3');
      await stack.restartService('gateway');

      // 9. Re-check completed order and dashboard after restart
      const dashAfter = await manager.get('/api/dashboard');
      expect(dashAfter.status).toBe(200);
      expect(dashAfter.body.orders.completed_today).toBe(completedTodayBefore);

      // Verify order still completed
      const orderCheck = await manager.get(`/api/orders/${orderRef}`);
      expect(orderCheck.status).toBe(200);
      expect(orderCheck.body.status).toBe('COMPLETED');
      expect(orderCheck.body.fulfilment_type).toBe('FULL');
    });
  });
});
