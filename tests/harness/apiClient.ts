import crypto from 'node:crypto';

export interface ApiClient {
  login: (username: string, password?: string) => Promise<{ token: string; user: unknown }>;
  setToken: (token: string | null) => void;
  get: (path: string, options?: { headers?: Record<string, string> }) => Promise<{ status: number; body: any; headers: Headers }>;
  post: (
    path: string,
    body?: unknown,
    options?: { idempotencyKey?: string; headers?: Record<string, string> }
  ) => Promise<{ status: number; body: any; headers: Headers }>;
}

export function apiClient(baseUrl: string): ApiClient {
  let authToken: string | null = null;

  return {
    setToken(token: string | null) {
      authToken = token;
    },

    async login(username: string, password = process.env.SEED_DEFAULT_PASSWORD || 'Warehouse#2026') {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const body = await res.json();
      if (res.ok && body.token) {
        authToken = body.token;
      }
      return body;
    },

    async get(path: string, options = {}) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'GET',
        headers
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, body, headers: res.headers };
    },

    async post(path: string, body?: unknown, options: { idempotencyKey?: string; headers?: Record<string, string> } = {}) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      if (options.idempotencyKey !== undefined) {
        if (options.idempotencyKey) {
          headers['Idempotency-Key'] = options.idempotencyKey;
        }
      } else {
        headers['Idempotency-Key'] = crypto.randomUUID();
      }

      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      const respBody = await res.json().catch(() => null);
      return { status: res.status, body: respBody, headers: res.headers };
    }
  };
}
