import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { loginRequestSchema, Role, ROLE_PERMISSIONS } from '@dark-storage/shared';
import { config } from '../config.js';
import { callEngine3 } from '../clients/engine3.js';
import { authMiddleware } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.post('/api/auth/login', async (req, res, next) => {
  try {
    const { username, password } = loginRequestSchema.parse(req.body);

    const { data: user } = await callEngine3<{
      id: number;
      username: string;
      display_name: string;
      role: string;
    }>({
      method: 'POST',
      path: '/internal/v1/auth/verify',
      body: { username, password },
      requestId: req.requestId
    });

    const token = jwt.sign(
      {
        sub: user.id,
        role: user.role,
        name: user.display_name
      },
      config.JWT_SECRET,
      { expiresIn: '8h' }
    );

    const permissions = ROLE_PERMISSIONS[user.role as Role] || [];

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role
      },
      permissions
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/api/auth/dev-switch', async (req, res, next) => {
  try {
    if (!config.DEMO_MODE || config.NODE_ENV === 'production') {
      res.status(404).json({ error: 'Dev switch disabled', code: 'NOT_FOUND' });
      return;
    }

    const { username } = req.body;
    if (!username) {
      res.status(400).json({ error: 'Username required', code: 'VALIDATION_ERROR' });
      return;
    }

    const { data: user } = await callEngine3<{
      id: number;
      username: string;
      display_name: string;
      role: string;
    }>({
      method: 'POST',
      path: '/internal/v1/auth/dev-lookup',
      body: { username },
      requestId: req.requestId
    });

    const token = jwt.sign(
      {
        sub: user.id,
        role: user.role,
        name: user.display_name
      },
      config.JWT_SECRET,
      { expiresIn: '8h' }
    );

    const permissions = ROLE_PERMISSIONS[user.role as Role] || [];

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role
      },
      permissions
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/api/auth/me', authMiddleware, (req, res) => {
  const permissions = ROLE_PERMISSIONS[req.user!.role as Role] || [];
  res.json({
    id: req.user!.id,
    display_name: req.user!.name,
    role: req.user!.role,
    user: {
      id: req.user!.id,
      username: req.user!.name,
      display_name: req.user!.name,
      role: req.user!.role
    },
    permissions
  });
});
