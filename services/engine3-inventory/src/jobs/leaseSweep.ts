import Database from 'better-sqlite3';
import { audit } from '../domain/audit.js';
import { emit } from '../domain/outbox.js';
import { appendOrderEvent } from '../audit/appendAudit.js';

export function sweepExpiredLeases(db: Database.Database): { sweptMissions: number; sweptTasks: number } {
  const startedAt = new Date().toISOString();
  let sweptMissions = 0;
  let sweptTasks = 0;

  try {
    db.transaction(() => {
      const nowIso = new Date().toISOString();

      // 1. Expired missions
      const expiredMissions = db
        .prepare(
          `
        SELECT m.id, m.ref, m.version, m.assigned_to, m.order_id, o.ref as order_ref
        FROM missions m
        LEFT JOIN orders o ON m.order_id = o.id
        WHERE m.status IN ('CLAIMED', 'IN_PROGRESS')
          AND m.lease_expires_at IS NOT NULL
          AND m.lease_expires_at < ?
      `
        )
        .all(nowIso) as Array<{
        id: number;
        ref: string;
        version: number;
        assigned_to: string;
        order_id: number;
        order_ref: string | null;
      }>;

      for (const m of expiredMissions) {
        const res = db
          .prepare(
            `
          UPDATE missions
          SET status = 'QUEUED', assigned_to = NULL, lease_expires_at = NULL, version = version + 1
          WHERE id = ? AND version = ?
        `
          )
          .run(m.id, m.version);

        if (res.changes === 1) {
          sweptMissions++;

          if (m.order_ref) {
            appendOrderEvent(db, {
              orderRef: m.order_ref,
              event: 'mission.lease_expired',
              actor: { id: 0, role: 'SYSTEM' },
              payload: { mission_ref: m.ref, previous_picker: m.assigned_to },
            });
          }

          audit(db, {
            actor: { id: 0, role: 'SYSTEM' },
            action: 'MISSION_LEASE_EXPIRED',
            entity_type: 'MISSION',
            entity_id: m.ref,
            details: { previous_picker: m.assigned_to },
          });

          emit(db, {
            event_type: 'mission.lease_expired',
            entity_type: 'MISSION',
            entity_id: m.ref,
            data: { ref: m.ref, previous_picker: m.assigned_to },
          });
        }
      }

      // 2. Expired floor tasks
      const expiredTasks = db
        .prepare(
          `
        SELECT id, task_ref, version, assigned_to
        FROM floor_tasks
        WHERE status IN ('CLAIMED', 'IN_PROGRESS')
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < ?
      `
        )
        .all(nowIso) as Array<{
        id: number;
        task_ref: string;
        version: number;
        assigned_to: string;
      }>;

      for (const t of expiredTasks) {
        const res = db
          .prepare(
            `
          UPDATE floor_tasks
          SET status = 'OPEN', assigned_to = NULL, lease_expires_at = NULL, version = version + 1
          WHERE id = ? AND version = ?
        `
          )
          .run(t.id, t.version);

        if (res.changes === 1) {
          sweptTasks++;
          audit(db, {
            actor: { id: 0, role: 'SYSTEM' },
            action: 'FLOOR_TASK_LEASE_EXPIRED',
            entity_type: 'FLOOR_TASK',
            entity_id: t.task_ref,
            details: { previous_worker: t.assigned_to },
          });
        }
      }

      // Log in job_runs only if items were swept or periodically
      if (sweptMissions > 0 || sweptTasks > 0) {
        db.prepare(
          `
          INSERT INTO job_runs (job, started_at, finished_at, status, detail)
          VALUES ('lease_sweep', ?, ?, 'OK', ?)
        `
        ).run(startedAt, new Date().toISOString(), JSON.stringify({ sweptMissions, sweptTasks }));
      }
    })();
  } catch (err: any) {
    try {
      db.prepare(
        `
        INSERT INTO job_runs (job, started_at, finished_at, status, detail)
        VALUES ('lease_sweep', ?, ?, 'ERROR', ?)
      `
      ).run(startedAt, new Date().toISOString(), JSON.stringify({ error: err.message }));
    } catch (e) {
      // ignore
    }
  }

  return { sweptMissions, sweptTasks };
}
