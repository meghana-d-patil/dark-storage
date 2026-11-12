import Database from 'better-sqlite3';
import { sweepExpiredLeases } from './leaseSweep.js';
import { sweepEscalations } from './escalation.js';

export interface BackgroundJob {
  name: string;
  intervalMs: number;
  run: (db: Database.Database) => void | Promise<void>;
}

export function startBackgroundJobs(db: Database.Database): () => void {
  const jobs: BackgroundJob[] = [
    {
      name: 'lease_sweep',
      intervalMs: 15_000,
      run: (database) => {
        sweepExpiredLeases(database);
      },
    },
    {
      name: 'escalation_sweep',
      intervalMs: 60_000,
      run: (database) => {
        sweepEscalations(database);
      },
    },
  ];

  const intervals: NodeJS.Timeout[] = [];

  for (const job of jobs) {
    const handle = setInterval(() => {
      try {
        job.run(db);
      } catch (err) {
        console.error(`[Job ${job.name}] Error during periodic execution:`, err);
      }
    }, job.intervalMs);

    intervals.push(handle);
  }

  // Return a cleanup/stop function
  return () => {
    for (const h of intervals) {
      clearInterval(h);
    }
  };
}
