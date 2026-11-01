# Dark Storage WMS

Core warehouse workflow system built with Node.js, TypeScript, Express, SQLite (better-sqlite3), and React.

## Starting the Stack
1. Install dependencies:
   ```bash
   npm install
   ```
2. Run database migrations:
   ```bash
   npm run db:migrate
   ```
3. Seed base data (users, products, layout, nav graph):
   ```bash
   npm run db:seed
   ```
4. Start all services and the web UI:
   ```bash
   npm run dev
   ```

## Default Accounts (Password: `Warehouse#2026`)
- `manager1` (Role: `MANAGER`, Name: "Maya Manager")
- `operator1` (Role: `OPERATOR`, Name: "Omar Operator")
- `picker1` (Role: `PICKER`, Name: "Priya Picker")
- `picker2` (Role: `PICKER`, Name: "Pablo Picker")
- `staff1` (Role: `STAFF`, Name: "Sana Staff")

## Commands
- `npm run dev` - Start all 4 backend engines + Web UI concurrently
- `npm run db:migrate` - Apply pending migrations
- `npm run db:seed` - Seed base data idempotently
- `npm run db:seed:demo` - Seed optional demo stock through Engine 3
- `npm run db:backup` - Backup SQLite database via VACUUM INTO
- `npm run verify:integrity` - Run all warehouse integrity invariants
- `npm run test` - Run test suite with Vitest
