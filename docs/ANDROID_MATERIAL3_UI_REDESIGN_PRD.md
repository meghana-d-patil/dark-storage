# DARK STORAGE WMS — ANDROID MATERIAL 3 ("MATERIAL YOU") UI/UX REDESIGN PRD

**Document type:** Frontend Visual Overhaul Specification for Gemini 3.8 Flash
**Scope:** `apps/web/` ONLY (`index.html`, `src/theme.css`, `src/components/*`, `src/pages/*`).
**Strict Non-Regression Rule:** Zero changes to backend services, API payloads, React state hooks, routing paths, or any of the 130 `data-testid` attributes.

---

## 0. CRITICAL RULES FOR THE AGENT

1. **DO NOT touch backend code (`services/`, `packages/`, `migrations/`).**
2. **DO NOT remove, rename, or alter ANY `data-testid` attribute.** Every `data-testid` in `docs/FRONTEND_AUDIT_FOR_REDESIGN.md` (§6.1) must remain on the exact same interactive element.
3. **DO NOT change API endpoints, query keys, or form validation logic.**
4. **Work in 3 sequential steps:**
   - **Step 1:** Update `apps/web/index.html` (load Google Fonts `Plus Jakarta Sans` and `JetBrains Mono`) and replace `apps/web/src/theme.css` with the complete Android Material 3 stylesheet in §2 below.
   - **Step 2:** Upgrade `AppShell.tsx`, `StatusBadge.tsx`, `ProductLabel.tsx`, and `AllocationModal.tsx` to use the new Material 3 classes and pill navigation.
   - **Step 3:** Clean up inline styles (`style={{ ... }}`) across the 14 pages in `apps/web/src/pages/` so they use the clean semantic classes (`.m3-page`, `.m3-card`, `.m3-kpi-grid`, `.m3-kpi-card`, `.m3-toolbar`, `.table-container`, `.banner`, `.btn`, `.form-control`) instead of hardcoded pixel/color styles.
5. **Verify:** Run `npm run build --workspace=@dark-storage/web` (or `npx tsc --noEmit` in `apps/web`) and `npm run test` to prove zero TypeScript or test regressions.

---

## 1. DESIGN SYSTEM: ANDROID 15 / MATERIAL 3 DARK ("MATERIAL YOU")

### 1.1 Typography (`apps/web/index.html`)
Add Google Fonts to `<head>` in `apps/web/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Dark Storage WMS</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### 1.2 Android Material 3 Shape & Surface Principles
- **Tonal Surface Hierarchy (High Visibility):**
  - App Canvas (`--bg-primary`): `#0b0f17` (Deep Obsidian)
  - Elevated Surface 1 / Cards (`--bg-secondary` & `--color-bg-card`): `#151c28` (Rich Slate Surface)
  - Elevated Surface 2 / Inputs & Table Headers (`--bg-surface`): `#1e2738` (Tonal Container)
  - Hover / Active Surface (`--bg-surface-hover`): `#28344a`
  - Subtle Hairline Borders (`--border-color`): `rgba(148, 163, 184, 0.16)`
- **High-Contrast Text (WCAG AAA/AA Compliant):**
  - Primary Text (`--text-primary`): `#f8fafc` (Crisp Alabaster White)
  - Secondary Text (`--text-secondary`): `#cbd5e1` (Bright Cool Silver — 10.5:1 contrast)
  - Muted / Label Text (`--text-muted`): `#94a3b8` (6.2:1 contrast — never dim/unreadable)
- **Android Rounded Corners:**
  - Cards & Containers: `20px` (`--radius-lg`)
  - Modals & Drawers: `28px` (`--radius-xl`)
  - Inputs & Selects: `14px` (`--radius-md`)
  - Buttons, Nav Items, Tabs & Status Badges: `9999px` (`--radius-pill` — true Android pill shape)

---

## 2. COMPLETE REPLACEMENT FOR `apps/web/src/theme.css`

Replace the entire contents of `apps/web/src/theme.css` with the stylesheet below.

```css
:root {
  /* Material 3 Dark Tonal Surfaces */
  --bg-primary: #0b0f17;
  --bg-secondary: #151c28;
  --bg-surface: #1e2738;
  --bg-surface-hover: #28344a;
  --bg-elevated: #232e42;

  /* Borders & Dividers */
  --border-color: rgba(148, 163, 184, 0.16);
  --border-strong: rgba(148, 163, 184, 0.28);

  /* High-Visibility Typography Colors (WCAG AA/AAA) */
  --text-primary: #f8fafc;
  --text-secondary: #cbd5e1;
  --text-muted: #94a3b8;

  /* Material You Vibrant Accents */
  --accent-primary: #6366f1;
  --accent-primary-hover: #818cf8;
  --accent-primary-container: rgba(99, 102, 241, 0.18);
  --accent-success: #10b981;
  --accent-warning: #f59e0b;
  --accent-danger: #ef4444;
  --accent-info: #06b6d4;

  /* CRITICAL ALIASES FOR PAGES USING --color-* OR --accent / --border */
  --color-bg-card: var(--bg-secondary);
  --color-bg-hover: var(--bg-surface-hover);
  --color-primary: var(--accent-primary);
  --color-success: var(--accent-success);
  --color-warning: var(--accent-warning);
  --color-danger: var(--accent-danger);
  --color-info: var(--accent-info);
  --color-text-primary: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-border: var(--border-color);
  --accent: var(--accent-primary);
  --border: var(--border-color);

  /* Android Material 3 Shape Radii */
  --radius-xs: 8px;
  --radius-sm: 12px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-xl: 28px;
  --radius-pill: 9999px;

  /* Elevation Shadows */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.28);
  --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.38);
  --shadow-lg: 0 20px 48px rgba(0, 0, 0, 0.6);

  /* Fonts */
  --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  background-color: var(--bg-primary);
  background-image: radial-gradient(circle at 15% 0%, rgba(99, 102, 241, 0.08), transparent 45%),
                    radial-gradient(circle at 85% 100%, rgba(6, 182, 212, 0.06), transparent 45%);
  background-attachment: fixed;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 14.5px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Custom Scrollbars */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: var(--bg-primary);
}
::-webkit-scrollbar-thumb {
  background: var(--bg-surface-hover);
  border-radius: var(--radius-pill);
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

/* Typography Hierarchy */
h1 {
  font-size: 1.65rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  line-height: 1.25;
}
h2 {
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--text-primary);
}
h3 {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}
h4 {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-secondary);
}

a {
  color: #818cf8;
  text-decoration: none;
  font-weight: 600;
  transition: color 0.15s ease;
}
a:hover {
  color: #a5b4fc;
  text-decoration: underline;
}

.text-muted {
  color: var(--text-muted) !important;
}

/* ==========================================================================
   APP SHELL LAYOUT (Android Tablet / Desktop Navigation Rail + Top Bar)
   ========================================================================== */
.app-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.header {
  height: 68px;
  background-color: rgba(21, 28, 40, 0.85);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-brand {
  font-weight: 800;
  font-size: 1.15rem;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-brand-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 16px;
  color: #fff;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.user-badge {
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.main-body {
  display: flex;
  flex: 1;
}

.sidebar {
  width: 248px;
  background-color: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Material 3 Pill Navigation Link */
.nav-link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 18px;
  color: var(--text-secondary);
  text-decoration: none !important;
  font-weight: 600;
  font-size: 14px;
  border-radius: var(--radius-pill);
  border-left: none;
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.nav-link:hover {
  color: var(--text-primary);
  background-color: var(--bg-surface);
}

.nav-link.active {
  color: #ffffff;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.9) 0%, rgba(79, 70, 229, 0.9) 100%);
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
}

.content-area {
  flex: 1;
  padding: 28px 32px;
  overflow-y: auto;
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
}

/* ==========================================================================
   CARDS, CONTAINERS & PAGE WRAPPERS
   ========================================================================== */
.m3-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 1280px;
  margin: 0 auto;
}

.m3-page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.m3-subtitle {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 0.92rem;
}

.card, .m3-card {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 22px 24px;
  box-shadow: var(--shadow-sm);
  margin-bottom: 0;
}

.m3-toolbar {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  padding: 16px 20px;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.m3-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
  gap: 16px;
}

.m3-kpi-card {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s ease, border-color 0.2s ease;
}
.m3-kpi-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
}

/* ==========================================================================
   UNIFIED INPUTS, SELECTS & TEXTAREAS (Fixes .form-control, .input, .select)
   ========================================================================== */
button, input, select, textarea {
  font-family: inherit;
  font-size: inherit;
  color: inherit;
}

.input-field,
.form-control,
.input,
.select,
input[type="text"],
input[type="number"],
input[type="password"],
input[type="datetime-local"],
select,
textarea {
  width: 100%;
  padding: 10px 15px;
  background-color: var(--bg-surface);
  border: 1.5px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
  outline: none;
  transition: all 0.18s ease;
}

input[type="checkbox"],
input[type="radio"] {
  width: 18px;
  height: 18px;
  accent-color: var(--accent-primary);
  cursor: pointer;
}

.input-field:hover,
.form-control:hover,
.input:hover,
.select:hover,
select:hover,
textarea:hover {
  border-color: var(--border-strong);
}

.input-field:focus,
.form-control:focus,
.input:focus,
.select:focus,
input:focus,
select:focus,
textarea:focus {
  border-color: var(--accent-primary);
  background-color: var(--bg-elevated);
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.18);
}

input::placeholder,
textarea::placeholder {
  color: var(--text-muted);
  opacity: 0.85;
}

select option {
  background-color: var(--bg-secondary);
  color: var(--text-primary);
  padding: 8px;
}

.form-group {
  margin-bottom: 18px;
}

label,
.form-label {
  display: block;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
  margin-bottom: 6px;
}

/* ==========================================================================
   ANDROID PILL BUTTONS (.btn, .btn-primary, .btn-secondary, .btn-danger)
   ========================================================================== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 20px;
  font-weight: 700;
  font-size: 13.5px;
  letter-spacing: 0.01em;
  border-radius: var(--radius-pill);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.18s cubic-bezier(0.2, 0, 0, 1);
  user-select: none;
  white-space: nowrap;
}

.btn:active:not(:disabled) {
  transform: scale(0.97);
}

.btn-sm {
  padding: 6px 14px;
  font-size: 12.5px;
}

.btn-primary {
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}
.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #818cf8 0%, #6366f1 100%);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.45);
}

.btn-secondary {
  background-color: var(--bg-surface);
  border-color: var(--border-strong);
  color: var(--text-primary);
}
.btn-secondary:hover:not(:disabled) {
  background-color: var(--bg-surface-hover);
}

.btn-warning {
  background-color: rgba(245, 158, 11, 0.2);
  border-color: rgba(245, 158, 11, 0.45);
  color: #fcd34d;
}
.btn-warning:hover:not(:disabled) {
  background-color: rgba(245, 158, 11, 0.32);
}

.btn-danger {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.25);
}
.btn-danger:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
}

/* ==========================================================================
   MATERIAL 3 TONAL PILL BADGES (Covers all status strings)
   ========================================================================== */
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 12px;
  font-size: 11.5px;
  font-weight: 700;
  border-radius: var(--radius-pill);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1.3;
  background-color: var(--bg-surface);
  color: var(--text-secondary);
  border: 1px solid var(--border-strong);
}

.badge-active, .badge-ok, .badge-success, .badge-completed, .badge-picked, .badge-succeeded, .badge-full, .badge-resolved {
  background-color: rgba(16, 185, 129, 0.16);
  color: #6ee7b7;
  border-color: rgba(16, 185, 129, 0.35);
}

.badge-warning, .badge-maintenance, .badge-pending, .badge-in-progress, .badge-picking, .badge-assigned, .badge-running, .badge-queued, .badge-partially-put-away, .badge-partial {
  background-color: rgba(245, 158, 11, 0.16);
  color: #fcd34d;
  border-color: rgba(245, 158, 11, 0.35);
}

.badge-danger, .badge-blocked, .badge-damaged, .badge-failed, .badge-cancelled, .badge-down, .badge-open, .badge-exception-open {
  background-color: rgba(239, 68, 68, 0.18);
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.4);
}

.badge-info, .badge-primary, .badge-staged, .badge-reserved, .badge-put-away, .badge-receive, .badge-putaway, .badge-pick, .badge-relocate, .badge-adjustment {
  background-color: rgba(99, 102, 241, 0.18);
  color: #a5b4fc;
  border-color: rgba(99, 102, 241, 0.38);
}

.badge-secondary, .badge-consumed, .badge-released {
  background-color: rgba(148, 163, 184, 0.14);
  color: var(--text-secondary);
  border-color: rgba(148, 163, 184, 0.28);
}

/* ==========================================================================
   BANNERS & ALERTS (Fixes .banner, .banner-*, .alert, .alert-*)
   ========================================================================== */
.banner, .alert {
  padding: 16px 20px;
  border-radius: var(--radius-lg);
  font-size: 14px;
  font-weight: 500;
  border: 1px solid var(--border-color);
  background-color: var(--bg-surface);
  color: var(--text-primary);
}

.banner-success, .alert-success {
  background-color: rgba(16, 185, 129, 0.14);
  border-color: rgba(16, 185, 129, 0.4);
  color: #a7f3d0;
}

.banner-error, .alert-danger {
  background-color: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.45);
  color: #fecaca;
}

.banner-info, .alert-info {
  background-color: rgba(6, 182, 212, 0.14);
  border-color: rgba(6, 182, 212, 0.4);
  color: #a5f3fc;
}

.alert-warning {
  background-color: rgba(245, 158, 11, 0.14);
  border-color: rgba(245, 158, 11, 0.4);
  color: #fde68a;
}

/* ==========================================================================
   TABLES (Rounded Material Containers + Crisp Readability)
   ========================================================================== */
.table-container {
  overflow-x: auto;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  background-color: var(--bg-secondary);
  box-shadow: var(--shadow-sm);
}

table, .table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

th {
  background-color: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}

td {
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: 14px;
  vertical-align: middle;
}

tr:last-child td {
  border-bottom: none;
}

tbody tr {
  transition: background-color 0.12s ease;
}

tbody tr:hover td {
  background-color: rgba(255, 255, 255, 0.035);
}

/* Product Label */
.product-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.product-name {
  font-weight: 600;
  color: var(--text-primary);
}
.product-separator {
  color: var(--text-muted);
}
.product-sku {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: #a5b4fc;
  background-color: rgba(99, 102, 241, 0.14);
  padding: 2px 8px;
  border-radius: 6px;
}

/* Health Dot */
.health-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  margin-right: 8px;
}
.health-dot.ok {
  background-color: var(--accent-success);
  box-shadow: 0 0 10px var(--accent-success);
}
.health-dot.down {
  background-color: var(--accent-danger);
  box-shadow: 0 0 10px var(--accent-danger);
}

/* ==========================================================================
   ANDROID SEGMENTED PILL TABS (.tabs, .tab-btn)
   ========================================================================== */
.tabs {
  display: inline-flex;
  gap: 6px;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  padding: 6px;
  border-radius: var(--radius-pill);
  margin-bottom: 8px;
  align-self: flex-start;
  flex-wrap: wrap;
}

.tab-btn {
  background: none;
  border: none;
  border-radius: var(--radius-pill);
  padding: 8px 20px;
  color: var(--text-secondary);
  font-weight: 700;
  font-size: 13.5px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.tab-btn:hover {
  color: var(--text-primary);
  background-color: rgba(255, 255, 255, 0.04);
}

.tab-btn.active {
  color: #ffffff;
  background-color: var(--accent-primary);
  box-shadow: 0 2px 10px rgba(99, 102, 241, 0.35);
}

/* ==========================================================================
   FILL BARS & PROGRESS BARS
   ========================================================================== */
.fill-bar-container {
  display: flex;
  align-items: center;
  gap: 10px;
}
.fill-bar {
  flex: 1;
  height: 10px;
  background-color: var(--bg-surface);
  border-radius: var(--radius-pill);
  overflow: hidden;
  min-width: 72px;
}
.fill-bar-inner {
  height: 100%;
  border-radius: var(--radius-pill);
  transition: width 0.3s ease;
}
.fill-bar-inner.empty { background-color: var(--text-muted); width: 0%; }
.fill-bar-inner.low { background-color: var(--accent-info); }
.fill-bar-inner.med { background-color: var(--accent-primary); }
.fill-bar-inner.high { background-color: var(--accent-warning); }
.fill-bar-inner.full { background-color: var(--accent-success); }

/* ==========================================================================
   MODALS & DRAWERS (Fixes both .modal and .modal-content)
   ========================================================================== */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(5, 8, 14, 0.78);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 1000;
}

.modal-content, .modal {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl);
  padding: 28px;
  width: 100%;
  max-width: 520px;
  box-shadow: var(--shadow-lg);
}

.drawer-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(5, 8, 14, 0.72);
  backdrop-filter: blur(6px);
  display: flex;
  justify-content: flex-end;
  z-index: 999;
}

.drawer-content {
  width: 100%;
  max-width: 500px;
  background-color: var(--bg-secondary);
  border-left: 1px solid var(--border-strong);
  border-top-left-radius: var(--radius-xl);
  border-bottom-left-radius: var(--radius-xl);
  height: 100%;
  overflow-y: auto;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  box-shadow: var(--shadow-lg);
}

/* ==========================================================================
   WAREHOUSE 2D MAP (High-Contrast Interactive Grid)
   ========================================================================== */
.warehouse-container {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.warehouse-controls {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}
.warehouse-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
  gap: 22px;
  padding-bottom: 24px;
}
.aisle-col {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: var(--shadow-sm);
}
.aisle-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 10px;
}
.shelves-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 12px;
}
.shelf-card {
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.shelf-card.shelf-maintenance {
  border-color: var(--accent-warning);
  box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.3);
}
.shelf-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
}
.bin-cells {
  display: flex;
  flex-direction: column-reverse;
  gap: 5px;
}
.bin-cell {
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-mono);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}
.bin-cell:hover {
  transform: scale(1.03);
  filter: brightness(1.18);
}
.bin-cell.highlight {
  border-color: #ffffff;
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.85);
}
.bin-cell.status-blocked {
  background-color: rgba(239, 68, 68, 0.25);
  border-color: var(--accent-danger);
  color: #fca5a5;
}
.bin-cell.status-damaged {
  background-color: rgba(220, 38, 38, 0.38);
  border-color: #ef4444;
  color: #fecaca;
}
.bin-cell.status-maintenance {
  background-color: rgba(245, 158, 11, 0.2);
  border-color: var(--accent-warning);
  color: #fde68a;
}
.bin-cell.status-recount {
  background-color: rgba(245, 158, 11, 0.28);
  border-color: var(--accent-warning);
  color: #fcd34d;
}
.bin-cell.fill-empty {
  background-color: rgba(15, 23, 42, 0.75);
  border-color: rgba(148, 163, 184, 0.12);
  color: var(--text-muted);
}
.bin-cell.fill-low {
  background-color: rgba(6, 182, 212, 0.24);
  border-color: rgba(6, 182, 212, 0.4);
  color: #a5f3fc;
}
.bin-cell.fill-med {
  background-color: rgba(99, 102, 241, 0.26);
  border-color: rgba(99, 102, 241, 0.45);
  color: #c7d2fe;
}
.bin-cell.fill-high {
  background-color: rgba(245, 158, 11, 0.26);
  border-color: rgba(245, 158, 11, 0.45);
  color: #fde68a;
}
.bin-cell.fill-full {
  background-color: rgba(16, 185, 129, 0.26);
  border-color: rgba(16, 185, 129, 0.45);
  color: #a7f3d0;
}

.warehouse-legend {
  display: flex;
  gap: 18px;
  align-items: center;
  flex-wrap: wrap;
  padding: 14px 20px;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.legend-box {
  width: 16px;
  height: 16px;
  border-radius: 5px;
}
