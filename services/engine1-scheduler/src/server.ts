import express, { Express } from 'express';
import path from 'node:path';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { internalAuth } from './middleware/internalAuth.js';

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(healthRouter);
  app.use(internalAuth);

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('services/engine1-scheduler/src/server.ts')) {
  const app = createApp();
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`Engine 1 (Scheduler) listening on http://${config.HOST}:${config.PORT}`);
  });

  const cleanup = () => {
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}
