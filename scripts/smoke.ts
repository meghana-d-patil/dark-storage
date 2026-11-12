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

  // 2. Login as each existing seeded user
  const users = ['manager1', 'operator1', 'picker1', 'picker2', 'staff1'];
  let managerToken = '';

  for (const username of users) {
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password: process.env.SEED_DEFAULT_PASSWORD || 'Warehouse#2026'
      })
    });

    if (!loginRes.ok) {
      throw new Error(`Login failed for ${username} with status ${loginRes.status}: ${await loginRes.text()}`);
    }
    const loginData = await loginRes.json();
    if (!loginData.token) {
      throw new Error(`No token returned for ${username}`);
    }
    console.log(`[Smoke] Logged in as ${loginData.user?.username} (${loginData.user?.role})`);
    if (username === 'manager1') {
      managerToken = loginData.token;
    }
  }

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

  console.log('[Smoke] ALL BASELINE CHECKS PASSED.');
}

main().catch((err) => {
  console.error('[Smoke] ERROR:', err.message);
  process.exit(1);
});
