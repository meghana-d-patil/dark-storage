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

export function requirePerm(perm: string): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new DomainError('UNAUTHENTICATED', 'Authentication required');
    }

    if (!can({ role: req.user.role as Role }, perm)) {
      throw new DomainError('FORBIDDEN', `Permission '${perm}' required for this action`);
    }

    next();
  };
}

