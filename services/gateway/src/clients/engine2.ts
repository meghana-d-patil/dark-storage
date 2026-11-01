import { DomainError, ErrorCode } from '@dark-storage/shared';
import crypto from 'node:crypto';
import { config } from '../config.js';

export interface Engine2RequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  requestId?: string;
  timeoutMs?: number;
}

export async function callEngine2<T>(opts: Engine2RequestOptions): Promise<{ status: number; data: T }> {
  const url = `${config.ENGINE2_URL}${opts.path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-internal-token': config.INTERNAL_TOKEN,
    'x-request-id': opts.requestId || crypto.randomUUID()
  };

  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      if (json && json.error && json.error.code) {
        throw new DomainError(json.error.code as ErrorCode, json.error.message, json.error.details);
      }
      throw new DomainError('ENGINE2_UNAVAILABLE', `Engine 2 returned HTTP ${res.status}`);
    }

    return { status: res.status, data: json as T };
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof DomainError) {
      throw err;
    }

    if (err instanceof Error && err.name === 'AbortError') {
      throw new DomainError('ENGINE2_UNAVAILABLE', 'Engine 2 request timed out');
    }

    throw new DomainError('ENGINE2_UNAVAILABLE', `Could not connect to Engine 2: ${String(err)}`);
  }
}
