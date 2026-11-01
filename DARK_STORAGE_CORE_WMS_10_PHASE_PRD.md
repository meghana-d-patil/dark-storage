# DARK STORAGE SHELF & ALLOCATOR — CORE WAREHOUSE WORKFLOW PRD

**Document type:** Build specification for an autonomous coding agent
**Target builder:** Gemini 3.8 Flash (small, fast model — this document is deliberately explicit, deterministic and self-contained)
**Project state:** Rebuild from scratch. No legacy code, no legacy database.
**Scope of this PRD:** The *core warehouse workflow only*, with a functional, lightweight 2D/HTML interface.
**Explicitly excluded:** All 3D, WebGL, Three.js, camera work, cinematic effects, particles, vehicle animation, AGV/forklift hardware. A *separate 3D PRD* will be written later and will consume the same APIs and WebSocket events defined here (see §6.12 "3D-readiness contract").

> **The one-sentence goal:** a warehouse worker can run
> **RECEIVING → ALLOCATION → PUT-AWAY → ORDER CREATION → STOCK RESERVATION → PICKER ASSIGNMENT → PICKING → PACKING → ORDER COMPLETION**
> entirely through the website, every step backed by real database transactions, with zero fake success states.

---

## 0. HOW THE BUILDING AGENT MUST USE THIS DOCUMENT

### 0.1 Reading order
1. Read **§1–§8 (Global Reference)** completely. They define the rules that every phase obeys.
2. Work through **Phase 1 → Phase 10 strictly in order**. Each phase is self-contained: it lists its own prerequisites, files, migrations, API contracts, algorithms, UI, tests and acceptance gate.
3. When starting a phase, re-read **only** §1–§8 plus that phase. Do not try to hold the whole document in context.

### 0.2 Per-phase protocol (mandatory loop)
For every phase:
1. **Plan:** list the files you will create/modify (write it into `docs/IMPLEMENTATION_LOG.md`).
2. **Tests first:** create the test files named in the phase's *Tests* table (they may fail initially).
3. **Implement** code + migrations + UI exactly as specified.
4. **Run:** `npm run test` (relevant workspace) and `npm run verify:integrity`. Fix until green.
5. **Regression:** run the complete `npm run test` for all earlier phases. Nothing earlier may break.
6. **Record:** update `docs/IMPLEMENTATION_CHECKLIST.md` (tick items, paste the real test output summary) and append to `docs/IMPLEMENTATION_LOG.md` (modified files, API changes, DB changes).
7. **Commit:** `git commit -m "phase N: <title>"`.
8. **Only then** start the next phase. Do not ask for approval between phases.

A phase is **complete only when its acceptance gate passes with real command output**. Code that is written but untested is *not* complete.

### 0.3 Behavioural rules for the agent
- Never invent endpoints, tables, columns, statuses or error codes that this PRD does not define. If something is genuinely missing, choose the simplest option consistent with the rules, and record it in `docs/PRD_DEVIATIONS.md`.
- Never weaken, skip or delete a test to make a gate pass. If a test is provably contradictory with the PRD, record it in `docs/PRD_DEVIATIONS.md` and fix the PRD-consistent side.
- If the same error blocks you after 3 distinct fix attempts, write the problem to `docs/BLOCKERS.md`, implement the documented fallback if one exists, and continue with independent work.
- Never claim something works without running it. The final report separates **IMPLEMENTED AND TESTED / IMPLEMENTED BUT NOT FULLY TESTED / NOT IMPLEMENTED / BLOCKED BY EXTERNAL DEPENDENCY** (see Phase 10).
- Keep every source file under ~300 lines and give each file one responsibility.
- TypeScript `strict: true`. No `any` in domain/service code. Validate every external input with zod.
- All commands must work on **Windows, macOS and Linux** (use Node scripts, not bash-only scripts; use `cross-env` where env vars are set inline).
- The product must run well on **low-spec warehouse PCs** (low RAM, integrated graphics): no heavy UI libraries, no animation libraries, paginate every list (default 25, max 100), no polling faster than specified.

---

## 1. PRODUCT SCOPE

### 1.1 In scope (this PRD)
| Area | What is built |
|---|---|
| Receiving | Manual multi-line intake into a staging area, with readable receipt records |
| Allocation | Engine 2 recommends shelf/bin with explainable scoring; operator may accept or manually choose any *valid* bin |
| Put-away | Engine 1 coordinates and locks; Engine 3 moves stock atomically; partial put-away supported |
| Orders | Manual multi-line outbound order creation with ATP (available-to-promise) display |
| Reservation | All-or-nothing, bin-level reservations created atomically; cancellation releases outstanding reservations |
| Assignment | Manager assigns a picker; Engine 2 computes a real route over the warehouse graph |
| Picking | Per-stop scan + quantity confirmation, partial picks, exceptions, manager resolution |
| Packing | Validated packing confirmation; full or authorized-partial completion |
| Cross-cutting | Auth + roles, audit trail, idempotency, transactional outbox, realtime (WebSocket) with replay, recovery after restart, integrity verifier |
| UI | Login, Dashboard, Receiving, Inventory, Orders, Picking, Packing, Exceptions, Warehouse (2D bin map), Tasks/Audit |

### 1.2 Out of scope (do NOT build)
3D scene, WebGL, animations beyond CSS transitions, AGV/robot/forklift integration, barcode hardware drivers (scan = text input), multi-warehouse, backorders (orders are all-or-nothing), returns/restocking of picked goods, purchase orders, invoicing/billing, lot/serial/expiry tracking, multi-tenant, email/SMS, payment, analytics beyond the dashboard in Phase 9.

### 1.3 Roles (exactly four)
| Role | Purpose |
|---|---|
| `MANAGER` | Full control: orders, assignment, exception resolution, recounts, bin status, partial-pack authority, audit view. (Acts as administrator.) |
| `OPERATOR` | Inventory operator: receiving, allocation, put-away, relocation |
| `PICKER` | Executes assigned missions only |
| `STAFF` | Packing station staff: packing queue and packing confirmation |

---

## 2. NON-NEGOTIABLE ENGINEERING RULES

| # | Rule |
|---|---|
| R1 | **Engine 3 is the only process that writes to `warehouse.db`.** Gateway and Engine 1/2 never write to it. Engine 2 may open it **read-only**. |
| R2 | **Database is the truth.** The frontend never shows a success state before the API returns the committed result. No frontend-only inventory changes. No hardcoded operational data. |
| R3 | **Invariant** (also enforced by SQL CHECK + triggers): `0 <= reserved_qty <= qty <= bin.capacity`, `available_qty = qty - reserved_qty`. |
| R4 | **Single-SKU-per-bin.** Empty bin accepts any SKU; occupied bin accepts only the same SKU; never mix. Enforced in the SQL write *and* by a DB trigger — never only by Engine 2. |
| R5 | **No dangerous UPSERT.** Never write `INSERT … ON CONFLICT DO UPDATE SET sku = excluded.sku`. Every bin has a pre-created `inventory` row (qty 0, sku NULL). All stock changes are *conditional* `UPDATE … WHERE` statements whose `changes` count is checked. |
| R6 | **Every mutation is one atomic transaction** (`BEGIN IMMEDIATE … COMMIT`). Any failure → full rollback. Ledger movement, audit record and outbox event are written in the *same* transaction as the stock change. |
| R7 | **Idempotency:** every mutating endpoint requires an `Idempotency-Key` header. Same key + same body → original response replayed, no second effect. Same key + different body → `422 IDEMPOTENCY_KEY_REUSED`. |
| R8 | **No Engine-1 bypass.** If a mutation requires Engine 1 coordination and Engine 1 is down, reject with `503 ENGINE1_UNAVAILABLE`. There is no Gateway fallback that skips locking. |
| R9 | **Locks are coordination, not correctness.** Engine 3's transactional invariants are the safety net; Engine 1 locks provide ordering, fairness and visibility. |
| R10 | **No invented data.** Never present fabricated statistics (e.g. velocity) as measurements. Factors without data are flagged `applied:false` or `neutral:true`. |
| R11 | **Business IDs everywhere** (`ORD-0001`, `RCV-0001`, …). Internal integer ids / uuids are never shown to normal users. Product name **and** SKU are shown together wherever a product appears. |
| R12 | **Migrations are versioned, forward-only, checksum-protected.** Never edit an applied migration. Never delete/reset `warehouse.db` to make tests easier — tests use temp databases. |
| R13 | **Append-only ledgers:** `stock_movements` and `audit_log` reject UPDATE/DELETE by trigger. |
| R14 | Reservations are consumed **only** when a physical pick commits — never when an order or mission is merely created. |
| R15 | Cancelling an order never restores already-picked stock; it releases only *outstanding* reservations. |

---

## 3. TECHNOLOGY STACK (pin MAJOR versions; do not upgrade majors)

| Concern | Choice |
|---|---|
| Runtime | Node.js 20 LTS or 22 LTS, ESM (`"type":"module"`), TypeScript 5.x strict |
| Monorepo | npm workspaces |
| Dev runner | `tsx` (no build step required for services); `concurrently` to start everything |
| HTTP services | Express **4.x** |
| Validation | zod **3.x** (schemas live in `packages/shared`) |
| Database | SQLite via `better-sqlite3` (current major that has prebuilt binaries for your Node), WAL mode, `foreign_keys=ON`, `busy_timeout=5000` |
| Auth | `jsonwebtoken` 9.x (HS256), `bcryptjs` 2.x |
| WebSocket | `ws` 8.x |
| HTTP client between services | built-in `fetch` (Node ≥ 18) with `AbortController` timeouts |
| Frontend | React **18**, Vite **5**, React Router **6**, `@tanstack/react-query` **5**, `zustand` **4**, plain CSS (design tokens in one `theme.css`; **dark theme**, no CSS framework, no component library) |
| Tests | vitest **2.x**, supertest 7.x; `@testing-library/react` + `jsdom` for web component tests; Playwright (latest) for the browser smoke test in Phase 10 |
| IDs | `crypto.randomUUID()` for idempotency keys / task ids |

**Dependency discipline:** do not add any package not in this table without recording it in `docs/PRD_DEVIATIONS.md`. If `better-sqlite3` fails to install on Windows, install the newest `better-sqlite3` release and ensure Node 20/22 LTS is used.

### 3.1 Ports and processes
| Process | Port | Role |
|---|---|---|
| Web (Vite dev) | 5173 | React UI |
| Gateway | 4000 | Public API, auth, validation, RBAC, orchestration, WebSocket |
| Engine 1 (Scheduler) | 4001 | Priority queue, locks, task execution, recovery |
| Engine 2 (Optimizer) | 4002 | Placement recommendation + route planning (stateless compute) |
| Engine 3 (Inventory) | 4003 | Authoritative owner of `warehouse.db`; all stock/order/mission transactions |

Internal service-to-service calls carry header `X-Internal-Token: <INTERNAL_TOKEN from .env>`, plus `X-Request-Id`, and (when acting for a user) `X-Actor-Id` and `X-Actor-Role`. Services reject requests without the correct internal token (`401`). Engine 1/2/3 bind to `127.0.0.1` only.

### 3.2 Environment (`.env.example`)
```
NODE_ENV=development
JWT_SECRET=change-me-dev-only
INTERNAL_TOKEN=change-me-internal
SEED_DEFAULT_PASSWORD=Warehouse#2026
WAREHOUSE_DB_PATH=./data/warehouse.db
SCHEDULER_DB_PATH=./data/scheduler.db
GATEWAY_PORT=4000
ENGINE1_URL=http://127.0.0.1:4001
ENGINE2_URL=http://127.0.0.1:4002
ENGINE3_URL=http://127.0.0.1:4003
ENGINE3_COMMAND_TIMEOUT_MS=10000
TASK_WAIT_TIMEOUT_MS=15000
```
Every service reads config through one `config.ts` that validates env with zod and fails fast on missing/invalid values. Tests override `WAREHOUSE_DB_PATH` / `SCHEDULER_DB_PATH` and ports.

---

## 4. REPOSITORY LAYOUT (create exactly this)

```
dark-storage-wms/
├─ package.json                  # workspaces + root scripts
├─ tsconfig.base.json
├─ .env.example   .gitignore     # ignore data/, backups/, node_modules
├─ README.md                     # how to start, default accounts
├─ docs/
│  ├─ IMPLEMENTATION_CHECKLIST.md   IMPLEMENTATION_LOG.md
│  ├─ PRD_DEVIATIONS.md   BLOCKERS.md   API.md (generated summary at end)
├─ data/                         # runtime SQLite files (gitignored)
├─ backups/                      # db backups (gitignored)
├─ migrations/
│  ├─ warehouse/   001_core.sql … 009_packing.sql
│  └─ scheduler/   s001_scheduler.sql
├─ packages/shared/src/          # zod schemas, enums, error codes, id formatting, DTO types
│  ├─ enums.ts  errors.ts  ids.ts  schemas/*.ts  index.ts
├─ services/
│  ├─ engine3-inventory/src/     # db/, domain/, routes/, server.ts
│  ├─ engine1-scheduler/src/     # queue/, locks/, executor/, routes/, server.ts
│  ├─ engine2-optimizer/src/     # graph/, placement/, routing/, routes/, server.ts
│  └─ gateway/src/               # middleware/, routes/, clients/, ws/, server.ts
├─ apps/web/src/                 # api/, hooks/, stores/, pages/, components/, styles/
├─ scripts/
│  ├─ migrate.ts  seed-base.ts  seed-demo.ts  backup-db.ts
│  ├─ verify-integrity.ts  start-all.ts
└─ tests/
   ├─ harness/                   # startStack(), stopStack(), killService(), apiClient()
   └─ e2e/                       # api workflow tests + playwright smoke
```

### 4.1 Root scripts (all must exist by end of Phase 1; some become meaningful later)
```
npm run dev                # start all 4 services + web (concurrently)
npm run db:migrate         # apply pending migrations to warehouse.db and scheduler.db
npm run db:seed            # base seed: users, products, layout, nav graph, inventory rows
npm run db:seed:demo       # optional demo stock, created THROUGH Engine-3 domain functions (ledger-backed)
npm run db:backup          # VACUUM INTO backups/warehouse-<timestamp>.db and verify it opens
npm run verify:integrity   # run all integrity checks (see §9), exit 1 on any failure
npm run test               # all unit/integration tests (vitest) on temp DBs
npm run test:e2e           # API workflow tests (+ playwright smoke from Phase 10)
```

---

## 5. ARCHITECTURE & OWNERSHIP

```
 Browser (React) ──HTTP/WS──► GATEWAY :4000 ──► Engine 1 :4001 ──► Engine 3 :4003 ──► warehouse.db
                               │   │                │ (scheduler.db)        ▲
                               │   └──► Engine 2 :4002 ──(read-only)─────────┘
                               └────────────────────────────► Engine 3 (reads, direct commands)
```

| Component | Owns | Never does |
|---|---|---|
| **Gateway** | JWT auth, RBAC, zod validation, request ids, orchestration, WebSocket fan-out, error normalization | Write to any DB; contain business rules beyond permission/validation |
| **Engine 1 — Scheduler** | `scheduler.db` (tasks, locks); priority queue with aging; atomic multi-resource lock acquisition; retries; crash recovery | Change stock; decide where stock goes |
| **Engine 2 — Optimizer** | Placement scoring/filtering; navigation graph; Dijkstra, A*, Held-Karp, 2-Opt | Write anything; trust its own output as authoritative (Engine 3 re-validates) |
| **Engine 3 — Inventory** | `warehouse.db` — all tables; all stock, reservation, order, mission, packing transactions; ledger; audit; outbox; idempotency | Depend on Engine 1/2 for correctness |

### 5.1 Request routing types (used in the API table, §6.9)
- **PROXY** — Gateway validates + authorizes, forwards to Engine 3, returns its response.
- **E1** — Gateway creates an Engine 1 task; Engine 1 locks resources, calls an Engine 3 *command* endpoint, releases locks, stores the result; Gateway waits for it (up to `TASK_WAIT_TIMEOUT_MS`) and returns the Engine 3 result. If not finished in time: `202 { task_id, status }` and the UI polls `GET /api/tasks/:id`.
- **ORCH** — Gateway orchestrates a multi-step flow (e.g. Engine 3 read → Engine 2 plan → Engine 3 write).
- **READ** — Gateway proxies a read to Engine 3.

### 5.2 Engine 3 internal API shape
Engine 3 exposes the same resource shapes under `/internal/v1/*`. Reads are `GET`. Mutations used by Engine 1 are **command endpoints**: `POST /internal/v1/commands/<name>` with body `{ actor:{id,role}, idempotency_key, payload }` where `<name>` ∈ `putaway | relocate | reserve-order | pick-confirm | exception-resolve`. Other mutations (receipt create, assign, start, cancel, pack, bin status, recount, pick exception report) are direct `POST /internal/v1/...` endpoints with the same body envelope. Engine 3 wraps each in `runIdempotent()` (§6.6).

### 5.3 Why SQLite without cross-process writers
Only Engine 3 writes `warehouse.db` → no write contention between processes. `better-sqlite3` is synchronous, so each Engine-3 transaction executes atomically on the Node event loop; concurrent HTTP requests are naturally serialized per transaction. Engine 1 owns a *separate* `scheduler.db` (its own single writer).

---

## 6. CONVENTIONS

### 6.1 Time
All timestamps are ISO-8601 UTC strings, e.g. `2026-11-01T09:30:00.000Z`. SQLite default: `strftime('%Y-%m-%dT%H:%M:%fZ','now')`. The UI formats to local time.

### 6.2 Business ID formats (generated in-transaction from `id_sequences`)
| Entity | Format | Example |
|---|---|---|
| Receipt | `RCV-0001` | `RCV-0007` |
| Put-away | `PUT-0001` | `PUT-0003` |
| Order | `ORD-0001` | `ORD-0012` |
| Mission | `MIS-0001` | `MIS-0004` |
| Stock movement | `MOV-0001` | `MOV-0042` |
| Exception | `EXC-0001` | `EXC-0002` |
| Packing record | `PCK-0001` | `PCK-0005` |
| Adjustment (recount) | `ADJ-0001` | `ADJ-0001` |
| Pick stop | `<MISSION>-S<NN>` | `MIS-0004-S02` |

Numbers are zero-padded to 4 digits and grow beyond 4 digits naturally (`ORD-10000`). The sequence increment and the entity insert happen in the same transaction, so committed IDs are gap-free. Implementation: `nextRef(db, 'order')` does `UPDATE id_sequences SET next_value = next_value + 1 WHERE name=? RETURNING next_value - 1`.

### 6.3 API envelope
Success: the resource JSON directly (`201` for creates, `200` otherwise), plus `X-Request-Id`; replayed idempotent calls add `Idempotent-Replay: true`.
Lists: `{ "items": [...], "page": 1, "page_size": 25, "total": 137 }`.
Error (always this shape):
```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "Not enough available stock for SKU003.", "details": { "shortages": [{ "sku": "SKU003", "requested": 10, "available": 4 }] }, "request_id": "..." } }
```

### 6.4 Error code catalog (`packages/shared/src/errors.ts` — single source of truth)
| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | zod validation failed (`details.issues`) |
| `UNAUTHENTICATED` | 401 | Missing/invalid/expired token or bad credentials |
| `FORBIDDEN` | 403 | Role not permitted |
| `NOT_FOUND` | 404 | Entity does not exist |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Mutation without `Idempotency-Key` |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Same key, different body |
| `UNKNOWN_SKU` | 422 | SKU not in catalog or inactive |
| `UNKNOWN_BIN` | 422 | Bin code not found |
| `QUANTITY_INVALID` | 422 | Not a positive integer or over a limit |
| `DUPLICATE_LINE_SKU` | 422 | Same SKU twice in one receipt/order |
| `SKU_CONFLICT` | 409 | Destination bin holds a different SKU |
| `CAPACITY_EXCEEDED` | 409 | Would exceed bin capacity |
| `BIN_NOT_RECEIVABLE` | 409 | Bin/shelf blocked, damaged, maintenance, or recount required |
| `STORAGE_CLASS_MISMATCH` | 409 | Product storage class ≠ shelf storage class |
| `INSUFFICIENT_STAGED_STOCK` | 409 | Put-away qty exceeds staged remainder |
| `INSUFFICIENT_STOCK` | 409 | Order cannot be fully reserved (`details.shortages`) |
| `ORDER_STATE_INVALID` | 409 | Action not allowed in current order status |
| `ORDER_NOT_CANCELLABLE` | 409 | Cancellation not allowed now |
| `PICKER_INVALID` | 422 | User is not an active PICKER |
| `MISSION_STATE_INVALID` | 409 | Action not allowed in current mission status |
| `NOT_YOUR_MISSION` | 403 | Picker acting on another picker's mission |
| `STOP_STATE_INVALID` | 409 | Stop not in a state that allows the action |
| `PRODUCT_MISMATCH` | 409 | Scanned SKU ≠ expected SKU |
| `BIN_MISMATCH` | 409 | Scanned bin ≠ expected bin |
| `QUANTITY_EXCEEDS_RESERVATION` | 409 | Picked qty > outstanding reserved qty |
| `SHORT_PICK_REQUIRES_EXCEPTION` | 422 | picked < required without an exception block |
| `EXCEPTION_STATE_INVALID` | 409 | Exception already resolved / wrong state |
| `ADJUSTMENT_CONFLICT` | 409 | Adjustment would drop qty below other reservations |
| `BIN_HAS_RESERVATIONS` | 409 | Cannot block/damage a bin that has reserved stock |
| `PACK_INCOMPLETE` | 409 | Order not fully picked/resolved |
| `PARTIAL_PACK_FORBIDDEN` | 403 | Non-manager tried to confirm a partial pack |
| `ROUTE_UNREACHABLE` | 422 | A stop cannot be reached in the nav graph |
| `PLAN_STALE` | 409 | Orchestrated plan no longer matches DB state |
| `INVENTORY_DRIFT` | 500 | Impossible state detected; transaction rolled back |
| `ENGINE1_UNAVAILABLE` / `ENGINE2_UNAVAILABLE` / `ENGINE3_UNAVAILABLE` | 503 | Downstream service unreachable |
| `TASK_FAILED` | 409 | Engine 1 task ended FAILED (`details` carries the underlying error) |
| `INTERNAL_ERROR` | 500 | Unexpected error (never leak stack traces) |

A single `DomainError(code, message, details?)` class maps to the HTTP status via this catalog. Every service uses the same class and the same error-to-response middleware.

### 6.5 Authentication & RBAC
- `POST /api/auth/login {username,password}` → `{ token, user:{id,username,display_name,role} }`. JWT HS256, 8h expiry, claims `{sub, role, name}`.
- Gateway middleware order: `requestId → cors → json(1mb) → auth → rbac → validate → handler → errorHandler`.
- WebSocket authenticates with `?token=` query parameter.

| Capability | MANAGER | OPERATOR | PICKER | STAFF |
|---|:-:|:-:|:-:|:-:|
| View products, inventory, warehouse map, orders, receipts | ✔ | ✔ | ✔ | ✔ |
| Create receipt, placement recommend/validate, put-away, relocate | ✔ | ✔ | ✘ | ✘ |
| Create / cancel order | ✔ | ✘ | ✘ | ✘ |
| Assign / reassign picker | ✔ | ✘ | ✘ | ✘ |
| Start mission, confirm stop, report exception | ✘ | ✘ | ✔ (own missions) | ✘ |
| Resolve exception, recount bin, change bin status | ✔ | ✘ | ✘ | ✘ |
| Confirm packing (full) | ✔ | ✘ | ✘ | ✔ |
| Confirm packing (partial) | ✔ | ✘ | ✘ | ✘ |
| View audit log, task list, integrity | ✔ | ✘ | ✘ | ✘ |
| PICKER mission list | own only | | own only | |

### 6.6 Idempotency implementation (Engine 3 `runIdempotent`)
```
runIdempotent(db, { key, scope, body, actor }, handler):
  hash = sha256(canonicalJson(body))                       // keys sorted
  BEGIN IMMEDIATE
    row = SELECT * FROM idempotency_keys WHERE key = ?
    if row:
        ROLLBACK
        if row.request_hash != hash  -> throw IDEMPOTENCY_KEY_REUSED
        return { status: row.status_code, body: JSON.parse(row.response_json), replay: true }
    try:
        { status, body } = handler(db)                    // may throw DomainError
        INSERT INTO idempotency_keys(key, scope, request_hash, status_code, response_json)
        COMMIT
        return { status, body, replay: false }
    catch e:
        ROLLBACK; throw e                                  // failures are NOT stored; a retry re-evaluates
```
`scope = "<METHOD> <route-template> actor:<id>"`. Keys retained 7 days (purge job at Engine 3 startup, not during requests).
**Gateway rule:** every mutating route (all `POST` except `/api/auth/login`, `/api/placement/recommend`, `/api/placement/validate`) requires header `Idempotency-Key` (UUID string, 8–100 chars), otherwise `400 IDEMPOTENCY_KEY_REQUIRED`. The same key is forwarded to Engine 1 (as task idempotency key) and Engine 3.

### 6.7 Audit and outbox helpers (Engine 3)
- `audit(db, { actor, action, entity_type, entity_id, details })` → row in `audit_log` (same transaction as the change).
- `emit(db, { event_type, entity_type, entity_id, data })` → row in `outbox_events` (same transaction). Events are only ever created at commit time, so the UI never sees speculative data.

### 6.8 Pagination, search and filtering
`?page=1&page_size=25&search=` — search matches **both** product name (case-insensitive `LIKE %term%`) and SKU. Product search endpoint returns at most 20 items for type-ahead.

### 6.9 Public API catalog (Gateway `/api`)
Types: P=PROXY, E1=Engine 1 task, O=ORCH, R=READ. Roles abbreviated M/O/P/S (A = any authenticated).

| Method & path | Type | Roles | Introduced |
|---|---|---|---|
| `POST /auth/login` | — | none | P1 |
| `GET /auth/me` | — | A | P1 |
| `GET /health` | — | none | P1 |
| `GET /products`, `GET /products/:sku` | R | A | P1 |
| `GET /users?role=PICKER` | R | M | P7 |
| `GET /inventory/summary` | R | A | P2 |
| `GET /inventory/bins`, `GET /inventory/bins/:code` | R | A | P2 |
| `GET /inventory/movements` | R | A | P2 |
| `POST /inventory/bins/:code/status` | P | M | P2 |
| `POST /inventory/bins/:code/recount` | P | M | P2 |
| `POST /receipts`, `GET /receipts`, `GET /receipts/:ref`, `GET /receipts/staged` | P/R | M,O (POST) / A (GET) | P3 |
| `POST /placement/recommend`, `POST /placement/validate` | O | M,O | P4 |
| `POST /putaways`, `GET /putaways` | E1 / R | M,O / A | P5 |
| `POST /inventory/relocate` | E1 | M,O | P5 |
| `GET /tasks`, `GET /tasks/:id` | R | M (list) / A (own task) | P5 |
| `POST /orders`, `GET /orders`, `GET /orders/:ref` | E1 / R | M (POST) / A | P6 |
| `POST /orders/:ref/cancel` | P | M | P6 |
| `POST /orders/:ref/assign`, `POST /orders/:ref/reassign` | O | M | P7 |
| `GET /missions`, `GET /missions/:ref` | R | A (picker: own) | P7 |
| `POST /missions/:ref/start` | P | P (own) | P7 |
| `POST /pick-stops/:stop_ref/confirm` | E1 | P (own) | P8 |
| `POST /pick-stops/:stop_ref/exception` | P | P (own) | P8 |
| `GET /exceptions`, `POST /exceptions/:ref/resolve` | R / O+E1 | A / M | P8 |
| `GET /packing/queue`, `POST /orders/:ref/pack` | R / P | A / M,S | P9 |
| `GET /dashboard` | R | A | P9 |
| `GET /warehouse/layout`, `GET /warehouse/search?q=` | R | A | P2 |
| `GET /audit` , `GET /admin/integrity` | R | M | P9 |
| `WS /ws?token=&since=` | — | A | P10 |

### 6.10 Frontend conventions
- `apps/web/src/api/client.ts`: one `apiFetch()` that attaches the JWT, parses the error envelope into an `ApiError(code, message, details)`, and exposes `ApiError.isNetwork`.
- `useIdempotentMutation(fn)` hook: keeps an `Idempotency-Key` in a `useRef`; **reuses** it for retries of the *same payload* (network error / 5xx / 202), **regenerates** it after a success or after the user edits the payload following a 4xx. The submit button is `disabled` while the mutation is pending (anti double-click).
- A `<ProductLabel sku name />` component renders `Name · SKU` and is the only way products are displayed.
- A `<StatusBadge status />` component maps every status string to a color + text.
- Every action button calls a real API. No dead buttons. Unimplemented features are **hidden**, not stubbed.
- Error display: toast for transient errors; inline field errors from `VALIDATION_ERROR.details.issues`; a human message map for every code in §6.4 (`errorMessages.ts`).
- `data-testid` attributes are mandatory for interactive elements (see Appendix B).
- Zustand stores: `authStore` (token, user), `realtimeStore` (`lastSeq`, `connected`). React Query holds all server data.

### 6.11 Seed data (deterministic; created by `npm run db:seed`)
**Users** (password = `SEED_DEFAULT_PASSWORD`): `manager1` (MANAGER, "Maya Manager"), `operator1` (OPERATOR, "Omar Operator"), `picker1` (PICKER, "Priya Picker"), `picker2` (PICKER, "Pablo Picker"), `staff1` (STAFF, "Sana Staff").

**Products** (24; `max_receive_qty` 5000; `storage_class` STANDARD unless noted):
| SKU | Name | Category |
|---|---|---|
| SKU001 | Wireless Mouse | Peripherals |
| SKU002 | Mechanical Keyboard | Peripherals |
| SKU003 | USB-C Hub 7-in-1 | Peripherals |
| SKU004 | 27-inch Monitor | Displays |
| SKU005 | Webcam 1080p | Peripherals |
| SKU006 | USB-C Cable 1m | Cables |
| SKU007 | HDMI Cable 2m | Cables |
| SKU008 | Ethernet Cable Cat6 5m | Cables |
| SKU009 | DisplayPort Cable 1.5m | Cables |
| SKU010 | Aluminium Laptop Stand | Accessories |
| SKU011 | Laptop Sleeve 15-inch | Accessories |
| SKU012 | Portable SSD 1TB | Storage |
| SKU013 | USB Flash Drive 64GB | Storage |
| SKU014 | microSD Card 128GB | Storage |
| SKU015 | Wi-Fi 6 Router | Networking |
| SKU016 | Network Switch 8-port | Networking |
| SKU017 | Wi-Fi Range Extender | Networking |
| SKU018 | Wireless Headset | Audio |
| SKU019 | Bluetooth Speaker | Audio |
| SKU020 | LED Desk Lamp | Office |
| SKU021 | Ergonomic Mouse Pad | Office |
| SKU022 | Notebook A5 (5-pack) | Office |
| SKU023 | Lithium Power Bank 20000mAh | Batteries — `HAZMAT` |
| SKU024 | AA Lithium Batteries 8-pack | Batteries — `HAZMAT` |

**Layout:** aisles `A,B,C,D`; bays `1..6`; sides `L,R`; levels `1..4`.
- Shelf code: `<aisle>-<bay 2 digits>-<side>` → `A-03-L`. Bin code: `<shelf>-<level>` → `A-03-L-2`. → 48 shelves, 192 bins.
- Bin capacity by level: L1=120, L2=100, L3=80, L4=60.
- Storage class: shelves in aisle `D`, bays 1–2 (4 shelves) are `HAZMAT`; all others `STANDARD`.
- Demo status exceptions: shelf `B-06-L` = `MAINTENANCE`; bin `D-06-R-3` = `BLOCKED`; bin `D-06-R-4` = `DAMAGED`.
- Every bin gets an `inventory` row `(qty 0, reserved 0, sku NULL)`.

**Navigation graph** (generated by the seed script from coordinates; edge weight = Euclidean distance rounded to 2 dp):
- Nodes: `DOCK` (0,0, kind DOCK) — receiving/staging and pick start; `PACK` (80,0, kind PACK) — packing station; bottom cross nodes `XB-A..XB-D` at (10,0),(30,0),(50,0),(70,0); top cross nodes `XT-A..XT-D` at (10,50)…(70,50); aisle nodes `N-<aisle>-<bay 2d>` at x = aisle centre (A=10,B=30,C=50,D=70), y = `10 + (bay-1)*6`.
- Edges (undirected): `DOCK–XB-A`; `XB-A–XB-B–XB-C–XB-D`; `XB-D–PACK`; `XB-<a>–N-<a>-01`; `N-<a>-<n>–N-<a>-<n+1>`; `N-<a>-06–XT-<a>`; `XT-A–XT-B–XT-C–XT-D`.
- Both shelves (L and R) of a bay use the same aisle node as their `nav_node_id`.

### 6.12 3D-readiness contract (for the later 3D PRD — implement only the data, not the 3D)
`GET /api/warehouse/layout` must return shelves with `x`,`y` (= nav node coordinates), aisle/bay/side, status, and every bin with `level`, `capacity`, `status`, `sku`, `product_name`, `qty`, `reserved_qty`. The WebSocket event envelope (§Phase 10) is the stable change feed. The later 3D client will use *only* these. Do not add 3D-specific fields now.

---

## 7. DOMAIN STATE MACHINES

### 7.1 Order (`orders.status`)
```
RESERVED ──assign──► ASSIGNED ──start mission──► PICKING ──all stops PICKED/RESOLVED──► PICKED ──pack──► COMPLETED
   │                     │                           │                                     │
   └──────cancel─────────┴───────cancel──────────────┘                         cancel only if total picked == 0
                         ▼
                     CANCELLED
```
Order is created directly as `RESERVED` (creation and reservation are one transaction; there is no persisted "unreserved" order). `fulfilment_type` (`FULL`|`PARTIAL`) is set at COMPLETED.

### 7.2 Mission (`missions.status`)
`ASSIGNED → IN_PROGRESS → COMPLETED`; `ASSIGNED|IN_PROGRESS → CANCELLED`. Only one active (`ASSIGNED|IN_PROGRESS`) mission per order (partial unique index).

### 7.3 Pick stop (`pick_stops.status`)
`PENDING → PICKED` (full quantity), `PENDING → EXCEPTION_OPEN` (short/zero pick + exception), `EXCEPTION_OPEN → RESOLVED` (manager resolution). A stop is *finished* when `PICKED` or `RESOLVED`.

### 7.4 Reservation (`reservations.status`)
`HELD → CONSUMED` (all units consumed or released with ≥1 consumed) · `HELD → RELEASED` (all units released, none consumed). `outstanding = qty − consumed_qty − released_qty`. `HELD` ⇔ `outstanding > 0`.

### 7.5 Receipt (`receipts.status`)
`STAGED` (nothing put away) → `PARTIALLY_PUT_AWAY` → `PUT_AWAY` (all lines fully put away). Derived/maintained in the put-away transaction.

### 7.6 Exception (`pick_exceptions.status`)
`OPEN → RESOLVED` with `resolution ∈ { REALLOCATE, ACCEPT_SHORT }`.

### 7.7 Engine 1 task (`tasks.status`)
`QUEUED → RUNNING → SUCCEEDED | FAILED`; transport failures: `RUNNING → QUEUED` (retry with backoff, `attempts++`) until `max_attempts` (3) then `FAILED`.

---

## 8. PHASE ROADMAP

| Phase | Title | Primary owner | Gate (must pass before next phase) |
|---|---|---|---|
| 1 | Foundation: monorepo, contracts, schema, seed, auth, service skeletons, test harness | all | P1 tests + `verify:integrity` + all 5 processes healthy |
| 2 | Inventory core: stock model, invariants, ledger, bin management, read APIs, Inventory UI | Engine 3 | Stock-safety tests (SKU mix, capacity, rollback, idempotency) |
| 3 | Receiving: multi-line intake, staging, receipts, Receiving UI | Gateway + Engine 3 | Intake tests |
| 4 | Engine 2 allocation: filtering, scoring, explanation, manual selection | Engine 2 | Placement tests |
| 5 | Engine 1 + put-away: scheduler, locks, recovery, put-away + relocation | Engine 1 + 3 | Movement, lock and restart tests |
| 6 | Orders + reservations: manual order creation, ATP, atomic reserve, cancel | Engine 3 + 1 | Order + concurrency tests |
| 7 | Assignment + routing: picker assignment, graph, route planning, missions | Engine 2 + 3 | Route + mission tests |
| 8 | Picking + exceptions: stop confirmation, partial picks, exceptions, resolution | Engine 3 | Stop/quantity/exception tests |
| 9 | Packing + completion + dashboard + audit view | Engine 3 | Packing tests |
| 10 | Realtime, recovery, hardening, full E2E, final report | all | Full-workflow, concurrency, failure-recovery tests |

---

## 9. INTEGRITY VERIFIER (global, used by every gate)

`npm run verify:integrity` opens `warehouse.db` **read-only**, runs every check below, prints `PASS`/`FAIL`/`SKIP` per check and exits `1` if any check FAILS. A check whose tables do not exist yet (earlier phase) prints `SKIP`. Every check is a query that must return **zero rows** to pass. Implement each as a named entry in `scripts/verify-integrity.ts` and also expose the result through Engine 3 `GET /internal/v1/integrity` (used by `GET /api/admin/integrity`, Phase 9).

| ID | Name | Query (zero rows = pass) |
|---|---|---|
| I01 | stock bounds | `SELECT i.bin_code FROM inventory i JOIN bins b ON b.code=i.bin_code WHERE i.qty<0 OR i.reserved_qty<0 OR i.reserved_qty>i.qty OR i.qty>b.capacity` |
| I02 | reserved = Σ outstanding HELD | `SELECT i.bin_code FROM inventory i LEFT JOIN (SELECT bin_code, SUM(qty-consumed_qty-released_qty) AS held FROM reservations WHERE status='HELD' GROUP BY bin_code) r ON r.bin_code=i.bin_code WHERE i.reserved_qty <> COALESCE(r.held,0)` |
| I03 | sku ⇔ qty | `SELECT bin_code FROM inventory WHERE (qty=0 AND sku IS NOT NULL) OR (qty>0 AND sku IS NULL)` |
| I04 | bin qty = ledger | `SELECT bin_code FROM (SELECT i.bin_code, i.qty, COALESCE((SELECT SUM(CASE WHEN m.to_kind='BIN' AND m.to_ref=i.bin_code THEN m.qty ELSE 0 END) - SUM(CASE WHEN m.from_kind='BIN' AND m.from_ref=i.bin_code THEN m.qty ELSE 0 END) FROM stock_movements m WHERE (m.to_kind='BIN' AND m.to_ref=i.bin_code) OR (m.from_kind='BIN' AND m.from_ref=i.bin_code)),0) AS ledger FROM inventory i) WHERE qty <> ledger` |
| I05 | staging = ledger | `SELECT * FROM (SELECT p.sku, (SELECT COALESCE(SUM(CASE WHEN to_kind='STAGING' THEN qty WHEN from_kind='STAGING' THEN -qty ELSE 0 END),0) FROM stock_movements m WHERE m.sku=p.sku) AS ledger, (SELECT COALESCE(SUM(qty_received-qty_put_away),0) FROM receipt_lines rl WHERE rl.sku=p.sku) AS rows_staged FROM products p) WHERE ledger <> rows_staged` |
| I06 | put-away totals | `SELECT rl.id FROM receipt_lines rl WHERE rl.qty_put_away <> COALESCE((SELECT SUM(qty) FROM putaways p WHERE p.receipt_line_id=rl.id),0)` |
| I07 | picked = consumed | `SELECT ol.id FROM order_lines ol WHERE ol.qty_picked <> COALESCE((SELECT SUM(consumed_qty) FROM reservations r WHERE r.order_line_id=ol.id),0)` |
| I08 | terminal orders hold nothing | `SELECT o.ref FROM orders o JOIN reservations r ON r.order_id=o.id WHERE r.status='HELD' AND o.status IN ('PICKED','COMPLETED','CANCELLED')` |
| I09 | completed missions finished | `SELECT m.ref FROM missions m JOIN pick_stops s ON s.mission_id=m.id WHERE m.status='COMPLETED' AND s.status NOT IN ('PICKED','RESOLVED')` |
| I10 | held reservations have a live stop | `SELECT r.id FROM reservations r JOIN orders o ON o.id=r.order_id WHERE r.status='HELD' AND o.status IN ('ASSIGNED','PICKING') AND NOT EXISTS (SELECT 1 FROM pick_stops s JOIN missions m ON m.id=s.mission_id WHERE s.reservation_id=r.id AND m.status IN ('ASSIGNED','IN_PROGRESS') AND s.status IN ('PENDING','EXCEPTION_OPEN'))` |
| I11 | foreign keys | `PRAGMA foreign_key_check` (must return no rows) |
| I12 | sqlite integrity | `PRAGMA integrity_check` (must return exactly `ok`) |
| I13 | one SKU per reserved SKU | `SELECT r.id FROM reservations r JOIN inventory i ON i.bin_code=r.bin_code WHERE r.status='HELD' AND i.sku IS NOT r.sku` |

---

# PHASE 1 — FOUNDATION

**Objective:** a runnable skeleton where all five processes start, the database schema for catalog + layout exists, authentication and RBAC work, and the shared infrastructure every later phase relies on (ids, transactions, idempotency, audit, outbox, error model, migration runner, integrity verifier, test harness) is built and tested.
**Prerequisites:** none.
**Why first:** every later phase reuses these primitives; getting them wrong poisons everything.

## 1.1 Deliverables checklist
1. Monorepo, workspaces, `tsconfig.base.json` (strict), root scripts (§4.1), `.env.example`, `.gitignore`, `README.md` (start commands, default accounts).
2. `packages/shared`: `enums.ts` (roles, priorities, all statuses of §7), `errors.ts` (catalog of §6.4 + `DomainError`), `ids.ts` (`formatRef(prefix:string,n:number)` → zero-padded 4 digits), zod schemas for pagination, login, and the product DTO.
3. Migration runner `scripts/migrate.ts` (+ library function `applyMigrations(db, dir)` used by tests):
   - Table `schema_migrations(version TEXT PK, name TEXT, checksum TEXT, applied_at TEXT)` created by the runner itself.
   - Files applied in filename order inside **one transaction per file**; the file's SHA-256 is stored.
   - If an already-applied file's checksum differs → abort with `MIGRATION_CHECKSUM_MISMATCH` and exit 1 (never silently continue).
   - Warehouse migrations from `migrations/warehouse/*.sql`, scheduler from `migrations/scheduler/*.sql`.
4. Migrations `001_core.sql`, `002_catalog_layout.sql` (below).
5. `scripts/seed-base.ts`: idempotent seed of users (bcrypt cost 10), products, shelves, bins, inventory rows, nav nodes/edges (§6.11). Running twice must not duplicate or change data. It must refuse to run if `NODE_ENV=production`.
6. Engine 3 skeleton (`services/engine3-inventory`): `config.ts`, `db/connection.ts`, `db/tx.ts`, `domain/ids.ts`, `domain/idempotency.ts`, `domain/audit.ts`, `domain/outbox.ts`, `middleware/internalAuth.ts`, `middleware/errorHandler.ts`, `routes/health.ts`, `routes/auth.ts` (`POST /internal/v1/auth/verify`), `routes/products.ts`.
7. Gateway skeleton: `server.ts`, middleware chain (§6.5), `routes/auth.ts`, `routes/health.ts` (`GET /api/health` aggregates the 3 engines' health, `GET /health` is its own liveness), `routes/products.ts`, `clients/engine3.ts` (fetch wrapper with timeout, internal headers, error mapping → `ENGINE3_UNAVAILABLE`).
8. Engine 1 and Engine 2: `server.ts` with `/health` and the internal-token middleware only.
9. Web skeleton: Vite + React + Router + Query + Zustand; `theme.css` (dark tokens); `LoginPage`; `AppShell` (header with user name + role + logout, left nav showing **only implemented pages**); `HomePage` showing live service health (four status dots from `/api/health`).
10. `scripts/verify-integrity.ts` (all checks of §9; most SKIP now), `scripts/backup-db.ts`.
11. `tests/harness` (below).

## 1.2 Migration `migrations/warehouse/001_core.sql`
```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('MANAGER','OPERATOR','PICKER','STAFF')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE id_sequences (
  name       TEXT PRIMARY KEY,
  prefix     TEXT NOT NULL,
  next_value INTEGER NOT NULL CHECK (next_value >= 1)
);
INSERT INTO id_sequences (name, prefix, next_value) VALUES
  ('receipt','RCV',1), ('putaway','PUT',1), ('order','ORD',1), ('mission','MIS',1),
  ('movement','MOV',1), ('exception','EXC',1), ('packing','PCK',1), ('adjustment','ADJ',1);

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_user_id INTEGER REFERENCES users(id),
  actor_role    TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  details_json  TEXT NOT NULL DEFAULT '{}',
  request_id    TEXT
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_time   ON audit_log(occurred_at);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT,'AUDIT_LOG_IS_APPEND_ONLY'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT,'AUDIT_LOG_IS_APPEND_ONLY'); END;

CREATE TABLE outbox_events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  data_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE idempotency_keys (
  key           TEXT PRIMARY KEY,
  scope         TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  status_code   INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

## 1.3 Migration `migrations/warehouse/002_catalog_layout.sql`
```sql
CREATE TABLE products (
  sku             TEXT PRIMARY KEY COLLATE NOCASE CHECK (length(sku) BETWEEN 3 AND 32),
  name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category        TEXT NOT NULL,
  storage_class   TEXT NOT NULL DEFAULT 'STANDARD' CHECK (storage_class IN ('STANDARD','HAZMAT')),
  unit            TEXT NOT NULL DEFAULT 'EA',
  max_receive_qty INTEGER NOT NULL DEFAULT 5000 CHECK (max_receive_qty > 0),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_products_name ON products(name COLLATE NOCASE);

CREATE TABLE nav_nodes (
  id   TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('DOCK','PACK','CROSS','AISLE')),
  x    REAL NOT NULL,
  y    REAL NOT NULL
);
CREATE TABLE nav_edges (
  from_node TEXT NOT NULL REFERENCES nav_nodes(id),
  to_node   TEXT NOT NULL REFERENCES nav_nodes(id),
  distance  REAL NOT NULL CHECK (distance > 0),
  PRIMARY KEY (from_node, to_node),
  CHECK (from_node <> to_node)
);  -- stored once; loaded as undirected

CREATE TABLE shelves (
  code          TEXT PRIMARY KEY,
  aisle         TEXT NOT NULL,
  bay           INTEGER NOT NULL CHECK (bay >= 1),
  side          TEXT NOT NULL CHECK (side IN ('L','R')),
  storage_class TEXT NOT NULL DEFAULT 'STANDARD' CHECK (storage_class IN ('STANDARD','HAZMAT')),
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','MAINTENANCE','BLOCKED')),
  nav_node_id   TEXT NOT NULL REFERENCES nav_nodes(id),
  x             REAL NOT NULL,
  y             REAL NOT NULL,
  UNIQUE (aisle, bay, side)
);

CREATE TABLE bins (
  code             TEXT PRIMARY KEY,
  shelf_code       TEXT NOT NULL REFERENCES shelves(code),
  level            INTEGER NOT NULL CHECK (level BETWEEN 1 AND 6),
  capacity         INTEGER NOT NULL CHECK (capacity > 0),
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED','DAMAGED')),
  recount_required INTEGER NOT NULL DEFAULT 0 CHECK (recount_required IN (0,1)),
  UNIQUE (shelf_code, level)
);
CREATE INDEX idx_bins_shelf ON bins(shelf_code);
```

## 1.4 Engine 3 infrastructure — exact contracts
```ts
// db/connection.ts
openDb(path: string, opts?: { readonly?: boolean }): Database
// PRAGMAs: journal_mode=WAL, foreign_keys=ON, busy_timeout=5000, synchronous=NORMAL

// db/tx.ts  — wraps better-sqlite3 db.transaction(fn).immediate(); rethrows after rollback
runTx<T>(db: Database, fn: () => T): T

// domain/ids.ts
nextRef(db: Database, name: 'receipt'|'putaway'|'order'|'mission'|'movement'|'exception'|'packing'|'adjustment'): string
//  must be called INSIDE a transaction. Uses:  UPDATE id_sequences SET next_value=next_value+1 WHERE name=? RETURNING prefix, next_value-1 AS n

// domain/idempotency.ts   (algorithm in §6.6)
runIdempotent<T>(db, args:{ key:string; scope:string; body:unknown }, handler:()=>{ status:number; body:T }): { status:number; body:T; replay:boolean }

// domain/audit.ts / outbox.ts
audit(db, { actor:{id:number;role:string}|null, action:string, entity_type:string, entity_id:string, details?:object, request_id?:string }): void
emit(db, { event_type:string, entity_type:string, entity_id:string, data:object }): void

// every domain mutation function has this shape (enables rollback tests):
type Hooks = { afterStep?: (stepName: string) => void }   // tests throw from here to prove rollback
```
`DomainError` carries `code`, `message`, `details`; `errorHandler` converts it, `ZodError` → `VALIDATION_ERROR`, anything else → `INTERNAL_ERROR` (logged with request id, no stack in the response).

## 1.5 Test harness (`tests/harness`)
- `createTempDbPaths()` → temp dir with fresh `warehouse.db` and `scheduler.db` paths (deleted after tests).
- `startStack({ seed: boolean })` → picks free ports, spawns Engine 3, Engine 2, Engine 1, Gateway as child processes (`tsx`) with env overrides, applies migrations and optional seed on the temp DB, waits until every `/health` is OK, returns `{ urls, stop(), kill(name), restart(name) }`.
- `apiClient(gatewayUrl)` → `login(username)` (password from env), `get/post(path, body, { idempotencyKey? })` that auto-generates an `Idempotency-Key` per call unless given.
- **No test may touch `./data/warehouse.db`.**

## 1.6 Frontend (Phase 1 scope)
- `/login`: fields `username`, `password`, submit. Errors shown inline (`UNAUTHENTICATED` → "Wrong username or password").
- After login store token in `authStore` **and `sessionStorage`** (so refresh keeps the session); logout clears both. A 401 from any API call logs the user out.
- `AppShell`: header `Dark Storage WMS` + `{display_name} · {role}` + Logout; nav shows `Home` only (later phases add links, each phase adds its own).
- `HomePage`: calls `GET /api/health` every 10 s and shows `Gateway / Engine 1 / Engine 2 / Engine 3` with green/red dots.

## 1.7 Phase 1 tests
| ID | Test | Expected |
|---|---|---|
| P1-T01 | Migrate empty temp DB twice | Tables created; second run applies 0 migrations |
| P1-T02 | Modify an applied migration file's content, run migrate | Fails with `MIGRATION_CHECKSUM_MISMATCH` |
| P1-T03 | Run base seed | 5 users, 24 products, 48 shelves, 192 bins, 192 inventory rows (after P2 migration; before it, skip), **34 nav nodes, 36 nav edges** |
| P1-T04 | Run seed twice | Same counts, no errors |
| P1-T05 | Load nav graph, BFS from `DOCK` | All 34 nodes reachable |
| P1-T06 | `UPDATE`/`DELETE` on `audit_log` | Aborts with `AUDIT_LOG_IS_APPEND_ONLY` |
| P1-T07 | Login correct / wrong password / `GET /auth/me` with token | 200 + token / 401 `UNAUTHENTICATED` / 200 user |
| P1-T08 | RBAC middleware unit test (mock app) | Allowed role passes; other role → 403 `FORBIDDEN`; no token → 401 |
| P1-T09 | Unknown route; invalid body on a route using zod | 404 envelope; 400 `VALIDATION_ERROR` with `details.issues` |
| P1-T10 | Call Engine 3 `/internal/v1/products` without internal token | 401 |
| P1-T11 | `nextRef` ×3 in committed txs; then one in a tx that throws | `ORD-0001..3`; after the failure the next call returns `ORD-0004` (no gap) |
| P1-T12 | `runIdempotent`: same key+body twice / same key different body / handler throws then retry | Handler runs once, replay flag true / `IDEMPOTENCY_KEY_REUSED` / failure not stored, retry executes |
| P1-T13 | `verify:integrity` on freshly seeded DB | Exit 0 (SKIP allowed) |
| P1-T14 | `db:backup` | New file in `backups/`, opens read-only, row counts equal source |
| P1-T15 | `startStack()` | All four services healthy; `GET /api/health` shows all `ok` |
| P1-T16 | `GET /api/products?search=mouse` and `?search=SKU003` | Name search and SKU search both return correct items; page envelope present |

## 1.8 Phase 1 acceptance gate
- [ ] `npm run db:migrate && npm run db:seed` succeed on an empty `data/` folder.
- [ ] `npm run dev` starts 5 processes; browser shows login → home with 4 green dots.
- [ ] `npm run test` green (P1-T01…T16). `npm run verify:integrity` exits 0.
- [ ] Checklist + log updated; committed.

---

# PHASE 2 — INVENTORY CORE (Engine 3)

**Objective:** make physical stock safe. Build the stock model, the invariant-enforcing primitives, the append-only movement ledger, bin management (status + recount), the read APIs, and the Inventory + Warehouse (2D) pages. After this phase it must be *impossible* — even by writing raw SQL — to mix SKUs in a bin, exceed capacity, go negative, or reserve more than exists.
**Prerequisites:** Phase 1 gate passed.

## 2.1 Migration `migrations/warehouse/003_inventory_ledger.sql`
```sql
CREATE TABLE inventory (
  bin_code     TEXT PRIMARY KEY REFERENCES bins(code),
  sku          TEXT COLLATE NOCASE REFERENCES products(sku),
  qty          INTEGER NOT NULL DEFAULT 0,
  reserved_qty INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (qty >= 0),
  CHECK (reserved_qty >= 0),
  CHECK (reserved_qty <= qty),
  CHECK ((qty = 0 AND sku IS NULL) OR (qty > 0 AND sku IS NOT NULL))
);
CREATE INDEX idx_inventory_sku ON inventory(sku);

-- capacity: never exceed bin capacity (INSERT and UPDATE)
CREATE TRIGGER inventory_capacity_upd BEFORE UPDATE ON inventory
WHEN NEW.qty > (SELECT capacity FROM bins WHERE code = NEW.bin_code)
BEGIN SELECT RAISE(ABORT,'CAPACITY_EXCEEDED'); END;
CREATE TRIGGER inventory_capacity_ins BEFORE INSERT ON inventory
WHEN NEW.qty > (SELECT capacity FROM bins WHERE code = NEW.bin_code)
BEGIN SELECT RAISE(ABORT,'CAPACITY_EXCEEDED'); END;

-- single SKU per bin: a non-empty bin can never change SKU
CREATE TRIGGER inventory_sku_mix BEFORE UPDATE ON inventory
WHEN OLD.sku IS NOT NULL AND NEW.sku IS NOT NULL AND NEW.sku <> OLD.sku AND NEW.qty > 0
BEGIN SELECT RAISE(ABORT,'SKU_CONFLICT'); END;

-- stock may only increase in ACTIVE bins on ACTIVE shelves
CREATE TRIGGER inventory_receivable BEFORE UPDATE ON inventory
WHEN NEW.qty > OLD.qty AND (
      (SELECT status FROM bins WHERE code = NEW.bin_code) <> 'ACTIVE'
   OR (SELECT s.status FROM shelves s JOIN bins b ON b.shelf_code = s.code WHERE b.code = NEW.bin_code) <> 'ACTIVE')
BEGIN SELECT RAISE(ABORT,'BIN_NOT_RECEIVABLE'); END;

-- storage class: HAZMAT product only on HAZMAT shelf (and vice versa)
CREATE TRIGGER inventory_storage_class BEFORE UPDATE ON inventory
WHEN NEW.sku IS NOT NULL AND NEW.qty > OLD.qty AND
     (SELECT p.storage_class FROM products p WHERE p.sku = NEW.sku) <>
     (SELECT s.storage_class FROM shelves s JOIN bins b ON b.shelf_code = s.code WHERE b.code = NEW.bin_code)
BEGIN SELECT RAISE(ABORT,'STORAGE_CLASS_MISMATCH'); END;

CREATE TABLE stock_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ref           TEXT NOT NULL UNIQUE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('RECEIVE','PUTAWAY','RELOCATE','PICK','ADJUSTMENT')),
  sku           TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  qty           INTEGER NOT NULL CHECK (qty > 0),
  from_kind     TEXT NOT NULL CHECK (from_kind IN ('EXTERNAL','STAGING','BIN','ADJUSTMENT')),
  from_ref      TEXT,
  to_kind       TEXT NOT NULL CHECK (to_kind IN ('STAGING','BIN','ORDER_PACKING','ADJUSTMENT')),
  to_ref        TEXT,
  related_type  TEXT,
  related_ref   TEXT,
  performed_by  INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_mov_sku  ON stock_movements(sku);
CREATE INDEX idx_mov_time ON stock_movements(created_at);
CREATE INDEX idx_mov_type ON stock_movements(movement_type);
CREATE INDEX idx_mov_to   ON stock_movements(to_kind, to_ref);
CREATE INDEX idx_mov_from ON stock_movements(from_kind, from_ref);
CREATE TRIGGER mov_no_update BEFORE UPDATE ON stock_movements
  BEGIN SELECT RAISE(ABORT,'STOCK_MOVEMENTS_ARE_APPEND_ONLY'); END;
CREATE TRIGGER mov_no_delete BEFORE DELETE ON stock_movements
  BEGIN SELECT RAISE(ABORT,'STOCK_MOVEMENTS_ARE_APPEND_ONLY'); END;

-- the ONE definition of sellable stock (used by ATP and by reservation allocation)
CREATE VIEW v_available_stock AS
SELECT i.bin_code, i.sku, i.qty, i.reserved_qty, (i.qty - i.reserved_qty) AS available_qty,
       b.shelf_code, b.level, b.capacity, s.nav_node_id
FROM inventory i
JOIN bins b    ON b.code = i.bin_code
JOIN shelves s ON s.code = b.shelf_code
WHERE i.sku IS NOT NULL AND b.status = 'ACTIVE' AND s.status = 'ACTIVE'
  AND b.recount_required = 0 AND (i.qty - i.reserved_qty) > 0;
```
**Movement conventions (the ledger language):**
| `movement_type` | from → to | `from_ref` / `to_ref` |
|---|---|---|
| `RECEIVE` | `EXTERNAL → STAGING` | `NULL` / receipt ref (e.g. `RCV-0001`) |
| `PUTAWAY` | `STAGING → BIN` | receipt ref / bin code |
| `RELOCATE` | `BIN → BIN` | source bin / destination bin |
| `PICK` | `BIN → ORDER_PACKING` | bin code / order ref |
| `ADJUSTMENT` | `BIN → ADJUSTMENT` (decrease) or `ADJUSTMENT → BIN` (increase) | bin code or `ADJ-0001` |

The seed script already inserted `inventory` rows for all bins in Phase 1 — add that step to the seed once this migration exists (idempotent `INSERT OR IGNORE`).

## 2.2 Stock primitives — `domain/inventoryRepo.ts` (the ONLY file that writes `inventory`)
All functions run inside an existing transaction (callers use `runTx`). They validate with explicit reads first (for precise errors), then perform a *conditional* UPDATE and assert `changes === 1`, otherwise throw `INVENTORY_DRIFT`. Triggers are the backstop; if a trigger message (`CAPACITY_EXCEEDED`, `SKU_CONFLICT`, `BIN_NOT_RECEIVABLE`, `STORAGE_CLASS_MISMATCH`) ever surfaces, map it to the same-named `DomainError`.

```ts
stockIn(db,  { bin, sku, qty })                       // add stock
stockOut(db, { bin, qty, consumeReserved })           // remove stock
reserve(db,  { bin, qty })                            // reserved_qty += qty
release(db,  { bin, qty })                            // reserved_qty -= qty
recordMovement(db, { type, sku, qty, from:{kind,ref}, to:{kind,ref}, related?:{type,ref}, actorId }) : string // returns MOV ref
```
**`stockIn` validation order** (first failure wins):
1. bin exists → else `UNKNOWN_BIN` · 2. `qty` positive integer → `QUANTITY_INVALID` · 3. bin status `ACTIVE`, shelf status `ACTIVE`, `recount_required=0` → else `BIN_NOT_RECEIVABLE` (`details.reason` ∈ `BIN_BLOCKED|BIN_DAMAGED|SHELF_MAINTENANCE|SHELF_BLOCKED|RECOUNT_REQUIRED`) · 4. product storage class equals shelf storage class → `STORAGE_CLASS_MISMATCH` · 5. bin empty or same SKU → else `SKU_CONFLICT` (`details.existing_sku`) · 6. `current + qty <= capacity` → else `CAPACITY_EXCEEDED` (`details.free_capacity`).
```sql
UPDATE inventory SET sku = @sku, qty = qty + @q, updated_at = @now
WHERE bin_code = @bin
  AND (sku IS NULL OR sku = @sku)
  AND qty + @q <= (SELECT capacity FROM bins WHERE code = @bin);
```
**`stockOut`:**
```sql
UPDATE inventory
SET qty = qty - @q,
    reserved_qty = reserved_qty - CASE WHEN @consume = 1 THEN @q ELSE 0 END,
    sku = CASE WHEN qty - @q = 0 THEN NULL ELSE sku END,
    updated_at = @now
WHERE bin_code = @bin AND qty >= @q
  AND CASE WHEN @consume = 1 THEN reserved_qty >= @q ELSE (qty - reserved_qty) >= @q END;
```
(`consumeReserved=false` removes only *unreserved* stock — used by relocate; `true` consumes reserved stock — used by picking.) Insufficient → `INSUFFICIENT_STOCK`.
**`reserve`:** `UPDATE inventory SET reserved_qty = reserved_qty + @q WHERE bin_code=@bin AND qty - reserved_qty >= @q` (0 changes → `INSUFFICIENT_STOCK`). **`release`:** `… SET reserved_qty = reserved_qty - @q WHERE bin_code=@bin AND reserved_qty >= @q` (0 changes → `INVENTORY_DRIFT`).
> **Forbidden:** any `INSERT … ON CONFLICT … DO UPDATE` on `inventory`; any UPDATE of `inventory.sku` that is not inside `stockIn`/`stockOut`.

## 2.3 Bin management (Engine 3 + Gateway)
- `POST /api/inventory/bins/:code/status` body `{ status: 'ACTIVE'|'BLOCKED'|'DAMAGED', reason: string(3..200) }` (MANAGER). Setting `BLOCKED`/`DAMAGED` requires `reserved_qty = 0`, else `BIN_HAS_RESERVATIONS`. Stock already in the bin stays (it is excluded from sellable stock by `v_available_stock`). Audit `BIN_STATUS_CHANGED`; event `bin.status_changed`.
- `POST /api/inventory/bins/:code/recount` body `{ counted_qty: int>=0, sku?: string, reason: string(3..200) }` (MANAGER). Algorithm (`applyRecount`, reused by Phase 8 exception resolution):
  1. load bin/inventory; if `counted_qty>0` and bin empty → `sku` required; if bin occupied and `sku` given and different → `SKU_CONFLICT`.
  2. `counted_qty >= reserved_qty` else `ADJUSTMENT_CONFLICT` (`details.reserved_qty`, and list of blocking reservation refs once Phase 6 exists).
  3. set `recount_required=0` **first**, then `delta = counted_qty − qty`: `delta>0` → `stockIn` + movement `ADJUSTMENT` (`ADJ-ref → bin`); `delta<0` → `stockOut(consumeReserved=false)` + movement (`bin → ADJ-ref`); `delta=0` → no movement.
  4. audit `BIN_RECOUNTED` (before/after), event `inventory.changed`.

## 2.4 Read APIs (all `GET`, any authenticated role)
- `GET /api/inventory/summary?search=&page=` → items:
```json
{ "sku":"SKU001","product_name":"Wireless Mouse","category":"Peripherals",
  "stored_qty":120,"reserved_qty":5,"available_to_promise":115,"unavailable_qty":0,"staged_qty":50,"bins_used":2 }
```
`stored_qty` = Σ qty over all bins; `reserved_qty` = Σ reserved; `available_to_promise` = Σ `available_qty` from `v_available_stock`; `unavailable_qty = stored − reserved − ATP` (stock sitting in blocked/damaged/maintenance/recount bins); `staged_qty` = Σ(`qty_received − qty_put_away`) (0 until Phase 3).
- `GET /api/inventory/bins?sku=&shelf=&status=&occupied=true|false&page=` → `{bin_code, shelf_code, level, capacity, status, recount_required, sku, product_name, qty, reserved_qty, available_qty, free_capacity}`.
- `GET /api/inventory/bins/:code` → bin detail + `recent_movements` (last 10) + `held_reservations` (empty until Phase 6).
- `GET /api/inventory/movements?sku=&bin=&type=&page=` (newest first) → `{ref, type, sku, product_name, qty, from_label, to_label, related_ref, performed_by_name, created_at}` where labels are human strings (`"Receiving (RCV-0001)"`, `"Bin A-03-L-2"`, `"Order ORD-0002 (packing)"`).
- `GET /api/warehouse/layout` → `{ aisles:[ { aisle:"A", shelves:[ { code, bay, side, status, storage_class, x, y, bins:[ { code, level, capacity, status, recount_required, sku, product_name, qty, reserved_qty } ] } ] } ] }`
- `GET /api/warehouse/search?q=` → matches bins by bin code, shelf code, SKU or product name; returns up to 50 `{bin_code, shelf_code, sku, product_name, qty, reserved_qty}` (only bins with stock when `q` matches a product).

## 2.5 Frontend
**Inventory page (`/inventory`)** — tabs:
1. *Summary*: search box (name **or** SKU), table columns: Product (`Name · SKU`), Stored, Reserved, Available, Staged, Bins; row click opens the bin list filtered by that SKU.
2. *Bins*: filters (SKU search, shelf, status, occupied); columns: Bin, Product, Qty, Reserved, Available, Capacity (fill bar), Status badge. Row opens a side panel (bin detail + recent movements). MANAGER sees buttons **Block / Mark damaged / Reactivate** and **Recount** (modal with counted qty, SKU if empty bin, reason).
3. *Ledger*: filterable movement table with human labels.

**Warehouse page (`/warehouse`)** — **plain HTML/CSS grid, no canvas/WebGL**: one column per aisle; each shelf is a small card showing its 4 levels as stacked cells coloured by fill % (empty/low/medium/high/full) with distinct styles for `BLOCKED`, `DAMAGED`, `MAINTENANCE`, `recount_required`. Hover/click shows a tooltip card (bin code, product name + SKU, qty, reserved). A "Locate" search box highlights matching bins and scrolls to the first. Legend included. Data comes only from `/api/warehouse/layout`; refetch on focus and after mutations.

## 2.6 Phase 2 tests
| ID | Test | Expected |
|---|---|---|
| P2-T01 | `stockIn` into empty bin | qty, sku set; `available_qty = qty` |
| P2-T02 | `stockIn` same SKU again | qty accumulates |
| P2-T03 | `stockIn` different SKU into occupied bin | `SKU_CONFLICT`; row unchanged |
| P2-T04 | `stockIn` beyond capacity | `CAPACITY_EXCEEDED`; unchanged |
| P2-T05 | `stockIn` into BLOCKED bin / DAMAGED bin / MAINTENANCE shelf / `recount_required` bin | `BIN_NOT_RECEIVABLE` with the right `details.reason` |
| P2-T06 | HAZMAT SKU into STANDARD shelf, and STANDARD SKU into HAZMAT shelf | `STORAGE_CLASS_MISMATCH` |
| P2-T07 | **Raw SQL** `UPDATE inventory` that changes SKU of non-empty bin / exceeds capacity / lowers qty below reserved | DB aborts (`SKU_CONFLICT` / `CAPACITY_EXCEEDED` / CHECK failed) — proves DB-level enforcement |
| P2-T08 | **Raw SQL UPSERT** `INSERT … ON CONFLICT(bin_code) DO UPDATE SET sku=excluded.sku, qty=excluded.qty` on an occupied bin with another SKU | Aborts; row unchanged |
| P2-T09 | `stockOut` unreserved qty / more than unreserved / exactly all | ok / `INSUFFICIENT_STOCK`, unchanged / qty 0 **and sku NULL** |
| P2-T10 | `reserve` within available / beyond available; `release` within reserved / beyond | ok / `INSUFFICIENT_STOCK` / ok / `INVENTORY_DRIFT` |
| P2-T11 | `stockOut` with `consumeReserved=true` | `qty` and `reserved_qty` both decrease |
| P2-T12 | Composite test function (`stockIn` + `recordMovement` + `hooks.afterStep` that throws) inside `runTx` | Everything rolled back: inventory, ledger and `id_sequences` unchanged |
| P2-T13 | `UPDATE`/`DELETE` on `stock_movements` | Aborts `STOCK_MOVEMENTS_ARE_APPEND_ONLY` |
| P2-T14 | `recordMovement` ×3 | `MOV-0001..0003`, correct kinds/refs |
| P2-T15 | Bin status: block bin that has `reserved_qty>0` / block empty bin then `stockIn` / reactivate then `stockIn` | `BIN_HAS_RESERVATIONS` / `BIN_NOT_RECEIVABLE` / ok |
| P2-T16 | Recount: below reserved / above capacity / delta ≠ 0 / delta = 0 / replay same Idempotency-Key | `ADJUSTMENT_CONFLICT` / `CAPACITY_EXCEEDED` / `ADJ-0001` + ledger row + flag cleared / no movement, flag cleared / single effect |
| P2-T17 | API reads on fixtures: summary, bins, movements, layout, search; pagination; PICKER can GET; OPERATOR POST status → 403 | Correct shapes and numbers; product names present everywhere |
| P2-T18 | `v_available_stock` | Excludes blocked/damaged bins, maintenance-shelf bins, recount-required bins, zero-available bins |
| P2-T19 | Integrity verifier after fixtures | I01–I04, I13 PASS |
| P2-T20 | Web component tests: `ProductLabel` shows name and SKU; Warehouse grid renders 48 shelves from a mocked layout; status styling classes applied | Pass |

*Test fixture helper (tests only):* `fixtures.seedBinStock(db, {bin, sku, qty})` = `stockIn` + movement `ADJUSTMENT` (`ADJ-ref → bin`), so the ledger always reconciles.

## 2.7 Phase 2 acceptance gate
- [ ] P2-T01…T20 green; all Phase 1 tests still green; `verify:integrity` exits 0.
- [ ] `/inventory` and `/warehouse` pages render real data from the seeded DB (all empty bins) with no console errors.
- [ ] Log + checklist updated; committed.

---

# PHASE 3 — RECEIVING

**Objective:** an operator manually records incoming goods (one or many products) into the **staging area**. Nothing is stored in a bin yet. Every receipt has a readable reference, per-line movement records and an audit trail.
**Prerequisites:** Phase 2 gate passed.

## 3.1 Migration `migrations/warehouse/004_receiving.sql`
```sql
CREATE TABLE receipts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ref          TEXT NOT NULL UNIQUE,
  supplier     TEXT,
  reference_no TEXT,
  notes        TEXT,
  received_at  TEXT NOT NULL,
  received_by  INTEGER NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'STAGED' CHECK (status IN ('STAGED','PARTIALLY_PUT_AWAY','PUT_AWAY')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE receipt_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id    INTEGER NOT NULL REFERENCES receipts(id),
  line_no       INTEGER NOT NULL,
  sku           TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  qty_received  INTEGER NOT NULL CHECK (qty_received > 0),
  qty_put_away  INTEGER NOT NULL DEFAULT 0,
  movement_ref  TEXT NOT NULL,
  CHECK (qty_put_away >= 0 AND qty_put_away <= qty_received),
  UNIQUE (receipt_id, line_no)
);
CREATE INDEX idx_rl_sku ON receipt_lines(sku);
CREATE INDEX idx_rl_receipt ON receipt_lines(receipt_id);
```
Staged quantity of a line = `qty_received − qty_put_away`. **Staging is not a bin** — it is represented by these columns and mirrored in the ledger as `STAGING` movements.

## 3.2 API
`POST /api/receipts` (MANAGER, OPERATOR) — **PROXY**, `Idempotency-Key` required.
```json
// request
{ "supplier": "Acme Distribution", "reference_no": "PO-88421", "received_at": "2026-11-01T09:30:00.000Z",
  "notes": "Pallet 1 of 2", "lines": [ { "sku": "SKU001", "qty": 50 }, { "sku": "SKU002", "qty": 20 } ] }
// 201 response
{ "ref": "RCV-0001", "status": "STAGED", "received_at": "...", "received_by": { "id": 2, "name": "Omar Operator" },
  "supplier": "Acme Distribution", "reference_no": "PO-88421", "notes": "Pallet 1 of 2",
  "lines": [ { "line_id": 1, "line_no": 1, "sku": "SKU001", "product_name": "Wireless Mouse",
               "qty_received": 50, "qty_put_away": 0, "qty_staged": 50, "movement_ref": "MOV-0001" } ] }
```
zod rules: `lines` 1–20 items; `qty` integer 1–100000 (domain additionally enforces `product.max_receive_qty`); `supplier`/`reference_no` ≤ 80 chars; `notes` ≤ 500; `received_at` optional ISO date, defaults to now, must not be more than 5 minutes in the future.
Other endpoints: `GET /api/receipts?status=&search=&page=` (search matches receipt ref, supplier, reference_no, product name/SKU), `GET /api/receipts/:ref`, **`GET /api/receipts/staged`** → outstanding lines with `qty_staged > 0`, FIFO order:
`{ line_id, receipt_ref, sku, product_name, category, storage_class, qty_received, qty_put_away, qty_staged, received_at }`.

## 3.3 Engine 3 `createReceipt` algorithm (single `runIdempotent` + `runTx`)
```
1. validate: lines non-empty; each sku exists & active (UNKNOWN_SKU {sku}); qty integer in [1, product.max_receive_qty]
   (QUANTITY_INVALID {sku,max}); no duplicate sku (DUPLICATE_LINE_SKU {sku})
2. ref = nextRef('receipt'); INSERT receipts(status='STAGED', received_by=actor.id)
3. for each line (line_no 1..n):
     mov = recordMovement(type RECEIVE, from EXTERNAL, to STAGING ref=<receipt ref>, related RECEIPT/<ref>)
     INSERT receipt_lines(..., movement_ref = mov)
     hooks.afterStep('line:'+line_no)
4. audit RECEIPT_CREATED {lines}; emit 'receipt.created' {ref, lines:[{sku,qty}]}
5. return 201 with the receipt detail
```
The frontend must never show success before this response arrives with a committed `ref`.

## 3.4 Frontend — `/receiving` (nav link visible to MANAGER, OPERATOR)
Tabs: **New Intake** · **Staged Stock** · **Receipts**. (*Staged Stock* is read-only in this phase; it gains the put-away action in Phase 5.)

**New Intake form**
- Header fields: Supplier (optional), Reference no. (optional), Receiving date/time (`datetime-local`, default now), Notes (optional).
- Lines table: product **type-ahead** (searches name *or* SKU via `GET /api/products?search=`, shows `Name · SKU · category`, HAZMAT products show a badge), quantity input (integer), remove button; **Add line** button. Duplicate product → inline message "Already added — edit its quantity instead" (no second line).
- Summary strip: total lines, total units.
- **Confirm Intake** button: disabled when invalid or pending. Client validation messages: "Pick a product", "Quantity must be a whole number ≥ 1", "At least one line is required", "Quantity exceeds the limit of {max} for {name}".
- On success: green banner "Intake recorded as **RCV-0001**" with buttons *View receipt* / *Go to Staged Stock*; form resets with a **new** idempotency key. On failure: error toast + inline message mapped from the error code; form content is kept.
**Staged Stock tab:** table (Receipt, Product, Received, Put away, Staged, Received at), FIFO. **Receipts tab:** searchable list; row opens a drawer with header, lines (movement refs) and audit entries.

## 3.5 Phase 3 tests
| ID | Test | Expected |
|---|---|---|
| P3-T01 | Receive 50 × SKU001 | Receipt `RCV-0001` STAGED; line staged 50; ledger `RECEIVE` with `MOV-0001`; audit row; outbox `receipt.created` |
| P3-T02 | Multi-line receipt (3 SKUs) | One receipt, 3 lines, 3 movements, committed together |
| P3-T03 | Line 2 has unknown SKU | 422 `UNKNOWN_SKU`; **no** receipt/line/movement rows; next receipt is still `RCV-0001` |
| P3-T04 | qty `0`, `-5`, `2.5`, `"10"`, over product max | `VALIDATION_ERROR` (types) / `QUANTITY_INVALID` (max) |
| P3-T05 | Same SKU twice in one request | `DUPLICATE_LINE_SKU` |
| P3-T06 | Same Idempotency-Key + body twice | Exactly one receipt; 2nd response identical with `Idempotent-Replay: true` |
| P3-T07 | Same key, different body | 422 `IDEMPOTENCY_KEY_REUSED` |
| P3-T08 | No Idempotency-Key header | 400 `IDEMPOTENCY_KEY_REQUIRED` |
| P3-T09 | `hooks.afterStep` throws after line 2 | Full rollback: no rows anywhere; sequences unchanged |
| P3-T10 | Two receipts of the same SKU | `/receipts/staged` lists both lines FIFO; inventory summary `staged_qty` = sum |
| P3-T11 | Restart Engine 3 (harness) then read receipts/staged | Identical data (persistence) |
| P3-T12 | POST as PICKER / STAFF / OPERATOR | 403 / 403 / 201 |
| P3-T13 | `received_at` 1 hour in future | 400 `VALIDATION_ERROR` |
| P3-T14 | Web: form validation messages, duplicate-product guard, submit disabled while pending, no success banner before response | Pass |
| P3-T15 | Web: `useIdempotentMutation` reuses key on network retry, regenerates after success | Pass |
| P3-T16 | `verify:integrity` after receipts | I05 PASS |

## 3.6 Phase 3 acceptance gate
- [ ] Via the browser as `operator1`: receive 50 × Wireless Mouse + 20 × Mechanical Keyboard → see `RCV-0001` in Receipts and both lines in Staged Stock; Inventory summary shows `staged_qty` 50/20.
- [ ] Double-clicking *Confirm Intake* creates exactly one receipt.
- [ ] P3 tests + all earlier tests green; `verify:integrity` exits 0; log + checklist updated; committed.

---

# PHASE 4 — ENGINE 2 SMART ALLOCATION

**Objective:** given a staged product and quantity, Engine 2 filters invalid bins, scores the valid ones with an explainable formula built only from real database facts, and returns a recommendation + alternatives + a split plan. The operator may ignore the recommendation and choose **any valid bin**. **A recommendation never changes inventory.**
**Prerequisites:** Phase 3 gate passed.

## 4.1 Engine 2 structure
```
services/engine2-optimizer/src/
  graph/loadGraph.ts      # loads nav_nodes/nav_edges (read-only DB) → adjacency map (undirected); cached 60 s
  graph/dijkstra.ts       # single-source shortest paths (binary heap or simple array; graph has 34 nodes)
  placement/snapshot.ts   # read-only query: all bins + shelf + inventory + product class + neighbour info
  placement/filter.ts     # evaluateBin() → { valid:true,... } | { valid:false, reason }
  placement/score.ts      # scoreCandidate() pure function
  placement/recommend.ts  # orchestrates filter → score → rank → split plan
  routes/placement.ts
```
Engine 2 opens `warehouse.db` with `readonly: true`. It **never** writes. It performs **no caching of stock** (reads fresh on every request); only the static nav graph is cached.

## 4.2 Candidate filtering (`evaluateBin`)
Rejection reasons, checked in this order (first match wins):
| Reason | Condition |
|---|---|
| `BIN_BLOCKED` / `BIN_DAMAGED` | bin status |
| `SHELF_UNAVAILABLE` | shelf status `MAINTENANCE` or `BLOCKED` |
| `RECOUNT_REQUIRED` | `recount_required = 1` |
| `STORAGE_CLASS_MISMATCH` | product storage class ≠ shelf storage class |
| `SKU_CONFLICT` | bin holds a different SKU (`qty > 0`) |
| `BIN_FULL` | `free_capacity = 0` |
| `INSUFFICIENT_CAPACITY` | `free_capacity < qty` **and** `allow_partial = false` |

`free_capacity = capacity − qty_current`. For valid candidates: `can_fit_full = free_capacity >= qty`; `max_acceptable_qty = min(qty, free_capacity)`; `suggested_qty = max_acceptable_qty`.

## 4.3 Scoring (all factor values in `[0,1]`; final score `0–100`, 2 decimals)
Default weights (config constants): `distance 0.25 · consolidation 0.30 · utilization 0.15 · affinity 0.15 · velocity 0.15`.
| Factor | Value |
|---|---|
| `distance` | `1 − dist(DOCK, shelf.nav_node)/maxDist`, where `dist` = Dijkstra distance and `maxDist` = largest Dijkstra distance from `DOCK` to any shelf node (global, so scores are comparable) |
| `consolidation` | bin already holds the same SKU and `can_fit_full` → `1.0`; same SKU but partial fit → `0.7`; empty bin on a shelf that already holds this SKU → `0.6`; any other empty bin → `0.4` |
| `utilization` | `min(1, (qty_current + suggested_qty) / capacity)` — prefers well-packed bins |
| `affinity` | Neighbours = *other* bins at the **same nav node** (same bay, both sides, all levels) that hold stock. `value = same_category_neighbours / occupied_neighbours`. If there are **no occupied neighbours** → `value = 0.5` and the breakdown entry is flagged `neutral:true` with note `"No neighbouring stock — neutral value, not a measurement"` |
| `velocity` | Applied **only if** the SKU has ≥ 1 `PICK` movement unit in the last 30 days **and** at least 3 distinct SKUs have pick history. `vp` = (number of SKUs with strictly fewer picked units) ÷ (n − 1), n = SKUs with history. `value = 1 − |vp − distance_value|` (fast movers should sit near the dock, slow movers further away). Otherwise `applied:false` |

If velocity is not applied, **renormalize** the remaining four weights to sum to 1 (divide each by 0.85). Response always states `scoring.velocity_applied` and a human note. `score = 100 × Σ(weight_i × value_i)`.
**Golden unit test:** factors `{distance:0.8, consolidation:1.0, utilization:0.5, affinity:0.5}`, velocity not applied → `score = 100 × (0.25·0.8 + 0.30·1.0 + 0.15·0.5 + 0.15·0.5)/0.85 = 76.47`.
**Ranking:** score DESC, then `bin_code` ASC (deterministic). `recommended` = first. `alternatives` = next up to `max_alternatives` (default 10).
**Split plan:** walk the ranked valid candidates, `take = min(remaining, free_capacity)`, until `remaining = 0`. Return `split_plan:[{bin_code, qty}]` and `split_plan_complete: boolean`.
**Reason text:** deterministic template from the top two contributing factors, e.g. `"Same SKU already stored here and the full quantity fits; 20.0 distance units from receiving."`

## 4.4 API
**Engine 2 internal:** `POST /internal/v1/placement/recommend` body `{ sku, qty, allow_partial=true, include_all=false, max_alternatives=10 }` and `POST /internal/v1/placement/validate` body `{ sku, qty, bin }` → `{ valid, reason?, free_capacity, max_acceptable_qty }` (must use the same `evaluateBin`).
**Public (Gateway, ORCH, roles MANAGER/OPERATOR):**
- `POST /api/placement/recommend` body `{ receipt_line_id, qty?, include_all? }` — Gateway loads the staged line from Engine 3 (`GET /internal/v1/receipts/lines/:id`), checks `qty <= qty_staged` (default = staged) else `QUANTITY_INVALID`, calls Engine 2, merges:
```json
{ "receipt_line": { "line_id":1, "receipt_ref":"RCV-0001", "sku":"SKU001", "product_name":"Wireless Mouse", "qty_staged":50 },
  "requested_qty": 50, "generated_at": "2026-11-01T09:31:00.000Z",
  "scoring": { "weights": {"distance":0.294,"consolidation":0.353,"utilization":0.176,"affinity":0.176,"velocity":0},
               "velocity_applied": false, "velocity_note": "Not enough pick history; velocity ignored." },
  "recommended": { "bin_code":"A-01-L-4","shelf_code":"A-01-L","level":4,"capacity":60,"current_qty":0,"current_sku":null,
                   "free_capacity":60,"can_fit_full":true,"suggested_qty":50,"distance":20.0,"score":71.3,
                   "breakdown":[ {"factor":"distance","weight":0.294,"value":0.75,"contribution":22.06,"applied":true},
                                 {"factor":"affinity","weight":0.176,"value":0.5,"contribution":8.82,"applied":true,"neutral":true,"note":"No neighbouring stock — neutral value, not a measurement"} ],
                   "reason":"..." },
  "alternatives": [ { "...same shape as recommended..." } ],
  "split_plan": [ { "bin_code":"A-01-L-4","qty":50 } ], "split_plan_complete": true,
  "rejected_summary": { "SKU_CONFLICT": 0, "BIN_BLOCKED": 1, "BIN_DAMAGED": 1, "SHELF_UNAVAILABLE": 4, "STORAGE_CLASS_MISMATCH": 16 },
  "all_bins": [ { "bin_code":"D-06-R-3","valid":false,"reason":"BIN_BLOCKED" } ] }   // only when include_all=true
```
- `POST /api/placement/validate` body `{ dest_bin, qty, receipt_line_id? , sku? }` (exactly one of `receipt_line_id` / `sku`; the SKU form is used by relocation) → `{ valid, reason?, free_capacity, max_acceptable_qty }`. Unknown bin → `UNKNOWN_BIN`.
- No `Idempotency-Key` needed (read-only). Engine 2 unreachable → `ENGINE2_UNAVAILABLE`.

## 4.5 Frontend — Allocation panel (opens from *Staged Stock* → **Allocate**)
- Header: `RCV-0001 · Wireless Mouse · SKU001 · staged 50`.
- **Quantity to put away** input (default = staged; 1…staged).
- **Recommended** card: bin + shelf, level, current stock, free capacity, score, **factor bars** (weight × value, `neutral`/`not applied` labelled), reason text, distance from receiving.
- **Alternatives** table: bin, shelf, free capacity, current SKU, score, distance; select button per row.
- **Split plan** box when `can_fit_full` is false for the top choice (lists bins + quantities; "Use this plan" pre-fills sequential put-aways in Phase 5).
- **Show all bins** toggle (`include_all=true`): full list; invalid rows are greyed with the human reason and their select button disabled; valid rows selectable. This is how the operator manually chooses *any valid bin*.
- Selecting a bin calls `POST /api/placement/validate` and shows a green "Valid — free capacity N" or red message. The panel displays the age of the recommendation ("generated 2 min ago") with a **Refresh** button; the final authority is the Engine 3 transaction in Phase 5.
- This phase adds **no** confirm action (Phase 5 adds it).

## 4.6 Phase 4 tests
| ID | Test | Expected |
|---|---|---|
| P4-T01 | Dijkstra on the seeded graph | `dist(DOCK,N-A-01)=20`, `dist(DOCK,N-A-06)=50`, `dist(DOCK,N-D-01)=80`, `dist(DOCK,PACK)=80` |
| P4-T02 | Golden `scoreCandidate` unit test | `76.47` |
| P4-T03 | Empty warehouse, recommend SKU001×50 | Valid recommendation on a STANDARD shelf; top score ≥ every alternative; ties broken by bin code |
| P4-T04 | Same-SKU bin with room vs empty bin at the same node | Same-SKU bin ranks higher (consolidation) |
| P4-T05 | Bin holding another SKU | Never in valid list; in `all_bins` with `SKU_CONFLICT` |
| P4-T06 | Full bin / same-SKU bin with free < qty (`allow_partial` true then false) | `BIN_FULL` / valid with `suggested_qty=free`, `can_fit_full=false` / `INSUFFICIENT_CAPACITY` |
| P4-T07 | Blocked, damaged, maintenance-shelf, recount-required bins | Rejected with the exact reason |
| P4-T08 | SKU023 (HAZMAT) vs SKU001 | SKU023 only on `D-01-*`/`D-02-*` shelves; SKU001 never on HAZMAT shelves |
| P4-T09 | < 3 SKUs with pick history | `velocity_applied:false`; weights sum to 1 |
| P4-T10 | Insert PICK movements for 3 SKUs (fixture) then recommend for the fastest and slowest | `velocity_applied:true`; fastest SKU's `distance` value ≥ slowest SKU's recommended `distance` value |
| P4-T11 | Affinity | `neutral:true` with no neighbours; > 0.5 when same-category neighbours exist in the same bay |
| P4-T12 | Split plan for qty > any single bin free capacity | Sum = qty (`split_plan_complete:true`) or `false` if warehouse too full |
| P4-T13 | `validate` vs `all_bins` for every bin (parametrized) | Identical validity and reason for all 192 bins |
| P4-T14 | Recommend twice with identical input | Identical output except `generated_at` |
| P4-T15 | Snapshot `inventory` + `stock_movements` before/after recommend | Unchanged |
| P4-T16 | Gateway: qty > staged / unknown line / PICKER role / Engine 2 stopped | `QUANTITY_INVALID` / `NOT_FOUND` / 403 / 503 `ENGINE2_UNAVAILABLE` |
| P4-T17 | Web: panel renders recommended + alternatives + disabled invalid rows with reasons; selecting an invalid row impossible | Pass |

## 4.7 Phase 4 acceptance gate
- [ ] Browser: from a staged line open *Allocate*, see the recommended bin with factor bars, toggle *Show all bins*, select a different valid bin and see "Valid"; select attempts on invalid bins are impossible.
- [ ] P4 tests + all earlier tests green; `verify:integrity` exits 0 (inventory untouched); log + checklist updated; committed.

---

# PHASE 5 — ENGINE 1 SCHEDULER + COORDINATED PUT-AWAY

**Objective:** build the real Engine 1 (priority queue, atomic multi-resource locks, retries, crash recovery) and use it to run **put-away** and **relocation** with Engine 3 performing the atomic stock transaction. This phase also delivers the confirm action in the Allocation panel, the Put-aways list, the Tasks page and the demo seed.
**Prerequisites:** Phase 4 gate passed.

## 5.1 Scheduler database — `migrations/scheduler/s001_scheduler.sql`
```sql
CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('PUTAWAY','RELOCATE','RESERVE_ORDER','PICK_CONFIRM','EXCEPTION_RESOLVE')),
  priority        INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 4),   -- 1 LOW, 2 NORMAL, 3 HIGH, 4 URGENT
  idempotency_key TEXT NOT NULL UNIQUE,
  actor_json      TEXT NOT NULL,
  payload_json    TEXT NOT NULL,
  resources_json  TEXT NOT NULL,                                       -- sorted JSON array of resource strings
  status          TEXT NOT NULL CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT,
  http_status     INTEGER,
  result_json     TEXT,
  error_code      TEXT,
  error_message   TEXT,
  error_details_json TEXT,
  created_at      TEXT NOT NULL,
  started_at      TEXT,
  finished_at     TEXT
);
CREATE INDEX idx_tasks_status ON tasks(status, priority, created_at);

CREATE TABLE locks (
  resource      TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id),
  fencing_token INTEGER NOT NULL,
  acquired_at   TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);
CREATE TABLE lock_tokens (id INTEGER PRIMARY KEY CHECK (id = 1), next_token INTEGER NOT NULL);
INSERT INTO lock_tokens (id, next_token) VALUES (1, 1);

CREATE TABLE task_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     TEXT NOT NULL,
  at          TEXT NOT NULL,
  event       TEXT NOT NULL,   -- ENQUEUED, LOCKS_ACQUIRED, EXECUTING, RETRY_SCHEDULED, SUCCEEDED, FAILED, RECOVERED_AFTER_RESTART, LOCKS_RELEASED, LOCK_EXPIRED
  details_json TEXT
);
CREATE INDEX idx_task_events_task ON task_events(task_id);
```
Engine 1 is the only writer of `scheduler.db`. Run it through the same migration runner (scheduler dir).

## 5.2 Resources and priorities
| Task type | Resources locked (sorted, de-duplicated) | Default priority |
|---|---|---|
| `PUTAWAY` | `shelf:<destination shelf code>` | NORMAL (2) |
| `RELOCATE` | `shelf:<source shelf>`, `shelf:<destination shelf>` | LOW (1) |
| `RESERVE_ORDER` (Phase 6) | `sku:<SKU>` for every order line | order priority (LOW..URGENT → 1..4) |
| `PICK_CONFIRM` (Phase 8) | `shelf:<shelf of the stop's bin>` | HIGH (3) |
| `EXCEPTION_RESOLVE` (Phase 8) | `sku:<SKU of the stop>` | HIGH (3) |
Shared helper `shelfOfBin('A-03-L-2') = 'A-03-L'` (strip the last `-<level>`).

## 5.3 Scheduling algorithm (deadlock-free by construction)
```
effective_score(task, now) = BASE[priority] + min(30, floor(wait_seconds / 15))    // BASE: 1→10, 2→20, 3→30, 4→40 (aging prevents starvation)
tick (every 100 ms and immediately on enqueue):
  queued  = tasks WHERE status='QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= now)
  order   = sort by effective_score DESC, created_at ASC, id ASC
  slots   = MAX_CONCURRENCY(4) − count(RUNNING)
  blocked = {}                                            // head-of-line protection
  for task in order while slots > 0:
      if any(resource in blocked for resource in task.resources): blocked ∪= task.resources; continue
      if tryAcquireAll(task): execute(task) (async, not awaited); slots--
      else: blocked ∪= task.resources
tryAcquireAll(task):   // ONE SQLite transaction on scheduler.db — all locks or none ("no hold-and-wait")
   delete expired locks; if any task.resource currently locked → return false
   for each resource: insert lock(fencing_token = next token, expires_at = now + 30 s)
   task → RUNNING, attempts += 1, started_at = now ; event LOCKS_ACQUIRED
execute(task):
   start lease heartbeat (extend expires_at by 30 s every 10 s)
   POST Engine3 /internal/v1/commands/<name>  body {actor, idempotency_key: task.key, payload}  headers: X-Task-Id, X-Lock-Tokens (informational)
        timeout ENGINE3_COMMAND_TIMEOUT_MS
   2xx                       → SUCCEEDED (store http_status, result)
   4xx (domain error)        → FAILED immediately (store error code/message/details; NO retry)
   5xx / network / timeout   → if attempts < max_attempts: status QUEUED, next_attempt_at = now + 1000·2^(attempts−1) ms, event RETRY_SCHEDULED
                               else FAILED (error_code ENGINE3_UNAVAILABLE)
   finally: stop heartbeat; delete locks of this task; event LOCKS_RELEASED
sweeper (every 5 s): delete expired locks whose task is not RUNNING in this process; event LOCK_EXPIRED
```
Command mapping: `PUTAWAY→putaway`, `RELOCATE→relocate`, `RESERVE_ORDER→reserve-order`, `PICK_CONFIRM→pick-confirm`, `EXCEPTION_RESOLVE→exception-resolve`.
**Crash recovery (runs at Engine 1 startup before the first tick):** delete **all** locks (they belonged to the dead process); every `RUNNING` task → `QUEUED` with `attempts = attempts − 1` and event `RECOVERED_AFTER_RESTART`. Re-execution is safe because the same `idempotency_key` reaches Engine 3, which replays the original committed result instead of repeating the stock change.

## 5.4 Engine 1 API (internal)
- `POST /internal/v1/tasks` `{ type, priority, idempotency_key, actor, payload, resources }` → `202 { id, status }`; an existing `idempotency_key` returns the existing task (`200`).
- `GET /internal/v1/tasks/:id?wait_ms=` — long-poll: returns as soon as the task is terminal or after `wait_ms` (max 30000): `{ id, type, status, attempts, http_status?, result?, error?:{code,message,details}, created_at, finished_at }`.
- `GET /internal/v1/tasks?status=&type=&page=` · `GET /internal/v1/locks` · `GET /internal/v1/queue` (queued tasks with effective scores).

## 5.5 Gateway task helper and public task endpoints
`runViaEngine1({ type, priority, key, actor, payload, resources })`: `POST` the task; then `GET …?wait_ms=TASK_WAIT_TIMEOUT_MS`. Outcomes:
- `SUCCEEDED` → respond with the stored `http_status` and `result`.
- `FAILED` with a **business** error code (any 4xx from Engine 3, e.g. `CAPACITY_EXCEEDED`) → return **that exact error** (same code/status/details) so the UI shows the real reason.
- `FAILED` with infrastructure error → `503 ENGINE3_UNAVAILABLE` (`details.task_id`).
- Not terminal in time → `202 { task_id, status }`.
- Engine 1 unreachable → `503 ENGINE1_UNAVAILABLE`. **No fallback path. Never call Engine 3 directly for E1-type operations.**
`GET /api/tasks/:id` → `{ id, type, status, attempts, result?, error? }` (allowed for the task's actor or MANAGER). `GET /api/tasks?status=&type=&page=` (MANAGER).

## 5.6 Migration `migrations/warehouse/005_putaway.sql`
```sql
CREATE TABLE putaways (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ref             TEXT NOT NULL UNIQUE,
  receipt_line_id INTEGER NOT NULL REFERENCES receipt_lines(id),
  sku             TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  dest_bin        TEXT NOT NULL REFERENCES bins(code),
  selection_mode  TEXT NOT NULL CHECK (selection_mode IN ('RECOMMENDED','MANUAL')),
  recommended_bin TEXT REFERENCES bins(code),
  movement_ref    TEXT NOT NULL,
  performed_by    INTEGER NOT NULL REFERENCES users(id),
  task_id         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_putaways_line ON putaways(receipt_line_id);
```
A `putaways` row exists **only for committed put-aways** (status shown as `COMPLETED`). Queued/running/failed attempts are visible as Engine 1 tasks.

## 5.7 Public API
`POST /api/putaways` (MANAGER, OPERATOR) — **E1**, `Idempotency-Key` required:
```json
// request
{ "receipt_line_id": 1, "dest_bin": "A-01-L-4", "qty": 50, "recommended_bin": "A-01-L-4" }
// 201 (via task result)
{ "ref":"PUT-0001", "receipt_ref":"RCV-0001", "receipt_line_id":1, "sku":"SKU001", "product_name":"Wireless Mouse", "qty":50,
  "source":"Receiving staging (RCV-0001)", "dest_shelf":"A-01-L", "dest_bin":"A-01-L-4", "selection_mode":"RECOMMENDED",
  "movement_ref":"MOV-0003", "performed_by":"Omar Operator", "status":"COMPLETED", "created_at":"...",
  "line_remaining_staged": 0, "receipt_status":"PUT_AWAY" }
```
`GET /api/putaways?receipt=&sku=&page=` (newest first). `POST /api/inventory/relocate` body `{ from_bin, to_bin, qty }` (MANAGER, OPERATOR) — **E1**.

## 5.8 Engine 3 command `putaway` (inside `runIdempotent` + `runTx`)
```
1. line = receipt_lines JOIN receipts  (NOT_FOUND if missing)
2. qty integer >= 1; staged = qty_received − qty_put_away; qty <= staged else INSUFFICIENT_STAGED_STOCK {staged}
3. mode = (recommended_bin == dest_bin) ? 'RECOMMENDED' : 'MANUAL'
4. stockIn(dest_bin, line.sku, qty)           // FULL revalidation against CURRENT state (freshness): UNKNOWN_BIN, BIN_NOT_RECEIVABLE,
                                              // STORAGE_CLASS_MISMATCH, SKU_CONFLICT, CAPACITY_EXCEEDED
   hooks.afterStep('stockIn')
5. UPDATE receipt_lines SET qty_put_away = qty_put_away + @q WHERE id=@id AND qty_put_away + @q <= qty_received   (changes must be 1)
6. mov = recordMovement(PUTAWAY, from STAGING ref=receipt ref → to BIN dest_bin, related PUTAWAY/<ref>)
7. ref = nextRef('putaway'); INSERT putaways(..., task_id = header X-Task-Id)
8. receipts.status := all lines fully put away ? 'PUT_AWAY' : (any put_away > 0 ? 'PARTIALLY_PUT_AWAY' : 'STAGED')
9. audit PUTAWAY_COMPLETED ; emit 'putaway.completed' {ref, receipt_ref, sku, qty, dest_bin} ; emit 'inventory.changed' {bins:[dest_bin]}
10. return 201 putaway detail
```
**Command `relocate`:** `from_bin != to_bin` · source must hold stock · `stockOut(from, qty, consumeReserved=false)` (reserved stock can never be moved: `INSUFFICIENT_STOCK` with `details.unreserved`) · `stockIn(to, sku, qty)` · movement `RELOCATE` · audit `STOCK_RELOCATED` · events `inventory.changed {bins:[from,to]}`. Source may be a BLOCKED/DAMAGED bin (moving stock *out* is allowed). Source emptied → `sku = NULL` automatically.

## 5.9 Demo seed — `npm run db:seed:demo`
Calls the **Engine 3 domain functions in-process** (never raw INSERTs) as `operator1`. Refuses to run if any receipt already exists. Deterministic: for each STANDARD SKU `k = 1..22`: receive `qty_k = 40 + (k mod 5)·10` units (SKU001 receives 10 extra, left staged), then put away `qty_k` into bin `<A|B|C by (k−1) mod 3>-0<(⌊(k−1)/3⌋ mod 6)+1>-L-<⌊(k−1)/18⌋+1>`; SKU023 → `D-01-L-1` (30), SKU024 → `D-01-R-1` (30). Result: ledger, receipts, put-aways all consistent; `verify:integrity` passes.

## 5.10 Frontend
- **Allocation panel**: add **Confirm put-away** (enabled once a valid bin is selected and quantity valid). Click → re-run `/placement/validate` → `POST /api/putaways` (new key per attempt, key reused on network retry). If `202`, show "Queued → Executing…" and poll `GET /api/tasks/:id` every 1 s until terminal (max 60 s then show "still running — check Tasks"). Success banner: `PUT-0001 completed: 50 × Wireless Mouse → A-01-L-4 (recommended)`; Staged Stock and Inventory refetch. Errors show the mapped message for the exact code (e.g. "Another product is already stored in that bin"), and the panel automatically refreshes the recommendation.
- **Receiving → Put-aways tab**: table (PUT ref, Receipt, Product `Name · SKU`, Qty, Destination shelf/bin, Mode badge, Operator, Time, Movement ref).
- **Inventory → Bins side panel**: **Relocate** button (MANAGER, OPERATOR) → modal: quantity (≤ unreserved), destination bin selector with live validation (`/placement/validate` with `sku` form), confirm.
- **Tasks page `/tasks` (MANAGER)**: tasks table (short id, type, status, priority, attempts, created, duration, error code), live **Locks** table and **Queue** table; refetch every 3 s only while the tab is visible.

## 5.11 Phase 5 tests
| ID | Test | Expected |
|---|---|---|
| P5-T01 | Engine 1: enqueue task with a fake executor | `QUEUED → RUNNING → SUCCEEDED`; events `ENQUEUED, LOCKS_ACQUIRED, EXECUTING, SUCCEEDED, LOCKS_RELEASED` |
| P5-T02 | Same `idempotency_key` twice | One task; second call returns it |
| P5-T03 | Resource `r` held; enqueue LOW then URGENT on `r`; release | URGENT executes first |
| P5-T04 | Aging with injected clock: LOW waiting 8 min vs fresh NORMAL | LOW outranks NORMAL |
| P5-T05 | Task A locks `[x,y]`, task B locks `[y,x]` submitted simultaneously | No deadlock; run one after the other; the locks table never contains a partial set |
| P5-T06 | High-ranked task blocked on `r1`; stream of LOW tasks on `r1` | High task runs before them (head-of-line protection) |
| P5-T07 | 6 tasks on distinct resources | At most 4 `RUNNING` at once; all succeed |
| P5-T08 | Executor returns 4xx | `FAILED` at once, no retry, locks released, `error_code` preserved |
| P5-T09 | Executor 5xx/timeout | Retries with backoff (1 s, 2 s) up to 3 attempts, then `FAILED ENGINE3_UNAVAILABLE`; locks released after each attempt |
| P5-T10 | Insert an expired lock for a dead holder | Sweeper removes it; new task acquires |
| P5-T11 | Kill Engine 1 while a real put-away task is RUNNING (slow executor), restart | Task re-executed once; stock moved **exactly once** |
| P5-T12 | Queued tasks survive Engine 1 restart | Executed in original priority/time order |
| P5-T13 | Put-away 50 into an empty valid bin | Staged 0, bin 50, receipt `PUT_AWAY`, movement `PUTAWAY`, `PUT-0001`, audit, both events |
| P5-T14 | Partial put-away 20 of 50, then 30 | Staged 30 → 0; receipt `PARTIALLY_PUT_AWAY` → `PUT_AWAY` |
| P5-T15 | qty > staged | `INSUFFICIENT_STAGED_STOCK`; nothing changed |
| P5-T16 | Destination holds another SKU | `SKU_CONFLICT`; staged qty unchanged (atomic) |
| P5-T17 | Over capacity / blocked bin / HAZMAT mismatch | `CAPACITY_EXCEEDED` / `BIN_NOT_RECEIVABLE` / `STORAGE_CLASS_MISMATCH`; unchanged |
| P5-T18 | Accept recommendation vs manually pick another valid bin | `selection_mode` `RECOMMENDED` / `MANUAL`; both pass identical validation |
| P5-T19 | Stale recommendation: recommend bin X, fill X by another put-away, confirm the old recommendation | Rejected with `CAPACITY_EXCEEDED` or `SKU_CONFLICT`; no change |
| P5-T20 | Repeat the same `POST /api/putaways` with the same key | One put-away, one movement; identical response |
| P5-T21 | Two parallel POSTs, same key | Exactly one put-away |
| P5-T22 | Two parallel put-aways of 70 each into one 120-capacity bin, different keys | Exactly one succeeds, other `CAPACITY_EXCEEDED`; bin = 70 |
| P5-T23 | `hooks.afterStep('stockIn')` throws | Full rollback: bin, receipt line, ledger, sequences unchanged |
| P5-T24 | Stop Engine 1, `POST /api/putaways` | `503 ENGINE1_UNAVAILABLE`; inventory unchanged; restart Engine 1, repeat with the same key → succeeds once |
| P5-T25 | Stop Engine 3 mid-task, restart it | Task retries and completes once; no duplicate movement |
| P5-T26 | Relocate unreserved stock; relocate reserved part; dest other SKU; empty the source | Ledger `RELOCATE`; `INSUFFICIENT_STOCK`; `SKU_CONFLICT`; source `sku=NULL` |
| P5-T27 | Executor slower than `TASK_WAIT_TIMEOUT_MS` | `202 {task_id}`; polling `/api/tasks/:id` reaches `SUCCEEDED` with result |
| P5-T28 | RBAC: PICKER/STAFF POST | 403; OPERATOR ok; `GET /api/tasks` MANAGER only |
| P5-T29 | Web: confirm flow, 202 polling, error mapping, double-click disabled, auto-refresh after stale error | Pass |
| P5-T30 | Demo seed (twice) | First run ok; second refuses; `verify:integrity` I01–I06 PASS |

## 5.12 Phase 5 acceptance gate
- [ ] Browser as `operator1`: receive 50 → Allocate → pick a *manual* valid bin → Confirm → see `PUT-0001`, staged 0, bin stock 50 in Inventory and in the Warehouse grid.
- [ ] Kill Engine 1 → put-away shows a clear "scheduler unavailable" error and nothing changes; restart → works.
- [ ] P5 tests + all earlier tests green; `verify:integrity` exits 0; log + checklist updated; committed.

---

# PHASE 6 — MANUAL ORDER CREATION + STOCK RESERVATION

**Objective:** a manager manually builds a multi-line outbound order; creation **atomically reserves real, bin-level stock** (all-or-nothing) through Engine 1 → Engine 3, so two orders can never claim the same units. Cancellation releases only what is still outstanding.
**Prerequisites:** Phase 5 gate passed (Engine 1 is real and recoverable).

## 6.1 Migration `migrations/warehouse/006_orders.sql`
```sql
CREATE TABLE orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ref              TEXT NOT NULL UNIQUE,
  order_type       TEXT NOT NULL CHECK (order_type IN ('CUSTOMER','TRANSFER','PRODUCTION')),
  priority         TEXT NOT NULL CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status           TEXT NOT NULL CHECK (status IN ('RESERVED','ASSIGNED','PICKING','PICKED','COMPLETED','CANCELLED')),
  customer_ref     TEXT,
  notes            TEXT,
  requested_by     INTEGER NOT NULL REFERENCES users(id),
  assigned_picker  INTEGER REFERENCES users(id),
  fulfilment_type  TEXT CHECK (fulfilment_type IN ('FULL','PARTIAL')),
  cancelled_reason TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at     TEXT
);
CREATE INDEX idx_orders_status ON orders(status, priority);

CREATE TABLE order_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  line_no     INTEGER NOT NULL,
  sku         TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  qty_ordered INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_picked  INTEGER NOT NULL DEFAULT 0,
  qty_short   INTEGER NOT NULL DEFAULT 0,    -- accepted shortfall (Phase 8)
  CHECK (qty_picked >= 0 AND qty_short >= 0 AND qty_picked + qty_short <= qty_ordered),
  UNIQUE (order_id, line_no),
  UNIQUE (order_id, sku)
);

CREATE TABLE reservations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id),
  order_line_id INTEGER NOT NULL REFERENCES order_lines(id),
  sku           TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  bin_code      TEXT NOT NULL REFERENCES bins(code),
  qty           INTEGER NOT NULL CHECK (qty > 0),
  consumed_qty  INTEGER NOT NULL DEFAULT 0,
  released_qty  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD','CONSUMED','RELEASED')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (consumed_qty >= 0 AND released_qty >= 0 AND consumed_qty + released_qty <= qty),
  CHECK (status <> 'HELD' OR consumed_qty + released_qty < qty),
  CHECK (status = 'HELD' OR consumed_qty + released_qty = qty)
);
CREATE INDEX idx_res_bin   ON reservations(bin_code, status);
CREATE INDEX idx_res_order ON reservations(order_id);
```
**Reservation arithmetic (everywhere):** `outstanding = qty − consumed_qty − released_qty`. Closing rule when `outstanding` reaches 0: status = `CONSUMED` if `consumed_qty > 0`, else `RELEASED`. Physical effect: **consume** → `stockOut(consumeReserved=true)` (qty and reserved_qty both drop); **release** → `release()` (only reserved_qty drops).
Add a shared helper in Engine 3: `closeReservationIfDone(db, reservationId)`.

## 6.2 API
`POST /api/orders` (MANAGER) — **E1** (`RESERVE_ORDER`), `Idempotency-Key` required.
```json
{ "order_type":"CUSTOMER", "priority":"NORMAL", "customer_ref":"Acme Retail", "notes":"Deliver Friday",
  "lines":[ {"sku":"SKU001","qty":5}, {"sku":"SKU002","qty":2}, {"sku":"SKU003","qty":3} ] }
```
zod: `lines` 1–50, `qty` integer 1–10000, enums as in the table, `customer_ref` ≤ 80, `notes` ≤ 500.
Insufficient stock → `409 INSUFFICIENT_STOCK` with `details.shortages:[{sku,product_name,requested,available}]` listing **all** short lines; **nothing is written and no order number is consumed**.
`GET /api/orders?status=&priority=&search=&page=` (search matches `ORD-` ref, customer ref, product name, SKU) · `GET /api/orders/:ref` →
```json
{ "ref":"ORD-0001","order_type":"CUSTOMER","priority":"NORMAL","status":"RESERVED","customer_ref":"Acme Retail","notes":"...",
  "requested_by":"Maya Manager","created_at":"...","assigned_picker":null,"mission_ref":null,"fulfilment_type":null,
  "lines":[ {"line_no":1,"sku":"SKU001","product_name":"Wireless Mouse","qty_ordered":5,"qty_picked":0,"qty_short":0,
             "reservations":[ {"id":1,"bin_code":"A-01-L-1","qty":5,"consumed_qty":0,"released_qty":0,"outstanding":5,"status":"HELD"} ] } ],
  "reservation_summary":{"held_units":10,"consumed_units":0,"released_units":0},
  "audit":[ {"at":"...","action":"ORDER_CREATED","by":"Maya Manager"} ] }
```
`POST /api/orders/:ref/cancel` body `{ reason: string(3..200) }` (MANAGER) — PROXY (direct Engine 3, not via Engine 1).
**ATP for the form** is read from `GET /api/inventory/summary?search=` (fields `stored_qty`, `reserved_qty`, `available_to_promise`).

## 6.3 Engine 3 command `reserve-order`
```
runIdempotent → runTx:
1. validate lines: each sku exists & active (UNKNOWN_SKU), qty integer ≥ 1 (QUANTITY_INVALID), no duplicate sku (DUPLICATE_LINE_SKU), ≥ 1 line
2. shortages = []
   for each line: atp = SUM(available_qty) FROM v_available_stock WHERE sku = line.sku
                  if atp < line.qty → shortages.push({sku, product_name, requested, available: atp})
   if shortages.length → throw INSUFFICIENT_STOCK {shortages}            // BEFORE nextRef → no ref consumed
3. ref = nextRef('order'); INSERT orders(status='RESERVED', requested_by = actor.id)
4. for each line sorted by sku ASC (deterministic):
      INSERT order_lines
      plan = allocateStock(db, sku, qty)                                 // §6.4
      for each {bin, q} in plan: reserve(db,{bin,qty:q}) ; INSERT reservations(status 'HELD')
      hooks.afterStep('line:'+sku)
5. audit ORDER_CREATED {lines, allocations} ; emit 'order.created' {ref} ; emit 'inventory.changed' {bins:[...]} ; emit 'reservation.changed' {order_ref}
6. return 201 order detail
```
Any thrown error rolls back the whole transaction, so there can never be a half-reserved order.

## 6.4 `allocateStock(db, sku, qty, { excludeBins = [] })` (shared with Phase 8 reallocation)
```
rows  = SELECT bin_code, available_qty FROM v_available_stock WHERE sku = @sku AND bin_code NOT IN (@excludeBins)
total = Σ available_qty ; if total < qty → return null
single = rows WHERE available_qty >= qty ORDER BY available_qty ASC, bin_code ASC     // best-fit: smallest bin that satisfies alone (fewest stops, least fragmentation)
if single non-empty → return [ { bin: single[0].bin_code, qty } ]
else greedy: rows ORDER BY available_qty DESC, bin_code ASC; take min(remaining, available) from each until remaining = 0   // fewest stops
```
Only stock in bins that are in `v_available_stock` can ever be allocated (so never staged stock, never blocked/damaged/maintenance/recount bins).

## 6.5 Cancellation — Engine 3 `cancelOrder`
```
allowed statuses: RESERVED, ASSIGNED, PICKING, and PICKED only when total picked units == 0, else ORDER_NOT_CANCELLABLE {status}
for each reservation with outstanding > 0:
    release(bin, outstanding) ; released_qty += outstanding ; closeReservationIfDone()
mission (Phase 7): active mission → CANCELLED        exceptions (Phase 8): open ones → RESOLVED with resolution 'ORDER_CANCELLED'
order.status = 'CANCELLED', cancelled_reason, updated_at
audit ORDER_CANCELLED { released:[{bin,qty}], unreturned_picked:[{sku,qty}] } ; emit 'order.status_changed', 'inventory.changed', 'reservation.changed'
```
**Already-picked units are never restored** to a bin (they are already deducted and sit in the packing area); they are listed in the audit as `unreturned_picked` and shown on the order detail (restocking is out of scope). Phase 6 implements the order+reservation part; Phases 7 and 8 add the mission/exception parts with their own tests.

## 6.6 Frontend
**Orders page `/orders`** (all roles read; only MANAGER sees *New Order* and *Cancel*): table with Order, Type, Priority badge, Status badge, Customer, Lines/Units, Created, Picker; filters; pagination.
**New Order form (`/orders/new`)**
- Fields: Order type, Priority, Customer/reference, Notes.
- **Add item**: product type-ahead (name *or* SKU) from inventory summary, showing `Name · SKU` and three chips: **Stored · Reserved · Available (ATP)**; quantity input (hint "max {ATP}"); **Add item** button. Duplicate product → "Already in the order — edit its quantity".
- Lines table: Product, Available (refreshed every 15 s while the form is open), Quantity (editable), Remove.
- **Order summary** card: lines, total units, priority, type; lines whose quantity exceeds current ATP are highlighted and **Submit order** is disabled with the reason.
- Submit: pending state; on `202` poll the task; success → navigate to `/orders/ORD-0001` with banner "ORD-0001 created — stock reserved". On `INSUFFICIENT_STOCK` show a shortage table (requested vs available) and keep the form.
**Order detail `/orders/:ref`:** status badge; header facts; lines table with expandable reservation rows (bin, qty, status); reservation summary; audit timeline; **Cancel order** (MANAGER, status-dependent, reason modal). Phase 7 adds **Assign picker**.

## 6.7 Phase 6 tests
| ID | Test | Expected |
|---|---|---|
| P6-T01 | Valid 3-line order (fixture stock) | `ORD-0001` `RESERVED`; reservations `HELD`; `reserved_qty` up, `available_qty` down, `qty` unchanged; audit + events |
| P6-T02 | Allocation best-fit: bins with available 10, 30, 50; need 25 / need 70 | single bin (the 30) / greedy 50 + 20 |
| P6-T03 | Stock spread over 3 bins, need all | 3 reservations, correct quantities |
| P6-T04 | One of two lines short | `409 INSUFFICIENT_STOCK` listing the short line(s); **zero** reservations, no order row, next order is still `ORD-0001` |
| P6-T05 | Unknown SKU / qty 0 / duplicate SKU / empty lines / 51 lines | `UNKNOWN_SKU` / validation / `DUPLICATE_LINE_SKU` / validation / validation |
| P6-T06 | Stock in blocked/damaged/maintenance/recount bins and staged stock | Not counted in ATP; never reserved |
| P6-T07 | Order A reserves 8 of 10; order B asks 3 | B fails `INSUFFICIENT_STOCK` (available 2) |
| P6-T08 | **Concurrency:** 5 orders × 4 units against 10 units, fired in parallel | Exactly 2 succeed, 3 `INSUFFICIENT_STOCK`; `reserved_qty = 8`; refs gap-free |
| P6-T09 | 5 parallel POSTs with the **same** key | One order |
| P6-T10 | `hooks.afterStep` throws after the first line | Full rollback: no order, reservations, `reserved_qty` change or sequence use |
| P6-T11 | Cancel `RESERVED` order | Reservations `RELEASED`, `reserved_qty` restored, `qty` unchanged, order `CANCELLED`, audit |
| P6-T12 | Cancel twice; replay same key | `ORDER_NOT_CANCELLABLE`; replay returns original, single effect |
| P6-T13 | Cancel as OPERATOR | 403 |
| P6-T14 | Restart Engine 3 and Engine 1; list + detail | Identical |
| P6-T15 | Kill Engine 1 after enqueue, before execution; restart | Exactly one order created |
| P6-T16 | Contended SKU: URGENT order vs LOW order enqueued while lock held | URGENT executes first |
| P6-T17 | Engine 1 stopped, `POST /api/orders` | `503 ENGINE1_UNAVAILABLE`; no order |
| P6-T18 | Integrity after create/cancel mix | I02, I07, I08 PASS |
| P6-T19 | Web: ATP chips, over-ATP disables submit, shortage table, duplicate guard, double-click safe | Pass |
| P6-T20 | Read filters: by status, priority, ref, customer, product name, SKU; PICKER can read | Correct results |

## 6.8 Phase 6 acceptance gate
- [ ] Browser as `manager1`: create `ORD-0001` with 3 products → see reservations per bin; Inventory shows reserved up, available down; cancel it → everything returns.
- [ ] Two browser tabs submitting competing orders for the last units → exactly one succeeds, the other shows the shortage table.
- [ ] P6 tests + all earlier tests green; `verify:integrity` exits 0; log + checklist updated; committed.

---

# PHASE 7 — PICKER ASSIGNMENT + ENGINE 2 ROUTING

**Objective:** a manager assigns a reserved order to a picker; Engine 2 computes a real, optimized route over the warehouse graph to the **actual reserved bins**; a mission with ordered pick stops is created; the picker starts it.
**Prerequisites:** Phase 6 gate passed.

## 7.1 Migration `migrations/warehouse/007_missions.sql`
```sql
CREATE TABLE missions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ref            TEXT NOT NULL UNIQUE,
  order_id       INTEGER NOT NULL REFERENCES orders(id),
  picker_id      INTEGER NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL CHECK (status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  route_json     TEXT NOT NULL,
  route_distance REAL NOT NULL,
  route_algorithm TEXT NOT NULL CHECK (route_algorithm IN ('HELD_KARP','TWO_OPT','TRIVIAL')),
  assigned_by    INTEGER NOT NULL REFERENCES users(id),
  assigned_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at     TEXT,
  completed_at   TEXT
);
CREATE UNIQUE INDEX uq_mission_active_order ON missions(order_id) WHERE status IN ('ASSIGNED','IN_PROGRESS');
CREATE INDEX idx_missions_picker ON missions(picker_id, status);

CREATE TABLE pick_stops (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id     INTEGER NOT NULL REFERENCES missions(id),
  stop_no        INTEGER NOT NULL,                           -- stable number used in stop_ref
  stop_ref       TEXT NOT NULL UNIQUE,                       -- e.g. MIS-0001-S01
  seq            INTEGER NOT NULL,                           -- current visiting order (may change on reroute)
  reservation_id INTEGER NOT NULL UNIQUE REFERENCES reservations(id),
  bin_code       TEXT NOT NULL REFERENCES bins(code),
  sku            TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  qty_required   INTEGER NOT NULL CHECK (qty_required > 0),
  qty_picked     INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PICKED','EXCEPTION_OPEN','RESOLVED')),
  confirmed_at   TEXT,
  CHECK (qty_picked >= 0 AND qty_picked <= qty_required),
  UNIQUE (mission_id, stop_no)
);
CREATE INDEX idx_stops_mission ON pick_stops(mission_id, seq);
```

## 7.2 Engine 2 route planning (`routing/` folder)
`POST /internal/v1/routes/plan` body `{ start:"DOCK", end:"PACK", stops:[{ key, bin_code, node }] }`.
```
1. waypoints = distinct `node` values of the stops (several bins at one node = ONE waypoint)
2. Run Dijkstra from start, end and every waypoint → distance matrix D. If any needed D is ∞ → 422 ROUTE_UNREACHABLE {unreachable_keys}
3. m = waypoints.length
   m = 0   → algorithm TRIVIAL : start → end
   m ≤ 10  → HELD_KARP (exact): dp[mask][j] = min cost of path start → (nodes in mask) ending at j
                 dp[1<<j][j] = D[start][j]
                 dp[mask|1<<k][k] = min over j∈mask of dp[mask][j] + D[j][k]
                 best = min over j of dp[full][j] + D[j][end]   → reconstruct order by parent pointers
   m > 10  → TWO_OPT (heuristic): nearest-neighbour order from start, then repeat
                 for i<k: reverse waypoints[i..k] if it reduces D[prev(i)][w_i..] total   (start and end fixed)
             until no improvement or 1000 passes
4. Order the stops inside each waypoint by (shelf code ASC, level ASC)
5. legs: for consecutive points (start, w1…wm, end) compute the node path with A* (heuristic = Euclidean distance to goal; admissible because edge weights are Euclidean). leg.distance = A* distance.
6. Response: { algorithm, total_distance, start, end, order:[keys in visit order], stops:[{key,bin_code,node,seq}],
               legs:[{from,to,distance,path:[nodeIds]}] }   (distances rounded to 2 dp; total = Σ leg distances)
```
Algorithms must be implemented in separate, pure, unit-tested files: `dijkstra.ts`, `astar.ts`, `heldKarp.ts`, `twoOpt.ts`, `planRoute.ts`. Deterministic: ties broken by node id ascending.

## 7.3 Assignment flow (ORCH) — `POST /api/orders/:ref/assign` body `{ picker_id }` (MANAGER, Idempotency-Key required)
```
1. GET Engine3 /internal/v1/orders/:ref/pick-plan →
     { order_ref, status, plan_token, reservations:[{reservation_id, bin_code, shelf_code, level, sku, product_name, qty, node}] }
     ORDER_STATE_INVALID unless status = RESERVED; plan_token = sha256 of the sorted (reservation_id, bin_code, qty) list
2. POST Engine2 /routes/plan (stops keyed by reservation_id)                 → ROUTE_UNREACHABLE (422) or ENGINE2_UNAVAILABLE (503); nothing mutated
3. POST Engine3 /internal/v1/orders/:ref/assign { picker_id, plan_token, route }   (runIdempotent + runTx):
     a. recompute plan_token from the CURRENT reservations; mismatch → PLAN_STALE (409)
        (Gateway retries steps 1–3 once automatically, then returns PLAN_STALE)
     b. order.status must be RESERVED; picker must be an active PICKER → PICKER_INVALID
     c. mission = INSERT missions(ref = nextRef('mission'), status 'ASSIGNED', route_json, route_distance, route_algorithm)
     d. for each reservation in route order: INSERT pick_stops(stop_no = position 1..n, stop_ref = '<MIS-ref>-S<NN>', seq = position,
                 reservation_id, bin_code, sku, qty_required = reservation.qty)
     e. orders.status = 'ASSIGNED', assigned_picker = picker_id
     f. audit MISSION_ASSIGNED ; emit 'mission.assigned', 'order.status_changed'
     g. return 201 mission detail
```
Stops always correspond **1:1 to the HELD reservations of the order**, i.e. the actual reserved bins. Never route to a bin merely because the SKU exists there.
`POST /api/orders/:ref/reassign` body `{ picker_id }` (MANAGER): allowed only while mission is `ASSIGNED` (not started) else `MISSION_STATE_INVALID`; updates `missions.picker_id` and `orders.assigned_picker`; audit.
`POST /api/missions/:ref/start` (PICKER, own mission): mission `ASSIGNED → IN_PROGRESS` (`started_at`), order `ASSIGNED → PICKING`; wrong picker → `NOT_YOUR_MISSION` (403); wrong state → `MISSION_STATE_INVALID`; audit; events `mission.started`, `order.status_changed`.
`GET /api/users?role=PICKER` (MANAGER) → active pickers with `open_missions` count.
`GET /api/missions?status=&picker=&page=` — **PICKER role is automatically restricted to own missions by the server**. `GET /api/missions/:ref`:
```json
{ "ref":"MIS-0001","order_ref":"ORD-0001","status":"ASSIGNED","picker":{"id":4,"name":"Priya Picker"},
  "route":{"algorithm":"HELD_KARP","total_distance":163.2,"start":"DOCK","end":"PACK",
           "legs":[{"from":"DOCK","to":"N-A-01","distance":20,"path":["DOCK","XB-A","N-A-01"]}]},
  "stops":[{"stop_ref":"MIS-0001-S01","seq":1,"bin_code":"A-01-L-1","shelf_code":"A-01-L","sku":"SKU001","product_name":"Wireless Mouse",
            "qty_required":5,"qty_picked":0,"status":"PENDING"}],
  "progress":{"total_stops":2,"finished_stops":0,"open_exceptions":0,"units_required":7,"units_picked":0} }
```
**Cancellation extension:** `cancelOrder` now also sets an active mission to `CANCELLED` (stops stay as they are but are no longer actionable because actions require `IN_PROGRESS`).

## 7.4 Frontend
- **Order detail:** **Assign picker** button for `RESERVED` orders (MANAGER) → modal: eligible pickers with open-mission counts → confirm. On success show mission ref + route distance + algorithm; reassign button while `ASSIGNED`.
- **Orders list:** status filter "Awaiting assignment" (= `RESERVED`) for the manager's work queue.
- **Picking page `/picking`** (nav for PICKER and MANAGER): PICKER sees **My missions** (cards: mission ref, order ref, stops, distance, status); MANAGER sees all missions with filters.
- **Mission detail `/picking/:ref`:** header (MIS ref, order ref, picker, status badge), **route panel** (algorithm, total distance, ordered leg list rendered as text `DOCK → XB-A → N-A-01 (20.0)`), **stops table** in visiting order (Seq, Location shelf/bin, Product `Name · SKU`, Required, Picked, Status). **Start mission** button (only for the assigned PICKER while `ASSIGNED`). Stop actions are added in Phase 8 (hidden now).

## 7.5 Phase 7 tests
| ID | Test | Expected |
|---|---|---|
| P7-T01 | A* vs Dijkstra on 50 seeded-random node pairs | Equal distances (±1e-6) |
| P7-T02 | Held-Karp vs brute-force permutations, random sets of ≤ 7 waypoints | Equal optimal totals |
| P7-T03 | 11 and 12 waypoints | `TWO_OPT`; total ≤ nearest-neighbour total; deterministic |
| P7-T04 | Stops on L and R shelves of the same bay | One waypoint; stops ordered shelf→level; zero-length leg |
| P7-T05 | Graph with a removed edge isolating a node | `422 ROUTE_UNREACHABLE` listing keys |
| P7-T06 | Route structure | Starts `DOCK`, ends `PACK`; legs contiguous; every path hop is a real edge; Σ legs = total |
| P7-T07 | Assign `RESERVED` order | `MIS-0001` `ASSIGNED`; order `ASSIGNED`; stops 1:1 with reservations (same bins/qty); `seq` = route order; stop refs `MIS-0001-S01…` |
| P7-T08 | Line reserved across 2 bins | 2 stops for that line |
| P7-T09 | Assign non-`RESERVED` order / user who is not a PICKER / inactive picker | `ORDER_STATE_INVALID` / `PICKER_INVALID` / `PICKER_INVALID` |
| P7-T10 | Reservations change between plan and assign (test hook) | `PLAN_STALE`; Gateway's single auto-retry succeeds when state is stable |
| P7-T11 | Assign twice: same key / different key | One mission / `ORDER_STATE_INVALID` |
| P7-T12 | Reassign before start / after start | OK / `MISSION_STATE_INVALID` |
| P7-T13 | Start: assigned picker / other picker / start twice | `IN_PROGRESS` + order `PICKING` / `NOT_YOUR_MISSION` / `MISSION_STATE_INVALID` (same key replays) |
| P7-T14 | `GET /missions` as picker1 vs manager | Own only vs all |
| P7-T15 | Cancel `ASSIGNED` and `PICKING` (nothing picked) orders | Mission `CANCELLED`, reservations released, order `CANCELLED` |
| P7-T16 | Engine 2 stopped, assign | `503 ENGINE2_UNAVAILABLE`; no mission, order still `RESERVED` |
| P7-T17 | Restart all services | Mission, route and stops identical |
| P7-T18 | Integrity | I10 PASS (+ earlier checks) |
| P7-T19 | Web: assign modal, route text, Start visible only for owner, manager list | Pass |

## 7.6 Phase 7 acceptance gate
- [ ] Browser: manager assigns `ORD-0001` to `picker1`; picker logs in, sees `MIS-0001` with an ordered stop list at the real reserved bins and a route distance; presses **Start mission** → order shows `PICKING`.
- [ ] A different picker cannot start it.
- [ ] P7 tests + all earlier tests green; `verify:integrity` exits 0; log + checklist updated; committed.

---

# PHASE 8 — ACTUAL PICKING, STOCK DEDUCTION AND EXCEPTIONS

**Objective:** every confirmed pick physically deducts inventory and consumes its reservation **exactly once**. Partial picks and problems are never silently ignored: they become explicit exceptions that a manager resolves. A route display is **not** a pick.
**Prerequisites:** Phase 7 gate passed.

## 8.1 Migration `migrations/warehouse/008_exceptions.sql`
```sql
CREATE TABLE pick_exceptions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ref              TEXT NOT NULL UNIQUE,
  mission_id       INTEGER NOT NULL REFERENCES missions(id),
  order_id         INTEGER NOT NULL REFERENCES orders(id),
  stop_id          INTEGER NOT NULL REFERENCES pick_stops(id),
  bin_code         TEXT NOT NULL REFERENCES bins(code),
  sku              TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  exception_type   TEXT NOT NULL CHECK (exception_type IN ('BIN_EMPTY','DAMAGED','SHORT_PICK','WRONG_PRODUCT','OTHER')),
  expected_qty     INTEGER NOT NULL CHECK (expected_qty > 0),   -- outstanding quantity when reported
  actual_qty       INTEGER NOT NULL CHECK (actual_qty >= 0),    -- units actually picked in that report
  notes            TEXT,
  reported_by      INTEGER NOT NULL REFERENCES users(id),
  reported_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status           TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  resolution       TEXT CHECK (resolution IN ('REALLOCATE','ACCEPT_SHORT','ORDER_CANCELLED')),
  resolved_by      INTEGER REFERENCES users(id),
  resolved_at      TEXT,
  resolution_notes TEXT,
  CHECK ((status = 'OPEN' AND resolution IS NULL) OR (status = 'RESOLVED' AND resolution IS NOT NULL))
);
CREATE UNIQUE INDEX uq_exc_open_stop ON pick_exceptions(stop_id) WHERE status = 'OPEN';
CREATE INDEX idx_exc_status ON pick_exceptions(status);
```

## 8.2 Confirming a stop — `POST /api/pick-stops/:stop_ref/confirm` (PICKER, own mission) — **E1** (`PICK_CONFIRM`, resource `shelf:<shelf of the stop's bin>`)
```json
{ "scanned_bin": "A-01-L-1", "scanned_sku": "SKU001", "picked_qty": 5,
  "exception": { "type": "SHORT_PICK", "notes": "Only 3 on the shelf" } }
```
`exception` is **required iff** `picked_qty < outstanding` (types allowed here: `SHORT_PICK`, `DAMAGED`, `OTHER`). Gateway reads the stop first (`GET /internal/v1/pick-stops/:ref`) to derive the shelf resource.
**Engine 3 command `pick-confirm` (`runIdempotent` + `runTx`):**
```
1. load stop ⨝ mission ⨝ order ⨝ reservation                                    (NOT_FOUND)
2. actor.id == mission.picker_id → else NOT_YOUR_MISSION
   mission.status == IN_PROGRESS → else MISSION_STATE_INVALID
   stop.status == PENDING        → else STOP_STATE_INVALID
3. scanned_bin == stop.bin_code (else BIN_MISMATCH {expected_bin}); scanned_sku == stop.sku, case-insensitive (else PRODUCT_MISMATCH {expected_sku})
   — mismatches change NOTHING
4. outstanding = reservation.qty − consumed_qty − released_qty
   picked_qty integer ≥ 1 (QUANTITY_INVALID) and ≤ outstanding (QUANTITY_EXCEEDS_RESERVATION {outstanding})
5. picked_qty < outstanding and no exception block → SHORT_PICK_REQUIRES_EXCEPTION
6. stockOut(bin, picked_qty, consumeReserved = true)                           // physical deduction + reservation consumption
   hooks.afterStep('stockOut')
7. reservation.consumed_qty += picked_qty ; closeReservationIfDone()            // CONSUMED only when outstanding hits 0
8. recordMovement(PICK, BIN(bin) → ORDER_PACKING(order ref), related STOP/<stop_ref>)
9. order_lines.qty_picked += picked_qty ; stop.qty_picked += picked_qty
10. if picked_qty == outstanding → stop.status = 'PICKED', confirmed_at = now
    else → stop.status = 'EXCEPTION_OPEN'; INSERT pick_exceptions(ref = nextRef('exception'), type, expected_qty = outstanding, actual_qty = picked_qty)
           (the REMAINING reservation stays HELD until a manager resolves it — no one else can take those units)
           bin.recount_required = 1 for SHORT_PICK and DAMAGED (quarantine from new reservations/put-away until recounted)
11. maybeCompleteMission(db, mission)                                           // §8.4
12. audit PICK_CONFIRMED ; emit 'pick.confirmed' ; 'inventory.changed' {bins:[bin]} ; 'reservation.changed' ; 'exception.opened' when created
13. return 200 { stop, mission_progress, order_status, exception? }
```
The UI marks a stop as done **only** from this committed response. Any attempt to confirm a stop twice returns `STOP_STATE_INVALID` (different key) or replays the original (same key) — **never a second deduction**.

## 8.3 Reporting a problem with no pick — `POST /api/pick-stops/:stop_ref/exception` (PICKER, own mission) — PROXY (direct to Engine 3, no stock change)
Body `{ type: 'BIN_EMPTY'|'DAMAGED'|'WRONG_PRODUCT'|'OTHER', notes: string(3..300) }`. Stop must be `PENDING` (`STOP_STATE_INVALID` otherwise). Creates an `OPEN` exception (`expected_qty` = outstanding, `actual_qty` = 0), stop → `EXCEPTION_OPEN`, `bin.recount_required = 1` for every type **except** `OTHER`, audit `EXCEPTION_REPORTED`, event `exception.opened`. No inventory quantity changes.
`GET /api/exceptions?status=&mission=&page=` (PICKER sees own) → `{ref, mission_ref, order_ref, stop_ref, bin_code, sku, product_name, type, expected_qty, actual_qty, notes, reported_by, reported_at, status, resolution}`.

## 8.4 `maybeCompleteMission(db, missionId)` (shared helper)
If the mission has **no** stop in `PENDING` or `EXCEPTION_OPEN`: mission → `COMPLETED` (`completed_at`), order `PICKING → PICKED`, audit `MISSION_COMPLETED`, events `mission.completed`, `order.status_changed`. Otherwise do nothing. An order **never** reaches `PICKED` while a mandatory stop is unresolved.

## 8.5 Exception resolution — `POST /api/exceptions/:ref/resolve` (MANAGER) — ORCH + **E1** (`EXCEPTION_RESOLVE`, resource `sku:<SKU>`)
```json
{ "action": "REALLOCATE" | "ACCEPT_SHORT", "notes": "Checked bin, empty", "recount": { "counted_qty": 0 } }
```
`recount` is optional and corrects the physical count of the exception's bin using the same `applyRecount` rules as Phase 2 (and clears `recount_required`). Without it the bin stays quarantined until a manager recounts it from the Inventory page.
**Engine 3 command `exception-resolve`:**
```
1. exception.status == OPEN (EXCEPTION_STATE_INVALID); stop EXCEPTION_OPEN; mission IN_PROGRESS (MISSION_STATE_INVALID)
2. res = stop's reservation ; outstanding = qty − consumed_qty − released_qty
3. release(bin, outstanding) ; released_qty += outstanding ; closeReservationIfDone()        // CONSUMED if any unit was consumed, else RELEASED
4. if recount present → applyRecount(bin, counted_qty)   // runs AFTER the release; if counted < reserved by OTHER orders → ADJUSTMENT_CONFLICT → whole transaction rolls back
5. ACCEPT_SHORT : order_lines.qty_short += outstanding ; stop → RESOLVED
   REALLOCATE   : plan = allocateStock(sku, outstanding, excludeBins = [exception bin])         // Phase 6 helper
                  plan == null → INSUFFICIENT_STOCK {sku, requested: outstanding, available: <stock elsewhere>}  (ROLLBACK: nothing changed, exception stays OPEN)
                  for each {bin,q}: reserve(bin,q) ; INSERT reservation ; INSERT pick_stops(stop_no = max+1, stop_ref, seq = max(seq)+1, PENDING)
                  stop → RESOLVED
6. exception → RESOLVED (resolution, resolved_by, resolved_at, resolution_notes)
7. maybeCompleteMission()
8. audit EXCEPTION_RESOLVED ; emit 'exception.resolved', 'inventory.changed', 'reservation.changed' (+ 'mission.completed' / 'order.status_changed' if applicable)
9. return 200 { exception, new_stops? }
```
**Best-effort reroute (Gateway, after commit, only when new stops were created):** `GET /internal/v1/missions/:ref/reroute-input` → `{ start_node, pending:[{key:stop_id, bin_code, node}] }` (`start_node` = node of the last finished stop, else `DOCK`) → Engine 2 `/routes/plan` → Engine 3 `POST /internal/v1/missions/:ref/reroute { route, ordered_stop_ids }` which re-sequences **only PENDING stops** and replaces `route_json` (flag `rerouted:true`) provided the id set still matches. If Engine 2 is down or the set changed, skip silently: the appended stop order is still valid.
**Cancellation extension:** `cancelOrder` closes open exceptions of the order (`status RESOLVED`, `resolution ORDER_CANCELLED`, stops `EXCEPTION_OPEN → RESOLVED`) and records `unreturned_picked` in the audit.

## 8.6 Frontend
**Mission detail (owning PICKER, status `IN_PROGRESS`):**
- Progress bar (units picked / required, stops finished / total) — updated only from API responses.
- **Current stop card** (lowest `seq` still `PENDING`): large location text (`A-01-L-1`, shelf), product `Name · SKU`, required quantity.
- Inputs: **Scan bin**, **Scan product** (plain text fields; a scanner just types into them), **Picked quantity** (default = required, integer). If picked < required, an exception type selector (`SHORT_PICK`, `DAMAGED`, `OTHER`) and notes become mandatory.
- Buttons: **Confirm pick** (disabled until both scans are filled and the form is valid; disabled while pending) and **Report problem** (opens a small form: type `BIN_EMPTY|DAMAGED|WRONG_PRODUCT|OTHER`, notes).
- Error mapping: `PRODUCT_MISMATCH` → "Wrong product scanned — expected {name} ({sku})", `BIN_MISMATCH` → "Wrong location — go to {bin}", `QUANTITY_EXCEEDS_RESERVATION` → "You can pick at most {n}". Network failure → "Network problem — retry is safe, it will not double-count" and the **same idempotency key** is reused.
- When the mission completes: banner "Mission complete — order sent to packing". Stops with open exceptions show an `Exception EXC-0001` badge and are skipped for "current stop".
**Exceptions page `/exceptions`** (MANAGER full, PICKER own): list + filters. MANAGER opens a dialog: exception facts, current bin stock/reserved, other orders reserving that bin, notes input, optional **Recount bin** quantity, and two actions: **Reallocate from other bins** / **Accept short**. `INSUFFICIENT_STOCK` shows "No other stock available — accept the shortfall or cancel the order".

## 8.7 Phase 8 tests
| ID | Test | Expected |
|---|---|---|
| P8-T01 | Confirm a full stop | Bin `qty` and `reserved_qty` both drop by `qty`; reservation `CONSUMED`; stop `PICKED`; `order_lines.qty_picked` up; movement `PICK` (`BIN → ORDER_PACKING`); audit + events |
| P8-T02 | Two-stop mission, confirm both | Mission `COMPLETED`, order `PICKED` |
| P8-T03 | Wrong picker / mission `ASSIGNED` | `NOT_YOUR_MISSION` / `MISSION_STATE_INVALID` |
| P8-T04 | Wrong scanned SKU / wrong scanned bin | `PRODUCT_MISMATCH` / `BIN_MISMATCH`; nothing changed |
| P8-T05 | `picked_qty` above outstanding / 0 / -1 / 2.5 | `QUANTITY_EXCEEDS_RESERVATION` / validation / validation / validation |
| P8-T06 | Partial pick 3 of 5: without exception / with exception | `SHORT_PICK_REQUIRES_EXCEPTION` / consumed 3; reservation still `HELD` outstanding 2; stop `EXCEPTION_OPEN`; `EXC-0001` OPEN; bin `recount_required=1`; `qty_picked=3`; mission not complete |
| P8-T07 | Duplicate confirm: same key / different key on a `PICKED` stop / two parallel same-key requests | Single deduction / `STOP_STATE_INVALID` / single deduction |
| P8-T08 | Report `BIN_EMPTY` | No quantity change; exception OPEN; recount flag; stop `EXCEPTION_OPEN`; mission still `IN_PROGRESS`; order not `PICKED` |
| P8-T09 | Report `DAMAGED`, `WRONG_PRODUCT`, `OTHER` | Types stored; `OTHER` does **not** set recount flag |
| P8-T10 | Report on a non-`PENDING` stop; second open exception on the same stop | `STOP_STATE_INVALID`; blocked by the unique index |
| P8-T11 | Resolve `ACCEPT_SHORT` after partial pick | 2 released; reservation `CONSUMED` (3 consumed, 2 released); `qty_short=2`; stop `RESOLVED`; mission completes if last; order `PICKED`; I07/I08 PASS |
| P8-T12 | Resolve `REALLOCATE` with stock elsewhere | Old reservation closed; new `HELD` reservations in other bins; new `PENDING` stop appended; mission stays `IN_PROGRESS`; picking the new stop completes it |
| P8-T13 | `REALLOCATE` with no stock elsewhere | `INSUFFICIENT_STOCK`; **zero** changes (exception still OPEN); then `ACCEPT_SHORT` works |
| P8-T14 | Resolve with `recount 0` while another order still reserves that bin | `ADJUSTMENT_CONFLICT`; full rollback (exception stays OPEN). After that order is resolved/cancelled → succeeds; flag cleared; `ADJUSTMENT` movement written |
| P8-T15 | Resolve as PICKER / resolve an already resolved exception | 403 / `EXCEPTION_STATE_INVALID` |
| P8-T16 | Cancel an order that has an open exception and 3 picked units | Exception `RESOLVED/ORDER_CANCELLED`; picked units **not** restored; audit lists `unreturned_picked` |
| P8-T17 | Mission with one `EXCEPTION_OPEN` stop and all others `PICKED` | Mission stays `IN_PROGRESS`; order stays `PICKING` |
| P8-T18 | Bin with `recount_required` | Excluded from new reservations and from Engine 2 placement until recounted |
| P8-T19 | Engine 1 stopped, confirm pick | `503 ENGINE1_UNAVAILABLE`; nothing changed; restart; same key succeeds once |
| P8-T20 | Kill Engine 3 mid-confirm and restart it | Exactly one deduction after retry |
| P8-T21 | Two pickers confirm stops on the same shelf in parallel; two orders pick from the same bin | Both succeed; each consumes only its own reservation; totals exact |
| P8-T22 | `hooks.afterStep('stockOut')` throws | Full rollback (bin, reservation, stop, line, ledger, sequences) |
| P8-T23 | Reroute after `REALLOCATE`: Engine 2 up / down | Pending stops re-sequenced / resolution still succeeds, appended order kept |
| P8-T24 | Integrity after a mixed scenario (full, partial, empty, reallocate, accept short) | I01–I13 all PASS |
| P8-T25 | Web: stop panel flow, mismatch messages, exception fields appear when qty < required, retry reuses key, progress only from responses, manager resolve dialog | Pass |

## 8.8 Phase 8 acceptance gate
- [ ] Browser: picker confirms both stops of `MIS-0001` with scans → bin stock decreases in Inventory and Warehouse grid, ledger shows two `PICK` rows, order shows `PICKED`.
- [ ] A short pick creates an exception; the manager resolves it both ways in two separate trials.
- [ ] P8 tests + all earlier tests green; `verify:integrity` exits 0 (all 13 checks); log + checklist updated; committed.

---

# PHASE 9 — PACKING, ORDER COMPLETION, DASHBOARD, AUDIT

**Objective:** a real packing step that validates everything before completing an order; plus the dashboard and the manager's audit/integrity views.
**Prerequisites:** Phase 8 gate passed.

## 9.1 Migration `migrations/warehouse/009_packing.sql`
```sql
CREATE TABLE packing_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ref             TEXT NOT NULL UNIQUE,
  order_id        INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  mission_id      INTEGER REFERENCES missions(id),
  packed_by       INTEGER NOT NULL REFERENCES users(id),
  packed_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  fulfilment_type TEXT NOT NULL CHECK (fulfilment_type IN ('FULL','PARTIAL')),
  total_ordered   INTEGER NOT NULL CHECK (total_ordered > 0),
  total_picked    INTEGER NOT NULL CHECK (total_picked > 0),
  notes           TEXT
);
```
The existing order status set already contains the terminal state `COMPLETED`; **do not introduce `PACKED` or `DISPATCHED`**.

## 9.2 Packing API
- `GET /api/packing/queue` (all roles can read; STAFF/MANAGER act) → orders in status `PICKED`:
```json
{ "items":[ { "order_ref":"ORD-0001","customer_ref":"Acme Retail","priority":"NORMAL","mission_ref":"MIS-0001",
   "lines":[ {"sku":"SKU001","product_name":"Wireless Mouse","qty_ordered":5,"qty_picked":5,"qty_short":0},
             {"sku":"SKU002","product_name":"Mechanical Keyboard","qty_ordered":2,"qty_picked":1,"qty_short":1} ],
   "total_ordered":7,"total_picked":6,"total_short":1,"fulfilment_preview":"PARTIAL","needs_manager_approval":true,
   "exceptions":[ {"ref":"EXC-0001","type":"SHORT_PICK","resolution":"ACCEPT_SHORT","notes":"..."} ] } ] }
```
- `POST /api/orders/:ref/pack` body `{ notes?: string<=300, accept_partial?: boolean }` (MANAGER, STAFF) — PROXY direct to Engine 3, `Idempotency-Key` required.
**Engine 3 `packOrder` (`runIdempotent` + `runTx`) — validation order:**
```
1. order.status == PICKED                          → else ORDER_STATE_INVALID {status}           (COMPLETED included → no duplicate packing)
2. latest mission of the order is COMPLETED        → else PACK_INCOMPLETE
3. no stop PENDING/EXCEPTION_OPEN, no OPEN exception for the order        → else PACK_INCOMPLETE
4. every line: qty_picked + qty_short == qty_ordered                         → else PACK_INCOMPLETE {lines}
5. committed-deduction check: Σ PICK movements with to_ref = order ref == Σ order_lines.qty_picked == Σ reservations.consumed_qty
                                                                              → else INVENTORY_DRIFT (should never happen)
6. total_picked == 0                               → PACK_INCOMPLETE {reason:'NOTHING_PICKED'}  (order must be cancelled instead)
7. Σ qty_short > 0 → PARTIAL:  actor.role must be MANAGER (else PARTIAL_PACK_FORBIDDEN 403)
                               accept_partial must be true (else PACK_INCOMPLETE {requires_accept_partial:true, shortfall})
   else FULL
8. INSERT packing_records(ref = nextRef('packing'), packed_by, fulfilment_type, totals, notes)
   orders.status = 'COMPLETED', fulfilment_type, completed_at = now
9. audit ORDER_PACKED ; emit 'order.completed' {ref, fulfilment_type} ; 'order.status_changed'
10. return 201 { packing_ref, order_ref, fulfilment_type, total_ordered, total_picked, packed_by, packed_at }
```
Packing performs **no stock quantity change** (stock left the bins at pick time); it validates that those deductions are committed. Completed orders are immutable.

## 9.3 Dashboard — `GET /api/dashboard` (any role; "today" = current UTC day)
```json
{ "generated_at":"...",
  "receiving":{"receipts_today":2,"units_received_today":70,"staged_units":30,"staged_lines":2},
  "inventory":{"stored_units":1234,"reserved_units":12,"available_units":1200,"unavailable_units":22,"occupied_bins":23,"total_bins":192,"fill_pct":9.4},
  "orders":{"reserved":1,"assigned":0,"picking":1,"picked":1,"completed_today":3,"cancelled_today":0,"completed_total":3},
  "missions":{"assigned":0,"in_progress":1,"completed_today":3},
  "exceptions":{"open":1},
  "movements":{"today":{"RECEIVE":2,"PUTAWAY":2,"PICK":5,"RELOCATE":0,"ADJUSTMENT":0},
               "latest":[ {"ref":"MOV-0042","type":"PICK","sku":"SKU001","product_name":"Wireless Mouse","qty":5,"from_label":"Bin A-01-L-1","to_label":"Order ORD-0001 (packing)","created_at":"..."} ]},
  "engine":{"queued_tasks":0,"running_tasks":0,"failed_tasks_24h":0} }
```
`available_units` = Σ ATP (`v_available_stock`); `unavailable_units` as in Phase 2; every number is computed by SQL from real tables (no counters stored). `engine` comes from Engine 1 via the Gateway; if Engine 1 is unreachable return `engine:null` (do not fail the endpoint).
`GET /api/audit?entity_type=&entity_id=&actor=&action=&page=` (MANAGER) → `{at, actor, role, action, entity_type, entity_id, details}`. `GET /api/admin/integrity` (MANAGER) → `{ ok:boolean, checks:[{id,name,status:'PASS'|'FAIL'|'SKIP',rows?:[...]}] }` (Engine 3 runs the §9 checks over its own connection).

## 9.4 Frontend
- **Packing page `/packing`** (nav for STAFF, MANAGER): left queue (ORD ref, customer, units picked/ordered, badges *Partial* / *Needs manager*), right detail: table **Product `Name · SKU` | Ordered | Picked | Short | Check (✓/⚠)**; exceptions list; notes input; **Confirm packing**.
  - Full order: any STAFF/MANAGER can confirm.
  - Partial order: STAFF sees a disabled button with "Manager approval required"; MANAGER sees checkbox "I accept partial fulfilment" and the button is enabled only when ticked.
  - Success banner `PCK-0001 — ORD-0001 completed (FULL)`; queue refetches.
- **Dashboard (`/`, replaces the Phase 1 home; keeps the service-health strip):** tiles — Staged units, Reserved, Available, Pending orders (`reserved`+`assigned`), Active missions, Completed today, Open exceptions; movement summary (today by type) and the latest 10 movements; refetch every 15 s while visible.
- **Admin (`/admin`, MANAGER):** tabs **Audit** (filters + table), **Integrity** (Run checks button → list of checks with PASS/FAIL/SKIP and offending rows).

## 9.5 Phase 9 tests
| ID | Test | Expected |
|---|---|---|
| P9-T01 | Pack a fully picked order | `PCK-0001`; order `COMPLETED`, `FULL`, `completed_at` set; audit + events; inventory snapshot identical before/after packing |
| P9-T02 | Pack twice: same key / different key | Replay of the original / `ORDER_STATE_INVALID`; exactly one `packing_records` row |
| P9-T03 | Pack orders in `RESERVED`, `ASSIGNED`, `PICKING` | `ORDER_STATE_INVALID` |
| P9-T04 | Order with accepted shortfall: STAFF / MANAGER without flag / MANAGER with flag | `PARTIAL_PACK_FORBIDDEN` / `PACK_INCOMPLETE {requires_accept_partial}` / `COMPLETED`, `PARTIAL` |
| P9-T05 | Defence in depth: force an order to `PICKED` in a test DB while a stop is `PENDING` and an exception is OPEN | `PACK_INCOMPLETE` |
| P9-T06 | All lines short and accepted (nothing picked) | Mission completes, order `PICKED`; pack → `PACK_INCOMPLETE {NOTHING_PICKED}`; cancel works (no reservations remain) |
| P9-T07 | Corrupt `qty_picked` in a test DB then pack | `INVENTORY_DRIFT`; no state change |
| P9-T08 | Pack as PICKER / OPERATOR | 403 |
| P9-T09 | `GET /packing/queue` | Only `PICKED` orders; correct per-line numbers; correct `fulfilment_preview` / `needs_manager_approval` |
| P9-T10 | Dashboard vs independent SQL aggregates (parametrized over every number) | Equal |
| P9-T11 | Dashboard "today" boundaries (UTC) with fixtures at 23:59 and 00:01 | Counted on the correct day |
| P9-T12 | Audit endpoint filters; non-manager | Entries for every earlier action with actor; 403 for others |
| P9-T13 | `GET /admin/integrity` after a full flow | `ok:true`, all checks PASS |
| P9-T14 | Web: packing table, STAFF cannot approve partial, manager checkbox, dashboard tiles from mocked API | Pass |
| P9-T15 | Restart all services | `COMPLETED` order + packing record + dashboard identical |

## 9.6 Phase 9 acceptance gate
- [ ] Browser: `staff1` packs a full order → `COMPLETED`; a partial order is packable only by `manager1` with the checkbox.
- [ ] Dashboard figures match Inventory and Orders pages.
- [ ] P9 tests + all earlier tests green; `verify:integrity` exits 0; log + checklist updated; committed.
---

# PHASE 10 — REALTIME (WEBSOCKET + OUTBOX REPLAY), HARDENING, FULL E2E & FINAL REPORT

**Objective:** stream committed warehouse events in real time from Engine 3's transactional outbox through Gateway WebSockets to the browser (with gap-free replay on reconnect), prove system resilience under concurrency and process crashes, run the complete end-to-end warehouse lifecycle, and generate the final verification report[cite: 1].
**Prerequisites:** Phase 9 gate passed[cite: 1].

## 10.1 Transactional Outbox Feed & WebSocket Architecture

Events are **never** emitted before a database transaction commits[cite: 1]. In Phases 1–9, Engine 3 wrote rows into `outbox_events(seq, event_type, entity_type, entity_id, data_json, created_at)` inside `runTx`[cite: 1]. Phase 10 connects that table to the browser[cite: 1].

### 10.1.1 Engine 3 internal outbox endpoint
- `GET /internal/v1/outbox?after_seq=0&limit=100`
  - Queries `SELECT seq, event_type, entity_type, entity_id, data_json, created_at FROM outbox_events WHERE seq > @after_seq ORDER BY seq ASC LIMIT @limit`.
  - Also returns `latest_seq`: `SELECT COALESCE(MAX(seq), 0) FROM outbox_events`.
  - Response shape:
    ```json
    {
      "latest_seq": 42,
      "events": [
        {
          "seq": 41,
          "event_type": "inventory.changed",
          "entity_type": "BIN",
          "entity_id": "A-01-L-4",
          "data": { "bins": ["A-01-L-4"] },
          "created_at": "2026-11-01T10:15:00.000Z"
        }
      ]
    }
    ```

### 10.1.2 Gateway Outbox Poller & WebSocket Server (`services/gateway/src/ws/hub.ts`)
- Attach a `ws.WebSocketServer` to the Gateway HTTP server at path `/ws`[cite: 1].
- **Authentication:** On connection upgrade or initial connect, read `?token=<jwt>&since=<seq>` from the query string[cite: 1]. Verify the JWT using the same secret and logic as HTTP `auth` middleware[cite: 1]. If invalid or expired → send close frame `4401` (`"UNAUTHENTICATED"`) and terminate the socket immediately.
- **Initial handshake & replay:**
  1. Parse `since = Number(query.since ?? 0)`.
  2. Immediately send `{ "type": "connected", "latest_seq": currentGatewaySeq }`.
  3. If `since > 0` and `since < currentGatewaySeq`: fetch missed events from Engine 3 (`GET /internal/v1/outbox?after_seq=${since}&limit=500`).
     - If more than 500 events were missed (or if `since > currentGatewaySeq`, e.g. DB was recreated in a test), send `{ "type": "resync_required", "latest_seq": currentGatewaySeq }` so the client invalidates all React Query caches at once.
     - Otherwise, send each missed event in `seq` order to that client with `"replay": true`.
- **Background poller loop (in Gateway):**
  - Every `250 ms`, Gateway polls Engine 3 `GET /internal/v1/outbox?after_seq=${lastPolledSeq}&limit=100`.
  - For each new event returned, update `lastPolledSeq = event.seq` and broadcast to all connected authenticated clients:
    ```json
    {
      "type": "event",
      "seq": 42,
      "event_type": "order.status_changed",
      "entity_type": "ORDER",
      "entity_id": "ORD-0001",
      "data": { "ref": "ORD-0001", "status": "PICKED" },
      "created_at": "2026-11-01T10:15:00.000Z",
      "replay": false
    }
    ```
  - **Role filtering:** Do not leak restricted data. Events are lightweight invalidation signals (refs and statuses), which all authenticated roles may receive; the client then refetches via RBAC-protected REST endpoints.
  - **Heartbeat:** Ping clients every `20 s`; terminate unresponsive sockets after `10 s`.
  - If Engine 3 is temporarily unreachable during polling, log a warning, keep existing WS connections open, and retry on the next tick.

### 10.1.3 Event catalog → React Query cache invalidation (`apps/web/src/hooks/useRealtime.ts`)
Maintain `lastSeq` and `connected: boolean` in `realtimeStore` (Zustand)[cite: 1]. Connect to `ws://<host>/ws?token=${token}&since=${lastSeq}`[cite: 1]. On close/error, reconnect with exponential backoff (`500 ms → 1 s → 2 s → max 5 s`), always passing the latest `lastSeq`.

When a message arrives:
- Update `lastSeq = msg.seq` (if `msg.seq > lastSeq`).
- If `msg.type === 'resync_required'`, call `queryClient.invalidateQueries()` (all queries).
- Otherwise invalidate query keys according to `msg.event_type`:

| `event_type` | React Query keys to invalidate |
|---|---|
| `receipt.created` | `['receipts']`, `['staged']`, `['inventory']`, `['dashboard']` |
| `putaway.completed` | `['putaways']`, `['receipts']`, `['staged']`, `['inventory']`, `['warehouse']`, `['dashboard']` |
| `inventory.changed` | `['inventory']`, `['warehouse']`, `['dashboard']` |
| `bin.status_changed` | `['inventory']`, `['warehouse']`, `['dashboard']` |
| `order.created`, `order.status_changed`, `order.completed` | `['orders']`, `['packing']`, `['dashboard']` |
| `reservation.changed` | `['orders']`, `['inventory']`, `['warehouse']`, `['dashboard']` |
| `mission.assigned`, `mission.started`, `mission.completed` | `['missions']`, `['orders']`, `['packing']`, `['dashboard']` |
| `pick.confirmed` | `['missions']`, `['orders']`, `['inventory']`, `['warehouse']`, `['packing']`, `['dashboard']` |
| `exception.opened`, `exception.resolved` | `['exceptions']`, `['missions']`, `['orders']`, `['inventory']`, `['packing']`, `['dashboard']` |

Display a live indicator in `AppShell` header (`data-testid="ws-status"`): green `"Live"` when connected, amber `"Reconnecting…"` when disconnected.

## 10.2 Hardening & Operational Polish
1. **Idempotency key purge at Engine 3 startup:** `DELETE FROM idempotency_keys WHERE created_at < datetime('now', '-7 days')`[cite: 1].
2. **Graceful shutdown:** Every service (`gateway`, `engine1`, `engine2`, `engine3`) listens for `SIGINT` and `SIGTERM`, stops accepting new HTTP/WS requests, finishes in-flight requests, closes SQLite connections cleanly, and exits `0`.
3. **API documentation generator (`docs/API.md`):** Create or generate a concise reference of all public `/api/*` endpoints, required roles, request/response schemas, and WebSocket event shapes[cite: 1].
4. **Full RBAC audit:** Verify that every route in Gateway has explicit `rbac(...)` middleware matching §6.5 and §6.9[cite: 1].

## 10.3 End-to-End & Resilience Test Suite (`tests/e2e/`)
All E2E tests run against a real multi-process stack spawned via `startStack()` on temporary databases[cite: 1].

| ID | Test | Expected |
|---|---|---|
| P10-T01 | **WS auth:** connect without token / with bad token / with valid token | Close code `4401` / `4401` / receives `{type:"connected"}` |
| P10-T02 | **WS live push:** connect WS, create a receipt via REST | WS receives `receipt.created` within 1 s with matching `ref` and `seq >= 1` |
| P10-T03 | **WS gap-free replay:** connect WS, record `seq1`, disconnect WS; perform put-away + order creation; reconnect with `?since=seq1` | Client immediately receives missed events (`putaway.completed`, `inventory.changed`, `order.created`, `reservation.changed`) with `replay: true` in strict `seq` order |
| P10-T04 | **Full Happy-Path Golden Lifecycle (API E2E):**<br>1. `operator1` receives `RCV-0001` (50 × SKU001, 30 × SKU002)<br>2. `operator1` asks Engine 2 for placement recommendation and puts away both lines (`PUT-0001`, `PUT-0002`)<br>3. `manager1` creates `ORD-0001` (10 × SKU001, 5 × SKU002)<br>4. `manager1` assigns `picker1` (`MIS-0001` created with Held-Karp route)<br>5. `picker1` starts `MIS-0001` and confirms both stops with valid bin & SKU scans<br>6. `staff1` views packing queue and packs `ORD-0001` (`PCK-0001`) | Order ends `COMPLETED` (`FULL`); bin stock is 40 and 25, reserved is 0; movements table has 2 `RECEIVE`, 2 `PUTAWAY`, 2 `PICK`; `verify:integrity` passes all 13 checks (`I01`–`I13`)[cite: 1] |
| P10-T05 | **Full Exception & Partial-Pack Lifecycle (API E2E):**<br>1. Create order for 10 × SKU001 (spread or single bin)<br>2. Assign & start mission<br>3. Picker confirms short pick (6 of 10) with `SHORT_PICK` → `EXC-0001` opened, bin flagged `recount_required=1`<br>4. Manager resolves `EXC-0001` with `ACCEPT_SHORT` and `recount: { counted_qty: 0 }`<br>5. Mission auto-completes, order becomes `PICKED`<br>6. `staff1` attempts to pack → `403 PARTIAL_PACK_FORBIDDEN`<br>7. `manager1` packs with `accept_partial: true` | Order ends `COMPLETED` (`PARTIAL`), `total_ordered=10`, `total_picked=6`; bin `qty=0`, `recount_required=0`; `verify:integrity` passes all 13 checks[cite: 1] |
| P10-T06 | **Exception Reallocate Lifecycle (API E2E):**<br>1. Stock SKU002 in two bins (`B-01-L-1`: 10, `B-02-L-1`: 10)<br>2. Create order for 8 units (reserved in `B-01-L-1`)<br>3. Picker reports `BIN_EMPTY` on stop 1<br>4. Manager resolves with `REALLOCATE` and `recount: { counted_qty: 0 }` | Old reservation released, `B-01-L-1` recounted to 0, new reservation & stop `-S02` created at `B-02-L-1`, mission rerouted; picker confirms `-S02`; `staff1` packs (`FULL`); `verify:integrity` passes all 13 checks[cite: 1] |
| P10-T07 | **High-concurrency contention stress test:**<br>Seed 100 units of SKU001 across 2 bins. Fire in parallel: 8 order creations (15 units each), 2 put-aways (20 units each), and 1 relocation | Zero deadlocks, zero 500 errors, zero SQLite busy errors; exact conservation of stock; `verify:integrity` passes `I01`–`I13`[cite: 1] |
| P10-T08 | **Crash & restart resilience:**<br>Mid-workflow (1 order `RESERVED`, 1 mission `IN_PROGRESS` with 1 stop picked), kill and restart Engine 1, Engine 2, Engine 3, and Gateway | All state preserved; mission finishes remaining stop and packs cleanly; `verify:integrity` passes `I01`–`I13`[cite: 1] |
| P10-T09 | **Playwright Browser Smoke E2E (`tests/e2e/browser.spec.ts`):**<br>Drive the real Chromium browser through Login (`operator1`) → Receiving intake → Allocate & Put-away → Logout → Login (`manager1`) → Create Order → Assign Picker → Logout → Login (`picker1`) → Start Mission & Confirm Pick → Logout → Login (`staff1`) → Confirm Packing → verify `COMPLETED` badge | Complete UI workflow succeeds with zero console/page errors and real database persistence[cite: 1] |

> **Playwright fallback rule:** If Chromium binary installation is blocked by a restricted network/sandbox environment, log the exact error in `docs/BLOCKERS.md` and execute the identical step-by-step UI state & DOM flow using `@testing-library/react` + `jsdom` against the live backend stack (`startStack()`), verifying every `data-testid` interaction end-to-end[cite: 1].

## 10.4 Final Report Format (`docs/IMPLEMENTATION_CHECKLIST.md` & terminal output)
At the end of Phase 10, run the full test suite (`npm run test` and `npm run test:e2e`) and `npm run verify:integrity`, then write a final summary section in `docs/IMPLEMENTATION_CHECKLIST.md` structured into these exact four categories[cite: 1]:
1. **IMPLEMENTED AND TESTED** — every phase, endpoint, UI page, and invariant check verified with real test command output[cite: 1].
2. **IMPLEMENTED BUT NOT FULLY TESTED** — any feature built where a specific test had to be adapted (must explain why)[cite: 1].
3. **NOT IMPLEMENTED** — must be empty (`None`) for all Phase 1–10 in-scope items[cite: 1].
4. **BLOCKED BY EXTERNAL DEPENDENCY** — any environment/OS blocker encountered (or `None`)[cite: 1].

## 10.5 Phase 10 acceptance gate
- [ ] All unit, integration, and E2E tests across Phases 1–10 pass (`npm run test` & `npm run test:e2e`)[cite: 1].
- [ ] `npm run verify:integrity` runs all 13 checks (`I01`–`I13`) with 0 `FAIL` and 0 `SKIP`[cite: 1].
- [ ] Live WebSocket updates work in the browser without manual page refresh[cite: 1].
- [ ] `docs/IMPLEMENTATION_CHECKLIST.md`, `docs/IMPLEMENTATION_LOG.md`, and `docs/API.md` are complete and committed[cite: 1].

---

# APPENDIX A — DETERMINISTIC NAVIGATION GRAPH VERIFICATION

To guarantee that Phase 1 (`P1-T03`, `P1-T05`) and Phase 4 (`P4-T01`) pass on the first run, `scripts/seed-base.ts` must generate the exact 34 nodes and 36 undirected edges below[cite: 1]:

### A.1 Nodes (34 total)
- `DOCK`: `(0, 0)`, kind `'DOCK'`[cite: 1]
- `PACK`: `(80, 0)`, kind `'PACK'`[cite: 1]
- Bottom cross-aisle (`kind = 'CROSS'`)[cite: 1]:
  - `XB-A`: `(10, 0)` · `XB-B`: `(30, 0)` · `XB-C`: `(50, 0)` · `XB-D`: `(70, 0)`[cite: 1]
- Top cross-aisle (`kind = 'CROSS'`)[cite: 1]:
  - `XT-A`: `(10, 50)` · `XT-B`: `(30, 50)` · `XT-C`: `(50, 50)` · `XT-D`: `(70, 50)`[cite: 1]
- Aisle bay nodes (`kind = 'AISLE'`, 4 aisles × 6 bays = 24 nodes)[cite: 1]:
  - For `aisle` in `['A','B','C','D']` with `x` in `[10, 30, 50, 70]`[cite: 1]:
    - For `bay` in `1..6`[cite: 1]:
      - Node ID: `N-${aisle}-0${bay}` (e.g. `N-A-01` .. `N-D-06`)[cite: 1]
      - Coordinates: `x = aisle_x`, `y = 10 + (bay - 1) * 6` (so `y` ∈ `{10, 16, 22, 28, 34, 40}`)[cite: 1]

### A.2 Undirected Edges (36 total, stored once in `nav_edges` with `distance = round(hypot(dx,dy), 2)`)
1. Bottom spine (5 edges)[cite: 1]:
   - `DOCK`–`XB-A` (`10`) · `XB-A`–`XB-B` (`20`) · `XB-B`–`XB-C` (`20`) · `XB-C`–`XB-D` (`20`) · `XB-D`–`PACK` (`10`)[cite: 1]
2. Top spine (3 edges)[cite: 1]:
   - `XT-A`–`XT-B` (`20`) · `XT-B`–`XT-C` (`20`) · `XT-C`–`XT-D` (`20`)[cite: 1]
3. Per aisle `a` ∈ `{A, B, C, D}` (7 edges × 4 aisles = 28 edges)[cite: 1]:
   - Bottom entry: `XB-${a}`–`N-${a}-01` (`10`)[cite: 1]
   - Bay hops: `N-${a}-01`–`N-${a}-02` (`6`), `02`–`03` (`6`), `03`–`04` (`6`), `04`–`05` (`6`), `05`–`06` (`6`)[cite: 1]
   - Top exit: `N-${a}-06`–`XT-${a}` (`10`)[cite: 1]

**Shortest-path checkpoints (`P4-T01`)[cite: 1]:**
- `dist(DOCK, N-A-01)` = `10 (DOCK→XB-A) + 10 (XB-A→N-A-01)` = **`20`**[cite: 1]
- `dist(DOCK, N-A-06)` = `20 + 5 × 6` = **`50`**[cite: 1]
- `dist(DOCK, N-D-01)` = `10 + 20 + 20 + 20 + 10` = **`80`**[cite: 1]
- `dist(DOCK, PACK)` = `10 + 20 + 20 + 20 + 10` = **`80`**[cite: 1]
- Largest shelf distance from `DOCK` (`maxDist` in §4.3) = `dist(DOCK, N-D-06)` = `70 + 10 + 30` = **`110`**.

---

# APPENDIX B — MANDATORY `data-testid` CATALOG

Use these exact `data-testid` attributes on interactive and status elements so component and E2E tests are 100% deterministic[cite: 1]:

| Page / Component | Element | `data-testid` |
|---|---|---|
| **AppShell** | Current user badge | `header-user` |
| | WebSocket status badge | `ws-status` |
| | Logout button | `logout-btn` |
| | Side navigation links | `nav-home`, `nav-receiving`, `nav-inventory`, `nav-warehouse`, `nav-orders`, `nav-picking`, `nav-packing`, `nav-exceptions`, `nav-tasks`, `nav-admin` |
| **Login (`/login`)** | Username input | `login-username` |
| | Password input | `login-password` |
| | Submit button | `login-submit` |
| | Error banner | `login-error` |
| **Receiving (`/receiving`)** | Tab buttons | `tab-new-intake`, `tab-staged-stock`, `tab-receipts`, `tab-putaways` |
| | Supplier / Ref / Notes inputs | `intake-supplier`, `intake-reference`, `intake-notes` |
| | Add line button | `intake-add-line` |
| | Line row `i` (0-based) | `intake-line-sku-${i}`, `intake-line-qty-${i}`, `intake-line-remove-${i}` |
| | Confirm intake button | `intake-submit` |
| | Created receipt banner | `intake-success-banner` |
| | Staged row allocate button | `staged-allocate-${line_id}` |
| **Allocation Panel** | Quantity input | `alloc-qty` |
| | Recommended bin card & select | `alloc-recommended-card`, `alloc-select-recommended` |
| | Show all bins toggle | `alloc-show-all-toggle` |
| | Candidate bin select button | `alloc-select-bin-${bin_code}` |
| | Validation status badge | `alloc-validation-status` |
| | Confirm put-away button | `alloc-confirm-btn` |
| **Inventory (`/inventory`)** | Tab buttons | `inv-tab-summary`, `inv-tab-bins`, `inv-tab-ledger` |
| | Search input | `inv-search` |
| | Bin row | `inv-bin-row-${bin_code}` |
| | Bin status change button | `bin-status-btn` |
| | Bin recount button & submit | `bin-recount-btn`, `bin-recount-submit` |
| | Bin relocate button & submit | `bin-relocate-btn`, `bin-relocate-submit` |
| **Warehouse (`/warehouse`)** | Locate search input | `warehouse-locate-input` |
| | Shelf card | `shelf-card-${shelf_code}` |
| | Bin cell | `bin-cell-${bin_code}` |
| **Orders (`/orders`)** | New order button | `orders-new-btn` |
| | Order type / priority / customer | `order-type`, `order-priority`, `order-customer` |
| | Line product search & qty | `order-line-sku`, `order-line-qty`, `order-add-line` |
| | Submit order button | `order-submit` |
| | Shortage table | `order-shortage-table` |
| | Cancel order button & confirm | `order-cancel-btn`, `order-cancel-confirm` |
| | Assign picker button & confirm | `order-assign-btn`, `order-assign-confirm` |
| **Picking (`/picking`)** | Mission card / row | `mission-row-${mission_ref}` |
| | Start mission button | `mission-start-btn` |
| | Current stop card | `current-stop-card` |
| | Scan bin / Scan SKU / Picked qty | `pick-scan-bin`, `pick-scan-sku`, `pick-qty` |
| | Exception type & notes (short pick) | `pick-exc-type`, `pick-exc-notes` |
| | Confirm pick button | `pick-confirm-btn` |
| | Report problem button & submit | `pick-report-btn`, `pick-report-submit` |
| **Exceptions (`/exceptions`)**| Exception row | `exc-row-${exc_ref}` |
| | Recount input in resolve modal | `exc-resolve-recount` |
| | Reallocate / Accept short buttons | `exc-resolve-reallocate`, `exc-resolve-accept-short` |
| **Packing (`/packing`)** | Queue item | `pack-queue-${order_ref}` |
| | Accept partial checkbox (Manager) | `pack-accept-partial-checkbox` |
| | Confirm packing button | `pack-confirm-btn` |
| **Admin (`/admin`)** | Run integrity checks button | `integrity-run-btn` |
| | Integrity overall status | `integrity-status` |

---

# APPENDIX C — GLOBAL TECHNICAL ERRATA & IMPLEMENTATION SAFEGUARDS (OVERRIDES)

**CRITICAL FOR THE BUILDING AGENT:** Read this appendix alongside **§1–§8** before starting Phase 1. Where any detail below clarifies or refines an earlier section, **follow the rules in this appendix**.

### C.1 Transaction Nesting Rule (`runIdempotent` + `runTx` — Clarifies §1.4 & §6.6)
- `runIdempotent` MUST use `runTx(db, () => { ... })` as its single transaction boundary and pass `db` directly into `handler(db)`[cite: 1].
- **Never** execute a raw `db.exec('BEGIN IMMEDIATE')` inside `runIdempotent` followed by calling `runTx` inside `handler`, or SQLite will throw `SqliteError: cannot start a transaction within a transaction`.
- When both `runIdempotent` and inner domain helpers use `better-sqlite3`'s `db.transaction(fn)` wrapper, `better-sqlite3` automatically converts nested calls into SQLite `SAVEPOINT`s. Only call `.immediate()` when `!db.inTransaction`:
  ```ts
  export function runTx<T>(db: Database.Database, fn: () => T): T {
    const trx = db.transaction(fn);
    return db.inTransaction ? trx() : trx.immediate();
  }
  ```

### C.2 Sequential Integration Test Execution (`vitest.config.ts` — Clarifies §1.5 & §3)
- Because `startStack()` spawns 4 child processes (`tsx`) per test suite[cite: 1], running test files in parallel across worker threads will cause CPU contention and port/timeout flakiness.
- Configure `vitest.config.ts` at the root with:
  ```ts
  export default defineConfig({
    test: {
      fileParallelism: false,
      testTimeout: 30000,
      hookTimeout: 30000,
    },
  });
  ```

### C.3 Authorized Internal Mirror Routes (`Engine 1` & `Engine 3` — Clarifies §5.2, §5.4 & §9.3)
- Whenever a Gateway `READ`, `PROXY`, or `ORCH` flow requires reading or mutating state on Engine 3 or Engine 1[cite: 1], you are explicitly authorized to expose the matching `/internal/v1/*` route on that engine without logging a deviation, including:
  - Engine 3: `GET /internal/v1/receipts/lines/:id` (Phase 4)[cite: 1], `GET /internal/v1/orders/:ref/pick-plan` (Phase 7)[cite: 1], `POST /internal/v1/orders/:ref/assign` (Phase 7)[cite: 1], `POST /internal/v1/orders/:ref/reassign` (Phase 7)[cite: 1], `GET /internal/v1/pick-stops/:ref` (Phase 8)[cite: 1], `GET /internal/v1/missions/:ref/reroute-input` (Phase 8)[cite: 1], `POST /internal/v1/missions/:ref/reroute` (Phase 8)[cite: 1], `GET /internal/v1/integrity` (Phase 9)[cite: 1], `GET /internal/v1/outbox` (Phase 10).
  - Engine 1: `GET /internal/v1/tasks`, `GET /internal/v1/tasks/:id`, `GET /internal/v1/locks`, `GET /internal/v1/queue`, `GET /internal/v1/stats` (for dashboard).
---
