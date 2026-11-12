export const ROLES = ['ADMIN', 'MANAGER', 'OPERATOR', 'PICKER', 'STAFF', 'DISPATCH', 'AUDITOR'] as const;
export type Role = typeof ROLES[number];

export const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  ADMIN: [
    'user:manage', 'device:manage', 'config:view', 'config:thresholds', 'lock:release',
    'adjust:approve_high', 'exception:view', 'exception:escalated', 'audit:view', 'audit:verify',
    'order:view', 'inventory:view', 'kpi:view', 'control:view', 'tote:manage', 'sim:run', 'floor:view_all'
  ],
  MANAGER: [
    'config:view', 'config:weights', 'order:view', 'order:cancel', 'order:create', 'inventory:view',
    'mission:reassign', 'exception:view', 'exception:resolve', 'count:request', 'relocate:request',
    'adjust:approve', 'po:create', 'po:view', 'reslot:simulate', 'reslot:approve', 'dispatch:view',
    'dispatch:regen_otp', 'kpi:view', 'control:view', 'shift:note', 'audit:view', 'trace:view', 'sim:run',
    'floor:view_all', 'rtv:view'
  ],
  OPERATOR: [
    'inbound:receive', 'putaway:execute', 'relocate:execute', 'count:execute', 'adjust:request',
    'damage:flag', 'exception:raise', 'floortask:claim', 'inventory:view', 'po:view', 'rtv:view'
  ],
  PICKER: [
    'mission:claim', 'pick:execute', 'putback:execute', 'exception:raise', 'floortask:claim_pick'
  ],
  STAFF: [
    'pack:execute', 'repick:request', 'exception:raise', 'dispatch:view'
  ],
  DISPATCH: [
    'dispatch:handover', 'dispatch:view'
  ],
  AUDITOR: [
    'audit:view', 'audit:verify', 'audit:export', 'order:view', 'inventory:view', 'kpi:view',
    'control:view', 'trace:view', 'exception:view', 'po:view', 'rtv:view', 'dispatch:view'
  ]
};

export function can(user: { permissions?: readonly string[]; role?: Role }, perm: string): boolean {
  if (!user) return false;
  if (user.permissions && Array.isArray(user.permissions)) {
    return user.permissions.includes(perm);
  }
  if (user.role && ROLE_PERMISSIONS[user.role]) {
    return ROLE_PERMISSIONS[user.role].includes(perm);
  }
  return false;
}
