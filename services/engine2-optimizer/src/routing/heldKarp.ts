export type DistanceFn = (from: string, to: string) => number;

export function heldKarp(
  start: string,
  end: string,
  waypoints: string[],
  distanceFn: DistanceFn
): { order: string[]; totalDistance: number } {
  const m = waypoints.length;

  if (m === 0) {
    return { order: [], totalDistance: distanceFn(start, end) };
  }

  if (m === 1) {
    const total = distanceFn(start, waypoints[0]) + distanceFn(waypoints[0], end);
    return { order: [waypoints[0]], totalDistance: total };
  }

  // Pre-sort waypoints deterministically
  const wp = [...waypoints].sort((a, b) => a.localeCompare(b));

  const numStates = 1 << m;
  const dp: number[][] = Array.from({ length: numStates }, () => Array(m).fill(Infinity));
  const parent: number[][] = Array.from({ length: numStates }, () => Array(m).fill(-1));

  // Base cases: path from start to each single waypoint
  for (let j = 0; j < m; j++) {
    dp[1 << j][j] = distanceFn(start, wp[j]);
  }

  for (let mask = 1; mask < numStates; mask++) {
    for (let j = 0; j < m; j++) {
      if ((mask & (1 << j)) === 0) continue;
      const costJ = dp[mask][j];
      if (costJ === Infinity) continue;

      for (let k = 0; k < m; k++) {
        if ((mask & (1 << k)) !== 0) continue;
        const nextMask = mask | (1 << k);
        const newCost = costJ + distanceFn(wp[j], wp[k]);

        if (newCost < dp[nextMask][k] - 1e-9) {
          dp[nextMask][k] = newCost;
          parent[nextMask][k] = j;
        } else if (Math.abs(newCost - dp[nextMask][k]) <= 1e-9) {
          if (parent[nextMask][k] === -1 || j < parent[nextMask][k]) {
            parent[nextMask][k] = j;
          }
        }
      }
    }
  }

  const fullMask = numStates - 1;
  let bestCost = Infinity;
  let bestJ = -1;

  for (let j = 0; j < m; j++) {
    const total = dp[fullMask][j] + distanceFn(wp[j], end);
    if (total < bestCost - 1e-9) {
      bestCost = total;
      bestJ = j;
    } else if (Math.abs(total - bestCost) <= 1e-9 && bestJ !== -1) {
      if (wp[j].localeCompare(wp[bestJ]) < 0) {
        bestCost = total;
        bestJ = j;
      }
    }
  }

  const order: string[] = [];
  let currMask = fullMask;
  let currJ = bestJ;

  while (currJ !== -1) {
    order.unshift(wp[currJ]);
    const prevJ = parent[currMask][currJ];
    currMask = currMask ^ (1 << currJ);
    currJ = prevJ;
  }

  return { order, totalDistance: bestCost };
}
