import { ErrorCode } from '@dark-storage/shared';
import { useAuthStore } from '../stores/authStore.js';

export class ApiError extends Error {
  public readonly code: ErrorCode | 'NETWORK_ERROR';
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;
  public readonly isNetwork: boolean;

  constructor(code: ErrorCode | 'NETWORK_ERROR', message: string, httpStatus = 500, details?: Record<string, unknown>, isNetwork = false) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    this.isNetwork = isNetwork;
  }
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit & { idempotencyKey?: string } = {}
): Promise<T> {
  const token = useAuthStore.getState().token;

  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const method = (options.method || 'GET').toUpperCase();
  const idemKey =
    options.idempotencyKey ||
    headers.get('Idempotency-Key') ||
    (method !== 'GET' && method !== 'HEAD'
      ? `idem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      : undefined);

  if (idemKey) {
    headers.set('Idempotency-Key', idemKey);
  }

  try {
    const res = await fetch(endpoint, {
      ...options,
      headers
    });

    const json = await res.json().catch(() => null);

    if (res.status === 401) {
      useAuthStore.getState().logout();
      throw new ApiError('UNAUTHENTICATED', 'Session expired or unauthorized', 401);
    }

    if (!res.ok) {
      if (json && json.error && json.error.code) {
        throw new ApiError(
          json.error.code as ErrorCode,
          json.error.message || 'API request failed',
          res.status,
          json.error.details
        );
      }
      throw new ApiError('INTERNAL_ERROR', `HTTP Error ${res.status}`, res.status);
    }

    return json as T;
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError('NETWORK_ERROR', 'Network connection failure', 0, undefined, true);
  }
}
