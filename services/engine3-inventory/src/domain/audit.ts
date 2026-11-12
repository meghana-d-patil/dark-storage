import Database from 'better-sqlite3';
import { appendAudit } from '../audit/appendAudit.js';

export interface AuditParams {
  actor: { id: number; role: string; username?: string } | null;
  action: string;
  entity_type: string;
  entity_id: string;
  details?: Record<string, unknown>;
  request_id?: string;
}

export function audit(db: Database.Database, params: AuditParams): void {
  appendAudit(db, {
    actor: params.actor,
    action: params.action,
    entityType: params.entity_type,
    entityRef: params.entity_id,
    before: params.details?.before,
    after: params.details?.after,
    note: params.details?.note ? String(params.details.note) : undefined,
    reasonCode: params.details?.reason_code ? String(params.details.reason_code) : undefined,
    requestId: params.request_id
  });
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
  appendAudit(db, {
    actor: opts.actor_id ? { id: opts.actor_id, role: undefined } : null,
    action: opts.action,
    entityType: opts.entity_type,
    entityRef: opts.entity_id,
    before: opts.before,
    after: opts.after,
    requestId: opts.request_id
  });
}
