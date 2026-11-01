import { z } from 'zod';
import { ORDER_TYPES, ORDER_STATUSES, PRIORITIES, FULFILMENT_TYPES, RESERVATION_STATUSES, OrderType, OrderStatus, Priority, FulfilmentType, ReservationStatus } from '../enums.js';

export const createOrderLineSchema = z.object({
  sku: z.string().min(3).max(32),
  qty: z.number().int().min(1).max(10000)
});

export const createOrderSchema = z.object({
  order_type: z.enum(ORDER_TYPES).default('CUSTOMER'),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  customer_ref: z.string().max(80).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  lines: z.array(createOrderLineSchema).min(1).max(50)
}).refine(
  (data) => {
    const skus = new Set(data.lines.map((l) => l.sku.toUpperCase()));
    return skus.size === data.lines.length;
  },
  {
    message: 'Duplicate SKU found in lines',
    path: ['lines']
  }
);

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const cancelOrderSchema = z.object({
  reason: z.string().min(3).max(200)
});

export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export const orderQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25)
});

export type OrderQueryInput = z.infer<typeof orderQuerySchema>;

export interface ReservationDto {
  id: number;
  bin_code: string;
  qty: number;
  consumed_qty: number;
  released_qty: number;
  outstanding: number;
  status: ReservationStatus;
}

export interface OrderLineDto {
  line_no: number;
  sku: string;
  product_name: string;
  qty_ordered: number;
  qty_picked: number;
  qty_short: number;
  reservations: ReservationDto[];
}

export interface OrderSummaryReservation {
  held_units: number;
  consumed_units: number;
  released_units: number;
}

export interface OrderAuditEntry {
  at: string;
  action: string;
  by: string;
  details?: unknown;
}

export interface OrderDto {
  ref: string;
  order_type: OrderType;
  priority: Priority;
  status: OrderStatus;
  customer_ref: string | null;
  notes: string | null;
  requested_by: string;
  created_at: string;
  assigned_picker: { id: number; name: string } | string | null;
  mission_ref: string | null;
  fulfilment_type: FulfilmentType | null;
  cancelled_reason?: string | null;
  lines: OrderLineDto[];
  reservation_summary: OrderSummaryReservation;
  audit: OrderAuditEntry[];
}
