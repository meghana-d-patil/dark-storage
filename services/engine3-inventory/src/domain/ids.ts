import Database from 'better-sqlite3';
import { formatRef } from '@dark-storage/shared';

export function nextRef(db: Database.Database, nameOrPrefix: string): string {
  // Try exact sequence name
  let row = db.prepare(`
    UPDATE id_sequences
    SET next_value = next_value + 1
    WHERE name = ?
    RETURNING prefix, (next_value - 1) AS n
  `).get(nameOrPrefix) as { prefix: string; n: number } | undefined;

  if (!row) {
    // If not found, insert sequence on demand using prefix
    const nameKey = nameOrPrefix.toLowerCase();
    const prefix = nameOrPrefix.toUpperCase();

    db.prepare(`
      INSERT OR IGNORE INTO id_sequences (name, prefix, next_value)
      VALUES (?, ?, 1)
    `).run(nameKey, prefix);

    row = db.prepare(`
      UPDATE id_sequences
      SET next_value = next_value + 1
      WHERE name = ?
      RETURNING prefix, (next_value - 1) AS n
    `).get(nameKey) as { prefix: string; n: number } | undefined;
  }

  if (!row) {
    throw new Error(`Sequence not found: ${nameOrPrefix}`);
  }

  return formatRef(row.prefix, row.n);
}
