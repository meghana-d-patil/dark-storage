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
