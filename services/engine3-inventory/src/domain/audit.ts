import Database from 'better-sqlite3';

export interface AuditParams {
  actor: { id: number; role: string } | null;
  action: string;
  entity_type: string;
  entity_id: string;
  details?: Record<string, unknown>;
  request_id?: string;
}

export function audit(db: Database.Database, params: AuditParams): void {
  db.prepare(`
    INSERT INTO audit_log (
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      details_json,
      request_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.actor?.id ?? null,
    params.actor?.role ?? null,
    params.action,
    params.entity_type,
    params.entity_id,
    JSON.stringify(params.details ?? {}),
    params.request_id ?? null
  );
}

export function recordAudit(
  db: Database.Database,
  opts: {
    entity_type: string;
    entity_id: string;
    action: string;
    before?: unknown;
    after?: unknown;
    actor_id?: number | null;
    request_id?: string;
  }
): void {
  db.prepare(`
    INSERT INTO audit_log (
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      details_json,
      request_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.actor_id ?? null,
    null,
    opts.action,
    opts.entity_type,
    opts.entity_id,
    JSON.stringify({ before: opts.before, after: opts.after }),
    opts.request_id ?? null
  );
}
