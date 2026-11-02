import { z } from 'zod';

export const packOrderSchema = z.object({
  notes: z.string().max(300).optional().nullable(),
  accept_partial: z.boolean().optional().default(false)
});

export type PackOrderInput = z.infer<typeof packOrderSchema>;

export interface PackingQueueLineDto {
  sku: string;
  product_name: string;
  qty_ordered: number;
  qty_picked: number;
  qty_short: number;
}

export interface PackingQueueExceptionDto {
  ref: string;
  type: string;
  resolution: string | null;
  notes: string | null;
}

export interface PackingQueueItemDto {
  order_ref: string;
  customer_ref: string | null;
  priority: string;
  mission_ref: string | null;
  lines: PackingQueueLineDto[];
  total_ordered: number;
  total_picked: number;
  total_short: number;
  fulfilment_preview: 'FULL' | 'PARTIAL';
  needs_manager_approval: boolean;
  exceptions: PackingQueueExceptionDto[];
}

export interface PackingResultDto {
  packing_ref: string;
  order_ref: string;
  fulfilment_type: 'FULL' | 'PARTIAL';
  total_ordered: number;
  total_picked: number;
  packed_by: number;
  packed_at: string;
}

export const auditQuerySchema = z.object({
  entity_type: z.string().optional(),
  entity_id: z.string().optional(),
  actor: z.string().optional(),
  action: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25)
});

export type AuditQueryInput = z.infer<typeof auditQuerySchema>;

export interface AuditItemDto {
  id: number;
  at: string;
  actor: string;
  role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: any;
}

export interface DashboardDto {
  generated_at: string;
  receiving: {
    receipts_today: number;
    units_received_today: number;
    staged_units: number;
    staged_lines: number;
  };
  inventory: {
    stored_units: number;
    reserved_units: number;
    available_units: number;
    unavailable_units: number;
    occupied_bins: number;
    total_bins: number;
    fill_pct: number;
  };
  orders: {
    reserved: number;
    assigned: number;
    picking: number;
    picked: number;
    completed_today: number;
    cancelled_today: number;
    completed_total: number;
  };
  missions: {
    assigned: number;
    in_progress: number;
    completed_today: number;
  };
  exceptions: {
    open: number;
  };
  movements: {
    today: {
      RECEIVE: number;
      PUTAWAY: number;
      PICK: number;
      RELOCATE: number;
      ADJUSTMENT: number;
    };
    latest: Array<{
      ref: string;
      type: string;
      sku: string;
      product_name: string;
      qty: number;
      from_label: string;
      to_label: string;
      created_at: string;
    }>;
  };
  engine: {
    queued_tasks: number;
    running_tasks: number;
    failed_tasks_24h: number;
  } | null;
}
