import { Router } from 'express';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { DomainError, loginRequestSchema } from '@dark-storage/shared';

export function createAuthRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/internal/v1/auth/verify', (req, res, next) => {
    try {
      const { username, password } = loginRequestSchema.parse(req.body);

      const user = db.prepare(`
        SELECT id, username, display_name, password_hash, role, active
        FROM users
        WHERE username = ? COLLATE NOCASE
      `).get(username) as {
        id: number;
        username: string;
        display_name: string;
        password_hash: string;
        role: string;
        active: number;
      } | undefined;

      if (!user || user.active !== 1) {
        throw new DomainError('UNAUTHENTICATED', 'Invalid username or password');
      }

      const match = bcrypt.compareSync(password, user.password_hash);
      if (!match) {
        throw new DomainError('UNAUTHENTICATED', 'Invalid username or password');
      }

      res.json({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/internal/v1/auth/dev-lookup', (req, res, next) => {
    try {
      const { username } = req.body;
      const user = db.prepare(`
        SELECT id, username, display_name, role, active
        FROM users
        WHERE username = ? COLLATE NOCASE
      `).get(username) as {
        id: number;
        username: string;
        display_name: string;
        role: string;
        active: number;
      } | undefined;

      if (!user || user.active !== 1) {
        throw new DomainError('NOT_FOUND', 'User not found or inactive');
      }

      res.json({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
