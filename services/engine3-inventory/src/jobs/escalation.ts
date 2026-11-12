import Database from 'better-sqlite3';
import { audit } from '../domain/audit.js';
import { emit } from '../domain/outbox.js';

export function sweepEscalations(db: Database.Database): { escalatedCount: number } {
  const startedAt = new Date().toISOString();
  let escalatedCount = 0;

  try {
    db.transaction(() => {
      const escalateMin = 30; // default 30 mins
      const cutoffTime = new Date(Date.now() - escalateMin * 60000).toISOString();

      const overdueExceptions = db
        .prepare(
          `
        SELECT id, ref, bin_code, sku, kind, raised_by, raised_at
        FROM pick_exceptions
        WHERE status <> 'RESOLVED'
          AND escalated = 0
          AND raised_at < ?
      `
        )
        .all(cutoffTime) as Array<{
        id: number;
        ref: string;
        bin_code: string;
        sku: string;
        kind: string;
        raised_by: string;
        raised_at: string;
      }>;

      for (const exc of overdueExceptions) {
        db.prepare('UPDATE pick_exceptions SET escalated = 1 WHERE id = ?').run(exc.id);
        escalatedCount++;

        audit(db, {
          actor: { id: 0, role: 'SYSTEM' },
          action: 'EXCEPTION_ESCALATED',
          entity_type: 'EXCEPTION',
          entity_id: exc.ref,
          details: { bin_code: exc.bin_code, kind: exc.kind, raised_by: exc.raised_by },
        });

        emit(db, {
          event_type: 'exception.escalated',
          entity_type: 'EXCEPTION',
          entity_id: exc.ref,
          data: { ref: exc.ref, bin_code: exc.bin_code, kind: exc.kind },
        });
      }

      if (escalatedCount > 0) {
        try {
          db.prepare(
            `
            INSERT INTO job_runs (job, started_at, finished_at, status, detail)
            VALUES ('escalation_sweep', ?, ?, 'OK', ?)
          `
          ).run(startedAt, new Date().toISOString(), JSON.stringify({ escalatedCount }));
        } catch (e) {
          // ignore
        }
      }
    })();
  } catch (err: any) {
    try {
      db.prepare(
        `
        INSERT INTO job_runs (job, started_at, finished_at, status, detail)
        VALUES ('escalation_sweep', ?, ?, 'ERROR', ?)
      `
      ).run(startedAt, new Date().toISOString(), JSON.stringify({ error: err.message }));
    } catch (e) {
      // ignore
    }
  }

  return { escalatedCount };
}
