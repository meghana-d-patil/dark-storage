import Database from 'better-sqlite3';

export interface BinSnapshot {
  bin_code: string;
  shelf_code: string;
  level: number;
  capacity: number;
  bin_status: string;
  recount_required: boolean;
  shelf_status: string;
  shelf_storage_class: string;
  nav_node_id: string;
  current_sku: string | null;
  current_product_name: string | null;
  current_category: string | null;
  current_qty: number;
  reserved_qty: number;
  free_capacity: number;
}

export interface ProductSnapshot {
  sku: string;
  name: string;
  category: string;
  storage_class: string;
  active: boolean;
}

export interface PickHistory {
  sku: string;
  picked_units: number;
}

export interface PlacementSnapshot {
  bins: BinSnapshot[];
  product: ProductSnapshot;
  binsByNode: Map<string, BinSnapshot[]>;
  pickHistory: Map<string, number>;
}

export function loadPlacementSnapshot(db: Database.Database, sku: string): PlacementSnapshot {
  const prodRow = db.prepare(`
    SELECT sku, name, category, storage_class, active
    FROM products
    WHERE UPPER(sku) = UPPER(?)
  `).get(sku) as {
    sku: string;
    name: string;
    category: string;
    storage_class: string;
    active: number;
  } | undefined;

  if (!prodRow) {
    throw new Error(`UNKNOWN_SKU: ${sku}`);
  }

  const product: ProductSnapshot = {
    sku: prodRow.sku,
    name: prodRow.name,
    category: prodRow.category,
    storage_class: prodRow.storage_class,
    active: Boolean(prodRow.active)
  };

  const rows = db.prepare(`
    SELECT
      b.code as bin_code,
      b.shelf_code,
      b.level,
      b.capacity,
      b.status as bin_status,
      b.recount_required,
      s.status as shelf_status,
      s.storage_class as shelf_storage_class,
      s.nav_node_id,
      i.sku as current_sku,
      p.name as current_product_name,
      p.category as current_category,
      COALESCE(i.qty, 0) as current_qty,
      COALESCE(i.reserved_qty, 0) as reserved_qty
    FROM bins b
    JOIN shelves s ON s.code = b.shelf_code
    LEFT JOIN inventory i ON i.bin_code = b.code
    LEFT JOIN products p ON p.sku = i.sku
    ORDER BY b.code ASC
  `).all() as Array<{
    bin_code: string;
    shelf_code: string;
    level: number;
    capacity: number;
    bin_status: string;
    recount_required: number;
    shelf_status: string;
    shelf_storage_class: string;
    nav_node_id: string;
    current_sku: string | null;
    current_product_name: string | null;
    current_category: string | null;
    current_qty: number;
    reserved_qty: number;
  }>;

  const bins: BinSnapshot[] = rows.map((r) => ({
    bin_code: r.bin_code,
    shelf_code: r.shelf_code,
    level: r.level,
    capacity: r.capacity,
    bin_status: r.bin_status,
    recount_required: Boolean(r.recount_required),
    shelf_status: r.shelf_status,
    shelf_storage_class: r.shelf_storage_class,
    nav_node_id: r.nav_node_id,
    current_sku: r.current_sku,
    current_product_name: r.current_product_name,
    current_category: r.current_category,
    current_qty: r.current_qty,
    reserved_qty: r.reserved_qty,
    free_capacity: Math.max(0, r.capacity - r.current_qty)
  }));

  const binsByNode = new Map<string, BinSnapshot[]>();
  for (const b of bins) {
    if (!binsByNode.has(b.nav_node_id)) {
      binsByNode.set(b.nav_node_id, []);
    }
    binsByNode.get(b.nav_node_id)!.push(b);
  }

  // Load 30-day pick movements
  const pickRows = db.prepare(`
    SELECT sku, SUM(qty) as picked_units
    FROM stock_movements
    WHERE movement_type = 'PICK'
      AND created_at >= datetime('now', '-30 days')
    GROUP BY sku
  `).all() as Array<{ sku: string; picked_units: number }>;

  const pickHistory = new Map<string, number>();
  for (const pr of pickRows) {
    pickHistory.set(pr.sku.toUpperCase(), pr.picked_units);
  }

  return { bins, product, binsByNode, pickHistory };
}
