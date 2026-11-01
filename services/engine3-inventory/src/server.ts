import express, { Express } from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { openDb } from './db/connection.js';
import { purgeOldIdempotencyKeys } from './domain/idempotency.js';
import { internalAuth } from './middleware/internalAuth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { createAuthRouter } from './routes/auth.js';
import { createProductsRouter } from './routes/products.js';
import { createIntegrityRouter } from './routes/integrity.js';
import { createInventoryRouter } from './routes/inventory.js';
import { createWarehouseRouter } from './routes/warehouse.js';
import { createReceiptsRouter } from './routes/receipts.js';
import { createCommandsRouter } from './routes/commands.js';
import { createPutawaysRouter } from './routes/putaways.js';

export function createApp(db: Database.Database): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Public health check
  app.use(healthRouter);

  // Protected internal routes
  app.use(internalAuth);
  app.use(createAuthRouter(db));
  app.use(createProductsRouter(db));
  app.use(createIntegrityRouter(db));
  app.use('/internal/v1/inventory', createInventoryRouter(db));
  app.use('/internal/v1/warehouse', createWarehouseRouter(db));
  app.use('/internal/v1/receipts', createReceiptsRouter(db));
  app.use(createCommandsRouter(db));
  app.use('/internal/v1/putaways', createPutawaysRouter(db));

  // Error handler
  app.use(errorHandler);

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('services/engine3-inventory/src/server.ts')) {
  fs.mkdirSync(path.dirname(config.WAREHOUSE_DB_PATH), { recursive: true });
  const db = openDb(config.WAREHOUSE_DB_PATH);

  try {
    const purged = purgeOldIdempotencyKeys(db);
    if (purged > 0) {
      console.log(`Purged ${purged} expired idempotency keys on startup.`);
    }
  } catch (e) {
    console.warn('Could not purge idempotency keys on startup:', e);
  }

  const app = createApp(db);
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`Engine 3 (Inventory) listening on http://${config.HOST}:${config.PORT}`);
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
