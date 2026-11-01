import express, { Express } from 'express';
import cors from 'cors';
import path from 'node:path';
import { config } from './config.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { productsRouter } from './routes/products.js';
import { inventoryRouter } from './routes/inventory.js';
import { warehouseRouter } from './routes/warehouse.js';
import { receiptsRouter } from './routes/receipts.js';
import { placementRouter } from './routes/placement.js';

export function createApp(): Express {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use(healthRouter);
  app.use(authRouter);
  app.use(productsRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/warehouse', warehouseRouter);
  app.use('/api/receipts', receiptsRouter);
  app.use('/api/placement', placementRouter);

  // Unknown route handler
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.path} not found`,
        request_id: req.requestId
      }
    });
  });

  app.use(errorHandler);

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('services/gateway/src/server.ts')) {
  const app = createApp();
  const server = app.listen(config.GATEWAY_PORT, () => {
    console.log(`Gateway listening on http://localhost:${config.GATEWAY_PORT}`);
  });

  const cleanup = () => {
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}
