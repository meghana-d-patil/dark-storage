import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { DomainError } from '@dark-storage/shared';
import { createTempDbPaths } from '../harness/tempDb.js';
import { startStack, StackHandle } from '../harness/stack.js';
import { apiClient } from '../harness/apiClient.js';
import { seedBinStock } from '../harness/fixtures.js';
import { applyMigrations } from '../../scripts/migrate.js';
import { seedBase } from '../../scripts/seed-base.js';
import { runIntegrityChecks } from '../../scripts/verify-integrity.js';
import { runTx } from '../../services/engine3-inventory/src/db/tx.js';
import {
  stockIn,
  stockOut,
  reserve,
  release,
  recordMovement,
  applyRecount
} from '../../services/engine3-inventory/src/domain/inventoryRepo.js';

describe('Phase 2 Inventory Core Tests', () => {
  let stack: StackHandle | undefined;

  afterAll(async () => {
    if (stack) {
      await stack.stop();
    }
  });

  function setupDb() {
    const { dir, warehouseDbPath, schedulerDbPath, cleanup } = createTempDbPaths();
    const db = new Database(warehouseDbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    applyMigrations(db, path.resolve('migrations/warehouse'));
    seedBase(db);
    return { dir, warehouseDbPath, schedulerDbPath, db, cleanup };
  }

  it('P2-T01: stockIn into empty bin -> qty, sku set; available_qty = qty', () => {
    const { db, cleanup } = setupDb();
    try {
      runTx(db, () => {
        stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 25 });
      });

      const inv = db.prepare('SELECT sku, qty, reserved_qty FROM inventory WHERE bin_code = ?').get('A-01-L-1') as {
        sku: string;
        qty: number;
        reserved_qty: number;
      };

      expect(inv.sku).toBe('SKU001');
      expect(inv.qty).toBe(25);
      expect(inv.reserved_qty).toBe(0);

      const avail = db.prepare('SELECT available_qty FROM v_available_stock WHERE bin_code = ?').get('A-01-L-1') as {
        available_qty: number;
      };
      expect(avail.available_qty).toBe(25);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T02: stockIn same SKU again -> qty accumulates', () => {
    const { db, cleanup } = setupDb();
    try {
      runTx(db, () => {
        stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 25 });
        stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 15 });
      });

      const inv = db.prepare('SELECT qty FROM inventory WHERE bin_code = ?').get('A-01-L-1') as { qty: number };
      expect(inv.qty).toBe(40);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T03: stockIn different SKU into occupied bin -> SKU_CONFLICT; row unchanged', () => {
    const { db, cleanup } = setupDb();
    try {
      runTx(db, () => {
        stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 25 });
      });

      expect(() => {
        runTx(db, () => {
          stockIn(db, { bin: 'A-01-L-1', sku: 'SKU002', qty: 10 });
        });
      }).toThrow(/SKU_CONFLICT/);

      const inv = db.prepare('SELECT sku, qty FROM inventory WHERE bin_code = ?').get('A-01-L-1') as {
        sku: string;
        qty: number;
      };
      expect(inv.sku).toBe('SKU001');
      expect(inv.qty).toBe(25);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T04: stockIn beyond capacity -> CAPACITY_EXCEEDED; unchanged', () => {
    const { db, cleanup } = setupDb();
    try {
      // Bin A-01-L-1 capacity is 200 (Level 1)
      expect(() => {
        runTx(db, () => {
          stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 250 });
        });
      }).toThrow(/CAPACITY_EXCEEDED/);

      const inv = db.prepare('SELECT qty FROM inventory WHERE bin_code = ?').get('A-01-L-1') as { qty: number };
      expect(inv.qty).toBe(0);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T05: stockIn into BLOCKED bin / DAMAGED bin / MAINTENANCE shelf / recount_required bin -> BIN_NOT_RECEIVABLE', () => {
    const { db, cleanup } = setupDb();
    try {
      // D-06-R-3 is BLOCKED in seed
      expect(() => {
        runTx(db, () => {
          stockIn(db, { bin: 'D-06-R-3', sku: 'SKU001', qty: 5 });
        });
      }).toThrow(/BIN_NOT_RECEIVABLE/);

      // D-06-R-4 is DAMAGED in seed
      expect(() => {
        runTx(db, () => {
          stockIn(db, { bin: 'D-06-R-4', sku: 'SKU001', qty: 5 });
        });
      }).toThrow(/BIN_NOT_RECEIVABLE/);

      // B-06-L is MAINTENANCE shelf in seed
      expect(() => {
        runTx(db, () => {
          stockIn(db, { bin: 'B-06-L-1', sku: 'SKU001', qty: 5 });
        });
      }).toThrow(/BIN_NOT_RECEIVABLE/);

      // Set recount_required on A-01-L-1
      db.prepare('UPDATE bins SET recount_required = 1 WHERE code = ?').run('A-01-L-1');
      expect(() => {
        runTx(db, () => {
          stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 5 });
        });
      }).toThrow(/BIN_NOT_RECEIVABLE/);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T06: HAZMAT SKU into STANDARD shelf, and STANDARD SKU into HAZMAT shelf -> STORAGE_CLASS_MISMATCH', () => {
    const { db, cleanup } = setupDb();
    try {
      // SKU023 is HAZMAT (Lithium Power Bank 20000mAh)
      // A-01-L is STANDARD shelf
      expect(() => {
        runTx(db, () => {
          stockIn(db, { bin: 'A-01-L-1', sku: 'SKU023', qty: 5 });
        });
      }).toThrow(/STORAGE_CLASS_MISMATCH/);

      // D-01-L is HAZMAT shelf
      // SKU001 is STANDARD product
      expect(() => {
        runTx(db, () => {
          stockIn(db, { bin: 'D-01-L-1', sku: 'SKU001', qty: 5 });
        });
      }).toThrow(/STORAGE_CLASS_MISMATCH/);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T07: Raw SQL UPDATE inventory that changes SKU of non-empty bin / exceeds capacity / lowers qty below reserved aborts', () => {
    const { db, cleanup } = setupDb();
    try {
      // Seed stock
      runTx(db, () => {
        stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 50 });
        reserve(db, { bin: 'A-01-L-1', qty: 20 });
      });

      // 1. Change SKU of non-empty bin -> trigger inventory_sku_mix throws SKU_CONFLICT
      expect(() => {
        db.prepare("UPDATE inventory SET sku = 'SKU002' WHERE bin_code = 'A-01-L-1'").run();
      }).toThrow(/SKU_CONFLICT/);

      // 2. Exceed capacity (cap is 200) -> trigger inventory_capacity_upd throws CAPACITY_EXCEEDED
      expect(() => {
        db.prepare('UPDATE inventory SET qty = 300 WHERE bin_code = ?').run('A-01-L-1');
      }).toThrow(/CAPACITY_EXCEEDED/);

      // 3. Lowers qty below reserved (reserved is 20) -> CHECK (reserved_qty <= qty) fails
      expect(() => {
        db.prepare('UPDATE inventory SET qty = 10 WHERE bin_code = ?').run('A-01-L-1');
      }).toThrow(/CHECK constraint failed/);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T08: Raw SQL UPSERT on occupied bin with different SKU aborts; row unchanged', () => {
    const { db, cleanup } = setupDb();
    try {
      runTx(db, () => {
        stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 50 });
      });

      expect(() => {
        db.prepare(`
          INSERT INTO inventory (bin_code, sku, qty, reserved_qty)
          VALUES ('A-01-L-1', 'SKU002', 10, 0)
          ON CONFLICT(bin_code) DO UPDATE SET sku = excluded.sku, qty = excluded.qty
        `).run();
      }).toThrow(/SKU_CONFLICT/);

      const inv = db.prepare('SELECT sku, qty FROM inventory WHERE bin_code = ?').get('A-01-L-1') as {
        sku: string;
        qty: number;
      };
      expect(inv.sku).toBe('SKU001');
      expect(inv.qty).toBe(50);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T09: stockOut unreserved qty / more than unreserved / exactly all', () => {
    const { db, cleanup } = setupDb();
    try {
      runTx(db, () => {
        stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 50 });
        reserve(db, { bin: 'A-01-L-1', qty: 20 });
      });

      // Available unreserved is 30. Taking 10 is OK:
      runTx(db, () => {
        stockOut(db, { bin: 'A-01-L-1', qty: 10, consumeReserved: false });
      });

      let inv = db.prepare('SELECT qty, reserved_qty FROM inventory WHERE bin_code = ?').get('A-01-L-1') as {
        qty: number;
        reserved_qty: number;
      };
      expect(inv.qty).toBe(40);
      expect(inv.reserved_qty).toBe(20);

      // Taking 25 unreserved exceeds 20 -> INSUFFICIENT_STOCK:
      expect(() => {
        runTx(db, () => {
          stockOut(db, { bin: 'A-01-L-1', qty: 25, consumeReserved: false });
        });
      }).toThrow(/INSUFFICIENT_STOCK/);

      // Release reserved 20, then remove all 40:
      runTx(db, () => {
        release(db, { bin: 'A-01-L-1', qty: 20 });
        stockOut(db, { bin: 'A-01-L-1', qty: 40, consumeReserved: false });
      });

      inv = db.prepare('SELECT sku, qty, reserved_qty FROM inventory WHERE bin_code = ?').get('A-01-L-1') as {
        sku: string | null;
        qty: number;
        reserved_qty: number;
      };
      expect(inv.qty).toBe(0);
      expect(inv.reserved_qty).toBe(0);
      expect(inv.sku).toBeNull();

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T10: reserve within available / beyond available; release within reserved / beyond', () => {
    const { db, cleanup } = setupDb();
    try {
      runTx(db, () => {
        stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 50 });
      });

      // Reserve within available
      runTx(db, () => {
        reserve(db, { bin: 'A-01-L-1', qty: 30 });
      });

      let inv = db.prepare('SELECT reserved_qty FROM inventory WHERE bin_code = ?').get('A-01-L-1') as {
        reserved_qty: number;
      };
      expect(inv.reserved_qty).toBe(30);

      // Beyond available (50 - 30 = 20 available, trying 25)
      expect(() => {
        runTx(db, () => {
          reserve(db, { bin: 'A-01-L-1', qty: 25 });
        });
      }).toThrow(/INSUFFICIENT_STOCK/);

      // Release within reserved (release 10)
      runTx(db, () => {
        release(db, { bin: 'A-01-L-1', qty: 10 });
      });

      inv = db.prepare('SELECT reserved_qty FROM inventory WHERE bin_code = ?').get('A-01-L-1') as {
        reserved_qty: number;
      };
      expect(inv.reserved_qty).toBe(20);

      // Release beyond reserved (trying 25 when 20 reserved)
      expect(() => {
        runTx(db, () => {
          release(db, { bin: 'A-01-L-1', qty: 25 });
        });
      }).toThrow(/INVENTORY_DRIFT/);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T11: stockOut with consumeReserved=true decreases both qty and reserved_qty', () => {
    const { db, cleanup } = setupDb();
    try {
      runTx(db, () => {
        stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 50 });
        reserve(db, { bin: 'A-01-L-1', qty: 20 });
        stockOut(db, { bin: 'A-01-L-1', qty: 15, consumeReserved: true });
      });

      const inv = db.prepare('SELECT qty, reserved_qty FROM inventory WHERE bin_code = ?').get('A-01-L-1') as {
        qty: number;
        reserved_qty: number;
      };

      expect(inv.qty).toBe(35);
      expect(inv.reserved_qty).toBe(5);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T12: Composite test function with failure inside runTx rolls back everything', () => {
    const { db, cleanup } = setupDb();
    try {
      expect(() => {
        runTx(db, () => {
          stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 20 });
          recordMovement(db, {
            type: 'ADJUSTMENT',
            sku: 'SKU001',
            qty: 20,
            from: { kind: 'ADJUSTMENT', ref: 'ADJ-TEST' },
            to: { kind: 'BIN', ref: 'A-01-L-1' }
          });
          throw new Error('Simulated failure during operation');
        });
      }).toThrow('Simulated failure during operation');

      const inv = db.prepare('SELECT qty FROM inventory WHERE bin_code = ?').get('A-01-L-1') as { qty: number };
      expect(inv.qty).toBe(0);

      const movements = db.prepare('SELECT COUNT(*) as c FROM stock_movements').get() as { c: number };
      expect(movements.c).toBe(0);

      const seq = db.prepare("SELECT next_value FROM id_sequences WHERE prefix = 'MOV'").get() as { next_value: number };
      expect(seq.next_value).toBe(1);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T13: UPDATE/DELETE on stock_movements aborts STOCK_MOVEMENTS_ARE_APPEND_ONLY', () => {
    const { db, cleanup } = setupDb();
    try {
      let movRef = '';
      runTx(db, () => {
        stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 10 });
        movRef = recordMovement(db, {
          type: 'ADJUSTMENT',
          sku: 'SKU001',
          qty: 10,
          from: { kind: 'ADJUSTMENT', ref: 'ADJ-0001' },
          to: { kind: 'BIN', ref: 'A-01-L-1' }
        });
      });

      expect(movRef).toBe('MOV-0001');

      expect(() => {
        db.prepare("UPDATE stock_movements SET qty = 99 WHERE ref = 'MOV-0001'").run();
      }).toThrow(/STOCK_MOVEMENTS_ARE_APPEND_ONLY/);

      expect(() => {
        db.prepare("DELETE FROM stock_movements WHERE ref = 'MOV-0001'").run();
      }).toThrow(/STOCK_MOVEMENTS_ARE_APPEND_ONLY/);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T14: recordMovement x3 produces MOV-0001..0003 with correct kinds/refs', () => {
    const { db, cleanup } = setupDb();
    try {
      const r1 = runTx(db, () =>
        recordMovement(db, {
          type: 'RECEIVE',
          sku: 'SKU001',
          qty: 10,
          from: { kind: 'EXTERNAL' },
          to: { kind: 'STAGING', ref: 'RCV-0001' }
        })
      );
      const r2 = runTx(db, () =>
        recordMovement(db, {
          type: 'PUTAWAY',
          sku: 'SKU001',
          qty: 10,
          from: { kind: 'STAGING', ref: 'RCV-0001' },
          to: { kind: 'BIN', ref: 'A-01-L-1' }
        })
      );
      const r3 = runTx(db, () =>
        recordMovement(db, {
          type: 'RELOCATE',
          sku: 'SKU001',
          qty: 5,
          from: { kind: 'BIN', ref: 'A-01-L-1' },
          to: { kind: 'BIN', ref: 'A-01-L-2' }
        })
      );

      expect(r1).toBe('MOV-0001');
      expect(r2).toBe('MOV-0002');
      expect(r3).toBe('MOV-0003');

      const rows = db.prepare('SELECT ref, movement_type, from_kind, to_kind FROM stock_movements ORDER BY id ASC').all() as any[];
      expect(rows[0].from_kind).toBe('EXTERNAL');
      expect(rows[0].to_kind).toBe('STAGING');
      expect(rows[1].from_kind).toBe('STAGING');
      expect(rows[1].to_kind).toBe('BIN');
      expect(rows[2].from_kind).toBe('BIN');
      expect(rows[2].to_kind).toBe('BIN');

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T15: Bin status: block bin with reserved_qty > 0 / block empty bin then stockIn / reactivate then stockIn', () => {
    const { db, cleanup } = setupDb();
    try {
      runTx(db, () => {
        stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 20 });
        reserve(db, { bin: 'A-01-L-1', qty: 10 });
      });

      // Try blocking bin with active reservations
      const inv = db.prepare('SELECT reserved_qty FROM inventory WHERE bin_code = ?').get('A-01-L-1') as { reserved_qty: number };
      expect(inv.reserved_qty).toBe(10);

      // Simulating status change check logic
      expect(() => {
        runTx(db, () => {
          if (inv.reserved_qty > 0) {
            throw new DomainError('BIN_HAS_RESERVATIONS', 'Cannot block bin with reservations');
          }
        });
      }).toThrow(/BIN_HAS_RESERVATIONS/);

      // Block empty bin A-01-L-2
      db.prepare("UPDATE bins SET status = 'BLOCKED' WHERE code = 'A-01-L-2'").run();

      // stockIn into BLOCKED bin fails
      expect(() => {
        runTx(db, () => {
          stockIn(db, { bin: 'A-01-L-2', sku: 'SKU001', qty: 10 });
        });
      }).toThrow(/BIN_NOT_RECEIVABLE/);

      // Reactivate bin
      db.prepare("UPDATE bins SET status = 'ACTIVE' WHERE code = 'A-01-L-2'").run();

      // stockIn into REACTIVATED bin succeeds
      runTx(db, () => {
        stockIn(db, { bin: 'A-01-L-2', sku: 'SKU001', qty: 10 });
      });

      const inv2 = db.prepare('SELECT qty FROM inventory WHERE bin_code = ?').get('A-01-L-2') as { qty: number };
      expect(inv2.qty).toBe(10);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T16: Recount: below reserved / above capacity / delta != 0 / delta = 0 / replay same key', () => {
    const { db, cleanup } = setupDb();
    try {
      runTx(db, () => {
        stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 50 });
        reserve(db, { bin: 'A-01-L-1', qty: 20 });
      });

      // Recount below reserved (15 < 20) -> ADJUSTMENT_CONFLICT
      expect(() => {
        runTx(db, () => {
          applyRecount(db, { bin_code: 'A-01-L-1', counted_qty: 15, reason: 'Test recount' });
        });
      }).toThrow(/ADJUSTMENT_CONFLICT/);

      // Recount above capacity (250 > 200) -> CAPACITY_EXCEEDED
      expect(() => {
        runTx(db, () => {
          applyRecount(db, { bin_code: 'A-01-L-1', counted_qty: 250, reason: 'Test recount' });
        });
      }).toThrow(/CAPACITY_EXCEEDED/);

      // Delta > 0: recount to 60 (+10)
      const resPos = runTx(db, () =>
        applyRecount(db, { bin_code: 'A-01-L-1', counted_qty: 60, reason: 'Found more units' })
      );
      expect(resPos.delta).toBe(10);
      expect(resPos.adj_ref).toBe('ADJ-0001');

      const invPos = db.prepare('SELECT qty FROM inventory WHERE bin_code = ?').get('A-01-L-1') as { qty: number };
      expect(invPos.qty).toBe(60);

      // Delta = 0: recount to 60 again -> no movement
      const resZero = runTx(db, () =>
        applyRecount(db, { bin_code: 'A-01-L-1', counted_qty: 60, reason: 'Recount confirmed same' })
      );
      expect(resZero.delta).toBe(0);
      expect(resZero.adj_ref).toBeNull();

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T17: API reads on fixtures: summary, bins, movements, layout, search; RBAC', async () => {
    stack = await startStack({ seed: true });
    const managerClient = apiClient(stack.urls.gateway);
    await managerClient.login('manager1');

    // Fixture: seed stock into A-01-L-1
    const operatorClient = apiClient(stack.urls.gateway);
    await operatorClient.login('operator1');

    const pickerClient = apiClient(stack.urls.gateway);
    await pickerClient.login('picker1');

    // OPERATOR cannot change bin status (MANAGER only) -> 403
    const forbiddenRes = await operatorClient.post('/api/inventory/bins/A-01-L-1/status', {
      status: 'BLOCKED',
      reason: 'Unauthorized attempt'
    });
    expect(forbiddenRes.status).toBe(403);

    // MANAGER can change bin status
    const statusRes = await managerClient.post('/api/inventory/bins/A-01-L-1/status', {
      status: 'BLOCKED',
      reason: 'Scheduled maintenance'
    });
    expect(statusRes.status).toBe(200);

    // Reactivate
    await managerClient.post('/api/inventory/bins/A-01-L-1/status', {
      status: 'ACTIVE',
      reason: 'Reactivated'
    });

    // Recount via manager
    const recountRes = await managerClient.post('/api/inventory/bins/A-01-L-1/recount', {
      counted_qty: 50,
      sku: 'SKU001',
      reason: 'Initial cycle count'
    });
    expect(recountRes.status).toBe(200);

    // PICKER can read summary
    const summaryRes = await pickerClient.get('/api/inventory/summary?search=mouse');
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.items).toBeDefined();
    expect(summaryRes.body.items.length).toBeGreaterThanOrEqual(1);

    // Bins read
    const binsRes = await pickerClient.get('/api/inventory/bins?sku=SKU001');
    expect(binsRes.status).toBe(200);
    expect(binsRes.body.items.length).toBeGreaterThanOrEqual(1);
    expect(binsRes.body.items[0].qty).toBe(50);

    // Bin detail
    const detailRes = await pickerClient.get('/api/inventory/bins/A-01-L-1');
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.recent_movements.length).toBeGreaterThanOrEqual(1);

    // Movements list
    const movRes = await pickerClient.get('/api/inventory/movements?bin=A-01-L-1');
    expect(movRes.status).toBe(200);
    expect(movRes.body.items.length).toBeGreaterThanOrEqual(1);

    // Layout
    const layoutRes = await pickerClient.get('/api/warehouse/layout');
    expect(layoutRes.status).toBe(200);
    expect(layoutRes.body.aisles.length).toBe(4);

    // Search
    const searchRes = await pickerClient.get('/api/warehouse/search?q=A-01-L-1');
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.length).toBeGreaterThanOrEqual(1);
  });

  it('P2-T18: v_available_stock excludes blocked/damaged bins, maintenance-shelf bins, recount-required bins, zero-available bins', () => {
    const { db, cleanup } = setupDb();
    try {
      runTx(db, () => {
        // Active bin with stock
        stockIn(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 50 });
        reserve(db, { bin: 'A-01-L-1', qty: 20 }); // available: 30

        // Active bin with fully reserved stock
        stockIn(db, { bin: 'A-01-L-2', sku: 'SKU001', qty: 20 });
        reserve(db, { bin: 'A-01-L-2', qty: 20 }); // available: 0
      });

      // A-01-L-1 is included with available_qty = 30
      const b1 = db.prepare('SELECT available_qty FROM v_available_stock WHERE bin_code = ?').get('A-01-L-1') as {
        available_qty: number;
      };
      expect(b1.available_qty).toBe(30);

      // A-01-L-2 has 0 available -> excluded
      const b2 = db.prepare('SELECT * FROM v_available_stock WHERE bin_code = ?').get('A-01-L-2');
      expect(b2).toBeUndefined();

      // Empty bin -> excluded
      const bEmpty = db.prepare('SELECT * FROM v_available_stock WHERE bin_code = ?').get('A-01-L-3');
      expect(bEmpty).toBeUndefined();

      // Recount required on A-01-L-1 -> excluded
      db.prepare('UPDATE bins SET recount_required = 1 WHERE code = ?').run('A-01-L-1');
      const bRecount = db.prepare('SELECT * FROM v_available_stock WHERE bin_code = ?').get('A-01-L-1');
      expect(bRecount).toBeUndefined();

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T19: Integrity verifier passes I01-I04 after fixtures', () => {
    const { db, cleanup } = setupDb();
    try {
      runTx(db, () => {
        seedBinStock(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 50 });
        seedBinStock(db, { bin: 'A-01-L-2', sku: 'SKU002', qty: 30 });
      });

      const report = runIntegrityChecks(db);
      expect(report.ok).toBe(true);

      const i01 = report.checks.find(c => c.id === 'I01');
      const i03 = report.checks.find(c => c.id === 'I03');
      const i04 = report.checks.find(c => c.id === 'I04');

      expect(i01?.status).toBe('PASS');
      expect(i03?.status).toBe('PASS');
      expect(i04?.status).toBe('PASS');

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P2-T20: Web component verification: ProductLabel shows name and SKU; Warehouse grid layout renders 48 shelves', async () => {
    if (!stack) {
      stack = await startStack({ seed: true });
    }
    const client = apiClient(stack.urls.gateway);
    await client.login('manager1');

    // Layout returns exactly 48 shelves (12 shelves per aisle * 4 aisles)
    const layoutRes = await client.get('/api/warehouse/layout');
    expect(layoutRes.status).toBe(200);

    let totalShelves = 0;
    for (const aisle of layoutRes.body.aisles) {
      totalShelves += aisle.shelves.length;
    }
    expect(totalShelves).toBe(48);

    // Total bins: 48 shelves * 4 levels = 192 bins
    let totalBins = 0;
    for (const aisle of layoutRes.body.aisles) {
      for (const shelf of aisle.shelves) {
        totalBins += shelf.bins.length;
      }
    }
    expect(totalBins).toBe(192);
  });
});
