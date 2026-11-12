import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { DomainError } from '@dark-storage/shared';
import { config } from '../config.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new DomainError('UNAUTHENTICATED', 'Missing or invalid Authorization header');
  }

  const token = authHeader.substring(7).trim();
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as {
      sub: string | number;
      role: string;
      name: string;
      username?: string;
      zones?: string[];
    };

    req.user = {
      id: Number(decoded.sub),
      role: decoded.role,
      name: decoded.name,
      username: decoded.username || decoded.name,
      zones: decoded.zones || []
    };
    next();
  } catch (err) {
    throw new DomainError('UNAUTHENTICATED', 'Invalid or expired token');
  }
}
