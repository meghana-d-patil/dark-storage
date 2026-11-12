/**
 * Baseline smoke script for Dark Storage WMS.
 * Uses plain fetch (Node 18+), zero external runtime dependencies.
 * Logs in, checks orders, and checks inventory summary.
 * Exits with code 0 on success, non-zero on error.
 */

const BASE_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:4000';

async function main() {
  console.log(`[Smoke] Testing Gateway at ${BASE_URL}...`);

  // 1. Health check
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  if (!healthRes.ok) {
    throw new Error(`Health check failed with status ${healthRes.status}`);
  }
  const health = await healthRes.json();
  console.log('[Smoke] Health:', JSON.stringify(health));

  // 2. Login as existing seeded users and new P1-T3 users
  const legacyUsers = ['manager1', 'staff1'];
  const newUsers = ['admin', 'manager', 'operator1', 'operator2', 'picker1', 'picker2', 'picker3', 'packer1', 'dispatch1', 'auditor1'];
  let managerToken = '';

  for (const username of legacyUsers) {
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password: process.env.SEED_DEFAULT_PASSWORD || 'Warehouse#2026'
      })
    });
    if (!loginRes.ok) {
      throw new Error(`Login failed for legacy ${username} (${loginRes.status})`);
    }
    const loginData = await loginRes.json();
    if (!Array.isArray(loginData.permissions) || loginData.permissions.length === 0) {
      throw new Error(`Login for ${username} did not return permissions array`);
    }
    console.log(`[Smoke] Logged in as ${loginData.user?.username} (${loginData.user?.role}) with ${loginData.permissions.length} perms`);
    if (username === 'manager1') managerToken = loginData.token;
  }

  for (const username of newUsers) {
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password: 'demo1234'
      })
    });
    if (!loginRes.ok) {
      throw new Error(`Login failed for new user ${username} (${loginRes.status})`);
    }
    const loginData = await loginRes.json();
    if (!Array.isArray(loginData.permissions) || loginData.permissions.length === 0) {
      throw new Error(`Login for ${username} did not return permissions array`);
    }
    console.log(`[Smoke] Logged in as ${loginData.user?.username} (${loginData.user?.role}) with ${loginData.permissions.length} perms`);
    if (username === 'manager') managerToken = loginData.token;
  }

  // 3. Verify Manager RBAC constraints: 410 on removed endpoints, 403 on physical execution
  const d11Checks = [
    { method: 'POST', path: '/api/orders/ORD-001/pack' },
    { method: 'POST', path: '/api/packing/ORD-001/pack' },
    { method: 'POST', path: '/api/pick-stops/STP-001/confirm' },
    { method: 'POST', path: '/api/inventory/bins/A-01-01/recount' },
    { method: 'POST', path: '/api/orders/ORD-001/assign' }
  ];

  for (const check of d11Checks) {
    const res = await fetch(`${BASE_URL}${check.path}`, {
      method: check.method,
      headers: {
        Authorization: `Bearer ${managerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    if (res.status !== 410) {
      throw new Error(`Expected 410 for removed ${check.path}, got ${res.status}`);
    }
  }
  console.log('[Smoke] Verified all 5 D11 endpoints return 410 ENDPOINT_REMOVED');

  const executeChecks = [
    { method: 'POST', path: '/api/receipts', body: { lines: [] } },
    { method: 'POST', path: '/api/putaways', body: {} },
    { method: 'POST', path: '/api/inventory/relocate', body: {} },
    { method: 'POST', path: '/api/missions/MSN-001/start', body: {} }
  ];

  for (const check of executeChecks) {
    const res = await fetch(`${BASE_URL}${check.path}`, {
      method: check.method,
      headers: {
        Authorization: `Bearer ${managerToken}`,
        'Content-Type': 'application/json',
        'idempotency-key': 'smoke-test-key'
      },
      body: JSON.stringify(check.body)
    });
    if (res.status !== 403) {
      throw new Error(`Expected 403 for manager executing ${check.path}, got ${res.status}`);
    }
  }
  console.log('[Smoke] Verified Manager physical execution attempts return 403 FORBIDDEN');

  // 3. List orders using manager token
  const ordersRes = await fetch(`${BASE_URL}/api/orders`, {
    headers: { Authorization: `Bearer ${managerToken}` }
  });
  if (!ordersRes.ok) {
    throw new Error(`GET /api/orders failed with status ${ordersRes.status}: ${await ordersRes.text()}`);
  }
  const ordersData = await ordersRes.json();
  const ordersList = ordersData.orders || ordersData.items || [];
  console.log(`[Smoke] Orders count: ${ordersList.length}`);

  // 4. Fetch inventory summary
  const invRes = await fetch(`${BASE_URL}/api/inventory/summary`, {
    headers: { Authorization: `Bearer ${managerToken}` }
  });
  if (!invRes.ok) {
    throw new Error(`GET /api/inventory/summary failed with status ${invRes.status}: ${await invRes.text()}`);
  }
  const invData = await invRes.json();
  const invList = invData.items || [];
  console.log(`[Smoke] Inventory SKU count: ${invList.length}`);

  // 5. Verify Ledger & Reconciliation
  const ledgerRes = await fetch(`${BASE_URL}/api/ledger?limit=10`, {
    headers: { Authorization: `Bearer ${managerToken}` }
  });
  if (!ledgerRes.ok) {
    throw new Error(`GET /api/ledger failed with status ${ledgerRes.status}: ${await ledgerRes.text()}`);
  }
  const ledgerData = await ledgerRes.json();
  console.log(`[Smoke] Ledger entries retrieved: ${ledgerData.count}`);

  const reconcileRes = await fetch(`${BASE_URL}/api/ledger/reconcile`, {
    headers: { Authorization: `Bearer ${managerToken}` }
  });
  if (!reconcileRes.ok) {
    throw new Error(`GET /api/ledger/reconcile failed with status ${reconcileRes.status}: ${await reconcileRes.text()}`);
  }
  const reconcileData = await reconcileRes.json();
  if (!reconcileData.ok || reconcileData.mismatches.length > 0) {
    throw new Error(`Ledger reconciliation failed: ${JSON.stringify(reconcileData.mismatches)}`);
  }
  console.log('[Smoke] Ledger reconcile OK: projection matches ledger balances perfectly');

  console.log('[Smoke] ALL BASELINE CHECKS PASSED.');
}

main().catch((err) => {
  console.error('[Smoke] ERROR:', err.message);
  process.exit(1);
});
