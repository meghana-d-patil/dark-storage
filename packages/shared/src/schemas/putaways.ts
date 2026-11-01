import { z } from 'zod';

export const createPutawaySchema = z.object({
  receipt_line_id: z.number().int().positive(),
  dest_bin: z.string().min(1),
  qty: z.number().int().positive(),
  recommended_bin: z.string().optional()
});

export type CreatePutawayInput = z.infer<typeof createPutawaySchema>;

export const relocateSchema = z.object({
  from_bin: z.string().min(1),
  to_bin: z.string().min(1),
  qty: z.number().int().positive()
});

export type RelocateInput = z.infer<typeof relocateSchema>;

export interface PutawayDetail {
  ref: string;
  receipt_ref: string;
  receipt_line_id: number;
  sku: string;
  product_name: string;
  qty: number;
  source: string;
  dest_shelf: string;
  dest_bin: string;
  selection_mode: 'RECOMMENDED' | 'MANUAL';
  movement_ref: string;
  performed_by: string;
  status: 'COMPLETED';
  created_at: string;
  line_remaining_staged: number;
  receipt_status: string;
}
