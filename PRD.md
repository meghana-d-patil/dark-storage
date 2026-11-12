# PRD: Dark Store WMS Upgrade
**Segregation of Duties, Append-Only Stock Ledger, Real-World Floor Flows**

Repo: `d:\mini project final` (pnpm monorepo: `gateway`, `engine1-scheduler`, `engine2-optimizer`, `engine3-inventory`, `apps/web`, `packages/shared`).
Implementer: a small coding model with a limited context window. This file is written to be read **in pieces**.

---

# PART A: READ THIS FIRST (AGENT PROTOCOL)

## A.0 Resume protocol (every new session, every context reset)
1. Open `PROGRESS.md` (create it in P0-T1 if missing). Find the first unticked task. That is your task.
2. Read `RECON.md` (facts you discovered in Phase 0: commands, file paths, header names). Do not rediscover them.
3. Read this file's Parts A to D (skim), the REF sections your task names, and your PHASE only.
4. Work. Tick. Commit. Update `PROGRESS.md` with a one-line "next:" note at the bottom.

## A.1 How to read this file (MANDATORY)
1. **Do NOT read this whole file.** It is long on purpose. Get the outline first:
   `grep -n "^# \|^## " PRD.md`
2. Read **Parts A, B, C, D once** at the start of a session (they are short).
3. Then read **only the PHASE you are working on**: from its `## PHASE n` heading to the next `## PHASE` heading. Use `sed -n 'START,ENDp' PRD.md` with line numbers from the outline. Also read any `## REF-x` section the phase names, and only those.
4. Never re-read finished phases. Never read ahead.
5. When a source file you must edit is longer than 300 lines, view it with line ranges, not whole. Use `grep -n` to find the function first.

## A.2 Working loop (repeat for every task `Pn-Tm`)
1. Read the task. Open the files it names (and ONLY those).
2. Make the change exactly as specified. Use the exact names, paths, column names, error codes given.
3. Run the task's `CHECK` commands. Run the typecheck/build (command stored in `RECON.md`).
4. If green: tick the task in `PROGRESS.md`, then `git add -A && git commit -m "Pn-Tm: <short title>"` (if git exists).
5. If red: fix it. If stuck after 3 attempts, write the problem to `BLOCKERS.md` (task id, error, what you tried) and move to the next task that does not depend on it.
6. Write small files. If a new file would exceed ~250 lines, split it by responsibility.

## A.3 Hard rules
- **Never ask the user questions.** Decide using Part C (Decision Log). If a choice is not covered, pick the simplest option and append it to `DECISIONS_NEW.md` (one line: id, choice, why).
- **Never edit an applied migration** (`001`..`009`, and any migration you already wrote and committed). Always add a NEW migration file.
- **Never invent** endpoints, tables, columns, enum values, permissions, or error codes that this PRD does not define, unless you log it in `DECISIONS_NEW.md`.
- **Never write stock quantities directly** (`UPDATE inventory`, `INSERT INTO inventory`, `UPDATE bins SET current_qty`) outside `services/engine3-inventory/src/ledger/postLedger.ts` (created in Phase 4). Before Phase 4 exists, keep existing behaviour.
- **Never check roles by name** in new code (`role === 'MANAGER'` is forbidden). Use `can(user, 'pick:execute')` (created in Phase 1). The only allowed role-name use is inside `ROLE_PERMISSIONS` itself and seed data.
- **Never decide a scan is right on the client.** The server compares scans (D14).
- **Never leave the app broken.** After every phase: all 4 services start, web builds, login works, and the happy-path flow still runs (the P0 smoke script, extended each phase).
- Keep code **TypeScript strict**, ESM, same import style as the surrounding files (check whether imports use a `.js` suffix; copy it).
- Plain UI for floor roles: no 3D, no heavy libraries. Do not add npm dependencies except those named in a phase.
- Do not refactor unrelated code. Do not rename existing files. Do not reformat files you are not changing.
- Do not paste secrets or plaintext passwords into the web client (P2 removes the existing ones).

## A.4 Self-check before ticking any task
- [ ] Did I change only files this task names (plus tests)?
- [ ] Did the typecheck pass?
- [ ] Did I run the CHECK commands and see the expected output?
- [ ] Did I add/adjust a test where the task asks for one?
- [ ] Did every new mutating endpoint get: permission guard, idempotency, audit, outbox, same-transaction writes?
- [ ] Did every new error use a code from REF-5?

## A.5 Phase map (priority: MUST > SHOULD > WOW)

| Phase | Title | Priority | Depends on |
|---|---|---|---|
| P0 | Recon and baseline | MUST | none |
| P1 | Foundations: roles, permissions, config, state machine lib, test harness | MUST | P0 |
| P2 | RBAC enforcement (gateway + web) and removal of Manager execution powers | MUST | P1 |
| P3 | Hash-chained audit log + order event history | MUST | P1 |
| P4 | Append-only stock ledger (locations, lots) | MUST | P1, P3 |
| P5 | Totes, mission claim, task leases, floor tasks, 3-step scan picking | MUST | P2, P4 |
| P6 | Packing (item-scan, weight check) + Dispatch handover (OTP) | MUST | P5 |
| P7 | Exception loop + dual-control adjustments + quarantine + relocation | MUST | P5, P6 |
| P8 | Inbound: PO/ASN 3-way match, lots/expiry, FEFO | SHOULD | P4, P7 |
| P9 | Explainable allocator, replenishment, re-slotting what-if | SHOULD | P4, P5 |
| P10 | SLA-aware scheduling, mid-pick cancel put-back, batch picking | SHOULD | P5, P7 |
| P11 | Control tower, KPIs, cycle-count scheduling, shrinkage | SHOULD | P7, P8 |
| P12 | Floor UX: scan input, scan simulator, PIN login, devices | SHOULD | P5, P6 |
| P13 | Order simulator, picker bots, recall trace, event replay, tamper demo | WOW | P8, P11, P12 |
| P14 | Tests, seed data, docs, demo script | MUST | all |

Build order is P0 to P14. MUST phases (P0-P7, P14) alone produce a complete, defensible system. If time runs short, skip SHOULD/WOW phases but still do P14 for what exists.

---

# PART B: PROJECT FACTS (from the codebase report)

The existing schema in `migrations/warehouse/001..009` and `migrations/scheduler/s001` is authoritative. Read only the specific migration you need.

## B.1 Stack and ports
| Part | Tech | Port |
|---|---|---|
| Web | React 18, Vite, React Router 6, TanStack Query 5, Zustand 4, custom CSS | 5173 |
| Gateway | Express 4, JWT (12h), bcrypt, WebSocket hub `/ws` | 4000 |
| Engine 1 Scheduler | Express, SQLite `data/scheduler.db`, fencing-token locks, task queue | 4001 |
| Engine 2 Optimizer | Express, Dijkstra, Held-Karp TSP, 2-Opt, placement scorer | 4002 |
| Engine 3 Inventory | Express, SQLite `data/warehouse.db`, ledger, outbox, SQL triggers | 4003 |
- DB: `better-sqlite3`, WAL on, foreign keys on. Inter-service auth: header `x-internal-token` = env `INTERNAL_SERVICE_KEY`.
- Shared package import name: `@dark-storage/shared` (`packages/shared/src/{enums,types,dtos,index}.ts`).

## B.2 Existing tables (warehouse.db)
`users, id_sequences, audit_log, outbox_events, idempotency_keys, products, nav_nodes, nav_edges, shelves, bins, inventory, stock_movements, receipts, receipt_lines, putaways, orders, order_lines, reservations, missions, pick_stops, pick_exceptions, packing_records` and view `v_available_stock`.
Key invariants already enforced by triggers: capacity, single SKU per bin, no stock in BLOCKED/DAMAGED bin or MAINTENANCE shelf, HAZMAT only on HAZMAT shelf.

## B.3 Existing roles and problems this PRD fixes
Roles today: `MANAGER, OPERATOR, PICKER, STAFF`. Problems:
1. Manager can pick, pack, recount, relocate, receive (breaks Segregation of Duties).
2. Frontend routes have no role guards. Many GET endpoints have no role checks.
3. Pickers cannot self-claim; no tote tracking; no barcode scan verification.
4. Stock is deducted at pick directly in `inventory`; there is no location history (tote, pack bench, dispatch, quarantine, lost).
5. Exception resolution and recounts are single-step (no dual control, no approver != requester).
6. Role switcher bundles plaintext passwords in the web client.
7. Audit log is not tamper-evident.

## B.4 Existing endpoints that will be changed
See Phase 2 (`P2-ROUTES`). Do not change any endpoint not listed there or in a later phase.

## B.5 Things the agent must VERIFY in Phase 0 (write answers in `RECON.md`)
- How migrations are applied (runner script? at service start?). Where is it? Is each file wrapped in a transaction?
- How the gateway calls Engine 3 and how the acting user is passed (headers? body?).
- The exact header name used by the idempotency middleware, and where it is implemented.
- What happens in code when a bin's stock reaches 0 (inventory row deleted or kept; `bins.current_sku` cleared; `bins.status` value).
- Whether `pick_stops` are addressed by numeric `id` or a `stopRef` string in URLs.
- Which bcrypt package is used (`bcrypt` or `bcryptjs`).
- Which test runner exists (if none, Phase 1 adds `vitest`).
- The real scripts to build/typecheck/start (root `package.json`).
- Existing status enums of orders, missions, pick_stops, pick_exceptions, receipts (copy from migrations).
- Whether shelves have a vertical level column (needed for heavy-at-bottom scoring in P9).
- How Engine 1 and Engine 3 currently cooperate when a mission is assigned (who creates missions, who holds the lock).

---

# PART C: DECISION LOG (follow these; do not re-decide)

| ID | Decision |
|---|---|
| D1 | **Incremental upgrade.** No rewrite. New numbered migrations only. Existing pages/endpoints stay unless a phase changes them. |
| D2 | **Ledger is truth; `inventory` and `bins.current_qty` are a projection.** Only `postLedger()` may change them (from Phase 4). |
| D3 | **Permissions, not roles.** One map `ROLE_PERMISSIONS` in `packages/shared` (REF-1). Server and web both use `can()`. The server returns the user's `permissions[]` at login and `/api/auth/me`. |
| D4 | **State machine as data.** Transitions live in one table in `packages/shared/src/stateMachine.ts` (REF-2). All status changes for ORDER, MISSION, PICK_STOP, EXCEPTION, ADJUSTMENT, FLOOR_TASK go through `transition()`. |
| D5 | **New roles:** `ADMIN` (users, config thresholds, devices, locks), `DISPATCH` (rider handover), `AUDITOR` (read-only + audit export). **Manager holds business control, not system power.** |
| D6 | **Manager cannot execute physical steps** (receive, putaway, relocate, pick, pack, count, handover). Manager can request, approve, reassign, cancel, resolve exceptions. |
| D7 | **Allocator weights** are tuned by MANAGER (`config:weights`). **Thresholds, lease times, users, devices, locks** are ADMIN (`config:thresholds`). |
| D8 | **One lot per bin** (and one SKU per bin, already enforced). Makes FEFO and recall trace exact. Putaway of a different lot into a non-empty bin is rejected (`LOT_MIX`). |
| D9 | **Stock leaves the building at rider handover**, not at pack. Pack moves stock to a dispatch slot. |
| D10 | **Partial fulfilment:** order stays `PACKED` with `packing_records.fulfilment_type='PARTIAL'`. Legacy status `PARTIALLY_FULFILLED` is migrated to `PACKED`. |
| D11 | **Old shortcut endpoints are deleted**, not kept: `POST /api/orders/:ref/pack`, `POST /api/packing/:ref/pack`, `POST /api/pick-stops/:id/confirm`, `POST /api/inventory/bins/:code/recount`, `POST /api/orders/:ref/assign`. They return `410 ENDPOINT_REMOVED`. |
| D12 | **Periodic jobs** (lease sweep, escalation, replenishment, expiry, cycle-count scheduling) run as `setInterval` jobs inside Engine 3 `src/jobs/`, logged in table `job_runs`. Do NOT add new task types to the scheduler DB. |
| D13 | **Money** is integer paise (`*_paise`). Thresholds in config are in INR and converted at use. |
| D14 | **Barcodes** are plain strings, formats in REF-4. Scan endpoints receive the scanned string and compare server-side. |
| D15 | **Pickers are blind:** picker DTOs never include bin total qty, reserved qty, other orders, or customer data. Enforced by one DTO mapper (REF-8), not by hiding UI. |
| D16 | **Idempotency on every mutating call.** Client sends the idempotency header (exact name from Phase 0). Scan endpoints included. |
| D17 | **Dev tooling is env-gated.** Role switcher and scan simulator only appear when `VITE_DEMO_MODE=true`. Dev endpoints only when `DEMO_MODE=true` and `NODE_ENV!=='production'`. |
| D18 | **Low-end PC friendly:** floor screens are plain HTML/CSS. 3D twin stays Manager/Admin/Auditor only and lazy-loaded. |
| D19 | **SQLite rules:** `BEGIN IMMEDIATE` for every write transaction (use `db.transaction(fn).immediate()`); `busy_timeout = 5000`; lock ordering = always process location keys / bin ids in sorted order. |
| D20 | **Version columns** (`version INTEGER NOT NULL DEFAULT 0`) on `missions`, `floor_tasks`, `orders`, `inventory_adjustments`; claims use `UPDATE ... WHERE id=? AND version=?` and check `changes === 1`, else 409 `VERSION_CONFLICT`. |
| D21 | **Reason codes** are mandatory on: exception resolve, adjustment request/approve/reject, order cancel, force-unassign, bin freeze/unfreeze. Allowed values in REF-5b. `OTHER` requires a note of 10+ characters. |
| D22 | **Four-eyes:** approver id must differ from requester id (`SELF_APPROVAL_FORBIDDEN`). Adjustment value >= `adjust.admin_threshold_inr` needs Manager then Admin approval. |
| D23 | **Counts are blind.** Counter never sees system qty. If variance exceeds `count.recount_variance_pct`, a second count by a different operator is created automatically. Two matching counts produce the adjustment request. |
| D24 | **Freeze is pick-only.** A frozen bin (`pick_frozen=1`) is excluded from allocation and picking. It is unfrozen only by exception resolution. Every freeze auto-creates a COUNT floor task with an SLA timer; unresolved after `exception.escalate_min` minutes escalates to ADMIN. |
| D25 | **Tote lifecycle:** FREE -> IN_USE (first tote scan of a mission) -> AWAITING_PACK (mission picked) -> PACKING -> FREE (pack complete). Tote codes `TOTE-001..TOTE-030` seeded. |
| D26 | **No money in picker/packer/operator DTOs** except what a REF explicitly lists. |

---

# PART D: GLOBAL CONVENTIONS

## D.1 Migrations
- Location: `migrations/warehouse/NNN_name.sql`. Planned numbers are below; if a number is taken, use the next free one.
- SQLite limits: `ALTER TABLE ... ADD COLUMN` cannot add `NOT NULL` without a default, cannot add `UNIQUE` or `PRIMARY KEY`. CHECK on a new column is allowed. Use `CREATE UNIQUE INDEX` for uniqueness.
- **Changing an existing CHECK constraint requires a table rebuild.** Use this exact recipe (needed for `users` and `orders`):
  1. `PRAGMA foreign_keys=OFF;` (must be outside a transaction; if the migration runner wraps files in a transaction, do this from runner code before opening it).
  2. `BEGIN;`
  3. `CREATE TABLE x_new (...new definition...);`
  4. `INSERT INTO x_new (cols) SELECT cols FROM x;` (map old values if needed)
  5. `DROP TABLE x;` then `ALTER TABLE x_new RENAME TO x;`
  6. Recreate every index, trigger, and view that referenced `x` (list them first with `SELECT name, sql FROM sqlite_master WHERE tbl_name='x' OR sql LIKE '%x%'`).
  7. `PRAGMA foreign_key_check;` must return no rows.
  8. `COMMIT;` then `PRAGMA foreign_keys=ON;`
- Every migration must be idempotent-safe under the runner (`IF NOT EXISTS` for tables/indexes/triggers).

| Planned file | Phase | Content |
|---|---|---|
| `010_roles_users.sql` | P1 | rebuild `users` (7 roles, badge, pin, zones, shift) |
| `011_system_config.sql` | P1 | `system_config`, `job_runs`, seeds |
| `012_audit_chain.sql` | P3 | audit hash columns, `audit_head`, triggers, `order_events` |
| `013_products_ext.sql` | P4 | product attribute columns |
| `014_ledger.sql` | P4 | `lots`, `ledger_entries`, `location_balances`, triggers, opening backfill |
| `015_totes_missions.sql` | P5 | `totes`, mission/pick_stop columns, `floor_tasks` |
| `016_orders_rebuild.sql` | P6 | rebuild `orders` (adds PACKING, DISPATCHED, sla/time columns) |
| `017_packing_dispatch.sql` | P6 | `pack_sessions`, `pack_scans`, `dispatch_slots`, `dispatch_handovers` |
| `018_exceptions_adjustments.sql` | P7 | exception columns, bin freeze, `inventory_adjustments`, `count_results`, view rebuild |
| `019_inbound.sql` | P8 | `purchase_orders`, `po_lines`, receipt line columns, discrepancies |
| `020_replenish_reslot.sql` | P9 | `bins.zone_role`, min/max, `reslot_runs` |
| `021_floor_ux.sql` | P12 | `devices`, user PIN fields if not in 010 |
| `022_reports.sql` | P11 | `shift_notes` |

## D.2 API conventions
- Error body (always): `{ "error": "human message", "code": "UPPER_SNAKE_CODE", "details"?: any }`. Existing `{error}` bodies stay valid; add `code` as you touch them. Codes: REF-5.
- Status codes: 400 bad input, 401 no/expired token, 403 permission, 404 missing, 409 state/version conflict or duplicate, 410 removed endpoint, 422 scan mismatch or business-rule violation, 429 rate limit.
- All mutating routes: `authMiddleware -> requirePerm('x:y') -> idempotency -> handler` where the handler runs one `BEGIN IMMEDIATE` transaction that writes: (a) the row(s), (b) `outbox_events` row, (c) `order_events` row when an order is involved, (d) audit row via `appendAudit` (Phase 3). All in the **same transaction**.
- Actor identity: handlers receive `actor = { id, username, role, permissions }`. Phase 1 standardises gateway -> Engine 3 as headers `x-actor-id`, `x-actor-role` (Engine 3 loads permissions from `ROLE_PERMISSIONS`; it never trusts a permissions header). Engine 3 also re-checks the permission (defence in depth).
- Timestamps: ISO-8601 UTC strings (`new Date().toISOString()`), stored as TEXT.

## D.3 Naming
- Permission strings `noun:verb` (REF-1). Event names `noun.verb` (REF-7). Refs: `MSN-`, `ORD-`, `RCV-`, `ADJ-`, `FT-`, `EXC-`, `PO-`, `RSL-`, totes `TOTE-001`. Use the existing `id_sequences` mechanism for new refs (Phase 0 confirms how it works; write a helper `nextRef(db, 'FT')` if none exists).
- File names: camelCase `.ts`, one responsibility per file.

## D.4 Testing convention
- Runner: `vitest` (add in P1 if missing). Tests in `tests/` at repo root: `tests/unit/*.test.ts`, `tests/integration/*.test.ts`.
- Integration tests use in-memory SQLite (`:memory:`) with all migrations applied via `tests/helpers/db.ts` created in P1. Integration tests call service functions directly where possible (faster, no HTTP).
- Each phase ends with at least the tests named in its CHECK list.

## D.5 Frontend conventions
- New pages in `apps/web/src/pages/`, floor-role components in `apps/web/src/features/floor/`.
- Data fetching: TanStack Query hooks in `apps/web/src/hooks/` (one file per domain). Mutations send a fresh UUID idempotency key per user action, reused on retry of the same action.
- Role gating: `<RequirePerm perm="x:y">` wrapper (P2) and `useCan('x:y')` hook. Sidebar items derive from permissions, never from role names.
- Before P12 scan feedback is a plain green/red banner; P12 adds beep and full-screen colour.

---

# PART E: REFERENCE SECTIONS (read only when a phase names them)

## REF-1 Roles and permissions
Roles (7): `ADMIN, MANAGER, OPERATOR, PICKER, STAFF, DISPATCH, AUDITOR`. `STAFF` = the packer.

Create `packages/shared/src/permissions.ts` with exactly this shape (add nothing without logging it):

```ts
export const ROLES = ['ADMIN','MANAGER','OPERATOR','PICKER','STAFF','DISPATCH','AUDITOR'] as const;
export type Role = typeof ROLES[number];

export const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  ADMIN: ['user:manage','device:manage','config:view','config:thresholds','lock:release',
          'adjust:approve_high','exception:view','exception:escalated','audit:view','audit:verify',
          'order:view','inventory:view','kpi:view','control:view','tote:manage','sim:run','floor:view_all'],
  MANAGER: ['config:view','config:weights','order:view','order:cancel','order:create','inventory:view',
          'mission:reassign','exception:view','exception:resolve','count:request','relocate:request',
          'adjust:approve','po:create','po:view','reslot:simulate','reslot:approve','dispatch:view',
          'dispatch:regen_otp','kpi:view','control:view','shift:note','audit:view','trace:view','sim:run',
          'floor:view_all','rtv:view'],
  OPERATOR: ['inbound:receive','putaway:execute','relocate:execute','count:execute','adjust:request',
          'damage:flag','exception:raise','floortask:claim','inventory:view','po:view','rtv:view'],
  PICKER: ['mission:claim','pick:execute','putback:execute','exception:raise','floortask:claim_pick'],
  STAFF: ['pack:execute','repick:request','exception:raise','dispatch:view'],
  DISPATCH: ['dispatch:handover','dispatch:view'],
  AUDITOR: ['audit:view','audit:verify','audit:export','order:view','inventory:view','kpi:view',
          'control:view','trace:view','exception:view','po:view','rtv:view','dispatch:view'],
};
export function can(user: { permissions?: readonly string[]; role?: Role }, perm: string): boolean
// implementation: use user.permissions if present, else ROLE_PERMISSIONS[user.role]
```

Matrix summary (use to sanity check; the code above is authoritative):

| Action | ADMIN | MANAGER | OPERATOR | PICKER | STAFF | DISPATCH | AUDITOR |
|---|---|---|---|---|---|---|---|
| Receive / putaway / count / relocate execute | no | no | yes | no | no | no | no |
| Pick, putback | no | no | no | yes | no | no | no |
| Pack, request repick | no | no | no | no | yes | no | no |
| Rider handover | no | no | no | no | no | yes | no |
| Raise exception | no | no | yes | yes | yes | no | no |
| Resolve exception, approve adjustment (low) | no | yes | no | no | no | no | no |
| Approve adjustment (high, second approval) | yes | no | no | no | no | no | no |
| Reassign mission, cancel order | no | yes | no | no | no | no | no |
| Allocator weights | no | yes | no | no | no | no | no |
| Thresholds, users, devices | yes | no | no | no | no | no | no |
| Audit verify/export | verify | no | no | no | no | no | yes |

## REF-2 State machines (data, in `packages/shared/src/stateMachine.ts`)

```ts
export type Machine = 'ORDER'|'MISSION'|'PICK_STOP'|'EXCEPTION'|'ADJUSTMENT'|'FLOOR_TASK';
export interface Transition { from: string; event: string; to: string; perms?: string[]; guard?: string }
export const TRANSITIONS: Record<Machine, Transition[]> = { /* tables below */ };
export function transition(machine: Machine, from: string, event: string):
  { to: string; perms?: string[]; guard?: string }   // throws StateError (code STATE_CONFLICT) if not allowed
export function allowedEvents(machine: Machine, from: string): string[]
```
`perms` = any one of these permissions lets the actor fire the event (system-fired events like lease expiry use perms omitted = SYSTEM). `guard` is a name of a check the caller must run (documentation + test target). Handlers call `transition()` first, then apply the returned `to` with a version-checked UPDATE.

**ORDER** (statuses; Phase 0 maps existing values onto these; keep any extra legacy status that RECON.md lists as in use and add its transitions):
| from | event | to | perms |
|---|---|---|---|
| PENDING | assign | ASSIGNED | SYSTEM |
| ASSIGNED | start_pick | PICKING | pick:execute |
| ASSIGNED | unassign | PENDING | mission:reassign / SYSTEM |
| PICKING | unassign | PENDING | mission:reassign / SYSTEM |
| PICKING | pick_complete | PICKED | pick:execute |
| PICKED | open_pack | PACKING | pack:execute |
| PACKING | pack_complete | PACKED | pack:execute |
| PACKING | repick | PICKING | repick:request |
| PACKED | handover | DISPATCHED | dispatch:handover |
| PENDING, ASSIGNED, PICKING, PICKED, PACKING, PACKED | cancel | CANCELLED | order:cancel |

**MISSION**: QUEUED -claim-> CLAIMED (mission:claim); CLAIMED -first_scan-> IN_PROGRESS (pick:execute); IN_PROGRESS -complete-> COMPLETED (pick:execute); CLAIMED|IN_PROGRESS -release-> QUEUED (SYSTEM lease expiry, or mission:claim for self-release); CLAIMED|IN_PROGRESS -force_unassign-> QUEUED (mission:reassign); QUEUED|CLAIMED|IN_PROGRESS -cancel-> CANCELLED (order:cancel). COMPLETED and CANCELLED are terminal.

**PICK_STOP**: PENDING -scan_bin-> BIN_OK; BIN_OK -scan_item-> ITEM_OK; ITEM_OK -scan_tote-> DONE (all need pick:execute); PENDING|BIN_OK|ITEM_OK -short-> SHORT (SYSTEM or pick:execute via exception); PENDING|BIN_OK|ITEM_OK -reroute-> CANCELLED (SYSTEM, a replacement stop is created); PENDING -cancel-> CANCELLED.

**EXCEPTION**: OPEN -request_count-> COUNT_REQUESTED (SYSTEM or count:request); COUNT_REQUESTED -count_done-> COUNT_SUBMITTED (SYSTEM); OPEN|COUNT_SUBMITTED -resolve-> RESOLVED (exception:resolve). Escalation is a flag (`escalated=1`), not a state.

**ADJUSTMENT**: PENDING_MANAGER -approve_low-> APPLIED (adjust:approve; guard `value<threshold`); PENDING_MANAGER -approve_high-> PENDING_ADMIN (adjust:approve; guard `value>=threshold`); PENDING_ADMIN -approve-> APPLIED (adjust:approve_high); PENDING_MANAGER|PENDING_ADMIN -reject-> REJECTED (adjust:approve or adjust:approve_high); PENDING_MANAGER -cancel-> CANCELLED (requester). Guard on every approve: `approver != requester` (and for the second approval, `admin != manager-approver`).

**FLOOR_TASK**: OPEN -claim-> CLAIMED (floortask:claim / floortask:claim_pick); CLAIMED -start-> IN_PROGRESS; CLAIMED|IN_PROGRESS -complete-> DONE; CLAIMED|IN_PROGRESS -release-> OPEN (SYSTEM lease expiry); OPEN|CLAIMED|IN_PROGRESS -cancel-> CANCELLED (SYSTEM or order:cancel or exception:resolve).
Floor task `type`: `COUNT, RELOCATE, REPLENISH, PUTBACK, REPICK, EXPIRY_REMOVE`. Which permission may claim which type: COUNT/RELOCATE/REPLENISH/EXPIRY_REMOVE -> `floortask:claim` (operators); PUTBACK/REPICK -> `floortask:claim_pick` (pickers).

## REF-3 Ledger model

Locations are strings (no locations table). `location_key` formats:
`EXT` (outside world: supplier or customer; may go negative), `STAGED:<rcvRef>`, `BIN:<binCode>`, `TOTE:<toteCode>`, `BENCH:<benchCode>`, `DISP:<slotCode>`, `SHIPPED`, `QUAR`, `LOST`.
Only `EXT` may hold a negative balance. All others are enforced `>= 0` by trigger (`NEGATIVE_BALANCE`).

`ledger_entries` (append-only; UPDATE/DELETE blocked by trigger `LEDGER_IMMUTABLE`):
`id INTEGER PK AUTOINCREMENT, entry_ref TEXT UNIQUE, ts TEXT, sku TEXT, lot_id TEXT, qty INTEGER CHECK(qty>0), from_loc TEXT, to_loc TEXT, entry_type TEXT, ref_type TEXT, ref_id TEXT, order_ref TEXT, actor_id TEXT, reason_code TEXT, note TEXT`.

Entry types: `OPENING, RECEIVE, RECEIVE_REJECT, PUTAWAY, PICK, PACK, STAGE_DISPATCH, HANDOVER, PUTBACK, RELOCATE, REPLENISH, QUARANTINE, QUARANTINE_RELEASE, WRITE_OFF, ADJUST_IN, ADJUST_OUT, RTV, EXPIRE`.

Standard movements (from -> to):
| Event | from | to | type |
|---|---|---|---|
| Receive good | EXT | STAGED:rcv | RECEIVE |
| Receive rejected/damaged at dock | EXT | QUAR | RECEIVE_REJECT |
| Putaway | STAGED:rcv | BIN:code | PUTAWAY |
| Pick | BIN | TOTE | PICK |
| Pack scan | TOTE | BENCH:b | PACK |
| Pack complete | BENCH | DISP:slot | STAGE_DISPATCH |
| Handover | DISP | SHIPPED | HANDOVER |
| Cancel put-back | TOTE | BIN | PUTBACK |
| Relocate / replenish | BIN | BIN | RELOCATE / REPLENISH |
| Damage flag | BIN | QUAR | QUARANTINE |
| Write-off approved | QUAR (or BIN) | LOST | WRITE_OFF |
| Reject write-off | QUAR | BIN | QUARANTINE_RELEASE |
| Count found stock | EXT | BIN | ADJUST_IN |
| Count missing stock | BIN | LOST | ADJUST_OUT |
| Return to vendor | QUAR | EXT | RTV |
| Expired removal | BIN | QUAR | EXPIRE |
| Pack-bench damaged item | TOTE | QUAR | QUARANTINE |
| Pack-bench missing (never arrived) | n/a: no movement; adjust path via exception | | |

`location_balances(location_key, sku, lot_id, qty, PRIMARY KEY(location_key, sku, lot_id))` is updated by an AFTER INSERT trigger on `ledger_entries` (subtract from `from_loc`, add to `to_loc`).

`postLedger(db, input)` in `services/engine3-inventory/src/ledger/postLedger.ts`:
```ts
export interface LedgerLine { sku: string; lotId: string; qty: number; from: string; to: string;
  type: EntryType; refType?: string; refId?: string; orderRef?: string; reasonCode?: string; note?: string }
export function postLedger(db: Database, lines: LedgerLine[], actor: { id: string }): LedgerEntry[]
```
Rules: (1) must be called inside an open write transaction (throw if `!db.inTransaction`); (2) validates qty is a positive integer; (3) collects all location keys, **sorts them**, and touches them in that order (lock ordering, D19); (4) inserts entries (the trigger updates balances and rejects negatives); (5) for every `BIN:` key it touched, updates the projection: `inventory` row for that bin (insert, update, or delete when qty reaches 0 following the behaviour recorded in RECON.md), `bins.current_qty`, and clears or sets `bins.current_sku`; (6) returns entries. It never opens its own transaction.

`reservations` stay as they are: a reservation is a claim on bin stock. Pick consumes the reservation (ledger PICK). Available-to-promise for a bin = bin qty minus open reservations (view `v_available_stock` already does this; P7 rebuilds it to exclude frozen bins).

## REF-4 Barcode formats and normalisation
Normalise every scan: `trim()`, uppercase. Server compares against these:
| Thing | Canonical | Also accepted |
|---|---|---|
| Bin | `<binCode>` as stored (e.g. `Z1-R02-B04`) | `BIN:<binCode>` |
| SKU | `products.barcode` (defaults to the SKU in P4) | the SKU itself |
| Tote | `TOTE-001` | |
| Pack bench | `BENCH-1` | |
| Dispatch slot | `D-4` | `DISP:D-4` |
| Receipt / ASN | `RCV-0001` | |
| Rider OTP | 4 digits, entered by DISPATCH, not scanned | |
Put these helpers in `packages/shared/src/barcodes.ts`: `normalizeScan(s)`, `matchesBin(scan, binCode)`, `matchesSku(scan, product)`, `matchesTote`, `matchesSlot`.

## REF-5 Error codes (use only these)
| Code | HTTP | Meaning |
|---|---|---|
| AUTH_REQUIRED, TOKEN_EXPIRED | 401 | no/expired token |
| FORBIDDEN | 403 | missing permission (details: `{required}`) |
| ENDPOINT_REMOVED | 410 | D11 endpoints |
| VALIDATION_FAILED | 400 | bad body/params |
| IDEMPOTENCY_KEY_REQUIRED | 400 | header missing on mutating call |
| NOT_FOUND | 404 | |
| STATE_CONFLICT | 409 | transition not allowed |
| VERSION_CONFLICT | 409 | optimistic lock lost |
| DUPLICATE | 409 | |
| MISSION_NOT_OWNED | 403 | mission belongs to another picker |
| MISSION_LEASE_EXPIRED | 409 | lease ran out; claim again |
| ACTIVE_MISSION_EXISTS | 409 | picker already holds max missions |
| NO_MISSION_AVAILABLE | 404 | queue empty |
| TOTE_IN_USE | 409 | |
| SCAN_WRONG_BIN, SCAN_WRONG_ITEM, SCAN_WRONG_TOTE, SCAN_OUT_OF_SEQUENCE, SCAN_QTY_EXCEEDS | 422 | scan checks |
| ORDER_NOT_PICKED | 409 | pack on non-PICKED order |
| PACK_ITEM_NOT_IN_ORDER, PACK_ITEM_OVERSCAN, PACK_INCOMPLETE, WEIGHT_MISMATCH, SLOT_MISMATCH | 422 | packing checks |
| OTP_INVALID | 422 | wrong OTP |
| OTP_LOCKED | 409 | too many attempts |
| SELF_APPROVAL_FORBIDDEN | 403 | approver = requester |
| ADJ_NEEDS_ADMIN | 403 | high-value needs admin second approval |
| REASON_REQUIRED | 400 | reason code/note missing |
| NEGATIVE_BALANCE | 422 | ledger would go below zero |
| LOT_MIX | 422 | D8 |
| BIN_LOCKED | 409 | bin in an active pick or maintenance |
| BIN_FROZEN | 409 | exception freeze |
| COUNTER_MUST_DIFFER | 409 | D23 |
| SHELF_LIFE_TOO_SHORT | 422 | inbound rule |
| PO_MISMATCH | 422 | receiving vs PO |
| ORDER_CANCEL_NEEDS_PUTBACK | 409 | before P10 only |
| DEVICE_NOT_ALLOWED | 403 | P12 |
| RATE_LIMITED | 429 | PIN login |
| LEDGER_IMMUTABLE, AUDIT_IMMUTABLE | (DB trigger message) | |
| INTERNAL_ERROR | 500 | |

## REF-5b Reason codes
`DAMAGED, EXPIRED, MISSING, FOUND, COUNT_VARIANCE, THEFT_SUSPECTED, MISPLACED, SUPPLIER_SHORT, CUSTOMER_CANCEL, STUCK_PICKER, OUT_OF_STOCK, BIN_FULL, BIN_BLOCKED, OTHER`. Put in `packages/shared/src/enums.ts` as `REASON_CODES` and validate with one helper `requireReason(code, note)`.

## REF-6 `system_config` keys (seed in 011; `group` WEIGHT is editable with `config:weights`, THRESHOLD with `config:thresholds`)
Table: `system_config(key TEXT PK, value TEXT NOT NULL, value_type TEXT CHECK(value_type IN('int','float','string','bool')), min_val REAL, max_val REAL, grp TEXT CHECK(grp IN('WEIGHT','THRESHOLD')), description TEXT, updated_by TEXT, updated_at TEXT)`.

| Key | Default | grp |
|---|---|---|
| lease.mission_seconds | 60 | THRESHOLD |
| lease.floor_task_seconds | 120 | THRESHOLD |
| exception.recount_sla_min | 15 | THRESHOLD |
| exception.escalate_min | 15 | THRESHOLD |
| exception.rate_flag_per_100_picks | 5 | THRESHOLD |
| adjust.admin_threshold_inr | 5000 | THRESHOLD |
| count.recount_variance_pct | 10 | THRESHOLD |
| count.require_second_counter | true | THRESHOLD |
| cycle.days.A / cycle.days.B / cycle.days.C | 7 / 30 / 90 | THRESHOLD |
| pack.weight_tolerance_pct | 8 | THRESHOLD |
| pack.bag_tare_g | 40 | THRESHOLD |
| dispatch.otp_max_attempts | 3 | THRESHOLD |
| inbound.min_shelf_life_pct | 50 | THRESHOLD |
| fefo.min_days_to_expiry_at_pick | 1 | THRESHOLD |
| expiry.markdown_days | 7 | THRESHOLD |
| pick.strategy | SINGLE (SINGLE or BATCH) | THRESHOLD |
| pick.batch_size | 3 | THRESHOLD |
| sla.promise_minutes | 10 | THRESHOLD |
| sla.pick_seconds_per_line | 45 | THRESHOLD |
| reslot.benefit_effort_ratio | 2.0 | THRESHOLD |
| device.binding_required | false | THRESHOLD |
| session.idle_minutes | 10 | THRESHOLD |
| alloc.w.velocity / zone / capacity / distance / weight_level / compat | 30 / 20 / 15 / 15 / 10 / 10 | WEIGHT |

Helper `getConfig(db, key)` (typed, cached 5 s, cache cleared on `PUT`). Endpoints (P1): `GET /api/config` (`config:view`), `PUT /api/config/:key` body `{value}` (perm by `grp`; validates type and min/max; audited).

## REF-7 Event names (outbox `event_type`, also `order_events.event`)
`order.created, order.assigned, order.unassigned, order.picking_started, order.picked, order.packing_opened, order.packed, order.dispatched, order.cancelled, mission.claimed, mission.released, mission.lease_expired, mission.force_unassigned, mission.completed, pick.bin_scanned, pick.item_scanned, pick.tote_scanned, pick.short, pick.rerouted, pack.item_scanned, pack.item_flagged, pack.weighed, pack.completed, dispatch.handover, dispatch.otp_failed, exception.raised, exception.count_requested, exception.count_submitted, exception.resolved, exception.escalated, bin.frozen, bin.unfrozen, adjustment.requested, adjustment.approved_manager, adjustment.applied, adjustment.rejected, floortask.created, floortask.claimed, floortask.done, receipt.started, receipt.completed, putaway.confirmed, relocate.done, replenish.created, po.created, po.closed, lot.expiring, lot.expired, config.changed, audit.verified`.
Outbox payload always includes `{ at, actorId, entityRef }` plus event-specific ids.

## REF-8 Picker/Packer/Operator DTOs (D15) in `packages/shared/src/dtos.ts` and mapper `services/engine3-inventory/src/dto/floorDtos.ts`
```ts
PickerStopDTO   = { stopRef, seq, binCode, aisleLabel, sku, productName, imageHint?, qtyToPick, step: 'SCAN_BIN'|'SCAN_ITEM'|'SCAN_TOTE'|'DONE'|'SHORT', toteCode?, orderRef }
PickerMissionDTO= { missionRef, status, leaseExpiresAt, toteCode|null, totalStops, doneStops, stops: PickerStopDTO[] }  // orderRef is shown as short code only
PackSessionDTO  = { sessionId, orderRef, toteCode, lines: { sku, productName, expectedQty, scannedQty, flaggedQty }[], weightExpectedG?, weightOk?, canComplete }
CountTaskDTO    = { taskRef, type:'COUNT', binCode, sku }          // NEVER systemQty
```
Forbidden fields in these DTOs: `currentQty, reservedQty, availableQty, customer*, address, phone, price*, otherOrders`. A unit test (`tests/unit/dto.test.ts`) serialises each DTO from rich sample rows and asserts none of those keys appear (deep key scan).

---

# PART F: PHASES

## PHASE 0: Recon and baseline (MUST)
Goal: learn the codebase, write facts down, prove the baseline runs. **No source changes in this phase** except new `.md` files and `scripts/smoke.ts` (or `.mjs`).

- **P0-T1 Tracking files.** Create at repo root: `PROGRESS.md` (a checklist of every task id P0-T1 .. P14-Tn, copied from `grep -n "^- \*\*P[0-9]*-T" PRD.md`), `RECON.md`, `BLOCKERS.md`, `DECISIONS_NEW.md` (empty with a header each).
- **P0-T2 Commands.** Read root `package.json` and each service `package.json`. In `RECON.md` section "Commands" record: install, typecheck, build, start-all, start-each, test commands. If no typecheck script exists, record `pnpm -r exec tsc --noEmit`.
- **P0-T3 Answer B.5.** For each bullet in Part B.5, find the answer in code (use `grep -rn`) and write it in `RECON.md` with file path and line number. Specifically: migration runner file; gateway->engine3 proxy file and actor passing; idempotency middleware file and header name; the code path that handles stock reaching zero; stop addressing; bcrypt package; test runner; order/mission/stop/exception/receipt status enums from migrations 001..009; shelf level column; Engine1 vs Engine3 mission assignment flow.
- **P0-T4 Route inventory.** Run `grep -rnE "router\.(get|post|put|patch|delete)|app\.(get|post|put|patch|delete)" services/ gateway/` and paste the result as table `Route | file | current guard` into `RECON.md` section "Routes". Mark each as `READ` or `MUTATE`.
- **P0-T5 Baseline run.** Install, build, start all four services and web. Log in with each existing seeded user. Write `scripts/smoke.ts` (plain Node, uses `fetch`, no deps) that: logs in, lists orders, fetches inventory, and exits non-zero on any non-2xx. Record how to run it in `RECON.md`. Back up `data/*.db` to `data/backup-baseline/`.
- **CHECK:** `RECON.md` has no "TODO" or "unknown" left; `node scripts/smoke.ts` (or the recorded command) exits 0; `git status` shows only new files.

---

## PHASE 1: Foundations (MUST)
Read: REF-1, REF-2, REF-4, REF-5, REF-5b, REF-6.

- **P1-T1 Test harness.** If no runner: `pnpm add -D -w vitest`. Add root script `"test": "vitest run"`. Create `tests/helpers/db.ts` exporting `makeTestDb()`: opens `:memory:`, sets `foreign_keys=ON`, applies every `migrations/warehouse/*.sql` in filename order using the same logic as the real runner (import the runner if it is a function; otherwise copy its loop), and returns the db. Also export `seedMinimal(db)` creating 1 product, 1 shelf, 3 bins, and one user per role (after P1-T3 exists; for now leave users to P1-T3).
- **P1-T2 Migration 010 `users` rebuild.** Use the Part D.1 rebuild recipe. New role CHECK: the 7 roles from REF-1. Add columns `badge_id TEXT`, `pin_hash TEXT`, `zones TEXT NOT NULL DEFAULT '[]'` (JSON array of zone codes), `shift TEXT NOT NULL DEFAULT 'MORNING' CHECK(shift IN('MORNING','EVENING','NIGHT'))`, `active INTEGER NOT NULL DEFAULT 1`, `failed_pin_attempts INTEGER NOT NULL DEFAULT 0`, `locked_until TEXT`. Add `CREATE UNIQUE INDEX IF NOT EXISTS ux_users_badge ON users(badge_id) WHERE badge_id IS NOT NULL`. Copy every existing user row unchanged. Recreate every FK or index that pointed at `users`.
- **P1-T3 Seed users** (idempotent code in the existing seed script, not in SQL, because it needs bcrypt): ensure these exist (username / role / password `demo1234` / badge / pin `1111`...): `admin`/ADMIN, `manager`/MANAGER, `operator1`/OPERATOR, `operator2`/OPERATOR, `picker1`..`picker3`/PICKER, `packer1`/STAFF, `dispatch1`/DISPATCH, `auditor1`/AUDITOR. Keep existing seeded users working. Set `zones` for pickers (`["Z1"]`, `["Z1","Z2"]`, `["Z2"]` or matching your real zone codes from RECON).
- **P1-T4 Migration 011.** Create `system_config` (REF-6 schema) and `job_runs(id INTEGER PK AUTOINCREMENT, job TEXT, started_at TEXT, finished_at TEXT, status TEXT CHECK(status IN('OK','ERROR')), detail TEXT)`. Seed all REF-6 keys with `INSERT OR IGNORE`, including `value_type`, sensible `min_val/max_val`, `grp`, `description`.
- **P1-T5 Shared lib.** In `packages/shared/src/` create `permissions.ts` (REF-1 exactly), `stateMachine.ts` (REF-2 tables as data plus `transition`, `allowedEvents`, class `StateError`), `barcodes.ts` (REF-4), `errors.ts` (class `AppError(code, status, message, details?)` plus a map of REF-5 codes to default HTTP status), extend `enums.ts` with `ROLES`, `REASON_CODES`. Export all from `index.ts`. Rebuild the package.
- **P1-T6 Engine 3 plumbing.** (a) Middleware `actorFromHeaders` reading `x-actor-id`, `x-actor-role`; it loads the user row, rejects inactive users (`FORBIDDEN`), attaches `req.actor = { id, username, role, permissions }`. (b) `requirePerm(perm)` that throws `AppError('FORBIDDEN',403,...,{required:perm})`. (c) Central error handler converting `AppError` and `StateError` to the D.2 body. (d) `getConfig/setConfig` helper and routes `GET /api/config`, `PUT /api/config/:key` with audit. (e) `nextRef(db, prefix)` if none exists. (f) A `runInTx(db, fn)` helper that does `db.transaction(fn).immediate()` and is the ONLY way new write handlers open a transaction.
- **P1-T7 Gateway plumbing.** Login (`POST /api/auth/login`) and `GET /api/auth/me` return `{ user: {id, username, role}, permissions: string[] }`. Gateway forwards `x-actor-id`, `x-actor-role` to Engine 3 on every proxied call (keep existing mechanism too if the old code uses it; Phase 0 told you). Add gateway `requirePerm` (same logic, from shared). JWT payload gains nothing secret.
- **P1-T8 Unit tests.** `tests/unit/permissions.test.ts`: for each role, `can()` true for 3 listed perms and false for 3 unlisted perms; MANAGER has none of `pick:execute, pack:execute, inbound:receive, putaway:execute, count:execute, relocate:execute, dispatch:handover`. `tests/unit/stateMachine.test.ts`: every row of every REF-2 table is allowed; a sample of 10 illegal transitions throw `StateError`; no transition leaves a terminal state.
- **CHECK:** `pnpm test` green; typecheck green; all services start; login returns `permissions`; `GET /api/config` returns 20+ keys; smoke script still passes.

---

## PHASE 2: RBAC enforcement and removal of Manager execution powers (MUST)
Read: REF-1, REF-5. Uses the `P2-ROUTES` mapping below plus `RECON.md` route inventory.

**P2-ROUTES mapping rules** (apply to every route in RECON.md; where a route does not fit, log in `DECISIONS_NEW.md`):
| Route family (by what it does) | Permission |
|---|---|
| read orders, order detail, order list | `order:view` |
| read inventory, bins, shelves, movements, products list | `inventory:view` |
| read missions/pick stops list for staff screens | `order:view` or own-mission check (picker) |
| receive stock / create receipt line | `inbound:receive` |
| putaway suggest/confirm | `putaway:execute` |
| relocate/move stock | `relocate:execute` (request side `relocate:request`) |
| recount, cycle count | removed (D11) now; replaced in P7 by `count:execute` |
| mark picked / confirm pick stop | removed (D11); P5 replaces |
| pack order | removed (D11); P6 replaces |
| resolve pick exception | `exception:resolve` |
| create/cancel order | `order:create` / `order:cancel` |
| user admin | `user:manage` |
| optimizer/allocator weight config | `config:weights` |
| 3D twin / layout read | `inventory:view` |
| audit log read | `audit:view` |

- **P2-T1 Guard the gateway.** Add `requirePerm` to every route in the mapping, GET routes included. Authentication (valid JWT) is required on everything except login and health. Write `tests/integration/rbac.test.ts` using supertest-free approach: build a table `[method, path, allowedRoles[]]` from the mapping and assert each role gets 200/2xx (or 404/400 for dummy ids, but never 403) when allowed and 403 when not. (If HTTP booting is heavy, test the `requirePerm` + `ROLE_PERMISSIONS` pair against the table.)
- **P2-T2 Remove Manager powers and D11 endpoints.** Delete handlers for the five D11 endpoints and replace each route with `410 { error:'Endpoint removed', code:'ENDPOINT_REMOVED', details:{replacement:'<path or phase>'} }`. Remove Manager from every execute guard. Keep Manager's ability to create/cancel orders and resolve exceptions.
- **P2-T3 Web permissions layer.** Store `permissions` from login in the auth store (Zustand). Create `useCan(perm)`, `<RequirePerm perm>` (renders a "Not allowed" page, never a blank screen), and make the router wrap every route in `RequirePerm`. Sidebar items filter by `useCan`. Route -> perm: use the mapping above. Role home redirects after login: PICKER -> `/floor/pick`, STAFF -> `/floor/pack`, OPERATOR -> `/floor/operator`, DISPATCH -> `/floor/dispatch`, AUDITOR -> `/audit`, MANAGER/ADMIN -> `/` (these target pages arrive in P5/P6/P7/P12; until then redirect to `/` and keep a TODO in `PROGRESS.md`).
- **P2-T4 Remove buttons the Manager must not see.** Search the web app for UI that calls removed endpoints or execute endpoints (`grep -rn "pack\|confirm\|recount\|assign" apps/web/src`). Hide behind `useCan(...)` or remove. No dead buttons that return 410.
- **P2-T5 Role switcher.** Remove all plaintext passwords from the web bundle (`grep -rn "password" apps/web/src` must show none besides form field names). If a role switcher is useful for demo: show it only if `import.meta.env.VITE_DEMO_MODE==='true'`, and implement via gateway `POST /api/auth/dev-switch {username}` which exists only when `DEMO_MODE=true && NODE_ENV!=='production'` and returns a normal token. Add both env vars to `.env.example`.
- **CHECK:** rbac test green; manager token on each removed/execute endpoint yields 403 or 410; web builds; searching the built bundle for `demo1234` finds nothing (`grep -r demo1234 apps/web/dist` empty); smoke script updated to log in as `manager` and still pass.

---

## PHASE 3: Hash-chained audit log and order events (MUST)
Read: REF-7. Existing `audit_log` columns: look at its migration first.

- **P3-T1 Migration 012.**
  - `ALTER TABLE audit_log ADD COLUMN seq INTEGER; ADD COLUMN prev_hash TEXT; ADD COLUMN row_hash TEXT;` (separate statements) and `CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_seq ON audit_log(seq)`.
  - `audit_head(id INTEGER PRIMARY KEY CHECK(id=1), last_seq INTEGER NOT NULL, last_hash TEXT NOT NULL)` seeded with `(1, 0, 'GENESIS')`.
  - Trigger `trg_audit_no_update BEFORE UPDATE ON audit_log WHEN OLD.row_hash IS NOT NULL BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;` and `trg_audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;`.
  - `order_events(id INTEGER PK AUTOINCREMENT, order_ref TEXT NOT NULL, event TEXT NOT NULL, actor_id TEXT, actor_role TEXT, payload TEXT, at TEXT NOT NULL)`; index on `(order_ref, id)`. Same two immutability triggers.
- **P3-T2 `appendAudit`.** File `services/engine3-inventory/src/audit/appendAudit.ts`. Signature `appendAudit(db, { actor, action, entityType, entityRef, before?, after?, reasonCode?, note?, ip? })`. Must run inside a transaction. Steps: read `audit_head`; `seq = last_seq+1`; build a canonical string = `JSON.stringify` of an object with **keys in sorted order** containing all row fields (including `seq`, `ts`); `row_hash = sha256(prev_hash + canonical)` (Node `crypto`); insert row with `seq, prev_hash, row_hash`; update `audit_head`. If the existing `audit_log` has its own column names, map to them; extra data goes in the existing JSON/text column or a new nullable `detail` column.
- **P3-T3 Backfill.** Function `ensureAuditChain(db)` called at Engine 3 startup: for rows with `row_hash IS NULL` in id order, compute and fill hashes (allowed by the trigger's WHEN clause), then set `audit_head`. Idempotent.
- **P3-T4 Replace old audit writes.** `grep -rn "INSERT INTO audit_log" services/` ; every hit becomes `appendAudit(...)`. Add `appendOrderEvent(db, { orderRef, event, actor, payload })`; call it wherever order status changes today (find with `grep -rn "UPDATE orders"`).
- **P3-T5 Endpoints.** `GET /api/audit?entityType&entityRef&limit&cursor` (`audit:view`), `GET /api/audit/verify` (`audit:verify`): re-walks the chain from seq 1 and returns `{ ok, checked, brokenAtSeq|null, head }`; also appends an audit row `audit.verified`. `GET /api/audit/export?from&to` (`audit:export`) streams CSV. `GET /api/orders/:ref/events` (`order:view`).
- **P3-T6 Web.** Page `/audit` (perm `audit:view`): table, filter box, "Verify integrity" button (perm `audit:verify`) showing a green "Chain intact: N rows" or a red "Broken at seq N". "Export CSV" button (perm `audit:export`).
- **P3-T7 Tests.** `tests/integration/auditChain.test.ts`: append 50 rows, verify ok; open the db and run raw `UPDATE audit_log SET note='x' WHERE seq=10` -> must throw `AUDIT_IMMUTABLE`; drop the trigger inside the test, tamper, verify returns `brokenAtSeq=10`.
- **CHECK:** tests green; `curl /api/audit/verify` returns `ok:true` on the live db after a few actions; typecheck and smoke green.

---

## PHASE 4: Append-only stock ledger (MUST)
Read: REF-3, REF-4. This is the riskiest phase: go slowly, one flow at a time. Take a DB backup first.

- **P4-T1 Migration 013 product attributes.** `ALTER TABLE products ADD COLUMN` (each separately): `barcode TEXT`, `weight_g INTEGER DEFAULT 0`, `volume_cc INTEGER DEFAULT 0`, `fragile INTEGER NOT NULL DEFAULT 0`, `temp_zone TEXT NOT NULL DEFAULT 'AMBIENT' CHECK(temp_zone IN('AMBIENT','CHILLED','FROZEN'))`, `abc_class TEXT NOT NULL DEFAULT 'C' CHECK(abc_class IN('A','B','C'))`, `shelf_life_days INTEGER`, `price_paise INTEGER NOT NULL DEFAULT 0`, `compat_group TEXT`. Then `UPDATE products SET barcode = sku WHERE barcode IS NULL;` and a unique index on `barcode`. Seed realistic `weight_g` and `price_paise` for existing demo products in the seed script.
- **P4-T2 Migration 014 ledger.** Tables per REF-3: `lots(lot_id TEXT PK, sku TEXT NOT NULL REFERENCES products(sku)... (use real products PK column), lot_code TEXT, mfg_date TEXT, expiry_date TEXT, po_ref TEXT, supplier TEXT, received_at TEXT)`; `ledger_entries`; `location_balances`. CHECK constraints on `from_loc`/`to_loc` via `GLOB` (must start with one of the REF-3 prefixes or equal `EXT/SHIPPED/QUAR/LOST`); `from_loc <> to_loc`. Triggers: `trg_ledger_no_update`, `trg_ledger_no_delete` (ABORT 'LEDGER_IMMUTABLE'); `trg_ledger_balance AFTER INSERT` (upsert `to_loc` +qty, `from_loc` -qty); `trg_ledger_nonneg AFTER INSERT` raising ABORT 'NEGATIVE_BALANCE' when a non-EXT balance < 0 (SQLite triggers cannot reference the other trigger's work reliably, so write the balance upserts and the check in one trigger body with `SELECT RAISE(ABORT,'NEGATIVE_BALANCE') WHERE (SELECT qty FROM location_balances WHERE ...) < 0`). Add `ALTER TABLE inventory ADD COLUMN lot_id TEXT`.
- **P4-T3 Opening backfill (code, not SQL).** Function `backfillOpeningLedger(db)` run at Engine 3 start, once (guard with a row in `job_runs` or a `meta` check): for each `inventory` row with qty>0 create lot `LOT-LEGACY-<sku>` (expiry null) if absent, set `inventory.lot_id`, and post `OPENING` `EXT -> BIN:<code>`. Do the same for any stock currently in a "staged/received not putaway" state (RECON.md says where it lives) as `EXT -> STAGED:<rcvRef>`. The backfill must **bypass** the projection update in `postLedger` (projection already correct) via an option `{ projection: false }` used only here.
- **P4-T4 `postLedger`.** Implement exactly per REF-3. Unit tests first (`tests/unit/postLedger.test.ts`): move 5 units EXT->BIN then BIN->TOTE ok; moving more than present throws `NEGATIVE_BALANCE`; projection `inventory`/`bins.current_qty` equals ledger sum after each op; calling outside a transaction throws; entries cannot be updated or deleted.
- **P4-T5 Rewire existing flows one at a time.** For each of: receive, putaway, relocate, (any pick/pack/ship code still alive), and any code that writes `inventory` or `bins.current_qty`: replace the direct writes with `postLedger` lines per the REF-3 movement table. Keep old `stock_movements` writes (they remain a human-readable view) but derive them from the same function call. After each flow, run `node scripts/smoke.ts` and the reconcile check (T6). Existing legacy shortcut flows removed in P2 (pick confirm, pack, recount) need no rewiring.
- **P4-T6 Reconcile + ledger read.** `GET /api/ledger?sku&location&orderRef&limit` (`inventory:view`), and `GET /api/ledger/reconcile` (`inventory:view`): returns `{ ok, mismatches: [{binCode, sku, projectionQty, ledgerQty}] }` comparing `inventory`/`bins` to `location_balances` for all `BIN:` keys. Call it in tests after every integration scenario.
- **P4-T7 Guard test.** `tests/unit/noDirectStockWrites.test.ts`: reads all `.ts` files under `services/engine3-inventory/src` except `ledger/postLedger.ts` and `ledger/backfill*.ts` and fails if any contains `UPDATE inventory`, `INSERT INTO inventory`, `DELETE FROM inventory`, or `current_qty =` in SQL text.
- **P4-T8 Property test.** `tests/unit/ledgerProperty.test.ts`: 200 random valid movements across 5 bins/2 SKUs; after each, assert no negative non-EXT balance and `sum over all locations = 0` per (sku, lot).
- **CHECK:** all tests green; reconcile returns `ok:true` on the live db after: receive -> putaway -> relocate; smoke green; `grep` guard test green.

---

## PHASE 5: Totes, claim, leases, floor tasks, 3-step picking (MUST)
Read: REF-2 (MISSION, PICK_STOP, FLOOR_TASK), REF-3, REF-4, REF-8, REF-5.

- **P5-T1 Migration 015.**
  - `totes(tote_code TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'FREE' CHECK(status IN('FREE','IN_USE','AWAITING_PACK','PACKING','QUARANTINED')), mission_ref TEXT, order_ref TEXT, updated_at TEXT)`; seed `TOTE-001..TOTE-030` (`INSERT OR IGNORE`).
  - `ALTER TABLE missions ADD COLUMN`: `assigned_to TEXT`, `claimed_at TEXT`, `lease_expires_at TEXT`, `last_heartbeat_at TEXT`, `tote_code TEXT`, `priority INTEGER NOT NULL DEFAULT 0`, `sla_due_at TEXT`, `version INTEGER NOT NULL DEFAULT 0`, `batch_id TEXT`.
  - `ALTER TABLE pick_stops ADD COLUMN`: `step TEXT NOT NULL DEFAULT 'PENDING'`, `bin_scanned_at TEXT`, `item_scanned_at TEXT`, `tote_scanned_at TEXT`, `qty_picked INTEGER NOT NULL DEFAULT 0`, `lot_id TEXT`, `version INTEGER NOT NULL DEFAULT 0`. Map existing statuses to `step` per RECON.md (completed -> DONE, others PENDING).
  - `floor_tasks(id INTEGER PK AUTOINCREMENT, task_ref TEXT UNIQUE, type TEXT CHECK(type IN('COUNT','RELOCATE','REPLENISH','PUTBACK','REPICK','EXPIRY_REMOVE')), status TEXT NOT NULL DEFAULT 'OPEN', bin_code TEXT, dest_bin_code TEXT, sku TEXT, lot_id TEXT, qty INTEGER, order_ref TEXT, source_ref TEXT, priority INTEGER NOT NULL DEFAULT 0, due_at TEXT, assigned_to TEXT, lease_expires_at TEXT, payload TEXT, created_by TEXT, created_at TEXT, completed_at TEXT, version INTEGER NOT NULL DEFAULT 0)` with indexes on `(status, priority)` and `(type, status)`.
- **P5-T2 Claim next mission.** `POST /api/missions/claim-next` (`mission:claim`). In one `runInTx`: reject if picker already holds `max` active missions (1; `ACTIVE_MISSION_EXISTS`); select the top QUEUED mission ordered by `priority DESC, sla_due_at ASC, created_at ASC` that matches one of the user's zones (empty zones = all); `transition('MISSION','QUEUED','claim')`; `UPDATE missions SET status='CLAIMED', assigned_to=?, claimed_at=now, lease_expires_at=now+lease.mission_seconds, last_heartbeat_at=now, version=version+1 WHERE id=? AND version=? AND status='QUEUED'`; if `changes!==1` retry once with the next candidate, else `NO_MISSION_AVAILABLE`. Also transition the order ASSIGNED and write audit, outbox, order_event `mission.claimed`. If Engine 1 currently owns assignment (RECON.md), call its lock acquisition inside the same flow and store the fencing token on the mission; if Engine 1 is unreachable, fail with 503-style `INTERNAL_ERROR`, never claim silently.
- **P5-T3 Heartbeat, release, force-unassign.** `POST /api/missions/:ref/heartbeat` (owner only, extends lease), `POST /api/missions/:ref/release` (owner; keeps scanned progress), `POST /api/missions/:ref/force-unassign` (`mission:reassign`, body `{reasonCode, note}`; audit). All set status back to QUEUED, clear `assigned_to` and lease, keep `tote_code` and completed stops. A different picker resuming a mission with a tote must scan that same tote at the next tote step (tote code kept on the mission).
- **P5-T4 Lease sweep job.** `src/jobs/leaseSweep.ts`, `setInterval` every 15 s (start in the service bootstrap, one registry file `src/jobs/index.ts` that all later jobs register in, each run logged into `job_runs`). Releases missions and floor tasks whose `lease_expires_at < now` via the same code as release (event `mission.lease_expired`).
- **P5-T5 Picker read endpoint.** `GET /api/picker/mission` (`pick:execute`): returns `PickerMissionDTO` (REF-8) for the caller's active mission, stops sorted by `seq` (serpentine order from Engine 2, already stored in `pick_stops`; do not recompute). 404 `NO_MISSION_AVAILABLE` when none. The mapper in `dto/floorDtos.ts` is the only code that builds this DTO.
- **P5-T6 Scan endpoints.** `POST /api/pick-stops/:stopRef/scan-bin {scan}`, `/scan-item {scan, qty}`, `/scan-tote {scan}`; all `pick:execute`, idempotent, owner-checked (`MISSION_NOT_OWNED`), lease-checked (`MISSION_LEASE_EXPIRED`; a successful scan also extends the lease). Rules:
  1. The stop must be the **first non-DONE stop** in `seq` order, else `SCAN_OUT_OF_SEQUENCE`.
  2. scan-bin: step must be PENDING; `matchesBin` else `SCAN_WRONG_BIN`; set BIN_OK. First scan of the mission also fires `first_scan` (CLAIMED -> IN_PROGRESS) and order `start_pick` (-> PICKING).
  3. scan-item: step must be BIN_OK; `matchesSku` else `SCAN_WRONG_ITEM`; `qty` integer 1..remaining else `SCAN_QTY_EXCEEDS`; sets `qty_picked`, ITEM_OK.
  4. scan-tote: step must be ITEM_OK. If the mission has no tote: tote must be `FREE`, else `TOTE_IN_USE`; assign (`totes.status='IN_USE'`, `missions.tote_code`). If the mission has a tote: `matchesTote` else `SCAN_WRONG_TOTE`. Then, in the same transaction: `postLedger` PICK `BIN:code -> TOTE:code` (lot from the bin's inventory row) for `qty_picked`; mark the matching reservation consumed; stop DONE.
  5. When all stops are DONE or SHORT: mission COMPLETED, order `pick_complete` -> PICKED, tote -> AWAITING_PACK, event `order.picked`. If every stop is SHORT: order goes back to PENDING and an exception is created (P7 handles; before P7 just set mission COMPLETED and log).
  6. Wrong scans do **not** change state, but write an `order_events` row (`scan.rejected`) and audit with the code, so mistakes are measurable.
  Response always: `{ ok:true, step, mission: PickerMissionDTO }` or the D.2 error body.
- **P5-T7 Floor task endpoints (generic).** `GET /api/floor-tasks?status&type` (own or claimable, perm decides which types: REF-2), `POST /api/floor-tasks/:ref/claim` (version-checked; sets lease from `lease.floor_task_seconds`), `POST /api/floor-tasks/:ref/heartbeat`, `POST /api/floor-tasks/:ref/release`. Type-specific completion endpoints arrive in later phases. Create helper `createFloorTask(db, {...})` (writes outbox `floortask.created`, audit).
- **P5-T8 Web: picker screens (plain).** Route `/floor/pick` (perm `pick:execute`): big "Claim next order" button if no mission; else one stop at a time: shows aisle label, bin code, product name, qty, and a text input (autofocus, Enter submits) that sends the scan to the endpoint for the current step. Show a green or red banner with the server message. Heartbeat every 15 s while the screen is open. Do **not** show any quantity other than `qtyToPick`. Update the role redirect from P2-T3.
- **P5-T9 Tests.** `tests/integration/pickFlow.test.ts`: full happy path (claim, 3 scans per stop, mission COMPLETED, order PICKED, ledger has PICK entries, reconcile ok). Negative cases: wrong bin, wrong item, out-of-sequence stop, tote in use, other picker scanning. `tests/integration/claimRace.test.ts`: 20 pickers x 5 missions, all `claim-next` invoked in an interleaved loop (use `Promise.all` over service functions); assert each mission has exactly one owner and no picker holds two. `tests/integration/lease.test.ts`: set `lease_expires_at` in the past, run the sweep, mission returns to QUEUED with tote and done stops intact.
- **CHECK:** all tests green; manual: log in as `picker1`, claim, complete a mission with the keyboard only; `GET /api/ledger/reconcile` ok; manager token on `/api/pick-stops/*/scan-bin` returns 403.

---

## PHASE 6: Packing and dispatch (MUST)
Read: REF-2 (ORDER), REF-3, REF-4, REF-5, REF-8.

- **P6-T1 Migration 016 orders rebuild.** Use the rebuild recipe for `orders`. New status CHECK: `PENDING, ASSIGNED, PICKING, PICKED, PACKING, PACKED, DISPATCHED, CANCELLED` plus any other legacy status RECON.md says is used (map `PARTIALLY_FULFILLED` -> `PACKED`, and write `packing_records.fulfilment_type='PARTIAL'` for those orders in code or an UPDATE). Add columns: `promised_at TEXT`, `sla_due_at TEXT`, `picked_at TEXT`, `packed_at TEXT`, `dispatched_at TEXT`, `cancelled_reason TEXT`, `version INTEGER NOT NULL DEFAULT 0`. Preserve all rows, indexes, and triggers; re-run migration tests and `PRAGMA foreign_key_check`.
- **P6-T2 Migration 017.** `pack_sessions(id INTEGER PK AUTOINCREMENT, order_ref TEXT, tote_code TEXT, bench_code TEXT, opened_by TEXT, opened_at TEXT, completed_at TEXT, status TEXT CHECK(status IN('OPEN','COMPLETE','ABORTED')), weight_g INTEGER, expected_weight_g INTEGER, weight_ok INTEGER)`; `pack_scans(id INTEGER PK AUTOINCREMENT, session_id INTEGER, sku TEXT, qty INTEGER, kind TEXT CHECK(kind IN('SCANNED','MISSING','DAMAGED')), lot_id TEXT, at TEXT, actor_id TEXT)`; `dispatch_slots(slot_code TEXT PK, status TEXT CHECK(status IN('FREE','OCCUPIED')) DEFAULT 'FREE', order_ref TEXT)` seeded `D-1..D-8`; `dispatch_handovers(id INTEGER PK AUTOINCREMENT, order_ref TEXT UNIQUE, slot_code TEXT, otp_hash TEXT, otp_expires_at TEXT, attempts INTEGER DEFAULT 0, locked INTEGER DEFAULT 0, rider_name TEXT, handed_by TEXT, handed_at TEXT)`; extend `packing_records` with `fulfilment_type TEXT DEFAULT 'FULL' CHECK(fulfilment_type IN('FULL','PARTIAL'))`, `session_id INTEGER`.
- **P6-T3 Open pack session.** `POST /api/packing/open {toteScan}` (`pack:execute`). Find tote by scan; its status must be `AWAITING_PACK` and the order `PICKED` (`ORDER_NOT_PICKED`); create `pack_sessions` (bench from header `x-bench` or default `BENCH-1`); tote -> PACKING; order `open_pack` -> PACKING. If a session is already OPEN for that tote by the same user, return it. Another user -> `STATE_CONFLICT`. Response `PackSessionDTO`.
- **P6-T4 Item scans.** `GET /api/packing/sessions/:id` and `POST /api/packing/sessions/:id/scan-item {scan}`. Match SKU against the order's lines: not in order -> `PACK_ITEM_NOT_IN_ORDER`; already complete -> `PACK_ITEM_OVERSCAN`. Each valid scan: `pack_scans` row + `postLedger` PACK `TOTE -> BENCH:b` qty 1 (lot from the tote's balances for that SKU, lowest expiry first), event `pack.item_scanned`.
- **P6-T5 Flag item.** `POST /api/packing/sessions/:id/flag-item {sku, qty, kind:'MISSING'|'DAMAGED', note}` (`pack:execute` plus `repick:request`). DAMAGED: `postLedger` QUARANTINE `TOTE -> QUAR` and create an adjustment later (P7); MISSING: no ledger movement (stock never arrived). Both: `pack_scans` kind row, create a `REPICK` floor task (priority high, `order_ref`, `sku`, `qty`) claimable by pickers, event `pack.item_flagged`. If the Staff user chose to proceed without waiting, `complete` is allowed with PARTIAL (T6). Write an exception row of kind `PACK_MISSING` / `PACK_DAMAGED` if the table supports it after P7; before P7 only the event and floor task.
- **P6-T6 Weigh + complete.** `POST /api/packing/sessions/:id/weigh {grams}`: expected = sum(`products.weight_g` x scanned qty) + `pack.bag_tare_g`; ok if `abs(actual-expected)/expected*100 <= pack.weight_tolerance_pct`; else `WEIGHT_MISMATCH` (422) with `details:{expected, actual}` and `weight_ok=0`. Products with `weight_g=0` skip the check (`weight_ok=1`, note in response). `POST /api/packing/sessions/:id/complete {slotScan}`: require every line scanned+flagged == expected (`PACK_INCOMPLETE`), `weight_ok=1`, slot exists and FREE (`SLOT_MISMATCH` else). In one transaction: `postLedger` STAGE_DISPATCH `BENCH -> DISP:slot` for all scanned units; slot OCCUPIED; session COMPLETE; tote -> FREE (clear mission/order); order `pack_complete` -> PACKED; `packing_records` row with `fulfilment_type` FULL or PARTIAL (any flagged qty); generate OTP (4 digits via `crypto.randomInt`), store `sha256(otp + orderRef)` and 60-minute expiry in `dispatch_handovers`; event `pack.completed`. The OTP is **never** returned to Staff.
- **P6-T7 Dispatch.** `GET /api/dispatch/queue` (`dispatch:view`): PACKED orders with slot, packed time, SLA remaining (no customer address). `POST /api/dispatch/:orderRef/handover {slotScan, otp, riderName}` (`dispatch:handover`): slot must match (`SLOT_MISMATCH`); locked -> `OTP_LOCKED`; wrong OTP increments attempts, event `dispatch.otp_failed`, at `dispatch.otp_max_attempts` set `locked=1`; expired -> `OTP_INVALID`. On success: `postLedger` HANDOVER `DISP -> SHIPPED`; slot FREE; order `handover` -> DISPATCHED; `dispatched_at`. `POST /api/dispatch/:orderRef/regen-otp` (`dispatch:regen_otp`, reason code required): new OTP, unlock. DEMO_MODE only: `GET /api/dispatch/demo-otp/:orderRef` returns the plain OTP computed by regenerating and storing, available to MANAGER/ADMIN; this stands in for the customer app.
- **P6-T8 Web.** `/floor/pack` (perm `pack:execute`): scan tote -> shows expected lines with counters, scan input for items, "Flag missing/damaged" per line, weight input, slot scan input, "Complete" disabled until `canComplete`. `/floor/dispatch` (perm `dispatch:handover`): list of packed orders; select -> slot scan, OTP, rider name, confirm. Manager/Auditor see read-only `dispatch:view` list inside the existing orders page.
- **P6-T9 Tests.** `tests/integration/packFlow.test.ts`: pick -> open pack -> scan all -> weigh -> complete -> dispatch handover; ledger shows PICK, PACK, STAGE_DISPATCH, HANDOVER; reconcile ok; `SHIPPED` balance equals ordered qty. Negative: open pack on non-PICKED order; wrong item; overscan; complete with missing scans; weight mismatch; wrong OTP x3 -> locked; manager calling any packing endpoint -> 403. Partial path: flag one MISSING -> PACKED with `fulfilment_type='PARTIAL'`, REPICK floor task exists.
- **CHECK:** tests green; manual full flow picker1 -> packer1 -> dispatch1 in the browser; old pack endpoints return 410.

---

## PHASE 7: Exception loop, dual-control adjustments, quarantine, relocation (MUST)
Read: REF-2 (EXCEPTION, ADJUSTMENT), REF-3, REF-5, REF-5b, D21 to D24.

- **P7-T1 Migration 018.**
  - `ALTER TABLE bins ADD COLUMN pick_frozen INTEGER NOT NULL DEFAULT 0`, `frozen_reason TEXT`, `frozen_at TEXT`, `frozen_exception_ref TEXT`, `last_counted_at TEXT`.
  - `pick_exceptions` columns (add missing only; read its definition first): `exc_ref TEXT`, `kind TEXT` (`MISSING|DAMAGED|BIN_BLOCKED|PACK_MISSING|PACK_DAMAGED|COUNT_VARIANCE`), `status TEXT` (use REF-2 EXCEPTION states; migrate old values), `bin_code TEXT`, `sku TEXT`, `order_ref TEXT`, `raised_by TEXT`, `raised_at TEXT`, `escalated INTEGER DEFAULT 0`, `due_at TEXT`, `resolved_by TEXT`, `resolution TEXT`, `resolution_reason TEXT`, `resolved_at TEXT`, `count_task_ref TEXT`.
  - `inventory_adjustments(id INTEGER PK AUTOINCREMENT, adj_ref TEXT UNIQUE, kind TEXT CHECK(kind IN('COUNT_VARIANCE','DAMAGE_WRITE_OFF','EXPIRY_WRITE_OFF','RTV')), status TEXT NOT NULL DEFAULT 'PENDING_MANAGER', bin_code TEXT, sku TEXT, lot_id TEXT, delta_qty INTEGER NOT NULL, value_paise INTEGER NOT NULL DEFAULT 0, reason_code TEXT NOT NULL, note TEXT, requested_by TEXT NOT NULL, requested_at TEXT, manager_id TEXT, manager_at TEXT, admin_id TEXT, admin_at TEXT, reject_reason TEXT, source_ref TEXT, version INTEGER NOT NULL DEFAULT 0)`. `delta_qty` is negative for loss, positive for gain.
  - `count_results(id INTEGER PK AUTOINCREMENT, task_ref TEXT, bin_code TEXT, sku TEXT, counted_qty INTEGER, system_qty INTEGER, variance INTEGER, counted_by TEXT, counted_at TEXT, round INTEGER)`. `system_qty` is written server-side at count time and is never returned to the counter.
  - Rebuild view `v_available_stock` so it excludes bins with `pick_frozen=1` (read its current definition from `sqlite_master`, `DROP VIEW`, recreate with the added condition).
- **P7-T2 Picker raises exception.** `POST /api/pick-stops/:stopRef/report-exception {kind:'MISSING'|'DAMAGED'|'BIN_BLOCKED', note}` (`exception:raise`, owner of the mission). One transaction: (1) create exception `OPEN`; (2) freeze the bin: `pick_frozen=1`, `frozen_reason`, event `bin.frozen`; (3) **re-route**: find another bin with the same SKU, not frozen, not in another active pick, enough unreserved qty (`v_available_stock`), prefer earliest expiry (FEFO) then nearest by Engine 2 distance if cheap to call, else same zone first; if found: stop -> CANCELLED (`reroute`), create replacement stop with next `seq` inserted right after the current stop (renumber seqs after it), move the reservation to the new bin (reservation update through the existing reservation helper); if not found: stop -> SHORT, order line shortfall recorded for partial fulfilment; (4) create a COUNT floor task for the frozen bin (priority 90, `due_at = now + exception.recount_sla_min`), link `count_task_ref`; exception -> COUNT_REQUESTED; (5) outbox events `exception.raised`, `bin.frozen`, `pick.rerouted` or `pick.short`; audit + order_event. Response is the refreshed `PickerMissionDTO` so the picker's screen shows the new route.
- **P7-T3 Blind count.** `POST /api/floor-tasks/:ref/count {binScan, countedQty}` (`count:execute`, task must be a claimed COUNT owned by the caller). `binScan` must match the bin (`SCAN_WRONG_BIN`). Compute `system_qty` from `location_balances` (not from the projection). Insert `count_results` with `round` 1 or 2. Rules: variance 0 -> task DONE, bin `last_counted_at` set, linked exception -> COUNT_SUBMITTED. Variance != 0: if `abs(variance)/max(system_qty,1)*100 > count.recount_variance_pct` and this is round 1 -> create a second COUNT task (round 2, same bin) that cannot be claimed by the same user (`COUNTER_MUST_DIFFER`, enforced at claim when `count.require_second_counter`); else (round 2 matches round 1, or variance under threshold) -> create an adjustment request `COUNT_VARIANCE` with `delta_qty = counted - system`, `value_paise = abs(delta)*price_paise`, `requested_by = counter`, status `PENDING_MANAGER`. If round 2 differs from round 1, create a third task for a manager-chosen path: set the exception to `COUNT_SUBMITTED` with a note and let the Manager request a supervised recount. Response never contains `system_qty` or `variance` (D23, D15).
- **P7-T4 Adjustments API.** `POST /api/adjustments/request {binCode, sku, deltaQty, reasonCode, note}` (`adjust:request`, adds `kind` by reason: DAMAGED -> `DAMAGE_WRITE_OFF`, else `COUNT_VARIANCE`), `GET /api/adjustments?status` (`adjust:approve` or `adjust:approve_high` or `audit:view`), `POST /api/adjustments/:ref/approve {note}` and `/reject {reasonCode, note}` (perm: manager for `PENDING_MANAGER`, `adjust:approve_high` for `PENDING_ADMIN`). Logic on approve (single transaction): `SELF_APPROVAL_FORBIDDEN` if `actor.id == requested_by` (and admin != manager_id); if status `PENDING_MANAGER`: compute `high = value_paise >= adjust.admin_threshold_inr*100`; high -> status `PENDING_ADMIN`, store manager id, event `adjustment.approved_manager`; not high -> apply. Apply: negative delta -> `postLedger` `BIN -> LOST` (`ADJUST_OUT`) or, for damage write-off where stock is already in QUAR, `QUAR -> LOST` (`WRITE_OFF`); positive delta -> `EXT -> BIN` (`ADJUST_IN`; lot of the bin, or legacy lot); status `APPLIED`; unfreeze the linked bin if the adjustment came from an exception (resolution path below). On reject of a damage write-off: `QUAR -> BIN` (`QUARANTINE_RELEASE`). Use `transition('ADJUSTMENT', ...)` for every status change and version-checked updates.
- **P7-T5 Damage flag.** `POST /api/inventory/damage-flag {binCode, qty, note}` (`damage:flag`): `postLedger` `BIN -> QUAR` (`QUARANTINE`, qty <= unreserved bin qty else `NEGATIVE_BALANCE`/422) and create adjustment `DAMAGE_WRITE_OFF` (`reason_code='DAMAGED'`, `delta_qty=-qty`), requested by the operator. Quarantined stock is not available to allocation (it is not in a BIN).
- **P7-T6 Manager exception actions.** `GET /api/exceptions?status` (`exception:view`; includes age in minutes and `escalated`), `POST /api/exceptions/:ref/request-count {note}` (`count:request`, creates another COUNT task if none open), `POST /api/exceptions/:ref/resolve {reasonCode, note, unfreeze:boolean}` (`exception:resolve`): requires state `COUNT_SUBMITTED` (or `OPEN` with reason `OTHER`); requires no PENDING adjustment linked to the same bin (`STATE_CONFLICT`: "approve or reject the adjustment first"); then unfreeze (`bin.unfrozen`), exception RESOLVED. This mirrors Flow B: count 0 -> adjustment -> manager approves -> resolve unlocks the bin.
- **P7-T7 Escalation job.** `src/jobs/escalation.ts` every 60 s: exceptions not RESOLVED older than `exception.escalate_min` and `escalated=0` -> set `escalated=1`, event `exception.escalated` (visible to ADMIN with `exception:escalated`), audit. Also flag users whose exception count per 100 picks exceeds `exception.rate_flag_per_100_picks` (store in a view or computed endpoint `GET /api/exceptions/rates`, perm `exception:view`).
- **P7-T8 Relocation.** `POST /api/relocations/request {fromBin, toBin, sku, qty, reasonCode}` (`relocate:request`, creates floor task RELOCATE; refuses if `toBin` holds a different SKU or lot: `LOT_MIX`). `POST /api/floor-tasks/:ref/relocate {fromScan, itemScan, toScan}` (`relocate:execute`): validates the three scans, then one transaction `postLedger` `BIN -> BIN` (`RELOCATE`). Both bins sorted for locking (handled in `postLedger`). Putaway/relocate into a bin that is `pick_frozen=1` or part of an active pick stop (mission CLAIMED/IN_PROGRESS with a non-DONE stop on that bin) -> `BIN_LOCKED` (409). Add this check as one helper `assertBinFree(db, binCode)` used by putaway, relocate, replenish.
- **P7-T9 Cancel before pick.** `POST /api/orders/:ref/cancel {reasonCode, note}` (`order:cancel`): allowed in PENDING/ASSIGNED (release reservations, cancel mission, free tote if any); in PICKING/PICKED/PACKING/PACKED with stock already in totes or bench -> `ORDER_CANCEL_NEEDS_PUTBACK` until P10 provides put-back.
- **P7-T10 Web.** Manager: `/exceptions` queue (age, escalated badge, buttons: Request count, Resolve), `/adjustments` approvals (shows value, requester, status; Admin sees second-approval items). Operator: `/floor/operator` task list (claim COUNT/RELOCATE tasks; blind count form: bin scan + number). Picker: "Report problem" button on the stop screen (Missing / Damaged / Bin blocked) that refreshes the route.
- **P7-T11 Tests.** `tests/integration/exceptionLoop.test.ts`: full Flow B: picker reports MISSING; bin frozen; stop rerouted to second bin; COUNT task due set; operator counts 0 (blind); adjustment created PENDING_MANAGER; same user cannot approve (`SELF_APPROVAL_FORBIDDEN`); manager approves (low value) -> ledger `ADJUST_OUT`; resolve -> bin unfrozen; reconcile ok. `tests/integration/adjustments.test.ts`: high-value goes PENDING_ADMIN then admin approves; manager cannot do second approval; reject restores quarantine. `tests/integration/noReroute.test.ts`: no alternate bin -> stop SHORT, order partial. `tests/integration/escalation.test.ts`: age an exception, run job, `escalated=1`. `tests/integration/countBlind.test.ts`: response JSON has no `system`, `variance` keys; >10% variance spawns round 2 that the same user cannot claim.
- **CHECK:** tests green; the entire Flow B demonstrable via UI with 4 accounts; MANAGER cannot call `/count`, `/relocate`, `/scan-*`, `/packing/*`, `/dispatch/*/handover` (all 403).
