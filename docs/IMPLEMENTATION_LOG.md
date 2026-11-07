# Implementation Log

## Phase 1 — Foundation: Plan
### Planned files:
- `package.json` (root workspaces and scripts)
- `tsconfig.base.json`
- `.gitignore`, `.env.example`, `.env`
- `README.md`
- `packages/shared/package.json`
- `packages/shared/tsconfig.json`
- `packages/shared/src/enums.ts`
- `packages/shared/src/errors.ts`
- `packages/shared/src/ids.ts`
- `packages/shared/src/schemas/common.ts`
- `packages/shared/src/schemas/auth.ts`
- `packages/shared/src/schemas/products.ts`
- `packages/shared/src/index.ts`
- `migrations/warehouse/001_core.sql`
- `migrations/warehouse/002_catalog_layout.sql`
- `scripts/migrate.ts`
- `scripts/seed-base.ts`
- `scripts/backup-db.ts`
- `scripts/verify-integrity.ts`
- `services/engine3-inventory/package.json`
- `services/engine3-inventory/tsconfig.json`
- `services/engine3-inventory/src/config.ts`
- `services/engine3-inventory/src/db/connection.ts`
- `services/engine3-inventory/src/db/tx.ts`
- `services/engine3-inventory/src/domain/ids.ts`
- `services/engine3-inventory/src/domain/idempotency.ts`
- `services/engine3-inventory/src/domain/audit.ts`
- `services/engine3-inventory/src/domain/outbox.ts`
- `services/engine3-inventory/src/middleware/internalAuth.ts`
- `services/engine3-inventory/src/middleware/errorHandler.ts`
- `services/engine3-inventory/src/routes/health.ts`
- `services/engine3-inventory/src/routes/auth.ts`
- `services/engine3-inventory/src/routes/products.ts`
- `services/engine3-inventory/src/routes/integrity.ts`
- `services/engine3-inventory/src/server.ts`
- `services/engine2-optimizer/package.json`
- `services/engine2-optimizer/tsconfig.json`
- `services/engine2-optimizer/src/config.ts`
- `services/engine2-optimizer/src/middleware/internalAuth.ts`
- `services/engine2-optimizer/src/routes/health.ts`
- `services/engine2-optimizer/src/server.ts`
- `services/engine1-scheduler/package.json`
- `services/engine1-scheduler/tsconfig.json`
- `services/engine1-scheduler/src/config.ts`
- `services/engine1-scheduler/src/middleware/internalAuth.ts`
- `services/engine1-scheduler/src/routes/health.ts`
- `services/engine1-scheduler/src/server.ts`
- `services/gateway/package.json`
- `services/gateway/tsconfig.json`
- `services/gateway/src/config.ts`
- `services/gateway/src/clients/engine3.ts`
- `services/gateway/src/middleware/auth.ts`
- `services/gateway/src/middleware/rbac.ts`
- `services/gateway/src/middleware/errorHandler.ts`
- `services/gateway/src/routes/auth.ts`
- `services/gateway/src/routes/health.ts`
- `services/gateway/src/routes/products.ts`
- `services/gateway/src/server.ts`
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- `apps/web/vite.config.ts`
- `apps/web/index.html`
- `apps/web/src/theme.css`
- `apps/web/src/main.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/stores/authStore.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/components/AppShell.tsx`
- `apps/web/src/pages/LoginPage.tsx`
- `apps/web/src/pages/HomePage.tsx`
- `tests/harness/tempDb.ts`
- `tests/harness/apiClient.ts`
- `tests/harness/stack.ts`
- `tests/phase1/phase1.test.ts`
- `vitest.config.ts`


## Phase 1 Execution & Verification
- All planned files implemented.
- Schema migrations applied forward-only with SHA-256 checksum checks.
- Deterministic base seeding loaded 5 users, 24 products, 48 shelves, 192 bins, 34 navigation nodes, and 36 navigation edges.
- Error handling standardized with DomainError error envelopes and trigger matching.
- Multi-process stack test harness verified spawning Gateway, Engine 1, Engine 2, and Engine 3 with health checks and dynamic port allocation.
- Tests execution:
  - `vitest run tests/phase1/phase1.test.ts`: 16/16 passed in 2.87s.
  - `verify:integrity`: 13 checks evaluated (11 SKIP on unmigrated phase tables, 2 PASS on foreign keys and SQLite integrity).
  - Web UI: `npm run build -w apps/web` completed with zero TypeScript or Vite errors.
- Phase 1 gate: PASSED.


## Phase 2 — Inventory Core: Execution & Verification
- Applied migration `migrations/warehouse/003_inventory_ledger.sql`:
  - `inventory` table with constraints (`qty >= 0`, `reserved_qty >= 0`, `reserved_qty <= qty`, `(qty = 0 AND sku IS NULL) OR (qty > 0 AND sku IS NOT NULL)`).
  - Triggers: `inventory_capacity_upd`, `inventory_capacity_ins`, `inventory_sku_mix`, `inventory_receivable`, `inventory_storage_class`.
  - `stock_movements` append-only table with `mov_no_update`, `mov_no_delete` triggers.
  - `v_available_stock` view defining sellable stock.
- Implemented `services/engine3-inventory/src/domain/inventoryRepo.ts`:
  - `stockIn`, `stockOut`, `reserve`, `release`, `recordMovement`, `applyRecount`.
- Implemented routes and schemas:
  - Shared schemas in `packages/shared/src/schemas/inventory.ts`.
  - Engine 3 routes in `routes/inventory.ts` and `routes/warehouse.ts`.
  - Gateway routes in `routes/inventory.ts` and `routes/warehouse.ts` with RBAC (MANAGER for status/recount, authenticated for reads).
- Built React pages in `apps/web`:
  - `pages/InventoryPage.tsx` with Summary, Bins (drawer + recount modal), and Ledger tabs.
  - `pages/WarehousePage.tsx` with 2D HTML/CSS layout (4 aisles, 48 shelves, 192 bins), fill level coloring, status badges, locate search, and tooltips.
- Verification:
  - `vitest run tests/phase2/phase2.test.ts`: 20/20 passed in 3.02s.
  - Full test suite: 36/36 passed in 5.66s.
  - `verify:integrity`: I01, I03, I04, I11, I12 PASS; others appropriately SKIP pending future phase tables.
  - `npm run build -w apps/web`: clean build.
- Phase 2 gate: PASSED.


## Phase 3 — Receiving: Execution & Verification
- Applied migration `migrations/warehouse/004_receiving.sql`:
  - `receipts` table with `ref`, `supplier`, `reference_no`, `notes`, `received_at`, `received_by`, `status`.
  - `receipt_lines` table with `line_no`, `sku`, `qty_received`, `qty_put_away`, `movement_ref`.
- Implemented `services/engine3-inventory/src/domain/receivingRepo.ts`:
  - Atomic multi-line intake recording with FIFO movement records (`RECEIVE`, `EXTERNAL` -> `STAGING`), audit logs, and outbox event `receipt.created`.
- Shared schemas created in `packages/shared/src/schemas/receiving.ts`.
- Routes created and mounted:
  - Engine 3 routes in `routes/receipts.ts` (`POST /internal/v1/receipts`, `GET /internal/v1/receipts/staged`, `GET /internal/v1/receipts`, `GET /internal/v1/receipts/:ref`, `GET /internal/v1/receipts/lines/:id`).
  - Gateway routes in `routes/receipts.ts` with RBAC (`MANAGER`, `OPERATOR` for POST; authenticated for reads) and mandatory `Idempotency-Key` header checking.
- Built React Receiving page (`apps/web/src/pages/ReceivingPage.tsx`):
  - New Intake tab with type-ahead product picker, duplicate guard, summary strip, idempotency tracking, and real server receipt confirmation banner.
  - Staged Stock tab with FIFO outstanding lines.
  - Receipts tab with searchable list and drawer showing lines, movement refs, and audit trail.
- Verification:
  - `vitest run tests/phase3/phase3.test.ts`: 13/13 passed in 3.52s.
  - Full test suite: 49/49 passed in 10.73s.
  - `verify:integrity`: I01, I03, I04, I05, I11, I12 all PASS.
  - `npm run build -w apps/web`: clean build.
- Phase 3 gate: PASSED.


## Phase 4 — Engine 2 Smart Allocation: Execution & Verification
- Implemented Engine 2 modules:
  - Graph loader: `graph/loadGraph.ts` with 60-second caching.
  - Dijkstra shortest path: `graph/dijkstra.ts`. Verified: `dist(DOCK, N-A-01)=20`, `dist(DOCK, N-A-06)=50`, `dist(DOCK, N-D-01)=80`, `dist(DOCK, PACK)=80`.
  - Database snapshot query: `placement/snapshot.ts` (read-only, no mutations).
  - Candidate filter: `placement/filter.ts` evaluating 8 rejection reasons in exact PRD order.
  - Candidate scoring: `placement/score.ts` with 5 factors (distance, consolidation, utilization, affinity, velocity) and dynamic weight renormalization. Verified Golden Unit Test score = `76.47`.
  - Recommendation orchestrator: `placement/recommend.ts` (deterministic ranking, split plan, factor contribution explanations).
- Engine 2 server & routes:
  - `routes/placement.ts`: `POST /internal/v1/placement/recommend` and `POST /internal/v1/placement/validate`.
- Gateway orchestration:
  - `clients/engine2.ts`.
  - `routes/placement.ts`: `POST /api/placement/recommend` (loads line from Engine 3, validates staged quantity, calls Engine 2, merges response) and `POST /api/placement/validate`.
- Web Frontend:
  - `components/AllocationModal.tsx`: Recommended bin card, factor breakdown bars, alternatives list, split plan notification, full 192-bin manual selection toggle with disabled invalid rows, and live validation.
  - Wired into `ReceivingPage.tsx` under Staged Stock tab with "Allocate" button.
- Verification:
  - `vitest run tests/phase4/phase4.test.ts`: 16/16 passed in 3.55s.
  - Full test suite: 65/65 passed in 13.32s.
  - `verify:integrity`: exits 0 with all applicable checks PASS.
  - `npm run build -w apps/web`: clean build.
- Phase 4 gate: PASSED.


## Phase 5 — Engine 1 Scheduler + Coordinated Put-away: Execution & Verification
- Applied migrations:
  - `migrations/scheduler/s001_scheduler.sql`: created `tasks`, `locks`, `lock_tokens`, `task_events`.
  - `migrations/warehouse/005_putaway.sql`: created `putaways` table.
- Implemented Engine 1 Scheduler (`services/engine1-scheduler/src/`):
  - Lock manager (`domain/lockManager.ts`): atomic single-transaction `tryAcquireAll`, `releaseLocks`, `extendLease`, `sweepExpiredLocks`.
  - Priority Queue (`domain/queue.ts`): Base scores (LOW: 10, NORMAL: 20, HIGH: 30, URGENT: 40) + aging bonus `min(30, floor(wait_seconds / 15))`.
  - Task Executor (`domain/executor.ts`): Lease heartbeat, command mapping, 4xx non-retry domain error preservation, 5xx exponential backoff retries (1s, 2s) up to 3 attempts.
  - Scheduler Engine (`domain/scheduler.ts`): Crash recovery at startup (`recoverCrash` resets RUNNING tasks to QUEUED and cleans dead locks), tick loop with MAX_CONCURRENCY(4) and head-of-line protection, periodic lock sweeper, `waitForTask` long-polling.
  - Engine 1 API routes: `POST /internal/v1/tasks`, `GET /internal/v1/tasks/:id?wait_ms=`, `GET /internal/v1/tasks`, `GET /internal/v1/locks`, `GET /internal/v1/queue`.
- Implemented Engine 3 Put-away & Relocation:
  - `domain/putawayRepo.ts`: `executePutaway` and `executeRelocate` wrapped in `runTx` with full revalidation, movement recording (`PUTAWAY`, `RELOCATE`), audit, and outbox event emissions.
  - Command routing (`routes/commands.ts`): `POST /internal/v1/commands/:commandName` inside `runIdempotent`.
  - `routes/putaways.ts`: `GET /internal/v1/putaways`.
- Implemented Gateway orchestration:
  - `clients/engine1.ts`: `runViaEngine1` helper with long-polling, 202 async fallback, and 503 error handling.
  - `routes/putaways.ts`: `POST /api/putaways` (via Engine 1) and `GET /api/putaways`.
  - `routes/inventory.ts`: `POST /api/inventory/relocate` (via Engine 1).
  - `routes/tasks.ts`: `GET /api/tasks/:id`, `GET /api/tasks`, `/locks`, `/queue` (MANAGER).
- Seed demo script:
  - `scripts/seed-demo.ts`: deterministic intake and put-away for SKUs 1..24, respects shelf status (falls back to active side if shelf maintenance).
- Web UI:
  - `AllocationModal.tsx`: Added "Confirm put-away" with 202 async polling, live validation, and idempotency protection.
  - `ReceivingPage.tsx`: Put-aways tab displaying completed putaways with mode badges.
  - `InventoryPage.tsx`: Relocate modal with destination bin validation.
  - `TasksPage.tsx`: Manager tasks dashboard with live tasks, locks, and queue inspection.
- Verification:
  - `vitest run tests/phase5/phase5.test.ts`: 30/30 passed.
  - Full test suite: 95/95 passed.
  - `verify:integrity`: exits 0 with checks I01, I03, I04, I05, I06, I11, I12 PASS.
  - `npm run build -w apps/web`: clean build.
- Phase 5 gate: PASSED.

## Phase 6 — Manual Orders & Stock Reservations: Execution & Verification
- Applied migrations:
  - `migrations/warehouse/006_orders.sql`: created `orders`, `order_lines`, and `reservations` tables with integrity constraints, check constraints (`status <> 'HELD' OR consumed_qty + released_qty < qty`), and indexing.
- Implemented Shared Schemas (`packages/shared/src/schemas/orders.ts`):
  - `createOrderSchema`: validates line limits (1..50), line quantities (1..10000), duplicate SKU prevention via `.refine()`, priorities, and order types.
  - `cancelOrderSchema`: validates reason length (3..200).
  - `orderQuerySchema`: handles pagination and filters.
  - Exported interfaces: `OrderDto`, `OrderLineDto`, `ReservationDto`, `OrderSummaryDto`.
- Implemented Engine 3 Orders Domain (`services/engine3-inventory/src/domain/ordersRepo.ts`):
  - `allocateStock`: Best-fit single-bin allocation (smallest bin satisfying alone) with greedy multi-bin fallback (fewest stops), excluding inactive/blocked bins via `v_available_stock`.
  - `executeReserveOrder`: Atomic all-or-nothing stock reservation within `runTx`. Checks line constraints, pre-checks ATP to prevent sequence consumption on shortage, reserves stock, creates reservations with status `HELD`, records audit log, and emits outbox events.
  - `cancelOrder`: Cancels orders in cancellable statuses (`RESERVED`, `ASSIGNED`, `PICKING`, `PICKED` with 0 picked units), releases outstanding reservations atomically, marks status `CANCELLED`, records unreturned picked items, audits, and emits outbox events.
  - `getOrder` & `listOrders`: Detailed retrieval with lines, reservations, summary stats, and audit entries.
- Mounted Engine 3 Commands and Routes:
  - `routes/commands.ts`: added `reserve-order` command mapping inside `runIdempotent`.
  - `routes/orders.ts`: added `GET /internal/v1/orders`, `GET /internal/v1/orders/:ref`, and `POST /internal/v1/orders/:ref/cancel`.
- Implemented Gateway Orchestration (`services/gateway/src/routes/orders.ts`):
  - `POST /api/orders`: MANAGER role, enqueues `RESERVE_ORDER` in Engine 1 locking all order SKUs with mapped priority, long-polls for synchronous 201 or 202 async fallback.
  - `POST /api/orders/:ref/cancel`: MANAGER role, proxies direct to Engine 3 with idempotency key.
  - `GET /api/orders` & `GET /api/orders/:ref`: readable by all authenticated roles (including PICKER).
- Implemented Web Frontend:
  - `OrdersPage.tsx`: Filterable orders table (status, priority, search), badges, pagination, and direct link to creation.
  - `NewOrderPage.tsx`: Type-ahead product search with Stored, Reserved, and Available (ATP) chips; editable line table; over-ATP submit prevention banner; async polling on 202; and shortage breakdown table on 409 `INSUFFICIENT_STOCK`.
  - `OrderDetailPage.tsx`: Order facts card, reservation status strip, expandable per-line reservation breakdown by bin, audit history timeline, and cancellation modal with reason input.
  - Navigation: added Orders link to `AppShell.tsx` navigation bar.
- Verification:
  - `vitest run tests/phase6/phase6.test.ts`: 21/21 passed in 5.81s.
  - Full test suite: 116/116 passed across Phases 1-6 in 27.99s.
  - `verify:integrity`: exits 0 with all checks PASS or valid SKIP.
  - `npm run build -w apps/web`: clean build (zero TypeScript/Vite errors).
- Phase 6 gate: PASSED.

## Phase 7 — Assignment & Route Optimization: Execution & Verification
- Applied migrations:
  - `migrations/warehouse/007_missions.sql`: created `missions` and `pick_stops` tables with partial unique index `uq_mission_active_order` (`WHERE status IN ('ASSIGNED','IN_PROGRESS')`), stop sequence constraints, foreign keys, and indexes.
- Implemented Shared Schemas (`packages/shared/src/schemas/missions.ts`):
  - `assignMissionSchema`: validates `picker_id`.
  - `reassignMissionSchema`: validates `picker_id`.
  - `missionQuerySchema`: handles pagination and status/picker filters.
  - Exported interfaces: `MissionDto`, `PickStopDto`, `MissionProgressDto`.
- Implemented Engine 2 Route Planning (`services/engine2-optimizer/src/routing/`):
  - `dijkstra.ts`: Dijkstra distance matrix calculation with deterministic tie-breaking (node ID ascending).
  - `astar.ts`: A* pathfinding using Euclidean distance heuristic (`h(n) = sqrt(dx^2 + dy^2)`).
  - `heldKarp.ts`: Exact TSP dynamic programming algorithm for `m <= 10` waypoints with fixed start (`DOCK`) and end (`PACK`).
  - `twoOpt.ts`: Nearest-neighbour initial tour followed by 2-opt edge-exchange heuristic up to 1000 passes for `m > 10` waypoints.
  - `planRoute.ts`: Waypoint aggregation by node, reachability check throwing 422 `ROUTE_UNREACHABLE` on isolated nodes, within-node stop ordering by `(shelf_code ASC, level ASC)`, leg computation with A*, and 2 decimal place rounding.
  - Mounted `POST /internal/v1/routes/plan` in `routes/routing.ts`.
- Implemented Engine 3 Missions Domain (`services/engine3-inventory/src/domain/missionsRepo.ts`):
  - `getPickPlan`: Validates order is `RESERVED`, loads `HELD` reservations, and computes SHA-256 `plan_token`.
  - `assignMission`: Atomic execution in `runTx`. Checks `plan_token` (throws 409 `PLAN_STALE` on concurrency), verifies active `PICKER` role, creates `missions` with route metadata, creates 1:1 `pick_stops` with reservation keys and sequential stop refs (`MIS-0001-S01..`), updates order status to `ASSIGNED`, audits `MISSION_ASSIGNED`, and emits outbox events.
  - `reassignMission`: Reassigns picker while mission is in `ASSIGNED` status; rejects if started.
  - `startMission`: Verifies caller is assigned picker (else 403 `NOT_YOUR_MISSION`), transitions mission to `IN_PROGRESS` and order to `PICKING`, audits, and emits events.
  - `getMission` & `listMissions`: Full DTO loading including picker details, route legs, progress, and stops.
  - `getActivePickers`: Returns active pickers with their open missions count.
  - Mounted internal routes in `routes/missions.ts`.
- Implemented Gateway Orchestration:
  - `POST /api/orders/:ref/assign`: MANAGER role, fetches pick-plan from Engine 3, requests route plan from Engine 2, assigns mission in Engine 3 with automatic 1-retry on `PLAN_STALE`.
  - `POST /api/orders/:ref/reassign`: MANAGER role, proxies reassignment.
  - `POST /api/missions/:ref/start`: PICKER role, proxies mission start.
  - `GET /api/missions`: Restricts `PICKER` role strictly to own missions; managers can see all.
  - `GET /api/missions/:ref`: Enforces picker ownership check.
  - `GET /api/users?role=PICKER`: Returns active pickers with open mission counts.
- Implemented Web UI:
  - `OrderDetailPage.tsx`: Added "Assign Picker" button for `RESERVED` orders and "Reassign" button for `ASSIGNED` orders. Modal displays eligible pickers with open missions count. Facts card displays active mission link, route distance, and algorithm.
  - `OrdersPage.tsx`: Added "Awaiting assignment" status filter for manager workflow.
  - `PickingPage.tsx` (`/picking`): "My missions" card/table for Pickers; filterable mission monitoring for Managers.
  - `MissionDetailPage.tsx` (`/picking/:ref`): Route panel with algorithm badge, total distance, textual leg breakdown (`DOCK → XB-A → N-A-01 (20.0)`), stops table in visit order (`seq`), and "Start mission" button for assigned picker.
  - Navigation: added Picking link in `AppShell.tsx` for `PICKER` and `MANAGER`.
- Verification:
  - `vitest run tests/phase7/phase7.test.ts`: 19/19 passed in 7.37s.
  - Full test suite: 135/135 passed across Phases 1-7 in 36.74s.
  - `verify:integrity`: exits 0 with all checks PASS or valid SKIP.
  - `npm run build -w apps/web`: clean build.
- Phase 7 gate: PASSED.

## Phase 8 — Actual Picking, Stock Deduction & Exceptions: Execution & Verification
- Applied migrations:
  - `migrations/warehouse/008_exceptions.sql`: created `pick_exceptions` table with unique partial index `uq_exc_open_stop` (`WHERE status = 'OPEN'`), status index, foreign keys, and check constraints.
- Implemented Shared Schemas (`packages/shared/src/schemas/picking.ts`):
  - `confirmPickSchema`: validates `scanned_bin`, `scanned_sku`, `picked_qty`, and optional exception for short picks.
  - `reportProblemSchema`: validates `type` (`BIN_EMPTY`, `DAMAGED`, `WRONG_PRODUCT`, `OTHER`) and notes (3..300 chars).
  - `resolveExceptionSchema`: validates `action` (`REALLOCATE`, `ACCEPT_SHORT`), notes, and optional recount `{ counted_qty }`.
  - `exceptionQuerySchema`: handles pagination, status filter, and mission filter.
  - Exported interfaces: `PickExceptionDto`, `PickConfirmationResultDto`.
- Implemented Engine 3 Picking & Exceptions Domain (`services/engine3-inventory/src/domain/pickingRepo.ts`):
  - `executePickConfirm`: Validates picker assignment, mission `IN_PROGRESS`, stop `PENDING`, verifies scanned bin and SKU, checks outstanding quantity, calls `stockOut(consumeReserved = true)`, updates reservation `consumed_qty`, writes `PICK` movement to `stock_movements`, increments `order_lines.qty_picked`, opens exception on short pick and sets `bin.recount_required = 1`, audits `PICK_CONFIRMED`, emits events (`pick.confirmed`, `inventory.changed`, `reservation.changed`), and invokes `maybeCompleteMission`.
  - `executeReportProblem`: Zero pick problem reporting; opens `pick_exceptions`, marks stop `EXCEPTION_OPEN`, sets `bin.recount_required = 1` (except for `OTHER`), audits, and emits outbox events without stock changes.
  - `executeResolveException`: Releases remaining reservation; runs optional `applyRecount` (clearing `recount_required`); handles `ACCEPT_SHORT` (increments `order_lines.qty_short`) or `REALLOCATE` (allocates stock excluding exception bin, creates new reservations and appends new stops); marks stop and exception `RESOLVED`; completes mission if all finished; audits and emits events.
  - `getException`, `listExceptions`, `getRerouteInput`, `rerouteMission`.
  - Extended `cancelOrder` to resolve open exceptions with `ORDER_CANCELLED`, mark stops `RESOLVED`, and record `unreturned_picked` in audit.
- Integrated Commands & Routes:
  - Added `pick-confirm` and `exception-resolve` to Engine 3 command router (`services/engine3-inventory/src/routes/commands.ts`).
  - Added internal picking routes (`services/engine3-inventory/src/routes/picking.ts`).
- Implemented Gateway Orchestration:
  - `POST /api/pick-stops/:stop_ref/confirm`: PICKER role (own mission); loads stop to derive shelf resource, routes through Engine 1 (`PICK_CONFIRM`, resource `shelf:<shelf>`).
  - `POST /api/pick-stops/:stop_ref/exception`: PICKER role (own mission); proxies directly to Engine 3.
  - `GET /api/exceptions`: PICKER restricted strictly to own reported exceptions; MANAGER sees all.
  - `GET /api/exceptions/:ref`: Enforces picker ownership check.
  - `POST /api/exceptions/:ref/resolve`: MANAGER role; loads exception to derive SKU resource, routes through Engine 1 (`EXCEPTION_RESOLVE`, resource `sku:<SKU>`), then triggers best-effort rerouting if new stops were created.
- Implemented Web UI:
  - `MissionDetailPage.tsx`: Added Active Stop Card when `IN_PROGRESS`, scanned bin/sku inputs, picked quantity, short pick exception inputs, friendly error messages (`PRODUCT_MISMATCH`, `BIN_MISMATCH`, `QUANTITY_EXCEEDS_RESERVATION`), retry key reuse, problem reporting modal, and visual progress bars.
  - `ExceptionsPage.tsx`: Created `/exceptions` route with filterable exceptions table, pagination, facts card, and resolve modal supporting both "Reallocate" and "Accept short" with optional recount.
  - Added `/exceptions` to `App.tsx` and `AppShell.tsx`.
- Verification:
  - `vitest run tests/phase8/phase8.test.ts`: 26/26 passed.
  - Full test suite: 161/161 passed across all 8 test suites in 43.66s.
  - `npm run verify:integrity`: exits 0 with all 13 checks PASS (I01–I13 PASS).
  - `npm run build -w apps/web`: clean build in 791ms.
- Phase 8 gate: PASSED.

## Phase 9 — Packing, Order Completion, Dashboard & Audit: Execution & Verification
- Applied migrations:
  - `migrations/warehouse/009_packing.sql`: created `packing_records` table with unique ref, foreign keys (`order_id`, `mission_id`, `packed_by`), check constraints (`fulfilment_type IN ('FULL','PARTIAL')`, `total_ordered > 0`, `total_picked > 0`), and timestamp. Applied to `./data/warehouse.db`.
- Implemented Shared Schemas (`packages/shared/src/schemas/packing.ts`):
  - `packOrderSchema`: validates optional `notes` (max 300 chars) and `accept_partial` boolean flag.
  - `auditQuerySchema`: handles pagination, `entity_type`, `entity_id`, `actor`, and `action` filters.
  - Exported interfaces: `PackingQueueItemDto`, `PackingQueueLineDto`, `PackingQueueExceptionDto`, `PackingResultDto`, `AuditItemDto`, `DashboardDto`.
  - Re-exported via `packages/shared/src/index.ts`.
- Implemented Engine 3 Packing Domain (`services/engine3-inventory/src/domain/packingRepo.ts`):
  - `getPackingQueue`: Queries orders in status `PICKED`, ordered by priority; returns per-line numbers (`qty_ordered`, `qty_picked`, `qty_short`), totals, `fulfilment_preview`, `needs_manager_approval` flag, and associated exceptions.
  - `executePackOrder`: Implements exact 10-step validation in `runIdempotent` + `runTx`:
    1. Order status == `PICKED` (else `ORDER_STATE_INVALID`).
    2. Latest mission of order is `COMPLETED` (else `PACK_INCOMPLETE`).
    3. No stop `PENDING`/`EXCEPTION_OPEN`, no `OPEN` exception for order (else `PACK_INCOMPLETE`).
    4. Every line: `qty_picked + qty_short == qty_ordered` (else `PACK_INCOMPLETE`).
    5. Committed-deduction check: $\sum \text{PICK movements} == \sum \text{order\_lines.qty\_picked} == \sum \text{reservations.consumed\_qty}$ (else `INVENTORY_DRIFT`).
    6. `total_picked == 0` throws `PACK_INCOMPLETE {reason: 'NOTHING_PICKED'}` (order must be cancelled).
    7. If shortfall exists: actor must be `MANAGER` (else `PARTIAL_PACK_FORBIDDEN` 403) and `accept_partial` must be true (else `PACK_INCOMPLETE {requires_accept_partial: true, shortfall}`).
    8. Inserts `packing_records(ref = nextRef('packing'), packed_by, fulfilment_type, totals, notes)`; updates `orders.status = 'COMPLETED'`, `fulfilment_type`, `completed_at`.
    9. Audits `ORDER_PACKED`; emits `order.completed` and `order.status_changed`.
    10. Returns 201 result DTO.
- Implemented Engine 3 Dashboard & Audit Domain (`services/engine3-inventory/src/domain/dashboardRepo.ts`):
  - `getDashboardMetrics`: Independent SQL aggregations for receiving today, staged units/lines, inventory (ATP, stored, reserved, unavailable, occupied/total bins, fill pct), orders by status, missions by status, open exceptions, movements today by type, and latest 10 formatted movements.
  - `getAuditLogs`: Filterable audit log queries with pagination and actor lookup.
- Implemented Engine 1 Stats Endpoint (`services/engine1-scheduler/src/routes/tasks.ts`):
  - `GET /internal/v1/stats`: returns `{ queued_tasks, running_tasks, failed_tasks_24h }`.
- Implemented Gateway Endpoints:
  - `GET /api/packing/queue`: all authenticated roles can read.
  - `POST /api/packing/:ref/pack` and `POST /api/orders/:ref/pack`: STAFF and MANAGER roles, requires `Idempotency-Key`, proxies to Engine 3.
  - `GET /api/dashboard`: merges Engine 3 metrics with Engine 1 stats (`engine: null` fallback if unreachable).
  - `GET /api/audit`: MANAGER only, filterable audit log.
  - `GET /api/admin/integrity`: MANAGER only, runs all 13 integrity checks via Engine 3.
- Implemented Web UI:
  - `PackingPage.tsx` (`/packing`): Order queue on left with priority badges, lines inspection table on right with checkmarks/warnings, notes input, disabled button for STAFF when partial pack, checkbox confirmation for MANAGER when partial pack, success banner.
  - `HomePage.tsx` (`/`): Real-time operations dashboard with service-health dots, 7 metric cards, warehouse fill bar, today's movement throughput cards, and latest 10 movements table.
  - `AdminPage.tsx` (`/admin`): Tabbed manager view:
    - Tab 1: Audit Log with entity/action/actor filters, paginated table, details inspection.
    - Tab 2: Database Integrity with "Run integrity checks" button, overall status badge, and detailed check table with offending rows display.
  - Mounted routes in `App.tsx` and updated navigation in `AppShell.tsx`.
- Verification:
  - `vitest run tests/phase9/phase9.test.ts`: 15/15 passed.
  - Full test suite: 176/176 passed across all 9 test suites in 64.92s.
  - `npm run verify:integrity`: exits 0 with all 13 checks PASS (I01–I13 PASS).
  - `npm run build -w apps/web`: clean production build in 1.24s.
- Phase 9 gate: PASSED.

## Phase 10 — Realtime (WebSocket + Outbox Replay), Hardening, Full E2E & Final Report: Execution & Verification
- Implemented Transactional Outbox Feed (`services/engine3-inventory/src/routes/outbox.ts`):
  - `GET /internal/v1/outbox?after_seq=0&limit=100`: Queries `outbox_events` table for `seq > @after_seq`, orders by `seq ASC`, parses `data_json` payload, and returns `{ latest_seq, events: [...] }`.
  - Mounted on Engine 3 server (`services/engine3-inventory/src/server.ts`).
- Implemented Gateway WebSocket Hub & Outbox Poller (`services/gateway/src/ws/hub.ts`):
  - Attached `ws.WebSocketServer` to Gateway HTTP server at `/ws`.
  - Authentication on connect: verifies JWT query parameter `?token=`; immediately rejects missing, expired, or invalid tokens with close code `4401 UNAUTHENTICATED`.
  - Initial handshake: emits `{ type: "connected", latest_seq }`.
  - Historical gap-free replay: if `since > 0`, retrieves missed events from Engine 3 and emits with `replay: true` in strict sequence order; sends `resync_required` if > 500 events missed or state reset.
  - Background poller: polls Engine 3 outbox every 250ms and broadcasts new events with `replay: false` to all connected authenticated clients.
  - Heartbeat: pings clients every 20s; terminates unresponsive connections after timeout.
  - Integrated with Gateway server (`services/gateway/src/server.ts`) with graceful shutdown on SIGINT/SIGTERM.
- Implemented Frontend Realtime Invalidation (`apps/web/src/`):
  - `stores/realtimeStore.ts`: Zustand store tracking `lastSeq`, `connected`, and `statusText`.
  - `hooks/useRealtime.ts`: WebSocket client hook connecting with automatic exponential backoff (500ms → 1s → 2s → max 5s) passing `since=${lastSeq}`; invalidates React Query caches according to event type catalog.
  - `components/AppShell.tsx`: updated status indicator pill (`data-testid="ws-status"`) showing green `"Live"` (`badge-ok`) when connected and amber `"Reconnecting…"` (`badge-warning`) when disconnected.
- Hardening & Operational Polish:
  - Startup idempotency purge in Engine 3 (`created_at < -7 days`).
  - Graceful shutdown handlers across all 4 services.
  - Created comprehensive `docs/API.md` documenting all public Gateway REST endpoints, RBAC permissions, request/response bodies, and WebSocket events.
  - Created `docs/BLOCKERS.md` documenting the Chromium sandbox download boundary and the executed fallback verification per PRD §10.3.
- End-to-End Test Suite Execution (`tests/e2e/e2e.test.ts`):
  - `P10-T01`: WS authentication rejects missing/bad tokens with 4401 and accepts valid JWT with connected greeting.
  - `P10-T02`: Live push broadcasts `receipt.created` within 1 second of REST transaction with matching ref and seq >= 1.
  - `P10-T03`: Gap-free replay reconnects with `?since=seq` and delivers missed events in strict sequential order with `replay: true`.
  - `P10-T04`: Full Happy-Path Golden Lifecycle (Receive 50 SKU001 + 30 SKU002 → Placement recommend → Putaway → Order 10 SKU001 + 5 SKU002 → Assign picker → Held-Karp pick confirmation → Pack FULL) verifies `COMPLETED` order, remaining stocks, 6 stock movements, and 13/13 integrity checks.
  - `P10-T05`: Full Exception & Partial-Pack Lifecycle (Short pick → Exception → Accept short with recount → Staff 403 → Manager partial pack) verifies `COMPLETED (PARTIAL)`, bin recount cleared, and 13/13 integrity checks.
  - `P10-T06`: Exception Reallocate Lifecycle (Report BIN_EMPTY → Reallocate with recount → new stop confirmed → Full pack) verifies `COMPLETED (FULL)` and 13/13 integrity checks.
  - `P10-T07`: High-concurrency contention stress test (8 orders, 2 putaways, 1 relocation fired concurrently) executes with zero deadlocks, zero 500s, and exact stock conservation.
  - `P10-T08`: Crash & restart resilience (mid-workflow kill & restart of Engine 1, Engine 2, Engine 3, Gateway) preserves all state and allows order completion.
  - `P10-T09`: Complete UI workflow contracts, RBAC guards, and state transitions verified end-to-end.
- Verification & Test Metrics:
  - `npm test`: 176/176 passed across all 9 phase test suites in 61.06s.
  - `npm run test:e2e`: 9/9 passed in 10.74s.
  - `npm run verify:integrity`: exits 0 with all 13 checks PASS (`I01`–`I13`).
  - `npm run build -w apps/web`: clean production build in 1.26s.
- Phase 10 gate: PASSED. All 10 Phases of the PRD are 100% complete and verified.

## Appendix B Compliance & UI Hardening Audit
- Modified files:
  - `apps/web/src/pages/ReceivingPage.tsx`
  - `apps/web/src/components/AllocationModal.tsx`
  - `apps/web/src/pages/InventoryPage.tsx`
  - `apps/web/src/pages/OrderDetailPage.tsx`
  - `apps/web/src/pages/PickingPage.tsx`
  - `apps/web/src/pages/MissionDetailPage.tsx`
  - `apps/web/src/pages/ExceptionsPage.tsx`
  - `apps/web/src/pages/PackingPage.tsx`
  - `vitest.config.ts`
- Implementation details:
  - Added and mapped 100% of the interactive and status `data-testid` attributes specified in **Appendix B — Mandatory `data-testid` Catalog**:
    - Receiving tabs, intake supplier/reference/notes inputs, add line button, dynamic line rows (`intake-line-sku-${i}`, `intake-line-qty-${i}`, `intake-line-remove-${i}`), confirm intake, success banner, and staged allocate button (`staged-allocate-${line_id}`).
    - Allocation modal quantity (`alloc-qty`), recommended card (`alloc-recommended-card`) & select (`alloc-select-recommended`), candidate bins (`alloc-select-bin-${bin_code}`), show all toggle (`alloc-show-all-toggle`), validation status (`alloc-validation-status`), and confirm button (`alloc-confirm-btn`).
    - Inventory bin relocate submit (`bin-relocate-submit`).
    - Order picker assign button (`order-assign-btn`) and modal confirmation (`order-assign-confirm`).
    - Picking mission list rows (`mission-row-${mission_ref}`), mission start (`mission-start-btn`), active stop card (`current-stop-card`), barcode scans & qty (`pick-scan-bin`, `pick-scan-sku`, `pick-qty`), exception fields (`pick-exc-type`, `pick-exc-notes`), pick confirmation (`pick-confirm-btn`), and problem modal buttons (`pick-report-btn`, `pick-report-submit`).
    - Exceptions rows (`exc-row-${exc_ref}`), recount input (`exc-resolve-recount`), and resolution buttons (`exc-resolve-reallocate`, `exc-resolve-accept-short`).
    - Packing queue items (`pack-queue-${order_ref}`), manager partial checkbox (`pack-accept-partial-checkbox`), and confirm pack button (`pack-confirm-btn`).
  - Automated scanner verifies 84 of 84 required test IDs are present with 0 missing.
  - Adjusted `vitest.config.ts` to strictly adhere to Appendix C.2 sequential test execution (`fileParallelism: false`).
- Verification & Test Metrics:
  - `npm run build -w apps/web`: clean production Vite & TypeScript build (0 errors, 1.32s).
  - `npm test`: 176/176 passed across all 9 phase test suites in 76.54s.
  - `npm run test:e2e`: 9/9 passed in 10.19s.
  - `npm run verify:integrity`: exits 0 with all 13 checks PASS (`I01`–`I13`).

## Phase 6 — Live Event Feed Widget (Dashboard `/`): Plan
### Planned files:
- `apps/web/src/stores/realtimeStore.ts` (extend with FeedEvent, ring buffer max 50, pushEvents, pushEvent, clearEvents)
- `apps/web/src/hooks/useRealtime.ts` (rAF batching of incoming event pushes without disturbing query invalidation)
- `apps/web/src/features/feed/eventFormatter.ts` (human summaries, relative timestamp formatting, event categorization)
- `apps/web/src/features/feed/EventFeedDrawer.tsx` (collapsible drawer, connection indicator, filter chips, pause/resume view freeze, clear, relative time 1Hz interval)
- `apps/web/src/pages/HomePage.tsx` (embed EventFeedDrawer cleanly while preserving all existing KPI tiles and testids)
- `tests/phase6-feed/phase6_feed.test.ts` (unit & contract tests for ring buffer, dedupe, rAF batching, human formatting, pause/resume buffering)

## Phase 6 — Live Event Feed Widget (Dashboard `/`): Completed
- Implemented files:
  - `apps/web/src/stores/realtimeStore.ts`: added `FeedEvent` interface, ring buffer capped at max 50 items (newest first), deduplication strictly by `seq`, `pushEvents`, `pushEvent`, and `clearEvents`.
  - `apps/web/src/hooks/useRealtime.ts`: added single `requestAnimationFrame` batching buffer so rapid bursts of incoming / replayed events trigger only one store update; preserved all query invalidation mapping untouched.
  - `apps/web/src/features/feed/eventFormatter.ts`: pure functions for human readable summaries (`pick.confirmed`, `inventory.changed` with <=3 or >3 truncation, `order.created`, `order.status_changed`, `order.completed`, `reservation.changed`, `mission.*`, `exception.*`, `bin.status_changed`, and fallback), relative timestamps ("just now", "12s ago", "2m ago", "2h ago", "2d ago"), and category mapping (`orders`, `missions`, `picks`, `inventory`, `exceptions`, `all`).
  - `apps/web/src/features/feed/EventFeedDrawer.tsx`: collapsible drawer with connection indicator reusing `ws-status` state, filter chips, pause/resume view freeze with buffered count, clear action, and 1 Hz interval active only while open.
  - `apps/web/src/pages/HomePage.tsx`: embedded `EventFeedDrawer` between service health strip and KPI tiles with 0 alterations to existing testids.
  - `tests/phase6-feed/phase6_feed.test.ts`: 16 comprehensive unit & contract tests verifying testids, ring buffer capacity, deduplication, 500-event single-batch processing, human summaries, and relative time formatting.
  - `tests/e2e/e2e.test.ts`: added live e2e test `P6-EventFeed-Live` verifying real outbox event delivery via WebSocket into feed.
- Verification & Test Metrics:
  - `npm test`: 248/248 passed across all 16 test suites in 62.83s.
  - `npm run test:e2e`: 11/11 passed in 8.99s.
  - `npm run verify:integrity`: exits 0 with all 13 checks PASS (`I01`–`I13`).
  - `npm run build -w @dark-storage/web`: clean production build in 979ms.
