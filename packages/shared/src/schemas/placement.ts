import { z } from 'zod';

export const RecommendPlacementSchema = z.object({
  receipt_line_id: z.number().int().min(1),
  qty: z.number().int().min(1).optional(),
  include_all: z.boolean().optional().default(false)
});

export const InternalRecommendPlacementSchema = z.object({
  sku: z.string().min(1),
  qty: z.number().int().min(1),
  allow_partial: z.boolean().optional().default(true),
  include_all: z.boolean().optional().default(false),
  max_alternatives: z.number().int().min(1).max(50).optional().default(10)
});

export const ValidatePlacementSchema = z.object({
  dest_bin: z.string().min(1),
  qty: z.number().int().min(1),
  receipt_line_id: z.number().int().min(1).optional(),
  sku: z.string().optional()
}).refine(data => (data.receipt_line_id !== undefined || data.sku !== undefined), {
  message: 'Exactly one of receipt_line_id or sku must be provided'
});

export const InternalValidatePlacementSchema = z.object({
  bin: z.string().min(1),
  sku: z.string().min(1),
  qty: z.number().int().min(1),
  allow_partial: z.boolean().optional().default(true)
});

export type RecommendPlacementInput = z.infer<typeof RecommendPlacementSchema>;
export type ValidatePlacementInput = z.infer<typeof ValidatePlacementSchema>;
export type InternalRecommendPlacementInput = z.infer<typeof InternalRecommendPlacementSchema>;
export type InternalValidatePlacementInput = z.infer<typeof InternalValidatePlacementSchema>;
