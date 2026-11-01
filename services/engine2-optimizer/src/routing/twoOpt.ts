import { DistanceFn } from './heldKarp.js';

export function twoOpt(
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

  // 1. Nearest-neighbour from start
  const unvisited = new Set(waypoints);
  const tour: string[] = [];
  let curr = start;

  while (unvisited.size > 0) {
    let nextNode: string | null = null;
    let minDist = Infinity;

    for (const cand of unvisited) {
      const d = distanceFn(curr, cand);
      if (d < minDist - 1e-9) {
        minDist = d;
        nextNode = cand;
      } else if (Math.abs(d - minDist) <= 1e-9 && nextNode !== null) {
        if (cand.localeCompare(nextNode) < 0) {
          minDist = d;
          nextNode = cand;
        }
      }
    }

    if (!nextNode) break;
    tour.push(nextNode);
    unvisited.delete(nextNode);
    curr = nextNode;
  }

  const calcTotal = (t: string[]): number => {
    let sum = distanceFn(start, t[0]);
    for (let i = 0; i < t.length - 1; i++) {
      sum += distanceFn(t[i], t[i + 1]);
    }
    sum += distanceFn(t[t.length - 1], end);
    return sum;
  };

  // 2. 2-opt passes
  let currentTotal = calcTotal(tour);
  let passes = 0;
  const MAX_PASSES = 1000;

  while (passes < MAX_PASSES) {
    passes++;
    let improved = false;

    for (let i = 0; i < m - 1; i++) {
      for (let k = i + 1; k < m; k++) {
        const prevNode = i === 0 ? start : tour[i - 1];
        const nextNode = k === m - 1 ? end : tour[k + 1];

        const oldEdges = distanceFn(prevNode, tour[i]) + distanceFn(tour[k], nextNode);
        const newEdges = distanceFn(prevNode, tour[k]) + distanceFn(tour[i], nextNode);

        if (newEdges < oldEdges - 1e-9) {
          // Reverse sub-array tour[i..k]
          let left = i;
          let right = k;
          while (left < right) {
            const temp = tour[left];
            tour[left] = tour[right];
            tour[right] = temp;
            left++;
            right--;
          }

          improved = true;
          currentTotal = calcTotal(tour);
        }
      }
    }

    if (!improved) break;
  }

  return { order: tour, totalDistance: currentTotal };
}
