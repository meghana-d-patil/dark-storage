/**
 * Visual bin states, status precedence, and fill-level classification.
 * Matches existing WarehousePage color semantics and precedence.
 */

export type BinVisualState =
  | 'empty'
  | 'low'
  | 'med'
  | 'high'
  | 'full'
  | 'blocked'
  | 'damaged'
  | 'maintenance'
  | 'recount';

export interface BinVisualInput {
  qty: number;
  capacity: number;
  status: string;
  recount_required: boolean;
}

/**
 * Calculates visual state of a bin following strict precedence:
 * 1. BLOCKED bin status
 * 2. DAMAGED bin status
 * 3. MAINTENANCE shelf status
 * 4. recount_required flag
 * 5. Fill level: empty (qty=0), low (<25%), med (<75%), high (<100%), full (>=100%)
 */
export function binVisualState(bin: BinVisualInput, shelfStatus?: string): BinVisualState {
  if (bin.status === 'BLOCKED') return 'blocked';
  if (bin.status === 'DAMAGED') return 'damaged';
  if (shelfStatus === 'MAINTENANCE') return 'maintenance';
  if (bin.recount_required) return 'recount';

  if (bin.qty <= 0) return 'empty';
  const pct = (bin.qty / bin.capacity) * 100;
  if (pct < 25) return 'low';
  if (pct < 75) return 'med';
  if (pct < 100) return 'high';
  return 'full';
}

/**
 * Computes aggregate shelf visual state:
 * Worst state wins: blocked / damaged / maintenance / recount, else fullest bin.
 */
export function shelfAggregateVisualState(shelf: {
  status: string;
  bins: BinVisualInput[];
}): BinVisualState {
  if (shelf.status === 'MAINTENANCE') return 'maintenance';

  const binStates = shelf.bins.map((b) => binVisualState(b, shelf.status));
  if (binStates.includes('blocked')) return 'blocked';
  if (binStates.includes('damaged')) return 'damaged';
  if (binStates.includes('recount')) return 'recount';

  let maxPct = 0;
  let hasAnyStock = false;
  for (const b of shelf.bins) {
    if (b.qty > 0) hasAnyStock = true;
    if (b.capacity > 0) {
      const pct = (b.qty / b.capacity) * 100;
      if (pct > maxPct) maxPct = pct;
    }
  }

  if (!hasAnyStock || maxPct <= 0) return 'empty';
  if (maxPct < 25) return 'low';
  if (maxPct < 75) return 'med';
  if (maxPct < 100) return 'high';
  return 'full';
}

/**
 * Direct hex / rgba colors for SVG and Canvas rendering matching Material 3 theme.
 */
export const VISUAL_STATE_COLORS: Record<BinVisualState, string> = {
  empty: 'rgba(148, 163, 184, 0.22)',
  low: 'rgba(56, 189, 248, 0.55)',
  med: 'rgba(99, 102, 241, 0.70)',
  high: 'rgba(16, 185, 129, 0.85)',
  full: '#10b981',
  blocked: '#ef4444',
  damaged: '#f97316',
  maintenance: '#eab308',
  recount: '#a855f7'
};

/**
 * Returns the CSS class used in existing WarehousePage views.
 */
export function binVisualClass(state: BinVisualState): string {
  switch (state) {
    case 'blocked':
      return 'status-blocked';
    case 'damaged':
      return 'status-damaged';
    case 'maintenance':
      return 'status-maintenance';
    case 'recount':
      return 'status-recount';
    case 'empty':
      return 'fill-empty';
    case 'low':
      return 'fill-low';
    case 'med':
      return 'fill-med';
    case 'high':
      return 'fill-high';
    case 'full':
      return 'fill-full';
  }
}
