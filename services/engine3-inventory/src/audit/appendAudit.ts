import Database from 'better-sqlite3';
import crypto from 'node:crypto';

export interface AuditActor {
  id?: number | string | null;
  username?: string | null;
  role?: string | null;
}

export interface AppendAuditInput {
  actor?: AuditActor | null;
  action: string;
  entityType: string;
  entityRef: string;
  before?: any;
  after?: any;
  reasonCode?: string;
  note?: string;
  ip?: string;
  requestId?: string;
  occurredAt?: string;
}

export interface AppendOrderEventInput {
  orderRef: string;
  event: string;
  actor?: AuditActor | null;
  payload?: any;
  at?: string;
}

export function sortObjectKeys(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  const sorted: Record<string, any> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortObjectKeys(obj[key]);
  }
  return sorted;
}

export function appendAudit(db: Database.Database, input: AppendAuditInput): { id: number; seq: number; row_hash: string } {
  const occurredAt = input.occurredAt || new Date().toISOString();
  const actorId = input.actor?.id !== undefined && input.actor?.id !== null ? Number(input.actor.id) : null;
  const actorRole = input.actor?.role || null;
  const requestId = input.requestId || null;

  const detailsObj = {
    before: input.before,
    after: input.after,
    reason_code: input.reasonCode,
    note: input.note,
    ip: input.ip,
    username: input.actor?.username
  };
  const detailsJson = JSON.stringify(detailsObj);

  // Read head
  const head = db.prepare(`SELECT last_seq, last_hash FROM audit_head WHERE id = 1`).get() as {
    last_seq: number;
    last_hash: string;
  } | undefined;

  const lastSeq = head ? head.last_seq : 0;
  const prevHash = head ? head.last_hash : 'GENESIS';
  const seq = lastSeq + 1;

  const canonicalPayload = sortObjectKeys({
    action: input.action,
    actor_role: actorRole,
    actor_user_id: actorId,
    details_json: detailsJson,
    entity_id: input.entityRef,
    entity_type: input.entityType,
    occurred_at: occurredAt,
    request_id: requestId,
    seq
  });

  const canonical = JSON.stringify(canonicalPayload);
  const rowHash = crypto.createHash('sha256').update(prevHash + canonical).digest('hex');

  const insertStmt = db.prepare(`
    INSERT INTO audit_log (
      occurred_at,
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      details_json,
      request_id,
      seq,
      prev_hash,
      row_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = insertStmt.run(
    occurredAt,
    actorId,
    actorRole,
    input.action,
    input.entityType,
    input.entityRef,
    detailsJson,
    requestId,
    seq,
    prevHash,
    rowHash
  );

  db.prepare(`
    UPDATE audit_head
    SET last_seq = ?, last_hash = ?
    WHERE id = 1
  `).run(seq, rowHash);

  return {
    id: Number(info.lastInsertRowid),
    seq,
    row_hash: rowHash
  };
}

export function appendOrderEvent(db: Database.Database, input: AppendOrderEventInput): number {
  const at = input.at || new Date().toISOString();
  const actorId = input.actor?.id !== undefined && input.actor?.id !== null ? String(input.actor.id) : null;
  const actorRole = input.actor?.role || null;
  const payloadStr = input.payload ? JSON.stringify(input.payload) : '{}';

  const res = db.prepare(`
    INSERT INTO order_events (order_ref, event, actor_id, actor_role, payload, at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.orderRef, input.event, actorId, actorRole, payloadStr, at);

  return Number(res.lastInsertRowid);
}

export function ensureAuditChain(db: Database.Database): void {
  const unhashedRows = db.prepare(`
    SELECT id, occurred_at, actor_user_id, actor_role, action, entity_type, entity_id, details_json, request_id
    FROM audit_log
    WHERE row_hash IS NULL
    ORDER BY id ASC
  `).all() as any[];

  if (unhashedRows.length === 0) return;

  const head = db.prepare(`SELECT last_seq, last_hash FROM audit_head WHERE id = 1`).get() as {
    last_seq: number;
    last_hash: string;
  } || { last_seq: 0, last_hash: 'GENESIS' };

  let currentSeq = head.last_seq;
  let currentHash = head.last_hash;

  const updateStmt = db.prepare(`
    UPDATE audit_log
    SET seq = ?, prev_hash = ?, row_hash = ?
    WHERE id = ?
  `);

  const tx = db.transaction(() => {
    for (const row of unhashedRows) {
      currentSeq += 1;
      const prevHash = currentHash;
      const canonicalPayload = sortObjectKeys({
        action: row.action,
        actor_role: row.actor_role,
        actor_user_id: row.actor_user_id,
        details_json: row.details_json,
        entity_id: row.entity_id,
        entity_type: row.entity_type,
        occurred_at: row.occurred_at,
        request_id: row.request_id,
        seq: currentSeq
      });
      const canonical = JSON.stringify(canonicalPayload);
      const rowHash = crypto.createHash('sha256').update(prevHash + canonical).digest('hex');

      updateStmt.run(currentSeq, prevHash, rowHash, row.id);
      currentHash = rowHash;
    }

    db.prepare(`
      UPDATE audit_head
      SET last_seq = ?, last_hash = ?
      WHERE id = 1
    `).run(currentSeq, currentHash);
  });

  tx();
}

export interface AuditVerifyResult {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  head: {
    last_seq: number;
    last_hash: string;
  } | null;
}

export function verifyAuditChain(db: Database.Database): AuditVerifyResult {
  const rows = db.prepare(`
    SELECT seq, prev_hash, row_hash, occurred_at, actor_user_id, actor_role, action, entity_type, entity_id, details_json, request_id
    FROM audit_log
    ORDER BY seq ASC
  `).all() as any[];

  const head = db.prepare(`SELECT last_seq, last_hash FROM audit_head WHERE id = 1`).get() as {
    last_seq: number;
    last_hash: string;
  } | undefined;

  let expectedPrevHash = 'GENESIS';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const expectedSeq = i + 1;

    if (row.seq !== expectedSeq) {
      return { ok: false, checked: i, brokenAtSeq: expectedSeq, head: head || null };
    }

    if (row.prev_hash !== expectedPrevHash) {
      return { ok: false, checked: i, brokenAtSeq: row.seq, head: head || null };
    }

    const canonicalPayload = sortObjectKeys({
      action: row.action,
      actor_role: row.actor_role,
      actor_user_id: row.actor_user_id,
      details_json: row.details_json,
      entity_id: row.entity_id,
      entity_type: row.entity_type,
      occurred_at: row.occurred_at,
      request_id: row.request_id,
      seq: row.seq
    });
    const canonical = JSON.stringify(canonicalPayload);
    const computedHash = crypto.createHash('sha256').update(row.prev_hash + canonical).digest('hex');

    if (row.row_hash !== computedHash) {
      return { ok: false, checked: i, brokenAtSeq: row.seq, head: head || null };
    }

    expectedPrevHash = row.row_hash;
  }

  if (head && (head.last_seq !== rows.length || (rows.length > 0 && head.last_hash !== expectedPrevHash))) {
    return { ok: false, checked: rows.length, brokenAtSeq: rows.length, head };
  }

  return {
    ok: true,
    checked: rows.length,
    brokenAtSeq: null,
    head: head || null
  };
}
