import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { DomainError } from '@dark-storage/shared';
import { runTx } from '../db/tx.js';

export interface IdempotencyArgs {
  key: string;
  scope: string;
  body: unknown;
  actor?: { id: number; role: string } | null;
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replay: boolean;
}

export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson((obj as Record<string, unknown>)[k])).join(',') + '}';
}

export function runIdempotent<T>(
  db: Database.Database,
  args: IdempotencyArgs,
  handler: (db: Database.Database) => { status: number; body: T }
): IdempotentResult<T> {
  const hash = crypto.createHash('sha256').update(canonicalJson(args.body), 'utf8').digest('hex');

  // Check if existing key before transaction
  const existing = db.prepare('SELECT * FROM idempotency_keys WHERE key = ?').get(args.key) as {
    request_hash: string;
    status_code: number;
    response_json: string;
  } | undefined;

  if (existing) {
    if (existing.request_hash !== hash) {
      throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'Same key used with different request body');
    }
    return {
      status: existing.status_code,
      body: JSON.parse(existing.response_json) as T,
      replay: true
    };
  }

  // Single transaction boundary via runTx
  return runTx(db, () => {
    // Re-check inside transaction
    const inTxExisting = db.prepare('SELECT * FROM idempotency_keys WHERE key = ?').get(args.key) as {
      request_hash: string;
      status_code: number;
      response_json: string;
    } | undefined;

    if (inTxExisting) {
      if (inTxExisting.request_hash !== hash) {
        throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'Same key used with different request body');
      }
      return {
        status: inTxExisting.status_code,
        body: JSON.parse(inTxExisting.response_json) as T,
        replay: true
      };
    }

    const res = handler(db);

    db.prepare(`
      INSERT INTO idempotency_keys (key, scope, request_hash, status_code, response_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(args.key, args.scope, hash, res.status, JSON.stringify(res.body));

    return {
      status: res.status,
      body: res.body,
      replay: false
    };
  });
}

export function purgeOldIdempotencyKeys(db: Database.Database): number {
  const res = db.prepare(`
    DELETE FROM idempotency_keys
    WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
  `).run();
  return res.changes;
}
