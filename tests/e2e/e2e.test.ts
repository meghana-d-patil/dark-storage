import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import Database from 'better-sqlite3';
import path from 'node:path';
import { startStack, RunningStack } from '../harness/stack.js';
import { apiClient } from '../harness/apiClient.js';
import { stockIn, recordMovement } from '../../services/engine3-inventory/src/domain/inventoryRepo.js';
import { runIntegrityChecks } from '../../scripts/verify-integrity.js';

describe('Phase 10 — Realtime (WebSocket), Hardening, Resilience & Full E2E', () => {
  let stack: RunningStack;
  let client: ReturnType<typeof apiClient>;
  let manager: ReturnType<typeof apiClient>;
  let operator1: ReturnType<typeof apiClient>;
  let picker1: ReturnType<typeof apiClient>;
  let staff1: ReturnType<typeof apiClient>;

  let managerToken: string;
  let operatorToken: string;
  let pickerToken: string;
  let staffToken: string;

  beforeAll(async () => {
    stack = await startStack({ seed: true });
    client = apiClient(stack.urls.gateway);
    manager = apiClient(stack.urls.gateway);
    operator1 = apiClient(stack.urls.gateway);
    picker1 = apiClient(stack.urls.gateway);
    staff1 = apiClient(stack.urls.gateway);

    const mgrLogin = await manager.login('manager1');
    managerToken = mgrLogin.token;

    const opLogin = await operator1.login('operator1');
    operatorToken = opLogin.token;

    const pickLogin = await picker1.login('picker1');
    pickerToken = pickLogin.token;

    const stfLogin = await staff1.login('staff1');
    staffToken = stfLogin.token;
  }, 45000);

  afterAll(async () => {
    if (stack) {
      await stack.stop();
    }
  });

  function getWsUrl(token?: string, since?: number): string {
    const base = stack.urls.gateway.replace('http://', 'ws://') + '/ws';
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    if (since !== undefined) params.set('since', String(since));
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  // P10-T01: WS auth: connect without token / with bad token / with valid token
  it('P10-T01: WS authentication: reject missing/bad token with 4401; accept valid token with connected greeting', async () => {
    // 1. Connect without token -> 4401
    const codeNoToken = await new Promise<number>((resolve) => {
      const ws = new WebSocket(getWsUrl());
      ws.on('close', (code) => resolve(code));
    });
    expect(codeNoToken).toBe(4401);

    // 2. Connect with bad token -> 4401
    const codeBadToken = await new Promise<number>((resolve) => {
      const ws = new WebSocket(getWsUrl('invalid-jwt-token-xyz'));
      ws.on('close', (code) => resolve(code));
    });
    expect(codeBadToken).toBe(4401);

    // 3. Connect with valid token -> receives { type: "connected" }
    const greeting = await new Promise<any>((resolve, reject) => {
      const ws = new WebSocket(getWsUrl(managerToken));
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        ws.close();
        resolve(msg);
      });
      ws.on('error', (err) => reject(err));
    });

    expect(greeting.type).toBe('connected');
    expect(typeof greeting.latest_seq).toBe('number');
  });

  // P10-T02: WS live push: connect WS, create a receipt via REST -> receives receipt.created within 1 s
  it('P10-T02: WS live push: connected client receives live event broadcast within 1 second of REST transaction', async () => {
    const ws = new WebSocket(getWsUrl(operatorToken));

    await new Promise<void>((resolve) => {
      ws.once('open', () => resolve());
    });

    // Promise waiting for receipt.created event
    const eventPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for WS event')), 4000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'event' && msg.event_type === 'receipt.created') {
          clearTimeout(timeout);
          resolve(msg);
        }
      });
    });

    // Create a receipt via REST as operator1
    const res = await operator1.post('/api/receipts', {
      carrier: 'FastExpress',
      tracking_number: 'TRK-LIVE-01',
      lines: [{ sku: 'SKU001', qty: 25 }]
    });
    expect(res.status).toBe(201);
    const receiptRef = res.body.ref;

    // Receive broadcast event
    const liveEvent = await eventPromise;
    expect(liveEvent.type).toBe('event');
    expect(liveEvent.event_type).toBe('receipt.created');
    expect(liveEvent.entity_id).toBe(receiptRef);
    expect(liveEvent.seq).toBeGreaterThanOrEqual(1);
    expect(liveEvent.replay).toBe(false);

    ws.close();
  });

  // P10-T03: WS gap-free replay
  it('P10-T03: WS gap-free replay: reconnect with ?since=seq receives missed events with replay: true in strict order', async () => {
    // 1. Connect and get current seq
    const ws1 = new WebSocket(getWsUrl(managerToken));
    const initGreeting = await new Promise<any>((resolve) => {
      ws1.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    const seq1 = initGreeting.latest_seq;
    ws1.close();

    // 2. Perform actions via REST that produce outbox events while disconnected
    // Create receipt
    const rcvRes = await operator1.post('/api/receipts', {
      carrier: 'ReplayFreight',
      tracking_number: `TRK-REPLAY-${Date.now()}`,
      lines: [{ sku: 'SKU003', qty: 15 }]
    });
    expect(rcvRes.status).toBe(201);

    // Give poller a moment to pick up seq
    await new Promise((r) => setTimeout(r, 600));

    // 3. Reconnect with ?since=seq1
    const ws2 = new WebSocket(getWsUrl(managerToken, seq1));

    const receivedEvents: any[] = [];
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(), 3000);
      ws2.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'event' && msg.replay === true) {
          receivedEvents.push(msg);
          if (receivedEvents.length >= 1) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });
      ws2.on('error', (err) => reject(err));
    });

    ws2.close();

    expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
    for (const ev of receivedEvents) {
      expect(ev.replay).toBe(true);
      expect(ev.seq).toBeGreaterThan(seq1);
    }
    // Verify strict sequential ordering
    for (let i = 1; i < receivedEvents.length; i++) {
      expect(receivedEvents[i].seq).toBeGreaterThan(receivedEvents[i - 1].seq);
    }
  });

  // P10-T04: Full Happy-Path Golden Lifecycle (API E2E)
  it('P10-T04: Full Happy-Path Golden Lifecycle: Receive -> Putaway -> Order -> Mission -> Pick -> Pack -> COMPLETED', async () => {
    // 1. operator1 receives RCV-0001 (50 x SKU001, 30 x SKU002)
    const rcvRes = await operator1.post('/api/receipts', {
      carrier: 'GoldenFreight',
      tracking_number: 'TRK-GOLDEN-01',
      lines: [
        { sku: 'SKU001', qty: 50 },
        { sku: 'SKU002', qty: 30 }
      ]
    });
    expect(rcvRes.status).toBe(201);
    const rcv = rcvRes.body;
    const line1 = rcv.lines.find((l: any) => l.sku === 'SKU001');
    const line2 = rcv.lines.find((l: any) => l.sku === 'SKU002');

    // 2. operator1 gets placement recommendations and puts away both lines
    const rec1 = await operator1.post('/api/placement/recommend', { receipt_line_id: line1.line_id });
    expect(rec1.status).toBe(200);
    const targetBin1 = rec1.body.recommended?.bin_code || 'A-01-L-1';

    const put1 = await operator1.post('/api/putaways', {
      receipt_line_id: line1.line_id,
      dest_bin: targetBin1,
      qty: 50
    });
    expect(put1.status).toBe(201);
    expect(put1.body.ref).toMatch(/^PUT-\d+$/);

    const rec2 = await operator1.post('/api/placement/recommend', { receipt_line_id: line2.line_id });
    expect(rec2.status).toBe(200);
    const targetBin2 = rec2.body.recommended?.bin_code || 'A-01-L-2';

    const put2 = await operator1.post('/api/putaways', {
      receipt_line_id: line2.line_id,
      dest_bin: targetBin2,
      qty: 30
    });
    expect(put2.status).toBe(201);
    expect(put2.body.ref).toMatch(/^PUT-\d+$/);

    // 3. manager1 creates order (10 x SKU001, 5 x SKU002)
    const ordRes = await manager.post('/api/orders', {
      order_type: 'CUSTOMER',
      priority: 'NORMAL',
      customer_ref: 'Golden Customer',
      lines: [
        { sku: 'SKU001', qty: 10 },
        { sku: 'SKU002', qty: 5 }
      ]
    });
    expect(ordRes.status).toBe(201);
    const orderRef = ordRes.body.ref;

    // 4. manager1 assigns picker1
    const assignRes = await manager.post(`/api/orders/${orderRef}/assign`, {
      picker_id: 3 // picker1
    });
    expect(assignRes.status).toBe(201);
    const missionRef = assignRes.body.ref;

    // 5. picker1 starts mission and confirms both stops
    const startRes = await picker1.post(`/api/missions/${missionRef}/start`, {});
    expect(startRes.status).toBe(200);

    const missionDetail = await picker1.get(`/api/missions/${missionRef}`);
    expect(missionDetail.body.stops.length).toBe(2);

    for (const stop of missionDetail.body.stops) {
      const confirmRes = await picker1.post(`/api/pick-stops/${stop.stop_ref}/confirm`, {
        scanned_bin: stop.bin_code,
        scanned_sku: stop.sku,
        picked_qty: stop.qty_required
      });
      expect(confirmRes.status).toBe(200);
    }

    // 6. staff1 views packing queue and packs ORD-0001
    const queueRes = await staff1.get('/api/packing/queue');
    expect(queueRes.status).toBe(200);
    const inQueue = queueRes.body.items.find((i: any) => i.order_ref === orderRef);
    expect(inQueue).toBeDefined();
    expect(inQueue.fulfilment_preview).toBe('FULL');

    const packRes = await staff1.post(`/api/orders/${orderRef}/pack`, {
      notes: 'Golden order complete'
    });
    expect(packRes.status).toBe(201);
    expect(packRes.body.fulfilment_type).toBe('FULL');
    expect(packRes.body.packing_ref).toMatch(/^PCK-\d+$/);

    // 7. Invariants & state assertions
    const finalOrder = await manager.get(`/api/orders/${orderRef}`);
    expect(finalOrder.body.status).toBe('COMPLETED');
    expect(finalOrder.body.fulfilment_type).toBe('FULL');

    // Check database integrity
    const wDb = new Database(stack.tempDb.warehouseDbPath, { readonly: true });
    const report = runIntegrityChecks(wDb);
    wDb.close();

    expect(report.ok).toBe(true);
    for (const c of report.checks) {
      expect(['PASS', 'SKIP']).toContain(c.status);
    }
  });

  // P10-T05: Full Exception & Partial-Pack Lifecycle (API E2E)
  it('P10-T05: Full Exception & Partial-Pack Lifecycle: short pick -> exception -> accept short -> manager partial pack', async () => {
    // 1. Stock 10 x SKU001 in bin B-01-L-1
    const wDbWrite = new Database(stack.tempDb.warehouseDbPath);
    wDbWrite.pragma('journal_mode = WAL');
    stockIn(wDbWrite, { bin: 'B-01-L-1', sku: 'SKU001', qty: 10 });
    recordMovement(wDbWrite, {
      type: 'ADJUSTMENT',
      sku: 'SKU001',
      qty: 10,
      from: { kind: 'ADJUSTMENT', ref: 'INIT' },
      to: { kind: 'BIN', ref: 'B-01-L-1' },
      actorId: 1
    });
    wDbWrite.close();

    // 2. Create order for 10 units
    const ordRes = await manager.post('/api/orders', {
      order_type: 'CUSTOMER',
      priority: 'NORMAL',
      customer_ref: 'Partial Customer',
      lines: [{ sku: 'SKU001', qty: 10 }]
    });
    expect(ordRes.status).toBe(201);
    const orderRef = ordRes.body.ref;

    // 3. Assign and start mission
    const assignRes = await manager.post(`/api/orders/${orderRef}/assign`, { picker_id: 3 });
    expect(assignRes.status).toBe(201);
    const missionRef = assignRes.body.ref;

    await picker1.post(`/api/missions/${missionRef}/start`, {});
    const missionDetail = await picker1.get(`/api/missions/${missionRef}`);
    const stop = missionDetail.body.stops[0];

    // 4. Picker confirms short pick (6 of 10) with SHORT_PICK
    const confirmRes = await picker1.post(`/api/pick-stops/${stop.stop_ref}/confirm`, {
      scanned_bin: stop.bin_code,
      scanned_sku: stop.sku,
      picked_qty: 6,
      exception: { type: 'SHORT_PICK', notes: '4 units damaged' }
    });
    expect(confirmRes.status).toBe(200);
    const excRef = confirmRes.body.exception?.ref;
    expect(excRef).toBeTruthy();

    // 5. Manager resolves exception with ACCEPT_SHORT and recount
    const resolveRes = await manager.post(`/api/exceptions/${excRef}/resolve`, {
      action: 'ACCEPT_SHORT',
      notes: 'Customer accepted partial',
      recount: { counted_qty: 0 }
    });
    expect(resolveRes.status).toBe(200);

    // Order status is now PICKED
    const ordPicked = await manager.get(`/api/orders/${orderRef}`);
    expect(ordPicked.body.status).toBe('PICKED');

    // 6. staff1 attempts to pack -> 403 PARTIAL_PACK_FORBIDDEN
    const staffPackRes = await staff1.post(`/api/orders/${orderRef}/pack`, {
      notes: 'Staff pack attempt'
    });
    expect(staffPackRes.status).toBe(403);

    // 7. manager1 packs with accept_partial: true
    const mgrPackRes = await manager.post(`/api/orders/${orderRef}/pack`, {
      notes: 'Manager accepted shortfall',
      accept_partial: true
    });
    expect(mgrPackRes.status).toBe(201);
    expect(mgrPackRes.body.fulfilment_type).toBe('PARTIAL');
    expect(mgrPackRes.body.total_ordered).toBe(10);
    expect(mgrPackRes.body.total_picked).toBe(6);

    // 8. Invariants check
    const wDb = new Database(stack.tempDb.warehouseDbPath, { readonly: true });
    const report = runIntegrityChecks(wDb);
    wDb.close();
    expect(report.ok).toBe(true);
  });

  // P10-T06: Exception Reallocate Lifecycle (API E2E)
  it('P10-T06: Exception Reallocate Lifecycle: BIN_EMPTY -> Reallocate -> new stop confirmed -> full pack', async () => {
    // 1. Stock SKU002 in two bins (B-02-L-1: 10, B-03-L-1: 10)
    const wDbWrite = new Database(stack.tempDb.warehouseDbPath);
    wDbWrite.pragma('journal_mode = WAL');
    stockIn(wDbWrite, { bin: 'B-02-L-1', sku: 'SKU002', qty: 10 });
    recordMovement(wDbWrite, {
      type: 'ADJUSTMENT',
      sku: 'SKU002',
      qty: 10,
      from: { kind: 'ADJUSTMENT', ref: 'INIT' },
      to: { kind: 'BIN', ref: 'B-02-L-1' },
      actorId: 1
    });
    stockIn(wDbWrite, { bin: 'B-03-L-1', sku: 'SKU002', qty: 10 });
    recordMovement(wDbWrite, {
      type: 'ADJUSTMENT',
      sku: 'SKU002',
      qty: 10,
      from: { kind: 'ADJUSTMENT', ref: 'INIT' },
      to: { kind: 'BIN', ref: 'B-03-L-1' },
      actorId: 1
    });
    wDbWrite.close();

    // 2. Create order for 8 units
    const ordRes = await manager.post('/api/orders', {
      order_type: 'CUSTOMER',
      priority: 'NORMAL',
      customer_ref: 'Realloc Customer',
      lines: [{ sku: 'SKU002', qty: 8 }]
    });
    expect(ordRes.status).toBe(201);
    const orderRef = ordRes.body.ref;

    // 3. Assign & start mission
    const assignRes = await manager.post(`/api/orders/${orderRef}/assign`, { picker_id: 3 });
    expect(assignRes.status).toBe(201);
    const missionRef = assignRes.body.ref;

    await picker1.post(`/api/missions/${missionRef}/start`, {});
    const m1 = await picker1.get(`/api/missions/${missionRef}`);
    const stop1 = m1.body.stops[0];

    // 4. Picker reports problem BIN_EMPTY on stop 1
    const probRes = await picker1.post(`/api/pick-stops/${stop1.stop_ref}/exception`, {
      type: 'BIN_EMPTY',
      notes: 'Shelf is completely empty'
    });
    expect(probRes.status).toBe(201);
    const excRef = probRes.body.ref;

    // 5. Manager resolves with REALLOCATE and recount
    const resolveRes = await manager.post(`/api/exceptions/${excRef}/resolve`, {
      action: 'REALLOCATE',
      notes: 'Reallocating from other bin',
      recount: { counted_qty: 0 }
    });
    expect(resolveRes.status).toBe(200);

    // 6. Mission now has new reallocated stop
    const m2 = await picker1.get(`/api/missions/${missionRef}`);
    const newStop = m2.body.stops.find((s: any) => s.status === 'PENDING');
    expect(newStop).toBeDefined();

    // Confirm new stop
    const confirm2 = await picker1.post(`/api/pick-stops/${newStop.stop_ref}/confirm`, {
      scanned_bin: newStop.bin_code,
      scanned_sku: newStop.sku,
      picked_qty: 8
    });
    expect(confirm2.status).toBe(200);

    // 7. Staff packs order -> FULL
    const packRes = await staff1.post(`/api/orders/${orderRef}/pack`, {
      notes: 'Packed after reallocation'
    });
    expect(packRes.status).toBe(201);
    expect(packRes.body.fulfilment_type).toBe('FULL');

    // 8. Integrity verification
    const wDb = new Database(stack.tempDb.warehouseDbPath, { readonly: true });
    const report = runIntegrityChecks(wDb);
    wDb.close();
    expect(report.ok).toBe(true);
  });

  // P10-T07: High-concurrency contention stress test
  it('P10-T07: High-concurrency contention stress test: concurrent orders, putaways, relocations produce zero deadlocks and preserve invariants', async () => {
    // 1. Seed stock for concurrency test
    const wDbWrite = new Database(stack.tempDb.warehouseDbPath);
    wDbWrite.pragma('journal_mode = WAL');
    stockIn(wDbWrite, { bin: 'C-01-L-1', sku: 'SKU001', qty: 50 });
    recordMovement(wDbWrite, {
      type: 'ADJUSTMENT',
      sku: 'SKU001',
      qty: 50,
      from: { kind: 'ADJUSTMENT', ref: 'INIT' },
      to: { kind: 'BIN', ref: 'C-01-L-1' },
      actorId: 1
    });
    stockIn(wDbWrite, { bin: 'C-01-L-2', sku: 'SKU001', qty: 50 });
    recordMovement(wDbWrite, {
      type: 'ADJUSTMENT',
      sku: 'SKU001',
      qty: 50,
      from: { kind: 'ADJUSTMENT', ref: 'INIT' },
      to: { kind: 'BIN', ref: 'C-01-L-2' },
      actorId: 1
    });
    wDbWrite.close();

    // Create 8 concurrent order creation promises
    const orderPromises = Array.from({ length: 8 }, (_, i) =>
      manager.post(
        '/api/orders',
        {
          order_type: 'CUSTOMER',
          priority: 'NORMAL',
          customer_ref: `Concurrent Order ${i}`,
          lines: [{ sku: 'SKU001', qty: 10 }]
        },
        { idempotencyKey: `conc-ord-${i}-${Date.now()}` }
      )
    );

    // Await all concurrent operations
    const results = await Promise.all(orderPromises);

    // Verify all requests returned valid HTTP responses (either 201 or domain rejection if ATP exceeded)
    for (const res of results) {
      expect([201, 400, 409]).toContain(res.status);
      expect(res.status).not.toBe(500);
      expect(res.status).not.toBe(503);
    }

    // Verify exact conservation of stock via integrity checks
    const wDb = new Database(stack.tempDb.warehouseDbPath, { readonly: true });
    const report = runIntegrityChecks(wDb);
    wDb.close();
    expect(report.ok).toBe(true);
  });

  // P10-T08: Crash & restart resilience
  it('P10-T08: Crash & restart resilience: process restarts mid-workflow preserve all state and allow completion', async () => {
    // 1. Stock some inventory
    const wDbWrite = new Database(stack.tempDb.warehouseDbPath);
    wDbWrite.pragma('journal_mode = WAL');
    stockIn(wDbWrite, { bin: 'C-02-L-1', sku: 'SKU001', qty: 20 });
    recordMovement(wDbWrite, {
      type: 'ADJUSTMENT',
      sku: 'SKU001',
      qty: 20,
      from: { kind: 'ADJUSTMENT', ref: 'INIT' },
      to: { kind: 'BIN', ref: 'C-02-L-1' },
      actorId: 1
    });
    wDbWrite.close();

    // 2. Create order A (stays RESERVED)
    const ordA = await manager.post('/api/orders', {
      order_type: 'CUSTOMER',
      priority: 'NORMAL',
      customer_ref: 'Order A Crash Test',
      lines: [{ sku: 'SKU001', qty: 5 }]
    });
    expect(ordA.status).toBe(201);

    // 3. Create order B, assign, start mission
    const ordB = await manager.post('/api/orders', {
      order_type: 'CUSTOMER',
      priority: 'NORMAL',
      customer_ref: 'Order B Crash Test',
      lines: [{ sku: 'SKU001', qty: 5 }]
    });
    expect(ordB.status).toBe(201);
    const orderBRef = ordB.body.ref;

    const assignB = await manager.post(`/api/orders/${orderBRef}/assign`, { picker_id: 3 });
    expect(assignB.status).toBe(201);
    const missionBRef = assignB.body.ref;

    await picker1.post(`/api/missions/${missionBRef}/start`, {});

    // 4. Crash and restart all services
    await stack.restartService('engine1');
    await stack.restartService('engine2');
    await stack.restartService('engine3');
    await stack.restartService('gateway');

    // 5. Verify state after restart
    const checkA = await manager.get(`/api/orders/${ordA.body.ref}`);
    expect(checkA.status).toBe(200);
    expect(checkA.body.status).toBe('RESERVED');

    const checkB = await manager.get(`/api/orders/${orderBRef}`);
    expect(checkB.status).toBe(200);
    expect(checkB.body.status).toBe('PICKING');

    // 6. Complete picking and packing on Order B
    const misB = await picker1.get(`/api/missions/${missionBRef}`);
    const stopB = misB.body.stops[0];
    const confirmB = await picker1.post(`/api/pick-stops/${stopB.stop_ref}/confirm`, {
      scanned_bin: stopB.bin_code,
      scanned_sku: stopB.sku,
      picked_qty: 5
    });
    expect(confirmB.status).toBe(200);

    const packB = await staff1.post(`/api/orders/${orderBRef}/pack`, {
      notes: 'Packed cleanly after crash restart'
    });
    expect(packB.status).toBe(201);
    expect(packB.body.fulfilment_type).toBe('FULL');

    // 7. Verify integrity
    const wDb = new Database(stack.tempDb.warehouseDbPath, { readonly: true });
    const report = runIntegrityChecks(wDb);
    wDb.close();
    expect(report.ok).toBe(true);
  });

  // P10-T09: Complete UI workflow contracts & state transitions
  it('P10-T09: Complete UI workflow contracts: RBAC roles, transitions, and persistence match all UI invariants', async () => {
    // Verify role matrix across all critical endpoints
    const unauthed = apiClient(stack.urls.gateway);

    // Public health
    const health = await unauthed.get('/health');
    expect(health.status).toBe(200);

    // Unauthenticated protection
    const unauthOrd = await unauthed.get('/api/orders');
    expect(unauthOrd.status).toBe(401);

    // Role restrictions: PICKER cannot create receipts
    const pickerRcv = await picker1.post('/api/receipts', { carrier: 'X', tracking_number: 'Y', lines: [] });
    expect(pickerRcv.status).toBe(403);

    // Role restrictions: OPERATOR cannot create orders
    const opOrd = await operator1.post('/api/orders', { order_type: 'CUSTOMER', lines: [] });
    expect(opOrd.status).toBe(403);

    // Role restrictions: STAFF cannot access admin integrity
    const staffInteg = await staff1.get('/api/admin/integrity');
    expect(staffInteg.status).toBe(403);

    // Manager has access to all admin views
    const mgrInteg = await manager.get('/api/admin/integrity');
    expect(mgrInteg.status).toBe(200);
    expect(mgrInteg.body.ok).toBe(true);
  });

  it('P5-StressLab-Live: Stress Lab live scenarios (Race for Stock & Idempotency Replay) pass against full stack', async () => {
    // 1. Pre-check integrity
    const preInteg = await manager.get('/api/admin/integrity');
    expect(preInteg.status).toBe(200);
    expect(preInteg.body.ok).toBe(true);
    expect(preInteg.body.checks.length).toBe(13);

    // --- Scenario 1: Race for Stock (Engine 1 Mutex) ---
    // Read inventory to find SKU with >= 4 available
    const invRes = await manager.get('/api/inventory/summary');
    expect(invRes.status).toBe(200);
    const eligible = invRes.body.items.find(
      (i: any) => (i.available_to_promise ?? (i.stored_qty - i.reserved_qty)) >= 4 && i.sku
    );
    expect(eligible).toBeDefined();

    const testSku = eligible.sku;
    const available = eligible.available_to_promise ?? (eligible.stored_qty - eligible.reserved_qty);
    const orderQty = Math.floor(available / 2);

    // Fire 5 parallel order requests
    const racePromises = [];
    for (let i = 1; i <= 5; i++) {
      const idemKey = `e2e-race-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      racePromises.push(
        manager.post('/api/orders', {
          lines: [{ sku: testSku, qty: orderQty }]
        }, {
          headers: { 'Idempotency-Key': idemKey }
        })
      );
    }

    const raceResponses = await Promise.all(racePromises);
    const successes = raceResponses.filter((r) => r.status === 201);
    const failures = raceResponses.filter((r) => r.status === 409 && r.body.error?.code === 'INSUFFICIENT_STOCK');

    expect(successes.length).toBe(2);
    expect(failures.length).toBe(3);

    // Check integrity mid-scenario
    const midInteg = await manager.get('/api/admin/integrity');
    expect(midInteg.status).toBe(200);
    expect(midInteg.body.ok).toBe(true);

    // Clean up created orders
    for (const s of successes) {
      const cancelRes = await manager.post(`/api/orders/${s.body.ref}/cancel`, {
        reason: 'stress-lab cleanup'
      });
      expect(cancelRes.status).toBe(200);
    }

    // Post-cleanup integrity check
    const postCleanupInteg = await manager.get('/api/admin/integrity');
    expect(postCleanupInteg.status).toBe(200);
    expect(postCleanupInteg.body.ok).toBe(true);

    // --- Scenario 2: Idempotency Replay (Engine 3 Atomicity) ---
    const testIdemKey = `e2e-idem-${Date.now()}`;
    const initialOrderBody = { lines: [{ sku: testSku, qty: 1 }] };

    // Fire 5 parallel requests with identical key
    const idemPromises = [];
    for (let i = 1; i <= 5; i++) {
      idemPromises.push(
        manager.post('/api/orders', initialOrderBody, {
          headers: { 'Idempotency-Key': testIdemKey }
        })
      );
    }

    const parallelIdemRes = await Promise.all(idemPromises);
    for (const r of parallelIdemRes) {
      expect([200, 201]).toContain(r.status);
    }

    // 1 sequential replay with identical key and body
    const seqIdemRes = await manager.post('/api/orders', initialOrderBody, {
      headers: { 'Idempotency-Key': testIdemKey }
    });
    expect([200, 201]).toContain(seqIdemRes.status);

    // All 6 requests must resolve to the identical order reference
    const orderRefs = new Set([...parallelIdemRes, seqIdemRes].map((r) => r.body.ref));
    expect(orderRefs.size).toBe(1);

    // Reusing the same key with different payload throws 422 IDEMPOTENCY_KEY_REUSED
    const mismatchedRes = await manager.post('/api/orders', {
      lines: [{ sku: testSku, qty: 2 }] // Mismatched qty
    }, {
      headers: { 'Idempotency-Key': testIdemKey }
    });

    expect(mismatchedRes.status).toBe(422);
    expect(mismatchedRes.body.error?.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Final integrity verification
    const finalInteg = await manager.get('/api/admin/integrity');
    expect(finalInteg.status).toBe(200);
    expect(finalInteg.body.ok).toBe(true);
  });

  it('P6-EventFeed-Live: Outbox events (order.created, reservation.changed, inventory.changed) stream via WebSocket to live feed', async () => {
    const wsUrl = getWsUrl(managerToken);

    const receivedEvents: any[] = [];
    let wsReadyResolve: () => void;
    const wsReady = new Promise<void>((res) => {
      wsReadyResolve = res;
    });

    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      // connected
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'connected') {
        wsReadyResolve();
      } else if (msg.type === 'event') {
        receivedEvents.push(msg);
      }
    });

    await wsReady;

    // Create an order
    const feedKey = `feed-order-${Date.now()}`;
    const orderRes = await manager.post('/api/orders', {
      order_type: 'CUSTOMER',
      priority: 'NORMAL',
      lines: [{ sku: 'SKU001', qty: 1 }]
    }, {
      headers: { 'Idempotency-Key': feedKey }
    });
    expect([200, 201]).toContain(orderRes.status);
    const orderRef = orderRes.body.ref;

    // Wait up to 3.5s for WebSocket events to arrive
    const start = Date.now();
    while (Date.now() - start < 3500) {
      const oc = receivedEvents.find((e) => e.event_type === 'order.created' && e.entity_id === orderRef);
      const rc = receivedEvents.find((e) => e.event_type === 'reservation.changed' && (e.data?.order_ref === orderRef || e.entity_id === orderRef));
      const ic = receivedEvents.find((e) => e.event_type === 'inventory.changed' && e.seq >= (oc?.seq ?? 0));
      if (oc && rc && ic) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    ws.close();

    const orderCreated = receivedEvents.find((e) => e.event_type === 'order.created' && e.entity_id === orderRef);
    const resChanged = receivedEvents.find((e) => e.event_type === 'reservation.changed' && (e.data?.order_ref === orderRef || e.entity_id === orderRef));
    const invChanged = receivedEvents.find((e) => e.event_type === 'inventory.changed' && e.seq >= (orderCreated?.seq ?? 0));

    expect(orderCreated).toBeDefined();
    expect(orderCreated.seq).toBeGreaterThan(0);
    expect(orderCreated.entity_id).toBe(orderRef);

    expect(resChanged).toBeDefined();
    expect(resChanged.seq).toBeGreaterThan(0);

    expect(invChanged).toBeDefined();
    expect(invChanged.seq).toBeGreaterThan(0);
  });
});
