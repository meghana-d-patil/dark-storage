import Database from 'better-sqlite3';
import { DomainError } from '@dark-storage/shared';
import { loadGraphWithCoords } from '../graph/loadGraph.js';
import { dijkstra } from './dijkstra.js';
import { astar } from './astar.js';
import { heldKarp } from './heldKarp.js';
import { twoOpt } from './twoOpt.js';

export interface RouteStopInput {
  key: string | number;
  bin_code: string;
  node: string;
  shelf_code?: string;
  level?: number;
}

export interface RoutePlanInput {
  start: string;
  end: string;
  stops: RouteStopInput[];
}

export interface RouteLeg {
  from: string;
  to: string;
  distance: number;
  path: string[];
}

export interface RouteStopOutput {
  key: string | number;
  bin_code: string;
  node: string;
  seq: number;
}

export interface RoutePlanOutput {
  algorithm: 'HELD_KARP' | 'TWO_OPT' | 'TRIVIAL';
  total_distance: number;
  start: string;
  end: string;
  order: Array<string | number>;
  stops: RouteStopOutput[];
  legs: RouteLeg[];
}

function getShelfAndLevel(stop: RouteStopInput): { shelfCode: string; level: number } {
  if (stop.shelf_code && stop.level !== undefined) {
    return { shelfCode: stop.shelf_code, level: stop.level };
  }
  const parts = stop.bin_code.split('-');
  if (parts.length >= 4) {
    const level = parseInt(parts[parts.length - 1], 10) || 0;
    const shelfCode = parts.slice(0, parts.length - 1).join('-');
    return { shelfCode, level };
  }
  return { shelfCode: stop.bin_code, level: 0 };
}

export function planRoute(db: Database.Database, input: RoutePlanInput): RoutePlanOutput {
  const { graph, coords } = loadGraphWithCoords(db);
  const start = input.start || 'DOCK';
  const end = input.end || 'PACK';
  const stops = input.stops || [];

  // 1. Group stops by node -> distinct waypoints
  const stopsByNode = new Map<string, RouteStopInput[]>();
  for (const s of stops) {
    if (!stopsByNode.has(s.node)) {
      stopsByNode.set(s.node, []);
    }
    stopsByNode.get(s.node)!.push(s);
  }

  const waypoints = Array.from(stopsByNode.keys()).sort((a, b) => a.localeCompare(b));

  // 2. Compute distance matrix D via Dijkstra from start, end, and all waypoints
  const nodesToRun = Array.from(new Set([start, end, ...waypoints]));
  const distanceMatrix = new Map<string, Map<string, number>>();

  for (const n of nodesToRun) {
    const { distances } = dijkstra(n, graph);
    distanceMatrix.set(n, distances);
  }

  const getD = (from: string, to: string): number => {
    return distanceMatrix.get(from)?.get(to) ?? Infinity;
  };

  // Check reachability
  const unreachableKeys: Array<string | number> = [];
  if (getD(start, end) === Infinity) {
    // If start to end is disconnected
    for (const s of stops) {
      unreachableKeys.push(s.key);
    }
  }

  for (const s of stops) {
    const distFromStart = getD(start, s.node);
    const distToEnd = getD(s.node, end);
    if (distFromStart === Infinity || distToEnd === Infinity) {
      if (!unreachableKeys.includes(s.key)) {
        unreachableKeys.push(s.key);
      }
    }
  }

  if (unreachableKeys.length > 0) {
    throw new DomainError('ROUTE_UNREACHABLE', 'One or more route destinations are unreachable', {
      unreachable_keys: unreachableKeys
    });
  }

  // 3. Algorithm selection and waypoint ordering
  const m = waypoints.length;
  let algorithm: 'HELD_KARP' | 'TWO_OPT' | 'TRIVIAL';
  let orderedWaypoints: string[] = [];

  if (m === 0) {
    algorithm = 'TRIVIAL';
    orderedWaypoints = [];
  } else if (m <= 10) {
    algorithm = 'HELD_KARP';
    const result = heldKarp(start, end, waypoints, getD);
    orderedWaypoints = result.order;
  } else {
    algorithm = 'TWO_OPT';
    const result = twoOpt(start, end, waypoints, getD);
    orderedWaypoints = result.order;
  }

  // 4. Order the stops inside each waypoint by (shelf_code ASC, level ASC)
  const orderedStops: RouteStopOutput[] = [];
  const orderedKeys: Array<string | number> = [];
  let currentSeq = 1;

  for (const wpNode of orderedWaypoints) {
    const nodeStops = stopsByNode.get(wpNode) || [];
    nodeStops.sort((a, b) => {
      const aInfo = getShelfAndLevel(a);
      const bInfo = getShelfAndLevel(b);
      const shelfCmp = aInfo.shelfCode.localeCompare(bInfo.shelfCode);
      if (shelfCmp !== 0) return shelfCmp;
      return aInfo.level - bInfo.level;
    });

    for (const s of nodeStops) {
      orderedStops.push({
        key: s.key,
        bin_code: s.bin_code,
        node: s.node,
        seq: currentSeq++
      });
      orderedKeys.push(s.key);
    }
  }

  // 5. Compute legs between consecutive points (start, w1..wm, end) with A*
  const pathNodes = [start, ...orderedWaypoints, end];
  const legs: RouteLeg[] = [];
  let totalDistance = 0;

  for (let i = 0; i < pathNodes.length - 1; i++) {
    const from = pathNodes[i];
    const to = pathNodes[i + 1];

    if (from === to) {
      legs.push({
        from,
        to,
        distance: 0,
        path: [from]
      });
    } else {
      const astarRes = astar(from, to, graph, coords);
      if (astarRes.distance === Infinity) {
        throw new DomainError('ROUTE_UNREACHABLE', `Path between ${from} and ${to} is disconnected`);
      }
      const dist = Math.round(astarRes.distance * 100) / 100;
      totalDistance += dist;
      legs.push({
        from,
        to,
        distance: dist,
        path: astarRes.path
      });
    }
  }

  totalDistance = Math.round(totalDistance * 100) / 100;

  return {
    algorithm,
    total_distance: totalDistance,
    start,
    end,
    order: orderedKeys,
    stops: orderedStops,
    legs
  };
}
