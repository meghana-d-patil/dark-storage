import Database from 'better-sqlite3';

export interface GraphEdge {
  to: string;
  distance: number;
}

export type NavGraph = Map<string, GraphEdge[]>;

interface CachedGraph {
  graph: NavGraph;
  loadedAt: number;
}

let cachedGraph: CachedGraph | null = null;
const CACHE_TTL_MS = 60 * 1000;

export function loadGraph(db: Database.Database, forceRefresh = false): NavGraph {
  const now = Date.now();
  if (!forceRefresh && cachedGraph && now - cachedGraph.loadedAt < CACHE_TTL_MS) {
    return cachedGraph.graph;
  }

  const nodes = db.prepare('SELECT id FROM nav_nodes').all() as { id: string }[];
  const edges = db.prepare('SELECT from_node, to_node, distance FROM nav_edges').all() as {
    from_node: string;
    to_node: string;
    distance: number;
  }[];

  const graph: NavGraph = new Map();
  for (const n of nodes) {
    graph.set(n.id, []);
  }

  for (const e of edges) {
    if (!graph.has(e.from_node)) graph.set(e.from_node, []);
    if (!graph.has(e.to_node)) graph.set(e.to_node, []);

    graph.get(e.from_node)!.push({ to: e.to_node, distance: e.distance });
    graph.get(e.to_node)!.push({ to: e.from_node, distance: e.distance });
  }

  cachedGraph = { graph, loadedAt: now };
  return graph;
}

export function clearGraphCache(): void {
  cachedGraph = null;
}
