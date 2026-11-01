import { NavGraph } from '../graph/loadGraph.js';

export function dijkstra(
  startNode: string,
  graph: NavGraph
): { distances: Map<string, number>; previous: Map<string, string | null> } {
  const distances = new Map<string, number>();
  const previous = new Map<string, string | null>();
  const unvisited = new Set<string>();

  for (const node of graph.keys()) {
    distances.set(node, Infinity);
    previous.set(node, null);
    unvisited.add(node);
  }

  distances.set(startNode, 0);

  while (unvisited.size > 0) {
    let currNode: string | null = null;
    let minDist = Infinity;

    for (const node of unvisited) {
      const d = distances.get(node)!;
      if (d < minDist || (d === minDist && currNode !== null && node.localeCompare(currNode) < 0)) {
        minDist = d;
        currNode = node;
      }
    }

    if (currNode === null || minDist === Infinity) {
      break;
    }

    unvisited.delete(currNode);

    const neighbors = graph.get(currNode) || [];
    // Sort neighbors by to ASC for determinism
    const sortedNeighbors = [...neighbors].sort((a, b) => a.to.localeCompare(b.to));

    for (const edge of sortedNeighbors) {
      if (!unvisited.has(edge.to)) continue;

      const alt = minDist + edge.distance;
      const currentDist = distances.get(edge.to)!;
      if (alt < currentDist - 1e-9) {
        distances.set(edge.to, alt);
        previous.set(edge.to, currNode);
      }
    }
  }

  return { distances, previous };
}

export function getShortestPathDijkstra(
  startNode: string,
  endNode: string,
  graph: NavGraph
): { path: string[]; distance: number } {
  const { distances, previous } = dijkstra(startNode, graph);
  const distance = distances.get(endNode) ?? Infinity;

  if (distance === Infinity) {
    return { path: [], distance: Infinity };
  }

  const path: string[] = [];
  let curr: string | null = endNode;
  while (curr !== null) {
    path.unshift(curr);
    if (curr === startNode) break;
    curr = previous.get(curr) ?? null;
  }

  return { path, distance };
}
