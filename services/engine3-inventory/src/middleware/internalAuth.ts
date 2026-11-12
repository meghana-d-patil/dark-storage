import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { Role, ROLE_PERMISSIONS } from '@dark-storage/shared';

export interface InternalActor {
  id: number;
  username: string;
  role: Role;
  permissions: readonly string[];
}

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      actor?: InternalActor | null;
    }
  }
}

export function internalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const token = req.headers['x-internal-token'] || bearerToken;
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.requestId = requestId;

  if (!token || token !== config.INTERNAL_TOKEN) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Invalid or missing internal token',
        request_id: requestId
      }
    });
    return;
  }

  const actorIdHeader = req.headers['x-actor-id'];
  const actorRoleHeader = req.headers['x-actor-role'] as Role | undefined;

  if (actorIdHeader && actorRoleHeader) {
    req.actor = {
      id: parseInt(actorIdHeader as string, 10),
      username: (req.headers['x-actor-username'] as string) || `user_${actorIdHeader}`,
      role: actorRoleHeader,
      permissions: ROLE_PERMISSIONS[actorRoleHeader] || []
    };
  } else {
    req.actor = null;
  }

  next();
}
