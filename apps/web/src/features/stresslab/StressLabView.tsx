/**
 * Concurrency & ACID Stress Lab Component for /admin.
 * Real HTTP execution proving:
 * 1. Engine 1 Mutex: 5 parallel order requests for scarce stock -> exactly 2 success, 3 INSUFFICIENT_STOCK.
 * 2. Engine 3 Idempotency Replay: 5 parallel + 1 sequential identical key -> single order, 1 key reused -> 422.
 * 3. Database Invariants: 13 live integrity checks (I01..I13) before & after scenarios.
 * Zero mocked or simulated results; 100% real network calls and database responses.
 */

import React, { useState, useEffect } from 'react';
import { apiFetch, ApiError } from '../../api/client.js';

export interface RequestRecord {
  index: number;
  label: string;
  url: string;
  status: number;
  statusText?: string;
  durationMs: number;
  serverDurationMs?: number;
  startOffsetMs: number;
  bodyPreview: string;
  error?: string;
  orderRef?: string;
  isReplay?: boolean;
}

export interface IntegrityCheckItem {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  rows?: any[];
  detail?: string;
}

export const StressLabView: React.FC = () => {
  // Scenario 1: Race for Stock states
  const [raceRunning, setRaceRunning] = useState(false);
  const [raceResults, setRaceResults] = useState<RequestRecord[]>([]);
  const [raceVerdict, setRaceVerdict] = useState<{ passed: boolean; message: string } | null>(null);
  const [createdOrderRefs, setCreatedOrderRefs] = useState<string[]>([]);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [cleanupDone, setCleanupDone] = useState(false);

  // Scenario 2: Idempotency Replay states
  const [idemRunning, setIdemRunning] = useState(false);
  const [idemResults, setIdemResults] = useState<RequestRecord[]>([]);
  const [idemVerdict, setIdemVerdict] = useState<{ passed: boolean; message: string } | null>(null);

  // Scenario 3: Database Invariants states
  const [integrityRunning, setIntegrityRunning] = useState(false);
  const [integrityChecks, setIntegrityChecks] = useState<IntegrityCheckItem[]>([]);
  const [integrityOk, setIntegrityOk] = useState<boolean | null>(null);
  const [integrityDurationMs, setIntegrityDurationMs] = useState<number | null>(null);

  // Run integrity checks on mount
  useEffect(() => {
    runIntegrityChecks();
  }, []);

  const runIntegrityChecks = async (): Promise<boolean> => {
    setIntegrityRunning(true);
    const t0 = performance.now();
    try {
      const data: any = await apiFetch('/api/admin/integrity');
      const elapsed = Math.round(performance.now() - t0);
      setIntegrityDurationMs(elapsed);
      setIntegrityChecks(data.checks || []);
      setIntegrityOk(Boolean(data.ok));
      return Boolean(data.ok);
    } catch (err: any) {
      setIntegrityOk(false);
      return false;
    } finally {
      setIntegrityRunning(false);
    }
  };

  /**
   * Helper to perform a single HTTP request and record precise client and server timing.
   */
  const executeTimedRequest = async (
    index: number,
    label: string,
    endpoint: string,
    options: RequestInit & { idempotencyKey?: string },
    baseTime: number
  ): Promise<RequestRecord> => {
    const tStart = performance.now();
    const startOffset = Math.round(tStart - baseTime);

    let status = 0;
    let bodyPreview = '';
    let serverDurationMs: number | undefined = undefined;
    let orderRef: string | undefined = undefined;
    let error: string | undefined = undefined;
    let isReplay = false;

    try {
      const headers = new Headers(options.headers || {});
      headers.set('Content-Type', 'application/json');

      const token = localStorage.getItem('auth_token') || '';
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      if (options.idempotencyKey) {
        headers.set('Idempotency-Key', options.idempotencyKey);
      }

      const res = await fetch(endpoint, {
        ...options,
        headers
      });

      status = res.status;
      const timingHeader = res.headers.get('Server-Timing');
      if (timingHeader) {
        const match = timingHeader.match(/dur=([\d.]+)/);
        if (match) serverDurationMs = parseFloat(match[1]);
      }

      const text = await res.text();
      try {
        const json = JSON.parse(text);
        bodyPreview = JSON.stringify(json);
        if (json.ref) orderRef = json.ref;
        if (json.error?.code) error = json.error.code;
        if (json.idempotency_key_reused) isReplay = true;
      } catch {
        bodyPreview = text.slice(0, 100);
      }

      if (!res.ok && !error) {
        error = `HTTP_${status}`;
      }
    } catch (err: any) {
      status = 0;
      error = err.message || 'Network error';
      bodyPreview = String(err);
    }

    const tEnd = performance.now();
    const durationMs = Math.round(tEnd - tStart);

    return {
      index,
      label,
      url: endpoint,
      status,
      durationMs,
      serverDurationMs,
      startOffsetMs: startOffset,
      bodyPreview,
      error,
      orderRef,
      isReplay
    };
  };

  /**
   * SCENARIO 1: Race for Stock (Engine 1 Mutex)
   */
  const handleRunRace = async () => {
    setRaceRunning(true);
    setRaceVerdict(null);
    setRaceResults([]);
    setCreatedOrderRefs([]);
    setCleanupDone(false);

    try {
      // 1. Inspect inventory to find a standard SKU with available stock >= 4
      const invData: any = await apiFetch('/api/inventory/summary');
      const items: any[] = invData.items || [];
      const eligible = items.find(
        (i) => (i.available_to_promise ?? (i.stored_qty - i.reserved_qty)) >= 4 && i.sku
      );

      if (!eligible) {
        setRaceVerdict({
          passed: false,
          message: 'Not enough stock for this demo (requires available >= 4 units). Please receive stock first.'
        });
        setRaceRunning(false);
        return;
      }

      const testSku = eligible.sku;
      const available = eligible.available_to_promise ?? (eligible.stored_qty - eligible.reserved_qty);
      const orderQty = Math.floor(available / 2); // 2 * orderQty <= available < 3 * orderQty

      // 2. Fire 5 parallel order requests
      const baseTime = performance.now();
      const promises: Promise<RequestRecord>[] = [];

      for (let i = 1; i <= 5; i++) {
        const idemKey = `lab-race-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
        promises.push(
          executeTimedRequest(
            i,
            `Order ${i} (Request ${orderQty} units)`,
            '/api/orders',
            {
              method: 'POST',
              idempotencyKey: idemKey,
              body: JSON.stringify({
                lines: [{ sku: testSku, qty: orderQty }]
              })
            },
            baseTime
          )
        );
      }

      const results = await Promise.all(promises);
      setRaceResults(results);

      // 3. Evaluate results: Expect exactly 2 successes (201) and 3 insufficient stock (409)
      const successes = results.filter((r) => r.status === 201);
      const failures = results.filter((r) => r.status === 409 || r.error === 'INSUFFICIENT_STOCK');

      const refs = successes.map((s) => s.orderRef!).filter(Boolean);
      setCreatedOrderRefs(refs);

      if (successes.length === 2 && failures.length === 3) {
        setRaceVerdict({
          passed: true,
          message: `PASS: Engine 1 Mutex Verified! Exactly 2 orders reserved ${2 * orderQty} units out of ${available} available; remaining 3 concurrent requests were safely rejected with INSUFFICIENT_STOCK.`
        });
      } else {
        setRaceVerdict({
          passed: false,
          message: `UNEXPECTED RESULT: Got ${successes.length} successes and ${failures.length} stock rejections (expected 2 successes and 3 failures).`
        });
      }

      // Re-run integrity check
      await runIntegrityChecks();
    } catch (err: any) {
      setRaceVerdict({
        passed: false,
        message: `Execution failed: ${err.message}`
      });
    } finally {
      setRaceRunning(false);
    }
  };

  /**
   * Cleanup for Scenario 1: Cancels created orders to restore inventory
   */
  const handleCleanupRace = async () => {
    if (createdOrderRefs.length === 0) return;
    setCleaningUp(true);
    try {
      for (const ref of createdOrderRefs) {
        await apiFetch(`/api/orders/${ref}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'stress-lab cleanup' })
        });
      }
      setCleanupDone(true);
      await runIntegrityChecks();
    } catch (err) {
      console.error('Cleanup error:', err);
    } finally {
      setCleaningUp(false);
    }
  };

  /**
   * SCENARIO 2: Idempotency Replay (Engine 3 Atomicity)
   */
  const handleRunIdempotency = async () => {
    setIdemRunning(true);
    setIdemVerdict(null);
    setIdemResults([]);

    try {
      // 1. Read inventory for an available SKU
      const invData: any = await apiFetch('/api/inventory/summary');
      const items: any[] = invData.items || [];
      const candidate = items.find(
        (i) => (i.available_to_promise ?? (i.stored_qty - i.reserved_qty)) >= 1 && i.sku
      );

      if (!candidate) {
        setIdemVerdict({
          passed: false,
          message: 'No available stock to test order creation.'
        });
        setIdemRunning(false);
        return;
      }

      const testSku = candidate.sku;
      const testKey = `lab-idem-key-${Date.now()}`;
      const baseTime = performance.now();

      // 2. Fire 5 parallel requests with the SAME idempotency key
      const parallelPromises: Promise<RequestRecord>[] = [];
      for (let i = 1; i <= 5; i++) {
        parallelPromises.push(
          executeTimedRequest(
            i,
            `Parallel Replay ${i}`,
            '/api/orders',
            {
              method: 'POST',
              idempotencyKey: testKey,
              body: JSON.stringify({
                lines: [{ sku: testSku, qty: 1 }]
              })
            },
            baseTime
          )
        );
      }

      const parallelResults = await Promise.all(parallelPromises);

      // 3. Fire 1 sequential request with the SAME key and same body
      const sequential1 = await executeTimedRequest(
        6,
        'Sequential Replay (Same Key & Body)',
        '/api/orders',
        {
          method: 'POST',
          idempotencyKey: testKey,
          body: JSON.stringify({
            lines: [{ sku: testSku, qty: 1 }]
          })
        },
        baseTime
      );

      // 4. Fire 1 sequential request with SAME key but DIFFERENT body (expect 422 IDEMPOTENCY_KEY_REUSED)
      const sequential2 = await executeTimedRequest(
        7,
        'Reused Key with Different Body',
        '/api/orders',
        {
          method: 'POST',
          idempotencyKey: testKey,
          body: JSON.stringify({
            lines: [{ sku: testSku, qty: 2 }] // Different quantity!
          })
        },
        baseTime
      );

      const allResults = [...parallelResults, sequential1, sequential2];
      setIdemResults(allResults);

      // Verify outcomes:
      // - First 6 requests must all return status 200 or 201 with the EXACT SAME orderRef!
      const initialSix = allResults.slice(0, 6);
      const allSuccess = initialSix.every((r) => r.status === 200 || r.status === 201);
      const uniqueRefs = new Set(initialSix.map((r) => r.orderRef).filter(Boolean));
      const hasKeyReusedError = sequential2.status === 422 || sequential2.error === 'IDEMPOTENCY_KEY_REUSED';

      if (allSuccess && uniqueRefs.size === 1 && hasKeyReusedError) {
        setIdemVerdict({
          passed: true,
          message: `PASS: Engine 3 Idempotency Verified! All 6 identical requests safely resolved to single order ${Array.from(uniqueRefs)[0]}, and mismatched payload was rejected with 422 IDEMPOTENCY_KEY_REUSED.`
        });
      } else {
        setIdemVerdict({
          passed: false,
          message: `UNEXPECTED RESULT: Matching unique orders: ${uniqueRefs.size} (expected 1). Mismatched payload status: ${sequential2.status} (expected 422).`
        });
      }

      await runIntegrityChecks();
    } catch (err: any) {
      setIdemVerdict({
        passed: false,
        message: `Execution failed: ${err.message}`
      });
    } finally {
      setIdemRunning(false);
    }
  };

  /**
   * Helper to test missing idempotency key
   */
  const handleTestMissingKey = async () => {
    try {
      const rec = await executeTimedRequest(
        99,
        'Missing Idempotency Key',
        '/api/orders',
        {
          method: 'POST',
          body: JSON.stringify({ lines: [{ sku: 'SKU001', qty: 1 }] })
        },
        performance.now()
      );
      alert(`Missing key response: HTTP ${rec.status} (${rec.error || rec.bodyPreview})`);
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  // Calculate timeline scale
  const maxDuration = Math.max(
    ...raceResults.map((r) => r.startOffsetMs + r.durationMs),
    ...idemResults.map((r) => r.startOffsetMs + r.durationMs),
    500
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Intro Banner */}
      <div
        className="card"
        style={{
          padding: '20px',
          borderLeft: '4px solid var(--accent-primary)',
          backgroundColor: 'var(--bg-surface)'
        }}
      >
        <h2 style={{ margin: '0 0 6px', fontSize: '1.25rem', fontWeight: 800 }}>
          ⚡ Concurrency &amp; ACID Stress Lab
        </h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13.5px', lineHeight: 1.5 }}>
          Real-time interactive laboratory proving distributed locking in Engine 1, transaction atomicity &amp;
          idempotency in Engine 3, and zero database invariant corruption. Every bar represents a live network request.
        </p>
      </div>

      {/* Scenario 1: Race for Stock Card */}
      <div className="card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.15rem', fontWeight: 800 }}>
              1. Race for Stock (Engine 1 Mutex Concurrency)
            </h3>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>
              Fires 5 simultaneous order requests for scarce stock ($q = \lfloor X/2 \rfloor$). Proves mutex prevents race conditions and overselling.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="lab-run-race"
              onClick={handleRunRace}
              disabled={raceRunning || cleaningUp}
            >
              {raceRunning ? 'Racing 5 Requests...' : 'Run Race for Stock'}
            </button>

            {createdOrderRefs.length > 0 && !cleanupDone && (
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="lab-cleanup"
                onClick={handleCleanupRace}
                disabled={cleaningUp}
              >
                {cleaningUp ? 'Cancelling...' : `Clean Up (${createdOrderRefs.length} Orders)`}
              </button>
            )}
          </div>
        </div>

        {/* Verdict Badge */}
        {raceVerdict && (
          <div
            data-testid="lab-verdict-race"
            className={`banner ${raceVerdict.passed ? 'banner-success' : 'banner-error'}`}
            style={{ marginBottom: '16px', fontSize: '13px' }}
          >
            <strong>{raceVerdict.passed ? '✓ PASSED' : '✗ FAILED'}:</strong> {raceVerdict.message}
          </div>
        )}

        {cleanupDone && (
          <div className="banner banner-info" style={{ marginBottom: '16px', fontSize: '13px' }}>
            ✓ Clean up complete: created orders were cancelled and reserved inventory restored to its prior state.
          </div>
        )}

        {/* Requests Timeline Visual */}
        {raceResults.length > 0 && (
          <div style={{ backgroundColor: 'var(--bg-canvas)', borderRadius: 'var(--radius-md)', padding: '16px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '12px', textTransform: 'uppercase' }}>
              Execution Timeline (Client &amp; Server-Timing)
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {raceResults.map((r, i) => {
                const widthPct = Math.max(8, (r.durationMs / maxDuration) * 100);
                const leftPct = (r.startOffsetMs / maxDuration) * 100;
                const isSuccess = r.status === 201;

                return (
                  <div key={i} data-testid={`lab-request-row-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                      <span>
                        <strong>Request #{r.index}:</strong> {r.label}
                      </span>
                      <span>
                        <span className={`badge ${isSuccess ? 'badge-success' : 'badge-danger'}`} style={{ marginRight: '8px' }}>
                          HTTP {r.status} {r.error ? `(${r.error})` : ''}
                        </span>
                        <span>{r.durationMs} ms</span>
                        {r.serverDurationMs && (
                          <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>
                            (srv {r.serverDurationMs} ms)
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Timeline bar */}
                    <div style={{ position: 'relative', height: '14px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          height: '100%',
                          backgroundColor: isSuccess ? 'var(--accent-success)' : 'var(--accent-danger)',
                          borderRadius: '4px',
                          transition: 'width 0.3s ease'
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Scenario 2: Idempotency Replay Card */}
      <div className="card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.15rem', fontWeight: 800 }}>
              2. Idempotency Replay (Engine 3 Atomicity)
            </h3>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>
              Sends the same key across 5 parallel + 1 sequential request, then reuses the key with a different payload.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleTestMissingKey}
              title="Test request without Idempotency-Key"
            >
              Test Missing Key
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="lab-run-idem"
              onClick={handleRunIdempotency}
              disabled={idemRunning}
            >
              {idemRunning ? 'Running Replay Test...' : 'Run Idempotency Test'}
            </button>
          </div>
        </div>

        {/* Verdict Badge */}
        {idemVerdict && (
          <div
            data-testid="lab-verdict-idem"
            className={`banner ${idemVerdict.passed ? 'banner-success' : 'banner-error'}`}
            style={{ marginBottom: '16px', fontSize: '13px' }}
          >
            <strong>{idemVerdict.passed ? '✓ PASSED' : '✗ FAILED'}:</strong> {idemVerdict.message}
          </div>
        )}

        {/* Timeline Visual */}
        {idemResults.length > 0 && (
          <div style={{ backgroundColor: 'var(--bg-canvas)', borderRadius: 'var(--radius-md)', padding: '16px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '12px', textTransform: 'uppercase' }}>
              Idempotency Execution Timeline
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {idemResults.map((r, i) => {
                const widthPct = Math.max(8, (r.durationMs / maxDuration) * 100);
                const leftPct = (r.startOffsetMs / maxDuration) * 100;
                const is200 = r.status === 200 || r.status === 201;

                return (
                  <div key={i} data-testid={`lab-request-row-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                      <span>
                        <strong>#{r.index}:</strong> {r.label}
                        {r.orderRef && <span style={{ color: 'var(--accent-primary)', marginLeft: '8px' }}>[{r.orderRef}]</span>}
                      </span>
                      <span>
                        <span className={`badge ${is200 ? 'badge-success' : 'badge-warning'}`} style={{ marginRight: '8px' }}>
                          HTTP {r.status} {r.error ? `(${r.error})` : ''}
                        </span>
                        <span>{r.durationMs} ms</span>
                      </span>
                    </div>

                    <div style={{ position: 'relative', height: '14px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          height: '100%',
                          backgroundColor: is200 ? 'var(--accent-primary)' : 'var(--accent-warning)',
                          borderRadius: '4px'
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Scenario 3: Database Invariants Checklist Card */}
      <div className="card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.15rem', fontWeight: 800 }}>
              3. Database Invariants Verifier (I01..I13)
            </h3>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>
              Exhaustively verifies mathematical invariants across inventory balances, reservations, and ledgers.
            </p>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            data-testid="lab-run-integrity"
            onClick={runIntegrityChecks}
            disabled={integrityRunning}
          >
            {integrityRunning ? 'Verifying...' : 'Run Integrity Checks'}
          </button>
        </div>

        {integrityDurationMs !== null && (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Verified 13 invariants in {integrityDurationMs} ms · Status:{' '}
            <strong style={{ color: integrityOk ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
              {integrityOk ? 'ALL PASSED (Zero Corruption)' : 'CORRUPTION DETECTED'}
            </strong>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
          {integrityChecks.map((c) => (
            <div
              key={c.id}
              data-testid={`lab-integrity-item-${c.id}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 14px',
                backgroundColor: 'var(--bg-canvas)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                fontSize: '12.5px'
              }}
            >
              <div>
                <strong style={{ fontFamily: 'var(--font-mono)', marginRight: '6px' }}>{c.id}</strong>
                <span style={{ color: 'var(--text-secondary)' }}>{c.name}</span>
              </div>
              <span className={`badge ${c.status === 'PASS' ? 'badge-success' : c.status === 'SKIP' ? 'badge-info' : 'badge-danger'}`}>
                {c.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
