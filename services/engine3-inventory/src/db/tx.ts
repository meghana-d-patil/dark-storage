import Database from 'better-sqlite3';

export function runTx<T>(db: Database.Database, fn: () => T): T {
  const trx = db.transaction(fn);
  return db.inTransaction ? trx() : trx.immediate();
}
