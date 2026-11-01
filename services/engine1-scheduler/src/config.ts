import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  INTERNAL_TOKEN: z.string().min(1).default('change-me-internal'),
  SCHEDULER_DB_PATH: z.string().min(1).default('./data/scheduler.db'),
  PORT: z.coerce.number().default(4001),
  HOST: z.string().default('127.0.0.1')
});

export const config = configSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  INTERNAL_TOKEN: process.env.INTERNAL_TOKEN,
  SCHEDULER_DB_PATH: process.env.SCHEDULER_DB_PATH,
  PORT: process.env.ENGINE1_PORT || process.env.PORT || 4001,
  HOST: process.env.ENGINE1_HOST || '127.0.0.1'
});
