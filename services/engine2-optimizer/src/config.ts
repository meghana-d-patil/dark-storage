import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  INTERNAL_TOKEN: z.string().min(1).default('change-me-internal'),
  WAREHOUSE_DB_PATH: z.string().min(1).default('./data/warehouse.db'),
  PORT: z.coerce.number().default(4002),
  HOST: z.string().default('127.0.0.1')
});

export const config = configSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  INTERNAL_TOKEN: process.env.INTERNAL_TOKEN,
  WAREHOUSE_DB_PATH: process.env.WAREHOUSE_DB_PATH,
  PORT: process.env.ENGINE2_PORT || process.env.PORT || 4002,
  HOST: process.env.ENGINE2_HOST || '127.0.0.1'
});
