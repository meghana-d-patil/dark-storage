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

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JWT_SECRET: z.string().min(1).default('change-me-dev-only'),
  INTERNAL_TOKEN: z.string().min(1).default('change-me-internal'),
  GATEWAY_PORT: z.coerce.number().default(4000),
  ENGINE1_URL: z.string().url().default('http://127.0.0.1:4001'),
  ENGINE2_URL: z.string().url().default('http://127.0.0.1:4002'),
  ENGINE3_URL: z.string().url().default('http://127.0.0.1:4003'),
  ENGINE3_COMMAND_TIMEOUT_MS: z.coerce.number().default(10000),
  TASK_WAIT_TIMEOUT_MS: z.coerce.number().default(15000)
});

export const config = configSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  JWT_SECRET: process.env.JWT_SECRET,
  INTERNAL_TOKEN: process.env.INTERNAL_TOKEN,
  GATEWAY_PORT: process.env.GATEWAY_PORT || process.env.PORT || 4000,
  ENGINE1_URL: process.env.ENGINE1_URL,
  ENGINE2_URL: process.env.ENGINE2_URL,
  ENGINE3_URL: process.env.ENGINE3_URL,
  ENGINE3_COMMAND_TIMEOUT_MS: process.env.ENGINE3_COMMAND_TIMEOUT_MS,
  TASK_WAIT_TIMEOUT_MS: process.env.TASK_WAIT_TIMEOUT_MS
});
