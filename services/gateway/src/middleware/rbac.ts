import { Request, Response, NextFunction } from 'express';
import { DomainError, Role } from '@dark-storage/shared';

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
