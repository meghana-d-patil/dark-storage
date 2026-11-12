import { useAuthStore } from '../stores/authStore.js';
import { can, Role } from '@dark-storage/shared';

export function useCan(perm: string | string[]): boolean {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);

  if (!user) return false;

  const actor = {
    role: user.role as Role,
    permissions
  };

  const perms = Array.isArray(perm) ? perm : [perm];
  return perms.some((p) => can(actor, p));
}
