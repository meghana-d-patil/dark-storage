import net from 'node:net';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import Database from 'better-sqlite3';
import { createTempDbPaths, TempDbPaths } from './tempDb.js';
import { applyMigrations } from '../../scripts/migrate.js';
import { seedBase } from '../../scripts/seed-base.js';

export interface StackUrls {
  gateway: string;
  engine1: string;
  engine2: string;
  engine3: string;
}

export interface RunningStack {
  urls: StackUrls;
  tempDb: TempDbPaths;
  stop: () => Promise<void>;
  kill: (name: 'gateway' | 'engine1' | 'engine2' | 'engine3') => Promise<void>;
  restart: (name: 'gateway' | 'engine1' | 'engine2' | 'engine3') => Promise<void>;
}

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Failed to get free port')));
        return;
      }
      const port = addr.port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function waitForHealth(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timeout waiting for health at ${url}`);
}

export async function startStack(options: { seed?: boolean } = {}): Promise<RunningStack> {
  const tempDb = createTempDbPaths();

  // Run migrations
  const wDb = new Database(tempDb.warehouseDbPath);
  wDb.pragma('journal_mode = WAL');
  wDb.pragma('foreign_keys = ON');
  applyMigrations(wDb, path.resolve('migrations/warehouse'));

  if (options.seed) {
    seedBase(wDb);
  }
  wDb.close();

  const sDb = new Database(tempDb.schedulerDbPath);
  sDb.pragma('journal_mode = WAL');
  sDb.pragma('foreign_keys = ON');
  applyMigrations(sDb, path.resolve('migrations/scheduler'));
  sDb.close();

  const gwPort = await getFreePort();
  const e1Port = await getFreePort();
  const e2Port = await getFreePort();
  const e3Port = await getFreePort();

  const internalToken = 'test-internal-token-' + Math.random().toString(36).slice(2);
  const jwtSecret = 'test-jwt-secret-' + Math.random().toString(36).slice(2);

  const processes: Record<string, ChildProcess | null> = {};
  const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
  const isWin = process.platform === 'win32';

  function spawnService(name: 'gateway' | 'engine1' | 'engine2' | 'engine3') {
    let scriptPath = '';
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'test',
      INTERNAL_TOKEN: internalToken,
      JWT_SECRET: jwtSecret,
      WAREHOUSE_DB_PATH: tempDb.warehouseDbPath,
      SCHEDULER_DB_PATH: tempDb.schedulerDbPath
    };

    if (name === 'engine3') {
      scriptPath = 'services/engine3-inventory/src/server.ts';
      env.ENGINE3_PORT = e3Port.toString();
      env.PORT = e3Port.toString();
    } else if (name === 'engine2') {
      scriptPath = 'services/engine2-optimizer/src/server.ts';
      env.ENGINE2_PORT = e2Port.toString();
      env.PORT = e2Port.toString();
    } else if (name === 'engine1') {
      scriptPath = 'services/engine1-scheduler/src/server.ts';
      env.ENGINE1_PORT = e1Port.toString();
      env.PORT = e1Port.toString();
      env.ENGINE3_URL = `http://127.0.0.1:${e3Port}`;
    } else if (name === 'gateway') {
      scriptPath = 'services/gateway/src/server.ts';
      env.GATEWAY_PORT = gwPort.toString();
      env.PORT = gwPort.toString();
      env.ENGINE1_URL = `http://127.0.0.1:${e1Port}`;
      env.ENGINE2_URL = `http://127.0.0.1:${e2Port}`;
      env.ENGINE3_URL = `http://127.0.0.1:${e3Port}`;
    }

    const cp = spawn(process.execPath, [tsxCli, path.resolve(scriptPath)], {
      env,
      stdio: 'pipe'
    });

    cp.stderr?.on('data', (data) => {
      process.stderr.write(`[${name} stderr] ${data}`);
    });

    processes[name] = cp;
  }

  // Spawn all 4 backend services
  spawnService('engine3');
  spawnService('engine2');
  spawnService('engine1');
  spawnService('gateway');

  const urls: StackUrls = {
    gateway: `http://127.0.0.1:${gwPort}`,
    engine1: `http://127.0.0.1:${e1Port}`,
    engine2: `http://127.0.0.1:${e2Port}`,
    engine3: `http://127.0.0.1:${e3Port}`
  };

  // Wait for health
  await Promise.all([
    waitForHealth(urls.engine3),
    waitForHealth(urls.engine2),
    waitForHealth(urls.engine1),
    waitForHealth(urls.gateway)
  ]);

  return {
    urls,
    tempDb,
    stop: async () => {
      for (const name of Object.keys(processes)) {
        const cp = processes[name];
        if (cp && !cp.killed) {
          try {
            if (isWin && cp.pid) {
              spawn('taskkill', ['/pid', cp.pid.toString(), '/f', '/t']);
            } else {
              cp.kill('SIGKILL');
            }
          } catch {
            // ignore
          }
        }
      }
      // Wait a moment for OS handles to release before removing temp dir
      await new Promise((r) => setTimeout(r, 200));
      tempDb.cleanup();
    },
    kill: async (name) => {
      const cp = processes[name];
      if (cp && !cp.killed) {
        if (isWin && cp.pid) {
          spawn('taskkill', ['/pid', cp.pid.toString(), '/f', '/t']);
        } else {
          cp.kill('SIGKILL');
        }
        processes[name] = null;
      }
    },
    restart: async (name) => {
      spawnService(name);
      await waitForHealth(urls[name]);
    }
  };
}
