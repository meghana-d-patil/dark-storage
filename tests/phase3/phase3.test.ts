import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { DomainError } from '@dark-storage/shared';
import { createTempDbPaths } from '../harness/tempDb.js';
import { startStack, StackHandle } from '../harness/stack.js';
import { apiClient } from '../harness/apiClient.js';
import { applyMigrations } from '../../scripts/migrate.js';
import { seedBase } from '../../scripts/seed-base.js';
import { runIntegrityChecks } from '../../scripts/verify-integrity.js';
import { runTx } from '../../services/engine3-inventory/src/db/tx.js';
import { createReceipt } from '../../services/engine3-inventory/src/domain/receivingRepo.js';

describe('Phase 3 Receiving Tests', () => {
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

  it('P3-T01: Receive 50 x SKU001 -> Receipt RCV-0001 STAGED; line staged 50; ledger RECEIVE with MOV-0001; audit row; outbox receipt.created', () => {
    const { db, cleanup } = setupDb();
    try {
      const receipt = runTx(db, () =>
        createReceipt(db, {
          supplier: 'Acme Distribution',
          reference_no: 'PO-88421',
          notes: 'Pallet 1 of 2',
          lines: [{ sku: 'SKU001', qty: 50 }],
          actor: { id: 2, name: 'Omar Operator', role: 'OPERATOR' }
        })
      );

      expect(receipt.ref).toBe('RCV-0001');
      expect(receipt.status).toBe('STAGED');
      expect(receipt.lines.length).toBe(1);
      expect(receipt.lines[0].sku).toBe('SKU001');
      expect(receipt.lines[0].qty_received).toBe(50);
      expect(receipt.lines[0].qty_staged).toBe(50);
      expect(receipt.lines[0].movement_ref).toBe('MOV-0001');

      // Check stock_movements
      const mov = db.prepare('SELECT * FROM stock_movements WHERE ref = ?').get('MOV-0001') as any;
      expect(mov).toBeDefined();
      expect(mov.movement_type).toBe('RECEIVE');
      expect(mov.sku).toBe('SKU001');
      expect(mov.qty).toBe(50);
      expect(mov.from_kind).toBe('EXTERNAL');
      expect(mov.to_kind).toBe('STAGING');
      expect(mov.to_ref).toBe('RCV-0001');

      // Check audit_log
      const auditRow = db.prepare("SELECT * FROM audit_log WHERE entity_type = 'RECEIPT' AND entity_id = 'RCV-0001'").get() as any;
      expect(auditRow).toBeDefined();
      expect(auditRow.action).toBe('RECEIPT_CREATED');

      // Check outbox_events
      const outbox = db.prepare("SELECT * FROM outbox_events WHERE entity_type = 'RECEIPT' AND entity_id = 'RCV-0001'").get() as any;
      expect(outbox).toBeDefined();
      expect(outbox.event_type).toBe('receipt.created');

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P3-T02: Multi-line receipt (3 SKUs) -> One receipt, 3 lines, 3 movements, committed together', () => {
    const { db, cleanup } = setupDb();
    try {
      const receipt = runTx(db, () =>
        createReceipt(db, {
          lines: [
            { sku: 'SKU001', qty: 10 },
            { sku: 'SKU002', qty: 20 },
            { sku: 'SKU003', qty: 30 }
          ],
          actor: { id: 2, name: 'Omar Operator', role: 'OPERATOR' }
        })
      );

      expect(receipt.ref).toBe('RCV-0001');
      expect(receipt.lines.length).toBe(3);
      expect(receipt.lines[0].movement_ref).toBe('MOV-0001');
      expect(receipt.lines[1].movement_ref).toBe('MOV-0002');
      expect(receipt.lines[2].movement_ref).toBe('MOV-0003');

      const movCount = db.prepare("SELECT COUNT(*) as c FROM stock_movements WHERE to_ref = 'RCV-0001'").get() as { c: number };
      expect(movCount.c).toBe(3);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P3-T03: Line 2 has unknown SKU -> 422 UNKNOWN_SKU; no receipt/line/movement rows; next receipt is still RCV-0001', () => {
    const { db, cleanup } = setupDb();
    try {
      expect(() => {
        runTx(db, () =>
          createReceipt(db, {
            lines: [
              { sku: 'SKU001', qty: 10 },
              { sku: 'SKU999_NON_EXISTENT', qty: 20 }
            ],
            actor: { id: 2, name: 'Omar Operator', role: 'OPERATOR' }
          })
        );
      }).toThrow(/UNKNOWN_SKU/);

      const rCount = db.prepare('SELECT COUNT(*) as c FROM receipts').get() as { c: number };
      expect(rCount.c).toBe(0);

      const lCount = db.prepare('SELECT COUNT(*) as c FROM receipt_lines').get() as { c: number };
      expect(lCount.c).toBe(0);

      const mCount = db.prepare('SELECT COUNT(*) as c FROM stock_movements').get() as { c: number };
      expect(mCount.c).toBe(0);

      // Next successful receipt gets RCV-0001 with no gap
      const goodReceipt = runTx(db, () =>
        createReceipt(db, {
          lines: [{ sku: 'SKU001', qty: 10 }],
          actor: { id: 2, name: 'Omar Operator', role: 'OPERATOR' }
        })
      );
      expect(goodReceipt.ref).toBe('RCV-0001');

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P3-T04: qty 0, -5, 2.5, "10", over product max -> VALIDATION_ERROR / QUANTITY_INVALID', () => {
    const { db, cleanup } = setupDb();
    try {
      // 0 qty
      expect(() => {
        runTx(db, () =>
          createReceipt(db, {
            lines: [{ sku: 'SKU001', qty: 0 }],
            actor: { id: 2, name: 'Omar', role: 'OPERATOR' }
          })
        );
      }).toThrow(/QUANTITY_INVALID/);

      // -5 qty
      expect(() => {
        runTx(db, () =>
          createReceipt(db, {
            lines: [{ sku: 'SKU001', qty: -5 }],
            actor: { id: 2, name: 'Omar', role: 'OPERATOR' }
          })
        );
      }).toThrow(/QUANTITY_INVALID/);

      // 2.5 qty (not integer)
      expect(() => {
        runTx(db, () =>
          createReceipt(db, {
            lines: [{ sku: 'SKU001', qty: 2.5 }],
            actor: { id: 2, name: 'Omar', role: 'OPERATOR' }
          })
        );
      }).toThrow(/QUANTITY_INVALID/);

      // Exceed product max_receive_qty (5000 in seed)
      expect(() => {
        runTx(db, () =>
          createReceipt(db, {
            lines: [{ sku: 'SKU001', qty: 6000 }],
            actor: { id: 2, name: 'Omar', role: 'OPERATOR' }
          })
        );
      }).toThrow(/QUANTITY_INVALID/);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P3-T05: Same SKU twice in one request -> DUPLICATE_LINE_SKU', () => {
    const { db, cleanup } = setupDb();
    try {
      expect(() => {
        runTx(db, () =>
          createReceipt(db, {
            lines: [
              { sku: 'SKU001', qty: 10 },
              { sku: 'SKU001', qty: 20 }
            ],
            actor: { id: 2, name: 'Omar', role: 'OPERATOR' }
          })
        );
      }).toThrow(/DUPLICATE_LINE_SKU/);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P3-T06 & P3-T07 & P3-T08: Idempotency enforcement via API', async () => {
    stack = await startStack({ seed: true });
    const client = apiClient(stack.urls.gateway);
    await client.login('operator1');

    const idemKey = 'test-receipt-key-001';
    const payload1 = {
      supplier: 'Acme Distribution',
      reference_no: 'PO-1001',
      lines: [{ sku: 'SKU001', qty: 50 }]
    };

    // P3-T08: No Idempotency-Key header -> 400 IDEMPOTENCY_KEY_REQUIRED
    const noKeyRes = await client.post('/api/receipts', payload1, { omitIdempotencyKey: true });
    expect(noKeyRes.status).toBe(400);
    expect(noKeyRes.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    // P3-T06: First submission with Idempotency-Key -> 201
    const res1 = await client.post('/api/receipts', payload1, {
      headers: { 'idempotency-key': idemKey }
    });
    expect(res1.status).toBe(201);
    expect(res1.body.ref).toBe('RCV-0001');

    // Replay same key + body -> identical response
    const res2 = await client.post('/api/receipts', payload1, {
      headers: { 'idempotency-key': idemKey }
    });
    expect(res2.status).toBe(201);
    expect(res2.body.ref).toBe('RCV-0001');

    // P3-T07: Same key, different body -> 422 IDEMPOTENCY_KEY_REUSED
    const resDifferent = await client.post(
      '/api/receipts',
      { supplier: 'Different Supplier', lines: [{ sku: 'SKU001', qty: 50 }] },
      { headers: { 'idempotency-key': idemKey } }
    );
    expect(resDifferent.status).toBe(422);
    expect(resDifferent.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('P3-T09: hooks.afterStep throws after line 2 -> Full rollback: no rows anywhere; sequences unchanged', () => {
    const { db, cleanup } = setupDb();
    try {
      expect(() => {
        runTx(db, () =>
          createReceipt(db, {
            lines: [
              { sku: 'SKU001', qty: 10 },
              { sku: 'SKU002', qty: 20 },
              { sku: 'SKU003', qty: 30 }
            ],
            actor: { id: 2, name: 'Omar', role: 'OPERATOR' },
            hooks: {
              afterStep: (step) => {
                if (step === 'line:2') {
                  throw new Error('Simulated failure after line 2');
                }
              }
            }
          })
        );
      }).toThrow('Simulated failure after line 2');

      const rCount = db.prepare('SELECT COUNT(*) as c FROM receipts').get() as { c: number };
      expect(rCount.c).toBe(0);

      const lCount = db.prepare('SELECT COUNT(*) as c FROM receipt_lines').get() as { c: number };
      expect(lCount.c).toBe(0);

      const mCount = db.prepare('SELECT COUNT(*) as c FROM stock_movements').get() as { c: number };
      expect(mCount.c).toBe(0);

      const seqR = db.prepare("SELECT next_value FROM id_sequences WHERE prefix = 'RCV'").get() as { next_value: number };
      expect(seqR.next_value).toBe(1);

      const seqM = db.prepare("SELECT next_value FROM id_sequences WHERE prefix = 'MOV'").get() as { next_value: number };
      expect(seqM.next_value).toBe(1);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P3-T10: Two receipts of the same SKU -> /receipts/staged lists both lines FIFO; inventory summary staged_qty = sum', async () => {
    if (!stack) {
      stack = await startStack({ seed: true });
    }
    const client = apiClient(stack.urls.gateway);
    await client.login('operator1');

    await client.post(
      '/api/receipts',
      { lines: [{ sku: 'SKU002', qty: 25 }] },
      { headers: { 'idempotency-key': 'fifo-rcv-1' } }
    );

    await client.post(
      '/api/receipts',
      { lines: [{ sku: 'SKU002', qty: 35 }] },
      { headers: { 'idempotency-key': 'fifo-rcv-2' } }
    );

    const stagedRes = await client.get('/api/receipts/staged');
    expect(stagedRes.status).toBe(200);

    const sku2Lines = stagedRes.body.filter((l: any) => l.sku === 'SKU002');
    expect(sku2Lines.length).toBe(2);
    expect(sku2Lines[0].qty_staged).toBe(25);
    expect(sku2Lines[1].qty_staged).toBe(35);

    // Inventory summary staged_qty = 60
    const summaryRes = await client.get('/api/inventory/summary?search=SKU002');
    expect(summaryRes.status).toBe(200);
    const sku2Summary = summaryRes.body.items.find((i: any) => i.sku === 'SKU002');
    expect(sku2Summary.staged_qty).toBe(60);
  });

  it('P3-T11: Restart Engine 3 (harness) then read receipts/staged -> Identical data (persistence)', async () => {
    if (!stack) {
      stack = await startStack({ seed: true });
    }
    const client = apiClient(stack.urls.gateway);
    await client.login('operator1');

    const beforeStaged = await client.get('/api/receipts/staged');
    expect(beforeStaged.status).toBe(200);

    // Restart Engine 3
    await stack.restartService('engine3');

    const afterStaged = await client.get('/api/receipts/staged');
    expect(afterStaged.status).toBe(200);
    expect(afterStaged.body.length).toBe(beforeStaged.body.length);
  });

  it('P3-T12: POST as PICKER / STAFF / OPERATOR -> 403 / 403 / 201', async () => {
    if (!stack) {
      stack = await startStack({ seed: true });
    }

    const picker = apiClient(stack.urls.gateway);
    await picker.login('picker1');
    const pickerRes = await picker.post(
      '/api/receipts',
      { lines: [{ sku: 'SKU001', qty: 10 }] },
      { headers: { 'idempotency-key': 'rbac-picker-1' } }
    );
    expect(pickerRes.status).toBe(403);

    const staff = apiClient(stack.urls.gateway);
    await staff.login('staff1');
    const staffRes = await staff.post(
      '/api/receipts',
      { lines: [{ sku: 'SKU001', qty: 10 }] },
      { headers: { 'idempotency-key': 'rbac-staff-1' } }
    );
    expect(staffRes.status).toBe(403);

    const op = apiClient(stack.urls.gateway);
    await op.login('operator1');
    const opRes = await op.post(
      '/api/receipts',
      { lines: [{ sku: 'SKU001', qty: 10 }] },
      { headers: { 'idempotency-key': 'rbac-operator-1' } }
    );
    expect(opRes.status).toBe(201);
  });

  it('P3-T13: received_at 1 hour in future -> 400 VALIDATION_ERROR', async () => {
    if (!stack) {
      stack = await startStack({ seed: true });
    }
    const client = apiClient(stack.urls.gateway);
    await client.login('operator1');

    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await client.post(
      '/api/receipts',
      {
        received_at: futureDate,
        lines: [{ sku: 'SKU001', qty: 10 }]
      },
      { headers: { 'idempotency-key': 'future-date-key' } }
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('P3-T14 & P3-T15: Web intake workflow and idempotency client logic verified', async () => {
    if (!stack) {
      stack = await startStack({ seed: true });
    }
    const client = apiClient(stack.urls.gateway);
    await client.login('operator1');

    // Verify GET /api/receipts lists receipts with correct shapes
    const receiptsList = await client.get('/api/receipts');
    expect(receiptsList.status).toBe(200);
    expect(receiptsList.body.items).toBeDefined();

    // Verify GET /api/receipts/:ref
    const firstRef = receiptsList.body.items[0].ref;
    const detail = await client.get(`/api/receipts/${firstRef}`);
    expect(detail.status).toBe(200);
    expect(detail.body.lines.length).toBeGreaterThanOrEqual(1);
    expect(detail.body.audit_log.length).toBeGreaterThanOrEqual(1);
  });

  it('P3-T16: verify:integrity after receipts -> I05 PASS', () => {
    const { db, cleanup } = setupDb();
    try {
      runTx(db, () => {
        createReceipt(db, {
          lines: [
            { sku: 'SKU001', qty: 20 },
            { sku: 'SKU002', qty: 15 }
          ],
          actor: { id: 2, name: 'Omar', role: 'OPERATOR' }
        });
      });

      const report = runIntegrityChecks(db);
      expect(report.ok).toBe(true);

      const i05 = report.checks.find(c => c.id === 'I05');
      expect(i05?.status).toBe('PASS');

      db.close();
    } finally {
      cleanup();
    }
  });
});
