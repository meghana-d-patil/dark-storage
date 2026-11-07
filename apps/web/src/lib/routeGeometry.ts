/**
 * Route path flattening, waypoint coordinates and distance accumulation.
 */

import { nodeXY } from './warehouseGeometry.js';

export interface RouteLegInput {
  from: string;
  to: string;
  distance: number;
  path: string[];
}

export interface RouteInput {
  algorithm?: string;
  total_distance?: number;
  start?: string;
  end?: string;
  legs: RouteLegInput[];
  stops?: any[];
}

export interface RoutePoint {
  id: string;
  x: number;
  y: number;
}

export interface FlattenedRoute {
  nodeIds: string[];
  points: RoutePoint[];
  cumulativeDistance: number[];
  totalDistance: number;
}

/**
 * Flattens a multi-leg route into a contiguous sequence of nodes, points, and distances,
 * eliminating consecutive duplicate join nodes between legs.
 */
export function flattenRoute(route?: RouteInput | null): FlattenedRoute {
  if (!route || !route.legs || route.legs.length === 0) {
    return {
      nodeIds: [],
      points: [],
      cumulativeDistance: [],
      totalDistance: 0
    };
  }

  const nodeIds: string[] = [];
  const cumulativeDistance: number[] = [0];
  let runningDist = 0;

  for (const leg of route.legs) {
    const path = leg.path || [];
    if (path.length === 0) continue;

    // Calculate segment distance breakdown within this leg
    // If leg has geometric distances between nodes, apportion accurately
    const legDist = leg.distance || 0;
    const segmentsCount = path.length - 1;

    for (let i = 0; i < path.length; i++) {
      const nodeId = path[i];

      // Skip the first node of this leg if it matches the last node already added (join node)
      if (nodeIds.length > 0 && i === 0 && nodeIds[nodeIds.length - 1] === nodeId) {
        continue;
      }

      nodeIds.push(nodeId);

      // Advance distance (except for the very first node of the entire route)
      if (nodeIds.length > 1) {
        const segDist = segmentsCount > 0 ? legDist / segmentsCount : 0;
        runningDist += segDist;
        cumulativeDistance.push(Math.round(runningDist * 100) / 100);
      }
    }
  }

  // Map nodeIds to world coordinate points
  const points: RoutePoint[] = nodeIds.map((id) => {
    const coord = nodeXY(id);
    return {
      id,
      x: coord ? coord.x : 0,
      y: coord ? coord.y : 0
    };
  });

  const totalDistance = cumulativeDistance.length > 0
    ? cumulativeDistance[cumulativeDistance.length - 1]
    : 0;

  return {
    nodeIds,
    points,
    cumulativeDistance,
    totalDistance
  };
}
