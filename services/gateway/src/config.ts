import { z } from 'zod';

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
