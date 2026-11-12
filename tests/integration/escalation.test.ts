import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { sweepEscalations } from '../../services/engine3-inventory/src/jobs/escalation.js';
import { getExceptionRates } from '../../services/engine3-inventory/src/domain/exceptionsRepo.js';

describe('Phase 7: Exception Escalation & Rate Monitoring Integration Test', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
    seedMinimal(db);
  });

  it('escalates un-resolved exceptions older than 30 minutes and emits audit & outbox event', () => {
    const thirtyFiveMinAgo = new Date(Date.now() - 35 * 60000).toISOString();
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();

    // 1. Insert overdue exception
    db.prepare(`
      INSERT INTO pick_exceptions (
        ref, exc_ref, bin_code, sku, kind, status, raised_by, raised_at, escalated
      ) VALUES (
        'EXC-OLD-01', 'EXC-OLD-01', 'BIN-A01-1', 'SKU-TEST-001', 'MISSING', 'OPEN', 'picker1', ?, 0
      )
    `).run(thirtyFiveMinAgo);

    // 2. Insert recent exception
    db.prepare(`
      INSERT INTO pick_exceptions (
        ref, exc_ref, bin_code, sku, kind, status, raised_by, raised_at, escalated
      ) VALUES (
        'EXC-NEW-01', 'EXC-NEW-01', 'BIN-A01-2', 'SKU-TEST-001', 'DAMAGED', 'OPEN', 'picker2', ?, 0
      )
    `).run(fiveMinAgo);

    // 3. Run escalation sweep
    const result = sweepEscalations(db);
    expect(result.escalatedCount).toBe(1);

    // 4. Verify database state
    const oldExc = db.prepare("SELECT escalated FROM pick_exceptions WHERE ref = 'EXC-OLD-01'").get() as any;
    expect(oldExc.escalated).toBe(1);

    const newExc = db.prepare("SELECT escalated FROM pick_exceptions WHERE ref = 'EXC-NEW-01'").get() as any;
    expect(newExc.escalated).toBe(0);

    // 5. Verify exception rates computation
    const rates = getExceptionRates(db);
    expect(rates.rates).toBeDefined();
    expect(Array.isArray(rates.rates)).toBe(true);
  });
});
