import React, { useState, useRef, useEffect } from 'react';
import { apiFetch, ApiError } from '../../api/client.js';
import { PackSessionDTO } from '@dark-storage/shared';

export const PackFloorPage: React.FC = () => {
  const [session, setSession] = useState<PackSessionDTO | null>(null);
  const [toteInput, setToteInput] = useState('');
  const [itemScanInput, setItemScanInput] = useState('');
  const [weightInput, setWeightInput] = useState('');
  const [slotInput, setSlotInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Flag modal state
  const [flagModal, setFlagModal] = useState<{ sku: string; remaining: number } | null>(null);
  const [flagKind, setFlagKind] = useState<'MISSING' | 'DAMAGED'>('MISSING');
  const [flagQty, setFlagQty] = useState(1);
  const [flagNote, setFlagNote] = useState('');

  const itemInputRef = useRef<HTMLInputElement>(null);
  const toteInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!session) {
      toteInputRef.current?.focus();
    } else {
      itemInputRef.current?.focus();
    }
  }, [session]);

  const handleOpenSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toteInput.trim()) return;

    try {
      setLoading(true);
      setBanner(null);
      const res = await apiFetch<PackSessionDTO>('/api/packing/open', {
        method: 'POST',
        body: JSON.stringify({ toteScan: toteInput.trim() }),
      });
      setSession(res);
      setToteInput('');
      setBanner({ type: 'success', message: `Pack session opened for order ${res.orderRef}` });
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Failed to open pack session' });
    } finally {
      setLoading(false);
    }
  };

  const handleScanItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !itemScanInput.trim()) return;

    try {
      setLoading(true);
      setBanner(null);
      const res = await apiFetch<PackSessionDTO>(`/api/packing/sessions/${session.sessionId}/scan-item`, {
        method: 'POST',
        body: JSON.stringify({ scan: itemScanInput.trim() }),
      });
      setSession(res);
      setItemScanInput('');
      setBanner({ type: 'success', message: 'Item scanned successfully' });
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Scan rejected' });
    } finally {
      setLoading(false);
      itemInputRef.current?.focus();
    }
  };

  const handleFlagItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !flagModal) return;

    try {
      setLoading(true);
      setBanner(null);
      const res = await apiFetch<PackSessionDTO>(`/api/packing/sessions/${session.sessionId}/flag-item`, {
        method: 'POST',
        body: JSON.stringify({
          sku: flagModal.sku,
          qty: flagQty,
          kind: flagKind,
          note: flagNote,
        }),
      });
      setSession(res);
      setFlagModal(null);
      setFlagQty(1);
      setFlagNote('');
      setBanner({ type: 'success', message: `Item ${flagModal.sku} flagged as ${flagKind}` });
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Failed to flag item' });
    } finally {
      setLoading(false);
    }
  };

  const handleWeigh = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !weightInput.trim()) return;

    try {
      setLoading(true);
      setBanner(null);
      const res = await apiFetch<any>(`/api/packing/sessions/${session.sessionId}/weigh`, {
        method: 'POST',
        body: JSON.stringify({ grams: Number(weightInput) }),
      });
      // Refresh session
      const updated = await apiFetch<PackSessionDTO>(`/api/packing/sessions/${session.sessionId}`);
      setSession(updated);
      setBanner({ type: 'success', message: `Weight verified: ${res.weight_g}g (Expected: ${res.expected_weight_g}g)` });
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Weight check failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !slotInput.trim()) return;

    try {
      setLoading(true);
      setBanner(null);
      const res = await apiFetch<any>(`/api/packing/sessions/${session.sessionId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ slotScan: slotInput.trim() }),
      });
      setSession(null);
      setSlotInput('');
      setWeightInput('');
      setBanner({ type: 'success', message: `Order ${res.orderRef} packed and staged at ${res.slot}!` });
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Failed to complete packing' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ marginBottom: '1.5rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>
          📦 Floor Packing Bench
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0.25rem 0 0 0' }}>
          Scan tote to begin packing, verify item barcodes, weigh package, and stage to dispatch slot.
        </p>
      </header>

      {banner && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            marginBottom: '1rem',
            backgroundColor: banner.type === 'success' ? '#f0fdf4' : '#fef2f2',
            color: banner.type === 'success' ? '#15803d' : '#b91c1c',
            border: `1px solid ${banner.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          {banner.message}
        </div>
      )}

      {!session ? (
        <div style={{ backgroundColor: '#ffffff', padding: '2rem', borderRadius: '8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#334155', marginBottom: '1rem' }}>
            Scan Tote Barcode to Start Packing
          </h2>
          <form onSubmit={handleOpenSession} style={{ display: 'flex', gap: '0.5rem', maxWidth: 400, margin: '0 auto' }}>
            <input
              ref={toteInputRef}
              type="text"
              placeholder="e.g. TOTE-001"
              value={toteInput}
              onChange={(e) => setToteInput(e.target.value)}
              disabled={loading}
              style={{
                flex: 1,
                padding: '0.625rem 0.75rem',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '1rem',
              }}
            />
            <button
              type="submit"
              disabled={loading || !toteInput.trim()}
              style={{
                padding: '0.625rem 1.25rem',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              Open Tote
            </button>
          </form>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Header Card */}
          <div style={{ backgroundColor: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 600 }}>Active Order</span>
              <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#0f172a' }}>{session.orderRef}</div>
            </div>
            <div>
              <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 600 }}>Tote</span>
              <div style={{ fontSize: '1.125rem', fontWeight: 600, color: '#2563eb' }}>{session.toteCode}</div>
            </div>
            <div>
              <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 600 }}>Weight Status</span>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: session.weightOk ? '#16a34a' : '#ea580c' }}>
                {session.weightOk ? '✓ Weight OK' : 'Pending Weigh'}
              </div>
            </div>
          </div>

          {/* Item Scan Input */}
          <div style={{ backgroundColor: '#ffffff', padding: '1.25rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#334155', marginBottom: '0.5rem' }}>
              Scan Item Barcode
            </label>
            <form onSubmit={handleScanItem} style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                ref={itemInputRef}
                type="text"
                placeholder="Scan or enter item barcode..."
                value={itemScanInput}
                onChange={(e) => setItemScanInput(e.target.value)}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: '0.625rem 0.75rem',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '1rem',
                }}
              />
              <button
                type="submit"
                disabled={loading || !itemScanInput.trim()}
                style={{
                  padding: '0.625rem 1.25rem',
                  backgroundColor: '#0f766e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                Scan Item
              </button>
            </form>
          </div>

          {/* Lines Table */}
          <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', backgroundColor: '#f1f5f9', fontWeight: 600, fontSize: '0.875rem', color: '#475569' }}>
              Order Items ({session.lines.length})
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                  <th style={{ padding: '0.625rem 1rem' }}>SKU</th>
                  <th style={{ padding: '0.625rem 1rem' }}>Product</th>
                  <th style={{ padding: '0.625rem 1rem', textAlign: 'center' }}>Expected</th>
                  <th style={{ padding: '0.625rem 1rem', textAlign: 'center' }}>Scanned</th>
                  <th style={{ padding: '0.625rem 1rem', textAlign: 'center' }}>Flagged</th>
                  <th style={{ padding: '0.625rem 1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {session.lines.map((l) => {
                  const remaining = l.expectedQty - (l.scannedQty + l.flaggedQty);
                  const isDone = remaining === 0;
                  return (
                    <tr key={l.sku} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: isDone ? '#f0fdf4' : '#ffffff' }}>
                      <td style={{ padding: '0.625rem 1rem', fontWeight: 600 }}>{l.sku}</td>
                      <td style={{ padding: '0.625rem 1rem' }}>{l.productName}</td>
                      <td style={{ padding: '0.625rem 1rem', textAlign: 'center' }}>{l.expectedQty}</td>
                      <td style={{ padding: '0.625rem 1rem', textAlign: 'center', fontWeight: 600, color: '#16a34a' }}>{l.scannedQty}</td>
                      <td style={{ padding: '0.625rem 1rem', textAlign: 'center', color: l.flaggedQty > 0 ? '#dc2626' : '#94a3b8' }}>{l.flaggedQty}</td>
                      <td style={{ padding: '0.625rem 1rem', textAlign: 'right' }}>
                        {!isDone && (
                          <button
                            type="button"
                            onClick={() => {
                              setFlagModal({ sku: l.sku, remaining });
                              setFlagQty(1);
                            }}
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.75rem',
                              backgroundColor: '#fee2e2',
                              color: '#991b1b',
                              border: '1px solid #fecaca',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            Flag Issue
                          </button>
                        )}
                        {isDone && <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ Done</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Weigh & Complete Controls */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {/* Weigh Card */}
            <div style={{ backgroundColor: '#ffffff', padding: '1.25rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155', margin: '0 0 0.5rem 0' }}>
                Weigh Package (grams)
              </h3>
              <form onSubmit={handleWeigh} style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="number"
                  placeholder="e.g. 520"
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                  }}
                />
                <button
                  type="submit"
                  disabled={loading || !weightInput}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#475569',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Verify Weight
                </button>
              </form>
              {session.weightExpectedG && (
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                  Expected: ~{session.weightExpectedG}g
                </div>
              )}
            </div>

            {/* Complete Card */}
            <div style={{ backgroundColor: '#ffffff', padding: '1.25rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155', margin: '0 0 0.5rem 0' }}>
                Stage to Dispatch Slot
              </h3>
              <form onSubmit={handleComplete} style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="e.g. D-1"
                  value={slotInput}
                  onChange={(e) => setSlotInput(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                  }}
                />
                <button
                  type="submit"
                  disabled={loading || !session.canComplete || !slotInput.trim()}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: session.canComplete && slotInput.trim() ? '#16a34a' : '#94a3b8',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: session.canComplete && slotInput.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  Complete Pack
                </button>
              </form>
              {!session.canComplete && (
                <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.25rem' }}>
                  Complete all items & weight check first
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Flag Issue Modal */}
      {flagModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ backgroundColor: '#ffffff', padding: '1.5rem', borderRadius: '8px', width: 400, maxWidth: '90%' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.125rem', fontWeight: 600 }}>
              Flag Shortfall for {flagModal.sku}
            </h3>
            <form onSubmit={handleFlagItem} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>
                  Issue Type
                </label>
                <select
                  value={flagKind}
                  onChange={(e) => setFlagKind(e.target.value as any)}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                >
                  <option value="MISSING">MISSING (Item absent in tote)</option>
                  <option value="DAMAGED">DAMAGED (Item damaged, quarantine)</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>
                  Quantity (Max {flagModal.remaining})
                </label>
                <input
                  type="number"
                  min={1}
                  max={flagModal.remaining}
                  value={flagQty}
                  onChange={(e) => setFlagQty(Number(e.target.value))}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>
                  Note / Reason
                </label>
                <input
                  type="text"
                  placeholder="Optional detail..."
                  value={flagNote}
                  onChange={(e) => setFlagNote(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setFlagModal(null)}
                  style={{ padding: '0.5rem 1rem', border: '1px solid #cbd5e1', borderRadius: '6px', backgroundColor: '#ffffff', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{ padding: '0.5rem 1rem', backgroundColor: '#dc2626', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Submit Flag
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
