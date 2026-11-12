import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client.js';

interface DispatchQueueItem {
  order_ref: string;
  customer_ref: string | null;
  priority: string;
  slot_code: string;
  packed_at: string | null;
  sla_due_at: string | null;
  locked: boolean;
  attempts: number;
}

export const DispatchFloorPage: React.FC = () => {
  const [queue, setQueue] = useState<DispatchQueueItem[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<DispatchQueueItem | null>(null);
  const [slotScan, setSlotScan] = useState('');
  const [otp, setOtp] = useState('');
  const [riderName, setRiderName] = useState('');
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchQueue = async () => {
    try {
      setLoading(true);
      const res = await apiFetch<{ items: DispatchQueueItem[] }>('/api/dispatch/queue');
      setQueue(res.items);
      if (selectedOrder) {
        const found = res.items.find((i) => i.order_ref === selectedOrder.order_ref);
        setSelectedOrder(found || null);
      }
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Failed to fetch dispatch queue' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
    const timer = setInterval(fetchQueue, 10000);
    return () => clearInterval(timer);
  }, []);

  const handleHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || !slotScan.trim() || !otp.trim()) return;

    try {
      setLoading(true);
      setBanner(null);
      await apiFetch<any>(`/api/dispatch/${selectedOrder.order_ref}/handover`, {
        method: 'POST',
        body: JSON.stringify({
          slotScan: slotScan.trim(),
          otp: otp.trim(),
          riderName: riderName.trim() || undefined,
        }),
      });

      setBanner({ type: 'success', message: `Order ${selectedOrder.order_ref} dispatched successfully!` });
      setSelectedOrder(null);
      setSlotScan('');
      setOtp('');
      setRiderName('');
      fetchQueue();
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Dispatch handover failed' });
      fetchQueue();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ marginBottom: '1.5rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>
          🚚 Dispatch Handover Floor
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0.25rem 0 0 0' }}>
          Verify rider OTP, scan dispatch slot, and confirm handover to courier/delivery driver.
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

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.5rem' }}>
        {/* Queue Column */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#334155', margin: 0 }}>
              Ready for Handover ({queue.length})
            </h2>
            <button
              onClick={fetchQueue}
              disabled={loading}
              style={{
                fontSize: '0.75rem',
                padding: '0.25rem 0.5rem',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                backgroundColor: '#ffffff',
                cursor: 'pointer',
              }}
            >
              Refresh
            </button>
          </div>

          {queue.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', color: '#64748b' }}>
              No orders waiting for handover.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {queue.map((item) => {
                const isSelected = selectedOrder?.order_ref === item.order_ref;
                return (
                  <div
                    key={item.order_ref}
                    onClick={() => {
                      setSelectedOrder(item);
                      setSlotScan('');
                      setOtp('');
                    }}
                    style={{
                      padding: '0.75rem 1rem',
                      borderRadius: '8px',
                      border: `2px solid ${isSelected ? '#2563eb' : item.locked ? '#fecaca' : '#e2e8f0'}`,
                      backgroundColor: isSelected ? '#eff6ff' : item.locked ? '#fef2f2' : '#ffffff',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>{item.order_ref}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        Ref: {item.customer_ref || 'N/A'} • Priority: {item.priority}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#0284c7' }}>
                        Slot {item.slot_code}
                      </div>
                      {item.locked ? (
                        <span style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 600 }}>🔒 LOCKED</span>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: '#16a34a' }}>Ready</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Handover Form Column */}
        <div>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#334155', marginBottom: '0.75rem' }}>
            Confirm Handover
          </h2>
          {selectedOrder ? (
            <div style={{ backgroundColor: '#ffffff', padding: '1.25rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b' }}>Selected Order</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#0f172a' }}>{selectedOrder.order_ref}</div>
                <div style={{ fontSize: '0.875rem', color: '#0284c7', fontWeight: 600 }}>Assigned Slot: {selectedOrder.slot_code}</div>
                {selectedOrder.locked && (
                  <div style={{ marginTop: '0.5rem', padding: '0.5rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px', color: '#b91c1c', fontSize: '0.75rem' }}>
                    ⚠️ This order is LOCKED due to excessive failed OTP attempts. Ask a Manager to regenerate the OTP.
                  </div>
                )}
              </div>

              <form onSubmit={handleHandover} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>
                    Scan Dispatch Slot Barcode
                  </label>
                  <input
                    type="text"
                    placeholder={`e.g. ${selectedOrder.slot_code}`}
                    value={slotScan}
                    onChange={(e) => setSlotScan(e.target.value)}
                    disabled={loading || selectedOrder.locked}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>
                    Rider OTP (4 digits)
                  </label>
                  <input
                    type="password"
                    maxLength={4}
                    placeholder="Enter 4-digit OTP"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    disabled={loading || selectedOrder.locked}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '1.25rem', letterSpacing: '4px' }}
                  />
                  {selectedOrder.attempts > 0 && !selectedOrder.locked && (
                    <div style={{ fontSize: '0.75rem', color: '#ea580c', marginTop: '0.25rem' }}>
                      Failed attempts: {selectedOrder.attempts}/3
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>
                    Courier / Rider Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Alex Rider"
                    value={riderName}
                    onChange={(e) => setRiderName(e.target.value)}
                    disabled={loading || selectedOrder.locked}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || selectedOrder.locked || !slotScan.trim() || !otp.trim()}
                  style={{
                    marginTop: '0.5rem',
                    padding: '0.75rem',
                    backgroundColor: selectedOrder.locked || !slotScan.trim() || !otp.trim() ? '#94a3b8' : '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 600,
                    cursor: selectedOrder.locked || !slotScan.trim() || !otp.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  Verify OTP & Complete Handover
                </button>
              </form>
            </div>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', color: '#64748b' }}>
              Select an order from the list on the left to verify and hand over.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
