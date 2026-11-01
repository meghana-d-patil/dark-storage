import { BinSnapshot, ProductSnapshot } from './snapshot.js';

export type RejectionReason =
  | 'BIN_BLOCKED'
  | 'BIN_DAMAGED'
  | 'SHELF_UNAVAILABLE'
  | 'RECOUNT_REQUIRED'
  | 'STORAGE_CLASS_MISMATCH'
  | 'SKU_CONFLICT'
  | 'BIN_FULL'
  | 'INSUFFICIENT_CAPACITY';

export interface FilterResultValid {
  valid: true;
  bin_code: string;
  free_capacity: number;
  can_fit_full: boolean;
  max_acceptable_qty: number;
  suggested_qty: number;
}

export interface FilterResultInvalid {
  valid: false;
  bin_code: string;
  reason: RejectionReason;
  free_capacity: number;
  max_acceptable_qty: number;
}

export type FilterResult = FilterResultValid | FilterResultInvalid;

export function evaluateBin(
  bin: BinSnapshot,
  product: ProductSnapshot,
  qty: number,
  allowPartial = true
): FilterResult {
  // 1. BIN_BLOCKED / BIN_DAMAGED
  if (bin.bin_status === 'BLOCKED') {
    return {
      valid: false,
      bin_code: bin.bin_code,
      reason: 'BIN_BLOCKED',
      free_capacity: bin.free_capacity,
      max_acceptable_qty: 0
    };
  }
  if (bin.bin_status === 'DAMAGED') {
    return {
      valid: false,
      bin_code: bin.bin_code,
      reason: 'BIN_DAMAGED',
      free_capacity: bin.free_capacity,
      max_acceptable_qty: 0
    };
  }

  // 2. SHELF_UNAVAILABLE
  if (bin.shelf_status === 'MAINTENANCE' || bin.shelf_status === 'BLOCKED') {
    return {
      valid: false,
      bin_code: bin.bin_code,
      reason: 'SHELF_UNAVAILABLE',
      free_capacity: bin.free_capacity,
      max_acceptable_qty: 0
    };
  }

  // 3. RECOUNT_REQUIRED
  if (bin.recount_required) {
    return {
      valid: false,
      bin_code: bin.bin_code,
      reason: 'RECOUNT_REQUIRED',
      free_capacity: bin.free_capacity,
      max_acceptable_qty: 0
    };
  }

  // 4. STORAGE_CLASS_MISMATCH
  if (product.storage_class !== bin.shelf_storage_class) {
    return {
      valid: false,
      bin_code: bin.bin_code,
      reason: 'STORAGE_CLASS_MISMATCH',
      free_capacity: bin.free_capacity,
      max_acceptable_qty: 0
    };
  }

  // 5. SKU_CONFLICT
  if (bin.current_qty > 0 && bin.current_sku !== null && bin.current_sku.toUpperCase() !== product.sku.toUpperCase()) {
    return {
      valid: false,
      bin_code: bin.bin_code,
      reason: 'SKU_CONFLICT',
      free_capacity: bin.free_capacity,
      max_acceptable_qty: 0
    };
  }

  // 6. BIN_FULL
  if (bin.free_capacity === 0) {
    return {
      valid: false,
      bin_code: bin.bin_code,
      reason: 'BIN_FULL',
      free_capacity: 0,
      max_acceptable_qty: 0
    };
  }

  // 7. INSUFFICIENT_CAPACITY
  if (bin.free_capacity < qty && !allowPartial) {
    return {
      valid: false,
      bin_code: bin.bin_code,
      reason: 'INSUFFICIENT_CAPACITY',
      free_capacity: bin.free_capacity,
      max_acceptable_qty: bin.free_capacity
    };
  }

  const can_fit_full = bin.free_capacity >= qty;
  const max_acceptable_qty = Math.min(qty, bin.free_capacity);
  const suggested_qty = max_acceptable_qty;

  return {
    valid: true,
    bin_code: bin.bin_code,
    free_capacity: bin.free_capacity,
    can_fit_full,
    max_acceptable_qty,
    suggested_qty
  };
}
