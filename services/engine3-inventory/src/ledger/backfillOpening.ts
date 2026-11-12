import Database from 'better-sqlite3';
import { ensureLot, postLedger, LedgerLine } from './postLedger.js';

export function backfillOpeningLedger(db: Database.Database): void {
  // Guard with job_runs check
  const alreadyRun = db
    .prepare("SELECT 1 FROM job_runs WHERE job = 'backfill_opening_ledger' AND status = 'OK'")
    .get();

  if (alreadyRun) {
    return;
  }

  const tx = db.transaction(() => {
    const now = new Date().toISOString();
    const lines: LedgerLine[] = [];

    // 1. Existing inventory rows with qty > 0
    const invRows = db
      .prepare(
        `
      SELECT bin_code, sku, qty, lot_id
      FROM inventory
      WHERE qty > 0 AND sku IS NOT NULL
    `
      )
      .all() as Array<{ bin_code: string; sku: string; qty: number; lot_id: string | null }>;

    for (const row of invRows) {
      const lotId = row.lot_id || `LOT-LEGACY-${row.sku}`;
      ensureLot(db, {
        lotId,
        sku: row.sku,
        lotCode: 'LEGACY',
        supplier: 'INITIAL_BACKFILL',
      });

      if (!row.lot_id) {
        db.prepare(
          `
          UPDATE inventory
          SET lot_id = ?
          WHERE bin_code = ?
        `
        ).run(lotId, row.bin_code);
      }

      lines.push({
        sku: row.sku,
        lotId,
        qty: row.qty,
        from: 'EXT',
        to: `BIN:${row.bin_code}`,
        type: 'OPENING',
        note: 'Initial opening stock backfill',
      });
    }

    // 2. Existing staged receipts not yet put away
    const stagedRows = db
      .prepare(
        `
      SELECT r.ref as receipt_ref, rl.sku, (rl.qty_received - rl.qty_put_away) as remaining_qty
      FROM receipts r
      JOIN receipt_lines rl ON rl.receipt_id = r.id
      WHERE r.status IN ('STAGED', 'PARTIALLY_PUT_AWAY')
        AND (rl.qty_received - rl.qty_put_away) > 0
    `
      )
      .all() as Array<{ receipt_ref: string; sku: string; remaining_qty: number }>;

    for (const s of stagedRows) {
      const lotId = `LOT-LEGACY-${s.sku}`;
      ensureLot(db, {
        lotId,
        sku: s.sku,
        lotCode: 'LEGACY',
        poRef: s.receipt_ref,
        supplier: 'INITIAL_BACKFILL',
      });

      lines.push({
        sku: s.sku,
        lotId,
        qty: s.remaining_qty,
        from: 'EXT',
        to: `STAGED:${s.receipt_ref}`,
        type: 'OPENING',
        refType: 'RECEIPT',
        refId: s.receipt_ref,
        note: 'Initial staged receipt stock backfill',
      });
    }

    // 3. Post to ledger bypassing projection (projection already correct)
    if (lines.length > 0) {
      postLedger(db, lines, { id: 'SYSTEM' }, { projection: false });
    }

    // Record successful job run
    db.prepare(
      `
      INSERT INTO job_runs (job, started_at, finished_at, status, detail)
      VALUES ('backfill_opening_ledger', ?, (strftime('%Y-%m-%dT%H:%M:%fZ','now')), 'OK', ?)
    `
    ).run(now, JSON.stringify({ entriesCreated: lines.length }));
  });

  tx();
}
