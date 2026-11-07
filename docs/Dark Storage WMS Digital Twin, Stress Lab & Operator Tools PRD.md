# Dark Storage WMS: Digital Twin, Stress Lab & Operator Tools PRD

*Version 1.0 · 6 Nov 2026 · Baseline: Phase 10 complete + Material 3 UI (`CURRENT_PROJECT_STATE_FOR_NEXT_PHASE.md`)*

## 0. Instructions to the implementing AI (read first)

1. Work **one phase at a time, in order**. Do not start phase N+1 until phase N's acceptance checklist passes and `npm test` is green (176 unit tests and the 9 e2e workflows must stay green).
2. Before coding a phase, open every file under its **Read first** list. Where this PRD says *verify*, the snapshot did not contain the file; read the repo instead of guessing.
3. **Never rename or remove an existing `data-testid`.** Mode 1 of `/warehouse` must render exactly as it does today (`shelf-card-*`, `bin-cell-*`, `warehouse-locate-input`). Existing jsdom contract tests have no canvas, so new heavy code must be lazy-loaded and guarded (`canvas.getContext` can be null in jsdom).
4. **No new runtime dependencies** unless a phase explicitly allows one. No three.js, react-three-fiber, GSAP, framer-motion or chart libraries.
5. Use the existing Material 3 CSS variables (`--bg-surface`, `--accent-primary`, `--border-color`, `--font-mono`, etc.). Canvas code reads them once with `getComputedStyle` and caches the values. Never hard-code colors.
6. TypeScript strict, no `any` in new code, no `localStorage` use for new features unless stated (the app uses `sessionStorage` for auth).
7. Log deviations in `docs/PRD_DEVIATIONS.md` and environment problems in `docs/BLOCKERS.md` (existing convention).
8. At the end of each phase, output: files changed, tests added, and the measured performance numbers requested in that phase. Do not claim a number you did not measure.

## 1. Ground truth (from the snapshot)

**Stack.** npm-workspaces monorepo. Web: React 18, Vite, React Router v6, TanStack Query v5, Zustand, plain CSS variables (Material 3 look). Ports: Engine 3 `4003`, Engine 2 `4002`, Engine 1 `4001`, Gateway `4000`, Web `5173`. Realtime is a WebSocket at `/ws?token=…&since=<seq>` on the gateway.

**Geometry (meters; `scripts/seed-base.ts`).**

- `DOCK` (0,0) and `PACK` (80,0). Aisles A,B,C,D at x = 10, 30, 50, 70.
- Cross nodes `XB-<A..D>` at y=0 and `XT-<A..D>` at y=50.
- Aisle nodes `N-<aisle>-<bay 01..06>` at y = 10 + (bay-1)×6 (so y = 10…40).
- **Total 34 nodes** (2 + 8 + 24) and **36 edges** (bottom chain 5, top chain 3, per aisle 7 × 4). Note: the snapshot's script table says "32 nav nodes"; the seed code creates 34. Treat 34 as correct.
- 48 shelves `<aisle>-<bay>-<L|R>`; **both L and R shelves share the same x,y as the aisle node**, so renderers must offset L to the −x side and R to the +x side of the aisle line.
- 4 bin levels per shelf (`…-1` to `…-4`), capacities 120/100/80/60 → 192 bins.
- HAZMAT = aisle D bays 1–2. `B-06-L` shelf is MAINTENANCE; `D-06-R-3` BLOCKED; `D-06-R-4` DAMAGED.

**Data contracts that already exist.**

- `GET /api/warehouse/layout` → `{ aisles: [{ aisle, shelves: [{ code, bay, side, status, storage_class, x, y, bins: [{ code, level, capacity, status, recount_required, sku, product_name, qty, reserved_qty }] }] }] }`. React Query key `['warehouse','layout']`.
- `GET /api/missions?status=&picker_id=&page=` (list; response shape: *verify*) and `GET /api/missions/:ref` → `route: { algorithm, total_distance, start, end, order, stops: [{ key, bin_code, node, seq }], legs: [{ from, to, distance, path: [nodeIds] }] }`, plus `stops[]` with `status` (`PENDING`…), `shelf_code`, `qty_required`, `qty_picked`, and `progress`.
- WebSocket frame: `{ type:'event', seq, event_type, entity_type, entity_id, data, created_at, replay? }`. Event catalogue: `order.created`, `order.status_changed`, `order.completed`, `mission.assigned|reassigned|started|completed`, `pick.confirmed` (`{stop_ref, mission_ref, picked_qty}`), `exception.opened|resolved`, `inventory.changed` (`{bins:[…]}`), `reservation.changed`.
- Orders: `createOrderSchema` = `{ order_type, priority, customer_ref?, notes?, lines:[{sku, qty}] }`; `cancelOrderSchema` = `{ reason }`. Gateway requires an `Idempotency-Key` header on mutating calls. Errors: `IDEMPOTENCY_KEY_REQUIRED` 400, `IDEMPOTENCY_KEY_REUSED` 422, `INSUFFICIENT_STOCK` 409.
- `npm run verify:integrity` runs 13 invariants (I01–I13) as a CLI script only.
- Roles: MANAGER, OPERATOR, PICKER, STAFF. Nav is role-gated in `AppShell.tsx`; `/admin` and `/tasks` are MANAGER-only.

**Not in the snapshot (verify in the repo before relying on them):** `AdminPage.tsx`, `api/client.ts` (`apiFetch` signature and how it attaches headers), `ProductLabel.tsx`, the CSS file with design tokens and `.fill-*` / `.status-*` classes, the gateway orders route and idempotency middleware, Engine 1's HTTP routes, the missions list response shape, the `MISSION_STATUSES` enum, and the inventory/receipts endpoints used for SKU and receipt pickers.

## 2. Goals, non-goals and performance contract

**Goals.** (1) A 3-mode `/warehouse` view: cards, 2D floorplan with live route overlay, and an isometric 3D digital twin. (2) A Concurrency & ACID Stress Lab on `/admin`. (3) A live event feed on the dashboard. (4) Printable barcode labels. (5) Keyboard shortcuts.

**Non-goals.** No WebGL, no 3D library, no changes to Engine business logic or DB schema. The only new backend surface is one read-only integrity endpoint (Phase 5). QR codes are a stretch goal only (Phase 7).

### 2.1 Key technical decision: Canvas 2D isometric, not CSS3D

Mode 3 is drawn on **one `<canvas>` with Canvas 2D and a hand-written projection**. Do **not** build it from hundreds of CSS-transformed `<div>`s: every 3D-transformed element becomes its own compositor layer, and 48 shelves × 4 bins × 3 faces is roughly 600 layers, which is exactly what stalls integrated GPUs. One canvas = one layer, and 192 boxes is only about 600 polygons, trivial for Canvas 2D even in software rendering.

**Projection.** World coordinates are (wx, wy, wz) in meters, yaw θ (user-rotatable), fixed elevation φ (default 35°, user-tiltable 20°–60°), zoom scale s:

- `u = wx·cosθ − wy·sinθ`, `v = wx·sinθ + wy·cosθ`
- `screenX = cx + u·s`, `screenY = cy + v·s·sinφ − wz·s·cosφ`
- Depth for the painter's algorithm = `v` (smaller v is farther; draw far to near).

The canvas has no shadows, no `shadowBlur`, no `filter`, no gradients per frame. "Glow" = the same path stroked twice (wide at low alpha, then thin at full alpha).

### 2.2 Performance contract (must be measured, not assumed)

Target hardware: a laptop with integrated graphics only (e.g. Intel UHD/Iris, AMD Vega iGPU), no discrete GPU.

| Metric | Requirement |
| --- | --- |
| Idle (Mode 3 visible, nothing moving) | **Zero** `requestAnimationFrame` callbacks; DevTools Performance shows no frames for 10 s |
| Drag-rotate / zoom, 192 bins | ≥ 50 fps; script+render time per frame ≤ 6 ms |
| Same, DevTools CPU throttle 4× | ≥ 30 fps |
| Worst case: Chrome launched with `--disable-gpu` (software raster) | ≥ 30 fps while interacting |
| Route animation | Capped at 30 fps, ≤ 3 ms per frame |
| Memory | No growth after 60 s of continuous rotation (zero allocations in the frame loop) |
| Bundle | Modes 2 and 3 are lazy chunks; main bundle grows ≤ 5 KB gzip; Mode 3 chunk ≤ 60 KB gzip |

Required techniques: render-on-demand with a `dirty` flag; a single rAF loop that stops itself when nothing is animating; canvas backing-store DPR capped at `min(devicePixelRatio, 1.5)`; precomputed world-space box vertices (no per-frame object creation, use typed arrays); pause when `document.hidden`; unmount fully when leaving Mode 3; respect `prefers-reduced-motion`; a **Quality** control (Auto / High / Low) where Auto measures a rolling 30-frame average and drops to Low if it exceeds 12 ms. Low = DPR 1, 30 fps cap, one block per shelf instead of four level boxes, no route glow.

## 3. Phases

### Phase 0: Recon, baseline and shared geometry

**Goal.** Establish a safe baseline and one source of truth for geometry and bin state colors.

**Read first.** `apps/web/src/pages/WarehousePage.tsx`, `apps/web/src/components/AppShell.tsx`, `apps/web/src/api/client.ts`, the CSS tokens file, `packages/shared/src/enums.ts`, `scripts/seed-base.ts`.

**Tasks.**

1. Run `npm test`, `npm run test:e2e`, `npm run build -w @dark-storage/web`; record the results.
2. Create `apps/web/src/lib/warehouseGeometry.ts` exporting constants and pure functions: `AISLE_X`, `NODES` (34, built from the same formulas as the seed), `EDGES` (36), `nodeXY(id)`, `shelfRect(shelf)` (L at −x, R at +x of the aisle line; shelf footprint default 1.6 m deep × 4 m along y, 1.4 m gap from the aisle line), `LEVEL_HEIGHT = 1.0` m.
3. Create `apps/web/src/lib/binVisual.ts` exporting `binVisualState(bin, shelfStatus)` returning one of `empty|low|med|high|full|blocked|damaged|maintenance|recount` using the same thresholds as `WarehousePage` (<25, <75, <100, 100 %) and the same precedence (BLOCKED, DAMAGED, MAINTENANCE, recount, then fill). Do **not** change Mode 1 output; just make Mode 1 optionally import it if it is a pure refactor.
4. Create `apps/web/src/lib/routeGeometry.ts`: `flattenRoute(route)` concatenates `legs[].path` and removes duplicated join nodes; returns `{ nodeIds, points, cumulativeDistance }` (distance from the leg `distance` values).

**Acceptance.**

- Unit tests: `NODES.length === 34`, `EDGES.length === 36`, `nodeXY('N-B-03')` is (30, 22), `nodeXY('XT-D')` is (70, 50), and every node ID appearing in the sample route JSON from §1 exists in `NODES`.
- `flattenRoute` on the sample route `DOCK→N-A-01→N-B-03→PACK` yields no consecutive duplicates and ends at `PACK`.
- All baseline tests still green.

### Phase 1: `/warehouse` view switcher shell

**Goal.** Three modes behind a switcher without disturbing Mode 1.

**Tasks.**

1. Add a segmented control at the top of `WarehousePage`: **Cards** (default), **Floorplan**, **3D Twin**. State lives in the URL (`?view=cards|map|3d`), not in storage. Add `?mission=<ref>` for the selected mission.
2. Modes 2 and 3 load with `React.lazy` + `Suspense` (fallback: a card saying "Loading view…"). Wrap them in an error boundary that shows a message and a "Back to Cards" button.
3. Extract a shared `useWarehouseLayout()` hook (same query key `['warehouse','layout']`) so all modes share one cache entry. Extract `useMissionRoute(ref)` using `GET /api/missions/:ref` (key `['missions', ref]`) and `useActiveMissions()` using the missions list endpoint (key `['missions']`; both already invalidated by existing WebSocket events).
4. Build `MissionRouteSelector` (a `<select>`): "No route" plus active missions (label `MIS-0001 · ORD-0001 · Picker · ASSIGNED`). Role rules are enforced by the backend (a picker sees only their missions); handle an empty list gracefully.
5. Add a small "View route on map" link on `MissionDetailPage` pointing to `/warehouse?view=map&mission=<ref>` (no existing testid changes).
6. New testids: `view-switch`, `view-tab-cards`, `view-tab-map`, `view-tab-3d`, `mission-route-select`.

**Acceptance.** Cards mode DOM is unchanged; existing warehouse tests pass; switching modes preserves the search box value and selected mission; reload on `?view=3d` restores the mode.

### Phase 2: Mode 2, 2D floorplan with live route overlay (SVG)

**Goal.** Exact 80 m × 50 m plan with an animated mission route.

**Read first.** Phase 0 libs, the sample route JSON (§1).

**Rendering rules.**

- One `<svg viewBox>` in world meters with margin, `preserveAspectRatio="xMidYMid meet"`. **y is flipped** so DOCK (0,0) is bottom-left and PACK (80,0) is bottom-right.
- Layers (separate `<g>`, memoized): floor and grid; nav-graph edges (thin, low alpha, toggleable); aisle labels; 48 shelf rects colored by `binVisualState` of the shelf's aggregate (worst state wins: blocked/damaged/maintenance, else the fullest bin); DOCK and PACK pads; node dots with a toggle for node IDs; route overlay; stop pins.
- **Route overlay:** polyline from `flattenRoute`. Draw the *completed* portion (up to the last stop whose `status` is not `PENDING`) in a muted color and the remaining portion in `--accent-primary`. Render glow as a second wider translucent stroke (no SVG filters, no `feGaussianBlur`). Animate only via a CSS `stroke-dashoffset` marching dash on the remaining path; the animation is disabled under `prefers-reduced-motion` and when the tab is hidden.
- **Stop pins:** numbered circles (seq) at each stop's `node`, offset toward the shelf side (L or R) taken from `shelf_code`. Next pending stop pulses (CSS opacity animation, not filter).
- **Picker marker:** a dot that animates once along the route when the route changes (`requestAnimationFrame`, 30 fps cap, stops at the end; no loop).
- **Interactions:** hover/click shelf shows a tooltip card with the four bins (level, SKU, qty/capacity). Pan by drag and zoom by wheel by changing `viewBox`; double-click resets. Locate input from Mode 1 highlights matching shelves.
- Legend, a route summary chip (algorithm, total distance m, stops finished/total).

**New testids:** `floorplan-svg`, `floorplan-shelf-<code>`, `route-polyline`, `route-stop-pin-<seq>`, `route-summary`.

**Acceptance.**

- Sample route renders legs in order and pin 1 sits at `N-A-01` (10,10) on the correct side of aisle A.
- Selecting a mission with `PENDING` stops shows a full active line; confirming a pick in another tab updates the completed portion through the existing WebSocket invalidation without a manual refresh.
- jsdom test: renders from a fixture layout + route and finds 48 `floorplan-shelf-*` and N `route-stop-pin-*`.
- Interaction of 48 shelves stays smooth with 4× CPU throttle (≥ 30 fps while panning).

### Phase 3: Mode 3a, isometric engine core (Canvas 2D)

**Goal.** A static but fully interactive isometric warehouse, performance-first, no data yet beyond shelf geometry.

**Files.** `apps/web/src/features/twin/` with `projection.ts`, `camera.ts`, `scene.ts`, `renderer.ts`, `TwinCanvas.tsx`, `perf.ts`.

**Tasks.**

1. `scene.ts`: build once from the layout: a flat typed-array list of boxes `{ x0,y0,z0,x1,y1,z1, binIndex }` for every bin (shelf footprint × one level height), plus floor, aisle strips, DOCK and PACK pads. 192 bin boxes; each box has 3 visible faces (top, and the two faces facing the camera, chosen per frame by the sign of the face normal against yaw).
2. `projection.ts`: the formulas in §2.1 implemented with a precomputed `cosθ, sinθ, s·sinφ, s·cosφ` per frame, written into preallocated `Float32Array`s. No object allocation in the loop.
3. `renderer.ts`: sort boxes by depth only when yaw changes (reuse the order when only zoom/pan change); draw faces with flat fills (top lightest, left/right darker shades derived once per color from the token). Static background (floor, grid, labels) is cached on an `OffscreenCanvas`/second canvas keyed by (yaw, tilt, zoom); redraw it only when those change.
4. `camera.ts`: Pointer Events with pointer capture. Drag = rotate yaw (and tilt with vertical drag, clamped 20°–60°); right-drag or Shift-drag = pan; wheel/pinch = zoom (clamped); small inertia that stops its own rAF when velocity < ε. Buttons: reset view, preset angles (Iso, Top-down, Front). Keyboard: arrow keys rotate, +/- zoom (only while the canvas has focus).
5. `perf.ts`: rolling frame-time average, the Auto/High/Low quality controller from §2.2, and a hidden-by-default perf HUD toggled with a small "⚙" button (`twin-perf-hud`) showing ms/frame, draw count, DPR.
6. `TwinCanvas.tsx`: handles `ResizeObserver` (debounced, sets backing store at capped DPR), `visibilitychange`, cleanup of every listener and the rAF on unmount, and a fallback message if `getContext('2d')` is null.

**Acceptance.**

- All 192 boxes visible; rotating a full 360° shows correct occlusion (nearer racks cover farther ones; no flicker).
- Meets every row of the §2.2 table for rotate/zoom and idle. **Report measured numbers** (DevTools Performance screenshots or logged `perf.ts` averages) for normal, 4× throttle and `--disable-gpu`.
- Leaving the mode leaves zero listeners and zero rAF loops (assert in a test with a spy on `requestAnimationFrame`/`cancelAnimationFrame`).

### Phase 4: Mode 3b, data binding, route animation and picking

**Goal.** Make the twin live and useful.

**Tasks.**

1. **Color by data:** each bin box uses `binVisualState` (same legend as Mode 1). HAZMAT shelves get a hatch-free distinct outline color (a stroke, not a pattern fill). Maintenance shelves are dimmed. Show a legend overlay.
2. **Live updates:** when the layout query refreshes, diff per-bin `qty`/`status`. Changed bins flash for 600 ms using one short burst of rAF (the loop ends when no flashes remain).
3. **Route overlay in 3D:** polyline at floor level (wz = 0.05) using `flattenRoute`; completed vs remaining portions as in Phase 2; two-pass glow stroke; numbered stop pins as small vertical "beacon" lines with a circle at wz = 4.6 m that stay screen-upright. The **target bin** of the next pending stop is outlined and extruded 0.2 m higher so the vertical level (L1–L4) is visible in 3D. Picker marker travels the path once on route change (30 fps cap), optionally replayable via a Replay button.
4. **Picking (hit-testing):** no offscreen color-buffer. Hit-test by walking boxes front-to-back and testing the cursor against each projected top/side polygon (point-in-polygon with early bbox rejection); throttle hover to one test per animation frame. Hover shows a tooltip identical in content to Mode 1's bin tooltip; click pins it. Locate input highlights matches with an outline and recenters the camera smoothly on the first match.
5. **Level filter:** chips L1–L4 and "All" hide or ghost other levels (ghost = 15 % alpha, flat color).
6. Share the tooltip content component with Mode 1 so text matches.

**New testids:** `twin-canvas`, `twin-reset-view`, `twin-quality`, `twin-level-filter`, `twin-replay`, `twin-legend`, `twin-tooltip`.

**Acceptance.** Picking the sample mission draws the DOCK→A-01→B-03→PACK route through the correct aisles; the next pending stop's target bin (e.g. `A-01-L-1`) is outlined; a `pick.confirmed` from another session advances the completed portion within one render; hover tooltip matches Mode 1 data; performance table from §2.2 still holds with the route overlay active.

### Phase 5: Concurrency & ACID Stress Lab (`/admin`)

**Goal.** Prove, visibly and honestly, Engine 1's locking, Engine 3's atomicity and idempotency replay. The lab must display **real** HTTP responses only; never simulate or hard-code outcomes.

**Read first.** `AdminPage.tsx` (keep all its existing testids), the gateway orders route and idempotency middleware, `scripts/verify-integrity.ts`, `apiFetch`.

**Backend (only addition):**

- Refactor the check logic of `scripts/verify-integrity.ts` into `services/engine3-inventory/src/domain/integrity.ts` exporting `runIntegrityChecks(db): { id, name, passed, detail? }[]` (I01…I13). The CLI becomes a thin wrapper with identical output.
- Add read-only `GET /internal/v1/admin/integrity` (Engine 3) and gateway proxy `GET /api/admin/integrity` (MANAGER only). Add tests: 13 results, all passing on the demo seed, 403 for non-managers.
- Optional: a tiny gateway middleware adding a `Server-Timing` header (`gw;dur=…`) so the lab can show server time next to client time.

**Frontend.** Add a tab bar to `/admin`: existing content under "Overview" (unchanged), new tab "⚡ Stress Lab" (`admin-tab-stresslab`). Scenario cards (each with Run, Reset, and result panel):

1. **Race for stock (Engine 1 mutex).** Read the available quantity X of one STANDARD SKU (verify the inventory endpoint). Require X ≥ 4 else show "Not enough stock for this demo; receive more or pick another SKU". Use q = ⌊X/2⌋ so that exactly 2 orders fit (2q ≤ X < 3q). Fire **5 parallel** `POST` order requests with `Promise.all`, each with a unique `Idempotency-Key` and the same SKU and qty q. Expect **2 × success and 3 × 409 `INSUFFICIENT_STOCK`**. Show a PASS/FAIL verdict, and if the result is anything else display the actual responses unchanged with a plain explanation (the assertion is on the outcome count and on Σ(successful qty) ≤ X, not on arrival order). Then offer **Clean up**, which cancels the created orders via the cancel endpoint with reason `stress-lab cleanup`.
2. **Idempotency replay (Engine 3).** Same body and same key sent 5 times in parallel, then once more sequentially. Expect all responses to reference **one** order ref and the order count to rise by exactly 1 (read order count before/after). Then send the same key with a different payload and expect **422 `IDEMPOTENCY_KEY_REUSED`**. (If the gateway marks replays with a header, display it; *verify* the exact header name in the middleware.) Also a small button for the missing-key case expecting 400 `IDEMPOTENCY_KEY_REQUIRED`.
3. **Integrity Verifier.** Runs automatically before and after every scenario and on demand: renders the 13 checks as a checklist (✓/✗, name, detail) with the elapsed ms.

**Timeline visual.** For every request, record `performance.now()` at send and at response; render a horizontal bar per request on a shared time axis (offset, duration in ms, HTTP status, error code, `Server-Timing` if present). Use plain divs/SVG; no chart library.

**New testids:** `admin-tab-overview`, `admin-tab-stresslab`, `lab-run-race`, `lab-run-idem`, `lab-run-integrity`, `lab-cleanup`, `lab-verdict-<scenario>`, `lab-request-row-<n>`, `lab-integrity-item-<I01..I13>`.

**Acceptance.** On the demo seed, scenario 1 yields exactly 2 successes and 3 `INSUFFICIENT_STOCK`; scenario 2 creates exactly one order; the verifier shows 13/13 pass before and after each run; after Clean up, reserved quantities return to their prior values (verified by the I02 check and by comparing dashboard tiles); e2e test covers both scenarios against the live stack (`startStack()`).

### Phase 6: Live Event Feed widget (Dashboard `/`)

**Goal.** A live drawer of outbox events with no second WebSocket.

**Tasks.**

1. Extend `realtimeStore` with `events: FeedEvent[]` (ring buffer, max 50, newest first) and `pushEvent(e)`. In `useRealtime`'s `msg.type === 'event'` branch, push `{ seq, event_type, entity_type, entity_id, data, created_at, replay }` in addition to the existing invalidation logic (do not alter invalidation). Batch pushes through a single rAF flush so a 500-event replay causes one render, and mark replayed items with a muted "replay" tag.
2. `EventFeedDrawer` on `HomePage`: collapsible panel (`event-feed`, toggle `event-feed-toggle`) with a connection indicator reusing the `ws-status` state, filter chips (Orders, Missions, Picks, Inventory, Exceptions), Pause/Resume (`event-feed-pause`) which freezes the view but keeps buffering, and Clear.
3. Human summaries per event, e.g. `pick.confirmed` → "Picked 5 on MIS-0001-S01", `inventory.changed` → "Stock changed in A-01-L-1, B-02-R-1" (truncate to 3 bins + "+n"), `order.created` → "Order ORD-0001 created", `exception.opened` → type badge. Unknown events fall back to the raw `event_type`. Items: `event-feed-item-<seq>`.
4. Relative timestamps update from one 1 Hz interval that exists only while the drawer is open.

**Acceptance.** Creating an order in another tab shows `order.created`, `reservation.changed` and `inventory.changed` within a second; reconnect replay does not duplicate items (dedupe by `seq`); with 500 replayed events the UI renders once; existing dashboard testids unchanged.

### Phase 7: Printable barcode labels

**Goal.** Scannable labels for receipts (`RCV-xxxx`), bin locations (`A-01-L-1`), and SKUs (`SKU001`), compatible with the existing scan inputs (`pick-scan-bin`, `pick-scan-sku`), whose expected values are the plain `bin_code` and `sku` strings.

**Tasks.**

1. `apps/web/src/lib/code128.ts`: pure-TS **Code 128 subset B** encoder (no dependency) returning symbol values and module widths, with start B (104), checksum mod 103, stop (106). **Test vector:** `SKU001` → symbols `[104, 51, 43, 53, 16, 16, 17, 28, 106]` (checksum 28). Add vectors for `A-01-L-1` and an `RCV-` sample computed by the same algorithm.
2. `BarcodeSvg` component: renders one `<path>` for all bars (not one `<rect>` per bar), 10-module quiet zones, optional human-readable text below, configurable module width/height.
3. `LabelPrintModal`: tabs Receipt, Bin, SKU; pick items from existing data (receipts, shelves/bins from the layout query, SKUs from the products/inventory query; *verify* endpoints); quantity of copies; label size presets (50×25 mm, 100×50 mm); live preview; **Print** via `window.print()` with `@media print` CSS that hides everything except the label sheet. Add a "Copy value" button for pasting into scan inputs.
4. Entry points: bin tooltip/cards on Warehouse ("Print bin label"), Inventory rows ("Print SKU label"), Receiving receipt detail ("Print receipt label"), and an Admin "Label Studio" shortcut. Do not change existing testids; new ones: `label-modal`, `label-tab-receipt|bin|sku`, `label-print-btn`, `barcode-svg`.
5. **Stretch (optional, may add exactly one dependency such as `qrcode-generator`, lazy-loaded):** QR variant toggle.

**Acceptance.** Encoder test vectors pass; a printed/PDF label scans correctly with a phone scanner app for all three entity types; modal opens from each entry point; print preview contains only the labels.

### Phase 8: Keyboard shortcuts

**Tasks.**

1. `useHotkeys()` in `AppShell`: `Alt+W` → `/warehouse`, `Alt+P` → `/picking`, `Alt+I` → `/inventory`; also `Alt+H` → `/`, `Alt+O` → `/orders`, and `Alt+/` or `?` opens a shortcut help dialog (`shortcut-help`).
2. Match with `event.code` (`KeyW`, `KeyP`, `KeyI`), not `event.key`, because Option+letter on macOS produces different characters. Call `preventDefault()` only when a shortcut is handled; ignore `e.repeat`; ignore when focus is in `input`, `textarea`, `select`, or `contenteditable`.
3. **Role-aware:** use the same permission flags as the sidebar. `Alt+P` works only for MANAGER and PICKER; otherwise show a 2 s toast "Picking isn't available for your role" and do nothing else.
4. Add `aria-keyshortcuts` to the matching nav links and small `kbd` hints in the sidebar. Within Mode 3 canvas focus, the canvas's own arrow/+/- keys take priority.

**Acceptance.** Unit test with synthetic `KeyboardEvent`s for each shortcut, role gating, and input-focus suppression; no console errors; shortcuts work on `/login`-free protected routes only.

### Phase 9: Hardening, performance audit and documentation

1. Run the full performance protocol from §2.2 on Mode 2 and Mode 3 and record numbers in `docs/VISUAL_TWIN.md` (hardware, browser, throttle settings).
2. Add a Playwright-free jsdom test set (the repo's documented fallback) for: view switching, fixture-driven Floorplan, event feed dedupe, label modal, hotkeys, stress-lab rendering with mocked fetch (the real-stack run lives in e2e).
3. Accessibility: tabs have `role="tablist"`, canvas has `role="img"` with `aria-label` summarizing the view, and a visually hidden text alternative (mission route stops list); all controls keyboard-reachable.
4. Confirm: `npm test`, `npm run test:e2e`, `npm run build -w @dark-storage/web`, `npm run verify:integrity` are all green; update `docs/PRD_DEVIATIONS.md`; regenerate the project-state snapshot.

## 4. Global definition of done

- All acceptance checklists pass, every existing test is green, no existing `data-testid` removed.
- No new runtime dependency (except the optional QR library, if used).
- Measured performance numbers are present and meet §2.2, or the shortfall is documented with the cause.
- No console errors or warnings in dev; no memory growth in a 60 s rotate test.

## 5. Kickoff prompt to paste into the AI

> You are implementing the attached PRD in the Dark Storage WMS monorepo. Follow Section 0 strictly. Start with **Phase 0** only: read the listed files, run the baseline tests, create the geometry/route libraries with their unit tests, and report results. Stop and wait for my go-ahead before Phase 1. Do not use three.js or CSS3D for Mode 3; use the Canvas 2D isometric design described in §2.1. Never fake results in the Stress Lab.
