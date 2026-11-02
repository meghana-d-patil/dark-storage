import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';

function getRootDir(): string {
  if (fs.existsSync(path.resolve(process.cwd(), 'package.json')) && fs.existsSync(path.resolve(process.cwd(), 'packages'))) {
    return process.cwd();
  }
  return path.resolve(process.cwd(), '../..');
}

function loadRootEnv() {
  const envPath = path.resolve(getRootDir(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadRootEnv();

function resolveDbPath(inputPath?: string, defaultRel = './data/warehouse.db'): string {
  const p = inputPath || defaultRel;
  if (path.isAbsolute(p)) return p;
  return path.resolve(getRootDir(), p);
}

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  INTERNAL_TOKEN: z.string().min(1).default('change-me-internal'),
  WAREHOUSE_DB_PATH: z.string().min(1),
  PORT: z.coerce.number().default(4002),
  HOST: z.string().default('127.0.0.1')
});

export const config = configSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  INTERNAL_TOKEN: process.env.INTERNAL_TOKEN,
  WAREHOUSE_DB_PATH: resolveDbPath(process.env.WAREHOUSE_DB_PATH, './data/warehouse.db'),
  PORT: process.env.ENGINE2_PORT || process.env.PORT || 4002,
  HOST: process.env.ENGINE2_HOST || '127.0.0.1'
});
