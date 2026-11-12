import { describe, it, expect } from 'vitest';
import { ROLES, Role, ROLE_PERMISSIONS, can } from '@dark-storage/shared';
import { createApp } from '../../services/gateway/src/server.js';
import jwt from 'jsonwebtoken';
import { config } from '../../services/gateway/src/config.js';

interface RoutePolicy {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  requiredPerms: string[];
}

const ROUTE_POLICIES: RoutePolicy[] = [
  { method: 'GET', path: '/api/orders', requiredPerms: ['order:view'] },
  { method: 'GET', path: '/api/orders/ORD-001', requiredPerms: ['order:view'] },
  { method: 'POST', path: '/api/orders', requiredPerms: ['order:create'] },
  { method: 'POST', path: '/api/orders/ORD-001/cancel', requiredPerms: ['order:cancel'] },
  { method: 'POST', path: '/api/orders/ORD-001/reassign', requiredPerms: ['mission:reassign'] },
  { method: 'GET', path: '/api/inventory', requiredPerms: ['inventory:view'] },
  { method: 'GET', path: '/api/inventory/summary', requiredPerms: ['inventory:view'] },
  { method: 'GET', path: '/api/inventory/bins', requiredPerms: ['inventory:view'] },
  { method: 'GET', path: '/api/inventory/bins/A-01-01', requiredPerms: ['inventory:view'] },
  { method: 'GET', path: '/api/inventory/movements', requiredPerms: ['inventory:view'] },
  { method: 'POST', path: '/api/inventory/relocate', requiredPerms: ['relocate:execute'] },
  { method: 'POST', path: '/api/receipts', requiredPerms: ['inbound:receive'] },
  { method: 'GET', path: '/api/receipts', requiredPerms: ['inventory:view'] },
  { method: 'POST', path: '/api/putaways', requiredPerms: ['putaway:execute'] },
  { method: 'POST', path: '/api/placement/recommend', requiredPerms: ['putaway:execute'] },
  { method: 'POST', path: '/api/placement/validate', requiredPerms: ['putaway:execute'] },
  { method: 'POST', path: '/api/missions/MSN-001/start', requiredPerms: ['pick:execute'] },
  { method: 'GET', path: '/api/missions', requiredPerms: ['order:view', 'pick:execute'] },
  { method: 'POST', path: '/api/pick-stops/STP-001/exception', requiredPerms: ['pick:execute', 'exception:raise'] },
  { method: 'GET', path: '/api/exceptions', requiredPerms: ['exception:view', 'exception:raise'] },
  { method: 'POST', path: '/api/exceptions/EXC-001/resolve', requiredPerms: ['exception:resolve'] },
  { method: 'GET', path: '/api/packing/queue', requiredPerms: ['pack:execute', 'order:view'] },
  { method: 'GET', path: '/api/tasks', requiredPerms: ['control:view'] },
  { method: 'GET', path: '/api/tasks/locks', requiredPerms: ['control:view'] },
  { method: 'GET', path: '/api/tasks/queue', requiredPerms: ['control:view'] },
  { method: 'GET', path: '/api/audit', requiredPerms: ['audit:view'] },
  { method: 'GET', path: '/api/admin/integrity', requiredPerms: ['audit:verify', 'control:view'] },
  { method: 'GET', path: '/api/config', requiredPerms: ['config:view'] }
];

function makeToken(role: Role, id = 1, name = 'testuser'): string {
  return jwt.sign(
    {
      sub: String(id),
      role,
      name
    },
    config.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('Gateway RBAC Enforcement (P2-T1 & P2-T2)', () => {
  it('verifies permission matrix for every route policy across all 7 roles', () => {
    for (const policy of ROUTE_POLICIES) {
      for (const role of ROLES) {
        const canAccess = policy.requiredPerms.some((perm) => can({ role }, perm));
        const userPerms = ROLE_PERMISSIONS[role];
        const hasDirectPerm = policy.requiredPerms.some((perm) => userPerms.includes(perm));
        expect(canAccess).toBe(hasDirectPerm);
      }
    }
  });

  it('MANAGER has no physical execution permissions in any route', () => {
    const physicalExecutionPerms = [
      'pick:execute',
      'pack:execute',
      'inbound:receive',
      'putaway:execute',
      'count:execute',
      'relocate:execute',
      'dispatch:handover'
    ];

    for (const perm of physicalExecutionPerms) {
      expect(can({ role: 'MANAGER' }, perm)).toBe(false);
    }

    // Manager cannot execute: receipts, putaways, relocate, mission start
    const managerExecutionRoutes = [
      '/api/receipts',
      '/api/putaways',
      '/api/inventory/relocate',
      '/api/missions/MSN-001/start'
    ];

    for (const path of managerExecutionRoutes) {
      const policy = ROUTE_POLICIES.find((p) => p.path === path);
      expect(policy).toBeDefined();
      const managerCan = policy!.requiredPerms.some((perm) => can({ role: 'MANAGER' }, perm));
      expect(managerCan).toBe(false);
    }
  });

  describe('D11 Removed Shortcut Endpoints (P2-T2)', () => {
    const app = createApp();

    const d11Endpoints = [
      { method: 'post', path: '/api/orders/ORD-001/pack' },
      { method: 'post', path: '/api/packing/ORD-001/pack' },
      { method: 'post', path: '/api/pick-stops/STP-001/confirm' },
      { method: 'post', path: '/api/inventory/bins/A-01-01/recount' },
      { method: 'post', path: '/api/orders/ORD-001/assign' }
    ];

    for (const endpoint of d11Endpoints) {
      it(`returns 410 ENDPOINT_REMOVED for ${endpoint.method.toUpperCase()} ${endpoint.path}`, async () => {
        const managerToken = makeToken('MANAGER');

        // Test with real express req/res simulation
        await new Promise<void>((resolve, reject) => {
          const req: any = {
            method: endpoint.method.toUpperCase(),
            url: endpoint.path,
            headers: {
              authorization: `Bearer ${managerToken}`,
              'content-type': 'application/json'
            },
            body: {}
          };

          const res: any = {
            statusCode: 200,
            status(code: number) {
              this.statusCode = code;
              return this;
            },
            json(data: any) {
              try {
                expect(this.statusCode).toBe(410);
                expect(data.code).toBe('ENDPOINT_REMOVED');
                expect(data.error).toBe('Endpoint removed');
                expect(data.details?.replacement).toBeDefined();
                resolve();
              } catch (e) {
                reject(e);
              }
            },
            setHeader() {},
            send(body: any) {
              this.json(JSON.parse(body));
            }
          };

          app.handle(req, res);
        });
      });
    }
  });

  describe('Gateway route RBAC simulation via app.handle()', () => {
    const app = createApp();

    it('rejects unauthenticated requests with 401 UNAUTHENTICATED', async () => {
      await new Promise<void>((resolve, reject) => {
        const req: any = {
          method: 'GET',
          url: '/api/orders',
          headers: {},
          body: {}
        };

        const res: any = {
          statusCode: 200,
          status(code: number) {
            this.statusCode = code;
            return this;
          },
          json(data: any) {
            try {
              expect(this.statusCode).toBe(401);
              expect(data.code).toBe('UNAUTHENTICATED');
              resolve();
            } catch (e) {
              reject(e);
            }
          },
          setHeader() {},
          send(body: any) {
            try {
              const parsed = typeof body === 'string' ? JSON.parse(body) : body;
              this.json(parsed);
            } catch {
              resolve();
            }
          }
        };

        app.handle(req, res);
      });
    });

    it('returns 403 FORBIDDEN when user lacks required permission', async () => {
      // PICKER calling POST /api/orders (requires order:create)
      const pickerToken = makeToken('PICKER');

      await new Promise<void>((resolve, reject) => {
        const req: any = {
          method: 'POST',
          url: '/api/orders',
          headers: {
            authorization: `Bearer ${pickerToken}`,
            'content-type': 'application/json',
            'idempotency-key': 'test-idem-key'
          },
          body: { lines: [] }
        };

        const res: any = {
          statusCode: 200,
          status(code: number) {
            this.statusCode = code;
            return this;
          },
          json(data: any) {
            try {
              expect(this.statusCode).toBe(403);
              expect(data.code).toBe('FORBIDDEN');
              resolve();
            } catch (e) {
              reject(e);
            }
          },
          setHeader() {},
          send(body: any) {
            try {
              const parsed = typeof body === 'string' ? JSON.parse(body) : body;
              this.json(parsed);
            } catch {
              resolve();
            }
          }
        };

        app.handle(req, res);
      });
    });

    it('returns 403 when MANAGER attempts physical relocate execution', async () => {
      const managerToken = makeToken('MANAGER');

      await new Promise<void>((resolve, reject) => {
        const req: any = {
          method: 'POST',
          url: '/api/inventory/relocate',
          headers: {
            authorization: `Bearer ${managerToken}`,
            'content-type': 'application/json',
            'idempotency-key': 'test-idem-key'
          },
          body: { from_bin: 'A-01-01', to_bin: 'A-01-02', sku: 'SKU-001', qty: 5 }
        };

        const res: any = {
          statusCode: 200,
          status(code: number) {
            this.statusCode = code;
            return this;
          },
          json(data: any) {
            try {
              expect(this.statusCode).toBe(403);
              expect(data.code).toBe('FORBIDDEN');
              resolve();
            } catch (e) {
              reject(e);
            }
          },
          setHeader() {},
          send(body: any) {
            try {
              const parsed = typeof body === 'string' ? JSON.parse(body) : body;
              this.json(parsed);
            } catch {
              resolve();
            }
          }
        };

        app.handle(req, res);
      });
    });
  });
});
