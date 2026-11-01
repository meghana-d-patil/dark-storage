import { z } from 'zod';
import { EXCEPTION_TYPES, EXCEPTION_RESOLUTIONS, ExceptionType, ExceptionResolution, PickStopStatus } from '../enums.js';

export const confirmPickSchema = z.object({
  scanned_bin: z.string().min(1),
  scanned_sku: z.string().min(1),
  picked_qty: z.number().int().min(1),
  exception: z
    .object({
      type: z.enum(['SHORT_PICK', 'DAMAGED', 'OTHER']),
      notes: z.string().min(3).max(300)
    })
    .optional()
});

export type ConfirmPickInput = z.infer<typeof confirmPickSchema>;

export const reportProblemSchema = z.object({
  type: z.enum(['BIN_EMPTY', 'DAMAGED', 'WRONG_PRODUCT', 'OTHER']),
  notes: z.string().min(3).max(300)
});

export type ReportProblemInput = z.infer<typeof reportProblemSchema>;

export const resolveExceptionSchema = z.object({
  action: z.enum(['REALLOCATE', 'ACCEPT_SHORT']),
  notes: z.string().min(3).max(300).optional(),
  recount: z
    .object({
      counted_qty: z.number().int().min(0)
    })
    .optional()
});

export type ResolveExceptionInput = z.infer<typeof resolveExceptionSchema>;

export const exceptionQuerySchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED']).optional(),
  mission: z.string().optional(),
  mission_id: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25)
});

export type ExceptionQueryInput = z.infer<typeof exceptionQuerySchema>;

export interface PickExceptionDto {
  id: number;
  ref: string;
  mission_id: number;
  mission_ref: string;
  order_id: number;
  order_ref: string;
  stop_id: number;
  stop_ref: string;
  bin_code: string;
  sku: string;
  product_name: string;
  type: ExceptionType;
  expected_qty: number;
  actual_qty: number;
  notes: string | null;
  reported_by: {
    id: number;
    name: string;
  };
  reported_at: string;
  status: 'OPEN' | 'RESOLVED';
  resolution: ExceptionResolution | null;
  resolved_by?: {
    id: number;
    name: string;
  } | null;
  resolved_at?: string | null;
  resolution_notes?: string | null;
}

export interface PickConfirmationResultDto {
  stop: {
    id: number;
    stop_ref: string;
    seq: number;
    bin_code: string;
    sku: string;
    qty_required: number;
    qty_picked: number;
    status: PickStopStatus;
    confirmed_at: string | null;
  };
  mission_progress: {
    total_stops: number;
    finished_stops: number;
    open_exceptions: number;
    units_required: number;
    units_picked: number;
  };
  order_status: string;
  exception?: PickExceptionDto | null;
}
