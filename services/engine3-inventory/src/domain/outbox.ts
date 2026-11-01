import Database from 'better-sqlite3';

export interface EmitEventParams {
  event_type: string;
  entity_type: string;
  entity_id: string;
  data: Record<string, unknown>;
}

export function emit(db: Database.Database, params: EmitEventParams): void {
  db.prepare(`
    INSERT INTO outbox_events (
      event_type,
      entity_type,
      entity_id,
      data_json
    ) VALUES (?, ?, ?, ?)
  `).run(
    params.event_type,
    params.entity_type,
    params.entity_id,
    JSON.stringify(params.data)
  );
}

export const insertOutboxEvent = emit;
