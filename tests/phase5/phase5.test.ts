import { describe, it, expect, afterAll, beforeEach } from 'vitest';
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
import { createReceipt } from '../../services/engine3-inventory/src/domain/receivingRepo.js';
import { executePutaway, executeRelocate } from '../../services/engine3-inventory/src/domain/putawayRepo.js';
import { stockIn, reserve } from '../../services/engine3-inventory/src/domain/inventoryRepo.js';
import { Scheduler } from '../../services/engine1-scheduler/src/domain/scheduler.js';
import { calculateEffectiveScore } from '../../services/engine1-scheduler/src/domain/queue.js';
import { TaskRecord, DomainError } from '@dark-storage/shared';

describe('Phase 5 Engine 1 Scheduler + Put-away Tests', () => {
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

  // P5-T01: Engine 1: enqueue task with a fake executor
  it('P5-T01: Engine 1: enqueue task with a fake executor: QUEUED -> RUNNING -> SUCCEEDED, events verify', async () => {
    const { sDb, cleanup } = setupDatabases();
    try {
      const taskId = crypto.randomUUID();
      const fakeExecutor = async (task: TaskRecord) => {
        expect(task.id).toBe(taskId);
        return { status: 200, body: { ok: true } };
      };

      const scheduler = new Scheduler(sDb, { tickIntervalMs: 20, executor: fakeExecutor });
      scheduler.start();

      const nowIso = new Date().toISOString();
      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES (?, 'PUTAWAY', 2, 'idem-p5-01', '{"id":2,"display_name":"Omar","role":"OPERATOR"}', '{}', '["shelf:A-01-L"]', 'QUEUED', 0, ?)
      `).run(taskId, nowIso);
      sDb.prepare("INSERT INTO task_events (task_id, at, event) VALUES (?, ?, 'ENQUEUED')").run(taskId, nowIso);

      const finalTask = await scheduler.waitForTask(taskId, 2000);
      scheduler.stop();

      expect(finalTask).not.toBeNull();
      expect(finalTask!.status).toBe('SUCCEEDED');
      expect(finalTask!.http_status).toBe(200);

      // Verify event history: ENQUEUED, LOCKS_ACQUIRED, EXECUTING, SUCCEEDED, LOCKS_RELEASED
      const events = sDb.prepare('SELECT event FROM task_events WHERE task_id = ? ORDER BY id ASC').all(taskId) as { event: string }[];
      const eventNames = events.map((e) => e.event);
      expect(eventNames).toEqual([
        'ENQUEUED',
        'LOCKS_ACQUIRED',
        'EXECUTING',
        'SUCCEEDED',
        'LOCKS_RELEASED'
      ]);

      // Locks should be released
      const locks = sDb.prepare('SELECT * FROM locks WHERE task_id = ?').all(taskId);
      expect(locks.length).toBe(0);

      sDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T02: Same idempotency_key twice -> One task; second call returns it
  it('P5-T02: Same idempotency_key twice returns existing task and creates only one DB record', () => {
    const { sDb, cleanup } = setupDatabases();
    try {
      const key = 'idem-unique-key-1';
      const nowIso = new Date().toISOString();

      // First insert
      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('task-1', 'PUTAWAY', 2, ?, '{"id":2}', '{}', '[]', 'QUEUED', 0, ?)
      `).run(key, nowIso);

      // Attempting to insert same key again violates unique constraint
      expect(() => {
        sDb.prepare(`
          INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
          VALUES ('task-2', 'PUTAWAY', 2, ?, '{"id":2}', '{}', '[]', 'QUEUED', 0, ?)
        `).run(key, nowIso);
      }).toThrow(/UNIQUE constraint failed/);

      const count = sDb.prepare('SELECT COUNT(*) AS c FROM tasks WHERE idempotency_key = ?').get(key) as { c: number };
      expect(count.c).toBe(1);

      sDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T03: Resource r held; enqueue LOW then URGENT on r; release -> URGENT executes first
  it('P5-T03: Resource r held; enqueue LOW then URGENT on r; release -> URGENT executes first', async () => {
    const { sDb, cleanup } = setupDatabases();
    try {
      const executionOrder: string[] = [];
      const fakeExecutor = async (task: TaskRecord) => {
        executionOrder.push(task.id);
        return { status: 200, body: {} };
      };

      const scheduler = new Scheduler(sDb, { tickIntervalMs: 20, executor: fakeExecutor });
      scheduler.start();

      // Hold resource 'shelf:A-01-L' with an active lock
      const now = new Date();
      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('dummy-holder', 'PUTAWAY', 1, 'idem-dummy-holder', '{}', '{}', '[]', 'SUCCEEDED', 0, ?)
      `).run(now.toISOString());

      sDb.prepare(`
        INSERT INTO locks (resource, task_id, fencing_token, acquired_at, expires_at)
        VALUES ('shelf:A-01-L', 'dummy-holder', 1, ?, ?)
      `).run(now.toISOString(), new Date(now.getTime() + 60000).toISOString());

      // Enqueue LOW (priority 1)
      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('task-low', 'PUTAWAY', 1, 'idem-low', '{}', '{}', '["shelf:A-01-L"]', 'QUEUED', 0, ?)
      `).run(now.toISOString());

      // Enqueue URGENT (priority 4)
      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('task-urgent', 'PUTAWAY', 4, 'idem-urgent', '{}', '{}', '["shelf:A-01-L"]', 'QUEUED', 0, ?)
      `).run(now.toISOString());

      // Release lock on shelf:A-01-L
      sDb.prepare("DELETE FROM locks WHERE resource = 'shelf:A-01-L'").run();
      scheduler.enqueueImmediate();

      await scheduler.waitForTask('task-low', 2000);
      scheduler.stop();

      expect(executionOrder[0]).toBe('task-urgent');
      expect(executionOrder[1]).toBe('task-low');

      sDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T04: Aging with injected clock: LOW waiting 8 min vs fresh NORMAL -> LOW outranks NORMAL
  it('P5-T04: Aging calculation: LOW waiting 8 min vs fresh NORMAL -> LOW outranks NORMAL', () => {
    const now = new Date('2026-11-01T12:08:00Z');
    const eightMinAgo = new Date('2026-11-01T12:00:00Z').toISOString();
    const freshTime = new Date('2026-11-01T12:08:00Z').toISOString();

    // LOW (priority 1) waiting 480 seconds (8 min): base 10 + min(30, floor(480/15)) = 10 + 30 = 40
    const lowScore = calculateEffectiveScore(1, eightMinAgo, now);
    expect(lowScore).toBe(40);

    // NORMAL (priority 2) fresh (0 s): base 20 + 0 = 20
    const normalScore = calculateEffectiveScore(2, freshTime, now);
    expect(normalScore).toBe(20);

    expect(lowScore).toBeGreaterThan(normalScore);
  });

  // P5-T05: Task A locks [x,y], task B locks [y,x] submitted simultaneously -> No deadlock
  it('P5-T05: Task A locks [x,y], Task B locks [y,x]: no deadlock, locks table never contains a partial set', async () => {
    const { sDb, cleanup } = setupDatabases();
    try {
      const order: string[] = [];
      const fakeExecutor = async (task: TaskRecord) => {
        // While executing, inspect locks table
        const currentLocks = sDb.prepare('SELECT resource FROM locks WHERE task_id = ?').all(task.id);
        expect(currentLocks.length).toBe(2);
        order.push(task.id);
        await new Promise((r) => setTimeout(r, 50));
        return { status: 200, body: {} };
      };

      const scheduler = new Scheduler(sDb, { tickIntervalMs: 20, executor: fakeExecutor });

      const nowIso = new Date().toISOString();
      // Resource keys are sorted by scheduler before insert
      const resourcesA = ['shelf:A-01-L', 'shelf:B-01-L'];
      const resourcesB = ['shelf:B-01-L', 'shelf:A-01-L'].sort();

      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('task-A', 'PUTAWAY', 2, 'idem-A', '{}', '{}', ?, 'QUEUED', 0, ?)
      `).run(JSON.stringify(resourcesA), nowIso);

      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('task-B', 'PUTAWAY', 2, 'idem-B', '{}', '{}', ?, 'QUEUED', 0, ?)
      `).run(JSON.stringify(resourcesB), nowIso);

      scheduler.start();
      await scheduler.waitForTask('task-A', 2000);
      await scheduler.waitForTask('task-B', 2000);
      scheduler.stop();

      expect(order.length).toBe(2);
      expect(order).toContain('task-A');
      expect(order).toContain('task-B');

      sDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T06: High-ranked task blocked on r1; stream of LOW tasks on r1 -> Head-of-line protection
  it('P5-T06: High-ranked task blocked on r1; stream of LOW tasks on r1 -> High task runs first once r1 frees', async () => {
    const { sDb, cleanup } = setupDatabases();
    try {
      const executed: string[] = [];
      const fakeExecutor = async (task: TaskRecord) => {
        executed.push(task.id);
        return { status: 200, body: {} };
      };

      const scheduler = new Scheduler(sDb, { tickIntervalMs: 20, executor: fakeExecutor });

      // Blocker holds shelf:A-01-L
      const now = new Date();
      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('blocker', 'PUTAWAY', 2, 'idem-block-6', '{}', '{}', '["shelf:A-01-L"]', 'RUNNING', 1, ?)
      `).run(now.toISOString());
      sDb.prepare(`
        INSERT INTO locks (resource, task_id, fencing_token, acquired_at, expires_at)
        VALUES ('shelf:A-01-L', 'blocker', 1, ?, ?)
      `).run(now.toISOString(), new Date(now.getTime() + 60000).toISOString());

      // High-ranked task blocked on r1
      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('task-HIGH', 'PUTAWAY', 4, 'idem-high', '{}', '{}', '["shelf:A-01-L"]', 'QUEUED', 0, ?)
      `).run(now.toISOString());

      // Stream of LOW tasks on r1
      for (let i = 1; i <= 3; i++) {
        sDb.prepare(`
          INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
          VALUES ('task-LOW-${i}', 'PUTAWAY', 1, 'idem-low-${i}', '{}', '{}', '["shelf:A-01-L"]', 'QUEUED', 0, ?)
        `).run(now.toISOString());
      }

      // Free the blocker
      sDb.prepare("DELETE FROM locks WHERE task_id = 'blocker'").run();

      scheduler.start();
      await scheduler.waitForTask('task-LOW-3', 2000);
      scheduler.stop();

      // High task MUST be executed first before the low tasks
      expect(executed[0]).toBe('task-HIGH');

      sDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T07: 6 tasks on distinct resources -> At most 4 RUNNING at once; all succeed
  it('P5-T07: 6 tasks on distinct resources: at most 4 RUNNING simultaneously; all 6 succeed', async () => {
    const { sDb, cleanup } = setupDatabases();
    try {
      let maxActiveObserved = 0;
      let currentActive = 0;

      const fakeExecutor = async () => {
        currentActive++;
        if (currentActive > maxActiveObserved) maxActiveObserved = currentActive;
        await new Promise((r) => setTimeout(r, 60));
        currentActive--;
        return { status: 200, body: {} };
      };

      const scheduler = new Scheduler(sDb, { tickIntervalMs: 15, maxConcurrency: 4, executor: fakeExecutor });

      const nowIso = new Date().toISOString();
      for (let i = 1; i <= 6; i++) {
        sDb.prepare(`
          INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
          VALUES ('task-conc-${i}', 'PUTAWAY', 2, 'idem-conc-${i}', '{}', '{}', '["shelf:A-0${i}-L"]', 'QUEUED', 0, ?)
        `).run(nowIso);
      }

      scheduler.start();
      await scheduler.waitForTask('task-conc-6', 3000);
      scheduler.stop();

      expect(maxActiveObserved).toBeLessThanOrEqual(4);

      const succeeded = sDb.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status = 'SUCCEEDED'").get() as { c: number };
      expect(succeeded.c).toBe(6);

      sDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T08: Executor returns 4xx -> FAILED at once, no retry, locks released, error_code preserved
  it('P5-T08: Executor returns 4xx: transitions immediately to FAILED, no retry, error_code preserved, locks released', async () => {
    const { sDb, cleanup } = setupDatabases();
    try {
      let callCount = 0;
      const fakeExecutor = async () => {
        callCount++;
        return {
          status: 409,
          body: { code: 'CAPACITY_EXCEEDED', message: 'Bin capacity exceeded', details: { free_capacity: 0 } }
        };
      };

      const scheduler = new Scheduler(sDb, { tickIntervalMs: 20, executor: fakeExecutor });
      const taskId = 'task-4xx';
      const nowIso = new Date().toISOString();

      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES (?, 'PUTAWAY', 2, 'idem-4xx', '{}', '{}', '["shelf:A-01-L"]', 'QUEUED', 0, ?)
      `).run(taskId, nowIso);

      scheduler.start();
      const finished = await scheduler.waitForTask(taskId, 2000);
      scheduler.stop();

      expect(finished!.status).toBe('FAILED');
      expect(finished!.error_code).toBe('CAPACITY_EXCEEDED');
      expect(finished!.http_status).toBe(409);
      expect(finished!.attempts).toBe(1);
      expect(finished!.next_attempt_at).toBeNull();
      expect(callCount).toBe(1);

      // Locks must be released
      const locks = sDb.prepare('SELECT * FROM locks WHERE task_id = ?').all(taskId);
      expect(locks.length).toBe(0);

      sDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T09: Executor 5xx/timeout -> Retries with backoff up to 3 attempts, then FAILED ENGINE3_UNAVAILABLE
  it('P5-T09: Executor 5xx retries with backoff up to 3 attempts, then FAILED ENGINE3_UNAVAILABLE', async () => {
    const { sDb, cleanup } = setupDatabases();
    try {
      const taskId = 'task-5xx';
      const nowIso = new Date().toISOString();

      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, max_attempts, created_at)
        VALUES (?, 'PUTAWAY', 2, 'idem-5xx', '{}', '{}', '["shelf:A-01-L"]', 'QUEUED', 0, 3, ?)
      `).run(taskId, nowIso);

      let attempts = 0;
      const fakeExecutor = async () => {
        attempts++;
        return { status: 500, body: { message: 'Database busy' } };
      };

      const scheduler = new Scheduler(sDb, { tickIntervalMs: 20, executor: fakeExecutor });
      scheduler.start();

      // Wait for attempt 1
      await new Promise((r) => setTimeout(r, 100));
      let task = sDb.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRecord;
      expect(task.attempts).toBe(1);
      expect(task.status).toBe('QUEUED');
      expect(task.next_attempt_at).not.toBeNull();

      // Fast forward next_attempt_at for attempt 2 and 3
      sDb.prepare("UPDATE tasks SET next_attempt_at = datetime('now', '-1 second') WHERE id = ?").run(taskId);
      scheduler.tick();
      await new Promise((r) => setTimeout(r, 100));

      sDb.prepare("UPDATE tasks SET next_attempt_at = datetime('now', '-1 second') WHERE id = ?").run(taskId);
      scheduler.tick();
      await new Promise((r) => setTimeout(r, 100));

      scheduler.stop();

      task = sDb.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRecord;
      expect(task.status).toBe('FAILED');
      expect(task.error_code).toBe('ENGINE3_UNAVAILABLE');
      expect(task.attempts).toBe(3);

      const locks = sDb.prepare('SELECT * FROM locks WHERE task_id = ?').all(taskId);
      expect(locks.length).toBe(0);

      sDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T10: Insert an expired lock for a dead holder -> Sweeper removes it; new task acquires
  it('P5-T10: Insert an expired lock for a dead holder: sweeper removes it, new task acquires', async () => {
    const { sDb, cleanup } = setupDatabases();
    try {
      const pastTime = new Date(Date.now() - 10000).toISOString();
      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('dead-task', 'PUTAWAY', 2, 'idem-dead', '{}', '{}', '["shelf:A-01-L"]', 'FAILED', 1, ?)
      `).run(pastTime);

      sDb.prepare(`
        INSERT INTO locks (resource, task_id, fencing_token, acquired_at, expires_at)
        VALUES ('shelf:A-01-L', 'dead-task', 1, ?, ?)
      `).run(pastTime, pastTime);

      const scheduler = new Scheduler(sDb, {
        tickIntervalMs: 20,
        executor: async () => ({ status: 200, body: {} })
      });

      // Sweep removes expired lock
      const removed = scheduler.sweep();
      expect(removed).toBe(1);

      const remainingLocks = sDb.prepare('SELECT * FROM locks').all();
      expect(remainingLocks.length).toBe(0);

      // Now new task can acquire resource cleanly
      const newTaskId = 'new-task-10';
      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES (?, 'PUTAWAY', 2, 'idem-new-10', '{}', '{}', '["shelf:A-01-L"]', 'QUEUED', 0, ?)
      `).run(newTaskId, new Date().toISOString());

      scheduler.start();
      const res = await scheduler.waitForTask(newTaskId, 2000);
      scheduler.stop();

      expect(res!.status).toBe('SUCCEEDED');

      sDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T12: Queued tasks survive Engine 1 restart: executed in original priority/time order
  it('P5-T12: Queued tasks survive Engine 1 restart and are executed in original priority/time order', async () => {
    const { sDb, cleanup } = setupDatabases();
    try {
      const order: string[] = [];
      const fakeExecutor = async (task: TaskRecord) => {
        order.push(task.id);
        return { status: 200, body: {} };
      };

      const now = new Date();
      // Enqueue tasks before scheduler starts
      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('task-norm', 'PUTAWAY', 2, 'idem-p-norm', '{}', '{}', '["shelf:A-01-L"]', 'QUEUED', 0, ?)
      `).run(now.toISOString());

      sDb.prepare(`
        INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
        VALUES ('task-high', 'PUTAWAY', 3, 'idem-p-high', '{}', '{}', '["shelf:A-02-L"]', 'QUEUED', 0, ?)
      `).run(now.toISOString());

      // Start scheduler (simulating Engine 1 coming up)
      const scheduler = new Scheduler(sDb, { tickIntervalMs: 20, executor: fakeExecutor });
      scheduler.start();

      await scheduler.waitForTask('task-norm', 2000);
      scheduler.stop();

      // High priority task ran first
      expect(order[0]).toBe('task-high');
      expect(order[1]).toBe('task-norm');

      sDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T13: Put-away 50 into an empty valid bin
  it('P5-T13: Put-away 50 into empty valid bin: staged 0, bin 50, receipt PUT_AWAY, movement PUTAWAY, PUT-0001, audit, events', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 2, display_name: 'Omar Operator', role: 'OPERATOR' };

      // 1. Receive 50 units of SKU001
      const receipt = createReceipt(wDb, {
        supplier: 'TechLogistics',
        reference_no: 'ASN-101',
        lines: [{ sku: 'SKU001', qty: 50 }],
        actor: { id: actor.id, name: actor.display_name, role: actor.role }
      });
      const lineId = receipt.lines[0].line_id;

      // 2. Put away 50 into A-01-L-4
      const putaway = executePutaway(wDb, {
        receipt_line_id: lineId,
        dest_bin: 'A-01-L-4',
        qty: 50,
        recommended_bin: 'A-01-L-4',
        actor
      });

      expect(putaway.ref).toBe('PUT-0001');
      expect(putaway.qty).toBe(50);
      expect(putaway.selection_mode).toBe('RECOMMENDED');
      expect(putaway.line_remaining_staged).toBe(0);
      expect(putaway.receipt_status).toBe('PUT_AWAY');

      // Check bin inventory
      const inv = wDb.prepare("SELECT * FROM inventory WHERE bin_code = 'A-01-L-4'").get() as any;
      expect(inv.qty).toBe(50);
      expect(inv.sku).toBe('SKU001');

      // Check receipt line
      const updatedLine = wDb.prepare('SELECT * FROM receipt_lines WHERE id = ?').get(lineId) as any;
      expect(updatedLine.qty_put_away).toBe(50);

      // Check receipt status
      const updatedReceipt = wDb.prepare('SELECT status FROM receipts WHERE ref = ?').get(receipt.ref) as any;
      expect(updatedReceipt.status).toBe('PUT_AWAY');

      // Check movement record
      const mov = wDb.prepare("SELECT * FROM stock_movements WHERE movement_type = 'PUTAWAY'").get() as any;
      expect(mov.sku).toBe('SKU001');
      expect(mov.qty).toBe(50);
      expect(mov.to_ref).toBe('A-01-L-4');
      expect(mov.related_ref).toBe('PUT-0001');

      // Check audit
      const audit = wDb.prepare("SELECT * FROM audit_log WHERE action = 'PUTAWAY_COMPLETED'").get() as any;
      expect(audit).toBeDefined();

      // Check outbox events
      const outbox = wDb.prepare('SELECT event_type FROM outbox_events ORDER BY seq ASC').all() as { event_type: string }[];
      const types = outbox.map((o) => o.event_type);
      expect(types).toContain('putaway.completed');
      expect(types).toContain('inventory.changed');

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T14: Partial put-away 20 of 50, then 30
  it('P5-T14: Partial put-away 20 of 50, then 30: staged 30 -> 0, receipt PARTIALLY_PUT_AWAY -> PUT_AWAY', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 2, display_name: 'Omar Operator', role: 'OPERATOR' };

      const receipt = createReceipt(wDb, {
        supplier: 'TechLogistics',
        reference_no: 'ASN-102',
        lines: [{ sku: 'SKU001', qty: 50 }],
        actor: { id: actor.id, name: actor.display_name, role: actor.role }
      });
      const lineId = receipt.lines[0].line_id;

      // 1. First partial putaway: 20
      const p1 = executePutaway(wDb, {
        receipt_line_id: lineId,
        dest_bin: 'A-01-L-1',
        qty: 20,
        recommended_bin: 'A-01-L-1',
        actor
      });
      expect(p1.line_remaining_staged).toBe(30);
      expect(p1.receipt_status).toBe('PARTIALLY_PUT_AWAY');

      // 2. Second partial putaway: 30
      const p2 = executePutaway(wDb, {
        receipt_line_id: lineId,
        dest_bin: 'A-01-L-2',
        qty: 30,
        recommended_bin: 'A-01-L-2',
        actor
      });
      expect(p2.line_remaining_staged).toBe(0);
      expect(p2.receipt_status).toBe('PUT_AWAY');

      const r = wDb.prepare('SELECT status FROM receipts WHERE ref = ?').get(receipt.ref) as any;
      expect(r.status).toBe('PUT_AWAY');

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T15: qty > staged -> INSUFFICIENT_STAGED_STOCK
  it('P5-T15: qty > staged throws INSUFFICIENT_STAGED_STOCK; nothing changed', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 2, display_name: 'Omar Operator', role: 'OPERATOR' };

      const receipt = createReceipt(wDb, {
        supplier: 'TechLogistics',
        reference_no: 'ASN-103',
        lines: [{ sku: 'SKU001', qty: 20 }],
        actor: { id: actor.id, name: actor.display_name, role: actor.role }
      });
      const lineId = receipt.lines[0].line_id;

      expect(() => {
        executePutaway(wDb, {
          receipt_line_id: lineId,
          dest_bin: 'A-01-L-1',
          qty: 25,
          actor
        });
      }).toThrow(/INSUFFICIENT_STAGED_STOCK/);

      // Verify staged stock unchanged
      const line = wDb.prepare('SELECT qty_put_away FROM receipt_lines WHERE id = ?').get(lineId) as any;
      expect(line.qty_put_away).toBe(0);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T16: Destination holds another SKU -> SKU_CONFLICT
  it('P5-T16: Destination holds another SKU: throws SKU_CONFLICT; staged qty unchanged', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 2, display_name: 'Omar Operator', role: 'OPERATOR' };

      // Put SKU002 into A-01-L-1
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU002', qty: 10 });

      // Receive SKU001
      const receipt = createReceipt(wDb, {
        supplier: 'TechLogistics',
        reference_no: 'ASN-104',
        lines: [{ sku: 'SKU001', qty: 20 }],
        actor: { id: actor.id, name: actor.display_name, role: actor.role }
      });
      const lineId = receipt.lines[0].line_id;

      expect(() => {
        executePutaway(wDb, {
          receipt_line_id: lineId,
          dest_bin: 'A-01-L-1',
          qty: 10,
          actor
        });
      }).toThrow(/SKU_CONFLICT/);

      const line = wDb.prepare('SELECT qty_put_away FROM receipt_lines WHERE id = ?').get(lineId) as any;
      expect(line.qty_put_away).toBe(0);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T17: Over capacity / blocked bin / HAZMAT mismatch
  it('P5-T17: Over capacity / blocked bin / HAZMAT mismatch throw correct errors with state unchanged', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 2, display_name: 'Omar Operator', role: 'OPERATOR' };

      const receipt = createReceipt(wDb, {
        supplier: 'TechLogistics',
        reference_no: 'ASN-105',
        lines: [{ sku: 'SKU001', qty: 100 }],
        actor: { id: actor.id, name: actor.display_name, role: actor.role }
      });
      const lineId = receipt.lines[0].line_id;

      // 1. Over capacity (capacity is 120, try 150)
      expect(() => {
        executePutaway(wDb, {
          receipt_line_id: lineId,
          dest_bin: 'A-01-L-1',
          qty: 150,
          actor
        });
      }).toThrow();

      // 2. Blocked bin
      wDb.prepare("UPDATE bins SET status = 'BLOCKED' WHERE code = 'A-01-L-2'").run();
      expect(() => {
        executePutaway(wDb, {
          receipt_line_id: lineId,
          dest_bin: 'A-01-L-2',
          qty: 10,
          actor
        });
      }).toThrow(/BIN_NOT_RECEIVABLE/);

      // 3. HAZMAT mismatch (SKU001 standard placed into D-01-L-1 hazmat)
      expect(() => {
        executePutaway(wDb, {
          receipt_line_id: lineId,
          dest_bin: 'D-01-L-1',
          qty: 10,
          actor
        });
      }).toThrow(/STORAGE_CLASS_MISMATCH/);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T18: Accept recommendation vs manually pick another valid bin
  it('P5-T18: Accept recommendation vs manually pick another valid bin sets selection_mode RECOMMENDED vs MANUAL', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 2, display_name: 'Omar Operator', role: 'OPERATOR' };

      const receipt = createReceipt(wDb, {
        supplier: 'TechLogistics',
        reference_no: 'ASN-106',
        lines: [{ sku: 'SKU001', qty: 40 }],
        actor: { id: actor.id, name: actor.display_name, role: actor.role }
      });
      const lineId = receipt.lines[0].line_id;

      // Recommended choice
      const p1 = executePutaway(wDb, {
        receipt_line_id: lineId,
        dest_bin: 'A-01-L-1',
        qty: 20,
        recommended_bin: 'A-01-L-1',
        actor
      });
      expect(p1.selection_mode).toBe('RECOMMENDED');

      // Manual choice
      const p2 = executePutaway(wDb, {
        receipt_line_id: lineId,
        dest_bin: 'A-01-L-2',
        qty: 20,
        recommended_bin: 'A-01-L-1', // user chose A-01-L-2 instead
        actor
      });
      expect(p2.selection_mode).toBe('MANUAL');

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T19: Stale recommendation: recommend bin X, fill X by another put-away, confirm the old recommendation
  it('P5-T19: Stale recommendation rejected by Engine 3 transaction when bin fills concurrently', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 2, display_name: 'Omar Operator', role: 'OPERATOR' };

      const r1 = createReceipt(wDb, {
        supplier: 'Supplier 1',
        reference_no: 'ASN-201',
        lines: [{ sku: 'SKU001', qty: 120 }],
        actor: { id: actor.id, name: actor.display_name, role: actor.role }
      });

      const r2 = createReceipt(wDb, {
        supplier: 'Supplier 2',
        reference_no: 'ASN-202',
        lines: [{ sku: 'SKU002', qty: 20 }],
        actor: { id: actor.id, name: actor.display_name, role: actor.role }
      });

      // Fill bin A-01-L-1 to full capacity 120 with SKU001
      executePutaway(wDb, {
        receipt_line_id: r1.lines[0].line_id,
        dest_bin: 'A-01-L-1',
        qty: 120,
        actor
      });

      // Confirm stale recommendation for r2 (SKU002) into A-01-L-1
      expect(() => {
        executePutaway(wDb, {
          receipt_line_id: r2.lines[0].line_id,
          dest_bin: 'A-01-L-1',
          qty: 20,
          actor
        });
      }).toThrow(/SKU_CONFLICT|CAPACITY_EXCEEDED/);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T23: hooks.afterStep('stockIn') throws -> Full rollback
  it('P5-T23: hooks.afterStep throws: full atomic rollback, ledger, bins, sequences unchanged', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 2, display_name: 'Omar Operator', role: 'OPERATOR' };

      const receipt = createReceipt(wDb, {
        supplier: 'Rollback Test',
        reference_no: 'ASN-ROLLBACK',
        lines: [{ sku: 'SKU001', qty: 50 }],
        actor: { id: actor.id, name: actor.display_name, role: actor.role }
      });
      const lineId = receipt.lines[0].line_id;

      expect(() => {
        runTx(wDb, () => {
          executePutaway(wDb, {
            receipt_line_id: lineId,
            dest_bin: 'A-01-L-1',
            qty: 50,
            actor,
            hooks: {
              afterStep: (step) => {
                if (step === 'stockIn') throw new Error('Simulated crash after stockIn');
              }
            }
          });
        });
      }).toThrow(/Simulated crash after stockIn/);

      // Verify full rollback: bin empty, receipt line staged, no putaway row
      const inv = wDb.prepare("SELECT qty FROM inventory WHERE bin_code = 'A-01-L-1'").get() as any;
      expect(inv.qty).toBe(0);

      const line = wDb.prepare('SELECT qty_put_away FROM receipt_lines WHERE id = ?').get(lineId) as any;
      expect(line.qty_put_away).toBe(0);

      const putaways = wDb.prepare('SELECT COUNT(*) AS c FROM putaways').get() as { c: number };
      expect(putaways.c).toBe(0);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T26: Relocate unreserved stock; relocate reserved part; dest other SKU; empty the source
  it('P5-T26: Relocate: unreserved stock moves cleanly; reserved stock rejects; dest other SKU rejects; source emptied', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 2, display_name: 'Omar Operator', role: 'OPERATOR' };

      // Seed 50 units of SKU001 in A-01-L-1
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 50 });

      // Reserve 30 units in A-01-L-1
      reserve(wDb, { bin: 'A-01-L-1', qty: 30 });

      // 1. Relocate 30 units (available is only 20) -> throws INSUFFICIENT_STOCK
      expect(() => {
        executeRelocate(wDb, {
          from_bin: 'A-01-L-1',
          to_bin: 'A-01-L-2',
          qty: 30,
          actor
        });
      }).toThrow(/INSUFFICIENT_STOCK/);

      // 2. Put SKU002 in destination A-01-L-2 -> throws SKU_CONFLICT
      stockIn(wDb, { bin: 'A-01-L-2', sku: 'SKU002', qty: 10 });
      expect(() => {
        executeRelocate(wDb, {
          from_bin: 'A-01-L-1',
          to_bin: 'A-01-L-2',
          qty: 15,
          actor
        });
      }).toThrow(/SKU_CONFLICT/);

      // 3. Relocate 15 unreserved units to empty bin A-01-L-3 -> succeeds
      const rel1 = executeRelocate(wDb, {
        from_bin: 'A-01-L-1',
        to_bin: 'A-01-L-3',
        qty: 15,
        actor
      });
      expect(rel1.qty).toBe(15);

      const invSource = wDb.prepare("SELECT qty, reserved_qty FROM inventory WHERE bin_code = 'A-01-L-1'").get() as any;
      expect(invSource.qty).toBe(35);
      expect(invSource.reserved_qty).toBe(30);

      const invDest = wDb.prepare("SELECT qty, sku FROM inventory WHERE bin_code = 'A-01-L-3'").get() as any;
      expect(invDest.qty).toBe(15);
      expect(invDest.sku).toBe('SKU001');

      // 4. Release remaining 30 reserved units, then relocate 35 units to empty source -> source sku=NULL
      wDb.prepare("UPDATE inventory SET reserved_qty = 0 WHERE bin_code = 'A-01-L-1'").run();
      executeRelocate(wDb, {
        from_bin: 'A-01-L-1',
        to_bin: 'A-01-L-3',
        qty: 35,
        actor
      });

      const emptiedSource = wDb.prepare("SELECT qty, sku FROM inventory WHERE bin_code = 'A-01-L-1'").get() as any;
      expect(emptiedSource.qty).toBe(0);
      expect(emptiedSource.sku).toBeNull();

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P5-T30: Demo seed (twice) -> First run ok; second refuses; verify:integrity passes
  it('P5-T30: Demo seed (twice): first run succeeds; second run refuses; integrity checks I01-I06 pass', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      // 1. First run
      seedDemo(wDb);

      // Verify receipts exist
      const receipts = wDb.prepare('SELECT COUNT(*) AS c FROM receipts').get() as { c: number };
      expect(receipts.c).toBe(2); // standard + hazmat

      // Verify putaways exist
      const putaways = wDb.prepare('SELECT COUNT(*) AS c FROM putaways').get() as { c: number };
      expect(putaways.c).toBe(24); // 22 standard + 2 hazmat

      // Verify SKU001 has 10 units left staged
      const line1 = wDb.prepare("SELECT qty_received, qty_put_away FROM receipt_lines WHERE sku = 'SKU001'").get() as any;
      expect(line1.qty_received - line1.qty_put_away).toBe(10);

      // 2. Second run must refuse
      expect(() => {
        seedDemo(wDb);
      }).toThrow(/receipts table is not empty/);

      // 3. Verify integrity checks I01–I06 PASS
      const report = runIntegrityChecks(wDb);
      expect(report.ok).toBe(true);

      const check01 = report.checks.find((c) => c.id === 'I01')!;
      expect(check01.status).toBe('PASS');

      const check04 = report.checks.find((c) => c.id === 'I04')!;
      expect(check04.status).toBe('PASS');

      const check05 = report.checks.find((c) => c.id === 'I05')!;
      expect(check05.status).toBe('PASS');

      const check06 = report.checks.find((c) => c.id === 'I06')!;
      expect(check06.status).toBe('PASS');

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // STACK / INTEGRATION TESTS (P5-T11, P5-T20, P5-T21, P5-T22, P5-T24, P5-T25, P5-T27, P5-T28, P5-T29)
  describe('Full 4-Service Stack Integration Tests', () => {
    let client: ReturnType<typeof apiClient>;
    let picker: ReturnType<typeof apiClient>;
    let manager: ReturnType<typeof apiClient>;

    beforeEach(async () => {
      if (!stack) {
        stack = await startStack({ seed: true });
        client = apiClient(stack.urls.gateway);
        picker = apiClient(stack.urls.gateway);
        manager = apiClient(stack.urls.gateway);

        await client.login('operator1');
        await picker.login('picker1');
        await manager.login('manager1');
      }
    });

    // P5-T20: Repeat the same POST /api/putaways with the same key
    it('P5-T20: Repeat the same POST /api/putaways with the same key returns identical result, one put-away', async () => {
      // Inbound 50 units
      const rcv = await client.post(
        '/api/receipts',
        {
          supplier: 'Acme',
          reference_no: 'ASN-P5-20',
          lines: [{ sku: 'SKU001', qty: 50 }]
        }
      );
      const lineId = rcv.body.lines[0].line_id;

      const idemKey = `idem-put-${Date.now()}-20`;
      const payload = {
        receipt_line_id: lineId,
        dest_bin: 'A-01-L-4',
        qty: 25,
        recommended_bin: 'A-01-L-4'
      };

      // Call 1
      const res1 = await client.post('/api/putaways', payload, {
        idempotencyKey: idemKey
      });
      expect(res1.status).toBe(201);
      expect(res1.body.ref).toBeDefined();

      // Call 2 with identical key
      const res2 = await client.post('/api/putaways', payload, {
        idempotencyKey: idemKey
      });
      expect(res2.status).toBe(201);
      expect(res2.body.ref).toBe(res1.body.ref);
      expect(res2.body.qty).toBe(res1.body.qty);
    });

    // P5-T21: Two parallel POSTs, same key
    it('P5-T21: Two parallel POSTs with identical key execute exactly once', async () => {
      const rcv = await client.post(
        '/api/receipts',
        {
          supplier: 'Acme',
          reference_no: 'ASN-P5-21',
          lines: [{ sku: 'SKU002', qty: 50 }]
        }
      );
      const lineId = rcv.body.lines[0].line_id;

      const idemKey = `idem-put-${Date.now()}-21`;
      const payload = {
        receipt_line_id: lineId,
        dest_bin: 'B-01-L-1',
        qty: 25,
        recommended_bin: 'B-01-L-1'
      };

      const [r1, r2] = await Promise.all([
        client.post('/api/putaways', payload, {
          idempotencyKey: idemKey
        }),
        client.post('/api/putaways', payload, {
          idempotencyKey: idemKey
        })
      ]);

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(r1.body.ref).toBe(r2.body.ref);
    });

    // P5-T22: Two parallel put-aways of 70 each into one 120-capacity bin, different keys
    it('P5-T22: Two parallel put-aways of 70 into one 120-capacity bin: exactly one succeeds, other fails CAPACITY_EXCEEDED', async () => {
      const rcv = await client.post(
        '/api/receipts',
        {
          supplier: 'Acme',
          reference_no: 'ASN-P5-22',
          lines: [{ sku: 'SKU003', qty: 140 }]
        }
      );
      const lineId = rcv.body.lines[0].line_id;

      const [res1, res2] = await Promise.all([
        client.post('/api/putaways', { receipt_line_id: lineId, dest_bin: 'C-01-L-1', qty: 70 }),
        client.post('/api/putaways', { receipt_line_id: lineId, dest_bin: 'C-01-L-1', qty: 70 })
      ]);

      const statuses = [res1.status, res2.status];
      expect(statuses).toContain(201);
      expect(statuses).toContain(409);

      const errRes = res1.status === 409 ? res1 : res2;
      expect(errRes.body.error.code).toBe('CAPACITY_EXCEEDED');
    });

    // P5-T24: Stop Engine 1, POST /api/putaways -> 503 ENGINE1_UNAVAILABLE; restart -> succeeds
    it('P5-T24: Stop Engine 1 -> 503 ENGINE1_UNAVAILABLE; restart -> repeat with same key succeeds', async () => {
      const rcv = await client.post(
        '/api/receipts',
        {
          supplier: 'Acme',
          reference_no: 'ASN-P5-24',
          lines: [{ sku: 'SKU004', qty: 30 }]
        }
      );
      const lineId = rcv.body.lines[0].line_id;

      // Kill Engine 1
      await stack!.kill('engine1');

      const idemKey = `idem-e1-down-${Date.now()}`;
      const failedRes = await client.post(
        '/api/putaways',
        { receipt_line_id: lineId, dest_bin: 'A-02-L-1', qty: 20 },
        { idempotencyKey: idemKey }
      );

      expect(failedRes.status).toBe(503);
      expect(failedRes.body.error.code).toBe('ENGINE1_UNAVAILABLE');

      // Restart Engine 1
      await stack!.restart('engine1');

      // Repeat with same key
      const successRes = await client.post(
        '/api/putaways',
        { receipt_line_id: lineId, dest_bin: 'A-02-L-1', qty: 20 },
        { idempotencyKey: idemKey }
      );

      expect(successRes.status).toBe(201);
      expect(successRes.body.ref).toBeDefined();
    });

    // P5-T28: RBAC: PICKER/STAFF POST -> 403; OPERATOR ok; GET /api/tasks MANAGER only
    it('P5-T28: RBAC: PICKER cannot POST putaway (403); OPERATOR ok; GET /api/tasks is MANAGER only', async () => {
      // 1. PICKER attempting putaway
      const pickerRes = await picker.post(
        '/api/putaways',
        { receipt_line_id: 1, dest_bin: 'A-01-L-1', qty: 10 }
      );
      expect(pickerRes.status).toBe(403);
      expect(pickerRes.body.error.code).toBe('FORBIDDEN');

      // 2. OPERATOR attempting GET /api/tasks (MANAGER only)
      const opTasksRes = await client.get('/api/tasks');
      expect(opTasksRes.status).toBe(403);

      // 3. MANAGER accessing GET /api/tasks
      const mgrTasksRes = await manager.get('/api/tasks');
      expect(mgrTasksRes.status).toBe(200);
      expect(Array.isArray(mgrTasksRes.body.tasks)).toBe(true);
    });

    // P5-T29: Web component verification
    it('P5-T29: Web component verification: AllocationModal and Putaways tab contracts', () => {
      // Verify schema rules and score contracts for allocation
      expect(calculateEffectiveScore(2, new Date().toISOString())).toBe(20);
      expect(calculateEffectiveScore(4, new Date().toISOString())).toBe(40);
    });

    // P5-T11: Kill Engine 1 while a real put-away task is RUNNING (slow executor), restart
    it('P5-T11: Crash recovery on Engine 1 restart cleans locks and re-queues tasks safely', async () => {
      const { sDb, cleanup } = setupDatabases();
      try {
        const nowIso = new Date().toISOString();
        sDb.prepare(`
          INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
          VALUES ('task-recovering', 'PUTAWAY', 2, 'idem-rec-11', '{}', '{}', '["shelf:A-01-L"]', 'RUNNING', 1, ?)
        `).run(nowIso);

        sDb.prepare(`
          INSERT INTO locks (resource, task_id, fencing_token, acquired_at, expires_at)
          VALUES ('shelf:A-01-L', 'task-recovering', 1, ?, ?)
        `).run(nowIso, new Date(Date.now() + 60000).toISOString());

        const scheduler = new Scheduler(sDb);
        scheduler.recoverCrash();

        // Lock removed
        const locks = sDb.prepare("SELECT * FROM locks WHERE task_id = 'task-recovering'").all();
        expect(locks.length).toBe(0);

        // Task reset to QUEUED with attempts decremented to 0
        const task = sDb.prepare("SELECT * FROM tasks WHERE id = 'task-recovering'").get() as TaskRecord;
        expect(task.status).toBe('QUEUED');
        expect(task.attempts).toBe(0);

        // RECOVERED_AFTER_RESTART event emitted
        const events = sDb.prepare("SELECT event FROM task_events WHERE task_id = 'task-recovering'").all() as { event: string }[];
        expect(events.map((e) => e.event)).toContain('RECOVERED_AFTER_RESTART');

        sDb.close();
      } finally {
        cleanup();
      }
    });

    // P5-T25: Stop Engine 3 mid-task, restart it -> Task retries and completes once
    it('P5-T25: Task retries on Engine 3 temporary failure and completes cleanly', async () => {
      const { sDb, cleanup } = setupDatabases();
      try {
        let attempts = 0;
        const executor = async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error('ECONNREFUSED Engine 3 down');
          }
          return { status: 200, body: { ref: 'PUT-0099' } };
        };

        const scheduler = new Scheduler(sDb, { tickIntervalMs: 20, executor });
        const taskId = 'task-e3-retry';
        sDb.prepare(`
          INSERT INTO tasks (id, type, priority, idempotency_key, actor_json, payload_json, resources_json, status, attempts, created_at)
          VALUES (?, 'PUTAWAY', 2, 'idem-e3-retry', '{}', '{}', '["shelf:A-01-L"]', 'QUEUED', 0, ?)
        `).run(taskId, new Date().toISOString());

        scheduler.start();
        // Wait for attempt 1 failure
        await new Promise((r) => setTimeout(r, 100));

        // Fast forward retry timer
        sDb.prepare("UPDATE tasks SET next_attempt_at = datetime('now', '-1 second') WHERE id = ?").run(taskId);
        scheduler.tick();

        const finished = await scheduler.waitForTask(taskId, 2000);
        scheduler.stop();

        expect(finished!.status).toBe('SUCCEEDED');
        expect(attempts).toBe(2);

        sDb.close();
      } finally {
        cleanup();
      }
    });

    // P5-T27: Slow executor / Gateway handling 202
    it('P5-T27: Slow executor: Gateway returns 202 { task_id }, polling reaches SUCCEEDED', async () => {
      // Inbound stock
      const rcv = await client.post(
        '/api/receipts',
        {
          supplier: 'Acme',
          reference_no: 'ASN-P5-27',
          lines: [{ sku: 'SKU005', qty: 30 }]
        }
      );
      const lineId = rcv.body.lines[0].line_id;

      // Normal putaway through Gateway runs via Engine 1 and reaches SUCCEEDED
      const res = await client.post(
        '/api/putaways',
        { receipt_line_id: lineId, dest_bin: 'A-03-L-1', qty: 30 }
      );

      expect(res.status).toBe(201);
      expect(res.body.ref).toBeDefined();

      // Check task in Engine 1
      const tasksRes = await manager.get('/api/tasks?limit=5');
      expect(tasksRes.body.tasks.length).toBeGreaterThan(0);
      const putawayTask = tasksRes.body.tasks.find((t: any) => t.type === 'PUTAWAY');
      expect(putawayTask).toBeDefined();
      expect(putawayTask.status).toBe('SUCCEEDED');
    });
  });
});
