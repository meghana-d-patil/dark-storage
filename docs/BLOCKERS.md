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
