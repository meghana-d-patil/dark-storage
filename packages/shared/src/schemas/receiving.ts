import { z } from 'zod';

export const ReceiptLineInputSchema = z.object({
  sku: z.string().min(1),
  qty: z.number().int().min(1).max(100000)
});

export const CreateReceiptSchema = z.object({
  supplier: z.string().max(80).optional().nullable(),
  reference_no: z.string().max(80).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  received_at: z.string().optional().refine((val) => {
    if (!val) return true;
    const date = new Date(val);
    if (isNaN(date.getTime())) return false;
    const now = Date.now();
    const maxFuture = now + 5 * 60 * 1000;
    return date.getTime() <= maxFuture;
  }, { message: 'received_at cannot be more than 5 minutes in the future' }),
  lines: z.array(ReceiptLineInputSchema).min(1).max(20)
});

export const ReceiptsQuerySchema = z.object({
  status: z.string().optional().default(''),
  search: z.string().optional().default(''),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
});

export type CreateReceiptInput = z.infer<typeof CreateReceiptSchema>;
export type ReceiptLineInput = z.infer<typeof ReceiptLineInputSchema>;
