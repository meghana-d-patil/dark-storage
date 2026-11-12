import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { postLedger, ensureLot } from '../../services/engine3-inventory/src/ledger/postLedger.js';
import { claimFloorTask, createFloorTask } from '../../services/engine3-inventory/src/domain/pickerRepo.js';
import { submitBlindCount } from '../../services/engine3-inventory/src/domain/adjustmentsRepo.js';

describe('Phase 7: Blind Count & Second Counter Rule Integration Test', () => {
  let db: Database.Database;

  const operator1 = { id: 3, role: 'OPERATOR', username: 'test-counter-1' };
  const operator2 = { id: 5, role: 'OPERATOR', username: 'test-counter-2' };

  beforeEach(() => {
    db = makeTestDb();
    seedMinimal(db);

    ensureLot(db, {
      lotId: 'LOT-TEST-001',
      sku: 'SKU-TEST-001',
      supplier: 'Test Supplier',
    });

    // Stock 10 units in BIN-A01-1
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

  it('verifies count response never leaks system or variance, and high variance (>10%) spawns round 2 requiring a different counter', () => {
    // 1. Create a COUNT floor task for BIN-A01-1
    const taskRef1 = createFloorTask(db, {
      type: 'COUNT',
      binCode: 'BIN-A01-1',
      sku: 'SKU-TEST-001',
      priority: 80,
      createdBy: 'MANAGER',
    });

    // 2. Operator 1 claims the task
    claimFloorTask(db, taskRef1, operator1);

    // 3. Negative check: scanning wrong bin code
    expect(() => {
      submitBlindCount(db, taskRef1, { binScan: 'WRONG-BIN', countedQty: 10 }, operator1);
    }).toThrow(/SCAN_WRONG_BIN/);

    // 4. Operator 1 submits blind count = 7 (system is 10, variance is 3 = 30% > 10%)
    const countRes1 = submitBlindCount(db, taskRef1, { binScan: 'BIN-A01-1', countedQty: 7 }, operator1);

    // D15 / D23: Response JSON must NEVER contain system_qty, system, or variance keys
    expect(countRes1.ok).toBe(true);
    expect((countRes1 as any).system).toBeUndefined();
    expect((countRes1 as any).system_qty).toBeUndefined();
    expect((countRes1 as any).variance).toBeUndefined();
    expect((countRes1 as any).delta).toBeUndefined();

    // 5. Verify round 1 task is completed
    const task1 = db.prepare('SELECT status, completed_at FROM floor_tasks WHERE task_ref = ?').get(taskRef1) as any;
    expect(task1.status).toBe('DONE');

    // 6. Find spawned round 2 task
    const task2 = db.prepare("SELECT * FROM floor_tasks WHERE bin_code = 'BIN-A01-1' AND status = 'OPEN' AND type = 'COUNT'").get() as any;
    expect(task2).toBeDefined();
    expect(task2.task_ref).not.toBe(taskRef1);

    // 7. Same operator (operator1) attempts to claim round 2 -> must be rejected with COUNTER_MUST_DIFFER
    expect(() => {
      claimFloorTask(db, task2.task_ref, operator1);
    }).toThrow(/COUNTER_MUST_DIFFER/);

    // 8. Different operator (operator2) successfully claims round 2
    const claimRes2 = claimFloorTask(db, task2.task_ref, operator2);
    expect(claimRes2.status).toBe('CLAIMED');

    // 9. Operator 2 submits blind count = 7 (matches round 1)
    const countRes2 = submitBlindCount(db, task2.task_ref, { binScan: 'BIN-A01-1', countedQty: 7 }, operator2);
    expect(countRes2.ok).toBe(true);
    expect((countRes2 as any).system).toBeUndefined();
    expect((countRes2 as any).variance).toBeUndefined();

    // 10. Verify COUNT_VARIANCE adjustment was created with delta = -3
    const adj = db.prepare("SELECT * FROM inventory_adjustments WHERE bin_code = 'BIN-A01-1' AND kind = 'COUNT_VARIANCE'").get() as any;
    expect(adj).toBeDefined();
    expect(adj.status).toBe('PENDING_MANAGER');
    expect(adj.delta_qty).toBe(-3);
    expect(adj.requested_by).toBe(operator2.username);
  });
});
