import { PickerMissionDTO, PickerStopDTO, PickStopStep } from '@dark-storage/shared';

export interface RawStopRow {
  stop_ref: string;
  seq: number;
  bin_code: string;
  aisle?: string | null;
  sku: string;
  product_name: string;
  qty_required: number;
  qty_picked: number;
  step: string;
  tote_code?: string | null;
  order_ref?: string | null;
}

export interface RawMissionRow {
  ref: string;
  status: string;
  lease_expires_at: string | null;
  tote_code: string | null;
  stops: RawStopRow[];
}

export function mapPickStopStep(dbStep: string): PickStopStep {
  switch (dbStep) {
    case 'PENDING':
      return 'SCAN_BIN';
    case 'BIN_OK':
      return 'SCAN_ITEM';
    case 'ITEM_OK':
      return 'SCAN_TOTE';
    case 'DONE':
      return 'DONE';
    case 'SHORT':
      return 'SHORT';
    default:
      return 'SCAN_BIN';
  }
}

export function toPickerStopDTO(row: RawStopRow): PickerStopDTO {
  const step = mapPickStopStep(row.step);
  const qtyToPick = Math.max(0, row.qty_required - (row.qty_picked || 0));

  return {
    stopRef: row.stop_ref,
    seq: row.seq,
    binCode: row.bin_code,
    aisleLabel: row.aisle ? `Aisle ${row.aisle}` : 'Aisle',
    sku: row.sku,
    productName: row.product_name,
    qtyToPick,
    step,
    toteCode: row.tote_code || null,
    orderRef: row.order_ref || undefined,
  };
}

export function toPickerMissionDTO(row: RawMissionRow): PickerMissionDTO {
  const stops = (row.stops || []).map(toPickerStopDTO);
  const doneStops = stops.filter((s) => s.step === 'DONE' || s.step === 'SHORT').length;

  return {
    missionRef: row.ref,
    status: row.status,
    leaseExpiresAt: row.lease_expires_at,
    toteCode: row.tote_code || null,
    totalStops: stops.length,
    doneStops,
    stops,
  };
}
