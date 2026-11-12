import { Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { Role, ROLE_PERMISSIONS, can, AppError } from '@dark-storage/shared';
import './internalAuth.js';

export function createActorFromHeaders(db: Database.Database) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const actorIdHeader = req.headers['x-actor-id'];
    const actorRoleHeader = req.headers['x-actor-role'];

    if (!actorIdHeader) {
      req.actor = null;
      return next();
    }

    const userId = parseInt(actorIdHeader as string, 10);
    if (isNaN(userId)) {
      req.actor = null;
      return next();
    }

    const userRow = db.prepare('SELECT id, username, role, active FROM users WHERE id = ?').get(userId) as {
      id: number;
      username: string;
      role: Role;
      active: number;
    } | undefined;

    if (!userRow || userRow.active === 0) {
      throw new AppError('FORBIDDEN', 403, 'Inactive or unknown user', { userId });
    }

    const role = (userRow.role || actorRoleHeader) as Role;
    const permissions = ROLE_PERMISSIONS[role] || [];

    req.actor = {
      id: userRow.id,
      username: userRow.username,
      role,
      permissions
    };

    next();
  };
}

export function requirePerm(perm: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.actor) {
      throw new AppError('AUTH_REQUIRED', 401, 'Authentication required');
    }
    if (!can(req.actor, perm)) {
      throw new AppError('FORBIDDEN', 403, `Permission denied: required '${perm}'`, { required: perm });
    }
    next();
  };
}
