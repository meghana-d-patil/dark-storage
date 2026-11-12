import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'node:path';

export function seedBase(db: Database.Database): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run seed in production environment.');
  }

  const defaultPassword = process.env.SEED_DEFAULT_PASSWORD || 'Warehouse#2026';
  const legacyHash = bcrypt.hashSync(defaultPassword, 10);
  const demoHash = bcrypt.hashSync('demo1234', 10);
  const pinHash = bcrypt.hashSync('1111', 10);

  const tx = db.transaction(() => {
    // 1. Users
    const users = [
      // Standard demo accounts (password: demo1234, pin: 1111)
      { username: 'admin', display_name: 'System Admin', role: 'ADMIN', pass: demoHash, badge: 'BADGE-ADMIN', pin: pinHash, zones: '[]', shift: 'MORNING' },
      { username: 'manager', display_name: 'Warehouse Manager', role: 'MANAGER', pass: demoHash, badge: 'BADGE-MGR', pin: pinHash, zones: '[]', shift: 'MORNING' },
      { username: 'operator1', display_name: 'Lead Operator', role: 'OPERATOR', pass: demoHash, badge: 'BADGE-OP1', pin: pinHash, zones: '[]', shift: 'MORNING' },
      { username: 'operator2', display_name: 'Floor Operator 2', role: 'OPERATOR', pass: demoHash, badge: 'BADGE-OP2', pin: pinHash, zones: '[]', shift: 'EVENING' },
      { username: 'picker1', display_name: 'Zone 1 Picker', role: 'PICKER', pass: demoHash, badge: 'BADGE-PK1', pin: pinHash, zones: JSON.stringify(['Z1']), shift: 'MORNING' },
      { username: 'picker2', display_name: 'Multi-Zone Picker', role: 'PICKER', pass: demoHash, badge: 'BADGE-PK2', pin: pinHash, zones: JSON.stringify(['Z1', 'Z2']), shift: 'MORNING' },
      { username: 'picker3', display_name: 'Zone 2 Picker', role: 'PICKER', pass: demoHash, badge: 'BADGE-PK3', pin: pinHash, zones: JSON.stringify(['Z2']), shift: 'EVENING' },
      { username: 'packer1', display_name: 'Packing Bench Staff', role: 'STAFF', pass: demoHash, badge: 'BADGE-STF1', pin: pinHash, zones: '[]', shift: 'MORNING' },
      { username: 'dispatch1', display_name: 'Dispatch Rider Handover', role: 'DISPATCH', pass: demoHash, badge: 'BADGE-DSP1', pin: pinHash, zones: '[]', shift: 'MORNING' },
      { username: 'auditor1', display_name: 'Compliance Auditor', role: 'AUDITOR', pass: demoHash, badge: 'BADGE-AUD1', pin: pinHash, zones: '[]', shift: 'MORNING' },
      // Keep existing seeded legacy accounts working
      { username: 'manager1', display_name: 'Manager 1', role: 'MANAGER', pass: legacyHash, badge: 'BADGE-MGR1', pin: pinHash, zones: '[]', shift: 'MORNING' },
      { username: 'staff1', display_name: 'Staff 1', role: 'STAFF', pass: legacyHash, badge: 'BADGE-STF2', pin: pinHash, zones: '[]', shift: 'MORNING' }
    ];

    const upsertUser = db.prepare(`
      INSERT INTO users (username, display_name, password_hash, role, badge_id, pin_hash, zones, shift, active)
      VALUES (@username, @display_name, @pass, @role, @badge, @pin, @zones, @shift, 1)
      ON CONFLICT(username) DO UPDATE SET
        display_name = excluded.display_name,
        password_hash = excluded.password_hash,
        role = excluded.role,
        badge_id = excluded.badge_id,
        pin_hash = excluded.pin_hash,
        zones = excluded.zones,
        shift = excluded.shift,
        active = 1
    `);
    for (const u of users) {
      upsertUser.run(u);
    }

    // 2. Products
    const products = [
      { sku: 'SKU001', name: 'Wireless Mouse', category: 'Peripherals', storage_class: 'STANDARD', barcode: 'SKU001', weight_g: 120, volume_cc: 250, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'A', price_paise: 149900 },
      { sku: 'SKU002', name: 'Mechanical Keyboard', category: 'Peripherals', storage_class: 'STANDARD', barcode: 'SKU002', weight_g: 850, volume_cc: 1500, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'A', price_paise: 349900 },
      { sku: 'SKU003', name: 'USB-C Hub 7-in-1', category: 'Peripherals', storage_class: 'STANDARD', barcode: 'SKU003', weight_g: 85, volume_cc: 120, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'B', price_paise: 219900 },
      { sku: 'SKU004', name: '27-inch Monitor', category: 'Displays', storage_class: 'STANDARD', barcode: 'SKU004', weight_g: 4800, volume_cc: 16000, fragile: 1, temp_zone: 'AMBIENT', abc_class: 'A', price_paise: 1899900 },
      { sku: 'SKU005', name: 'Webcam 1080p', category: 'Peripherals', storage_class: 'STANDARD', barcode: 'SKU005', weight_g: 160, volume_cc: 300, fragile: 1, temp_zone: 'AMBIENT', abc_class: 'B', price_paise: 249900 },
      { sku: 'SKU006', name: 'USB-C Cable 1m', category: 'Cables', storage_class: 'STANDARD', barcode: 'SKU006', weight_g: 45, volume_cc: 60, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'C', price_paise: 49900 },
      { sku: 'SKU007', name: 'HDMI Cable 2m', category: 'Cables', storage_class: 'STANDARD', barcode: 'SKU007', weight_g: 95, volume_cc: 100, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'C', price_paise: 59900 },
      { sku: 'SKU008', name: 'Ethernet Cable Cat6 5m', category: 'Cables', storage_class: 'STANDARD', barcode: 'SKU008', weight_g: 130, volume_cc: 150, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'C', price_paise: 39900 },
      { sku: 'SKU009', name: 'DisplayPort Cable 1.5m', category: 'Cables', storage_class: 'STANDARD', barcode: 'SKU009', weight_g: 90, volume_cc: 90, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'C', price_paise: 69900 },
      { sku: 'SKU010', name: 'Aluminium Laptop Stand', category: 'Accessories', storage_class: 'STANDARD', barcode: 'SKU010', weight_g: 650, volume_cc: 1200, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'B', price_paise: 129900 },
      { sku: 'SKU011', name: 'Laptop Sleeve 15-inch', category: 'Accessories', storage_class: 'STANDARD', barcode: 'SKU011', weight_g: 220, volume_cc: 800, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'C', price_paise: 89900 },
      { sku: 'SKU012', name: 'Portable SSD 1TB', category: 'Storage', storage_class: 'STANDARD', barcode: 'SKU012', weight_g: 75, volume_cc: 110, fragile: 1, temp_zone: 'AMBIENT', abc_class: 'A', price_paise: 799900 },
      { sku: 'SKU013', name: 'USB Flash Drive 64GB', category: 'Storage', storage_class: 'STANDARD', barcode: 'SKU013', weight_g: 20, volume_cc: 30, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'B', price_paise: 69900 },
      { sku: 'SKU014', name: 'microSD Card 128GB', category: 'Storage', storage_class: 'STANDARD', barcode: 'SKU014', weight_g: 5, volume_cc: 10, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'B', price_paise: 89900 },
      { sku: 'SKU015', name: 'Wi-Fi 6 Router', category: 'Networking', storage_class: 'STANDARD', barcode: 'SKU015', weight_g: 720, volume_cc: 2500, fragile: 1, temp_zone: 'AMBIENT', abc_class: 'A', price_paise: 459900 },
      { sku: 'SKU016', name: 'Network Switch 8-port', category: 'Networking', storage_class: 'STANDARD', barcode: 'SKU016', weight_g: 550, volume_cc: 1800, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'B', price_paise: 229900 },
      { sku: 'SKU017', name: 'Wi-Fi Range Extender', category: 'Networking', storage_class: 'STANDARD', barcode: 'SKU017', weight_g: 180, volume_cc: 400, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'B', price_paise: 179900 },
      { sku: 'SKU018', name: 'Wireless Headset', category: 'Audio', storage_class: 'STANDARD', barcode: 'SKU018', weight_g: 260, volume_cc: 1100, fragile: 1, temp_zone: 'AMBIENT', abc_class: 'A', price_paise: 499900 },
      { sku: 'SKU019', name: 'Bluetooth Speaker', category: 'Audio', storage_class: 'STANDARD', barcode: 'SKU019', weight_g: 450, volume_cc: 900, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'B', price_paise: 299900 },
      { sku: 'SKU020', name: 'LED Desk Lamp', category: 'Office', storage_class: 'STANDARD', barcode: 'SKU020', weight_g: 950, volume_cc: 2200, fragile: 1, temp_zone: 'AMBIENT', abc_class: 'C', price_paise: 159900 },
      { sku: 'SKU021', name: 'Ergonomic Mouse Pad', category: 'Office', storage_class: 'STANDARD', barcode: 'SKU021', weight_g: 280, volume_cc: 500, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'C', price_paise: 49900 },
      { sku: 'SKU022', name: 'Notebook A5 (5-pack)', category: 'Office', storage_class: 'STANDARD', barcode: 'SKU022', weight_g: 600, volume_cc: 750, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'C', price_paise: 39900 },
      { sku: 'SKU023', name: 'Lithium Power Bank 20000mAh', category: 'Batteries', storage_class: 'HAZMAT', barcode: 'SKU023', weight_g: 420, volume_cc: 450, fragile: 1, temp_zone: 'AMBIENT', abc_class: 'A', price_paise: 249900 },
      { sku: 'SKU024', name: 'AA Lithium Batteries 8-pack', category: 'Batteries', storage_class: 'HAZMAT', barcode: 'SKU024', weight_g: 150, volume_cc: 120, fragile: 0, temp_zone: 'AMBIENT', abc_class: 'B', price_paise: 79900 }
    ];

    const insertProduct = db.prepare(`
      INSERT INTO products (sku, name, category, storage_class, unit, max_receive_qty, active, barcode, weight_g, volume_cc, fragile, temp_zone, abc_class, price_paise)
      VALUES (@sku, @name, @category, @storage_class, 'EA', 5000, 1, @barcode, @weight_g, @volume_cc, @fragile, @temp_zone, @abc_class, @price_paise)
      ON CONFLICT(sku) DO UPDATE SET
        barcode = excluded.barcode,
        weight_g = excluded.weight_g,
        volume_cc = excluded.volume_cc,
        fragile = excluded.fragile,
        temp_zone = excluded.temp_zone,
        abc_class = excluded.abc_class,
        price_paise = excluded.price_paise
    `);
    for (const p of products) {
      insertProduct.run(p);
    }

    // 3. Navigation Graph Nodes
    const insertNode = db.prepare(`
      INSERT INTO nav_nodes (id, kind, x, y)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);

    // DOCK and PACK
    insertNode.run('DOCK', 'DOCK', 0, 0);
    insertNode.run('PACK', 'PACK', 80, 0);

    const aisles = ['A', 'B', 'C', 'D'];
    const aisleX: Record<string, number> = { A: 10, B: 30, C: 50, D: 70 };

    // Cross nodes
    for (const a of aisles) {
      insertNode.run(`XB-${a}`, 'CROSS', aisleX[a], 0);
      insertNode.run(`XT-${a}`, 'CROSS', aisleX[a], 50);
    }

    // Aisle nodes: bay 1..6, y = 10 + (bay - 1) * 6
    for (const a of aisles) {
      for (let bay = 1; bay <= 6; bay++) {
        const bayStr = bay.toString().padStart(2, '0');
        const y = 10 + (bay - 1) * 6;
        insertNode.run(`N-${a}-${bayStr}`, 'AISLE', aisleX[a], y);
      }
    }

    // 4. Navigation Graph Edges
    const insertEdge = db.prepare(`
      INSERT INTO nav_edges (from_node, to_node, distance)
      VALUES (?, ?, ?)
      ON CONFLICT(from_node, to_node) DO NOTHING
    `);

    function addEdge(u: string, v: string, dist: number) {
      const [from, to] = u < v ? [u, v] : [v, u];
      insertEdge.run(from, to, dist);
    }

    // Bottom cross edges
    addEdge('DOCK', 'XB-A', 10);
    addEdge('XB-A', 'XB-B', 20);
    addEdge('XB-B', 'XB-C', 20);
    addEdge('XB-C', 'XB-D', 20);
    addEdge('XB-D', 'PACK', 10);

    // Top cross edges
    addEdge('XT-A', 'XT-B', 20);
    addEdge('XT-B', 'XT-C', 20);
    addEdge('XT-C', 'XT-D', 20);

    // Aisle vertical edges
    for (const a of aisles) {
      // XB to N-1
      addEdge(`XB-${a}`, `N-${a}-01`, 10);
      // Bay to bay (dist 6)
      for (let bay = 1; bay < 6; bay++) {
        const b1 = bay.toString().padStart(2, '0');
        const b2 = (bay + 1).toString().padStart(2, '0');
        addEdge(`N-${a}-${b1}`, `N-${a}-${b2}`, 6);
      }
      // N-6 to XT (y=40 to y=50, dist 10)
      addEdge(`N-${a}-06`, `XT-${a}`, 10);
    }

    // 5. Shelves and Bins
    const insertShelf = db.prepare(`
      INSERT INTO shelves (code, aisle, bay, side, storage_class, status, nav_node_id, x, y)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO NOTHING
    `);

    const insertBin = db.prepare(`
      INSERT INTO bins (code, shelf_code, level, capacity, status, recount_required)
      VALUES (?, ?, ?, ?, ?, 0)
      ON CONFLICT(code) DO NOTHING
    `);

    const capacityByLevel: Record<number, number> = { 1: 120, 2: 100, 3: 80, 4: 60 };

    for (const a of aisles) {
      for (let bay = 1; bay <= 6; bay++) {
        const bayStr = bay.toString().padStart(2, '0');
        const navNodeId = `N-${a}-${bayStr}`;
        const x = aisleX[a];
        const y = 10 + (bay - 1) * 6;

        for (const side of ['L', 'R']) {
          const shelfCode = `${a}-${bayStr}-${side}`;
          // Storage class: aisle D bays 1-2 are HAZMAT, others STANDARD
          const storageClass = (a === 'D' && (bay === 1 || bay === 2)) ? 'HAZMAT' : 'STANDARD';
          // Status: B-06-L is MAINTENANCE
          const shelfStatus = (shelfCode === 'B-06-L') ? 'MAINTENANCE' : 'ACTIVE';

          insertShelf.run(shelfCode, a, bay, side, storageClass, shelfStatus, navNodeId, x, y);

          for (let level = 1; level <= 4; level++) {
            const binCode = `${shelfCode}-${level}`;
            const capacity = capacityByLevel[level];
            let binStatus = 'ACTIVE';
            if (binCode === 'D-06-R-3') binStatus = 'BLOCKED';
            if (binCode === 'D-06-R-4') binStatus = 'DAMAGED';

            insertBin.run(binCode, shelfCode, level, capacity, binStatus);
          }
        }
      }
    }

    // 6. Pre-populate inventory rows if inventory table exists
    const hasInventory = db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory'
    `).get();

    if (hasInventory) {
      const allBins = db.prepare('SELECT code FROM bins').all() as { code: string }[];
      const insertInv = db.prepare(`
        INSERT INTO inventory (bin_code, sku, qty, reserved_qty)
        VALUES (?, NULL, 0, 0)
        ON CONFLICT(bin_code) DO NOTHING
      `);
      for (const b of allBins) {
        insertInv.run(b.code);
      }
    }
  });

  tx();
}

// When executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/seed-base.ts')) {
  const warehouseDbPath = process.env.WAREHOUSE_DB_PATH || './data/warehouse.db';
  const db = new Database(warehouseDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  console.log(`Seeding base data into ${warehouseDbPath}...`);
  seedBase(db);
  db.close();
  console.log('Base seed completed successfully.');
}
