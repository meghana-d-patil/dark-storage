import Database from 'better-sqlite3';
import path from 'node:path';
import { runIntegrityChecks, type IntegrityCheckResult, type IntegrityReport } from '../services/engine3-inventory/src/domain/integrity.js';

export { runIntegrityChecks };
export type { IntegrityCheckResult, IntegrityReport };

// CLI runner
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/verify-integrity.ts')) {
  const dbPath = process.env.WAREHOUSE_DB_PATH || './data/warehouse.db';
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    console.log(`Running integrity checks on ${dbPath}...`);
    const report = runIntegrityChecks(db);
    db.close();

    for (const c of report.checks) {
      console.log(`[${c.status}] ${c.id}: ${c.name}`);
      if (c.status === 'FAIL' && c.rows) {
        console.error('  Offending rows:', JSON.stringify(c.rows));
      }
    }

    if (!report.ok) {
      console.error('Integrity checks FAILED!');
      process.exit(1);
    }

    console.log('Integrity checks PASSED.');
    process.exit(0);
  } catch (e) {
    console.error('Could not run integrity checks:', e);
    process.exit(1);
  }
}
