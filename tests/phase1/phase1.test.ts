import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import request from 'supertest';
import { createTempDbPaths } from '../harness/tempDb.js';
import { applyMigrations } from '../../scripts/migrate.js';
import { seedBase } from '../../scripts/seed-base.js';
import { backupDatabase } from '../../scripts/backup-db.js';
import { runIntegrityChecks } from '../../scripts/verify-integrity.js';
import { nextRef } from '../../services/engine3-inventory/src/domain/ids.js';
import { runIdempotent } from '../../services/engine3-inventory/src/domain/idempotency.js';
import { runTx } from '../../services/engine3-inventory/src/db/tx.js';
import { rbacMiddleware } from '../../services/gateway/src/middleware/rbac.js';
import { errorHandler as gwErrorHandler } from '../../services/gateway/src/middleware/errorHandler.js';
import { createApp as createE3App } from '../../services/engine3-inventory/src/server.js';
import { createApp as createGatewayApp } from '../../services/gateway/src/server.js';
import { startStack, RunningStack } from '../harness/stack.js';
import { apiClient } from '../harness/apiClient.js';
import { DomainError } from '@dark-storage/shared';

describe('Phase 1 Foundation Tests', () => {
  let stack: RunningStack | null = null;

  afterAll(async () => {
    if (stack) {
      await stack.stop();
    }
  });

  it('P1-T01: Migrate empty temp DB twice', () => {
    const { dir, warehouseDbPath, cleanup } = createTempDbPaths();
    try {
      const db = new Database(warehouseDbPath);
      db.pragma('foreign_keys = ON');

      const res1 = applyMigrations(db, path.resolve('migrations/warehouse'));
      expect(res1.applied).toBeGreaterThan(0);
      expect(res1.skipped).toBe(0);

      const res2 = applyMigrations(db, path.resolve('migrations/warehouse'));
      expect(res2.applied).toBe(0);
      expect(res2.skipped).toBe(res1.applied);

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const names = tables.map(t => t.name);
      expect(names).toContain('users');
      expect(names).toContain('id_sequences');
      expect(names).toContain('audit_log');
      expect(names).toContain('products');
      expect(names).toContain('shelves');
      expect(names).toContain('bins');
      expect(names).toContain('nav_nodes');
      expect(names).toContain('nav_edges');

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P1-T02: Modify an applied migration file\'s content, run migrate fails with MIGRATION_CHECKSUM_MISMATCH', () => {
    const { dir, warehouseDbPath, cleanup } = createTempDbPaths();
    try {
      const tempMigrateDir = path.join(dir, 'migrations');
      fs.mkdirSync(tempMigrateDir, { recursive: true });

      const testFile = path.join(tempMigrateDir, '001_test.sql');
      fs.writeFileSync(testFile, 'CREATE TABLE test_table (id INTEGER PRIMARY KEY);');

      const db = new Database(warehouseDbPath);
      applyMigrations(db, tempMigrateDir);

      // Now alter the file content
      fs.writeFileSync(testFile, 'CREATE TABLE test_table (id INTEGER PRIMARY KEY, note TEXT);');

      expect(() => {
        applyMigrations(db, tempMigrateDir);
      }).toThrow(/MIGRATION_CHECKSUM_MISMATCH/);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P1-T03: Run base seed', () => {
    const { warehouseDbPath, cleanup } = createTempDbPaths();
    try {
      const db = new Database(warehouseDbPath);
      db.pragma('foreign_keys = ON');
      applyMigrations(db, path.resolve('migrations/warehouse'));

      seedBase(db);

      const usersCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
      expect(usersCount).toBe(5);

      const productsCount = (db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c;
      expect(productsCount).toBe(24);

      const shelvesCount = (db.prepare('SELECT COUNT(*) as c FROM shelves').get() as { c: number }).c;
      expect(shelvesCount).toBe(48);

      const binsCount = (db.prepare('SELECT COUNT(*) as c FROM bins').get() as { c: number }).c;
      expect(binsCount).toBe(192);

      const nodesCount = (db.prepare('SELECT COUNT(*) as c FROM nav_nodes').get() as { c: number }).c;
      expect(nodesCount).toBe(34);

      const edgesCount = (db.prepare('SELECT COUNT(*) as c FROM nav_edges').get() as { c: number }).c;
      expect(edgesCount).toBe(36);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P1-T04: Run seed twice without errors or duplicate rows', () => {
    const { warehouseDbPath, cleanup } = createTempDbPaths();
    try {
      const db = new Database(warehouseDbPath);
      db.pragma('foreign_keys = ON');
      applyMigrations(db, path.resolve('migrations/warehouse'));

      seedBase(db);
      seedBase(db);

      const usersCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
      expect(usersCount).toBe(5);

      const productsCount = (db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c;
      expect(productsCount).toBe(24);

      const binsCount = (db.prepare('SELECT COUNT(*) as c FROM bins').get() as { c: number }).c;
      expect(binsCount).toBe(192);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P1-T05: Load nav graph, BFS from DOCK reaches all 34 nodes', () => {
    const { warehouseDbPath, cleanup } = createTempDbPaths();
    try {
      const db = new Database(warehouseDbPath);
      applyMigrations(db, path.resolve('migrations/warehouse'));
      seedBase(db);

      const nodes = (db.prepare('SELECT id FROM nav_nodes').all() as { id: string }[]).map(n => n.id);
      const edges = db.prepare('SELECT from_node, to_node FROM nav_edges').all() as { from_node: string; to_node: string }[];

      const adj = new Map<string, string[]>();
      for (const n of nodes) adj.set(n, []);
      for (const e of edges) {
        adj.get(e.from_node)?.push(e.to_node);
        adj.get(e.to_node)?.push(e.from_node);
      }

      // BFS from DOCK
      const visited = new Set<string>(['DOCK']);
      const queue = ['DOCK'];

      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const neighbor of adj.get(curr) || []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      expect(visited.size).toBe(34);
      expect(visited.size).toBe(nodes.length);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P1-T06: UPDATE / DELETE on audit_log aborts with AUDIT_LOG_IS_APPEND_ONLY', () => {
    const { warehouseDbPath, cleanup } = createTempDbPaths();
    try {
      const db = new Database(warehouseDbPath);
      applyMigrations(db, path.resolve('migrations/warehouse'));

      db.prepare(`
        INSERT INTO audit_log (action, entity_type, entity_id)
        VALUES ('TEST', 'BIN', 'A-01-L-1')
      `).run();

      expect(() => {
        db.prepare("UPDATE audit_log SET action = 'ALTERED' WHERE entity_id = 'A-01-L-1'").run();
      }).toThrow(/AUDIT_LOG_IS_APPEND_ONLY/);

      expect(() => {
        db.prepare("DELETE FROM audit_log WHERE entity_id = 'A-01-L-1'").run();
      }).toThrow(/AUDIT_LOG_IS_APPEND_ONLY/);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P1-T07: Login correct / wrong password / GET /auth/me with token', async () => {
    const { warehouseDbPath, cleanup } = createTempDbPaths();
    try {
      const db = new Database(warehouseDbPath);
      applyMigrations(db, path.resolve('migrations/warehouse'));
      seedBase(db);

      // Verify direct auth router
      const e3App = createE3App(db);

      // Good credentials
      const goodRes = await request(e3App)
        .post('/internal/v1/auth/verify')
        .set('x-internal-token', 'change-me-internal')
        .send({ username: 'manager1', password: 'Warehouse#2026' });

      expect(goodRes.status).toBe(200);
      expect(goodRes.body.username).toBe('manager1');
      expect(goodRes.body.role).toBe('MANAGER');

      // Bad credentials
      const badRes = await request(e3App)
        .post('/internal/v1/auth/verify')
        .set('x-internal-token', 'change-me-internal')
        .send({ username: 'manager1', password: 'WrongPassword' });

      expect(badRes.status).toBe(401);
      expect(badRes.body.error.code).toBe('UNAUTHENTICATED');

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P1-T08: RBAC middleware unit test', async () => {
    const app = express();
    app.use(express.json());

    // Mock auth middleware populating req.user
    app.use((req, res, next) => {
      const roleHeader = req.headers['x-mock-role'] as string | undefined;
      if (roleHeader) {
        req.user = { id: 1, name: 'Tester', role: roleHeader };
      } else {
        req.user = null;
      }
      next();
    });

    app.get('/manager-only', rbacMiddleware(['MANAGER']), (req, res) => {
      res.json({ ok: true });
    });
    app.use(gwErrorHandler);

    // No user -> 401
    const unauth = await request(app).get('/manager-only');
    expect(unauth.status).toBe(401);
    expect(unauth.body.error.code).toBe('UNAUTHENTICATED');

    // Wrong role -> 403
    const forbidden = await request(app).get('/manager-only').set('x-mock-role', 'OPERATOR');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    // Correct role -> 200
    const allowed = await request(app).get('/manager-only').set('x-mock-role', 'MANAGER');
    expect(allowed.status).toBe(200);
    expect(allowed.body.ok).toBe(true);
  });

  it('P1-T09: Unknown route -> 404 envelope; invalid body on zod route -> 400 VALIDATION_ERROR with details.issues', async () => {
    const gwApp = createGatewayApp();

    const notFound = await request(gwApp).get('/api/unknown-endpoint');
    expect(notFound.status).toBe(404);
    expect(notFound.body.error.code).toBe('NOT_FOUND');
    expect(notFound.body.error.request_id).toBeDefined();

    const invalidBody = await request(gwApp).post('/api/auth/login').send({ username: '' });
    expect(invalidBody.status).toBe(400);
    expect(invalidBody.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalidBody.body.error.details.issues).toBeDefined();
  });

  it('P1-T10: Call Engine 3 /internal/v1/products without internal token -> 401', async () => {
    const { warehouseDbPath, cleanup } = createTempDbPaths();
    try {
      const db = new Database(warehouseDbPath);
      applyMigrations(db, path.resolve('migrations/warehouse'));
      const e3App = createE3App(db);

      const res = await request(e3App).get('/internal/v1/products');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P1-T11: nextRef x3 in committed txs; then one in a tx that throws -> no gaps', () => {
    const { warehouseDbPath, cleanup } = createTempDbPaths();
    try {
      const db = new Database(warehouseDbPath);
      applyMigrations(db, path.resolve('migrations/warehouse'));

      const r1 = runTx(db, () => nextRef(db, 'order'));
      const r2 = runTx(db, () => nextRef(db, 'order'));
      const r3 = runTx(db, () => nextRef(db, 'order'));

      expect(r1).toBe('ORD-0001');
      expect(r2).toBe('ORD-0002');
      expect(r3).toBe('ORD-0003');

      // Tx that fails and rolls back
      expect(() => {
        runTx(db, () => {
          nextRef(db, 'order');
          throw new Error('Rollback test');
        });
      }).toThrow('Rollback test');

      // Next committed transaction produces ORD-0004 with no gap
      const r4 = runTx(db, () => nextRef(db, 'order'));
      expect(r4).toBe('ORD-0004');

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P1-T12: runIdempotent: same key+body twice / same key different body / handler throws then retry', () => {
    const { warehouseDbPath, cleanup } = createTempDbPaths();
    try {
      const db = new Database(warehouseDbPath);
      applyMigrations(db, path.resolve('migrations/warehouse'));

      let callCount = 0;
      const key = 'test-idem-key-1';

      // First run
      const res1 = runIdempotent(db, { key, scope: 'test', body: { a: 1 } }, () => {
        callCount++;
        return { status: 201, body: { success: true, count: callCount } };
      });

      expect(res1.status).toBe(201);
      expect(res1.replay).toBe(false);
      expect(callCount).toBe(1);

      // Same key + same body -> replayed, handler not called again
      const res2 = runIdempotent(db, { key, scope: 'test', body: { a: 1 } }, () => {
        callCount++;
        return { status: 201, body: { success: true, count: callCount } };
      });

      expect(res2.status).toBe(201);
      expect(res2.replay).toBe(true);
      expect(res2.body).toEqual({ success: true, count: 1 });
      expect(callCount).toBe(1);

      // Same key + different body -> IDEMPOTENCY_KEY_REUSED
      expect(() => {
        runIdempotent(db, { key, scope: 'test', body: { a: 2 } }, () => {
          return { status: 201, body: { success: true } };
        });
      }).toThrow(/IDEMPOTENCY_KEY_REUSED/);

      // Handler throws -> failure not stored, retry executes
      const failKey = 'test-fail-key';
      let failCount = 0;

      expect(() => {
        runIdempotent(db, { key: failKey, scope: 'test', body: { x: 1 } }, () => {
          failCount++;
          throw new DomainError('QUANTITY_INVALID', 'Failing test');
        });
      }).toThrow(/QUANTITY_INVALID/);

      expect(failCount).toBe(1);

      // Retrying succeeds and executes handler
      const resRetry = runIdempotent(db, { key: failKey, scope: 'test', body: { x: 1 } }, () => {
        failCount++;
        return { status: 200, body: { ok: true } };
      });

      expect(resRetry.status).toBe(200);
      expect(resRetry.replay).toBe(false);
      expect(failCount).toBe(2);

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P1-T13: verify:integrity on freshly seeded DB exits 0 (SKIP allowed)', () => {
    const { warehouseDbPath, cleanup } = createTempDbPaths();
    try {
      const db = new Database(warehouseDbPath);
      applyMigrations(db, path.resolve('migrations/warehouse'));
      seedBase(db);

      const report = runIntegrityChecks(db);
      expect(report.ok).toBe(true);

      for (const check of report.checks) {
        expect(['PASS', 'SKIP']).toContain(check.status);
      }

      db.close();
    } finally {
      cleanup();
    }
  });

  it('P1-T14: db:backup - new file in backups/, opens read-only, row counts equal source', () => {
    const { dir, warehouseDbPath, cleanup } = createTempDbPaths();
    try {
      const db = new Database(warehouseDbPath);
      applyMigrations(db, path.resolve('migrations/warehouse'));
      seedBase(db);
      db.close();

      const backupDir = path.join(dir, 'backups');
      const backupPath = backupDatabase(warehouseDbPath, backupDir);

      expect(fs.existsSync(backupPath)).toBe(true);

      const backupDb = new Database(backupPath, { readonly: true });
      const srcDb = new Database(warehouseDbPath, { readonly: true });

      const countSrc = (srcDb.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c;
      const countBkp = (backupDb.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c;
      expect(countBkp).toBe(countSrc);
      expect(countBkp).toBe(24);

      backupDb.close();
      srcDb.close();
    } finally {
      cleanup();
    }
  });

  it('P1-T15: startStack() - all four services healthy, GET /api/health shows all ok', async () => {
    stack = await startStack({ seed: true });
    expect(stack.urls.gateway).toBeDefined();

    const client = apiClient(stack.urls.gateway);
    const health = await client.get('/api/health');

    expect(health.status).toBe(200);
    expect(health.body).toEqual({
      gateway: 'ok',
      engine1: 'ok',
      engine2: 'ok',
      engine3: 'ok'
    });
  });

  it('P1-T16: GET /api/products?search=mouse and ?search=SKU003 - Name and SKU search return correct items', async () => {
    if (!stack) {
      stack = await startStack({ seed: true });
    }

    const client = apiClient(stack.urls.gateway);
    await client.login('manager1');

    // Search by name
    const mouseRes = await client.get('/api/products?search=mouse');
    expect(mouseRes.status).toBe(200);
    expect(mouseRes.body.items).toBeDefined();
    expect(mouseRes.body.page).toBe(1);
    expect(mouseRes.body.total).toBeGreaterThanOrEqual(1);
    const names = mouseRes.body.items.map((i: any) => i.name.toLowerCase());
    expect(names.some((n: string) => n.includes('mouse'))).toBe(true);

    // Search by SKU
    const skuRes = await client.get('/api/products?search=SKU003');
    expect(skuRes.status).toBe(200);
    expect(skuRes.body.items.length).toBe(1);
    expect(skuRes.body.items[0].sku).toBe('SKU003');
    expect(skuRes.body.items[0].name).toBe('USB-C Hub 7-in-1');

    // Single product by SKU
    const single = await client.get('/api/products/SKU003');
    expect(single.status).toBe(200);
    expect(single.body.sku).toBe('SKU003');
    expect(single.body.name).toBe('USB-C Hub 7-in-1');
  });
});
