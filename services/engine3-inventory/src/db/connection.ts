import Database from 'better-sqlite3';

export function openDb(dbPath: string, opts?: { readonly?: boolean }): Database.Database {
  const db = new Database(dbPath, { readonly: opts?.readonly ?? false });
  if (!opts?.readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}
