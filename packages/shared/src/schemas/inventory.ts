import { z } from 'zod';
import { BIN_STATUSES } from '../enums.js';

export const BinStatusUpdateSchema = z.object({
  status: z.enum(BIN_STATUSES),
  reason: z.string().min(3).max(200)
});

export const BinRecountSchema = z.object({
  counted_qty: z.number().int().min(0),
  sku: z.string().optional().nullable(),
  reason: z.string().min(3).max(200)
});

export const InventorySummaryQuerySchema = z.object({
  search: z.string().optional().default(''),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
});

export const InventoryBinsQuerySchema = z.object({
  sku: z.string().optional().default(''),
  shelf: z.string().optional().default(''),
  status: z.string().optional().default(''),
  occupied: z.enum(['true', 'false', '']).optional().default(''),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50)
});

export const InventoryMovementsQuerySchema = z.object({
  sku: z.string().optional().default(''),
  bin: z.string().optional().default(''),
  type: z.string().optional().default(''),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50)
});

export const WarehouseSearchQuerySchema = z.object({
  q: z.string().min(1).max(100)
});

export type BinStatusUpdateInput = z.infer<typeof BinStatusUpdateSchema>;
export type BinRecountInput = z.infer<typeof BinRecountSchema>;
