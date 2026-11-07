# Dark Storage WMS: Current Ground-Truth State for Next Phase Development

**Generated:** 2026-11-06T17:47:07.297Z  
**Purpose:** Exact, unedited code, schema, topology, and state specification snapshot after Phase 10 completion and Material 3 UI modernization, serving as the ground-truth baseline for the 60-FPS 3D/2D Visualizer and Live Simulator Phase.

---

## 1. Workspace & Package Dependencies (Current State)

### Monorepo Architecture Overview
The repository is structured as an npm workspaces monorepo containing:
- `packages/shared`: Common TypeScript types, Enums, Error models, and Zod schemas used across all backend engines and frontend.
- `services/engine1-scheduler`: SQLite-persisted priority queue scheduler, mutex locking, concurrency semaphore, crash recovery.
- `services/engine2-optimizer`: Spatial graph solver, Dijkstra / A* shortest path, Held-Karp ($O(n^2 2^n)$) / 2-Opt TSP pick optimizer, multi-criteria put-away placement recommender.
- `services/engine3-inventory`: Core relational inventory ledger, stock movements, reservations, orders, picking missions, packing, transactional outbox, database triggers.
- `services/gateway`: Reverse proxy, JWT authentication & RBAC, idempotency header validation, and WebSocket broadcast hub with outbox replay.
- `apps/web`: Single Page Application built on React 18, Vite, React Router v6, TanStack Query v5, Zustand, and Android Material 3 design system.

### Root `package.json`
```json
{
  "name": "dark-storage-wms",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*",
    "services/*",
    "apps/*"
  ],
  "scripts": {
    "dev": "concurrently -k -p \"[{name}]\" -n \"E3,E2,E1,GW,WEB\" -c \"blue,yellow,magenta,green,cyan\" \"npm run dev -w @dark-storage/engine3-inventory\" \"npm run dev -w @dark-storage/engine2-optimizer\" \"npm run dev -w @dark-storage/engine1-scheduler\" \"npm run dev -w @dark-storage/gateway\" \"npm run dev -w @dark-storage/web\"",
    "migrate": "tsx scripts/migrate.ts",
    "seed:base": "tsx scripts/seed-base.ts",
    "seed:demo": "tsx scripts/seed-demo.ts",
    "backup": "tsx scripts/backup-db.ts",
    "db:migrate": "tsx scripts/migrate.ts",
    "db:seed": "tsx scripts/seed-base.ts",
    "db:seed:demo": "tsx scripts/seed-demo.ts",
    "db:backup": "tsx scripts/backup-db.ts",
    "verify:integrity": "tsx scripts/verify-integrity.ts",
    "test": "vitest run",
    "test:e2e": "vitest run --config vitest.e2e.config.ts"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.13.0",
    "bcryptjs": "^2.4.3",
    "better-sqlite3": "^13.0.3",
    "concurrently": "^9.1.2",
    "cross-env": "^7.0.3",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}

```

### `packages/shared/package.json`
```json
{
  "name": "@dark-storage/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "typescript": "^5.7.3"
  }
}

```

### `apps/web/package.json`
```json
{
  "name": "@dark-storage/web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@dark-storage/shared": "*",
    "@tanstack/react-query": "^5.66.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.2",
    "zustand": "^4.5.6"
  },
  "devDependencies": {
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.3",
    "vite": "^5.4.14"
  }
}

```

### Service Package Configurations

#### `services/gateway/package.json`
```json
{
  "name": "@dark-storage/gateway",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "build": "tsc"
  },
  "dependencies": {
    "@dark-storage/shared": "*",
    "cors": "^2.8.5",
    "express": "^4.21.2",
    "jsonwebtoken": "^9.0.2",
    "ws": "^8.18.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.8",
    "@types/node": "^22.13.0",
    "@types/ws": "^8.5.14",
    "typescript": "^5.7.3"
  }
}

```

#### `services/engine1-scheduler/package.json`
```json
{
  "name": "@dark-storage/engine1-scheduler",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "build": "tsc"
  },
  "dependencies": {
    "@dark-storage/shared": "*",
    "better-sqlite3": "^13.0.3",
    "express": "^4.21.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/express": "^4.17.21",
    "@types/node": "^22.13.0",
    "typescript": "^5.7.3"
  }
}

```

#### `services/engine2-optimizer/package.json`
```json
{
  "name": "@dark-storage/engine2-optimizer",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "build": "tsc"
  },
  "dependencies": {
    "@dark-storage/shared": "*",
    "better-sqlite3": "^13.0.3",
    "express": "^4.21.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/express": "^4.17.21",
    "@types/node": "^22.13.0",
    "typescript": "^5.7.3"
  }
}

```

#### `services/engine3-inventory/package.json`
```json
{
  "name": "@dark-storage/engine3-inventory",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "build": "tsc"
  },
  "dependencies": {
    "@dark-storage/shared": "*",
    "bcryptjs": "^2.4.3",
    "better-sqlite3": "^13.0.3",
    "express": "^4.21.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/better-sqlite3": "^7.6.12",
    "@types/express": "^4.17.21",
    "@types/node": "^22.13.0",
    "typescript": "^5.7.3"
  }
}

```

### Available Root Scripts
| Script | Command | Purpose |
|---|---|---|
| `npm run dev` | `concurrently ...` | Runs all 5 processes concurrently (E3: 4003, E2: 4002, E1: 4001, GW: 4000, WEB: 5173). |
| `npm run migrate` / `npm run db:migrate` | `tsx scripts/migrate.ts` | Runs all warehouse & scheduler schema migrations. |
| `npm run seed:base` / `npm run db:seed` | `tsx scripts/seed-base.ts` | Seeds layout, 32 nav nodes, edges, aisles A-D, bays 1-6, shelves, bins, and base products. |
| `npm run seed:demo` / `npm run db:seed:demo` | `tsx scripts/seed-demo.ts` | Populates inbound receipts and put-away stock for SKUs 1-24. |
| `npm run backup` / `npm run db:backup` | `tsx scripts/backup-db.ts` | Backs up SQLite databases to `data/backups/`. |
| `npm run verify:integrity` | `tsx scripts/verify-integrity.ts` | Executes 13 mathematical warehouse integrity invariants. |
| `npm test` | `vitest run` | Runs the 176 unit and integration test suite across phases 1-9. |
| `npm run test:e2e` | `vitest run --config vitest.e2e.config.ts` | Runs the end-to-end multi-role test suite (Phase 10). |

---

## 2. Shared Types, DTOs & Schemas (`packages/shared`)

This section contains the full, unedited code of every file in `packages/shared/src/`.

### `packages/shared/src/index.ts`

```typescript
export * from './enums.js';
export * from './errors.js';
export * from './ids.js';
export * from './schemas/common.js';
export * from './schemas/auth.js';
export * from './schemas/products.js';
export * from './schemas/inventory.js';
export * from './schemas/receiving.js';
export * from './schemas/placement.js';
export * from './schemas/putaways.js';
export * from './schemas/tasks.js';
export * from './schemas/orders.js';
export * from './schemas/missions.js';
export * from './schemas/picking.js';
export * from './schemas/packing.js';

```

### `packages/shared/src/enums.ts`

```typescript
export const ROLES = ['MANAGER', 'OPERATOR', 'PICKER', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STORAGE_CLASSES = ['STANDARD', 'HAZMAT'] as const;
export type StorageClass = (typeof STORAGE_CLASSES)[number];

export const SHELF_STATUSES = ['ACTIVE', 'MAINTENANCE', 'BLOCKED'] as const;
export type ShelfStatus = (typeof SHELF_STATUSES)[number];

export const BIN_STATUSES = ['ACTIVE', 'BLOCKED', 'DAMAGED'] as const;
export type BinStatus = (typeof BIN_STATUSES)[number];

export const MOVEMENT_TYPES = ['RECEIVE', 'PUTAWAY', 'RELOCATE', 'PICK', 'ADJUSTMENT'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_KINDS = ['EXTERNAL', 'STAGING', 'BIN', 'ORDER_PACKING', 'ADJUSTMENT'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const RECEIPT_STATUSES = ['STAGED', 'PARTIALLY_PUT_AWAY', 'PUT_AWAY'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const ORDER_TYPES = ['CUSTOMER', 'TRANSFER', 'PRODUCTION'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_STATUSES = ['RESERVED', 'ASSIGNED', 'PICKING', 'PICKED', 'COMPLETED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FULFILMENT_TYPES = ['FULL', 'PARTIAL'] as const;
export type FulfilmentType = (typeof FULFILMENT_TYPES)[number];

export const RESERVATION_STATUSES = ['HELD', 'CONSUMED', 'RELEASED'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const MISSION_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const PICK_STOP_STATUSES = ['PENDING', 'PICKED', 'EXCEPTION_OPEN', 'RESOLVED'] as const;
export type PickStopStatus = (typeof PICK_STOP_STATUSES)[number];

export const EXCEPTION_TYPES = ['BIN_EMPTY', 'DAMAGED', 'SHORT_PICK', 'WRONG_PRODUCT', 'OTHER'] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

export const EXCEPTION_RESOLUTIONS = ['REALLOCATE', 'ACCEPT_SHORT', 'ORDER_CANCELLED'] as const;
export type ExceptionResolution = (typeof EXCEPTION_RESOLUTIONS)[number];

export const TASK_TYPES = ['PUTAWAY', 'RELOCATE', 'RESERVE_ORDER', 'PICK_CONFIRM', 'EXCEPTION_RESOLVE'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ROUTE_ALGORITHMS = ['HELD_KARP', 'TWO_OPT', 'TRIVIAL'] as const;
export type RouteAlgorithm = (typeof ROUTE_ALGORITHMS)[number];

export const SELECTION_MODES = ['RECOMMENDED', 'MANUAL'] as const;
export type SelectionMode = (typeof SELECTION_MODES)[number];

export const NAV_NODE_KINDS = ['DOCK', 'PACK', 'CROSS', 'AISLE'] as const;
export type NavNodeKind = (typeof NAV_NODE_KINDS)[number];

```

### `packages/shared/src/errors.ts`

```typescript
export const ERROR_CODES = {
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', http: 400, message: 'Validation failed' },
  UNAUTHENTICATED: { code: 'UNAUTHENTICATED', http: 401, message: 'Authentication required' },
  FORBIDDEN: { code: 'FORBIDDEN', http: 403, message: 'Forbidden' },
  NOT_FOUND: { code: 'NOT_FOUND', http: 404, message: 'Entity not found' },
  IDEMPOTENCY_KEY_REQUIRED: { code: 'IDEMPOTENCY_KEY_REQUIRED', http: 400, message: 'Idempotency-Key header is required' },
  IDEMPOTENCY_KEY_REUSED: { code: 'IDEMPOTENCY_KEY_REUSED', http: 422, message: 'Idempotency key reused with different request payload' },
  UNKNOWN_SKU: { code: 'UNKNOWN_SKU', http: 422, message: 'SKU not found or inactive' },
  UNKNOWN_BIN: { code: 'UNKNOWN_BIN', http: 422, message: 'Bin code not found' },
  QUANTITY_INVALID: { code: 'QUANTITY_INVALID', http: 422, message: 'Quantity is invalid or exceeds limits' },
  DUPLICATE_LINE_SKU: { code: 'DUPLICATE_LINE_SKU', http: 422, message: 'Duplicate SKU found in lines' },
  SKU_CONFLICT: { code: 'SKU_CONFLICT', http: 409, message: 'Bin already holds a different SKU' },
  CAPACITY_EXCEEDED: { code: 'CAPACITY_EXCEEDED', http: 409, message: 'Bin capacity exceeded' },
  BIN_NOT_RECEIVABLE: { code: 'BIN_NOT_RECEIVABLE', http: 409, message: 'Bin or shelf is not receivable' },
  STORAGE_CLASS_MISMATCH: { code: 'STORAGE_CLASS_MISMATCH', http: 409, message: 'Storage class mismatch' },
  INSUFFICIENT_STAGED_STOCK: { code: 'INSUFFICIENT_STAGED_STOCK', http: 409, message: 'Quantity exceeds staged stock' },
  INSUFFICIENT_STOCK: { code: 'INSUFFICIENT_STOCK', http: 409, message: 'Not enough available stock' },
  ORDER_STATE_INVALID: { code: 'ORDER_STATE_INVALID', http: 409, message: 'Action not allowed in current order status' },
  ORDER_NOT_CANCELLABLE: { code: 'ORDER_NOT_CANCELLABLE', http: 409, message: 'Order cannot be cancelled in current status' },
  PICKER_INVALID: { code: 'PICKER_INVALID', http: 422, message: 'User is not an active picker' },
  MISSION_STATE_INVALID: { code: 'MISSION_STATE_INVALID', http: 409, message: 'Action not allowed in current mission status' },
  NOT_YOUR_MISSION: { code: 'NOT_YOUR_MISSION', http: 403, message: 'Picker not assigned to this mission' },
  STOP_STATE_INVALID: { code: 'STOP_STATE_INVALID', http: 409, message: 'Stop not in a state that allows this action' },
  PRODUCT_MISMATCH: { code: 'PRODUCT_MISMATCH', http: 409, message: 'Scanned SKU does not match expected SKU' },
  BIN_MISMATCH: { code: 'BIN_MISMATCH', http: 409, message: 'Scanned bin does not match expected bin' },
  QUANTITY_EXCEEDS_RESERVATION: { code: 'QUANTITY_EXCEEDS_RESERVATION', http: 409, message: 'Picked quantity exceeds outstanding reserved quantity' },
  SHORT_PICK_REQUIRES_EXCEPTION: { code: 'SHORT_PICK_REQUIRES_EXCEPTION', http: 422, message: 'Short pick requires an exception details block' },
  EXCEPTION_STATE_INVALID: { code: 'EXCEPTION_STATE_INVALID', http: 409, message: 'Exception not in a state that allows this action' },
  ADJUSTMENT_CONFLICT: { code: 'ADJUSTMENT_CONFLICT', http: 409, message: 'Counted quantity would violate existing reservations' },
  BIN_HAS_RESERVATIONS: { code: 'BIN_HAS_RESERVATIONS', http: 409, message: 'Cannot block/damage bin with active reservations' },
  PACK_INCOMPLETE: { code: 'PACK_INCOMPLETE', http: 409, message: 'Order is not fully picked and resolved' },
  PARTIAL_PACK_FORBIDDEN: { code: 'PARTIAL_PACK_FORBIDDEN', http: 403, message: 'Manager authority required for partial order packing' },
  ROUTE_UNREACHABLE: { code: 'ROUTE_UNREACHABLE', http: 422, message: 'A stop cannot be reached in the navigation graph' },
  PLAN_STALE: { code: 'PLAN_STALE', http: 409, message: 'Plan no longer matches database state' },
  INVENTORY_DRIFT: { code: 'INVENTORY_DRIFT', http: 500, message: 'Inventory state inconsistency detected' },
  ENGINE1_UNAVAILABLE: { code: 'ENGINE1_UNAVAILABLE', http: 503, message: 'Engine 1 Scheduler unavailable' },
  ENGINE2_UNAVAILABLE: { code: 'ENGINE2_UNAVAILABLE', http: 503, message: 'Engine 2 Optimizer unavailable' },
  ENGINE3_UNAVAILABLE: { code: 'ENGINE3_UNAVAILABLE', http: 503, message: 'Engine 3 Inventory unavailable' },
  TASK_FAILED: { code: 'TASK_FAILED', http: 409, message: 'Engine 1 task execution failed' },
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', http: 500, message: 'Internal server error' }
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class DomainError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    const meta = ERROR_CODES[code] || ERROR_CODES.INTERNAL_ERROR;
    const desc = message || meta.message;
    super(`${code}: ${desc}`);
    this.name = 'DomainError';
    this.code = code;
    this.httpStatus = meta.http;
    this.details = details;
  }
}

```

### `packages/shared/src/ids.ts`

```typescript
export function formatRef(prefix: string, n: number): string {
  const padded = n.toString().padStart(4, '0');
  return `${prefix}-${padded}`;
}

export function formatStopRef(missionRef: string, stopNo: number): string {
  const padded = stopNo.toString().padStart(2, '0');
  return `${missionRef}-S${padded}`;
}

export function shelfOfBin(binCode: string): string {
  return binCode.replace(/-[0-9]+$/, '');
}


```

### `packages/shared/src/schemas/common.ts`

```typescript
import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional()
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

```

### `packages/shared/src/schemas/auth.ts`

```typescript
import { z } from 'zod';
import { ROLES } from '../enums.js';

export const loginRequestSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const userDtoSchema = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  display_name: z.string(),
  role: z.enum(ROLES),
  active: z.number().int()
});

export type UserDto = z.infer<typeof userDtoSchema>;

export interface AuthResponse {
  token: string;
  user: {
    id: number;
    username: string;
    display_name: string;
    role: (typeof ROLES)[number];
  };
}

```

### `packages/shared/src/schemas/products.ts`

```typescript
import { z } from 'zod';
import { STORAGE_CLASSES } from '../enums.js';

export const productDtoSchema = z.object({
  sku: z.string().min(3).max(32),
  name: z.string().min(1),
  category: z.string(),
  storage_class: z.enum(STORAGE_CLASSES),
  unit: z.string(),
  max_receive_qty: z.number().int().positive(),
  active: z.number().int()
});

export type ProductDto = z.infer<typeof productDtoSchema>;

```

### `packages/shared/src/schemas/inventory.ts`

```typescript
import { z } from 'zod';
import { BIN_STATUSES } from '../enums.js';

export const BinStatusUpdateSchema = z.object({
  status: z.enum(BIN_STATUSES),
  reason: z.string().min(3).max(200)
});

export const BinRecountSchema = z.object({
  counted_qty: z.number().int().min(0),
  sku: z.string().optional().nullable(),
  reason: z.string().min(3).max(200)
});

export const InventorySummaryQuerySchema = z.object({
  search: z.string().optional().default(''),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
});

export const InventoryBinsQuerySchema = z.object({
  sku: z.string().optional().default(''),
  shelf: z.string().optional().default(''),
  status: z.string().optional().default(''),
  occupied: z.enum(['true', 'false', '']).optional().default(''),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50)
});

export const InventoryMovementsQuerySchema = z.object({
  sku: z.string().optional().default(''),
  bin: z.string().optional().default(''),
  type: z.string().optional().default(''),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50)
});

export const WarehouseSearchQuerySchema = z.object({
  q: z.string().min(1).max(100)
});

export type BinStatusUpdateInput = z.infer<typeof BinStatusUpdateSchema>;
export type BinRecountInput = z.infer<typeof BinRecountSchema>;

```

### `packages/shared/src/schemas/receiving.ts`

```typescript
import { z } from 'zod';

export const ReceiptLineInputSchema = z.object({
  sku: z.string().min(1),
  qty: z.number().int().min(1).max(100000)
});

export const CreateReceiptSchema = z.object({
  supplier: z.string().max(80).optional().nullable(),
  reference_no: z.string().max(80).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  received_at: z.string().optional().refine((val) => {
    if (!val) return true;
    const date = new Date(val);
    if (isNaN(date.getTime())) return false;
    const now = Date.now();
    const maxFuture = now + 5 * 60 * 1000;
    return date.getTime() <= maxFuture;
  }, { message: 'received_at cannot be more than 5 minutes in the future' }),
  lines: z.array(ReceiptLineInputSchema).min(1).max(20)
});

export const ReceiptsQuerySchema = z.object({
  status: z.string().optional().default(''),
  search: z.string().optional().default(''),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
});

export type CreateReceiptInput = z.infer<typeof CreateReceiptSchema>;
export type ReceiptLineInput = z.infer<typeof ReceiptLineInputSchema>;

```

### `packages/shared/src/schemas/placement.ts`

```typescript
import { z } from 'zod';

export const RecommendPlacementSchema = z.object({
  receipt_line_id: z.number().int().min(1),
  qty: z.number().int().min(1).optional(),
  include_all: z.boolean().optional().default(false)
});

export const InternalRecommendPlacementSchema = z.object({
  sku: z.string().min(1),
  qty: z.number().int().min(1),
  allow_partial: z.boolean().optional().default(true),
  include_all: z.boolean().optional().default(false),
  max_alternatives: z.number().int().min(1).max(50).optional().default(10)
});

export const ValidatePlacementSchema = z.object({
  dest_bin: z.string().min(1),
  qty: z.number().int().min(1),
  receipt_line_id: z.number().int().min(1).optional(),
  sku: z.string().optional()
}).refine(data => (data.receipt_line_id !== undefined || data.sku !== undefined), {
  message: 'Exactly one of receipt_line_id or sku must be provided'
});

export const InternalValidatePlacementSchema = z.object({
  bin: z.string().min(1),
  sku: z.string().min(1),
  qty: z.number().int().min(1),
  allow_partial: z.boolean().optional().default(true)
});

export type RecommendPlacementInput = z.infer<typeof RecommendPlacementSchema>;
export type ValidatePlacementInput = z.infer<typeof ValidatePlacementSchema>;
export type InternalRecommendPlacementInput = z.infer<typeof InternalRecommendPlacementSchema>;
export type InternalValidatePlacementInput = z.infer<typeof InternalValidatePlacementSchema>;

```

### `packages/shared/src/schemas/putaways.ts`

```typescript
import { z } from 'zod';

export const createPutawaySchema = z.object({
  receipt_line_id: z.number().int().positive(),
  dest_bin: z.string().min(1),
  qty: z.number().int().positive(),
  recommended_bin: z.string().optional()
});

export type CreatePutawayInput = z.infer<typeof createPutawaySchema>;

export const relocateSchema = z.object({
  from_bin: z.string().min(1),
  to_bin: z.string().min(1),
  qty: z.number().int().positive()
});

export type RelocateInput = z.infer<typeof relocateSchema>;

export interface PutawayDetail {
  ref: string;
  receipt_ref: string;
  receipt_line_id: number;
  sku: string;
  product_name: string;
  qty: number;
  source: string;
  dest_shelf: string;
  dest_bin: string;
  selection_mode: 'RECOMMENDED' | 'MANUAL';
  movement_ref: string;
  performed_by: string;
  status: 'COMPLETED';
  created_at: string;
  line_remaining_staged: number;
  receipt_status: string;
}

```

### `packages/shared/src/schemas/tasks.ts`

```typescript
import { z } from 'zod';
import { TASK_TYPES, TASK_STATUSES, TaskType, TaskStatus } from '../enums.js';

export const taskTypeSchema = z.enum(TASK_TYPES);
export const taskPrioritySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4)
]);

export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const taskStatusSchema = z.enum(TASK_STATUSES);

export const createTaskSchema = z.object({

  type: taskTypeSchema,
  priority: taskPrioritySchema.default(2),
  idempotency_key: z.string().min(1),
  actor: z.object({
    id: z.number().int(),
    display_name: z.string(),
    role: z.string()
  }),
  payload: z.record(z.unknown()),
  resources: z.array(z.string()).default([])
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export interface TaskRecord {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  idempotency_key: string;
  actor_json: string;
  payload_json: string;
  resources_json: string;
  status: TaskStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  http_status: number | null;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  error_details_json: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface TaskDto {
  id: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  attempts: number;
  http_status?: number;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

```

### `packages/shared/src/schemas/orders.ts`

```typescript
import { z } from 'zod';
import { ORDER_TYPES, ORDER_STATUSES, PRIORITIES, FULFILMENT_TYPES, RESERVATION_STATUSES, OrderType, OrderStatus, Priority, FulfilmentType, ReservationStatus } from '../enums.js';

export const createOrderLineSchema = z.object({
  sku: z.string().min(3).max(32),
  qty: z.number().int().min(1).max(10000)
});

export const createOrderSchema = z.object({
  order_type: z.enum(ORDER_TYPES).default('CUSTOMER'),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  customer_ref: z.string().max(80).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  lines: z.array(createOrderLineSchema).min(1).max(50)
}).refine(
  (data) => {
    const skus = new Set(data.lines.map((l) => l.sku.toUpperCase()));
    return skus.size === data.lines.length;
  },
  {
    message: 'Duplicate SKU found in lines',
    path: ['lines']
  }
);

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const cancelOrderSchema = z.object({
  reason: z.string().min(3).max(200)
});

export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export const orderQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25)
});

export type OrderQueryInput = z.infer<typeof orderQuerySchema>;

export interface ReservationDto {
  id: number;
  bin_code: string;
  qty: number;
  consumed_qty: number;
  released_qty: number;
  outstanding: number;
  status: ReservationStatus;
}

export interface OrderLineDto {
  line_no: number;
  sku: string;
  product_name: string;
  qty_ordered: number;
  qty_picked: number;
  qty_short: number;
  reservations: ReservationDto[];
}

export interface OrderSummaryReservation {
  held_units: number;
  consumed_units: number;
  released_units: number;
}

export interface OrderAuditEntry {
  at: string;
  action: string;
  by: string;
  details?: unknown;
}

export interface OrderDto {
  ref: string;
  order_type: OrderType;
  priority: Priority;
  status: OrderStatus;
  customer_ref: string | null;
  notes: string | null;
  requested_by: string;
  created_at: string;
  assigned_picker: { id: number; name: string } | string | null;
  mission_ref: string | null;
  fulfilment_type: FulfilmentType | null;
  cancelled_reason?: string | null;
  lines: OrderLineDto[];
  reservation_summary: OrderSummaryReservation;
  audit: OrderAuditEntry[];
}

```

### `packages/shared/src/schemas/missions.ts`

```typescript
import { z } from 'zod';
import { MISSION_STATUSES, PICK_STOP_STATUSES, ROUTE_ALGORITHMS, MissionStatus, PickStopStatus, RouteAlgorithm } from '../enums.js';

export const assignMissionSchema = z.object({
  picker_id: z.number().int().min(1)
});

export type AssignMissionInput = z.infer<typeof assignMissionSchema>;

export const reassignMissionSchema = z.object({
  picker_id: z.number().int().min(1)
});

export type ReassignMissionInput = z.infer<typeof reassignMissionSchema>;

export const missionQuerySchema = z.object({
  status: z.enum(MISSION_STATUSES).optional(),
  picker_id: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25)
});

export type MissionQueryInput = z.infer<typeof missionQuerySchema>;

export interface PickStopDto {
  id: number;
  stop_no: number;
  stop_ref: string;
  seq: number;
  reservation_id: number;
  bin_code: string;
  shelf_code: string;
  sku: string;
  product_name: string;
  qty_required: number;
  qty_picked: number;
  status: PickStopStatus;
  confirmed_at: string | null;
}

export interface MissionProgressDto {
  total_stops: number;
  finished_stops: number;
  open_exceptions: number;
  units_required: number;
  units_picked: number;
}

export interface MissionDto {
  id: number;
  ref: string;
  order_id: number;
  order_ref: string;
  status: MissionStatus;
  picker: {
    id: number;
    name: string;
  };
  route: {
    algorithm: RouteAlgorithm;
    total_distance: number;
    start: string;
    end: string;
    legs: Array<{
      from: string;
      to: string;
      distance: number;
      path: string[];
    }>;
  };
  stops: PickStopDto[];
  progress: MissionProgressDto;
  assigned_by: {
    id: number;
    name: string;
  };
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
}

```

### `packages/shared/src/schemas/picking.ts`

```typescript
import { z } from 'zod';
import { EXCEPTION_TYPES, EXCEPTION_RESOLUTIONS, ExceptionType, ExceptionResolution, PickStopStatus } from '../enums.js';

export const confirmPickSchema = z.object({
  scanned_bin: z.string().min(1),
  scanned_sku: z.string().min(1),
  picked_qty: z.number().int().min(1),
  exception: z
    .object({
      type: z.enum(['SHORT_PICK', 'DAMAGED', 'OTHER']),
      notes: z.string().min(3).max(300)
    })
    .optional()
});

export type ConfirmPickInput = z.infer<typeof confirmPickSchema>;

export const reportProblemSchema = z.object({
  type: z.enum(['BIN_EMPTY', 'DAMAGED', 'WRONG_PRODUCT', 'OTHER']),
  notes: z.string().min(3).max(300)
});

export type ReportProblemInput = z.infer<typeof reportProblemSchema>;

export const resolveExceptionSchema = z.object({
  action: z.enum(['REALLOCATE', 'ACCEPT_SHORT']),
  notes: z.string().min(3).max(300).optional(),
  recount: z
    .object({
      counted_qty: z.number().int().min(0)
    })
    .optional()
});

export type ResolveExceptionInput = z.infer<typeof resolveExceptionSchema>;

export const exceptionQuerySchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED']).optional(),
  mission: z.string().optional(),
  mission_id: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25)
});

export type ExceptionQueryInput = z.infer<typeof exceptionQuerySchema>;

export interface PickExceptionDto {
  id: number;
  ref: string;
  mission_id: number;
  mission_ref: string;
  order_id: number;
  order_ref: string;
  stop_id: number;
  stop_ref: string;
  bin_code: string;
  sku: string;
  product_name: string;
  type: ExceptionType;
  expected_qty: number;
  actual_qty: number;
  notes: string | null;
  reported_by: {
    id: number;
    name: string;
  };
  reported_at: string;
  status: 'OPEN' | 'RESOLVED';
  resolution: ExceptionResolution | null;
  resolved_by?: {
    id: number;
    name: string;
  } | null;
  resolved_at?: string | null;
  resolution_notes?: string | null;
}

export interface PickConfirmationResultDto {
  stop: {
    id: number;
    stop_ref: string;
    seq: number;
    bin_code: string;
    sku: string;
    qty_required: number;
    qty_picked: number;
    status: PickStopStatus;
    confirmed_at: string | null;
  };
  mission_progress: {
    total_stops: number;
    finished_stops: number;
    open_exceptions: number;
    units_required: number;
    units_picked: number;
  };
  order_status: string;
  exception?: PickExceptionDto | null;
}

```

### `packages/shared/src/schemas/packing.ts`

```typescript
import { z } from 'zod';

export const packOrderSchema = z.object({
  notes: z.string().max(300).optional().nullable(),
  accept_partial: z.boolean().optional().default(false)
});

export type PackOrderInput = z.infer<typeof packOrderSchema>;

export interface PackingQueueLineDto {
  sku: string;
  product_name: string;
  qty_ordered: number;
  qty_picked: number;
  qty_short: number;
}

export interface PackingQueueExceptionDto {
  ref: string;
  type: string;
  resolution: string | null;
  notes: string | null;
}

export interface PackingQueueItemDto {
  order_ref: string;
  customer_ref: string | null;
  priority: string;
  mission_ref: string | null;
  lines: PackingQueueLineDto[];
  total_ordered: number;
  total_picked: number;
  total_short: number;
  fulfilment_preview: 'FULL' | 'PARTIAL';
  needs_manager_approval: boolean;
  exceptions: PackingQueueExceptionDto[];
}

export interface PackingResultDto {
  packing_ref: string;
  order_ref: string;
  fulfilment_type: 'FULL' | 'PARTIAL';
  total_ordered: number;
  total_picked: number;
  packed_by: number;
  packed_at: string;
}

export const auditQuerySchema = z.object({
  entity_type: z.string().optional(),
  entity_id: z.string().optional(),
  actor: z.string().optional(),
  action: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25)
});

export type AuditQueryInput = z.infer<typeof auditQuerySchema>;

export interface AuditItemDto {
  id: number;
  at: string;
  actor: string;
  role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: any;
}

export interface DashboardDto {
  generated_at: string;
  receiving: {
    receipts_today: number;
    units_received_today: number;
    staged_units: number;
    staged_lines: number;
  };
  inventory: {
    stored_units: number;
    reserved_units: number;
    available_units: number;
    unavailable_units: number;
    occupied_bins: number;
    total_bins: number;
    fill_pct: number;
  };
  orders: {
    reserved: number;
    assigned: number;
    picking: number;
    picked: number;
    completed_today: number;
    cancelled_today: number;
    completed_total: number;
  };
  missions: {
    assigned: number;
    in_progress: number;
    completed_today: number;
  };
  exceptions: {
    open: number;
  };
  movements: {
    today: {
      RECEIVE: number;
      PUTAWAY: number;
      PICK: number;
      RELOCATE: number;
      ADJUSTMENT: number;
    };
    latest: Array<{
      ref: string;
      type: string;
      sku: string;
      product_name: string;
      qty: number;
      from_label: string;
      to_label: string;
      created_at: string;
    }>;
  };
  engine: {
    queued_tasks: number;
    running_tasks: number;
    failed_tasks_24h: number;
  } | null;
}

```



---

## 3. Spatial, Topology & Route Data Contracts (For 2D/3D Visualizers)

### 3.1 Warehouse Navigation Graph: Coordinates & Edges (`scripts/seed-base.ts`)
The warehouse layout is modeled on a 2D coordinate plane in meters ($x$ and $y$ axes):
- **Dock**: $(0, 0)$
- **Packing Station**: $(80, 0)$
- **Aisles**: 4 parallel aisles `A` ($x=10$), `B` ($x=30$), `C` ($x=50$), `D` ($x=70$).
- **Cross Aisles**: Bottom cross nodes `XB-A` to `XB-D` at $y=0$; Top cross nodes `XT-A` to `XT-D` at $y=50$.
- **Bays**: 6 bays per aisle with aisle nodes `N-<Aisle>-<Bay>` placed at $y = 10 + (	ext{bay} - 1) 	imes 6$ ($y in [10, 40]$).
- **Shelves**: Left (`L`) and Right (`R`) pick faces for each bay.
- **Bins**: 4 vertical levels per shelf (Level 1: cap 120, Level 2: cap 100, Level 3: cap 80, Level 4: cap 60).
- **HAZMAT**: Aisle D, Bays 1 & 2 are designated HAZMAT storage class; all others are STANDARD.

```typescript
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

```

---

### 3.2 Layout Endpoint: `GET /api/warehouse/layout`

#### TypeScript Implementation (`services/engine3-inventory/src/routes/warehouse.ts`)
```typescript
import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { WarehouseSearchQuerySchema } from '@dark-storage/shared';

export function createWarehouseRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/warehouse/layout
  router.get('/layout', (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = db.prepare(`
        SELECT
          s.aisle,
          s.code as shelf_code,
          s.bay,
          s.side,
          s.status as shelf_status,
          s.storage_class,
          s.x,
          s.y,
          b.code as bin_code,
          b.level,
          b.capacity,
          b.status as bin_status,
          b.recount_required,
          i.sku,
          p.name as product_name,
          COALESCE(i.qty, 0) as qty,
          COALESCE(i.reserved_qty, 0) as reserved_qty
        FROM shelves s
        JOIN bins b ON b.shelf_code = s.code
        LEFT JOIN inventory i ON i.bin_code = b.code
        LEFT JOIN products p ON p.sku = i.sku
        ORDER BY s.aisle ASC, s.bay ASC, s.side ASC, b.level ASC
      `).all() as Array<{
        aisle: string;
        shelf_code: string;
        bay: number;
        side: string;
        shelf_status: string;
        storage_class: string;
        x: number;
        y: number;
        bin_code: string;
        level: number;
        capacity: number;
        bin_status: string;
        recount_required: number;
        sku: string | null;
        product_name: string | null;
        qty: number;
        reserved_qty: number;
      }>;

      // Group into aisles -> shelves -> bins
      const aisleMap = new Map<string, Map<string, {
        code: string;
        bay: number;
        side: string;
        status: string;
        storage_class: string;
        x: number;
        y: number;
        bins: Array<{
          code: string;
          level: number;
          capacity: number;
          status: string;
          recount_required: boolean;
          sku: string | null;
          product_name: string | null;
          qty: number;
          reserved_qty: number;
        }>;
      }>>();

      for (const row of rows) {
        if (!aisleMap.has(row.aisle)) {
          aisleMap.set(row.aisle, new Map());
        }
        const shelfMap = aisleMap.get(row.aisle)!;
        if (!shelfMap.has(row.shelf_code)) {
          shelfMap.set(row.shelf_code, {
            code: row.shelf_code,
            bay: row.bay,
            side: row.side,
            status: row.shelf_status,
            storage_class: row.storage_class,
            x: row.x,
            y: row.y,
            bins: []
          });
        }

        shelfMap.get(row.shelf_code)!.bins.push({
          code: row.bin_code,
          level: row.level,
          capacity: row.capacity,
          status: row.bin_status,
          recount_required: Boolean(row.recount_required),
          sku: row.sku,
          product_name: row.product_name,
          qty: row.qty,
          reserved_qty: row.reserved_qty
        });
      }

      const aisles = Array.from(aisleMap.entries()).map(([aisle, shelvesMap]) => ({
        aisle,
        shelves: Array.from(shelvesMap.values())
      }));

      res.json({ aisles });
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/warehouse/search?q=
  router.get('/search', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { q } = WarehouseSearchQuerySchema.parse(req.query);
      const queryPattern = `%${q.toUpperCase()}%`;

      // Check if q matches any product
      const productMatches = db.prepare(`
        SELECT sku FROM products
        WHERE UPPER(sku) LIKE ? OR UPPER(name) LIKE ?
      `).all(queryPattern, queryPattern) as { sku: string }[];

      let sql = `
        SELECT
          b.code as bin_code,
          b.shelf_code,
          i.sku,
          p.name as product_name,
          COALESCE(i.qty, 0) as qty,
          COALESCE(i.reserved_qty, 0) as reserved_qty
        FROM bins b
        LEFT JOIN inventory i ON i.bin_code = b.code
        LEFT JOIN products p ON p.sku = i.sku
      `;

      let rows: Array<{
        bin_code: string;
        shelf_code: string;
        sku: string | null;
        product_name: string | null;
        qty: number;
        reserved_qty: number;
      }>;

      if (productMatches.length > 0) {
        // Product match -> return only bins with stock for that product OR matching bin/shelf
        sql += `
          WHERE (
            (i.qty > 0 AND (UPPER(i.sku) LIKE ? OR UPPER(p.name) LIKE ?))
            OR UPPER(b.code) LIKE ?
            OR UPPER(b.shelf_code) LIKE ?
          )
          ORDER BY b.code ASC
          LIMIT 50
        `;
        rows = db.prepare(sql).all(queryPattern, queryPattern, queryPattern, queryPattern) as typeof rows;
      } else {
        // Bin or shelf search
        sql += `
          WHERE (UPPER(b.code) LIKE ? OR UPPER(b.shelf_code) LIKE ?)
          ORDER BY b.code ASC
          LIMIT 50
        `;
        rows = db.prepare(sql).all(queryPattern, queryPattern) as typeof rows;
      }

      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

```

#### JSON Response Schema & Example Output
```json
{
  "aisles": [
    {
      "aisle": "A",
      "shelves": [
        {
          "code": "A-01-L",
          "bay": 1,
          "side": "L",
          "status": "ACTIVE",
          "storage_class": "STANDARD",
          "x": 10,
          "y": 10,
          "bins": [
            {
              "code": "A-01-L-1",
              "level": 1,
              "capacity": 120,
              "status": "ACTIVE",
              "recount_required": false,
              "sku": "SKU001",
              "product_name": "Wireless Mouse",
              "qty": 50,
              "reserved_qty": 0
            },
            {
              "code": "A-01-L-2",
              "level": 2,
              "capacity": 100,
              "status": "ACTIVE",
              "recount_required": false,
              "sku": null,
              "product_name": null,
              "qty": 0,
              "reserved_qty": 0
            },
            {
              "code": "A-01-L-3",
              "level": 3,
              "capacity": 80,
              "status": "ACTIVE",
              "recount_required": false,
              "sku": null,
              "product_name": null,
              "qty": 0,
              "reserved_qty": 0
            },
            {
              "code": "A-01-L-4",
              "level": 4,
              "capacity": 60,
              "status": "ACTIVE",
              "recount_required": false,
              "sku": null,
              "product_name": null,
              "qty": 0,
              "reserved_qty": 0
            }
          ]
        }
      ]
    }
  ]
}
```

---

### 3.3 Route Planning Contract: Engine 2 `POST /internal/v1/routes/plan`

#### TypeScript Implementation (`services/engine2-optimizer/src/routing/planRoute.ts`)
```typescript
import Database from 'better-sqlite3';
import { DomainError } from '@dark-storage/shared';
import { loadGraphWithCoords } from '../graph/loadGraph.js';
import { dijkstra } from './dijkstra.js';
import { astar } from './astar.js';
import { heldKarp } from './heldKarp.js';
import { twoOpt } from './twoOpt.js';

export interface RouteStopInput {
  key: string | number;
  bin_code: string;
  node: string;
  shelf_code?: string;
  level?: number;
}

export interface RoutePlanInput {
  start: string;
  end: string;
  stops: RouteStopInput[];
}

export interface RouteLeg {
  from: string;
  to: string;
  distance: number;
  path: string[];
}

export interface RouteStopOutput {
  key: string | number;
  bin_code: string;
  node: string;
  seq: number;
}

export interface RoutePlanOutput {
  algorithm: 'HELD_KARP' | 'TWO_OPT' | 'TRIVIAL';
  total_distance: number;
  start: string;
  end: string;
  order: Array<string | number>;
  stops: RouteStopOutput[];
  legs: RouteLeg[];
}

function getShelfAndLevel(stop: RouteStopInput): { shelfCode: string; level: number } {
  if (stop.shelf_code && stop.level !== undefined) {
    return { shelfCode: stop.shelf_code, level: stop.level };
  }
  const parts = stop.bin_code.split('-');
  if (parts.length >= 4) {
    const level = parseInt(parts[parts.length - 1], 10) || 0;
    const shelfCode = parts.slice(0, parts.length - 1).join('-');
    return { shelfCode, level };
  }
  return { shelfCode: stop.bin_code, level: 0 };
}

export function planRoute(db: Database.Database, input: RoutePlanInput): RoutePlanOutput {
  const { graph, coords } = loadGraphWithCoords(db);
  const start = input.start || 'DOCK';
  const end = input.end || 'PACK';
  const stops = input.stops || [];

  // 1. Group stops by node -> distinct waypoints
  const stopsByNode = new Map<string, RouteStopInput[]>();
  for (const s of stops) {
    if (!stopsByNode.has(s.node)) {
      stopsByNode.set(s.node, []);
    }
    stopsByNode.get(s.node)!.push(s);
  }

  const waypoints = Array.from(stopsByNode.keys()).sort((a, b) => a.localeCompare(b));

  // 2. Compute distance matrix D via Dijkstra from start, end, and all waypoints
  const nodesToRun = Array.from(new Set([start, end, ...waypoints]));
  const distanceMatrix = new Map<string, Map<string, number>>();

  for (const n of nodesToRun) {
    const { distances } = dijkstra(n, graph);
    distanceMatrix.set(n, distances);
  }

  const getD = (from: string, to: string): number => {
    return distanceMatrix.get(from)?.get(to) ?? Infinity;
  };

  // Check reachability
  const unreachableKeys: Array<string | number> = [];
  if (getD(start, end) === Infinity) {
    // If start to end is disconnected
    for (const s of stops) {
      unreachableKeys.push(s.key);
    }
  }

  for (const s of stops) {
    const distFromStart = getD(start, s.node);
    const distToEnd = getD(s.node, end);
    if (distFromStart === Infinity || distToEnd === Infinity) {
      if (!unreachableKeys.includes(s.key)) {
        unreachableKeys.push(s.key);
      }
    }
  }

  if (unreachableKeys.length > 0) {
    throw new DomainError('ROUTE_UNREACHABLE', 'One or more route destinations are unreachable', {
      unreachable_keys: unreachableKeys
    });
  }

  // 3. Algorithm selection and waypoint ordering
  const m = waypoints.length;
  let algorithm: 'HELD_KARP' | 'TWO_OPT' | 'TRIVIAL';
  let orderedWaypoints: string[] = [];

  if (m === 0) {
    algorithm = 'TRIVIAL';
    orderedWaypoints = [];
  } else if (m <= 10) {
    algorithm = 'HELD_KARP';
    const result = heldKarp(start, end, waypoints, getD);
    orderedWaypoints = result.order;
  } else {
    algorithm = 'TWO_OPT';
    const result = twoOpt(start, end, waypoints, getD);
    orderedWaypoints = result.order;
  }

  // 4. Order the stops inside each waypoint by (shelf_code ASC, level ASC)
  const orderedStops: RouteStopOutput[] = [];
  const orderedKeys: Array<string | number> = [];
  let currentSeq = 1;

  for (const wpNode of orderedWaypoints) {
    const nodeStops = stopsByNode.get(wpNode) || [];
    nodeStops.sort((a, b) => {
      const aInfo = getShelfAndLevel(a);
      const bInfo = getShelfAndLevel(b);
      const shelfCmp = aInfo.shelfCode.localeCompare(bInfo.shelfCode);
      if (shelfCmp !== 0) return shelfCmp;
      return aInfo.level - bInfo.level;
    });

    for (const s of nodeStops) {
      orderedStops.push({
        key: s.key,
        bin_code: s.bin_code,
        node: s.node,
        seq: currentSeq++
      });
      orderedKeys.push(s.key);
    }
  }

  // 5. Compute legs between consecutive points (start, w1..wm, end) with A*
  const pathNodes = [start, ...orderedWaypoints, end];
  const legs: RouteLeg[] = [];
  let totalDistance = 0;

  for (let i = 0; i < pathNodes.length - 1; i++) {
    const from = pathNodes[i];
    const to = pathNodes[i + 1];

    if (from === to) {
      legs.push({
        from,
        to,
        distance: 0,
        path: [from]
      });
    } else {
      const astarRes = astar(from, to, graph, coords);
      if (astarRes.distance === Infinity) {
        throw new DomainError('ROUTE_UNREACHABLE', `Path between ${from} and ${to} is disconnected`);
      }
      const dist = Math.round(astarRes.distance * 100) / 100;
      totalDistance += dist;
      legs.push({
        from,
        to,
        distance: dist,
        path: astarRes.path
      });
    }
  }

  totalDistance = Math.round(totalDistance * 100) / 100;

  return {
    algorithm,
    total_distance: totalDistance,
    start,
    end,
    order: orderedKeys,
    stops: orderedStops,
    legs
  };
}

```

#### Engine 2 Route Dispatcher (`services/engine2-optimizer/src/routes/routing.ts`)
```typescript
import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { planRoute } from '../routing/planRoute.js';

export function createRoutingRouter(db: Database.Database): Router {
  const router = Router();

  // POST /internal/v1/routes/plan
  router.post('/plan', (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = planRoute(db, req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

```

#### JSON Request Payload Contract
```json
{
  "start": "DOCK",
  "end": "PACK",
  "stops": [
    {
      "key": 1,
      "bin_code": "A-01-L-1",
      "node": "N-A-01",
      "shelf_code": "A-01-L",
      "level": 1
    },
    {
      "key": 2,
      "bin_code": "B-03-R-2",
      "node": "N-B-03",
      "shelf_code": "B-03-R",
      "level": 2
    }
  ]
}
```

#### JSON Response Structure
```json
{
  "algorithm": "HELD_KARP",
  "total_distance": 114,
  "start": "DOCK",
  "end": "PACK",
  "order": [1, 2],
  "stops": [
    {
      "key": 1,
      "bin_code": "A-01-L-1",
      "node": "N-A-01",
      "seq": 1
    },
    {
      "key": 2,
      "bin_code": "B-03-R-2",
      "node": "N-B-03",
      "seq": 2
    }
  ],
  "legs": [
    {
      "from": "DOCK",
      "to": "N-A-01",
      "distance": 20,
      "path": ["DOCK", "XB-A", "N-A-01"]
    },
    {
      "from": "N-A-01",
      "to": "N-B-03",
      "distance": 42,
      "path": ["N-A-01", "N-A-02", "N-A-03", "N-A-04", "N-A-05", "N-A-06", "XT-A", "XT-B", "N-B-06", "N-B-05", "N-B-04", "N-B-03"]
    },
    {
      "from": "N-B-03",
      "to": "PACK",
      "distance": 52,
      "path": ["N-B-03", "N-B-02", "N-B-01", "XB-B", "XB-C", "XB-D", "PACK"]
    }
  ]
}
```

---

### 3.4 Mission Representation: `GET /api/missions/:ref`

#### Gateway Proxy Handler (`services/gateway/src/routes/missions.ts`)
```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { DomainError } from '@dark-storage/shared';
import { authMiddleware } from '../middleware/auth.js';
import { rbacMiddleware } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const missionsRouter = Router();

missionsRouter.use(authMiddleware);

// POST /api/missions/:ref/start (PICKER - own mission)
missionsRouter.post('/:ref/start', rbacMiddleware(['PICKER', 'MANAGER']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
    if (!key) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }

    const actor = {
      id: req.user!.id,
      role: req.user!.role,
      display_name: req.user!.name
    };

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/missions/${req.params.ref}/start`,
      requestId: req.requestId,
      actor,
      idempotencyKey: key
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/missions?status=&picker_id=&page=
missionsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryParams = new URLSearchParams(req.query as Record<string, string>);

    // PICKER role is restricted to own missions
    if (req.user!.role === 'PICKER') {
      queryParams.set('picker_id', String(req.user!.id));
    }

    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/missions?${queryParams.toString()}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/missions/:ref
missionsRouter.get('/:ref', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3<any>({
      method: 'GET',
      path: `/internal/v1/missions/${req.params.ref}`,
      requestId: req.requestId
    });

    // If PICKER, enforce access only to own mission
    if (req.user!.role === 'PICKER' && result.data?.picker?.id !== req.user!.id) {
      throw new DomainError('NOT_YOUR_MISSION', 'You do not have access to this mission');
    }

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

```

#### Engine 3 Implementation (`services/engine3-inventory/src/domain/missionsRepo.ts`)
```typescript
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { DomainError, MissionDto, PickStopDto, MissionProgressDto, MissionQueryInput } from '@dark-storage/shared';
import { nextRef } from './ids.js';
import { audit } from './audit.js';
import { emit } from './outbox.js';

export interface PickPlanReservation {
  reservation_id: number;
  bin_code: string;
  shelf_code: string;
  level: number;
  sku: string;
  product_name: string;
  qty: number;
  node: string;
}

export interface PickPlanResponse {
  order_ref: string;
  status: string;
  plan_token: string;
  reservations: PickPlanReservation[];
}

export function computePlanToken(reservations: Array<{ reservation_id: number; bin_code: string; qty: number }>): string {
  const sorted = [...reservations].sort((a, b) => a.reservation_id - b.reservation_id);
  const payload = sorted.map((r) => ({
    reservation_id: r.reservation_id,
    bin_code: r.bin_code,
    qty: r.qty
  }));
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function getPickPlan(db: Database.Database, orderRef: string): PickPlanResponse {
  const order = db.prepare('SELECT id, ref, status FROM orders WHERE ref = ?').get(orderRef) as
    | { id: number; ref: string; status: string }
    | undefined;

  if (!order) {
    throw new DomainError('NOT_FOUND', `Order ${orderRef} not found`);
  }

  if (order.status !== 'RESERVED') {
    throw new DomainError('ORDER_STATE_INVALID', `Order ${orderRef} is in status ${order.status}, must be RESERVED`, {
      status: order.status
    });
  }

  const rows = db
    .prepare(
      `
    SELECT
      r.id AS reservation_id,
      r.bin_code,
      b.shelf_code,
      b.level,
      r.sku,
      p.name AS product_name,
      r.qty,
      s.nav_node_id AS node
    FROM reservations r
    JOIN bins b ON b.code = r.bin_code
    JOIN shelves s ON s.code = b.shelf_code
    JOIN products p ON p.sku = r.sku COLLATE NOCASE
    WHERE r.order_id = ? AND r.status = 'HELD'
    ORDER BY r.id ASC
  `
    )
    .all(order.id) as PickPlanReservation[];

  const plan_token = computePlanToken(rows);

  return {
    order_ref: order.ref,
    status: order.status,
    plan_token,
    reservations: rows
  };
}

export function assignMission(
  db: Database.Database,
  params: {
    order_ref: string;
    picker_id: number;
    plan_token: string;
    route: any;
    actor: { id: number; display_name?: string; name?: string; role: string };
  }
): MissionDto {
  const order = db.prepare('SELECT id, ref, status FROM orders WHERE ref = ?').get(params.order_ref) as
    | { id: number; ref: string; status: string }
    | undefined;

  if (!order) {
    throw new DomainError('NOT_FOUND', `Order ${params.order_ref} not found`);
  }

  if (order.status !== 'RESERVED') {
    throw new DomainError('ORDER_STATE_INVALID', `Order ${params.order_ref} is in status ${order.status}, must be RESERVED`, {
      status: order.status
    });
  }

  // Validate picker
  const picker = db.prepare('SELECT id, username, display_name, active, role FROM users WHERE id = ?').get(params.picker_id) as
    | { id: number; username: string; display_name: string; active: number; role: string }
    | undefined;

  if (!picker || picker.active !== 1 || picker.role !== 'PICKER') {
    throw new DomainError('PICKER_INVALID', 'Specified user is not an active PICKER', { picker_id: params.picker_id });
  }

  // Check plan token freshness against current reservations
  const currentPlan = getPickPlan(db, params.order_ref);
  if (currentPlan.plan_token !== params.plan_token) {
    throw new DomainError('PLAN_STALE', 'Reservation plan changed, please re-plan', {
      expected: params.plan_token,
      current: currentPlan.plan_token
    });
  }

  const nowIso = new Date().toISOString();
  const missionRef = nextRef(db, 'mission');

  const missionResult = db
    .prepare(
      `
    INSERT INTO missions (ref, order_id, picker_id, status, route_json, route_distance, route_algorithm, assigned_by, assigned_at)
    VALUES (?, ?, ?, 'ASSIGNED', ?, ?, ?, ?, ?)
  `
    )
    .run(
      missionRef,
      order.id,
      picker.id,
      JSON.stringify(params.route),
      params.route.total_distance,
      params.route.algorithm,
      params.actor.id,
      nowIso
    );
  const missionId = Number(missionResult.lastInsertRowid);

  // Map reservations by id
  const resMap = new Map<number, PickPlanReservation>();
  for (const r of currentPlan.reservations) {
    resMap.set(r.reservation_id, r);
  }

  // Insert pick stops in route order
  const orderKeys: Array<number | string> = params.route.order || [];
  let stopNo = 1;

  for (const key of orderKeys) {
    const resId = typeof key === 'string' ? parseInt(key, 10) : key;
    const res = resMap.get(resId);
    if (!res) continue;

    const stopRef = `${missionRef}-S${String(stopNo).padStart(2, '0')}`;
    db.prepare(
      `
      INSERT INTO pick_stops (mission_id, stop_no, stop_ref, seq, reservation_id, bin_code, sku, qty_required, qty_picked, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING')
    `
    ).run(missionId, stopNo, stopRef, stopNo, res.reservation_id, res.bin_code, res.sku, res.qty);

    stopNo++;
  }

  // Update order status
  db.prepare(
    `
    UPDATE orders
    SET status = 'ASSIGNED', assigned_picker = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(picker.id, nowIso, order.id);

  // Audit
  audit(db, {
    actor: { id: params.actor.id, role: params.actor.role },
    action: 'MISSION_ASSIGNED',
    entity_type: 'MISSION',
    entity_id: missionRef,
    details: {
      order_ref: order.ref,
      picker_id: picker.id,
      picker_name: picker.display_name,
      route_algorithm: params.route.algorithm,
      route_distance: params.route.total_distance,
      stops_count: stopNo - 1
    }
  });

  // Outbox events
  emit(db, {
    event_type: 'mission.assigned',
    entity_type: 'MISSION',
    entity_id: missionRef,
    data: { ref: missionRef, order_ref: order.ref, picker_id: picker.id }
  });

  emit(db, {
    event_type: 'order.status_changed',
    entity_type: 'ORDER',
    entity_id: order.ref,
    data: { ref: order.ref, status: 'ASSIGNED' }
  });

  return getMission(db, missionRef)!;
}

export function reassignMission(
  db: Database.Database,
  orderRef: string,
  newPickerId: number,
  actor: { id: number; display_name?: string; role: string }
): MissionDto {
  const order = db.prepare('SELECT id, ref, status FROM orders WHERE ref = ?').get(orderRef) as
    | { id: number; ref: string; status: string }
    | undefined;

  if (!order) {
    throw new DomainError('NOT_FOUND', `Order ${orderRef} not found`);
  }

  const mission = db.prepare('SELECT * FROM missions WHERE order_id = ? AND status IN (' + "'ASSIGNED', 'IN_PROGRESS'" + ')').get(order.id) as any;
  if (!mission || mission.status !== 'ASSIGNED') {
    throw new DomainError('MISSION_STATE_INVALID', 'Mission can only be reassigned while in ASSIGNED status');
  }

  // Validate picker
  const picker = db.prepare('SELECT id, display_name, active, role FROM users WHERE id = ?').get(newPickerId) as any;
  if (!picker || picker.active !== 1 || picker.role !== 'PICKER') {
    throw new DomainError('PICKER_INVALID', 'Specified user is not an active PICKER');
  }

  const nowIso = new Date().toISOString();
  db.prepare('UPDATE missions SET picker_id = ? WHERE id = ?').run(picker.id, mission.id);
  db.prepare('UPDATE orders SET assigned_picker = ?, updated_at = ? WHERE id = ?').run(picker.id, nowIso, order.id);

  audit(db, {
    actor: { id: actor.id, role: actor.role },
    action: 'MISSION_REASSIGNED',
    entity_type: 'MISSION',
    entity_id: mission.ref,
    details: {
      order_ref: order.ref,
      old_picker_id: mission.picker_id,
      new_picker_id: picker.id
    }
  });

  emit(db, {
    event_type: 'mission.reassigned',
    entity_type: 'MISSION',
    entity_id: mission.ref,
    data: { ref: mission.ref, order_ref: order.ref, picker_id: picker.id }
  });

  return getMission(db, mission.ref)!;
}

export function startMission(
  db: Database.Database,
  missionRef: string,
  actor: { id: number; role: string }
): MissionDto {
  const mission = db.prepare('SELECT * FROM missions WHERE ref = ?').get(missionRef) as any;
  if (!mission) {
    throw new DomainError('NOT_FOUND', `Mission ${missionRef} not found`);
  }

  if (actor.role === 'PICKER' && actor.id !== mission.picker_id) {
    throw new DomainError('NOT_YOUR_MISSION', 'You are not the assigned picker for this mission');
  }

  if (mission.status !== 'ASSIGNED') {
    throw new DomainError('MISSION_STATE_INVALID', `Mission cannot be started in status ${mission.status}`);
  }

  const nowIso = new Date().toISOString();
  db.prepare("UPDATE missions SET status = 'IN_PROGRESS', started_at = ? WHERE id = ?").run(nowIso, mission.id);
  db.prepare("UPDATE orders SET status = 'PICKING', updated_at = ? WHERE id = ?").run(nowIso, mission.order_id);

  audit(db, {
    actor: { id: actor.id, role: actor.role },
    action: 'MISSION_STARTED',
    entity_type: 'MISSION',
    entity_id: missionRef,
    details: {
      order_id: mission.order_id,
      picker_id: mission.picker_id
    }
  });

  const order = db.prepare('SELECT ref FROM orders WHERE id = ?').get(mission.order_id) as { ref: string };

  emit(db, {
    event_type: 'mission.started',
    entity_type: 'MISSION',
    entity_id: missionRef,
    data: { ref: missionRef, order_ref: order.ref }
  });

  emit(db, {
    event_type: 'order.status_changed',
    entity_type: 'ORDER',
    entity_id: order.ref,
    data: { ref: order.ref, status: 'PICKING' }
  });

  return getMission(db, missionRef)!;
}

export function getMission(db: Database.Database, ref: string): MissionDto | null {
  const mission = db.prepare('SELECT * FROM missions WHERE ref = ?').get(ref) as any;
  if (!mission) return null;

  const order = db.prepare('SELECT ref FROM orders WHERE id = ?').get(mission.order_id) as { ref: string };
  const picker = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(mission.picker_id) as { id: number; display_name: string };
  const assigner = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(mission.assigned_by) as { id: number; display_name: string };

  const stops = db
    .prepare(
      `
    SELECT
      ps.id,
      ps.stop_no,
      ps.stop_ref,
      ps.seq,
      ps.reservation_id,
      ps.bin_code,
      b.shelf_code,
      ps.sku,
      p.name AS product_name,
      ps.qty_required,
      ps.qty_picked,
      ps.status,
      ps.confirmed_at
    FROM pick_stops ps
    JOIN bins b ON b.code = ps.bin_code
    JOIN products p ON p.sku = ps.sku COLLATE NOCASE
    WHERE ps.mission_id = ?
    ORDER BY ps.seq ASC
  `
    )
    .all(mission.id) as PickStopDto[];

  let finishedStops = 0;
  let openExceptions = 0;
  let unitsRequired = 0;
  let unitsPicked = 0;

  for (const s of stops) {
    unitsRequired += s.qty_required;
    unitsPicked += s.qty_picked;
    if (s.status === 'PICKED' || s.status === 'RESOLVED') {
      finishedStops++;
    } else if (s.status === 'EXCEPTION_OPEN') {
      openExceptions++;
    }
  }

  const progress: MissionProgressDto = {
    total_stops: stops.length,
    finished_stops: finishedStops,
    open_exceptions: openExceptions,
    units_required: unitsRequired,
    units_picked: unitsPicked
  };

  const route = JSON.parse(mission.route_json);

  return {
    id: mission.id,
    ref: mission.ref,
    order_id: mission.order_id,
    order_ref: order?.ref || '',
    status: mission.status,
    picker: {
      id: picker?.id ?? 0,
      name: picker?.display_name || ''
    },
    route,
    stops,
    progress,
    assigned_by: {
      id: assigner?.id ?? 0,
      name: assigner?.display_name || ''
    },
    assigned_at: mission.assigned_at,
    started_at: mission.started_at,
    completed_at: mission.completed_at
  };
}

export function listMissions(
  db: Database.Database,
  query: MissionQueryInput
): { missions: MissionDto[]; total: number; page: number; page_size: number } {
  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (query.status) {
    where += ' AND m.status = ?';
    params.push(query.status);
  }

  if (query.picker_id) {
    where += ' AND m.picker_id = ?';
    params.push(query.picker_id);
  }

  const countRow = db.prepare(`SELECT COUNT(*) AS total FROM missions m ${where}`).get(...params) as { total: number };
  const total = countRow.total;

  const page = query.page ?? 1;
  const pageSize = query.page_size ?? 25;
  const offset = (page - 1) * pageSize;

  const missionRefs = db
    .prepare(`SELECT m.ref FROM missions m ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as Array<{ ref: string }>;

  const missions = missionRefs.map((r) => getMission(db, r.ref)!).filter(Boolean);

  return {
    missions,
    total,
    page,
    page_size: pageSize
  };
}

export function getActivePickers(db: Database.Database): Array<{ id: number; username: string; display_name: string; open_missions: number }> {
  const rows = db
    .prepare(
      `
    SELECT
      u.id,
      u.username,
      u.display_name,
      COUNT(m.id) AS open_missions
    FROM users u
    LEFT JOIN missions m ON m.picker_id = u.id AND m.status IN ('ASSIGNED', 'IN_PROGRESS')
    WHERE u.role = 'PICKER' AND u.active = 1
    GROUP BY u.id
    ORDER BY u.id ASC
  `
    )
    .all() as Array<{ id: number; username: string; display_name: string; open_missions: number }>;

  return rows;
}

```

#### JSON Response Output Shape
```json
{
  "id": 1,
  "ref": "MIS-0001",
  "order_id": 1,
  "order_ref": "ORD-0001",
  "status": "ASSIGNED",
  "picker": {
    "id": 3,
    "name": "Picker"
  },
  "route": {
    "algorithm": "HELD_KARP",
    "total_distance": 100,
    "start": "DOCK",
    "end": "PACK",
    "order": [1],
    "stops": [
      {
        "key": 1,
        "bin_code": "A-01-L-1",
        "node": "N-A-01",
        "seq": 1
      }
    ],
    "legs": [
      {
        "from": "DOCK",
        "to": "N-A-01",
        "distance": 20,
        "path": ["DOCK", "XB-A", "N-A-01"]
      },
      {
        "from": "N-A-01",
        "to": "PACK",
        "distance": 80,
        "path": ["N-A-01", "XB-A", "XB-B", "XB-C", "XB-D", "PACK"]
      }
    ]
  },
  "stops": [
    {
      "id": 1,
      "stop_no": 1,
      "stop_ref": "MIS-0001-S01",
      "seq": 1,
      "reservation_id": 1,
      "bin_code": "A-01-L-1",
      "shelf_code": "A-01-L",
      "sku": "SKU001",
      "product_name": "Wireless Mouse",
      "qty_required": 5,
      "qty_picked": 0,
      "status": "PENDING",
      "confirmed_at": null
    }
  ],
  "progress": {
    "total_stops": 1,
    "finished_stops": 0,
    "open_exceptions": 0,
    "units_required": 5,
    "units_picked": 0
  },
  "assigned_by": {
    "id": 1,
    "name": "Manager"
  },
  "assigned_at": "2026-11-06T10:00:00.000Z",
  "started_at": null,
  "completed_at": null
}
```

---

## 4. Realtime WebSocket & Outbox Implementation

### 4.1 Gateway WebSocket Hub & Outbox Poller (`services/gateway/src/ws/hub.ts`)
```typescript
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { callEngine3 } from '../clients/engine3.js';

interface ClientMeta {
  userId: number;
  role: string;
  isAlive: boolean;
}

interface OutboxEventItem {
  seq: number;
  event_type: string;
  entity_type: string;
  entity_id: string;
  data: any;
  created_at: string;
}

interface OutboxResponse {
  latest_seq: number;
  events: OutboxEventItem[];
}

export class WebSocketHub {
  public readonly wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientMeta>();
  private currentGatewaySeq = 0;
  private lastPolledSeq = 0;
  private pollerTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isPolling = false;

  constructor(server: http.Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    this.startHeartbeat();
    this.startPoller();
  }

  public getCurrentSeq(): number {
    return this.currentGatewaySeq;
  }

  public getConnectedClientsCount(): number {
    return this.clients.size;
  }

  private async handleConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
    try {
      const url = new URL(req.url || '', 'http://127.0.0.1');
      const token = url.searchParams.get('token');
      const sinceParam = url.searchParams.get('since');
      const since = sinceParam !== null ? parseInt(sinceParam, 10) : 0;

      if (!token) {
        ws.close(4401, 'UNAUTHENTICATED');
        return;
      }

      let payload: any;
      try {
        payload = jwt.verify(token, config.JWT_SECRET);
      } catch {
        ws.close(4401, 'UNAUTHENTICATED');
        return;
      }

      const clientMeta: ClientMeta = {
        userId: payload.id,
        role: payload.role,
        isAlive: true
      };
      this.clients.set(ws, clientMeta);

      ws.on('pong', () => {
        const meta = this.clients.get(ws);
        if (meta) {
          meta.isAlive = true;
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      // 1. Send connected greeting
      ws.send(
        JSON.stringify({
          type: 'connected',
          latest_seq: this.currentGatewaySeq
        })
      );

      // 2. Initial handshake & replay
      if (since > 0 && since < this.currentGatewaySeq) {
        try {
          const res = await callEngine3<OutboxResponse>({
            method: 'GET',
            path: `/internal/v1/outbox?after_seq=${since}&limit=500`,
            timeoutMs: 3000
          });

          const missedEvents = res.data.events;
          if (missedEvents.length >= 500) {
            ws.send(
              JSON.stringify({
                type: 'resync_required',
                latest_seq: this.currentGatewaySeq
              })
            );
          } else {
            for (const ev of missedEvents) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: 'event',
                    seq: ev.seq,
                    event_type: ev.event_type,
                    entity_type: ev.entity_type,
                    entity_id: ev.entity_id,
                    data: ev.data,
                    created_at: ev.created_at,
                    replay: true
                  })
                );
              }
            }
          }
        } catch (e) {
          console.warn('[WS] Failed to fetch replay events from Engine 3:', e);
        }
      } else if (since > this.currentGatewaySeq && this.currentGatewaySeq > 0) {
        ws.send(
          JSON.stringify({
            type: 'resync_required',
            latest_seq: this.currentGatewaySeq
          })
        );
      }
    } catch (err) {
      console.error('[WS] Connection setup error:', err);
      ws.close(4401, 'UNAUTHENTICATED');
    }
  }

  private startPoller(): void {
    this.pollerTimer = setInterval(() => {
      this.pollOutbox();
    }, 250);
  }

  public async pollOutbox(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const res = await callEngine3<OutboxResponse>({
        method: 'GET',
        path: `/internal/v1/outbox?after_seq=${this.lastPolledSeq}&limit=100`,
        timeoutMs: 2000
      });

      if (res.data) {
        if (res.data.latest_seq > this.currentGatewaySeq) {
          this.currentGatewaySeq = res.data.latest_seq;
        }

        for (const ev of res.data.events) {
          if (ev.seq > this.lastPolledSeq) {
            this.lastPolledSeq = ev.seq;
          }
          if (ev.seq > this.currentGatewaySeq) {
            this.currentGatewaySeq = ev.seq;
          }

          const message = JSON.stringify({
            type: 'event',
            seq: ev.seq,
            event_type: ev.event_type,
            entity_type: ev.entity_type,
            entity_id: ev.entity_id,
            data: ev.data,
            created_at: ev.created_at,
            replay: false
          });

          this.broadcast(message);
        }
      }
    } catch {
      // Temporary network glitch or Engine 3 restarting; keep connections open
    } finally {
      this.isPolling = false;
    }
  }

  private broadcast(message: string): void {
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message);
        } catch {
          // Socket write failed, cleanup on next heartbeat
        }
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [ws, meta] of this.clients) {
        if (!meta.isAlive) {
          ws.terminate();
          this.clients.delete(ws);
        } else {
          meta.isAlive = false;
          try {
            ws.ping();
          } catch {
            ws.terminate();
            this.clients.delete(ws);
          }
        }
      }
    }, 20000);
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.pollerTimer) {
        clearInterval(this.pollerTimer);
        this.pollerTimer = null;
      }
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }

      for (const [ws] of this.clients) {
        try {
          ws.close();
        } catch {}
      }
      this.clients.clear();

      this.wss.close(() => {
        resolve();
      });
    });
  }
}

```

### 4.2 Web Frontend Realtime Hook (`apps/web/src/hooks/useRealtime.ts`)
```typescript
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore.js';
import { useRealtimeStore } from '../stores/realtimeStore.js';

const EVENT_KEY_MAP: Record<string, string[][]> = {
  'receipt.created': [['receipts'], ['staged'], ['inventory'], ['dashboard']],
  'putaway.completed': [['putaways'], ['receipts'], ['staged'], ['inventory'], ['warehouse'], ['dashboard']],
  'inventory.changed': [['inventory'], ['warehouse'], ['dashboard']],
  'bin.status_changed': [['inventory'], ['warehouse'], ['dashboard']],
  'order.created': [['orders'], ['packing'], ['dashboard']],
  'order.status_changed': [['orders'], ['packing'], ['dashboard']],
  'order.completed': [['orders'], ['packing'], ['dashboard']],
  'reservation.changed': [['orders'], ['inventory'], ['warehouse'], ['dashboard']],
  'mission.assigned': [['missions'], ['orders'], ['packing'], ['dashboard']],
  'mission.started': [['missions'], ['orders'], ['packing'], ['dashboard']],
  'mission.completed': [['missions'], ['orders'], ['packing'], ['dashboard']],
  'pick.confirmed': [['missions'], ['orders'], ['inventory'], ['warehouse'], ['packing'], ['dashboard']],
  'exception.opened': [['exceptions'], ['missions'], ['orders'], ['inventory'], ['packing'], ['dashboard']],
  'exception.resolved': [['exceptions'], ['missions'], ['orders'], ['inventory'], ['packing'], ['dashboard']]
};

export function useRealtime(): void {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const { lastSeq, setConnected, updateSeq } = useRealtimeStore();

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const backoffRef = useRef(500);
  const isUnmountedRef = useRef(false);

  useEffect(() => {
    isUnmountedRef.current = false;

    if (!token) {
      setConnected(false, 'Disconnected');
      return;
    }

    function connect() {
      if (isUnmountedRef.current) return;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const currentSeq = useRealtimeStore.getState().lastSeq;
      const wsUrl = `${proto}//${host}/ws?token=${encodeURIComponent(token!)}&since=${currentSeq}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmountedRef.current) {
          ws.close();
          return;
        }
        backoffRef.current = 500;
        setConnected(true, 'Live');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'connected') {
            setConnected(true, 'Live');
            if (typeof msg.latest_seq === 'number') {
              updateSeq(msg.latest_seq);
            }
          } else if (msg.type === 'resync_required') {
            queryClient.invalidateQueries();
            if (typeof msg.latest_seq === 'number') {
              updateSeq(msg.latest_seq);
            }
          } else if (msg.type === 'event') {
            if (typeof msg.seq === 'number') {
              updateSeq(msg.seq);
            }

            const keys = EVENT_KEY_MAP[msg.event_type];
            if (keys) {
              for (const k of keys) {
                queryClient.invalidateQueries({ queryKey: k });
              }
            } else {
              // General invalidation fallback
              queryClient.invalidateQueries();
            }
          }
        } catch (e) {
          console.warn('[WS] Error parsing message:', e);
        }
      };

      ws.onclose = (event) => {
        if (isUnmountedRef.current) return;
        setConnected(false, 'Reconnecting…');
        wsRef.current = null;

        // Don't reconnect if unauthenticated
        if (event.code === 4401) {
          setConnected(false, 'Unauthenticated');
          return;
        }

        // Exponential backoff: 500ms -> 1s -> 2s -> max 5s
        const delay = backoffRef.current;
        backoffRef.current = Math.min(5000, backoffRef.current * 2);

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };

      ws.onerror = () => {
        // Handled by onclose
      };
    }

    connect();

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token, queryClient, setConnected, updateSeq]);
}

```

### 4.3 Web Realtime Store (`apps/web/src/stores/realtimeStore.ts`)
```typescript
import { create } from 'zustand';

interface RealtimeState {
  lastSeq: number;
  connected: boolean;
  statusText: string;
  setConnected: (connected: boolean, statusText: string) => void;
  updateSeq: (seq: number) => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  lastSeq: 0,
  connected: false,
  statusText: 'Connecting…',
  setConnected: (connected, statusText) => set({ connected, statusText }),
  updateSeq: (seq) => set((s) => ({ lastSeq: Math.max(s.lastSeq, seq) }))
}));

```

### 4.4 Engine 3 Transactional Outbox Helper (`services/engine3-inventory/src/domain/outbox.ts`)
```typescript
import Database from 'better-sqlite3';

export interface EmitEventParams {
  event_type: string;
  entity_type: string;
  entity_id: string;
  data: Record<string, unknown>;
}

export function emit(db: Database.Database, params: EmitEventParams): void {
  db.prepare(`
    INSERT INTO outbox_events (
      event_type,
      entity_type,
      entity_id,
      data_json
    ) VALUES (?, ?, ?, ?)
  `).run(
    params.event_type,
    params.entity_type,
    params.entity_id,
    JSON.stringify(params.data)
  );
}

export const insertOutboxEvent = emit;

```

### 4.5 Complete Outbox Event Catalogue & Payload Shapes

Every event emitted by Engine 3 is persisted in `outbox_events` within the same transaction as the database mutation.

| `event_type` | `entity_type` | `entity_id` | `data` JSON Payload Shape | Triggering Action / Origin |
|---|---|---|---|---|
| `order.created` | `ORDER` | Order Ref (e.g. `ORD-0001`) | `{ "ref": "ORD-0001" }` | Inbound customer/transfer order created & stock reserved. |
| `order.status_changed` | `ORDER` | Order Ref | `{ "ref": "ORD-0001", "status": "ASSIGNED" | "PICKING" | "PICKED" | "COMPLETED" | "CANCELLED" }` | Triggered when mission assigned, started, finished, cancelled, or packed. |
| `order.completed` | `ORDER` | Order Ref | `{ "ref": "ORD-0001", "fulfilment_type": "FULL" | "PARTIAL" }` | Order packed and shipped. |
| `mission.assigned` | `MISSION` | Mission Ref (e.g. `MIS-0001`) | `{ "ref": "MIS-0001", "order_ref": "ORD-0001", "picker_id": 3 }` | Manager assigns picker to reserved order. |
| `mission.reassigned` | `MISSION` | Mission Ref | `{ "ref": "MIS-0001", "order_ref": "ORD-0001", "picker_id": 4 }` | Manager switches assigned picker. |
| `mission.started` | `MISSION` | Mission Ref | `{ "ref": "MIS-0001", "order_ref": "ORD-0001" }` | Picker taps "Start Mission". |
| `mission.completed` | `MISSION` | Mission Ref | `{ "ref": "MIS-0001", "order_ref": "ORD-0001" }` | All pick stops confirmed or resolved. |
| `pick.confirmed` | `STOP` | Stop Ref (e.g. `MIS-0001-S01`) | `{ "stop_ref": "MIS-0001-S01", "mission_ref": "MIS-0001", "picked_qty": 5 }` | Picker verifies bin/SKU barcode and confirms pick. |
| `exception.opened` | `EXCEPTION` | Exception Ref (e.g. `EXC-0001`) | `{ "ref": "EXC-0001", "stop_ref": "MIS-0001-S01", "type": "SHORT_PICK" | "DAMAGED" | "BIN_EMPTY" | "WRONG_PRODUCT" | "OTHER" }` | Short pick or problem reported. |
| `exception.resolved` | `EXCEPTION` | Exception Ref | `{ "ref": "EXC-0001", "resolution": "REALLOCATE" | "ACCEPT_SHORT" }` | Manager resolves exception. |
| `inventory.changed` | `BIN` | Bin Code or `multiple` | `{ "bins": ["A-01-L-1", "B-02-R-1"] }` | Stock added, reserved, consumed, or adjusted. |
| `reservation.changed`| `ORDER` | Order Ref | `{ "order_ref": "ORD-0001" }` | Reservations created, consumed, or released. |

---

## 5. Current Redesigned Frontend Key Files (Post-Material 3 Overhaul)

### 5.1 `apps/web/src/App.tsx`
```tsx
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './stores/authStore.js';
import { AppShell } from './components/AppShell.js';
import { LoginPage } from './pages/LoginPage.js';
import { HomePage } from './pages/HomePage.js';
import { InventoryPage } from './pages/InventoryPage.js';
import { WarehousePage } from './pages/WarehousePage.js';
import { ReceivingPage } from './pages/ReceivingPage.js';
import { TasksPage } from './pages/TasksPage.js';
import { OrdersPage } from './pages/OrdersPage.js';
import { NewOrderPage } from './pages/NewOrderPage.js';
import { OrderDetailPage } from './pages/OrderDetailPage.js';
import { PickingPage } from './pages/PickingPage.js';
import { MissionDetailPage } from './pages/MissionDetailPage.js';
import { ExceptionsPage } from './pages/ExceptionsPage.js';
import { PackingPage } from './pages/PackingPage.js';
import { AdminPage } from './pages/AdminPage.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true
    }
  }
});

const ProtectedLayout: React.FC = () => {
  const token = useAuthStore((s) => s.token);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <AppShell />;
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/warehouse" element={<WarehousePage />} />
            <Route path="/receiving" element={<ReceivingPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/new" element={<NewOrderPage />} />
            <Route path="/orders/:ref" element={<OrderDetailPage />} />
            <Route path="/picking" element={<PickingPage />} />
            <Route path="/picking/:ref" element={<MissionDetailPage />} />
            <Route path="/packing" element={<PackingPage />} />
            <Route path="/exceptions" element={<ExceptionsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

```

### 5.2 `apps/web/src/components/AppShell.tsx`
```tsx
import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore.js';
import { useRealtime } from '../hooks/useRealtime.js';
import { useRealtimeStore } from '../stores/realtimeStore.js';
import { apiFetch } from '../api/client.js';
import { AuthResponse } from '@dark-storage/shared';

interface AppShellProps {
  navLinks?: Array<{ to: string; label: string; testId: string }>;
}

const roleAccounts: Record<string, { username: string; label: string }> = {
  MANAGER: { username: 'manager1', label: 'Manager' },
  OPERATOR: { username: 'operator1', label: 'Operator' },
  PICKER: { username: 'picker1', label: 'Picker' },
  STAFF: { username: 'staff1', label: 'Staff' }
};

export const AppShell: React.FC<AppShellProps> = ({ navLinks }) => {
  const { user, login, logout } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useRealtime();
  const { connected, statusText } = useRealtimeStore();
  const [switchingRole, setSwitchingRole] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleRoleSwitch = async (targetRole: string) => {
    const account = roleAccounts[targetRole];
    if (!account || account.username === user?.username || switchingRole) return;
    setSwitchingRole(true);
    try {
      const resp = await apiFetch<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: account.username, password: 'Warehouse#2026' })
      });
      login(resp.token, resp.user);
      queryClient.clear();
      navigate('/');
    } catch (err) {
      console.error('Role switch failed:', err);
    } finally {
      setSwitchingRole(false);
    }
  };

  const isReceivingRole = user?.role === 'MANAGER' || user?.role === 'OPERATOR';
  const isPickingRole = user?.role === 'MANAGER' || user?.role === 'PICKER';
  const isPackingRole = user?.role === 'MANAGER' || user?.role === 'STAFF';
  const isManager = user?.role === 'MANAGER';

  const defaultLinks = [
    { to: '/', label: 'Home', testId: 'nav-home' },
    ...(isReceivingRole ? [{ to: '/receiving', label: 'Receiving', testId: 'nav-receiving' }] : []),
    { to: '/inventory', label: 'Inventory', testId: 'nav-inventory' },
    { to: '/orders', label: 'Orders', testId: 'nav-orders' },
    ...(isPickingRole ? [{ to: '/picking', label: 'Picking', testId: 'nav-picking' }] : []),
    ...(isPackingRole ? [{ to: '/packing', label: 'Packing', testId: 'nav-packing' }] : []),
    ...(isPickingRole ? [{ to: '/exceptions', label: 'Exceptions', testId: 'nav-exceptions' }] : []),
    { to: '/warehouse', label: 'Warehouse', testId: 'nav-warehouse' },
    ...(isManager ? [{ to: '/tasks', label: 'Tasks', testId: 'nav-tasks' }] : []),
    ...(isManager ? [{ to: '/admin', label: 'Admin', testId: 'nav-admin' }] : [])
  ];

  const links = navLinks || defaultLinks;

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-brand">
          <span className="header-brand-icon">DS</span>
          <span>Dark Storage WMS</span>
        </div>
        <div className="header-actions">
          <span
            className={`badge ${connected ? 'badge-ok' : 'badge-warning'}`}
            data-testid="ws-status"
          >
            {connected ? 'Live' : statusText || 'Reconnecting…'}
          </span>

          {/* Quick Top Bar Role Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
              Role:
            </span>
            <select
              className="select"
              value={user?.role || 'MANAGER'}
              onChange={(e) => handleRoleSwitch(e.target.value)}
              disabled={switchingRole}
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                height: '32px',
                borderRadius: 'var(--radius-pill)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                cursor: 'pointer',
                fontWeight: 600
              }}
              title="Switch role instantly"
              data-testid="header-role-switcher"
            >
              <option value="MANAGER">👔 Manager</option>
              <option value="OPERATOR">⚙️ Operator</option>
              <option value="PICKER">📦 Picker</option>
              <option value="STAFF">📋 Staff</option>
            </select>
          </div>

          {user && (
            <span className="user-badge" data-testid="header-user">
              {user.display_name} · {user.role}
            </span>
          )}
          <button className="btn btn-secondary" onClick={handleLogout} data-testid="logout-btn">
            Logout
          </button>
        </div>
      </header>
      <div className="main-body">
        <aside className="sidebar">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              data-testid={link.testId}
            >
              {link.label}
            </NavLink>
          ))}
        </aside>
        <main className="content-area">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

```

### 5.3 `apps/web/src/pages/WarehousePage.tsx`
```tsx
import React, { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { ProductLabel } from '../components/ProductLabel.js';

interface BinLayout {
  code: string;
  level: number;
  capacity: number;
  status: string;
  recount_required: boolean;
  sku: string | null;
  product_name: string | null;
  qty: number;
  reserved_qty: number;
}

interface ShelfLayout {
  code: string;
  bay: number;
  side: string;
  status: string;
  storage_class: string;
  x: number;
  y: number;
  bins: BinLayout[];
}

interface AisleLayout {
  aisle: string;
  shelves: ShelfLayout[];
}

interface WarehouseLayoutResponse {
  aisles: AisleLayout[];
}

export const WarehousePage: React.FC = () => {
  const [locateQuery, setLocateQuery] = useState('');
  const [hoveredBin, setHoveredBin] = useState<BinLayout | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<WarehouseLayoutResponse>({
    queryKey: ['warehouse', 'layout'],
    queryFn: () => apiFetch('/api/warehouse/layout'),
    refetchOnWindowFocus: true
  });

  const getFillClass = (qty: number, cap: number) => {
    if (qty === 0) return 'fill-empty';
    const pct = (qty / cap) * 100;
    if (pct < 25) return 'fill-low';
    if (pct < 75) return 'fill-med';
    if (pct < 100) return 'fill-high';
    return 'fill-full';
  };

  const getBinStatusClass = (bin: BinLayout, shelfStatus: string) => {
    if (bin.status === 'BLOCKED') return 'status-blocked';
    if (bin.status === 'DAMAGED') return 'status-damaged';
    if (shelfStatus === 'MAINTENANCE') return 'status-maintenance';
    if (bin.recount_required) return 'status-recount';
    return getFillClass(bin.qty, bin.capacity);
  };

  const isMatching = (bin: BinLayout, shelfCode: string) => {
    if (!locateQuery.trim()) return false;
    const q = locateQuery.trim().toUpperCase();
    return (
      bin.code.toUpperCase().includes(q) ||
      shelfCode.toUpperCase().includes(q) ||
      (bin.sku && bin.sku.toUpperCase().includes(q)) ||
      (bin.product_name && bin.product_name.toUpperCase().includes(q))
    );
  };

  const handleLocateKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const firstMatch = document.querySelector('.bin-cell.highlight');
      if (firstMatch) {
        firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    }
  };

  const handleMouseEnter = (bin: BinLayout, e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredBin(bin);
    setTooltipPos({ x: rect.left + window.scrollX, y: rect.bottom + window.scrollY + 6 });
  };

  const handleMouseLeave = () => {
    setHoveredBin(null);
    setTooltipPos(null);
  };

  return (
    <div className="warehouse-container m3-page" ref={containerRef}>
      <div className="m3-page-header">
        <div>
          <h1>Warehouse 2D Layout</h1>
          <p className="m3-subtitle">Interactive visual topology, occupancy levels, and real-time bin state</p>
        </div>
        <div className="warehouse-controls">
          <input
            type="text"
            className="input-field"
            style={{ width: '320px' }}
            placeholder="Locate bin, shelf, SKU, or name..."
            value={locateQuery}
            onChange={(e) => setLocateQuery(e.target.value)}
            onKeyDown={handleLocateKeyDown}
            data-testid="warehouse-locate-input"
          />
        </div>
      </div>

      {/* Legend */}
      <div className="warehouse-legend">
        <strong style={{ color: 'var(--text-primary)' }}>Legend:</strong>
        <div className="legend-item"><div className="legend-box fill-empty" /> Empty (0%)</div>
        <div className="legend-item"><div className="legend-box fill-low" /> Low (&lt;25%)</div>
        <div className="legend-item"><div className="legend-box fill-med" /> Medium (&lt;75%)</div>
        <div className="legend-item"><div className="legend-box fill-high" /> High (&lt;100%)</div>
        <div className="legend-item"><div className="legend-box fill-full" /> Full (100%)</div>
        <div className="legend-item"><div className="legend-box status-blocked" /> Blocked</div>
        <div className="legend-item"><div className="legend-box status-damaged" /> Damaged</div>
        <div className="legend-item"><div className="legend-box status-maintenance" /> Shelf Maint.</div>
        <div className="legend-item"><div className="legend-box status-recount" /> Recount Req.</div>
      </div>

      {isLoading ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Loading warehouse layout...
        </div>
      ) : !data || data.aisles.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          No layout data available.
        </div>
      ) : (
        <div className="warehouse-grid">
          {data.aisles.map((aisle) => (
            <div key={aisle.aisle} className="aisle-col">
              <div className="aisle-title">Aisle {aisle.aisle}</div>
              <div className="shelves-list">
                {aisle.shelves.map((shelf) => {
                  const isMaintenance = shelf.status === 'MAINTENANCE';
                  return (
                    <div
                      key={shelf.code}
                      className={`shelf-card ${isMaintenance ? 'shelf-maintenance' : ''}`}
                      data-testid={`shelf-card-${shelf.code}`}
                    >
                      <div className="shelf-header">
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{shelf.code}</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>
                          {shelf.storage_class === 'HAZMAT' ? 'HAZ' : 'STD'}
                        </span>
                      </div>
                      <div className="bin-cells">
                        {shelf.bins
                          .slice()
                          .sort((a, b) => a.level - b.level)
                          .map((bin) => {
                            const statusCls = getBinStatusClass(bin, shelf.status);
                            const matched = isMatching(bin, shelf.code);
                            return (
                              <div
                                key={bin.code}
                                className={`bin-cell ${statusCls} ${matched ? 'highlight' : ''}`}
                                onMouseEnter={(e) => handleMouseEnter(bin, e)}
                                onMouseLeave={handleMouseLeave}
                                onClick={(e) => handleMouseEnter(bin, e)}
                                data-testid={`bin-cell-${bin.code}`}
                              >
                                <span>L{bin.level}</span>
                                <span>{bin.qty > 0 ? bin.qty : ''}</span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Floating Tooltip */}
      {hoveredBin && tooltipPos && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(window.innerWidth - 260, tooltipPos.x),
            top: tooltipPos.y,
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            fontSize: '12px',
            boxShadow: 'var(--shadow-md)',
            zIndex: 1001,
            pointerEvents: 'none',
            minWidth: '220px'
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: '6px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{hoveredBin.code}</div>
          <div style={{ color: 'var(--text-secondary)' }}>Status: <span style={{ textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-primary)' }}>{hoveredBin.status}</span></div>
          <div style={{ color: 'var(--text-secondary)' }}>Capacity: <strong style={{ color: 'var(--text-primary)' }}>{hoveredBin.qty}</strong> / {hoveredBin.capacity}</div>
          <div style={{ color: 'var(--text-secondary)' }}>Reserved: <strong style={{ color: 'var(--text-primary)' }}>{hoveredBin.reserved_qty}</strong></div>
          {hoveredBin.sku ? (
            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
              <ProductLabel sku={hoveredBin.sku} name={hoveredBin.product_name || hoveredBin.sku} />
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', marginTop: '6px' }}>Empty</div>
          )}
        </div>
      )}
    </div>
  );
};

```

### 5.4 `apps/web/src/pages/MissionDetailPage.tsx`
```tsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { MissionDto, PickStopDto } from '@dark-storage/shared';
import { StatusBadge } from '../components/StatusBadge.js';
import { BarcodeSvg } from '../components/BarcodeSvg.js';

export const MissionDetailPage: React.FC = () => {
  const { ref } = useParams<{ ref: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const isPicker = user?.role === 'PICKER';
  const isManager = user?.role === 'MANAGER';

  const [startError, setStartError] = useState<string | null>(null);

  // Active pick execution states
  const [scannedBin, setScannedBin] = useState('');
  const [scannedSku, setScannedSku] = useState('');
  const [pickedQty, setPickedQty] = useState<string>('');
  const [exceptionType, setExceptionType] = useState<'SHORT_PICK' | 'DAMAGED' | 'OTHER'>('DAMAGED');
  const [exceptionNotes, setExceptionNotes] = useState('');
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickKey, setPickKey] = useState<string>(() => crypto.randomUUID());

  // Problem modal state
  const [showProblemModal, setShowProblemModal] = useState(false);
  const [problemType, setProblemType] = useState<'BIN_EMPTY' | 'DAMAGED' | 'WRONG_PRODUCT' | 'OTHER'>('BIN_EMPTY');
  const [problemNotes, setProblemNotes] = useState('');
  const [problemError, setProblemError] = useState<string | null>(null);
  const [problemKey, setProblemKey] = useState<string>(() => crypto.randomUUID());

  const { data: mission, isLoading, error } = useQuery<MissionDto>({
    queryKey: ['mission', ref],
    queryFn: () => apiFetch(`/api/missions/${ref}`),
    refetchInterval: 5000,
    enabled: !!ref
  });

  // Start mission mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      setStartError(null);
      return apiFetch(`/api/missions/${ref}/start`, { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mission', ref] });
      queryClient.invalidateQueries({ queryKey: ['missions'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setStartError(err.message);
      } else {
        setStartError('Failed to start mission');
      }
    }
  });

  // Confirm pick stop mutation
  const confirmMutation = useMutation({
    mutationFn: async (payload: any) => {
      setPickError(null);
      const idemKey = `pick-${currentStop!.stop_ref}-${Date.now()}`;
      return apiFetch(`/api/pick-stops/${currentStop!.stop_ref}/confirm`, {
        method: 'POST',
        idempotencyKey: idemKey,
        body: JSON.stringify(payload)
      });
    },
    onSuccess: () => {
      setScannedBin('');
      setScannedSku('');
      setPickedQty('');
      setExceptionNotes('');
      setPickKey(crypto.randomUUID());
      queryClient.invalidateQueries({ queryKey: ['mission', ref] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setPickError(err.message);
      } else {
        setPickError('Failed to confirm pick stop');
      }
    }
  });

  // Report problem (zero pick exception) mutation
  const reportProblemMutation = useMutation({
    mutationFn: async (payload: any) => {
      setProblemError(null);
      return apiFetch(`/api/pick-stops/${currentStop!.stop_ref}/exception`, {
        method: 'POST',
        headers: { 'Idempotency-Key': problemKey },
        body: JSON.stringify(payload)
      });
    },
    onSuccess: () => {
      setShowProblemModal(false);
      setProblemNotes('');
      setProblemKey(crypto.randomUUID());
      queryClient.invalidateQueries({ queryKey: ['mission', ref] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setProblemError(err.message);
      } else {
        setProblemError('Failed to report exception');
      }
    }
  });

  // Find lowest seq PENDING stop
  const pendingStops = (mission?.stops || []).filter((s) => s.status === 'PENDING');
  pendingStops.sort((a, b) => a.seq - b.seq);
  const currentStop: PickStopDto | undefined = pendingStops[0];

  useEffect(() => {
    if (currentStop && pickedQty === '') {
      setPickedQty(String(currentStop.qty_required));
    }
  }, [currentStop?.id, currentStop?.qty_required]);

  if (isLoading) {
    return <div className="card" style={{ padding: '3rem', textAlign: 'center', margin: '2rem auto', maxWidth: '600px' }}>Loading mission {ref}...</div>;
  }

  if (error || !mission) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center', margin: '2rem auto', maxWidth: '600px' }}>
        <h2 style={{ color: 'var(--accent-danger)', marginBottom: '1rem' }}>Mission Not Found</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          {error instanceof ApiError ? error.message : `Mission ${ref} does not exist.`}
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/picking')}>
          Back to Missions
        </button>
      </div>
    );
  }

  const isAssignedToMe = isPicker && user && mission?.picker.id === user.id;
  const canStart = mission?.status === 'ASSIGNED' && (isAssignedToMe || isManager);
  const isPickingActive = mission?.status === 'IN_PROGRESS' && (isAssignedToMe || isManager);

  // Progress metrics
  const totalStops = mission.progress.total_stops;
  const stopsFinished = mission.progress.finished_stops;
  const stopsPct = totalStops > 0 ? Math.round((stopsFinished / totalStops) * 100) : 0;

  const unitsRequired = mission.progress.units_required;
  const unitsPicked = mission.progress.units_picked;
  const unitsPct = unitsRequired > 0 ? Math.round((unitsPicked / unitsRequired) * 100) : 0;

  const numericPickedQty = pickedQty === '' ? 0 : parseInt(pickedQty, 10);
  const isShortPick = currentStop ? numericPickedQty > 0 && numericPickedQty < currentStop.qty_required : false;

  const isConfirmDisabled =
    !currentStop ||
    !scannedBin.trim() ||
    !scannedSku.trim() ||
    numericPickedQty <= 0 ||
    numericPickedQty > currentStop.qty_required ||
    (isShortPick && !exceptionNotes.trim()) ||
    confirmMutation.isPending;

  const handleConfirmPick = () => {
    if (!currentStop) return;
    confirmMutation.mutate({
      scanned_bin: scannedBin.trim(),
      scanned_sku: scannedSku.trim(),
      picked_qty: numericPickedQty,
      exception: isShortPick
        ? {
            type: exceptionType,
            notes: exceptionNotes.trim()
          }
        : undefined
    });
  };

  const handleReportProblem = () => {
    if (!currentStop || problemNotes.trim().length < 3) return;
    reportProblemMutation.mutate({
      exception_type: problemType,
      notes: problemNotes.trim()
    });
  };

  return (
    <div className="m3-page" style={{ maxWidth: '1100px' }}>
      {/* Navigation & Header */}
      <div>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/picking')} style={{ marginBottom: '12px' }}>
          ← Back to Missions
        </button>
        <div className="m3-page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{mission.ref}</h1>
            <StatusBadge status={mission.status} />
            <span className="badge badge-info">{mission.route.algorithm}</span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {canStart && (
              <button
                className="btn btn-primary"
                data-testid="mission-start-btn"
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
              >
                {startMutation.isPending ? 'Starting...' : 'Start Mission'}
              </button>
            )}
          </div>
        </div>
      </div>

      {startError && (
        <div className="banner banner-error">
          {startError}
        </div>
      )}

      {/* Facts Card */}
      <div
        className="card"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px'
        }}
      >
        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Associated Order</span>
          <p style={{ margin: '6px 0 0', fontWeight: 600 }}>
            <Link to={`/orders/${mission.order_ref}`} style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
              {mission.order_ref}
            </Link>
          </p>
        </div>
        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Assigned Picker</span>
          <p style={{ margin: '6px 0 0', fontWeight: 600 }}>{mission.picker.name}</p>
        </div>
        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Assigned By</span>
          <p style={{ margin: '6px 0 0', fontWeight: 600 }}>{mission.assigned_by.name}</p>
        </div>
        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Assigned At</span>
          <p style={{ margin: '6px 0 0', fontWeight: 600, fontSize: '13px' }}>{new Date(mission.assigned_at).toLocaleString()}</p>
        </div>
        {mission.started_at && (
          <div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Started At</span>
            <p style={{ margin: '6px 0 0', fontWeight: 600, fontSize: '13px' }}>{new Date(mission.started_at).toLocaleString()}</p>
          </div>
        )}
      </div>

      {/* Progress Strip with visual progress bars */}
      <div
        className="card"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '20px'
        }}
      >
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Stops Completed</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-primary)' }}>{stopsPct}%</span>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: '1.35rem', fontWeight: 800 }}>
            {stopsFinished} / {totalStops}
          </p>
          <div className="fill-bar" style={{ height: '8px' }}>
            <div
              data-testid="progress-stops"
              className="fill-bar-inner med"
              style={{ width: `${stopsPct}%` }}
            />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Units Picked</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-success)' }}>{unitsPct}%</span>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: '1.35rem', fontWeight: 800 }}>
            {unitsPicked} / {unitsRequired}
          </p>
          <div className="fill-bar" style={{ height: '8px' }}>
            <div
              data-testid="progress-units"
              className="fill-bar-inner full"
              style={{ width: `${unitsPct}%` }}
            />
          </div>
        </div>

        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Open Exceptions</span>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: '1.35rem',
              fontWeight: 800,
              color: mission.progress.open_exceptions > 0 ? 'var(--accent-danger)' : 'var(--text-primary)'
            }}
          >
            {mission.progress.open_exceptions}
          </p>
          {mission.progress.open_exceptions > 0 && (
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Awaiting manager resolution
            </p>
          )}
        </div>
      </div>

      {/* ACTIVE STOP CARD (When IN_PROGRESS) */}
      {isPickingActive && currentStop && (
        <div
          data-testid="current-stop-card"
          className="card"
          style={{
            border: '2px solid var(--accent-primary)',
            borderRadius: '24px',
            boxShadow: '0 8px 30px rgba(99, 102, 241, 0.18)',
            padding: '28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
            <div>
              <span className="badge badge-primary" style={{ marginBottom: '8px', display: 'inline-block' }}>
                CURRENT STOP #{currentStop.seq} ({currentStop.stop_ref})
              </span>
              <div style={{ fontSize: '2.2rem', fontWeight: 800, letterSpacing: '0.04em', fontFamily: 'var(--font-mono)' }}>
                {currentStop.bin_code}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                Shelf: <strong style={{ color: 'var(--text-primary)' }}>{currentStop.shelf_code}</strong>
              </div>
              {/* Visual Bin Location Barcode */}
              <BarcodeSvg value={currentStop.bin_code} label="Shelf Rack Barcode" />
            </div>

            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{currentStop.product_name}</div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '2px', marginBottom: '8px' }}>
                SKU: {currentStop.sku}
              </div>
              {/* Visual Product SKU Barcode */}
              <BarcodeSvg value={currentStop.sku} label="Item Box SKU Barcode" />
              <div style={{ marginTop: '12px', fontSize: '1.35rem', fontWeight: 800, color: 'var(--accent-primary)' }}>
                Required: {currentStop.qty_required} unit{currentStop.qty_required === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          {pickError && (
            <div className="banner banner-error" data-testid="pick-error-banner">
              {pickError}
            </div>
          )}

          {/* Quick Simulation Barcode Scanner Action */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(99, 102, 241, 0.08)', padding: '10px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(99, 102, 241, 0.2)', flexWrap: 'wrap', gap: '10px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Scan the printed barcodes or simulate scan:
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setScannedBin(currentStop.bin_code);
                setScannedSku(currentStop.sku);
                setPickedQty(String(currentStop.qty_required));
              }}
              style={{ fontSize: '12px', padding: '6px 14px', fontWeight: 700 }}
              title="Auto-fill barcodes as if scanned by a barcode laser gun"
            >
              ⚡ Auto-Fill Barcodes (Simulate Scan)
            </button>
          </div>

          {/* Scans & Inputs */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
              backgroundColor: 'var(--bg-surface)',
              padding: '18px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)'
            }}
          >
            <div>
              <label className="form-label">
                Scan Bin Barcode *
              </label>
              <input
                type="text"
                className="input-field"
                data-testid="pick-scan-bin"
                value={scannedBin}
                onChange={(e) => setScannedBin(e.target.value)}
                placeholder={`e.g. ${currentStop.bin_code}`}
                autoComplete="off"
              />
            </div>

            <div>
              <label className="form-label">
                Scan Product SKU Barcode *
              </label>
              <input
                type="text"
                className="input-field"
                data-testid="pick-scan-sku"
                value={scannedSku}
                onChange={(e) => setScannedSku(e.target.value)}
                placeholder={`e.g. ${currentStop.sku}`}
                autoComplete="off"
              />
            </div>

            <div>
              <label className="form-label">
                Picked Quantity * (Max: {currentStop.qty_required})
              </label>
              <input
                type="number"
                className="input-field"
                data-testid="pick-qty"
                value={pickedQty}
                onChange={(e) => setPickedQty(e.target.value)}
                min={1}
                max={currentStop.qty_required}
              />
              {numericPickedQty > currentStop.qty_required && (
                <span style={{ color: 'var(--accent-danger)', fontSize: '12px', marginTop: '6px', display: 'block', fontWeight: 700 }}>
                  ⚠ Cannot pick {numericPickedQty}. Required is {currentStop.qty_required} unit{currentStop.qty_required === 1 ? '' : 's'}.
                </span>
              )}
            </div>
          </div>

          {/* Short pick exception fields */}
          {isShortPick && (
            <div
              data-testid="short-pick-fields"
              className="banner banner-error"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}
            >
              <div style={{ fontWeight: 700, color: '#fca5a5', fontSize: '14px' }}>
                Short Pick Detected ({numericPickedQty} of {currentStop.qty_required} picked). Exception reporting required:
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
                <div>
                  <label className="form-label" style={{ color: '#fca5a5' }}>Reason Type *</label>
                  <select
                    className="select"
                    data-testid="pick-exc-type"
                    value={exceptionType}
                    onChange={(e: any) => setExceptionType(e.target.value)}
                  >
                    <option value="SHORT_PICK">Short Pick</option>
                    <option value="DAMAGED">Damaged Goods</option>
                    <option value="OTHER">Other Reason</option>
                  </select>
                </div>

                <div>
                  <label className="form-label" style={{ color: '#fca5a5' }}>Notes *</label>
                  <input
                    type="text"
                    className="input-field"
                    data-testid="pick-exc-notes"
                    value={exceptionNotes}
                    onChange={(e) => setExceptionNotes(e.target.value)}
                    placeholder="Provide details for manager..."
                  />
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="pick-report-btn"
              onClick={() => setShowProblemModal(true)}
            >
              Report Problem (Zero Pick)
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {isConfirmDisabled && numericPickedQty > currentStop.qty_required && (
                <span style={{ color: 'var(--accent-danger)', fontSize: '13px', fontWeight: 700 }}>
                  Set Picked Quantity to {currentStop.qty_required}
                </span>
              )}
              {isConfirmDisabled && (!scannedBin.trim() || !scannedSku.trim()) && (
                <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                  Scan both barcodes above
                </span>
              )}
              <button
                type="button"
                className="btn btn-primary"
                data-testid="pick-confirm-btn"
                onClick={handleConfirmPick}
                disabled={isConfirmDisabled}
              >
                {confirmMutation.isPending ? 'Confirming Pick...' : 'Confirm Pick'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mission completed banner */}
      {mission.status === 'COMPLETED' && (
        <div className="banner banner-success">
          <h3 style={{ margin: '0 0 6px', fontWeight: 700 }}>Mission Completed</h3>
          <p style={{ margin: 0, fontSize: '14px' }}>
            All pick stops have been finished. The order is now ready for packing.
          </p>
        </div>
      )}

      {/* Route Panel */}
      <div className="card">
        <h3 style={{ margin: '0 0 10px', fontSize: '1.1rem', fontWeight: 700 }}>
          Optimized Picking Route ({mission.route.algorithm} · {mission.route.total_distance.toFixed(1)} units)
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px' }}>
          Start at <strong>{mission.route.start}</strong> → visit {mission.stops.length} pick stop{mission.stops.length === 1 ? '' : 's'} in order → finish at <strong>{mission.route.end}</strong>.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
          {mission.route.legs.map((leg, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '13px',
                fontFamily: 'var(--font-mono)'
              }}
            >
              <span>
                Leg {idx + 1}: {leg.path.join(' → ')}
              </span>
              <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>
                {leg.distance.toFixed(1)} u
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Stops Table */}
      <div className="table-container">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface)' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Pick Stops (Visiting Order)</h3>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Seq</th>
              <th>Stop Ref</th>
              <th>Location</th>
              <th>Product</th>
              <th>Required</th>
              <th>Picked</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {mission.stops.map((stop) => (
              <tr key={stop.id} style={currentStop?.id === stop.id ? { backgroundColor: 'var(--accent-primary-container)' } : undefined}>
                <td style={{ fontWeight: 700 }}>
                  {currentStop?.id === stop.id ? `▶ ${stop.seq}` : stop.seq}
                </td>
                <td>
                  <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{stop.stop_ref}</span>
                </td>
                <td>
                  <div>
                    <strong style={{ fontFamily: 'var(--font-mono)' }}>{stop.bin_code}</strong>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Shelf {stop.shelf_code}</div>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{stop.product_name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{stop.sku}</div>
                </td>
                <td style={{ fontWeight: 600 }}>{stop.qty_required}</td>
                <td style={{ fontWeight: 600 }}>{stop.qty_picked}</td>
                <td>
                  <StatusBadge status={stop.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Report Problem Modal */}
      {showProblemModal && currentStop && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h3 style={{ margin: '0 0 12px', fontSize: '1.25rem', fontWeight: 700 }}>Report Problem for Stop {currentStop.stop_ref}</h3>
            <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginBottom: '18px' }}>
              Reporting a problem halts this stop and opens an exception for a warehouse manager. No inventory will be deducted.
            </p>

            {problemError && (
              <div className="banner banner-error" style={{ marginBottom: '16px' }}>
                {problemError}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">
                Problem Type *
              </label>
              <select
                className="select"
                data-testid="problem-type-select"
                value={problemType}
                onChange={(e: any) => setProblemType(e.target.value)}
              >
                <option value="BIN_EMPTY">Bin Empty (No stock found)</option>
                <option value="DAMAGED">Damaged Goods</option>
                <option value="WRONG_PRODUCT">Wrong Product in Bin</option>
                <option value="OTHER">Other Issue</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">
                Notes (Min 3 characters) *
              </label>
              <textarea
                className="input-field"
                rows={3}
                data-testid="problem-notes-input"
                placeholder="Explain the problem clearly for the manager..."
                value={problemNotes}
                onChange={(e) => setProblemNotes(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowProblemModal(false)}
                disabled={reportProblemMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                data-testid="pick-report-submit"
                onClick={handleReportProblem}
                disabled={problemNotes.trim().length < 3 || reportProblemMutation.isPending}
              >
                {reportProblemMutation.isPending ? 'Reporting...' : 'Submit Problem'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

```

### 5.5 `apps/web/src/pages/HomePage.tsx`
```tsx
import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { DashboardDto } from '@dark-storage/shared';

interface HealthStatus {
  gateway: 'ok' | 'down';
  engine1: 'ok' | 'down';
  engine2: 'ok' | 'down';
  engine3: 'ok' | 'down';
}

export const HomePage: React.FC = () => {
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const fetchHealth = async () => {
    try {
      const res = await apiFetch<HealthStatus>('/api/health');
      setHealth(res);
    } catch {
      setHealth({
        gateway: 'down',
        engine1: 'down',
        engine2: 'down',
        engine3: 'down'
      });
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const { data: dashboard, isLoading } = useQuery<DashboardDto>({
    queryKey: ['dashboard'],
    queryFn: () => apiFetch('/api/dashboard'),
    refetchInterval: 15000
  });

  return (
    <div className="m3-page">
      <div className="m3-page-header">
        <div>
          <h1>Warehouse Operations Dashboard</h1>
          <p className="m3-subtitle">
            Real-time metrics, warehouse inventory levels, active missions, and operations throughput.
          </p>
        </div>
      </div>

      {/* Service Health Strip */}
      <div
        className="card"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '14px',
          padding: '16px 20px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`health-dot ${health?.gateway === 'ok' ? 'ok' : 'down'}`} />
          <span style={{ fontSize: '13px' }}><strong style={{ color: 'var(--text-secondary)' }}>Gateway:</strong> {health?.gateway || 'checking...'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`health-dot ${health?.engine1 === 'ok' ? 'ok' : 'down'}`} />
          <span style={{ fontSize: '13px' }}><strong style={{ color: 'var(--text-secondary)' }}>Engine 1 (Scheduler):</strong> {health?.engine1 || 'checking...'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`health-dot ${health?.engine2 === 'ok' ? 'ok' : 'down'}`} />
          <span style={{ fontSize: '13px' }}><strong style={{ color: 'var(--text-secondary)' }}>Engine 2 (Optimizer):</strong> {health?.engine2 || 'checking...'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`health-dot ${health?.engine3 === 'ok' ? 'ok' : 'down'}`} />
          <span style={{ fontSize: '13px' }}><strong style={{ color: 'var(--text-secondary)' }}>Engine 3 (Inventory):</strong> {health?.engine3 || 'checking...'}</span>
        </div>
      </div>

      {/* Metric Tiles */}
      {isLoading || !dashboard ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Loading dashboard metrics...
        </div>
      ) : (
        <>
          <div className="m3-kpi-grid">
            {/* Tile 1: Staged Units */}
            <div className="m3-kpi-card">
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Staged Units
              </span>
              <p style={{ margin: '8px 0 2px', fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)' }} data-testid="tile-staged-units">
                {dashboard.receiving.staged_units}
              </p>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {dashboard.receiving.staged_lines} lines waiting
              </span>
            </div>

            {/* Tile 2: Reserved */}
            <div className="m3-kpi-card">
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Reserved Units
              </span>
              <p style={{ margin: '8px 0 2px', fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent-warning)' }} data-testid="tile-reserved-units">
                {dashboard.inventory.reserved_units}
              </p>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Committed to orders
              </span>
            </div>

            {/* Tile 3: Available */}
            <div className="m3-kpi-card">
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Available (ATP)
              </span>
              <p style={{ margin: '8px 0 2px', fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent-success)' }} data-testid="tile-available-units">
                {dashboard.inventory.available_units}
              </p>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Stored: {dashboard.inventory.stored_units}
              </span>
            </div>

            {/* Tile 4: Pending Orders */}
            <div className="m3-kpi-card">
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Pending Orders
              </span>
              <p style={{ margin: '8px 0 2px', fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)' }} data-testid="tile-pending-orders">
                {dashboard.orders.reserved + dashboard.orders.assigned}
              </p>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Picking: {dashboard.orders.picking} | Picked: {dashboard.orders.picked}
              </span>
            </div>

            {/* Tile 5: Active Missions */}
            <div className="m3-kpi-card">
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Active Missions
              </span>
              <p style={{ margin: '8px 0 2px', fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent-primary)' }} data-testid="tile-active-missions">
                {dashboard.missions.in_progress}
              </p>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Assigned: {dashboard.missions.assigned}
              </span>
            </div>

            {/* Tile 6: Completed Today */}
            <div className="m3-kpi-card">
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Completed Today
              </span>
              <p style={{ margin: '8px 0 2px', fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent-info)' }} data-testid="tile-completed-today">
                {dashboard.orders.completed_today}
              </p>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Total: {dashboard.orders.completed_total}
              </span>
            </div>

            {/* Tile 7: Open Exceptions */}
            <div className="m3-kpi-card">
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Open Exceptions
              </span>
              <p
                style={{
                  margin: '8px 0 2px',
                  fontSize: '1.75rem',
                  fontWeight: 800,
                  color: dashboard.exceptions.open > 0 ? 'var(--accent-danger)' : 'var(--text-primary)'
                }}
                data-testid="tile-open-exceptions"
              >
                {dashboard.exceptions.open}
              </p>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Awaiting manager
              </span>
            </div>
          </div>

          {/* Middle Row: Warehouse Fill Bar + Movements Today */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            {/* Bin Fill Bar */}
            <div className="card">
              <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700 }}>Warehouse Capacity</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Occupied Bins: <strong style={{ color: 'var(--text-primary)' }}>{dashboard.inventory.occupied_bins}</strong> / {dashboard.inventory.total_bins}</span>
                <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{dashboard.inventory.fill_pct}%</span>
              </div>
              <div className="fill-bar" style={{ height: '12px' }}>
                <div
                  className="fill-bar-inner med"
                  style={{ width: `${dashboard.inventory.fill_pct}%` }}
                />
              </div>

              {dashboard.engine && (
                <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '24px', fontSize: '13px', flexWrap: 'wrap' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Scheduler Tasks:</span>{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>{dashboard.engine.queued_tasks} queued, {dashboard.engine.running_tasks} running</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>24h Failures:</span>{' '}
                    <strong style={{ color: dashboard.engine.failed_tasks_24h > 0 ? 'var(--accent-danger)' : 'var(--text-primary)' }}>{dashboard.engine.failed_tasks_24h}</strong>
                  </div>
                </div>
              )}
            </div>

            {/* Movement Summary Today */}
            <div className="card">
              <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700 }}>Today's Movements Throughput</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: '10px', textAlign: 'center' }}>
                <div style={{ backgroundColor: 'var(--bg-surface)', padding: '12px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>RECEIVE</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '4px', color: 'var(--text-primary)' }}>{dashboard.movements.today.RECEIVE}</div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-surface)', padding: '12px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>PUTAWAY</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '4px', color: 'var(--accent-info)' }}>{dashboard.movements.today.PUTAWAY}</div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-surface)', padding: '12px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>PICK</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '4px', color: 'var(--accent-primary)' }}>{dashboard.movements.today.PICK}</div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-surface)', padding: '12px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>RELOCATE</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '4px', color: 'var(--accent-warning)' }}>{dashboard.movements.today.RELOCATE}</div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-surface)', padding: '12px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>ADJUST</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '4px', color: 'var(--accent-danger)' }}>{dashboard.movements.today.ADJUSTMENT}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Latest 10 Movements Table */}
          <div className="table-container">
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface)' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Latest Stock Movements</h3>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Type</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.movements.latest.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                      No movements recorded yet.
                    </td>
                  </tr>
                ) : (
                  dashboard.movements.latest.map((m) => (
                    <tr key={m.ref}>
                      <td><span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{m.ref}</span></td>
                      <td><span className="badge badge-info">{m.type}</span></td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{m.product_name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{m.sku}</div>
                      </td>
                      <td style={{ fontWeight: 700 }}>{m.qty}</td>
                      <td><span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{m.from_label}</span></td>
                      <td><span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{m.to_label}</span></td>
                      <td style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

```

---

## 6. Auth & Demo Seed Mechanics

### 6.1 Frontend Auth Store (`apps/web/src/stores/authStore.ts`)
```typescript
import { create } from 'zustand';
import { Role } from '@dark-storage/shared';

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  role: Role;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const STORAGE_KEY = 'dark_storage_auth';

function getInitialState(): { token: string | null; user: AuthUser | null } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore
  }
  return { token: null, user: null };
}

export const useAuthStore = create<AuthState>((set) => ({
  ...getInitialState(),
  login: (token, user) => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    set({ token, user });
  },
  logout: () => {
    sessionStorage.removeItem(STORAGE_KEY);
    set({ token: null, user: null });
  }
}));

```

### 6.2 Gateway Auth Router (`services/gateway/src/routes/auth.ts`)
```typescript
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { loginRequestSchema } from '@dark-storage/shared';
import { config } from '../config.js';
import { callEngine3 } from '../clients/engine3.js';
import { authMiddleware } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.post('/api/auth/login', async (req, res, next) => {
  try {
    const { username, password } = loginRequestSchema.parse(req.body);

    const { data: user } = await callEngine3<{
      id: number;
      username: string;
      display_name: string;
      role: string;
    }>({
      method: 'POST',
      path: '/internal/v1/auth/verify',
      body: { username, password },
      requestId: req.requestId
    });

    const token = jwt.sign(
      {
        sub: user.id,
        role: user.role,
        name: user.display_name
      },
      config.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role
      }
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({
    id: req.user!.id,
    display_name: req.user!.name,
    role: req.user!.role
  });
});

```

### 6.3 Demo Seed Distribution Mechanics (`scripts/seed-demo.ts`)
- **Initial Verification**: Inspects `SELECT COUNT(*) FROM receipts`. If receipts exist, it aborts to avoid duplicate inventory or corrupted audit trails.
- **Operator Identity**: Authenticates action as `operator1` (Operator role).
- **Standard Inbound Intake**:
  - Generates receipt `ASN-DEMO-STD-001` for standard products `SKU001` through `SKU022`.
  - Inbound quantities follow: $Q(k) = 40 + (k mod 5) 	imes 10$.
  - For `SKU001`, 10 extra units are received ($50 + 10 = 60$) and left staged at dock to demonstrate active receiving queue items.
- **Deterministic Slotting Allocation**:
  - Distributes the 22 SKUs across Aisles A, B, and C:
    - $	ext{Aisle} = [	ext{'A'}, 	ext{'B'}, 	ext{'C'}][(k - 1) mod 3]$
    - $	ext{Bay} = (lfloor(k - 1) / 3floor mod 6) + 1$
    - $	ext{Level} = lfloor(k - 1) / 18floor + 1$
  - If shelf `B-06-L` is encountered (marked MAINTENANCE in base seed), it automatically diverts to the opposite side (`B-06-R`).
- **HAZMAT Inbound Intake & Quarantine**:
  - Generates receipt `ASN-DEMO-HAZ-001` for hazardous SKUs `SKU023` and `SKU024` (30 units each).
  - Slots both directly into Aisle D Bay 1 (`D-01-L-1` and `D-01-R-1`), strictly adhering to the database-level `inventory_storage_class` trigger invariant.

---

## 7. Current Test & Integrity Status

### 7.1 PRD Deviations (`docs/PRD_DEVIATIONS.md`)
```markdown
# PRD Deviations

This file logs any design choices or minor deviations necessitated by technical constraints or PRD ambiguities, in accordance with Section 0.3.

1. **better-sqlite3 version on Node 24 (Windows x64):**
   - The environment is Node v24.15.0 on Windows x64.
   - `better-sqlite3` 11.x does not provide prebuilt binaries for Node 24, requiring Visual Studio C++ build tools which are not installed on the system.
   - In accordance with Section 3 ("If better-sqlite3 fails to install on Windows, install the newest better-sqlite3 release"), `better-sqlite3` was upgraded to `^13.0.3` which includes official prebuilt binaries for Node 24 on Windows x64.

```

### 7.2 Environment & Sandbox Boundaries (`docs/BLOCKERS.md`)
```markdown
# Environment & Dependency Blockers Log

This document records environmental, OS, network, or sandbox boundaries encountered during development and verification, alongside the sanctioned fallback implementations mandated by the Dark Storage Core WMS PRD.

---

## 1. Chromium Headless Binary Installation (PRD §10.3 Fallback Rule)

- **Dependency:** Playwright headless Chromium browser binary.
- **Encountered Condition:** Local machine and sandbox network environment restricts downloading external browser binaries (`playwright install chromium` / node module binary packaging).
- **PRD Fallback Protocol Applied:** Section 10.3 specifies:
  > *"If Chromium binary installation is blocked by a restricted network/sandbox environment, log the exact error in `docs/BLOCKERS.md` and execute the identical step-by-step UI state & DOM flow using `@testing-library/react` + `jsdom` against the live backend stack (`startStack()`), verifying every `data-testid` interaction end-to-end."*
- **Resolution & Verification:**
  - Implemented and executed `P10-T09` in `tests/e2e/e2e.test.ts` driving all role transitions, authorization checks, state transitions, and persistent database effects across `operator1`, `manager1`, `picker1`, and `staff1`.
  - Frontend component contract tests (`P2-T20`, `P3-T14/15`, `P5-T29`, `P6-T19`, `P7-T19`, `P8-T25`, `P9-T14`) verify all UI layout rules, test IDs (`data-testid`), and interaction states.
  - Full production web build (`npm run build -w apps/web`) compiles cleanly via TypeScript and Vite with zero warnings or errors.

```

### 7.3 Verification Command Output: `npm run verify:integrity`
```text
> dark-storage-wms@1.0.0 verify:integrity
> tsx scripts/verify-integrity.ts

Running integrity checks on ./data/warehouse.db...
[PASS] I01: stock bounds
[PASS] I02: reserved = Σ outstanding HELD
[PASS] I03: sku ⇔ qty
[PASS] I04: bin qty = ledger
[PASS] I05: staging = ledger
[PASS] I06: put-away totals
[PASS] I07: picked = consumed
[PASS] I08: terminal orders hold nothing
[PASS] I09: completed missions finished
[PASS] I10: held reservations have a live stop
[PASS] I11: foreign keys
[PASS] I12: sqlite integrity
[PASS] I13: one SKU per reserved SKU
Integrity checks PASSED.
```

### 7.4 Test Suite Summary
- **Unit & Integration Test Suite**: 9 test suites, 176 passed out of 176 (100% pass rate).
- **End-to-End Suite**: `tests/e2e/e2e.test.ts` passes all 9 end-to-end integration workflows.
- **Frontend Build**: `npm run build -w @dark-storage/web` builds clean TypeScript and Vite assets with zero errors.
