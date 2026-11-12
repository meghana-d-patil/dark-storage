import { describe, it, expect } from 'vitest';
import { can, ROLES, Role, ROLE_PERMISSIONS } from '@dark-storage/shared';

describe('Permissions & RBAC Foundations (P1-T8)', () => {
  it('for each role, can() is true for listed perms and false for unlisted perms', () => {
    // 1. ADMIN
    expect(can({ role: 'ADMIN' }, 'user:manage')).toBe(true);
    expect(can({ role: 'ADMIN' }, 'config:thresholds')).toBe(true);
    expect(can({ role: 'ADMIN' }, 'lock:release')).toBe(true);
    expect(can({ role: 'ADMIN' }, 'pick:execute')).toBe(false);
    expect(can({ role: 'ADMIN' }, 'pack:execute')).toBe(false);
    expect(can({ role: 'ADMIN' }, 'inbound:receive')).toBe(false);

    // 2. MANAGER
    expect(can({ role: 'MANAGER' }, 'order:cancel')).toBe(true);
    expect(can({ role: 'MANAGER' }, 'exception:resolve')).toBe(true);
    expect(can({ role: 'MANAGER' }, 'config:weights')).toBe(true);
    expect(can({ role: 'MANAGER' }, 'pick:execute')).toBe(false);
    expect(can({ role: 'MANAGER' }, 'pack:execute')).toBe(false);
    expect(can({ role: 'MANAGER' }, 'dispatch:handover')).toBe(false);

    // 3. OPERATOR
    expect(can({ role: 'OPERATOR' }, 'inbound:receive')).toBe(true);
    expect(can({ role: 'OPERATOR' }, 'putaway:execute')).toBe(true);
    expect(can({ role: 'OPERATOR' }, 'count:execute')).toBe(true);
    expect(can({ role: 'OPERATOR' }, 'order:create')).toBe(false);
    expect(can({ role: 'OPERATOR' }, 'pack:execute')).toBe(false);
    expect(can({ role: 'OPERATOR' }, 'user:manage')).toBe(false);

    // 4. PICKER
    expect(can({ role: 'PICKER' }, 'mission:claim')).toBe(true);
    expect(can({ role: 'PICKER' }, 'pick:execute')).toBe(true);
    expect(can({ role: 'PICKER' }, 'putback:execute')).toBe(true);
    expect(can({ role: 'PICKER' }, 'pack:execute')).toBe(false);
    expect(can({ role: 'PICKER' }, 'order:cancel')).toBe(false);
    expect(can({ role: 'PICKER' }, 'config:view')).toBe(false);

    // 5. STAFF
    expect(can({ role: 'STAFF' }, 'pack:execute')).toBe(true);
    expect(can({ role: 'STAFF' }, 'repick:request')).toBe(true);
    expect(can({ role: 'STAFF' }, 'exception:raise')).toBe(true);
    expect(can({ role: 'STAFF' }, 'pick:execute')).toBe(false);
    expect(can({ role: 'STAFF' }, 'inbound:receive')).toBe(false);
    expect(can({ role: 'STAFF' }, 'order:cancel')).toBe(false);

    // 6. DISPATCH
    expect(can({ role: 'DISPATCH' }, 'dispatch:handover')).toBe(true);
    expect(can({ role: 'DISPATCH' }, 'dispatch:view')).toBe(true);
    expect(can({ role: 'DISPATCH' }, 'pack:execute')).toBe(false);
    expect(can({ role: 'DISPATCH' }, 'pick:execute')).toBe(false);
    expect(can({ role: 'DISPATCH' }, 'order:cancel')).toBe(false);

    // 7. AUDITOR
    expect(can({ role: 'AUDITOR' }, 'audit:view')).toBe(true);
    expect(can({ role: 'AUDITOR' }, 'audit:verify')).toBe(true);
    expect(can({ role: 'AUDITOR' }, 'audit:export')).toBe(true);
    expect(can({ role: 'AUDITOR' }, 'order:cancel')).toBe(false);
    expect(can({ role: 'AUDITOR' }, 'pick:execute')).toBe(false);
    expect(can({ role: 'AUDITOR' }, 'adjust:approve')).toBe(false);
  });

  it('MANAGER has NONE of physical execution permissions (Segregation of Duties)', () => {
    const forbiddenExecutionPerms = [
      'pick:execute',
      'pack:execute',
      'inbound:receive',
      'putaway:execute',
      'count:execute',
      'relocate:execute',
      'dispatch:handover'
    ];

    for (const perm of forbiddenExecutionPerms) {
      expect(can({ role: 'MANAGER' }, perm)).toBe(false);
      expect(ROLE_PERMISSIONS.MANAGER).not.toContain(perm);
    }
  });

  it('can() supports explicit user.permissions override', () => {
    const userWithOverrides = {
      role: 'PICKER' as Role,
      permissions: ['custom:read', 'pick:execute']
    };
    expect(can(userWithOverrides, 'custom:read')).toBe(true);
    expect(can(userWithOverrides, 'pick:execute')).toBe(true);
    expect(can(userWithOverrides, 'mission:claim')).toBe(false); // not in overrides
  });
});
