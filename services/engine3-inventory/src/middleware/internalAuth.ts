import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export interface InternalActor {
  id: number;
  role: string;
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
  const actorRoleHeader = req.headers['x-actor-role'];

  if (actorIdHeader && actorRoleHeader) {
    req.actor = {
      id: parseInt(actorIdHeader as string, 10),
      role: actorRoleHeader as string
    };
  } else {
    req.actor = null;
  }

  next();
}
