import { describe, it, expect } from 'vitest';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import {
  appendAudit,
  appendOrderEvent,
  verifyAuditChain,
  ensureAuditChain
} from '../../services/engine3-inventory/src/audit/appendAudit.js';

describe('Audit Chain & Order Events (P3-T7)', () => {
  it('appends 50 sequential rows and verifies integrity as intact', () => {
    const db = makeTestDb();
    seedMinimal(db);

    // 1. Append 50 rows
    for (let i = 1; i <= 50; i++) {
      const res = appendAudit(db, {
        actor: { id: 1, role: 'MANAGER', username: 'manager1' },
        action: `TEST_ACTION_${i}`,
        entityType: 'ORDER',
        entityRef: `ORD-${String(i).padStart(3, '0')}`,
        before: { step: i - 1 },
        after: { step: i },
        note: `Audit note ${i}`
      });
      expect(res.seq).toBe(i);
      expect(res.row_hash).toBeDefined();
    }

    // 2. Verify audit chain
    const verify = verifyAuditChain(db);
    expect(verify.ok).toBe(true);
    expect(verify.checked).toBe(50);
    expect(verify.brokenAtSeq).toBeNull();
    expect(verify.head?.last_seq).toBe(50);
  });

  it('immutability trigger prevents direct UPDATE on audit_log rows with row_hash', () => {
    const db = makeTestDb();
    seedMinimal(db);

    for (let i = 1; i <= 15; i++) {
      appendAudit(db, {
        actor: { id: 1, role: 'MANAGER' },
        action: `ACTION_${i}`,
        entityType: 'ORDER',
        entityRef: `ORD-${i}`
      });
    }

    // Raw update must throw AUDIT_IMMUTABLE
    expect(() => {
      db.prepare("UPDATE audit_log SET action = 'HACKED' WHERE seq = 10").run();
    }).toThrow(/AUDIT_IMMUTABLE/);
  });

  it('immutability trigger prevents direct DELETE on audit_log', () => {
    const db = makeTestDb();
    seedMinimal(db);

    appendAudit(db, {
      actor: { id: 1, role: 'MANAGER' },
      action: 'ACTION_1',
      entityType: 'ORDER',
      entityRef: 'ORD-1'
    });

    expect(() => {
      db.prepare('DELETE FROM audit_log WHERE seq = 1').run();
    }).toThrow(/AUDIT_IMMUTABLE/);
  });

  it('detects tampering when trigger is dropped and row is modified', () => {
    const db = makeTestDb();
    seedMinimal(db);

    for (let i = 1; i <= 20; i++) {
      appendAudit(db, {
        actor: { id: 1, role: 'MANAGER' },
        action: `ACTION_${i}`,
        entityType: 'ORDER',
        entityRef: `ORD-${i}`,
        note: `Original note ${i}`
      });
    }

    // Verify intact before tamper
    const initialVerify = verifyAuditChain(db);
    expect(initialVerify.ok).toBe(true);
    expect(initialVerify.checked).toBe(20);

    // Drop trigger to simulate unauthorized db-level tamper
    db.prepare('DROP TRIGGER trg_audit_no_update').run();

    // Tamper with seq 10
    db.prepare("UPDATE audit_log SET action = 'TAMPERED_ACTION' WHERE seq = 10").run();

    // Verify detects break at seq 10
    const tamperedVerify = verifyAuditChain(db);
    expect(tamperedVerify.ok).toBe(false);
    expect(tamperedVerify.brokenAtSeq).toBe(10);
  });

  it('ensureAuditChain backfills unhashed legacy rows and chains them sequentially', () => {
    const db = makeTestDb();
    seedMinimal(db);

    // Temporarily drop trigger to insert raw unhashed legacy rows
    db.prepare('DROP TRIGGER IF EXISTS trg_audit_no_update').run();
    db.prepare('DROP TRIGGER IF EXISTS trg_audit_no_delete').run();

    // Insert 5 legacy rows without seq or hash
    for (let i = 1; i <= 5; i++) {
      db.prepare(`
        INSERT INTO audit_log (occurred_at, actor_user_id, actor_role, action, entity_type, entity_id, details_json)
        VALUES ('2026-11-01T10:00:00.000Z', 1, 'MANAGER', 'LEGACY_ACTION', 'ORDER', 'ORD-LEGACY', '{}')
      `).run();
    }

    // Run ensureAuditChain
    ensureAuditChain(db);

    // Recreate trigger
    db.prepare(`
      CREATE TRIGGER trg_audit_no_update
      BEFORE UPDATE ON audit_log
      WHEN OLD.row_hash IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
      END;
    `).run();

    // Verify chain is now completely valid
    const verify = verifyAuditChain(db);
    expect(verify.ok).toBe(true);
    expect(verify.checked).toBe(5);
    expect(verify.head?.last_seq).toBe(5);
  });

  it('records and reads order_events with immutability', () => {
    const db = makeTestDb();

    appendOrderEvent(db, {
      orderRef: 'ORD-999',
      event: 'order.created',
      actor: { id: 1, role: 'MANAGER' },
      payload: { total_lines: 3 }
    });

    appendOrderEvent(db, {
      orderRef: 'ORD-999',
      event: 'order.assigned',
      actor: { id: 1, role: 'MANAGER' },
      payload: { picker_id: 3 }
    });

    const events = db.prepare('SELECT * FROM order_events WHERE order_ref = ? ORDER BY id ASC').all('ORD-999') as any[];
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('order.created');
    expect(events[1].event).toBe('order.assigned');

    // Immutability on order_events
    expect(() => {
      db.prepare("UPDATE order_events SET event = 'HACKED' WHERE id = 1").run();
    }).toThrow(/AUDIT_IMMUTABLE/);

    expect(() => {
      db.prepare('DELETE FROM order_events WHERE id = 1').run();
    }).toThrow(/AUDIT_IMMUTABLE/);
  });
});
