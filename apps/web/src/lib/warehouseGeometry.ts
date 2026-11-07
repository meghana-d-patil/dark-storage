/**
 * Warehouse spatial layout, navigation graph geometry and coordinate projections.
 * Source of truth matching scripts/seed-base.ts geometry.
 */

export interface NavNode {
  id: string;
  kind: 'DOCK' | 'PACK' | 'CROSS' | 'AISLE';
  x: number;
  y: number;
}

export interface NavEdge {
  from: string;
  to: string;
  distance: number;
}

export interface ShelfInput {
  code: string;
  aisle: string;
  bay: number;
  side: 'L' | 'R' | string;
  x?: number;
  y?: number;
}

export interface ShelfRect {
  x: number;
  y: number;
  width: number;
  height: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  centerX: number;
  centerY: number;
}

export const AISLE_X: Record<string, number> = {
  A: 10,
  B: 30,
  C: 50,
  D: 70
};

export const LEVEL_HEIGHT = 1.0; // 1.0 meter vertical clearance per bin level

// Build 34 navigation nodes
export const NODES: NavNode[] = ((): NavNode[] => {
  const nodes: NavNode[] = [
    { id: 'DOCK', kind: 'DOCK', x: 0, y: 0 },
    { id: 'PACK', kind: 'PACK', x: 80, y: 0 }
  ];

  const aisles = ['A', 'B', 'C', 'D'];

  // Cross nodes (8)
  for (const a of aisles) {
    nodes.push({ id: `XB-${a}`, kind: 'CROSS', x: AISLE_X[a], y: 0 });
    nodes.push({ id: `XT-${a}`, kind: 'CROSS', x: AISLE_X[a], y: 50 });
  }

  // Aisle nodes: bays 1..6, y = 10 + (bay - 1) * 6 (24)
  for (const a of aisles) {
    for (let bay = 1; bay <= 6; bay++) {
      const bayStr = bay.toString().padStart(2, '0');
      const y = 10 + (bay - 1) * 6;
      nodes.push({ id: `N-${a}-${bayStr}`, kind: 'AISLE', x: AISLE_X[a], y });
    }
  }

  return nodes;
})();

const nodeMap = new Map<string, NavNode>(NODES.map((n) => [n.id, n]));

export function nodeXY(id: string): { x: number; y: number } | undefined {
  const n = nodeMap.get(id);
  return n ? { x: n.x, y: n.y } : undefined;
}

// Build 36 navigation edges
export const EDGES: NavEdge[] = ((): NavEdge[] => {
  const edges: NavEdge[] = [];
  const added = new Set<string>();

  function addEdge(u: string, v: string, dist: number) {
    const [from, to] = u < v ? [u, v] : [v, u];
    const key = `${from}::${to}`;
    if (!added.has(key)) {
      added.add(key);
      edges.push({ from, to, distance: dist });
    }
  }

  // Bottom cross edges (5)
  addEdge('DOCK', 'XB-A', 10);
  addEdge('XB-A', 'XB-B', 20);
  addEdge('XB-B', 'XB-C', 20);
  addEdge('XB-C', 'XB-D', 20);
  addEdge('XB-D', 'PACK', 10);

  // Top cross edges (3)
  addEdge('XT-A', 'XT-B', 20);
  addEdge('XT-B', 'XT-C', 20);
  addEdge('XT-C', 'XT-D', 20);

  // Aisle vertical edges (4 * 7 = 28)
  const aisles = ['A', 'B', 'C', 'D'];
  for (const a of aisles) {
    // Bottom cross to bay 1
    addEdge(`XB-${a}`, `N-${a}-01`, 10);
    // Bay to bay
    for (let bay = 1; bay < 6; bay++) {
      const b1 = bay.toString().padStart(2, '0');
      const b2 = (bay + 1).toString().padStart(2, '0');
      addEdge(`N-${a}-${b1}`, `N-${a}-${b2}`, 6);
    }
    // Bay 6 to top cross
    addEdge(`N-${a}-06`, `XT-${a}`, 10);
  }

  return edges;
})();

/**
 * Calculates world-space 2D footprint rectangle of a shelf.
 * - L shelves are placed at the -x side of the aisle line.
 * - R shelves are placed at the +x side of the aisle line.
 * - Shelf footprint default: 1.6 m depth (x) × 4.0 m length (y).
 * - Gap from aisle line: 1.4 m.
 */
export function shelfRect(shelf: ShelfInput): ShelfRect {
  const aisleX = shelf.x ?? (AISLE_X[shelf.aisle] ?? 0);
  const bayY = shelf.y ?? (10 + (shelf.bay - 1) * 6);
  const depth = 1.6;
  const length = 4.0;
  const gap = 1.4;

  let x: number;
  if (shelf.side === 'L') {
    x = aisleX - gap - depth;
  } else {
    x = aisleX + gap;
  }

  const y = bayY - length / 2;

  return {
    x,
    y,
    width: depth,
    height: length,
    x0: x,
    x1: x + depth,
    y0: y,
    y1: y + length,
    centerX: x + depth / 2,
    centerY: bayY
  };
}
