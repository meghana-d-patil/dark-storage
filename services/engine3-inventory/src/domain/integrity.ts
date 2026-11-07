import Database from 'better-sqlite3';

export interface IntegrityCheckResult {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  rows?: unknown[];
  detail?: string;
}

export interface IntegrityReport {
  ok: boolean;
  checks: IntegrityCheckResult[];
}

interface CheckDef {
  id: string;
  name: string;
  tables: string[];
  type?: 'query' | 'fk' | 'sqlite';
  query?: string;
}

export const CHECKS: CheckDef[] = [
  {
    id: 'I01',
    name: 'stock bounds',
    tables: ['inventory', 'bins'],
    type: 'query',
    query: `SELECT i.bin_code FROM inventory i JOIN bins b ON b.code=i.bin_code WHERE i.qty<0 OR i.reserved_qty<0 OR i.reserved_qty>i.qty OR i.qty>b.capacity`
  },
  {
    id: 'I02',
    name: 'reserved = Σ outstanding HELD',
    tables: ['inventory', 'reservations'],
    type: 'query',
    query: `SELECT i.bin_code FROM inventory i LEFT JOIN (SELECT bin_code, SUM(qty-consumed_qty-released_qty) AS held FROM reservations WHERE status='HELD' GROUP BY bin_code) r ON r.bin_code=i.bin_code WHERE i.reserved_qty <> COALESCE(r.held,0)`
  },
  {
    id: 'I03',
    name: 'sku ⇔ qty',
    tables: ['inventory'],
    type: 'query',
    query: `SELECT bin_code FROM inventory WHERE (qty=0 AND sku IS NOT NULL) OR (qty>0 AND sku IS NULL)`
  },
  {
    id: 'I04',
    name: 'bin qty = ledger',
    tables: ['inventory', 'stock_movements'],
    type: 'query',
    query: `SELECT bin_code FROM (SELECT i.bin_code, i.qty, COALESCE((SELECT SUM(CASE WHEN m.to_kind='BIN' AND m.to_ref=i.bin_code THEN m.qty ELSE 0 END) - SUM(CASE WHEN m.from_kind='BIN' AND m.from_ref=i.bin_code THEN m.qty ELSE 0 END) FROM stock_movements m WHERE (m.to_kind='BIN' AND m.to_ref=i.bin_code) OR (m.from_kind='BIN' AND m.from_ref=i.bin_code)),0) AS ledger FROM inventory i) WHERE qty <> ledger`
  },
  {
    id: 'I05',
    name: 'staging = ledger',
    tables: ['products', 'stock_movements', 'receipt_lines'],
    type: 'query',
    query: `SELECT * FROM (SELECT p.sku, (SELECT COALESCE(SUM(CASE WHEN to_kind='STAGING' THEN qty WHEN from_kind='STAGING' THEN -qty ELSE 0 END),0) FROM stock_movements m WHERE m.sku=p.sku) AS ledger, (SELECT COALESCE(SUM(qty_received-qty_put_away),0) FROM receipt_lines rl WHERE rl.sku=p.sku) AS rows_staged FROM products p) WHERE ledger <> rows_staged`
  },
  {
    id: 'I06',
    name: 'put-away totals',
    tables: ['receipt_lines', 'putaways'],
    type: 'query',
    query: `SELECT rl.id FROM receipt_lines rl WHERE rl.qty_put_away <> COALESCE((SELECT SUM(qty) FROM putaways p WHERE p.receipt_line_id=rl.id),0)`
  },
  {
    id: 'I07',
    name: 'picked = consumed',
    tables: ['order_lines', 'reservations'],
    type: 'query',
    query: `SELECT ol.id FROM order_lines ol WHERE ol.qty_picked <> COALESCE((SELECT SUM(consumed_qty) FROM reservations r WHERE r.order_line_id=ol.id),0)`
  },
  {
    id: 'I08',
    name: 'terminal orders hold nothing',
    tables: ['orders', 'reservations'],
    type: 'query',
    query: `SELECT o.ref FROM orders o JOIN reservations r ON r.order_id=o.id WHERE r.status='HELD' AND o.status IN ('PICKED','COMPLETED','CANCELLED')`
  },
  {
    id: 'I09',
    name: 'completed missions finished',
    tables: ['missions', 'pick_stops'],
    type: 'query',
    query: `SELECT m.ref FROM missions m JOIN pick_stops s ON s.mission_id=m.id WHERE m.status='COMPLETED' AND s.status NOT IN ('PICKED','RESOLVED')`
  },
  {
    id: 'I10',
    name: 'held reservations have a live stop',
    tables: ['reservations', 'orders', 'pick_stops', 'missions'],
    type: 'query',
    query: `SELECT r.id FROM reservations r JOIN orders o ON o.id=r.order_id WHERE r.status='HELD' AND o.status IN ('ASSIGNED','PICKING') AND NOT EXISTS (SELECT 1 FROM pick_stops s JOIN missions m ON m.id=s.mission_id WHERE s.reservation_id=r.id AND m.status IN ('ASSIGNED','IN_PROGRESS') AND s.status IN ('PENDING','EXCEPTION_OPEN'))`
  },
  {
    id: 'I11',
    name: 'foreign keys',
    tables: [],
    type: 'fk'
  },
  {
    id: 'I12',
    name: 'sqlite integrity',
    tables: [],
    type: 'sqlite'
  },
  {
    id: 'I13',
    name: 'one SKU per reserved SKU',
    tables: ['reservations', 'inventory'],
    type: 'query',
    query: `SELECT r.id FROM reservations r JOIN inventory i ON i.bin_code=r.bin_code WHERE r.status='HELD' AND i.sku IS NOT r.sku`
  }
];

export function runIntegrityChecks(db: Database.Database): IntegrityReport {
  const existingTables = new Set<string>(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(t => t.name)
  );

  const checks: IntegrityCheckResult[] = [];
  let allOk = true;

  for (const check of CHECKS) {
    const missingTable = check.tables.find(t => !existingTables.has(t));
    if (missingTable) {
      checks.push({
        id: check.id,
        name: check.name,
        status: 'SKIP',
        detail: `Missing required table: ${missingTable}`
      });
      continue;
    }

    try {
      if (check.type === 'fk') {
        const rows = db.pragma('foreign_key_check') as unknown[];
        if (rows.length === 0) {
          checks.push({ id: check.id, name: check.name, status: 'PASS' });
        } else {
          allOk = false;
          checks.push({ id: check.id, name: check.name, status: 'FAIL', rows, detail: `${rows.length} FK violations` });
        }
      } else if (check.type === 'sqlite') {
        const result = db.pragma('integrity_check') as { integrity_check?: string }[];
        const pass = result.length === 1 && result[0]?.integrity_check === 'ok';
        if (pass) {
          checks.push({ id: check.id, name: check.name, status: 'PASS' });
        } else {
          allOk = false;
          checks.push({ id: check.id, name: check.name, status: 'FAIL', rows: result, detail: 'SQLite integrity corrupted' });
        }
      } else if (check.query) {
        const rows = db.prepare(check.query).all();
        if (rows.length === 0) {
          checks.push({ id: check.id, name: check.name, status: 'PASS' });
        } else {
          allOk = false;
          checks.push({ id: check.id, name: check.name, status: 'FAIL', rows, detail: `${rows.length} violating rows` });
        }
      }
    } catch (err) {
      allOk = false;
      checks.push({
        id: check.id,
        name: check.name,
        status: 'FAIL',
        rows: [{ error: String(err) }],
        detail: String(err)
      });
    }
  }

  return { ok: allOk, checks };
}
