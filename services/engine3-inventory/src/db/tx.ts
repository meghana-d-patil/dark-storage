import Database from 'better-sqlite3';

export function runInTx<T>(db: Database.Database, fn: () => T): T {
  return db.transaction(fn).immediate();
}

export const runTx = runInTx;

