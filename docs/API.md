# Dark Storage WMS Public API & Realtime Reference

Base URL: `http://<host>:4000` (Gateway Reverse Proxy & Orchestrator)
WebSocket Endpoint: `ws://<host>:4000/ws`

---

## 1. Authentication & System Endpoints

### `POST /api/auth/login`
- **Access:** Public
- **Request Body:** `{ "username": "manager1", "password": "..." }`
- **Response:** `200 OK`
  ```json
  {
    "token": "eyJhbG...",
    "user": {
      "id": 1,
      "username": "manager1",
      "display_name": "Maya Manager",
      "role": "MANAGER"
    }
  }
  ```

### `GET /api/auth/me`
- **Access:** Authenticated (Any role)
- **Response:** `200 OK` `{ "user": { "id": 1, "username": "manager1", "display_name": "Maya Manager", "role": "MANAGER" } }`

### `GET /health`
- **Access:** Public (Liveness probe)
- **Response:** `200 OK` `{ "status": "ok", "service": "gateway" }`

### `GET /api/health`
- **Access:** Public
- **Response:** `200 OK` Aggregated health check for Gateway, Engine 1, Engine 2, Engine 3.

---

## 2. Products Catalog

### `GET /api/products`
- **Access:** Authenticated (Any role)
- **Query Params:** `search`, `page`, `page_size`
- **Response:** `200 OK` `{ "items": [...], "total": 24, "page": 1, "page_size": 25 }`

### `GET /api/products/:sku`
- **Access:** Authenticated (Any role)
- **Response:** `200 OK` `{ "sku": "SKU001", "name": "Wireless Mouse", "category": "STANDARD", "description": "...", "width": 10, "height": 10, "depth": 10, "weight": 200 }`

---

## 3. Inventory & Warehouse Layout

### `GET /api/inventory/summary`
- **Access:** Authenticated (Any role)
- **Response:** `200 OK` `{ "total_skus": 24, "stored_units": 1200, "reserved_units": 10, "available_units": 1190, "occupied_bins": 24, "total_bins": 192, "fill_pct": 12.5 }`

### `GET /api/inventory/bins`
- **Access:** Authenticated (Any role)
- **Query Params:** `shelf`, `sku`, `status`, `page`, `page_size`
- **Response:** `200 OK` List of bins with coordinates, level, capacity, stored SKU, quantity, reserved quantity, and ATP.

### `GET /api/inventory/movements`
- **Access:** Authenticated (Any role)
- **Query Params:** `movement_type`, `sku`, `page`, `page_size`
- **Response:** `200 OK` Audit movements list (`RECEIVE`, `PUTAWAY`, `PICK`, `RELOCATE`, `ADJUSTMENT`).

### `GET /api/warehouse/layout`
- **Access:** Authenticated (Any role)
- **Response:** `200 OK` 2D coordinates for all 48 shelves (`x`, `y`, `aisle`, `bay`, `side`, `status`) and 192 bins.

---

## 4. Inbound Receiving

### `POST /api/receipts`
- **Access:** `OPERATOR`, `MANAGER`
- **Headers:** `Idempotency-Key` (required)
- **Request Body:**
  ```json
  {
    "supplier": "Acme Supplies",
    "reference_no": "PO-9912",
    "lines": [
      { "sku": "SKU001", "qty": 50 },
      { "sku": "SKU002", "qty": 30 }
    ]
  }
  ```
- **Response:** `201 Created` `{ "ref": "RCV-0001", "status": "RECEIVED", "lines": [...] }`

### `GET /api/receipts`
- **Access:** Authenticated (Any role)
- **Query Params:** `status`, `search`, `page`, `limit`
- **Response:** `200 OK` List of receipts.

### `GET /api/receipts/staged`
- **Access:** Authenticated (Any role)
- **Response:** `200 OK` Staged lines pending put-away.

---

## 5. Put-away & Placement Recommendations

### `POST /api/placement/recommend`
- **Access:** `OPERATOR`, `MANAGER`
- **Request Body:** `{ "receipt_line_id": 1, "qty": 50 }`
- **Response:** `200 OK` Scoring breakdown, `recommended` bin candidate, `alternatives`, and `split_plan`.

### `POST /api/placement/validate`
- **Access:** `OPERATOR`, `MANAGER`
- **Request Body:** `{ "dest_bin": "A-01-L-1", "sku": "SKU001", "qty": 50 }`
- **Response:** `200 OK` Validation check result `{ "valid": true, "reason": "OK" }`.

### `POST /api/putaways`
- **Access:** `OPERATOR`, `MANAGER`
- **Headers:** `Idempotency-Key` (required)
- **Request Body:** `{ "receipt_line_id": 1, "dest_bin": "A-01-L-1", "qty": 50 }`
- **Response:** `201 Created` `{ "ref": "PUT-0001", "status": "COMPLETED", ... }`

### `POST /api/inventory/relocate`
- **Access:** `OPERATOR`, `MANAGER`
- **Headers:** `Idempotency-Key` (required)
- **Request Body:** `{ "from_bin": "A-01-L-1", "to_bin": "A-01-L-2", "qty": 10 }`
- **Response:** `200 OK` Relocation movement result.

---

## 6. Outbound Orders & Picking

### `POST /api/orders`
- **Access:** `MANAGER`
- **Headers:** `Idempotency-Key` (required)
- **Request Body:**
  ```json
  {
    "order_type": "CUSTOMER",
    "priority": "NORMAL",
    "customer_ref": "Mega Retail",
    "lines": [
      { "sku": "SKU001", "qty": 10 },
      { "sku": "SKU002", "qty": 5 }
    ]
  }
  ```
- **Response:** `201 Created` `{ "ref": "ORD-0001", "status": "RESERVED", ... }`

### `POST /api/orders/:ref/cancel`
- **Access:** `MANAGER`
- **Headers:** `Idempotency-Key` (required)
- **Request Body:** `{ "reason": "Customer cancelled" }`
- **Response:** `200 OK` `{ "ref": "ORD-0001", "status": "CANCELLED" }`

### `POST /api/orders/:ref/assign`
- **Access:** `MANAGER` (Orchestrates route planning via Engine 2)
- **Headers:** `Idempotency-Key` (required)
- **Request Body:** `{ "picker_id": 3 }`
- **Response:** `201 Created` `{ "ref": "MIS-0001", "status": "ASSIGNED", ... }`

### `POST /api/orders/:ref/reassign`
- **Access:** `MANAGER`
- **Headers:** `Idempotency-Key` (required)
- **Request Body:** `{ "new_picker_id": 4 }`
- **Response:** `200 OK`

### `GET /api/orders` & `GET /api/orders/:ref`
- **Access:** Authenticated (`PICKER` restricted to own assigned orders; `MANAGER`, `STAFF` see all)
- **Response:** `200 OK`

### `GET /api/missions` & `GET /api/missions/:ref`
- **Access:** Authenticated (`PICKER` restricted to own missions; `MANAGER` sees all)
- **Response:** `200 OK` Mission details with sequenced Held-Karp pick stops.

### `POST /api/missions/:ref/start`
- **Access:** `PICKER` (own mission), `MANAGER`
- **Headers:** `Idempotency-Key` (required)
- **Response:** `200 OK` `{ "ref": "MIS-0001", "status": "IN_PROGRESS" }`

### `POST /api/pick-stops/:stop_ref/confirm`
- **Access:** `PICKER` (own mission), `MANAGER` (Executed through Engine 1 locking scheduler)
- **Headers:** `Idempotency-Key` (required)
- **Request Body:**
  ```json
  {
    "scanned_bin": "A-01-L-1",
    "scanned_sku": "SKU001",
    "picked_qty": 10,
    "exception": { "type": "SHORT_PICK", "notes": "..." }
  }
  ```
- **Response:** `200 OK` `{ "stop": { "status": "PICKED" }, "mission_progress": {...} }`

### `POST /api/pick-stops/:stop_ref/exception`
- **Access:** `PICKER` (own mission), `MANAGER`
- **Request Body:** `{ "type": "BIN_EMPTY", "notes": "Shelf is empty" }`
- **Response:** `201 Created` Pick exception object.

---

## 7. Exceptions Management

### `GET /api/exceptions` & `GET /api/exceptions/:ref`
- **Access:** `PICKER` (own reported exceptions), `MANAGER` (all)
- **Response:** `200 OK` Exception details and status (`OPEN`, `RESOLVED`).

### `POST /api/exceptions/:ref/resolve`
- **Access:** `MANAGER` (Executed through Engine 1 locking scheduler)
- **Headers:** `Idempotency-Key` (required)
- **Request Body:**
  ```json
  {
    "action": "ACCEPT_SHORT", // or "REALLOCATE"
    "notes": "Shortfall accepted",
    "recount": { "counted_qty": 0 }
  }
  ```
- **Response:** `200 OK` Resolution confirmation.

---

## 8. Packing & Completion

### `GET /api/packing/queue`
- **Access:** Authenticated (Any role)
- **Response:** `200 OK` List of orders in status `PICKED` with line verification numbers and `needs_manager_approval` flag.

### `POST /api/orders/:ref/pack` (or `POST /api/packing/:ref/pack`)
- **Access:** `STAFF`, `MANAGER`
- **Headers:** `Idempotency-Key` (required)
- **Request Body:**
  ```json
  {
    "notes": "Packed in standard container",
    "accept_partial": true // required if shortfall exists, MANAGER only
  }
  ```
- **Response:** `201 Created`
  ```json
  {
    "packing_ref": "PCK-0001",
    "order_ref": "ORD-0001",
    "fulfilment_type": "FULL", // or "PARTIAL"
    "total_ordered": 10,
    "total_picked": 10,
    "packed_by": 1,
    "packed_at": "2026-11-02T10:15:00.000Z"
  }
  ```

---

## 9. Dashboard, Audit & Integrity

### `GET /api/dashboard`
- **Access:** Authenticated (Any role)
- **Response:** `200 OK` Real-time SQL aggregations for receiving, inventory, orders, missions, open exceptions, today's movements, latest 10 movements, and Engine 1 scheduler stats.

### `GET /api/audit`
- **Access:** `MANAGER`
- **Query Params:** `entity_type`, `entity_id`, `actor`, `action`, `page`, `page_size`
- **Response:** `200 OK` `{ "items": [...], "total": 42, "page": 1, "page_size": 25 }`

### `GET /api/admin/integrity`
- **Access:** `MANAGER`
- **Response:** `200 OK`
  ```json
  {
    "ok": true,
    "checks": [
      { "id": "I01", "name": "stock bounds", "status": "PASS", "rows": [] },
      ...
      { "id": "I13", "name": "one SKU per reserved SKU", "status": "PASS", "rows": [] }
    ]
  }
  ```

---

## 10. Realtime WebSockets (`/ws`)

### Connection URL
`ws://<host>:4000/ws?token=<jwt>&since=<seq>`

- **Authentication:** Valid JWT query token required; missing or expired token immediately closes socket with status code `4401 UNAUTHENTICATED`.
- **Initial Handshake:** Server immediately emits `{ "type": "connected", "latest_seq": 42 }`.
- **Gap-Free Replay:** If `since > 0`, missed events since that sequence are replayed in order with `"replay": true`. If > 500 events missed or state reset, server emits `{ "type": "resync_required", "latest_seq": 42 }`.
- **Live Broadcasts:** Gateway poller (250 ms tick) broadcasts committed transactions:
  ```json
  {
    "type": "event",
    "seq": 43,
    "event_type": "order.completed",
    "entity_type": "ORDER",
    "entity_id": "ORD-0001",
    "data": { "ref": "ORD-0001", "fulfilment_type": "FULL" },
    "created_at": "2026-11-02T10:15:00.000Z",
    "replay": false
  }
  ```
- **Event Types:**
  - `receipt.created`
  - `putaway.completed`
  - `inventory.changed`
  - `bin.status_changed`
  - `order.created`, `order.status_changed`, `order.completed`
  - `reservation.changed`
  - `mission.assigned`, `mission.started`, `mission.completed`
  - `pick.confirmed`
  - `exception.opened`, `exception.resolved`
