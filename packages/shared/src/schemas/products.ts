import { z } from 'zod';
import { STORAGE_CLASSES } from '../enums.js';

export const productDtoSchema = z.object({
  sku: z.string().min(3).max(32),
  name: z.string().min(1),
  category: z.string(),
  storage_class: z.enum(STORAGE_CLASSES),
  unit: z.string(),
  max_receive_qty: z.number().int().positive(),
  active: z.number().int()
});

export type ProductDto = z.infer<typeof productDtoSchema>;
