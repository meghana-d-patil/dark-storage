import Database from 'better-sqlite3';
import { loadGraph } from '../graph/loadGraph.js';
import { dijkstra } from '../graph/dijkstra.js';
import { loadPlacementSnapshot } from './snapshot.js';
import { evaluateBin } from './filter.js';
import { scoreCandidate, FactorBreakdown } from './score.js';

export interface RecommendOptions {
  sku: string;
  qty: number;
  allow_partial?: boolean;
  include_all?: boolean;
  max_alternatives?: number;
}

export interface ScoredCandidate {
  bin_code: string;
  shelf_code: string;
  level: number;
  capacity: number;
  current_qty: number;
  current_sku: string | null;
  free_capacity: number;
  can_fit_full: boolean;
  suggested_qty: number;
  distance: number;
  score: number;
  breakdown: FactorBreakdown[];
  reason: string;
}

export interface SplitPlanItem {
  bin_code: string;
  qty: number;
}

export interface AllBinsItem {
  bin_code: string;
  valid: boolean;
  reason?: string;
  score?: number;
}

export interface RecommendationResponse {
  requested_qty: number;
  generated_at: string;
  scoring: {
    weights: Record<string, number>;
    velocity_applied: boolean;
    velocity_note: string;
  };
  recommended: ScoredCandidate | null;
  alternatives: ScoredCandidate[];
  split_plan: SplitPlanItem[];
  split_plan_complete: boolean;
  rejected_summary: Record<string, number>;
  all_bins?: AllBinsItem[];
}

function buildReasonText(
  breakdown: FactorBreakdown[],
  dist: number,
  canFitFull: boolean,
  isConsolidation: boolean
): string {
  // Sort breakdown by contribution DESC
  const sorted = [...breakdown].sort((a, b) => b.contribution - a.contribution);
  const parts: string[] = [];

  if (isConsolidation) {
    parts.push(
      canFitFull
        ? 'Same SKU already stored here and the full quantity fits'
        : 'Same SKU already stored here'
    );
  } else {
    const topFactor = sorted[0];
    if (topFactor.factor === 'distance') {
      parts.push(`Shortest distance from receiving (${dist.toFixed(1)} units)`);
    } else if (topFactor.factor === 'utilization') {
      parts.push('High capacity utilization');
    } else if (topFactor.factor === 'affinity') {
      parts.push('High product category affinity with neighbours');
    } else {
      parts.push('Empty bin with optimal location');
    }
  }

  parts.push(`${dist.toFixed(1)} distance units from receiving`);
  return parts.join('; ') + '.';
}

export function recommendPlacement(
  db: Database.Database,
  opts: RecommendOptions
): RecommendationResponse {
  const { sku, qty, allow_partial = true, include_all = false, max_alternatives = 10 } = opts;

  const snapshot = loadPlacementSnapshot(db, sku);
  const graph = loadGraph(db);
  const { distances } = dijkstra('DOCK', graph);

  // Compute maxDist from DOCK to any shelf node
  let maxDist = 1;
  for (const b of snapshot.bins) {
    const d = distances.get(b.nav_node_id);
    if (d !== undefined && d !== Infinity && d > maxDist) {
      maxDist = d;
    }
  }

  // Pre-calculate which shelves hold this SKU
  const shelvesHoldingSku = new Set<string>();
  for (const b of snapshot.bins) {
    if (b.current_sku && b.current_sku.toUpperCase() === sku.toUpperCase() && b.current_qty > 0) {
      shelvesHoldingSku.add(b.shelf_code);
    }
  }

  // Velocity calculations
  const skuPickedUnits = snapshot.pickHistory.get(sku.toUpperCase()) ?? 0;
  const totalPickHistorySkus = snapshot.pickHistory.size;
  let skusWithStrictlyFewerPicks = 0;
  for (const picked of snapshot.pickHistory.values()) {
    if (picked < skuPickedUnits) {
      skusWithStrictlyFewerPicks++;
    }
  }

  const rejectedSummary: Record<string, number> = {
    SKU_CONFLICT: 0,
    BIN_BLOCKED: 0,
    BIN_DAMAGED: 0,
    SHELF_UNAVAILABLE: 0,
    STORAGE_CLASS_MISMATCH: 0,
    BIN_FULL: 0,
    INSUFFICIENT_CAPACITY: 0,
    RECOUNT_REQUIRED: 0
  };

  const allBinsList: AllBinsItem[] = [];
  const validCandidates: ScoredCandidate[] = [];
  let scoringMeta: { weights: Record<string, number>; velocity_applied: boolean; velocity_note: string } | null = null;

  for (const bin of snapshot.bins) {
    const filterRes = evaluateBin(bin, snapshot.product, qty, allow_partial);

    if (!filterRes.valid) {
      rejectedSummary[filterRes.reason] = (rejectedSummary[filterRes.reason] || 0) + 1;
      if (include_all) {
        allBinsList.push({
          bin_code: bin.bin_code,
          valid: false,
          reason: filterRes.reason
        });
      }
      continue;
    }

    // Bin is valid
    const dist = distances.get(bin.nav_node_id) ?? 0;

    // Neighbours at the same nav node
    const nodeBins = snapshot.binsByNode.get(bin.nav_node_id) || [];
    const occupiedNeighbours = nodeBins.filter(o => o.bin_code !== bin.bin_code && o.current_qty > 0);
    const sameCategoryCount = occupiedNeighbours.filter(o => o.current_category === snapshot.product.category).length;

    const isConsolidation = Boolean(bin.current_sku && bin.current_sku.toUpperCase() === sku.toUpperCase());

    const scoreRes = scoreCandidate({
      distFromDock: dist,
      maxDist,
      currentSku: bin.current_sku,
      productSku: sku,
      canFitFull: filterRes.can_fit_full,
      shelfHoldsSku: shelvesHoldingSku.has(bin.shelf_code),
      currentQty: bin.current_qty,
      suggestedQty: filterRes.suggested_qty,
      capacity: bin.capacity,
      sameCategoryNeighbours: sameCategoryCount,
      occupiedNeighbours: occupiedNeighbours.length,
      skuPickedUnits,
      totalPickHistorySkus,
      skusWithStrictlyFewerPicks
    });

    if (!scoringMeta) {
      scoringMeta = {
        weights: scoreRes.weights,
        velocity_applied: scoreRes.velocity_applied,
        velocity_note: scoreRes.velocity_note
      };
    }

    const candidate: ScoredCandidate = {
      bin_code: bin.bin_code,
      shelf_code: bin.shelf_code,
      level: bin.level,
      capacity: bin.capacity,
      current_qty: bin.current_qty,
      current_sku: bin.current_sku,
      free_capacity: bin.free_capacity,
      can_fit_full: filterRes.can_fit_full,
      suggested_qty: filterRes.suggested_qty,
      distance: dist,
      score: scoreRes.score,
      breakdown: scoreRes.breakdown,
      reason: buildReasonText(scoreRes.breakdown, dist, filterRes.can_fit_full, isConsolidation)
    };

    validCandidates.push(candidate);

    if (include_all) {
      allBinsList.push({
        bin_code: bin.bin_code,
        valid: true,
        score: candidate.score
      });
    }
  }

  // Fallback scoringMeta if no bins were valid
  if (!scoringMeta) {
    const dummyScore = scoreCandidate({
      distFromDock: 0,
      maxDist,
      currentSku: null,
      productSku: sku,
      canFitFull: false,
      shelfHoldsSku: false,
      currentQty: 0,
      suggestedQty: 0,
      capacity: 100,
      sameCategoryNeighbours: 0,
      occupiedNeighbours: 0,
      skuPickedUnits,
      totalPickHistorySkus,
      skusWithStrictlyFewerPicks
    });
    scoringMeta = {
      weights: dummyScore.weights,
      velocity_applied: dummyScore.velocity_applied,
      velocity_note: dummyScore.velocity_note
    };
  }

  // Deterministic sorting: score DESC, then bin_code ASC
  validCandidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.bin_code.localeCompare(b.bin_code);
  });

  const recommended = validCandidates.length > 0 ? validCandidates[0] : null;
  const alternatives = validCandidates.slice(1, 1 + max_alternatives);

  // Split plan
  const splitPlan: SplitPlanItem[] = [];
  let remaining = qty;
  for (const c of validCandidates) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, c.free_capacity);
    if (take > 0) {
      splitPlan.push({ bin_code: c.bin_code, qty: take });
      remaining -= take;
    }
  }

  const splitPlanComplete = remaining === 0;

  return {
    requested_qty: qty,
    generated_at: new Date().toISOString(),
    scoring: scoringMeta,
    recommended,
    alternatives,
    split_plan: splitPlan,
    split_plan_complete: splitPlanComplete,
    rejected_summary: rejectedSummary,
    ...(include_all ? { all_bins: allBinsList } : {})
  };
}
