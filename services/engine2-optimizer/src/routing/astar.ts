import { NavGraph, NodeCoords } from '../graph/loadGraph.js';

export function astar(
  startNode: string,
  goalNode: string,
  graph: NavGraph,
  coords?: NodeCoords
): { path: string[]; distance: number } {
  if (startNode === goalNode) {
    return { path: [startNode], distance: 0 };
  }

  const goalCoord = coords?.get(goalNode);

  const heuristic = (node: string): number => {
    if (!goalCoord || !coords) return 0;
    const c = coords.get(node);
    if (!c) return 0;
    const dx = c.x - goalCoord.x;
    const dy = c.y - goalCoord.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const openSet = new Set<string>();
  const closedSet = new Set<string>();

  for (const node of graph.keys()) {
    gScore.set(node, Infinity);
    fScore.set(node, Infinity);
  }

  gScore.set(startNode, 0);
  fScore.set(startNode, heuristic(startNode));
  openSet.add(startNode);

  while (openSet.size > 0) {
    let current: string | null = null;
    let minF = Infinity;

    for (const node of openSet) {
      const f = fScore.get(node)!;
      if (f < minF - 1e-9) {
        minF = f;
        current = node;
      } else if (Math.abs(f - minF) <= 1e-9 && current !== null) {
        // Tie break by h(n) then node id ASC
        const hNode = heuristic(node);
        const hCurr = heuristic(current);
        if (hNode < hCurr - 1e-9 || (Math.abs(hNode - hCurr) <= 1e-9 && node.localeCompare(current) < 0)) {
          minF = f;
          current = node;
        }
      }
    }

    if (current === null || minF === Infinity) {
      break;
    }

    if (current === goalNode) {
      const path: string[] = [current];
      let curr = current;
      while (cameFrom.has(curr)) {
        curr = cameFrom.get(curr)!;
        path.unshift(curr);
      }
      return { path, distance: gScore.get(goalNode)! };
    }

    openSet.delete(current);
    closedSet.add(current);

    const neighbors = graph.get(current) || [];
    const sortedNeighbors = [...neighbors].sort((a, b) => a.to.localeCompare(b.to));

    for (const edge of sortedNeighbors) {
      if (closedSet.has(edge.to)) continue;

      const tentativeG = gScore.get(current)! + edge.distance;
      const currentG = gScore.get(edge.to)!;

      if (tentativeG < currentG - 1e-9) {
        cameFrom.set(edge.to, current);
        gScore.set(edge.to, tentativeG);
        fScore.set(edge.to, tentativeG + heuristic(edge.to));
        openSet.add(edge.to);
      }
    }
  }

  return { path: [], distance: Infinity };
}
