import Database from 'better-sqlite3';

export interface GraphEdge {
  to: string;
  distance: number;
}

export interface NavNodeCoord {
  x: number;
  y: number;
}

export type NavGraph = Map<string, GraphEdge[]>;
export type NodeCoords = Map<string, NavNodeCoord>;

interface CachedGraph {
  graph: NavGraph;
  coords: NodeCoords;
  loadedAt: number;
}

const dbCache = new WeakMap<Database.Database, CachedGraph>();
const CACHE_TTL_MS = 60 * 1000;

export function loadGraphWithCoords(db: Database.Database, forceRefresh = false): { graph: NavGraph; coords: NodeCoords } {
  const now = Date.now();
  const cached = dbCache.get(db);
  if (!forceRefresh && cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return { graph: cached.graph, coords: cached.coords };
  }

  const nodes = db.prepare('SELECT id, x, y FROM nav_nodes').all() as { id: string; x: number; y: number }[];
  const edges = db.prepare('SELECT from_node, to_node, distance FROM nav_edges').all() as {
    from_node: string;
    to_node: string;
    distance: number;
  }[];

  const graph: NavGraph = new Map();
  const coords: NodeCoords = new Map();

  for (const n of nodes) {
    graph.set(n.id, []);
    coords.set(n.id, { x: n.x, y: n.y });
  }

  for (const e of edges) {
    if (!graph.has(e.from_node)) graph.set(e.from_node, []);
    if (!graph.has(e.to_node)) graph.set(e.to_node, []);

    graph.get(e.from_node)!.push({ to: e.to_node, distance: e.distance });
    graph.get(e.to_node)!.push({ to: e.from_node, distance: e.distance });
  }

  const entry = { graph, coords, loadedAt: now };
  dbCache.set(db, entry);
  return entry;
}

export function loadGraph(db: Database.Database, forceRefresh = false): NavGraph {
  return loadGraphWithCoords(db, forceRefresh).graph;
}

export function clearGraphCache(db?: Database.Database): void {
  if (db) {
    dbCache.delete(db);
  }
}
