import Database from 'better-sqlite3';
import path from 'node:path';
import { createReceipt } from '../services/engine3-inventory/src/domain/receivingRepo.js';
import { executePutaway } from '../services/engine3-inventory/src/domain/putawayRepo.js';

export function seedDemo(db: Database.Database): void {
  // 1. Refuse if any receipt already exists
  const countRow = db.prepare('SELECT COUNT(*) AS c FROM receipts').get() as { c: number };
  if (countRow.c > 0) {
    throw new Error('Refusing to run seed-demo: receipts table is not empty');
  }

  // 2. Fetch operator1
  const operator = db.prepare("SELECT id, display_name, role FROM users WHERE username = 'operator1'").get() as {
    id: number;
    display_name: string;
    role: string;
  };
  if (!operator) {
    throw new Error('User operator1 not found');
  }

  const actor = {
    id: operator.id,
    display_name: operator.display_name,
    name: operator.display_name,
    role: operator.role
  };

  // 3. Build receipt lines for standard SKUs 1..22 and HAZMAT 23..24
  const standardReceiptLines = [];
  for (let k = 1; k <= 22; k++) {
    const skuCode = `SKU${k.toString().padStart(3, '0')}`;
    const qtyK = 40 + (k % 5) * 10;
    const qtyReceived = k === 1 ? qtyK + 10 : qtyK; // SKU001 receives 10 extra, left staged
    standardReceiptLines.push({
      sku: skuCode,
      qty: qtyReceived
    });
  }

  // Create Standard Inbound Receipt
  const stdReceipt = createReceipt(db, {
    supplier: 'Acme Global Logistics',
    reference_no: 'ASN-DEMO-STD-001',
    lines: standardReceiptLines,
    actor
  });

  // Put away standard SKUs
  for (let k = 1; k <= 22; k++) {
    const skuCode = `SKU${k.toString().padStart(3, '0')}`;
    const qtyK = 40 + (k % 5) * 10;

    // Destination bin formula:
    // <A|B|C by (k−1) mod 3>-0<(⌊(k−1)/3⌋ mod 6)+1>-L-<⌊(k−1)/18⌋+1>
    const aisleLetters = ['A', 'B', 'C'];
    const aisle = aisleLetters[(k - 1) % 3];
    const bayNum = (Math.floor((k - 1) / 3) % 6) + 1;
    const bay = bayNum.toString().padStart(2, '0');
    const level = Math.floor((k - 1) / 18) + 1;
    let destBin = `${aisle}-${bay}-L-${level}`;
    const shelf = db.prepare('SELECT status FROM shelves WHERE code = ?').get(`${aisle}-${bay}-L`) as { status: string } | undefined;
    if (shelf && shelf.status !== 'ACTIVE') {
      destBin = `${aisle}-${bay}-R-${level}`;
    }

    const line = stdReceipt.lines.find((l) => l.sku.toUpperCase() === skuCode.toUpperCase());
    if (!line) throw new Error(`Line for ${skuCode} not found in receipt`);

    executePutaway(db, {
      receipt_line_id: line.line_id,
      dest_bin: destBin,
      qty: qtyK,
      recommended_bin: destBin,
      actor
    });
  }

  // Create Hazmat Inbound Receipt
  const hazmatReceipt = createReceipt(db, {
    supplier: 'Apex Chemical Supply',
    reference_no: 'ASN-DEMO-HAZ-001',
    lines: [
      { sku: 'SKU023', qty: 30 },
      { sku: 'SKU024', qty: 30 }
    ],
    actor
  });

  // Put away Hazmat SKUs
  const line23 = hazmatReceipt.lines.find((l) => l.sku === 'SKU023')!;
  executePutaway(db, {
    receipt_line_id: line23.line_id,
    dest_bin: 'D-01-L-1',
    qty: 30,
    recommended_bin: 'D-01-L-1',
    actor
  });

  const line24 = hazmatReceipt.lines.find((l) => l.sku === 'SKU024')!;
  executePutaway(db, {
    receipt_line_id: line24.line_id,
    dest_bin: 'D-01-R-1',
    qty: 30,
    recommended_bin: 'D-01-R-1',
    actor
  });

}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/seed-demo.ts')) {
  const dbPath = process.env.WAREHOUSE_DB_PATH || './data/warehouse.db';
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  try {
    seedDemo(db);
    console.log('Demo seed completed successfully.');
    db.close();
    process.exit(0);
  } catch (err: any) {
    console.error('Demo seed error:', err.message);
    db.close();
    process.exit(1);
  }
}
