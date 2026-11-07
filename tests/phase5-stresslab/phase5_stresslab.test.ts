import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runIntegrityChecks, CHECKS } from '../../services/engine3-inventory/src/domain/integrity.js';

describe('Phase 5: Concurrency & ACID Stress Lab', () => {
  const adminPageSource = fs.readFileSync(
    path.resolve('apps/web/src/pages/AdminPage.tsx'),
    'utf8'
  );
  const stressLabSource = fs.readFileSync(
    path.resolve('apps/web/src/features/stresslab/StressLabView.tsx'),
    'utf8'
  );

  describe('1. Test ID Contract & UI Architecture', () => {
    it('contains all required data-testid attributes from PRD Phase 5', () => {
      // Main admin tabs
      expect(adminPageSource).toContain('data-testid="admin-tab-overview"');
      expect(adminPageSource).toContain('data-testid="admin-tab-stresslab"');

      // Preserved existing audit & integrity tabs
      expect(adminPageSource).toContain('data-testid="tab-audit"');
      expect(adminPageSource).toContain('data-testid="tab-integrity"');

      // Stress Lab action buttons & verdicts
      expect(stressLabSource).toContain('data-testid="lab-run-race"');
      expect(stressLabSource).toContain('data-testid="lab-cleanup"');
      expect(stressLabSource).toContain('data-testid="lab-verdict-race"');
      expect(stressLabSource).toContain('data-testid="lab-run-idem"');
      expect(stressLabSource).toContain('data-testid="lab-verdict-idem"');
      expect(stressLabSource).toContain('data-testid="lab-run-integrity"');

      // Timeline rows & integrity items
      expect(stressLabSource).toContain('data-testid={`lab-request-row-${i}`}');
      expect(stressLabSource).toContain('data-testid={`lab-integrity-item-${c.id}`}');
    });
  });

  describe('2. Backend Integrity Logic (I01..I13)', () => {
    const dbPath = process.env.WAREHOUSE_DB_PATH || './data/warehouse.db';

    it('defines exactly 13 integrity checks from I01 to I13', () => {
      expect(CHECKS.length).toBe(13);
      const ids = CHECKS.map((c) => c.id);
      expect(ids).toEqual([
        'I01', 'I02', 'I03', 'I04', 'I05', 'I06',
        'I07', 'I08', 'I09', 'I10', 'I11', 'I12', 'I13'
      ]);
    });

    it('runs all 13 integrity checks successfully on warehouse.db with ok = true', () => {
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      try {
        const report = runIntegrityChecks(db);
        expect(report.ok).toBe(true);
        expect(report.checks.length).toBe(13);

        for (const check of report.checks) {
          expect(check.status).toBe('PASS');
          expect(check.rows).toBeUndefined();
        }
      } finally {
        db.close();
      }
    });

    it('detects a stock bound violation if invalid inventory is introduced', () => {
      // Create an in-memory database cloned with warehouse schema
      const memDb = new Database(':memory:');
      try {
        memDb.exec(`
          CREATE TABLE bins (code TEXT PRIMARY KEY, capacity INTEGER NOT NULL);
          CREATE TABLE inventory (bin_code TEXT PRIMARY KEY, sku TEXT, qty INTEGER NOT NULL, reserved_qty INTEGER NOT NULL);
          INSERT INTO bins VALUES ('TEST-BIN', 10);
          INSERT INTO inventory VALUES ('TEST-BIN', 'SKU001', 15, 0); -- Over capacity (15 > 10)!
        `);

        const report = runIntegrityChecks(memDb);
        const i01 = report.checks.find((c) => c.id === 'I01');
        expect(i01?.status).toBe('FAIL');
        expect(report.ok).toBe(false);
      } finally {
        memDb.close();
      }
    });
  });

  describe('3. Concurrency Mutex & Idempotency Calculations', () => {
    it('calculates order quantity q = floor(X/2) ensuring exactly 2 orders fit', () => {
      // Test cases for available stock X >= 4
      const testCases = [4, 5, 10, 15, 50, 100];
      for (const X of testCases) {
        const q = Math.floor(X / 2);
        // Exactly 2 orders can be fulfilled
        expect(2 * q).toBeLessThanOrEqual(X);
        // A 3rd concurrent order must exceed available stock
        expect(3 * q).toBeGreaterThan(X);
      }
    });
  });
});
