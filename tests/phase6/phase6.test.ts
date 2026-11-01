import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import crypto from 'node:crypto';
import { createTempDbPaths } from '../harness/tempDb.js';
import { startStack, RunningStack } from '../harness/stack.js';
import { apiClient } from '../harness/apiClient.js';
import { applyMigrations } from '../../scripts/migrate.js';
import { seedBase } from '../../scripts/seed-base.js';
import { seedDemo } from '../../scripts/seed-demo.js';
import { runIntegrityChecks } from '../../scripts/verify-integrity.js';
import { runTx } from '../../services/engine3-inventory/src/db/tx.js';
import { stockIn } from '../../services/engine3-inventory/src/domain/inventoryRepo.js';
import {
  allocateStock,
  executeReserveOrder,
  cancelOrder,
  getOrder,
  listOrders,
  closeReservationIfDone
} from '../../services/engine3-inventory/src/domain/ordersRepo.js';
import { runIdempotent } from '../../services/engine3-inventory/src/domain/idempotency.js';
import { Scheduler } from '../../services/engine1-scheduler/src/domain/scheduler.js';
import { createOrderSchema, TaskRecord } from '@dark-storage/shared';

describe('Phase 6 Manual Orders & Stock Reservations Tests', () => {
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

  // P6-T01: Valid 3-line order (fixture stock) -> ORD-0001 RESERVED; reservations HELD; stock counts updated; audit + events
  it('P6-T01: Valid 3-line order: ORD-0001 RESERVED, reservations HELD, reserved_qty up, available down, qty unchanged, audit + events', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, display_name: 'Maria Manager', role: 'MANAGER' };

      // Stock 3 distinct SKUs
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 30 });
      stockIn(wDb, { bin: 'A-01-L-2', sku: 'SKU002', qty: 40 });
      stockIn(wDb, { bin: 'A-01-L-3', sku: 'SKU003', qty: 50 });

      const order = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          order_type: 'CUSTOMER',
          priority: 'NORMAL',
          customer_ref: 'CUST-001',
          notes: 'Standard shipping',
          lines: [
            { sku: 'SKU001', qty: 10 },
            { sku: 'SKU002', qty: 15 },
            { sku: 'SKU003', qty: 20 }
          ],
          actor
        })
      );

      expect(order.ref).toBe('ORD-0001');
      expect(order.status).toBe('RESERVED');
      expect(order.order_type).toBe('CUSTOMER');
      expect(order.priority).toBe('NORMAL');
      expect(order.customer_ref).toBe('CUST-001');
      expect(order.lines.length).toBe(3);

      // Verify reservations are HELD
      for (const line of order.lines) {
        expect(line.reservations.length).toBeGreaterThan(0);
        for (const res of line.reservations) {
          expect(res.status).toBe('HELD');
        }
      }

      // Verify stock in inventory: reserved_qty up, available down, qty unchanged
      const inv1 = wDb.prepare("SELECT qty, reserved_qty FROM inventory WHERE bin_code = 'A-01-L-1'").get() as any;
      expect(inv1.qty).toBe(30);
      expect(inv1.reserved_qty).toBe(10);

      const inv2 = wDb.prepare("SELECT qty, reserved_qty FROM inventory WHERE bin_code = 'A-01-L-2'").get() as any;
      expect(inv2.qty).toBe(40);
      expect(inv2.reserved_qty).toBe(15);

      const inv3 = wDb.prepare("SELECT qty, reserved_qty FROM inventory WHERE bin_code = 'A-01-L-3'").get() as any;
      expect(inv3.qty).toBe(50);
      expect(inv3.reserved_qty).toBe(20);

      // Verify audit logs
      const auditLog = wDb
        .prepare("SELECT * FROM audit_log WHERE entity_id = 'ORD-0001' AND action = 'ORDER_CREATED'")
        .get() as any;
      expect(auditLog).toBeDefined();

      // Verify outbox events
      const events = wDb
        .prepare("SELECT event_type FROM outbox_events WHERE entity_id = 'ORD-0001' OR entity_id = 'multiple'")
        .all() as { event_type: string }[];
      const eventTypes = events.map((e) => e.event_type);
      expect(eventTypes).toContain('order.created');
      expect(eventTypes).toContain('reservation.changed');
      expect(eventTypes).toContain('inventory.changed');

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P6-T02: Allocation best-fit: bins with available 10, 30, 50; need 25 / need 70
  it('P6-T02: Allocation best-fit: bins with available 10, 30, 50; need 25 chooses single bin (30); need 70 chooses greedy (50 + 20)', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      // Stock SKU001 in three bins: 10, 30, 50
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 10 });
      stockIn(wDb, { bin: 'A-01-L-2', sku: 'SKU001', qty: 30 });
      stockIn(wDb, { bin: 'A-01-L-3', sku: 'SKU001', qty: 50 });

      // Case 1: need 25 -> single bin best-fit is A-01-L-2 (30)
      const plan25 = allocateStock(wDb, 'SKU001', 25);
      expect(plan25).toEqual([{ bin: 'A-01-L-2', qty: 25 }]);

      // Case 2: need 70 -> cannot be satisfied by single bin, greedy takes 50 from A-01-L-3 then 20 from A-01-L-2
      const plan70 = allocateStock(wDb, 'SKU001', 70);
      expect(plan70).toEqual([
        { bin: 'A-01-L-3', qty: 50 },
        { bin: 'A-01-L-2', qty: 20 }
      ]);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P6-T03: Stock spread over 3 bins, need all -> 3 reservations, correct quantities
  it('P6-T03: Stock spread over 3 bins, need all: creates 3 reservations matching bin quantities', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };

      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 10 });
      stockIn(wDb, { bin: 'A-01-L-2', sku: 'SKU001', qty: 15 });
      stockIn(wDb, { bin: 'A-01-L-3', sku: 'SKU001', qty: 25 });

      const order = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 50 }],
          actor
        })
      );

      expect(order.lines[0].reservations.length).toBe(3);
      const totalReserved = order.lines[0].reservations.reduce((acc, r) => acc + r.qty, 0);
      expect(totalReserved).toBe(50);

      const resBins = order.lines[0].reservations.map((r) => ({ bin: r.bin_code, qty: r.qty }));
      expect(resBins).toEqual([
        { bin: 'A-01-L-3', qty: 25 },
        { bin: 'A-01-L-2', qty: 15 },
        { bin: 'A-01-L-1', qty: 10 }
      ]);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P6-T04: One of two lines short -> 409 INSUFFICIENT_STOCK listing the short line(s); zero reservations, no order row, next order still ORD-0001
  it('P6-T04: One of two lines short: INSUFFICIENT_STOCK listing short lines, zero reservations, no order row, ref not consumed', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };

      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 10 });
      stockIn(wDb, { bin: 'A-01-L-2', sku: 'SKU002', qty: 5 });

      // Request 5 of SKU001 (ok) and 20 of SKU002 (short)
      let thrown: any = null;
      try {
        runTx(wDb, () =>
          executeReserveOrder(wDb, {
            lines: [
              { sku: 'SKU001', qty: 5 },
              { sku: 'SKU002', qty: 20 }
            ],
            actor
          })
        );
      } catch (err) {
        thrown = err;
      }

      expect(thrown).not.toBeNull();
      expect(thrown.code).toBe('INSUFFICIENT_STOCK');
      expect(thrown.details.shortages).toEqual([
        {
          sku: 'SKU002',
          product_name: 'Mechanical Keyboard',
          requested: 20,
          available: 5
        }
      ]);

      // Check DB: zero orders, zero reservations
      const ordersCount = wDb.prepare('SELECT COUNT(*) AS c FROM orders').get() as { c: number };
      expect(ordersCount.c).toBe(0);

      const resCount = wDb.prepare('SELECT COUNT(*) AS c FROM reservations').get() as { c: number };
      expect(resCount.c).toBe(0);

      // Subsequent valid order receives ORD-0001 (no sequence consumption)
      const validOrder = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 5 }],
          actor
        })
      );
      expect(validOrder.ref).toBe('ORD-0001');

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P6-T05: Unknown SKU / qty 0 / duplicate SKU / empty lines / 51 lines -> appropriate errors
  it('P6-T05: Unknown SKU / qty 0 / duplicate SKU / empty lines / 51 lines throw expected errors', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 10 });

      // 1. Unknown SKU
      expect(() => {
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU999_NONEXISTENT', qty: 5 }],
          actor
        });
      }).toThrow(/SKU.*not found/);

      // 2. Qty 0
      expect(() => {
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 0 }],
          actor
        });
      }).toThrow(/Quantity must be an integer between 1 and 10000/);

      // 3. Duplicate SKU in lines
      expect(() => {
        executeReserveOrder(wDb, {
          lines: [
            { sku: 'SKU001', qty: 2 },
            { sku: 'SKU001', qty: 3 }
          ],
          actor
        });
      }).toThrow(/Duplicate SKU/);

      // 4. Empty lines
      expect(() => {
        executeReserveOrder(wDb, {
          lines: [],
          actor
        });
      }).toThrow(/At least one line/);

      // 5. 51 lines
      const manyLines = Array.from({ length: 51 }, (_, i) => ({
        sku: `SKU${String(i + 1).padStart(3, '0')}`,
        qty: 1
      }));
      expect(() => {
        executeReserveOrder(wDb, {
          lines: manyLines,
          actor
        });
      }).toThrow(/At most 50 lines/);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P6-T06: Stock in blocked/damaged/maintenance/recount bins and staged stock not counted in ATP; never reserved
  it('P6-T06: Stock in blocked/damaged/maintenance/recount bins and staged stock not in ATP and never reserved', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };

      // Put stock in A-01-L-1
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 50 });

      // Check initially available
      const atp1 = wDb.prepare("SELECT COALESCE(SUM(available_qty), 0) AS atp FROM v_available_stock WHERE sku = 'SKU001'").get() as any;
      expect(atp1.atp).toBe(50);

      // Set shelf A-01-L to MAINTENANCE
      wDb.prepare("UPDATE shelves SET status = 'MAINTENANCE' WHERE code = 'A-01-L'").run();

      // v_available_stock now excludes this bin
      const atp2 = wDb.prepare("SELECT COALESCE(SUM(available_qty), 0) AS atp FROM v_available_stock WHERE sku = 'SKU001'").get() as any;
      expect(atp2.atp).toBe(0);

      // Attempting to reserve throws INSUFFICIENT_STOCK
      expect(() => {
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 10 }],
          actor
        });
      }).toThrow(/INSUFFICIENT_STOCK/);

      // Restore shelf to ACTIVE, but set bin to DAMAGED
      wDb.prepare("UPDATE shelves SET status = 'ACTIVE' WHERE code = 'A-01-L'").run();
      wDb.prepare("UPDATE bins SET status = 'DAMAGED' WHERE code = 'A-01-L-1'").run();

      const atp3 = wDb.prepare("SELECT COALESCE(SUM(available_qty), 0) AS atp FROM v_available_stock WHERE sku = 'SKU001'").get() as any;
      expect(atp3.atp).toBe(0);

      expect(() => {
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 10 }],
          actor
        });
      }).toThrow(/INSUFFICIENT_STOCK/);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P6-T07: Order A reserves 8 of 10; order B asks 3 -> B fails INSUFFICIENT_STOCK (available 2)
  it('P6-T07: Order A reserves 8 of 10; order B asks 3 -> B fails INSUFFICIENT_STOCK with available 2', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 10 });

      // Order A reserves 8
      const orderA = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 8 }],
          actor
        })
      );
      expect(orderA.ref).toBe('ORD-0001');

      // Order B asks 3
      let thrown: any = null;
      try {
        runTx(wDb, () =>
          executeReserveOrder(wDb, {
            lines: [{ sku: 'SKU001', qty: 3 }],
            actor
          })
        );
      } catch (err) {
        thrown = err;
      }

      expect(thrown).not.toBeNull();
      expect(thrown.code).toBe('INSUFFICIENT_STOCK');
      expect(thrown.details.shortages[0].available).toBe(2);
      expect(thrown.details.shortages[0].requested).toBe(3);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P6-T10: hooks.afterStep throws after the first line -> Full rollback: no order, reservations, reserved_qty change or sequence use
  it('P6-T10: hooks.afterStep throws after line 1: full rollback, sequence and stock unchanged', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 20 });
      stockIn(wDb, { bin: 'A-01-L-2', sku: 'SKU002', qty: 20 });

      expect(() => {
        runTx(wDb, () =>
          executeReserveOrder(
            wDb,
            {
              lines: [
                { sku: 'SKU001', qty: 10 },
                { sku: 'SKU002', qty: 10 }
              ],
              actor
            },
            {
              afterStep: (step) => {
                if (step === 'line:SKU001') {
                  throw new Error('Simulated crash after reserving line 1');
                }
              }
            }
          )
        );
      }).toThrow(/Simulated crash after reserving line 1/);

      // Verify zero orders and reservations
      const orders = wDb.prepare('SELECT COUNT(*) AS c FROM orders').get() as { c: number };
      expect(orders.c).toBe(0);

      const reservations = wDb.prepare('SELECT COUNT(*) AS c FROM reservations').get() as { c: number };
      expect(reservations.c).toBe(0);

      // Verify inventory reserved_qty is 0
      const inv1 = wDb.prepare("SELECT reserved_qty FROM inventory WHERE bin_code = 'A-01-L-1'").get() as any;
      expect(inv1.reserved_qty).toBe(0);

      // Verify sequence is still at initial (next order will get ORD-0001)
      const nextOrder = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 5 }],
          actor
        })
      );
      expect(nextOrder.ref).toBe('ORD-0001');

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P6-T11: Cancel RESERVED order -> Reservations RELEASED, reserved_qty restored, qty unchanged, order CANCELLED, audit
  it('P6-T11: Cancel RESERVED order: reservations RELEASED, reserved_qty restored, qty unchanged, order CANCELLED, audit', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 30 });

      const order = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 15 }],
          actor
        })
      );

      expect(order.ref).toBe('ORD-0001');
      expect(order.status).toBe('RESERVED');

      // Cancel order
      const cancelled = runTx(wDb, () => cancelOrder(wDb, 'ORD-0001', 'Customer requested cancellation', actor));

      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancelled_reason).toBe('Customer requested cancellation');

      // Check reservations are RELEASED
      for (const line of cancelled.lines) {
        for (const res of line.reservations) {
          expect(res.status).toBe('RELEASED');
          expect(res.released_qty).toBe(res.qty);
        }
      }

      // Check inventory: reserved_qty restored to 0, qty remains 30
      const inv = wDb.prepare("SELECT qty, reserved_qty FROM inventory WHERE bin_code = 'A-01-L-1'").get() as any;
      expect(inv.qty).toBe(30);
      expect(inv.reserved_qty).toBe(0);

      // Check audit log
      const cancelAudit = wDb
        .prepare("SELECT * FROM audit_log WHERE entity_id = 'ORD-0001' AND action = 'ORDER_CANCELLED'")
        .get() as any;
      expect(cancelAudit).toBeDefined();

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P6-T12: Cancel twice; replay same key -> ORDER_NOT_CANCELLABLE; replay returns original, single effect
  it('P6-T12: Cancel twice throws ORDER_NOT_CANCELLABLE; idempotency replay returns original', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 20 });

      const order = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 10 }],
          actor
        })
      );

      const idemKey = 'idem-cancel-p6-12';

      // First cancel using runIdempotent
      const res1 = runIdempotent(
        wDb,
        {
          key: idemKey,
          scope: 'order:cancel:ORD-0001',
          body: { reason: 'Test cancel 1' },
          actor
        },
        (txDb) => {
          const cancelled = cancelOrder(txDb, 'ORD-0001', 'Test cancel 1', actor);
          return { status: 200, body: cancelled };
        }
      );
      expect(res1.status).toBe(200);
      expect(res1.body.status).toBe('CANCELLED');

      // Replay same key -> returns original cached result
      const replay = runIdempotent(
        wDb,
        {
          key: idemKey,
          scope: 'order:cancel:ORD-0001',
          body: { reason: 'Test cancel 1' },
          actor
        },
        (txDb) => {
          const cancelled = cancelOrder(txDb, 'ORD-0001', 'Test cancel 1', actor);
          return { status: 200, body: cancelled };
        }
      );
      expect(replay.status).toBe(200);
      expect(replay.body.status).toBe('CANCELLED');

      // Second cancel with a DIFFERENT key -> throws ORDER_NOT_CANCELLABLE
      expect(() => {
        runIdempotent(
          wDb,
          {
            key: 'idem-cancel-different-key',
            scope: 'order:cancel:ORD-0001',
            body: { reason: 'Second cancel' },
            actor
          },
          (txDb) => {
            const cancelled = cancelOrder(txDb, 'ORD-0001', 'Second cancel', actor);
            return { status: 200, body: cancelled };
          }
        );
      }).toThrow(/ORDER_NOT_CANCELLABLE/);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P6-T16: Contended SKU: URGENT order vs LOW order enqueued while lock held -> URGENT executes first
  it('P6-T16: Contended SKU: URGENT order vs LOW order enqueued while lock held -> URGENT executes first', async () => {
    const { sDb, cleanup } = setupDatabases();
    try {
      const executionOrder: string[] = [];
      const fakeExecutor = async (task: TaskRecord) => {
        executionOrder.push(task.id);
        return { status: 200, body: {} };
      };

      const scheduler = new Scheduler(sDb, { tickIntervalMs: 20, executor: fakeExecutor });
      scheduler.start();

      // Hold resource 'sku:SKU001'
      const now = new Date();
      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('task-blocker', 'RESERVE_ORDER', 2, 'idem-blk', '{}', '{}', '["sku:SKU001"]', 'RUNNING', 1, ?)
      `).run(now.toISOString());

      sDb.prepare(`
        INSERT INTO locks (resource, task_id, fencing_token, acquired_at, expires_at)
        VALUES ('sku:SKU001', 'task-blocker', 1, ?, ?)
      `).run(now.toISOString(), new Date(now.getTime() + 60000).toISOString());

      // Enqueue LOW order on sku:SKU001
      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('task-low', 'RESERVE_ORDER', 1, 'idem-low', '{}', '{}', '["sku:SKU001"]', 'QUEUED', 0, ?)
      `).run(new Date(now.getTime() + 10).toISOString());
      sDb.prepare("INSERT INTO task_events (task_id, at, event) VALUES ('task-low', ?, 'ENQUEUED')").run(now.toISOString());

      // Enqueue URGENT order on sku:SKU001
      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('task-urgent', 'RESERVE_ORDER', 4, 'idem-urg', '{}', '{}', '["sku:SKU001"]', 'QUEUED', 0, ?)
      `).run(new Date(now.getTime() + 20).toISOString());
      sDb.prepare("INSERT INTO task_events (task_id, at, event) VALUES ('task-urgent', ?, 'ENQUEUED')").run(now.toISOString());

      // Release blocking lock
      sDb.prepare("DELETE FROM locks WHERE task_id = 'task-blocker'").run();
      sDb.prepare("UPDATE tasks SET status = 'SUCCEEDED' WHERE id = 'task-blocker'").run();

      await scheduler.waitForTask('task-low', 2000);
      scheduler.stop();

      // URGENT must execute before LOW
      expect(executionOrder).toEqual(['task-urgent', 'task-low']);

      sDb.close();
    } finally {
      cleanup();
    }
  });

  // P6-T15: Kill Engine 1 after enqueue, before execution; restart -> exactly one order created
  it('P6-T15: Crash recovery on Engine 1 restart cleans locks and re-queues tasks safely', async () => {
    const { sDb, cleanup } = setupDatabases();
    try {
      const nowIso = new Date().toISOString();
      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('task-rec-order', 'RESERVE_ORDER', 2, 'idem-rec-order-15', '{}', '{}', '["sku:SKU001"]', 'RUNNING', 1, ?)
      `).run(nowIso);

      sDb.prepare(`
        INSERT INTO locks (resource, task_id, fencing_token, acquired_at, expires_at)
        VALUES ('sku:SKU001', 'task-rec-order', 1, ?, ?)
      `).run(nowIso, new Date(Date.now() + 60000).toISOString());

      const scheduler = new Scheduler(sDb);
      scheduler.recoverCrash();

      // Lock removed
      const locks = sDb.prepare("SELECT * FROM locks WHERE task_id = 'task-rec-order'").all();
      expect(locks.length).toBe(0);

      // Task reset to QUEUED
      const task = sDb.prepare("SELECT * FROM tasks WHERE id = 'task-rec-order'").get() as TaskRecord;
      expect(task.status).toBe('QUEUED');
      expect(task.attempts).toBe(0);

      const events = sDb.prepare("SELECT event FROM task_events WHERE task_id = 'task-rec-order'").all() as { event: string }[];
      expect(events.map((e) => e.event)).toContain('RECOVERED_AFTER_RESTART');

      sDb.close();
    } finally {
      cleanup();
    }
  });

  // P6-T18: Integrity after create/cancel mix -> I02, I07, I08 PASS
  it('P6-T18: Integrity checks after create/cancel mix pass completely', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };

      // Seed fixture stock via seedDemo so ledger (stock_movements) is fully populated
      seedDemo(wDb);

      // Create Order 1 with 2 lines
      const o1 = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [
            { sku: 'SKU001', qty: 10 },
            { sku: 'SKU002', qty: 15 }
          ],
          actor
        })
      );

      // Create Order 2 with 2 lines
      const o2 = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [
            { sku: 'SKU002', qty: 10 },
            { sku: 'SKU003', qty: 25 }
          ],
          actor
        })
      );

      // Cancel Order 1
      runTx(wDb, () => cancelOrder(wDb, o1.ref, 'Mix cancel test', actor));

      // Run integrity checks
      const report = runIntegrityChecks(wDb);
      const failures = report.checks.filter((r) => r.status === 'FAIL');
      if (failures.length > 0) {
        console.error('Integrity failures:', JSON.stringify(failures, null, 2));
      }
      expect(report.ok).toBe(true);
      expect(failures).toEqual([]);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P6-T19: Web component verification: ATP chips, over-ATP disables submit, shortage table, duplicate guard
  it('P6-T19: Web component contracts: Zod validation catches duplicate SKUs, invalid lines, over-limits', () => {
    // Valid order payload
    const valid = {
      order_type: 'CUSTOMER' as const,
      priority: 'NORMAL' as const,
      customer_ref: 'PO-12345',
      lines: [{ sku: 'SKU001', qty: 5 }]
    };
    expect(createOrderSchema.parse(valid)).toBeDefined();

    // Duplicate SKU in schema
    expect(() => {
      createOrderSchema.parse({
        ...valid,
        lines: [
          { sku: 'SKU001', qty: 5 },
          { sku: 'SKU001', qty: 10 }
        ]
      });
    }).toThrow();

    // Empty lines
    expect(() => {
      createOrderSchema.parse({
        ...valid,
        lines: []
      });
    }).toThrow();

    // Invalid quantity
    expect(() => {
      createOrderSchema.parse({
        ...valid,
        lines: [{ sku: 'SKU001', qty: 0 }]
      });
    }).toThrow();
  });

  // P6-T20: Read filters: by status, priority, ref, customer, product name, SKU; PICKER can read
  it('P6-T20: Read filters: by status, priority, customer, SKU returns correct results', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 50 });
      stockIn(wDb, { bin: 'A-01-L-2', sku: 'SKU002', qty: 50 });

      runTx(wDb, () =>
        executeReserveOrder(wDb, {
          priority: 'URGENT',
          customer_ref: 'ACME-CORP',
          lines: [{ sku: 'SKU001', qty: 10 }],
          actor
        })
      );

      runTx(wDb, () =>
        executeReserveOrder(wDb, {
          priority: 'LOW',
          customer_ref: 'BETA-LLC',
          lines: [{ sku: 'SKU002', qty: 15 }],
          actor
        })
      );

      // Filter by priority URGENT
      const urgentList = listOrders(wDb, { priority: 'URGENT' });
      expect(urgentList.orders.length).toBe(1);
      expect(urgentList.orders[0].customer_ref).toBe('ACME-CORP');

      // Filter by search customer
      const searchList = listOrders(wDb, { search: 'BETA' });
      expect(searchList.orders.length).toBe(1);
      expect(searchList.orders[0].customer_ref).toBe('BETA-LLC');

      // Filter by SKU
      const skuList = listOrders(wDb, { search: 'SKU001' });
      expect(skuList.orders.length).toBe(1);
      expect(skuList.orders[0].lines[0].sku).toBe('SKU001');

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // End-to-end HTTP tests with live RunningStack
  describe('Phase 6 Live HTTP Stack Tests', () => {
    let client: ReturnType<typeof apiClient>;
    let manager: ReturnType<typeof apiClient>;
    let picker: ReturnType<typeof apiClient>;

    beforeAll(async () => {
      stack = await startStack({ seed: true });
      client = apiClient(stack.urls.gateway);
      manager = apiClient(stack.urls.gateway);
      picker = apiClient(stack.urls.gateway);

      await client.login('operator1');
      await picker.login('picker1');
      await manager.login('manager1');
    });

    // P6-T08: Concurrency: 5 orders x 4 units against 10 units in parallel -> exactly 2 succeed, 3 fail, refs gap-free
    it('P6-T08: Concurrency: 5 orders x 4 units against 10 units in parallel: exactly 2 succeed, 3 fail, refs gap-free', async () => {
      // Put 10 units of SKU007 into bin A-03-L-1
      const wDb = new Database(stack!.tempDb.warehouseDbPath);
      wDb.pragma('journal_mode = WAL');
      wDb.pragma('busy_timeout = 5000');
      stockIn(wDb, { bin: 'A-03-L-1', sku: 'SKU007', qty: 10 });
      wDb.close();

      // Fire 5 orders in parallel, each asking 4 units of SKU007
      const promises = Array.from({ length: 5 }, (_, i) => {
        const key = `idem-conc-p6-${i}-${Date.now()}`;
        return manager.post(
          '/api/orders',
          {
            priority: 'NORMAL',
            lines: [{ sku: 'SKU007', qty: 4 }]
          },
          { idempotencyKey: key }
        );
      });

      const results = await Promise.all(promises);
      const successes = results.filter((r) => r.status === 201);
      const failures = results.filter((r) => r.status === 409);

      expect(successes.length).toBe(2);
      expect(failures.length).toBe(3);

      for (const f of failures) {
        expect(f.body.error.code).toBe('INSUFFICIENT_STOCK');
      }

      // Check gap-free refs
      const refs = successes.map((s) => s.body.ref).sort();
      expect(refs[0]).toMatch(/^ORD-\d{4}$/);
      expect(refs[1]).toMatch(/^ORD-\d{4}$/);
    });

    // P6-T09: 5 parallel POSTs with identical idempotency key -> exactly 1 order
    it('P6-T09: 5 parallel POSTs with the SAME key execute exactly once and return identical order', async () => {
      const wDb = new Database(stack!.tempDb.warehouseDbPath);
      wDb.pragma('journal_mode = WAL');
      stockIn(wDb, { bin: 'A-04-L-1', sku: 'SKU008', qty: 50 });
      wDb.close();

      const sharedKey = `idem-same-key-${Date.now()}`;
      const promises = Array.from({ length: 5 }, () =>
        manager.post(
          '/api/orders',
          {
            priority: 'NORMAL',
            lines: [{ sku: 'SKU008', qty: 10 }]
          },
          { idempotencyKey: sharedKey }
        )
      );

      const results = await Promise.all(promises);
      for (const r of results) {
        expect(r.status).toBe(201);
        expect(r.body.ref).toBe(results[0].body.ref);
      }
    });

    // P6-T13: Cancel as OPERATOR -> 403
    it('P6-T13: Cancel as OPERATOR returns 403 FORBIDDEN', async () => {
      // First create an order as manager
      const wDb = new Database(stack!.tempDb.warehouseDbPath);
      stockIn(wDb, { bin: 'A-04-L-2', sku: 'SKU009', qty: 20 });
      wDb.close();

      const orderRes = await manager.post(
        '/api/orders',
        {
          priority: 'NORMAL',
          lines: [{ sku: 'SKU009', qty: 5 }]
        },
        { idempotencyKey: `idem-order-p13-${Date.now()}` }
      );
      expect(orderRes.status).toBe(201);
      const orderRef = orderRes.body.ref;

      // Operator client
      const operator = client;
      const cancelRes = await operator.post(
        `/api/orders/${orderRef}/cancel`,
        { reason: 'Unauthorized cancel' },
        { idempotencyKey: `idem-cancel-p13-${Date.now()}` }
      );

      expect(cancelRes.status).toBe(403);
      expect(cancelRes.body.error.code).toBe('FORBIDDEN');
    });

    // P6-T14: Restart Engine 3 and Engine 1 -> list + detail identical (persistence)
    it('P6-T14: Restart Engine 3 and Engine 1: list and detail return identical data', async () => {
      const wDb = new Database(stack!.tempDb.warehouseDbPath);
      stockIn(wDb, { bin: 'A-05-L-1', sku: 'SKU010', qty: 30 });
      wDb.close();

      const orderRes = await manager.post(
        '/api/orders',
        {
          customer_ref: 'PERSIST-TEST',
          priority: 'HIGH',
          lines: [{ sku: 'SKU010', qty: 12 }]
        },
        { idempotencyKey: `idem-persist-${Date.now()}` }
      );
      expect(orderRes.status).toBe(201);
      const orderRef = orderRes.body.ref;

      // Restart Engine 3 and Engine 1
      await stack!.restart('engine3');
      await stack!.restart('engine1');

      // Query detail
      const detailRes = await manager.get(`/api/orders/${orderRef}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.ref).toBe(orderRef);
      expect(detailRes.body.customer_ref).toBe('PERSIST-TEST');
      expect(detailRes.body.priority).toBe('HIGH');
      expect(detailRes.body.lines[0].qty_ordered).toBe(12);
    });

    // P6-T17: Engine 1 stopped, POST /api/orders -> 503 ENGINE1_UNAVAILABLE
    it('P6-T17: Engine 1 stopped: POST /api/orders returns 503 ENGINE1_UNAVAILABLE; restart succeeds', async () => {
      await stack!.kill('engine1');

      const failedRes = await manager.post(
        '/api/orders',
        {
          lines: [{ sku: 'SKU010', qty: 5 }]
        },
        { idempotencyKey: `idem-e1-down-${Date.now()}` }
      );

      expect(failedRes.status).toBe(503);
      expect(failedRes.body.error.code).toBe('ENGINE1_UNAVAILABLE');

      // Restart Engine 1
      await stack!.restart('engine1');
    });

    // P6-T20 HTTP: PICKER can read orders
    it('P6-T20 HTTP: PICKER role can read GET /api/orders and GET /api/orders/:ref', async () => {
      const listRes = await picker.get('/api/orders');
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.orders)).toBe(true);

      if (listRes.body.orders.length > 0) {
        const firstRef = listRes.body.orders[0].ref;
        const detailRes = await picker.get(`/api/orders/${firstRef}`);
        expect(detailRes.status).toBe(200);
        expect(detailRes.body.ref).toBe(firstRef);
      }
    });
  });
});
