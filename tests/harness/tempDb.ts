import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface TempDbPaths {
  dir: string;
  warehouseDbPath: string;
  schedulerDbPath: string;
  cleanup: () => void;
}

export function createTempDbPaths(): TempDbPaths {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dark-storage-test-'));
  const warehouseDbPath = path.join(dir, 'warehouse.db');
  const schedulerDbPath = path.join(dir, 'scheduler.db');

  return {
    dir,
    warehouseDbPath,
    schedulerDbPath,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore on Windows if handles close slightly async
      }
    }
  };
}
