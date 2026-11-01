import Database from 'better-sqlite3';
import { stockIn, recordMovement } from '../../services/engine3-inventory/src/domain/inventoryRepo.js';
import { nextRef } from '../../services/engine3-inventory/src/domain/ids.js';

export interface SeedBinStockArgs {
  bin: string;
  sku: string;
  qty: number;
  actorId?: number;
}

export function seedBinStock(db: Database.Database, args: SeedBinStockArgs): { movRef: string; adjRef: string } {
  const adjRef = nextRef(db, 'adjustment');

  stockIn(db, {
    bin: args.bin,
    sku: args.sku,
    qty: args.qty
  });

  const movRef = recordMovement(db, {
    type: 'ADJUSTMENT',
    sku: args.sku,
    qty: args.qty,
    from: { kind: 'ADJUSTMENT', ref: adjRef },
    to: { kind: 'BIN', ref: args.bin },
    related: { type: 'ADJUSTMENT', ref: adjRef },
    actorId: args.actorId || 1
  });

  return { movRef, adjRef };
}
