import express, { Express } from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { internalAuth } from './middleware/internalAuth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createPlacementRouter } from './routes/placement.js';
import { createRoutingRouter } from './routes/routing.js';

export function createApp(db: Database.Database): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(healthRouter);
  app.use(internalAuth);
  app.use('/internal/v1/placement', createPlacementRouter(db));
  app.use('/internal/v1/routes', createRoutingRouter(db));
  app.use(errorHandler);

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('services/engine2-optimizer/src/server.ts')) {
  const db = new Database(config.WAREHOUSE_DB_PATH, { readonly: true });
  db.pragma('busy_timeout = 5000');

  const app = createApp(db);
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`Engine 2 (Optimizer) listening on http://${config.HOST}:${config.PORT}`);
  });

  const cleanup = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}
