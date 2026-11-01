export interface FactorBreakdown {
  factor: 'distance' | 'consolidation' | 'utilization' | 'affinity' | 'velocity';
  weight: number;
  value: number;
  contribution: number;
  applied: boolean;
  neutral?: boolean;
  note?: string;
}

export interface ScoreCandidateArgs {
  distFromDock: number;
  maxDist: number;
  currentSku: string | null;
  productSku: string;
  canFitFull: boolean;
  shelfHoldsSku: boolean;
  currentQty: number;
  suggestedQty: number;
  capacity: number;
  sameCategoryNeighbours: number;
  occupiedNeighbours: number;
  skuPickedUnits: number | null;
  totalPickHistorySkus: number;
  skusWithStrictlyFewerPicks: number;
}

export interface ScoreResult {
  score: number;
  velocity_applied: boolean;
  velocity_note: string;
  weights: Record<string, number>;
  breakdown: FactorBreakdown[];
}

export function scoreCandidate(args: ScoreCandidateArgs): ScoreResult {
  const {
    distFromDock,
    maxDist,
    currentSku,
    productSku,
    canFitFull,
    shelfHoldsSku,
    currentQty,
    suggestedQty,
    capacity,
    sameCategoryNeighbours,
    occupiedNeighbours,
    skuPickedUnits,
    totalPickHistorySkus,
    skusWithStrictlyFewerPicks
  } = args;

  // 1. Distance value
  const distanceValue = maxDist > 0 ? 1 - distFromDock / maxDist : 1;

  // 2. Consolidation value
  let consolidationValue = 0.4;
  if (currentSku && currentSku.toUpperCase() === productSku.toUpperCase()) {
    consolidationValue = canFitFull ? 1.0 : 0.7;
  } else if (shelfHoldsSku) {
    consolidationValue = 0.6;
  } else {
    consolidationValue = 0.4;
  }

  // 3. Utilization value
  const utilizationValue = Math.min(1, (currentQty + suggestedQty) / capacity);

  // 4. Affinity value
  let affinityValue = 0.5;
  let affinityNeutral = false;
  let affinityNote: string | undefined;

  if (occupiedNeighbours === 0) {
    affinityValue = 0.5;
    affinityNeutral = true;
    affinityNote = 'No neighbouring stock — neutral value, not a measurement';
  } else {
    affinityValue = sameCategoryNeighbours / occupiedNeighbours;
  }

  // 5. Velocity value & application check
  // Applied only if the SKU has >= 1 PICK movement in last 30 days and >= 3 distinct SKUs have pick history
  let velocityApplied = false;
  let velocityValue = 0;
  let velocityNote = 'Not enough pick history; velocity ignored.';

  if (
    skuPickedUnits !== null &&
    skuPickedUnits >= 1 &&
    totalPickHistorySkus >= 3
  ) {
    velocityApplied = true;
    const vp = skusWithStrictlyFewerPicks / (totalPickHistorySkus - 1);
    velocityValue = 1 - Math.abs(vp - distanceValue);
    velocityNote = 'Velocity factor applied based on 30-day pick movement history.';
  }

  // Weights calculation
  let wDist = 0.25;
  let wCons = 0.30;
  let wUtil = 0.15;
  let wAffin = 0.15;
  let wVel = 0.15;

  if (!velocityApplied) {
    // Renormalize remaining 4 weights by dividing each by 0.85
    wDist = 0.25 / 0.85;
    wCons = 0.30 / 0.85;
    wUtil = 0.15 / 0.85;
    wAffin = 0.15 / 0.85;
    wVel = 0;
  }

  const rawScore =
    wDist * distanceValue +
    wCons * consolidationValue +
    wUtil * utilizationValue +
    wAffin * affinityValue +
    (velocityApplied ? wVel * velocityValue : 0);

  const finalScore = Math.round(100 * rawScore * 100) / 100;

  const breakdown: FactorBreakdown[] = [
    {
      factor: 'distance',
      weight: Math.round(wDist * 1000) / 1000,
      value: Math.round(distanceValue * 1000) / 1000,
      contribution: Math.round(wDist * distanceValue * 100 * 100) / 100,
      applied: true
    },
    {
      factor: 'consolidation',
      weight: Math.round(wCons * 1000) / 1000,
      value: Math.round(consolidationValue * 1000) / 1000,
      contribution: Math.round(wCons * consolidationValue * 100 * 100) / 100,
      applied: true
    },
    {
      factor: 'utilization',
      weight: Math.round(wUtil * 1000) / 1000,
      value: Math.round(utilizationValue * 1000) / 1000,
      contribution: Math.round(wUtil * utilizationValue * 100 * 100) / 100,
      applied: true
    },
    {
      factor: 'affinity',
      weight: Math.round(wAffin * 1000) / 1000,
      value: Math.round(affinityValue * 1000) / 1000,
      contribution: Math.round(wAffin * affinityValue * 100 * 100) / 100,
      applied: true,
      neutral: affinityNeutral,
      note: affinityNote
    },
    {
      factor: 'velocity',
      weight: Math.round(wVel * 1000) / 1000,
      value: Math.round(velocityValue * 1000) / 1000,
      contribution: Math.round(wVel * velocityValue * 100 * 100) / 100,
      applied: velocityApplied,
      note: velocityNote
    }
  ];

  return {
    score: finalScore,
    velocity_applied: velocityApplied,
    velocity_note: velocityNote,
    weights: {
      distance: Math.round(wDist * 1000) / 1000,
      consolidation: Math.round(wCons * 1000) / 1000,
      utilization: Math.round(wUtil * 1000) / 1000,
      affinity: Math.round(wAffin * 1000) / 1000,
      velocity: Math.round(wVel * 1000) / 1000
    },
    breakdown
  };
}
