# PROGRESS

## Phase 0: Recon and baseline (MUST)
- [x] P0-T1 Tracking files
- [x] P0-T2 Commands
- [x] P0-T3 Answer B.5
- [x] P0-T4 Route inventory
- [x] P0-T5 Baseline run

## Phase 1: Foundations (MUST)
- [x] P1-T1 Test harness
- [x] P1-T2 Migration 010 `users` rebuild
- [x] P1-T3 Seed users
- [x] P1-T4 Migration 011
- [x] P1-T5 Shared lib
- [x] P1-T6 Engine 3 plumbing
- [x] P1-T7 Gateway plumbing
- [x] P1-T8 Unit tests

## Phase 2: RBAC enforcement and removal of Manager execution powers (MUST)
- [x] P2-T1 Guard the gateway
- [x] P2-T2 Remove Manager powers and D11 endpoints
- [x] P2-T3 Web permissions layer
- [x] P2-T4 Remove buttons the Manager must not see
- [x] P2-T5 Role switcher

## Phase 3: Hash-chained audit log and order events (MUST)
- [ ] P3-T1 Migration 012
- [ ] P3-T2 `appendAudit`
- [ ] P3-T3 Backfill
- [ ] P3-T4 Replace old audit writes
- [ ] P3-T5 Endpoints
- [ ] P3-T6 Web
- [ ] P3-T7 Tests

## Phase 4: Append-only stock ledger (MUST)
- [ ] P4-T1 Migration 013 product attributes
- [ ] P4-T2 Migration 014 ledger
- [ ] P4-T3 Opening backfill (code, not SQL)
- [ ] P4-T4 `postLedger`
- [ ] P4-T5 Rewire existing flows one at a time
- [ ] P4-T6 Reconcile + ledger read
- [ ] P4-T7 Guard test
- [ ] P4-T8 Property test

## Phase 5: Totes, claim, leases, floor tasks, 3-step picking (MUST)
- [ ] P5-T1 Migration 015
- [ ] P5-T2 Claim next mission
- [ ] P5-T3 Heartbeat, release, force-unassign
- [ ] P5-T4 Lease sweep job
- [ ] P5-T5 Picker read endpoint
- [ ] P5-T6 Scan endpoints
- [ ] P5-T7 Floor task endpoints (generic)
- [ ] P5-T8 Web: picker screens (plain)
- [ ] P5-T9 Tests

## Phase 6: Packing and dispatch (MUST)
- [ ] P6-T1 Migration 016 orders rebuild
- [ ] P6-T2 Migration 017
- [ ] P6-T3 Open pack session
- [ ] P6-T4 Item scans
- [ ] P6-T5 Flag item
- [ ] P6-T6 Weigh + complete
- [ ] P6-T7 Dispatch
- [ ] P6-T8 Web
- [ ] P6-T9 Tests

## Phase 7: Exception loop, dual-control adjustments, quarantine, relocation (MUST)
- [ ] P7-T1 Migration 018
- [ ] P7-T2 Picker raises exception
- [ ] P7-T3 Blind count
- [ ] P7-T4 Adjustments API
- [ ] P7-T5 Damage flag
- [ ] P7-T6 Manager exception actions
- [ ] P7-T7 Escalation job
- [ ] P7-T8 Relocation
- [ ] P7-T9 Cancel before pick
- [ ] P7-T10 Web
- [ ] P7-T11 Tests

---
TODO:
- [ ] P2-T3 role redirects: update role redirects in `LoginPage.tsx` when `/floor/pick`, `/floor/pack`, `/floor/operator`, `/floor/dispatch`, `/audit` are implemented in P5/P6/P7/P12.

next: P3-T1 Migration 012
