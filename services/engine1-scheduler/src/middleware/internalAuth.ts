import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export function internalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers['x-internal-token'];
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();

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

  next();
}
