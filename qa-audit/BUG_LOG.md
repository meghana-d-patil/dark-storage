# Dark Storage WMS — Live Bug Log

**Status:** AUDIT-ONLY PHASE (Discovery & Documentation)  
**Total Discovered:** 2 (P0: 0, P1: 0, P2: 0, P3: 2)

---

### [BUG-001] Packing Page: Operator Role Disabled State Lacks Informative Banner
- **Severity:** P3 (Low / UX Ergonomics)
- **Page / Role:** Packing (`/packing`) (Operator)
- **API / Engine:** Frontend RBAC check (`canPack = isManager || isStaff`)
- **Database:** N/A
- **Steps:**
  1. Log in as `operator1` (Role: `OPERATOR`).
  2. Navigate to `/packing`.
  3. Select an order in the packing queue.
- **Expected:** An alert banner should clearly explain why the "Confirm Packing" button is disabled (e.g., *"Staff or Manager credentials required to complete packing verification"*).
- **Actual:** The Confirm Packing button is disabled silently with no explicit tooltip or explanation for the Operator role.
- **Evidence:** `qa-audit/EVIDENCE/11-packing-operator-blocked.png`

---

### [BUG-002] New Order Line Quantity Input Default Concatenation
- **Severity:** P3 (Low / Warehouse Operator Ergonomics)
- **Page / Role:** New Order (`/orders/new`) (Manager)
- **API / Engine:** Frontend `NewOrderPage.tsx`
- **Database:** N/A
- **Steps:**
  1. Open `/orders/new`.
  2. Choose a product.
  3. Click the quantity input (defaulting to `1`) and type `3` without manually hitting Backspace.
- **Expected:** In high-speed warehouse data entry, clicking or focusing the field should auto-select the initial `1` so typing replaces it directly with `3`.
- **Actual:** Value becomes `13` because `3` appends after `1`.
- **Evidence:** `qa-audit/EVIDENCE/06-order-creation-form.png`

