import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function backupDatabase(srcPath: string, backupDir = './backups'): string {
  fs.mkdirSync(backupDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `warehouse-${ts}.db`;
  const backupFilePath = path.resolve(backupDir, backupFileName);

  const srcDb = new Database(srcPath);
  srcDb.pragma('busy_timeout = 5000');

  // VACUUM INTO creates a consistent point-in-time backup
  srcDb.prepare('VACUUM INTO ?').run(backupFilePath);

  // Verification: open backup DB read-only
  const backupDb = new Database(backupFilePath, { readonly: true });

  // Compare row counts of all tables
  const tables = srcDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];

  for (const t of tables) {
    const srcCount = (srcDb.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as { c: number }).c;
    const backupCount = (backupDb.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as { c: number }).c;
    if (srcCount !== backupCount) {
      backupDb.close();
      srcDb.close();
      throw new Error(`Backup verification failed for table ${t.name}: src=${srcCount}, backup=${backupCount}`);
    }
  }

  backupDb.close();
  srcDb.close();

  return backupFilePath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/backup-db.ts')) {
  const dbPath = process.env.WAREHOUSE_DB_PATH || './data/warehouse.db';
  console.log(`Backing up ${dbPath}...`);
  const dest = backupDatabase(dbPath);
  console.log(`Backup completed successfully to ${dest}`);
}
