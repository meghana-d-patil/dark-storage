import Database from 'better-sqlite3';
import { AppError } from '@dark-storage/shared';

interface ConfigRow {
  key: string;
  value: string;
  value_type: 'int' | 'float' | 'string' | 'bool';
  min_val: number | null;
  max_val: number | null;
  grp: 'WEIGHT' | 'THRESHOLD';
  description: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

const configCache = new Map<string, { val: any; expiresAt: number }>();
const CACHE_TTL_MS = 5000;

export function clearConfigCache(): void {
  configCache.clear();
}

export function parseConfigValue(row: ConfigRow): any {
  switch (row.value_type) {
    case 'int':
      return parseInt(row.value, 10);
    case 'float':
      return parseFloat(row.value);
    case 'bool':
      return row.value === 'true' || row.value === '1';
    case 'string':
    default:
      return row.value;
  }
}

export function getConfig<T = any>(db: Database.Database, key: string): T {
  const cached = configCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.val as T;
  }

  const row = db.prepare('SELECT * FROM system_config WHERE key = ?').get(key) as ConfigRow | undefined;
  if (!row) {
    throw new AppError('NOT_FOUND', 404, `Config key '${key}' not found`);
  }

  const parsed = parseConfigValue(row);
  configCache.set(key, { val: parsed, expiresAt: now + CACHE_TTL_MS });
  return parsed as T;
}

export function getAllConfig(db: Database.Database): Record<string, any> {
  const rows = db.prepare('SELECT * FROM system_config').all() as ConfigRow[];
  const result: Record<string, any> = {};
  for (const r of rows) {
    result[r.key] = parseConfigValue(r);
  }
  return result;
}

export function getAllConfigRows(db: Database.Database): ConfigRow[] {
  return db.prepare('SELECT * FROM system_config ORDER BY grp, key').all() as ConfigRow[];
}

export function setConfig(
  db: Database.Database,
  key: string,
  rawValue: string,
  actorId: string
): ConfigRow {
  const row = db.prepare('SELECT * FROM system_config WHERE key = ?').get(key) as ConfigRow | undefined;
  if (!row) {
    throw new AppError('NOT_FOUND', 404, `Config key '${key}' not found`);
  }

  let numVal: number | null = null;
  switch (row.value_type) {
    case 'int': {
      numVal = parseInt(rawValue, 10);
      if (isNaN(numVal)) {
        throw new AppError('VALIDATION_FAILED', 400, `Key '${key}' expects an integer value`);
      }
      break;
    }
    case 'float': {
      numVal = parseFloat(rawValue);
      if (isNaN(numVal)) {
        throw new AppError('VALIDATION_FAILED', 400, `Key '${key}' expects a numeric float value`);
      }
      break;
    }
    case 'bool': {
      if (rawValue !== 'true' && rawValue !== 'false' && rawValue !== '1' && rawValue !== '0') {
        throw new AppError('VALIDATION_FAILED', 400, `Key '${key}' expects a boolean value ('true' or 'false')`);
      }
      break;
    }
  }

  if (numVal !== null) {
    if (row.min_val !== null && numVal < row.min_val) {
      throw new AppError('VALIDATION_FAILED', 400, `Value ${numVal} is below min limit of ${row.min_val}`);
    }
    if (row.max_val !== null && numVal > row.max_val) {
      throw new AppError('VALIDATION_FAILED', 400, `Value ${numVal} exceeds max limit of ${row.max_val}`);
    }
  }

  db.prepare(`
    UPDATE system_config
    SET value = ?, updated_by = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    WHERE key = ?
  `).run(String(rawValue), actorId, key);

  clearConfigCache();

  return db.prepare('SELECT * FROM system_config WHERE key = ?').get(key) as ConfigRow;
}
