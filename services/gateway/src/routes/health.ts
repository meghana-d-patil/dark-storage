import { Router } from 'express';
import { config } from '../config.js';

export const healthRouter = Router();

// Liveness
healthRouter.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gateway' });
});

// Aggregated health check
healthRouter.get('/api/health', async (req, res) => {
  async function checkService(url: string): Promise<'ok' | 'down'> {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000);
      const resp = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(id);
      return resp.ok ? 'ok' : 'down';
    } catch {
      return 'down';
    }
  }

  const [e1, e2, e3] = await Promise.all([
    checkService(config.ENGINE1_URL),
    checkService(config.ENGINE2_URL),
    checkService(config.ENGINE3_URL)
  ]);

  res.json({
    gateway: 'ok',
    engine1: e1,
    engine2: e2,
    engine3: e3
  });
});
