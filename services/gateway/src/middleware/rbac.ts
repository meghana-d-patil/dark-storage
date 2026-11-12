import { Request, Response, NextFunction } from 'express';
import { DomainError, Role, can } from '@dark-storage/shared';

export function rbacMiddleware(allowedRoles: Role[]): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new DomainError('UNAUTHENTICATED', 'Authentication required');
    }

    if (!allowedRoles.includes(req.user.role as Role)) {
      throw new DomainError('FORBIDDEN', `Role ${req.user.role} not permitted for this action`);
    }

    next();
  };
}

export function requirePerm(perm: string | string[]): (req: Request, res: Response, next: NextFunction) => void {
  const perms = Array.isArray(perm) ? perm : [perm];
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new DomainError('UNAUTHENTICATED', 'Authentication required');
    }

    const actor = {
      role: req.user.role as Role,
      permissions: (req.user as any).permissions
    };

    const hasAny = perms.some((p) => can(actor, p));
    if (!hasAny) {
      throw new DomainError('FORBIDDEN', `Permission '${perms.join(' or ')}' required for this action`, {
        required: perms,
        userRole: req.user.role
      });
    }

    next();
  };
}
