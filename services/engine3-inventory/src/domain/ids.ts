import Database from 'better-sqlite3';
import { formatRef } from '@dark-storage/shared';

export type SequenceName =
  | 'receipt'
  | 'putaway'
  | 'order'
  | 'mission'
  | 'movement'
  | 'exception'
  | 'packing'
  | 'adjustment';

export function nextRef(db: Database.Database, name: SequenceName): string {
  const row = db.prepare(`
    UPDATE id_sequences
    SET next_value = next_value + 1
    WHERE name = ?
    RETURNING prefix, (next_value - 1) AS n
  `).get(name) as { prefix: string; n: number } | undefined;

  if (!row) {
    throw new Error(`Sequence not found: ${name}`);
  }

  return formatRef(row.prefix, row.n);
}
