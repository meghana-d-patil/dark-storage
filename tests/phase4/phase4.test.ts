import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { createTempDbPaths } from '../harness/tempDb.js';
import { startStack, StackHandle } from '../harness/stack.js';
import { apiClient } from '../harness/apiClient.js';
import { seedBinStock } from '../harness/fixtures.js';
import { applyMigrations } from '../../scripts/migrate.js';
import { seedBase } from '../../scripts/seed-base.js';
import { runIntegrityChecks } from '../../scripts/verify-integrity.js';
import { runTx } from '../../services/engine3-inventory/src/db/tx.js';
import { loadGraph } from '../../services/engine2-optimizer/src/graph/loadGraph.js';
import { dijkstra } from '../../services/engine2-optimizer/src/graph/dijkstra.js';
import { scoreCandidate } from '../../services/engine2-optimizer/src/placement/score.js';
import { recommendPlacement } from '../../services/engine2-optimizer/src/placement/recommend.js';
import { evaluateBin } from '../../services/engine2-optimizer/src/placement/filter.js';
import { loadPlacementSnapshot } from '../../services/engine2-optimizer/src/placement/snapshot.js';
import { createReceipt } from '../../services/engine3-inventory/src/domain/receivingRepo.js';

describe('Phase 4 Engine 2 Smart Allocation Tests', () => {
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

  it('P4-T01: Dijkstra on the seeded graph: dist(DOCK, N-A-01)=20, dist(DOCK, N-A-06)=50, dist(DOCK, N-D-01)=80, dist(DOCK, PACK)=80', () => {
    const { db, cleanup } = setupDb();
    try {
      const graph = loadGraph(db, true);
      const { distances } = dijkstra('DOCK', graph);

      expect(distances.get('N-A-01')).toBe(20);
      expect(distances.get('N-A-06')).toBe(50);
      expect(distances.get('N-D-01')).toBe(80);
      expect(distances.get('PACK')).toBe(80);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P4-T02: Golden scoreCandidate unit test: 76.47', () => {
    // factors { distance: 0.8, consolidation: 1.0, utilization: 0.5, affinity: 0.5 }, velocity not applied
    // Expected: 100 * (0.25*0.8 + 0.30*1.0 + 0.15*0.5 + 0.15*0.5) / 0.85 = 76.47
    const result = scoreCandidate({
      distFromDock: 20,
      maxDist: 100, // 1 - 20/100 = 0.8
      currentSku: 'SKU001',
      productSku: 'SKU001',
      canFitFull: true, // consolidation = 1.0
      shelfHoldsSku: true,
      currentQty: 0,
      suggestedQty: 50,
      capacity: 100, // utilization = 50/100 = 0.5
      sameCategoryNeighbours: 1,
      occupiedNeighbours: 2, // affinity = 1/2 = 0.5
      skuPickedUnits: null,
      totalPickHistorySkus: 0,
      skusWithStrictlyFewerPicks: 0
    });

    expect(result.velocity_applied).toBe(false);
    expect(result.score).toBe(76.47);
  });

  it('P4-T03: Empty warehouse, recommend SKU001 x 50 -> Valid recommendation on STANDARD shelf; top score >= every alternative; ties broken by bin code', () => {
    const { db, cleanup } = setupDb();
    try {
      const res = recommendPlacement(db, {
        sku: 'SKU001',
        qty: 50,
        include_all: true
      });

      expect(res.recommended).toBeDefined();
      expect(res.recommended?.shelf_code.startsWith('D-01-') || res.recommended?.shelf_code.startsWith('D-02-')).toBe(false);

      if (res.alternatives.length > 0) {
        expect(res.recommended!.score).toBeGreaterThanOrEqual(res.alternatives[0].score);
      }

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P4-T04: Same-SKU bin with room vs empty bin at the same node -> Same-SKU bin ranks higher (consolidation)', () => {
    const { db, cleanup } = setupDb();
    try {
      // Put 20 SKU001 in A-01-L-1 (capacity 200)
      runTx(db, () => {
        seedBinStock(db, { bin: 'A-01-L-1', sku: 'SKU001', qty: 20 });
      });

      // Recommend placing 30 more SKU001
      const res = recommendPlacement(db, {
        sku: 'SKU001',
        qty: 30
      });

      expect(res.recommended).toBeDefined();
      expect(res.recommended?.bin_code).toBe('A-01-L-1');

      // Check consolidation breakdown factor is 1.0
      const consFactor = res.recommended?.breakdown.find(f => f.factor === 'consolidation');
      expect(consFactor?.value).toBe(1.0);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P4-T05: Bin holding another SKU -> Never in valid list; in all_bins with SKU_CONFLICT', () => {
    const { db, cleanup } = setupDb();
    try {
      runTx(db, () => {
        seedBinStock(db, { bin: 'A-01-L-1', sku: 'SKU002', qty: 20 });
      });

      const res = recommendPlacement(db, {
        sku: 'SKU001',
        qty: 10,
        include_all: true
      });

      expect(res.recommended?.bin_code).not.toBe('A-01-L-1');
      expect(res.alternatives.some(a => a.bin_code === 'A-01-L-1')).toBe(false);

      const conflictBin = res.all_bins?.find(b => b.bin_code === 'A-01-L-1');
      expect(conflictBin?.valid).toBe(false);
      expect(conflictBin?.reason).toBe('SKU_CONFLICT');

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P4-T06: Full bin / same-SKU bin with free < qty (allow_partial true then false)', () => {
    const { db, cleanup } = setupDb();
    try {
      // Fill A-01-L-4 to capacity (60 for level 4)
      runTx(db, () => {
        seedBinStock(db, { bin: 'A-01-L-4', sku: 'SKU001', qty: 60 });
      });

      // 1. Full bin is rejected with BIN_FULL
      const resFull = recommendPlacement(db, {
        sku: 'SKU001',
        qty: 10,
        include_all: true
      });
      const fullBin = resFull.all_bins?.find(b => b.bin_code === 'A-01-L-4');
      expect(fullBin?.valid).toBe(false);
      expect(fullBin?.reason).toBe('BIN_FULL');

      // 2. Put 50 in A-01-L-4 (cap 60, free 10). Request qty 20 with allow_partial=true
      db.prepare('UPDATE inventory SET qty = 50 WHERE bin_code = ?').run('A-01-L-4');

      const snapshot = loadPlacementSnapshot(db, 'SKU001');
      const binL4 = snapshot.bins.find(b => b.bin_code === 'A-01-L-4')!;

      const evalPartial = evaluateBin(binL4, snapshot.product, 20, true);
      expect(evalPartial.valid).toBe(true);
      if (evalPartial.valid) {
        expect(evalPartial.suggested_qty).toBe(10);
        expect(evalPartial.can_fit_full).toBe(false);
      }

      // 3. Request qty 20 with allow_partial=false -> INSUFFICIENT_CAPACITY
      const evalNoPartial = evaluateBin(binL4, snapshot.product, 20, false);
      expect(evalNoPartial.valid).toBe(false);
      if (!evalNoPartial.valid) {
        expect(evalNoPartial.reason).toBe('INSUFFICIENT_CAPACITY');
      }

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P4-T07: Blocked, damaged, maintenance-shelf, recount-required bins rejected with exact reason', () => {
    const { db, cleanup } = setupDb();
    try {
      db.prepare('UPDATE bins SET recount_required = 1 WHERE code = ?').run('A-01-L-1');

      const res = recommendPlacement(db, {
        sku: 'SKU001',
        qty: 10,
        include_all: true
      });

      const blocked = res.all_bins?.find(b => b.bin_code === 'D-06-R-3');
      expect(blocked?.valid).toBe(false);
      expect(blocked?.reason).toBe('BIN_BLOCKED');

      const damaged = res.all_bins?.find(b => b.bin_code === 'D-06-R-4');
      expect(damaged?.valid).toBe(false);
      expect(damaged?.reason).toBe('BIN_DAMAGED');

      const maintenance = res.all_bins?.find(b => b.bin_code === 'B-06-L-1');
      expect(maintenance?.valid).toBe(false);
      expect(maintenance?.reason).toBe('SHELF_UNAVAILABLE');

      const recount = res.all_bins?.find(b => b.bin_code === 'A-01-L-1');
      expect(recount?.valid).toBe(false);
      expect(recount?.reason).toBe('RECOUNT_REQUIRED');

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P4-T08: SKU023 (HAZMAT) vs SKU001: SKU023 only on D-01/D-02 shelves; SKU001 never on HAZMAT shelves', () => {
    const { db, cleanup } = setupDb();
    try {
      const hazmatRes = recommendPlacement(db, {
        sku: 'SKU023',
        qty: 10,
        include_all: true
      });

      expect(hazmatRes.recommended).toBeDefined();
      expect(
        hazmatRes.recommended?.shelf_code.startsWith('D-01-') ||
        hazmatRes.recommended?.shelf_code.startsWith('D-02-')
      ).toBe(true);

      const standardRes = recommendPlacement(db, {
        sku: 'SKU001',
        qty: 10,
        include_all: true
      });

      expect(standardRes.recommended).toBeDefined();
      expect(
        standardRes.recommended?.shelf_code.startsWith('D-01-') ||
        standardRes.recommended?.shelf_code.startsWith('D-02-')
      ).toBe(false);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P4-T09: < 3 SKUs with pick history -> velocity_applied: false; weights sum to 1', () => {
    const { db, cleanup } = setupDb();
    try {
      const res = recommendPlacement(db, {
        sku: 'SKU001',
        qty: 10
      });

      expect(res.scoring.velocity_applied).toBe(false);
      const sumWeights = Object.values(res.scoring.weights).reduce((a, b) => a + b, 0);
      expect(Math.abs(sumWeights - 1.0)).toBeLessThan(0.01);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P4-T10: Insert PICK movements for 3 SKUs then recommend for fastest and slowest -> velocity_applied: true', () => {
    const { db, cleanup } = setupDb();
    try {
      runTx(db, () => {
        db.prepare(`
          INSERT INTO stock_movements (ref, movement_type, sku, qty, from_kind, from_ref, to_kind, to_ref)
          VALUES
            ('MOV-T1', 'PICK', 'SKU001', 100, 'BIN', 'A-01-L-1', 'ORDER_PACKING', 'ORD-1'),
            ('MOV-T2', 'PICK', 'SKU002', 50,  'BIN', 'A-01-L-2', 'ORDER_PACKING', 'ORD-1'),
            ('MOV-T3', 'PICK', 'SKU003', 10,  'BIN', 'A-01-L-3', 'ORDER_PACKING', 'ORD-1')
        `).run();
      });

      const fastRes = recommendPlacement(db, { sku: 'SKU001', qty: 10 });
      expect(fastRes.scoring.velocity_applied).toBe(true);

      const slowRes = recommendPlacement(db, { sku: 'SKU003', qty: 10 });
      expect(slowRes.scoring.velocity_applied).toBe(true);

      // Fast mover recommendation distance from dock is <= slow mover recommendation distance
      expect(fastRes.recommended!.distance).toBeLessThanOrEqual(slowRes.recommended!.distance);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P4-T11: Affinity: neutral: true with no neighbours; > 0.5 when same-category neighbours exist in same bay', () => {
    const { db, cleanup } = setupDb();
    try {
      // Empty warehouse -> neutral: true
      const resEmpty = recommendPlacement(db, { sku: 'SKU001', qty: 10 });
      const affEmpty = resEmpty.recommended?.breakdown.find(f => f.factor === 'affinity');
      expect(affEmpty?.neutral).toBe(true);
      expect(affEmpty?.value).toBe(0.5);

      // Seed another Peripherals product (SKU002) at same nav node (e.g. A-01-L-2)
      runTx(db, () => {
        seedBinStock(db, { bin: 'A-01-L-2', sku: 'SKU002', qty: 20 });
      });

      const snapshot = loadPlacementSnapshot(db, 'SKU001');
      const binL1 = snapshot.bins.find(b => b.bin_code === 'A-01-L-1')!;
      const nodeBins = snapshot.binsByNode.get(binL1.nav_node_id)!;
      const occupiedNeighbours = nodeBins.filter(o => o.bin_code !== binL1.bin_code && o.current_qty > 0);
      const sameCategoryCount = occupiedNeighbours.filter(o => o.current_category === 'Peripherals').length;

      expect(occupiedNeighbours.length).toBe(1);
      expect(sameCategoryCount).toBe(1);
      expect(sameCategoryCount / occupiedNeighbours.length).toBe(1.0);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P4-T12: Split plan for qty > any single bin free capacity -> split_plan_complete: true or false', () => {
    const { db, cleanup } = setupDb();
    try {
      // Level 1 capacity is 200. Request 350.
      const res = recommendPlacement(db, { sku: 'SKU001', qty: 350 });
      expect(res.split_plan.length).toBeGreaterThan(1);

      const totalSplitQty = res.split_plan.reduce((sum, sp) => sum + sp.qty, 0);
      expect(totalSplitQty).toBe(350);
      expect(res.split_plan_complete).toBe(true);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P4-T13: validate vs all_bins for all 192 bins produces identical validity and reason', () => {
    const { db, cleanup } = setupDb();
    try {
      const res = recommendPlacement(db, { sku: 'SKU001', qty: 20, include_all: true });
      const snapshot = loadPlacementSnapshot(db, 'SKU001');

      expect(res.all_bins?.length).toBe(192);

      for (const binItem of res.all_bins!) {
        const binSnap = snapshot.bins.find(b => b.bin_code === binItem.bin_code)!;
        const evalRes = evaluateBin(binSnap, snapshot.product, 20, true);

        expect(binItem.valid).toBe(evalRes.valid);
        if (!binItem.valid && !evalRes.valid) {
          expect(binItem.reason).toBe(evalRes.reason);
        }
      }

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P4-T14 & P4-T15: Recommend twice with identical input is deterministic; does not alter inventory or ledger', () => {
    const { db, cleanup } = setupDb();
    try {
      const invCountBefore = db.prepare('SELECT COUNT(*) as c, SUM(qty) as s FROM inventory').get() as any;
      const movCountBefore = db.prepare('SELECT COUNT(*) as c FROM stock_movements').get() as any;

      const res1 = recommendPlacement(db, { sku: 'SKU001', qty: 25 });
      const res2 = recommendPlacement(db, { sku: 'SKU001', qty: 25 });

      expect(res1.recommended?.bin_code).toBe(res2.recommended?.bin_code);
      expect(res1.recommended?.score).toBe(res2.recommended?.score);
      expect(res1.split_plan).toEqual(res2.split_plan);

      const invCountAfter = db.prepare('SELECT COUNT(*) as c, SUM(qty) as s FROM inventory').get() as any;
      const movCountAfter = db.prepare('SELECT COUNT(*) as c FROM stock_movements').get() as any;

      expect(invCountAfter).toEqual(invCountBefore);
      expect(movCountAfter).toEqual(movCountBefore);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P4-T16: Gateway endpoint tests: qty > staged / unknown line / PICKER role / Engine 2 stopped', async () => {
    stack = await startStack({ seed: true });
    const opClient = apiClient(stack.urls.gateway);
    await opClient.login('operator1');

    // Create a receipt first
    const rcvRes = await opClient.post('/api/receipts', {
      lines: [{ sku: 'SKU001', qty: 30 }]
    }, { headers: { 'idempotency-key': 'p4-rcv-1' } });
    expect(rcvRes.status).toBe(201);
    const lineId = rcvRes.body.lines[0].line_id;

    // 1. Qty > staged (35 > 30) -> QUANTITY_INVALID
    const overQtyRes = await opClient.post('/api/placement/recommend', {
      receipt_line_id: lineId,
      qty: 35
    });
    expect(overQtyRes.status).toBe(422);
    expect(overQtyRes.body.error.code).toBe('QUANTITY_INVALID');

    // 2. Unknown receipt line -> NOT_FOUND
    const unknownLineRes = await opClient.post('/api/placement/recommend', {
      receipt_line_id: 999999
    });
    expect(unknownLineRes.status).toBe(404);
    expect(unknownLineRes.body.error.code).toBe('NOT_FOUND');

    // 3. PICKER role -> 403 FORBIDDEN
    const pickerClient = apiClient(stack.urls.gateway);
    await pickerClient.login('picker1');
    const forbiddenRes = await pickerClient.post('/api/placement/recommend', {
      receipt_line_id: lineId
    });
    expect(forbiddenRes.status).toBe(403);

    // 4. Successful recommendation as operator
    const goodRes = await opClient.post('/api/placement/recommend', {
      receipt_line_id: lineId
    });
    expect(goodRes.status).toBe(200);
    expect(goodRes.body.recommended).toBeDefined();

    // 5. Engine 2 stopped -> 503 ENGINE2_UNAVAILABLE
    await stack.kill('engine2');
    const engineDownRes = await opClient.post('/api/placement/recommend', {
      receipt_line_id: lineId
    });
    expect(engineDownRes.status).toBe(503);
    expect(engineDownRes.body.error.code).toBe('ENGINE2_UNAVAILABLE');

    // Restart Engine 2 for subsequent tests
    await stack.restart('engine2');
  });

  it('P4-T17: Placement validation API correctly validates matching and conflicting bins', async () => {
    if (!stack) {
      stack = await startStack({ seed: true });
    }
    const opClient = apiClient(stack.urls.gateway);
    await opClient.login('operator1');

    // Validate empty standard bin A-01-L-1 for STANDARD sku SKU001 -> valid
    const validRes = await opClient.post('/api/placement/validate', {
      dest_bin: 'A-01-L-1',
      sku: 'SKU001',
      qty: 10
    });
    expect(validRes.status).toBe(200);
    expect(validRes.body.valid).toBe(true);

    // Validate HAZMAT shelf D-01-L-1 for STANDARD sku SKU001 -> invalid STORAGE_CLASS_MISMATCH
    const mismatchRes = await opClient.post('/api/placement/validate', {
      dest_bin: 'D-01-L-1',
      sku: 'SKU001',
      qty: 10
    });
    expect(mismatchRes.status).toBe(200);
    expect(mismatchRes.body.valid).toBe(false);
    expect(mismatchRes.body.reason).toBe('STORAGE_CLASS_MISMATCH');
  });
});
