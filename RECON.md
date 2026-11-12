# RECON

## Commands
- **Install:** `pnpm install`
- **Typecheck:** `pnpm -r exec tsc --noEmit`
- **Build (All):** `pnpm -r run build`
- **Start All (Dev):** `pnpm run dev` (runs concurrently: Engine 3, Engine 2, Engine 1, Gateway, Web)
- **Start Services Individually:**
  - Gateway (:4000): `pnpm --filter=@dark-storage/gateway run dev` (or `tsx watch src/server.ts`)
  - Engine 1 Scheduler (:4001): `pnpm --filter=@dark-storage/engine1-scheduler run dev`
  - Engine 2 Optimizer (:4002): `pnpm --filter=@dark-storage/engine2-optimizer run dev`
  - Engine 3 Inventory (:4003): `pnpm --filter=@dark-storage/engine3-inventory run dev`
  - Web Frontend (:5173): `pnpm --filter=@dark-storage/web run dev`
- **Test:** `pnpm run test` (runs `vitest run`)
- **Migrate:** `pnpm run migrate` (runs `tsx scripts/migrate.ts`)
- **Seed Base:** `pnpm run seed:base` (runs `tsx scripts/seed-base.ts`)
- **Seed Demo:** `pnpm run seed:demo` (runs `tsx scripts/seed-demo.ts`)
- **Smoke Test:** `npx tsx scripts/smoke.ts`
- **Verify Integrity:** `pnpm run verify:integrity` (runs `tsx scripts/verify-integrity.ts`)

---

## B.5 Facts & Answers

1. **How migrations are applied:**
   - **File:** `scripts/migrate.ts` (`export function applyMigrations(db, dir)`), lines 6-56.
   - **Startup:** NOT run automatically at service start; executed via direct CLI script `scripts/migrate.ts` (`pnpm run migrate`).
   - **Transaction:** Yes, each file is wrapped in its own atomic transaction (`const tx = db.transaction(() => { db.exec(content); ... }); tx();`, lines 43-51). Tracked in table `schema_migrations(version, name, checksum, applied_at)`.
   - **Safety:** Computes SHA-256 checksum and rejects migrations if checksum differs from recorded checksum.

2. **How the gateway calls Engine 3 and how the acting user is passed:**
   - **File:** `services/gateway/src/clients/engine3.ts` (`export async function callEngine3<T>(opts: Engine3RequestOptions)`), lines 14-66.
   - **Headers:** Acting user is passed via HTTP request headers:
     - `x-actor-id`: string representation of `req.user.id`
     - `x-actor-role`: string representation of `req.user.role`
     - `x-internal-token`: `config.INTERNAL_TOKEN` (`INTERNAL_SERVICE_KEY`)
     - `x-request-id`: UUID
     - `x-idempotency-key`: forwarded from `req.headers['idempotency-key']` or `req.headers['x-idempotency-key']`.

3. **The exact header name used by the idempotency middleware, and where it is implemented:**
   - **Header Name:** `idempotency-key` (client standard) or `x-idempotency-key` (internal forwarding).
   - **Gateway Extraction:** In gateway routes (e.g. `services/gateway/src/routes/orders.ts:16`, `receipts.ts:14`, `picking.ts:18`): `const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);`
   - **Engine 3 Implementation:** `services/engine3-inventory/src/domain/idempotency.ts` (`export function runIdempotent<T>(db, args)`), lines 25-86. Persisted in table `idempotency_keys(key, scope, request_hash, status_code, response_json, created_at, expires_at)`.

4. **What happens in code when a bin's stock reaches 0:**
   - **File:** `services/engine3-inventory/src/domain/inventoryRepo.ts`, lines 193-202.
   - **SQL Execution:**
     ```sql
     UPDATE inventory
     SET qty = qty - @q,
         reserved_qty = reserved_qty - CASE WHEN @consume = 1 THEN @q ELSE 0 END,
         sku = CASE WHEN qty - @q = 0 THEN NULL ELSE sku END,
         updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     WHERE bin_code = @bin AND qty >= @q
     ```
   - **Inventory row:** Row is **KEPT** in `inventory` table (`qty = 0`, `sku = NULL`, `reserved_qty = 0`). It is NOT deleted.
   - **Bins table:** `bins.status` remains `'ACTIVE'`. In existing schema `bins` does not have `current_sku` or `current_qty` columns; these exist solely on `inventory(bin_code, sku, qty, reserved_qty)`.

5. **Whether `pick_stops` are addressed by numeric `id` or a `stopRef` string in URLs:**
   - **URL Addressing:** Addressed by string `stop_ref` (e.g. `POST /api/pick-stops/:stop_ref/confirm`, `POST /api/pick-stops/:stop_ref/problem` in `services/gateway/src/routes/picking.ts:14,69`).
   - **Schema:** In `migrations/warehouse/007_missions.sql:19-22`, table `pick_stops` defines both `id INTEGER PRIMARY KEY AUTOINCREMENT` and `stop_ref TEXT NOT NULL UNIQUE`. Engine 3 routes use `/internal/v1/pick-stops/:ref`.

6. **Which bcrypt package is used:**
   - **Package:** `bcryptjs` (Pure JS implementation, version `^2.4.3`).
   - **Found in:** Root `package.json:30` and `services/engine3-inventory/package.json:13`.

7. **Which test runner exists:**
   - **Test Runner:** `vitest` (version `^2.1.8`).
   - **Found in:** Root `package.json:22,38` (`"test": "vitest run"`).

8. **The real scripts to build/typecheck/start:**
   - Root `package.json` contains:
     - `"dev"`: Concurrently starts all services and web
     - `"test"`: `vitest run`
     - `"test:e2e"`: `vitest run --config vitest.e2e.config.ts`
     - `"migrate"` / `"db:migrate"`: `tsx scripts/migrate.ts`
     - `"seed:base"` / `"db:seed"`: `tsx scripts/seed-base.ts`
     - `"seed:demo"` / `"db:seed:demo"`: `tsx scripts/seed-demo.ts`
     - `"verify:integrity"`: `tsx scripts/verify-integrity.ts`
     - Typecheck across workspace: `pnpm -r exec tsc --noEmit`

9. **Existing status enums from migrations 001..009:**
   - **Orders (`orders.status` in `006_orders.sql:6`):**
     `'RESERVED', 'ASSIGNED', 'PICKING', 'PICKED', 'COMPLETED', 'CANCELLED'`
     *(Order Priority in `006_orders.sql:5`: `'LOW', 'NORMAL', 'HIGH', 'URGENT'`)*
     *(Order Type in `006_orders.sql:4`: `'CUSTOMER', 'TRANSFER', 'PRODUCTION'`)*
   - **Missions (`missions.status` in `007_missions.sql:6`):**
     `'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'`
   - **Pick Stops (`pick_stops.status` in `007_missions.sql:29`):**
     `'PENDING', 'PICKED', 'EXCEPTION_OPEN', 'RESOLVED'`
   - **Pick Exceptions (`pick_exceptions.status` in `008_exceptions.sql:15`):**
     `'OPEN', 'RESOLVED'`
     *(Exception Types in `008_exceptions.sql:9`: `'BIN_EMPTY', 'DAMAGED', 'SHORT_PICK', 'WRONG_PRODUCT', 'OTHER'`)*
     *(Exception Resolutions in `008_exceptions.sql:16`: `'REALLOCATE', 'ACCEPT_SHORT', 'ORDER_CANCELLED'`)*
   - **Receipts (`receipts.status` in `004_receiving.sql:9`):**
     `'STAGED', 'PARTIALLY_PUT_AWAY', 'PUT_AWAY'`

10. **Whether shelves have a vertical level column:**
    - **Answer:** No. Shelves table (`002_catalog_layout.sql:27-38`) has columns: `code, aisle, bay, side, storage_class, status, nav_node_id, x, y`.
    - **Vertical Level location:** Vertical `level` is defined on `bins` (`002_catalog_layout.sql:43`: `level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 6)`).

11. **How Engine 1 and Engine 3 currently cooperate when a mission is assigned:**
    - **Assignment Flow (`services/gateway/src/routes/orders.ts:79-122`):**
      1. Gateway fetches pick-plan from Engine 3 (`GET /internal/v1/orders/:ref/pick-plan`).
      2. Gateway calls Engine 2 (`POST /internal/v1/routes/plan`) to compute Dijkstra / TSP sequence.
      3. Gateway calls Engine 3 (`POST /internal/v1/orders/:ref/assign`) with picker ID and route geometry.
      4. Engine 3 creates the mission record in `missions` and creates child `pick_stops`.
    - **Locking & Execution via Engine 1 (`services/gateway/src/routes/picking.ts:48-60`):**
      - Engine 1 is invoked during pick confirmation: `runViaEngine1({ type: 'PICK_CONFIRM', priority: 2, ... })`.
      - Engine 1 acquires locks on the resource (`shelf:${stop.shelf_code}`) with fencing tokens before calling Engine 3 (`POST /internal/v1/pick-stops/:ref/confirm`).

---

## Routes

### Gateway (`services/gateway/src/routes/*`)

| Method & Route | File | Current Guard | Kind |
|---|---|---|---|
| `POST /api/auth/login` | `routes/auth.ts` | Public | MUTATE |
| `GET /api/auth/me` | `routes/auth.ts` | `authMiddleware` | READ |
| `GET /health` | `routes/health.ts` | Public | READ |
| `GET /api/health` | `routes/health.ts` | Public | READ |
| `GET /api/dashboard` | `routes/dashboard.ts` | `authMiddleware` | READ |
| `GET /api/audit` | `routes/dashboard.ts` | `authMiddleware`, `rbac(['MANAGER'])` | READ |
| `GET /api/admin/integrity` | `routes/dashboard.ts` | `authMiddleware`, `rbac(['MANAGER'])` | READ |
| `GET /api/products` | `routes/products.ts` | `authMiddleware` | READ |
| `GET /api/products/:sku` | `routes/products.ts` | `authMiddleware` | READ |
| `GET /api/inventory` | `routes/inventory.ts` | `authMiddleware` | READ |
| `GET /api/inventory/summary` | `routes/inventory.ts` | `authMiddleware` | READ |
| `GET /api/inventory/bins` | `routes/inventory.ts` | `authMiddleware` | READ |
| `GET /api/inventory/bins/:code` | `routes/inventory.ts` | `authMiddleware` | READ |
| `GET /api/inventory/movements` | `routes/inventory.ts` | `authMiddleware` | READ |
| `POST /api/inventory/bins/:code/status` | `routes/inventory.ts` | `authMiddleware`, `rbac(['MANAGER'])` | MUTATE |
| `POST /api/inventory/bins/:code/recount` | `routes/inventory.ts` | `authMiddleware`, `rbac(['MANAGER'])` | MUTATE |
| `POST /api/inventory/relocate` | `routes/inventory.ts` | `authMiddleware`, `rbac(['MANAGER', 'OPERATOR'])` | MUTATE |
| `GET /api/warehouse/layout` | `routes/warehouse.ts` | `authMiddleware` | READ |
| `GET /api/warehouse/search` | `routes/warehouse.ts` | `authMiddleware` | READ |
| `POST /api/receipts` | `routes/receipts.ts` | `authMiddleware`, `rbac(['MANAGER', 'OPERATOR'])` | MUTATE |
| `GET /api/receipts/staged` | `routes/receipts.ts` | `authMiddleware` | READ |
| `GET /api/receipts` | `routes/receipts.ts` | `authMiddleware` | READ |
| `GET /api/receipts/:ref` | `routes/receipts.ts` | `authMiddleware` | READ |
| `POST /api/putaway` | `routes/putaways.ts` | `authMiddleware`, `rbac(['MANAGER', 'OPERATOR'])` | MUTATE |
| `GET /api/putaways` | `routes/putaways.ts` | `authMiddleware` | READ |
| `POST /api/placement/recommend` | `routes/placement.ts` | `authMiddleware`, `rbac(['MANAGER', 'OPERATOR'])` | READ |
| `POST /api/placement/validate` | `routes/placement.ts` | `authMiddleware`, `rbac(['MANAGER', 'OPERATOR'])` | READ |
| `POST /api/orders` | `routes/orders.ts` | `authMiddleware`, `rbac(['MANAGER'])` | MUTATE |
| `GET /api/orders` | `routes/orders.ts` | `authMiddleware` | READ |
| `GET /api/orders/:ref` | `routes/orders.ts` | `authMiddleware` | READ |
| `POST /api/orders/:ref/cancel` | `routes/orders.ts` | `authMiddleware`, `rbac(['MANAGER'])` | MUTATE |
| `POST /api/orders/:ref/assign` | `routes/orders.ts` | `authMiddleware`, `rbac(['MANAGER'])` | MUTATE |
| `POST /api/orders/:ref/reassign` | `routes/orders.ts` | `authMiddleware`, `rbac(['MANAGER'])` | MUTATE |
| `POST /api/orders/:ref/pack` | `routes/orders.ts` | `authMiddleware`, `rbac(['STAFF', 'MANAGER'])` | MUTATE |
| `GET /api/missions` | `routes/missions.ts` | `authMiddleware` | READ |
| `GET /api/missions/:ref` | `routes/missions.ts` | `authMiddleware` | READ |
| `POST /api/missions/:ref/start` | `routes/missions.ts` | `authMiddleware`, `rbac(['PICKER', 'MANAGER'])` | MUTATE |
| `POST /api/pick-stops/:stop_ref/confirm` | `routes/picking.ts` | `authMiddleware`, `rbac(['PICKER', 'MANAGER'])` | MUTATE |
| `POST /api/pick-stops/:stop_ref/problem` | `routes/picking.ts` | `authMiddleware`, `rbac(['PICKER', 'MANAGER'])` | MUTATE |
| `GET /api/exceptions` | `routes/exceptions.ts` | `authMiddleware` | READ |
| `GET /api/exceptions/:ref` | `routes/exceptions.ts` | `authMiddleware` | READ |
| `POST /api/exceptions/:ref/resolve` | `routes/exceptions.ts` | `authMiddleware`, `rbac(['MANAGER'])` | MUTATE |
| `GET /api/packing/queue` | `routes/packing.ts` | `authMiddleware` | READ |
| `POST /api/packing/:ref/pack` | `routes/packing.ts` | `authMiddleware`, `rbac(['STAFF', 'MANAGER'])` | MUTATE |
| `GET /api/tasks` | `routes/tasks.ts` | `authMiddleware`, `rbac(['MANAGER'])` | READ |
| `GET /api/tasks/locks` | `routes/tasks.ts` | `authMiddleware`, `rbac(['MANAGER'])` | READ |
| `GET /api/tasks/queue` | `routes/tasks.ts` | `authMiddleware`, `rbac(['MANAGER'])` | READ |
| `GET /api/tasks/:id` | `routes/tasks.ts` | `authMiddleware` | READ |
| `GET /api/users` | `routes/users.ts` | `authMiddleware`, `rbac(['MANAGER'])` | READ |

---

## Baseline Smoke & Run
- **Execution Command:** `npx tsx scripts/smoke.ts`
- **Output Verified:**
  - Gateway health check: `ok`
  - All engines (Engine 1, Engine 2, Engine 3) health check: `ok`
  - Login verified across all 5 initial seeded users (`manager1`, `operator1`, `picker1`, `picker2`, `staff1`)
  - Order retrieval verified
  - Inventory summary retrieval verified
- **Database Backup:** Pre-upgrade snapshot created at `data/backup-baseline/warehouse.db` and `data/backup-baseline/scheduler.db`.
