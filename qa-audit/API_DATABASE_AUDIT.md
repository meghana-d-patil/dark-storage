# Dark Storage WMS — API & Database Trace Audit

**Audit Date:** 2026-11-11  
**Scope:** Full-path verification: `Frontend -> Gateway -> Engine -> Database -> Response -> UI`

| Operation | HTTP / Endpoint | Engines Invoked | Tables Affected | Ledger Delta | Verdict |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **Receiving Intake** | `POST /api/receipts` | Engine 3 (Inventory) | `receipts, receipt_lines, stock_movements, outbox_events` | +1 receipt (RCV-0011), +10 staged units of SKU001 | **PASS** |
| **Placement Recommendation** | `GET /api/placement/recommend` | Engine 2 (Optimizer) | `bins, inventory (read-only query)` | Zero DB changes (pure analytical scoring) | **PASS** |
| **Confirm Put-Away** | `POST /api/putaways` | Engine 1 (Scheduler) & Engine 3 (Inventory) | `putaways, receipt_lines, inventory, stock_movements` | +1 putaway (PUT-0033), A-01-L-1 inventory +10 | **PASS** |
| **Create Order & Reserve** | `POST /api/orders` | Engine 3 (Inventory) | `orders, order_lines, reservations, inventory` | +1 order (ORD-0010), +1 reservation (3 units HELD in A-01-L-1) | **PASS** |
| **Dispatch Picking Mission** | `POST /api/orders/ORD-0010/assign` | Engine 2 (Optimizer) & Engine 3 (Inventory) | `orders, missions, pick_stops` | order -> ASSIGNED, +1 mission (MIS-0006), +1 pick_stops | **PASS** |
| **Confirm Pick Stop** | `POST /api/pick-stops/MIS-0006-S01/confirm` | Engine 3 (Inventory) | `pick_stops, reservations, inventory, stock_movements, orders` | stop -> PICKED, inventory A-01-L-1 -3 qty & reserved, order -> PICKED | **PASS** |
| **Complete Packing** | `POST /api/orders/ORD-0010/pack` | Engine 3 (Inventory) | `packing_records, orders` | order -> COMPLETED, +1 packing_records (1 boxes) | **PASS** |
