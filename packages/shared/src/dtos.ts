export type PickStopStep = 'SCAN_BIN' | 'SCAN_ITEM' | 'SCAN_TOTE' | 'DONE' | 'SHORT';

export interface PickerStopDTO {
  stopRef: string;
  seq: number;
  binCode: string;
  aisleLabel: string;
  sku: string;
  productName: string;
  imageHint?: string | null;
  qtyToPick: number;
  step: PickStopStep;
  toteCode?: string | null;
  orderRef?: string;
}

export interface PickerMissionDTO {
  missionRef: string;
  status: string;
  leaseExpiresAt: string | null;
  toteCode: string | null;
  totalStops: number;
  doneStops: number;
  stops: PickerStopDTO[];
}

export interface PackLineDTO {
  sku: string;
  productName: string;
  expectedQty: number;
  scannedQty: number;
  flaggedQty: number;
}

export interface PackSessionDTO {
  sessionId: string;
  orderRef: string;
  toteCode: string;
  lines: PackLineDTO[];
  weightExpectedG?: number;
  weightOk?: boolean;
  canComplete: boolean;
}

export interface CountTaskDTO {
  taskRef: string;
  type: 'COUNT';
  binCode: string;
  sku?: string | null;
}
