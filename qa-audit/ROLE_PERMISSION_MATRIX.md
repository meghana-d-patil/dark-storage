# Dark Storage WMS — Role & Permission Verification Matrix

**Audit Date:** 2026-11-11  
**Tested Roles:**
1. `MANAGER` (`manager1`)
2. `OPERATOR` (`operator1`)
3. `PICKER` (`picker1`)
4. `STAFF` (`staff1`)

---

| Page / Operation | MANAGER | OPERATOR | PICKER | STAFF | Notes / Backend Enforcement |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Login (`/login`)** | Allowed | Allowed | Allowed | Allowed | All roles authenticate via JWT |
| **Dashboard (`/`)** | Allowed | Allowed | Allowed | Allowed | Live event feed visible |
| **Warehouse View (`/warehouse`)** | Allowed | Allowed | Allowed | Allowed | Modes 1, 2, 3 accessible |
| **Inventory Ledger (`/inventory`)** | Allowed | Allowed | Allowed | Allowed | Read inventory & movements |
| **Print Barcode Labels** | Allowed | Allowed | Allowed | Allowed | Modal available to all |
| **Receiving Intake (`/receiving`)** | Allowed | Allowed | Denied | Denied | Requires MANAGER or OPERATOR |
| **Recommend Placement (Engine 2)** | Allowed | Allowed | Denied | Denied | Requires MANAGER or OPERATOR |
| **Confirm Put-Away (`/receiving`)** | Allowed | Allowed | Denied | Denied | Requires MANAGER or OPERATOR |
| **Create Order (`/orders/new`)** | Allowed | Denied | Denied | Denied | Requires MANAGER |
| **Cancel Order (`/orders/:ref`)** | Allowed | Denied | Denied | Denied | Requires MANAGER |
| **Dispatch / Assign Picker** | Allowed | Denied | Denied | Denied | Requires MANAGER |
| **Picking List (`/picking`)** | Allowed | Denied | Allowed | Denied | Requires MANAGER or PICKER |
| **Confirm Pick Stop (`/picking/:ref`)** | Allowed | Denied | Allowed | Denied | Assigned picker or Manager |
| **Report Pick Exception** | Allowed | Denied | Allowed | Denied | Assigned picker or Manager |
| **Packing Queue (`/packing`)** | Allowed | Allowed | Denied | Denied | Requires MANAGER or OPERATOR |
| **Exceptions Queue (`/exceptions`)** | Allowed | Allowed | Denied | Denied | Requires MANAGER or OPERATOR |
| **Task Queue (`/tasks`)** | Allowed | Allowed | Denied | Denied | Engine 1 Scheduler view |
| **Admin & Stress Lab (`/admin`)** | Allowed | Denied | Denied | Denied | Requires MANAGER |
