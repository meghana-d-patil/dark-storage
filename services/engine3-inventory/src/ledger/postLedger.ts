import Database from 'better-sqlite3';
import { nextRef } from '../domain/ids.js';

export type EntryType =
  | 'OPENING'
  | 'RECEIVE'
  | 'RECEIVE_REJECT'
  | 'PUTAWAY'
  | 'PICK'
  | 'PACK'
  | 'STAGE_DISPATCH'
  | 'HANDOVER'
  | 'PUTBACK'
  | 'RELOCATE'
  | 'REPLENISH'
  | 'QUARANTINE'
  | 'QUARANTINE_RELEASE'
  | 'WRITE_OFF'
  | 'ADJUST_IN'
  | 'ADJUST_OUT'
  | 'RTV'
  | 'EXPIRE';

export interface LedgerLine {
  sku: string;
  lotId: string;
  qty: number;
  from: string;
  to: string;
  type: EntryType;
  refType?: string;
  refId?: string;
  orderRef?: string;
  reasonCode?: string;
  note?: string;
}

export interface LedgerEntry {
  id: number;
  entryRef: string;
  ts: string;
  sku: string;
  lotId: string;
  qty: number;
  fromLoc: string;
  toLoc: string;
  entryType: EntryType;
  refType?: string | null;
  refId?: string | null;
  orderRef?: string | null;
  actorId?: string | null;
  reasonCode?: string | null;
  note?: string | null;
}

export interface PostLedgerOptions {
  projection?: boolean;
}

export interface LotInput {
  lotId: string;
  sku: string;
  lotCode?: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
  poRef?: string | null;
  supplier?: string | null;
}

export function ensureLot(db: Database.Database, lot: LotInput): void {
  db.prepare(`
    INSERT INTO lots (lot_id, sku, lot_code, mfg_date, expiry_date, po_ref, supplier)
    VALUES (@lotId, @sku, @lotCode, @mfgDate, @expiryDate, @poRef, @supplier)
    ON CONFLICT(lot_id) DO NOTHING
  `).run({
    lotId: lot.lotId,
    sku: lot.sku,
    lotCode: lot.lotCode || null,
    mfgDate: lot.mfgDate || null,
    expiryDate: lot.expiryDate || null,
    poRef: lot.poRef || null,
    supplier: lot.supplier || null,
  });
}

export function reserveStock(db: Database.Database, binCode: string, qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error('Quantity must be a positive integer');
  }

  const res = db
    .prepare(
      `
    UPDATE inventory
    SET reserved_qty = reserved_qty + @q,
        updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    WHERE bin_code = @bin AND (qty - reserved_qty) >= @q
  `
    )
    .run({ q: qty, bin: binCode });

  if (res.changes === 0) {
    throw new Error('Not enough unreserved stock to reserve');
  }
}

export function releaseStock(db: Database.Database, binCode: string, qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error('Quantity must be a positive integer');
  }

  const res = db
    .prepare(
      `
    UPDATE inventory
    SET reserved_qty = reserved_qty - @q,
        updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    WHERE bin_code = @bin AND reserved_qty >= @q
  `
    )
    .run({ q: qty, bin: binCode });

  if (res.changes === 0) {
    throw new Error('Cannot release more than reserved quantity');
  }
}

export function postLedger(
  db: Database.Database,
  lines: LedgerLine[],
  actor: { id: string },
  options: PostLedgerOptions = {}
): LedgerEntry[] {
  // Rule 1: must be called inside an open write transaction (throw if !db.inTransaction)
  if (!db.inTransaction) {
    throw new Error('postLedger must be called inside an open transaction');
  }

  if (!lines || lines.length === 0) {
    return [];
  }

  // Rule 2: validates qty is a positive integer, and fields
  for (const line of lines) {
    if (!line.qty || !Number.isInteger(line.qty) || line.qty <= 0) {
      throw new Error(`LedgerLine qty must be a positive integer, got: ${line.qty}`);
    }
    if (!line.sku || typeof line.sku !== 'string') {
      throw new Error('LedgerLine sku is required');
    }
    if (!line.lotId || typeof line.lotId !== 'string') {
      throw new Error('LedgerLine lotId is required');
    }
    if (!line.from || typeof line.from !== 'string') {
      throw new Error('LedgerLine from is required');
    }
    if (!line.to || typeof line.to !== 'string') {
      throw new Error('LedgerLine to is required');
    }
    if (line.from === line.to) {
      throw new Error(`LedgerLine from and to locations must be different: ${line.from}`);
    }
  }

  // Rule 3: collects all location keys, sorts them, and touches them in that order (lock ordering, D19)
  const allLocations = Array.from(new Set(lines.flatMap(l => [l.from, l.to]))).sort();

  // Rule 4: inserts entries (the trigger updates balances and rejects negatives)
  const insertStmt = db.prepare(`
    INSERT INTO ledger_entries (
      entry_ref, ts, sku, lot_id, qty, from_loc, to_loc, entry_type,
      ref_type, ref_id, order_ref, actor_id, reason_code, note
    ) VALUES (
      @entry_ref, @ts, @sku, @lot_id, @qty, @from_loc, @to_loc, @entry_type,
      @ref_type, @ref_id, @order_ref, @actor_id, @reason_code, @note
    )
    RETURNING id, entry_ref, ts, sku, lot_id, qty, from_loc, to_loc, entry_type,
              ref_type, ref_id, order_ref, actor_id, reason_code, note
  `);

  const results: LedgerEntry[] = [];
  const now = new Date().toISOString();

  for (const line of lines) {
    const entryRef = nextRef(db, 'LED');
    const row = insertStmt.get({
      entry_ref: entryRef,
      ts: now,
      sku: line.sku,
      lot_id: line.lotId,
      qty: line.qty,
      from_loc: line.from,
      to_loc: line.to,
      entry_type: line.type,
      ref_type: line.refType || null,
      ref_id: line.refId || null,
      order_ref: line.orderRef || null,
      actor_id: actor.id || null,
      reason_code: line.reasonCode || null,
      note: line.note || null,
    }) as any;

    results.push({
      id: row.id,
      entryRef: row.entry_ref,
      ts: row.ts,
      sku: row.sku,
      lotId: row.lot_id,
      qty: row.qty,
      fromLoc: row.from_loc,
      toLoc: row.to_loc,
      entryType: row.entry_type,
      refType: row.ref_type,
      refId: row.ref_id,
      orderRef: row.order_ref,
      actorId: row.actor_id,
      reasonCode: row.reason_code,
      note: row.note,
    });
  }

  // Rule 5: for every BIN: key it touched, updates the projection: inventory row for that bin
  if (options.projection !== false) {
    const touchedBins = allLocations
      .filter(loc => loc.startsWith('BIN:'))
      .map(loc => loc.slice(4))
      .sort();

    const sumStmt = db.prepare(`
      SELECT
        COALESCE(SUM(qty), 0) AS total_qty,
        MAX(sku) AS sku,
        MAX(lot_id) AS lot_id
      FROM location_balances
      WHERE location_key = ? AND qty > 0
    `);

    const upsertInvStmt = db.prepare(`
      INSERT INTO inventory (bin_code, sku, qty, reserved_qty, lot_id, updated_at)
      VALUES (@bin_code, @sku, @qty, 0, @lot_id, @updated_at)
      ON CONFLICT(bin_code) DO UPDATE SET
        qty = excluded.qty,
        sku = excluded.sku,
        lot_id = excluded.lot_id,
        reserved_qty = CASE WHEN excluded.qty = 0 THEN 0 ELSE MIN(inventory.reserved_qty, excluded.qty) END,
        updated_at = excluded.updated_at
    `);

    // Check if bins table has current_qty or current_sku
    const hasCurrentQty = db.prepare("SELECT 1 FROM pragma_table_info('bins') WHERE name = 'current_qty'").get();
    const updateBinStmt = hasCurrentQty
      ? db.prepare(`UPDATE bins SET current_qty = @qty, current_sku = @sku WHERE code = @bin_code`)
      : null;

    for (const binCode of touchedBins) {
      const locKey = `BIN:${binCode}`;
      const bal = sumStmt.get(locKey) as { total_qty: number; sku: string | null; lot_id: string | null } | undefined;
      const totalQty = bal ? bal.total_qty : 0;
      const binSku = totalQty > 0 && bal ? bal.sku : null;
      const binLot = totalQty > 0 && bal ? bal.lot_id : null;

      upsertInvStmt.run({
        bin_code: binCode,
        sku: binSku,
        qty: totalQty,
        lot_id: binLot,
        updated_at: now,
      });

      if (updateBinStmt) {
        updateBinStmt.run({
          bin_code: binCode,
          qty: totalQty,
          sku: binSku,
        });
      }
    }
  }

  // Rule 6: returns entries
  return results;
}

export function reconcileLedger(db: Database.Database): {
  ok: boolean;
  drift_count: number;
  drifts: Array<{ binCode: string; sku: string; ledger_qty: number; proj_qty: number; delta: number }>;
} {
  const mismatches = db
    .prepare(
      `
    WITH ledger_bins AS (
      SELECT
        substr(location_key, 5) AS bin_code,
        sku,
        SUM(qty) AS ledger_qty
      FROM location_balances
      WHERE location_key GLOB 'BIN:*'
      GROUP BY location_key, sku
      HAVING SUM(qty) <> 0
    ),
    inv_bins AS (
      SELECT
        bin_code,
        sku,
        qty AS proj_qty
      FROM inventory
      WHERE qty > 0 AND sku IS NOT NULL
    ),
    all_keys AS (
      SELECT bin_code, sku FROM ledger_bins
      UNION
      SELECT bin_code, sku FROM inv_bins
    )
    SELECT
      k.bin_code AS binCode,
      k.sku,
      COALESCE(l.ledger_qty, 0) AS ledger_qty,
      COALESCE(i.proj_qty, 0) AS proj_qty,
      (COALESCE(i.proj_qty, 0) - COALESCE(l.ledger_qty, 0)) AS delta
    FROM all_keys k
    LEFT JOIN ledger_bins l ON k.bin_code = l.bin_code AND k.sku = l.sku
    LEFT JOIN inv_bins i ON k.bin_code = i.bin_code AND k.sku = i.sku
    WHERE COALESCE(l.ledger_qty, 0) <> COALESCE(i.proj_qty, 0)
  `
    )
    .all() as Array<{
    binCode: string;
    sku: string;
    ledger_qty: number;
    proj_qty: number;
    delta: number;
  }>;

  return {
    ok: mismatches.length === 0,
    drift_count: mismatches.length,
    drifts: mismatches,
  };
}
