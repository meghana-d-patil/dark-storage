import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { PackingQueueItemDto, PackingResultDto } from '@dark-storage/shared';
import { StatusBadge } from '../components/StatusBadge.js';

export const PackingPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isManager = user?.role === 'MANAGER';
  const isStaff = user?.role === 'STAFF';
  const canPack = isManager || isStaff;

  const [selectedOrderRef, setSelectedOrderRef] = useState<string | null>(null);
  const [packNotes, setPackNotes] = useState('');
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [packError, setPackError] = useState('');
  const [packSuccess, setPackSuccess] = useState<PackingResultDto | null>(null);
  const [packKey, setPackKey] = useState<string>('');

  const { data, isLoading } = useQuery<{ items: PackingQueueItemDto[] }>({
    queryKey: ['packing-queue'],
    queryFn: () => apiFetch('/api/packing/queue'),
    refetchInterval: 5000
  });

  const queue = data?.items || [];
  const selectedOrder = queue.find((o) => o.order_ref === selectedOrderRef) || queue[0] || null;

  // On selecting an order, reset form
  const handleSelectOrder = (order: PackingQueueItemDto) => {
    setSelectedOrderRef(order.order_ref);
    setPackNotes('');
    setAcceptPartial(false);
    setPackError('');
    setPackSuccess(null);
    setPackKey(`pack-${order.order_ref}-${Date.now()}`);
  };

  const packMutation = useMutation({
    mutationFn: (body: any) =>
      apiFetch<PackingResultDto>(`/api/orders/${selectedOrder!.order_ref}/pack`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': packKey || `pack-${selectedOrder!.order_ref}-${Date.now()}`
        },
        body: JSON.stringify(body)
      }),
    onSuccess: (res: PackingResultDto) => {
      setPackSuccess(res);
      setPackError('');
      setSelectedOrderRef(null);
      queryClient.invalidateQueries({ queryKey: ['packing-queue'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: any) => {
      setPackError(err.message || 'Failed to pack order');
    }
  });

  const handleConfirmPack = () => {
    if (!selectedOrder) return;
    packMutation.mutate({
      notes: packNotes.trim() || undefined,
      accept_partial: acceptPartial
    });
  };

  const isPartial = selectedOrder?.fulfilment_preview === 'PARTIAL';
  const canConfirm =
    canPack &&
    (!isPartial || (isManager && acceptPartial)) &&
    !packMutation.isPending;

  return (
    <div className="m3-page">
      <div className="m3-page-header">
        <div>
          <h1>Packing & Dispatch</h1>
          <p className="m3-subtitle">
            Inspect picked units, handle shortfalls, and complete packing.
          </p>
        </div>
      </div>

      {packSuccess && (
        <div className="banner banner-success" data-testid="pack-success-banner">
          ✓ {packSuccess.packing_ref} — Order <strong>{packSuccess.order_ref}</strong> completed ({packSuccess.fulfilment_type} fulfilment).
        </div>
      )}

      {/* Main Grid: Left Queue, Right Detail */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px', alignItems: 'start' }}>
        {/* Left Column: Packing Queue */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-surface)' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Ready to Pack</h3>
            <span className="badge badge-info">{queue.length}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '640px', overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Loading queue...
              </div>
            ) : queue.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No orders waiting for packing.
              </div>
            ) : (
              queue.map((item) => {
                const isSelected = selectedOrder?.order_ref === item.order_ref;
                return (
                  <div
                    key={item.order_ref}
                    onClick={() => handleSelectOrder(item)}
                    data-testid={`pack-queue-${item.order_ref}`}
                    style={{
                      padding: '16px 20px',
                      borderBottom: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      backgroundColor: isSelected ? 'var(--accent-primary-container)' : 'transparent',
                      borderLeft: isSelected ? '4px solid var(--accent-primary)' : '4px solid transparent',
                      transition: 'background-color 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{item.order_ref}</span>
                      <StatusBadge status={item.priority} />
                    </div>

                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                      {item.customer_ref || 'Standard Customer'}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        Units: <strong style={{ color: 'var(--text-primary)' }}>{item.total_picked}</strong> / {item.total_ordered}
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {item.fulfilment_preview === 'PARTIAL' ? (
                          <span className="badge badge-warning">PARTIAL</span>
                        ) : (
                          <span className="badge badge-success">FULL</span>
                        )}
                        {item.needs_manager_approval && (
                          <span className="badge badge-danger">Needs Manager</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Order Detail & Pack Confirmation */}
        {selectedOrder ? (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>Packing <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedOrder.order_ref}</span></h2>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Customer: <strong style={{ color: 'var(--text-primary)' }}>{selectedOrder.customer_ref || 'Standard'}</strong> • Mission: <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{selectedOrder.mission_ref || 'N/A'}</strong>
                </span>
              </div>
              <div>
                {selectedOrder.fulfilment_preview === 'PARTIAL' ? (
                  <span className="badge badge-warning" style={{ fontSize: '12px' }}>PARTIAL FULFILMENT</span>
                ) : (
                  <span className="badge badge-success" style={{ fontSize: '12px' }}>FULL FULFILMENT</span>
                )}
              </div>
            </div>

            {packError && (
              <div className="banner banner-error" data-testid="pack-error-banner">
                {packError}
              </div>
            )}

            {/* Lines Table */}
            <div>
              <h4 style={{ margin: '0 0 10px', fontSize: '1rem', fontWeight: 700 }}>Order Lines Verification</h4>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Ordered</th>
                      <th>Picked</th>
                      <th>Short</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedOrder.lines.map((l) => {
                      const isComplete = l.qty_picked === l.qty_ordered;
                      return (
                        <tr key={l.sku}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{l.product_name}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{l.sku}</div>
                          </td>
                          <td style={{ fontWeight: 600 }}>{l.qty_ordered}</td>
                          <td style={{ fontWeight: 700, color: isComplete ? 'inherit' : 'var(--accent-warning)' }}>{l.qty_picked}</td>
                          <td style={{ fontWeight: 600 }}>{l.qty_short}</td>
                          <td>
                            {isComplete ? (
                              <span style={{ color: 'var(--accent-success)', fontWeight: 700 }}>✓ Complete</span>
                            ) : (
                              <span style={{ color: 'var(--accent-warning)', fontWeight: 700 }}>⚠ Short ({l.qty_short} short)</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Exceptions */}
            {selectedOrder.exceptions.length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 10px', fontSize: '1rem', fontWeight: 700 }}>Resolved Exceptions</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {selectedOrder.exceptions.map((exc) => (
                    <div
                      key={exc.ref}
                      style={{
                        padding: '10px 14px',
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '13px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <strong style={{ fontFamily: 'var(--font-mono)' }}>{exc.ref}</strong> — <span className="badge badge-warning">{exc.type}</span> {exc.notes ? `("${exc.notes}")` : ''}
                      </div>
                      <span className="badge badge-info">{exc.resolution || 'RESOLVED'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes Input */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">
                Packing Notes (Optional)
              </label>
              <textarea
                className="input-field"
                rows={2}
                data-testid="pack-notes-input"
                placeholder="e.g. Packed in standard cardboard box with bubble wrap..."
                value={packNotes}
                onChange={(e) => setPackNotes(e.target.value)}
              />
            </div>

            {/* Manager acceptance for partial */}
            {isPartial && (
              <div
                className="alert alert-warning"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}
              >
                <div style={{ fontWeight: 700, color: '#fde68a', fontSize: '14px' }}>
                  Partial Fulfilment Warning ({selectedOrder.total_short} units short)
                </div>
                {isManager ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13.5px' }}>
                    <input
                      type="checkbox"
                      data-testid="pack-accept-partial-checkbox"
                      checked={acceptPartial}
                      onChange={(e) => setAcceptPartial(e.target.checked)}
                    />
                    <span>I accept partial fulfilment for this order</span>
                  </label>
                ) : (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }} data-testid="staff-pack-disabled">
                    Manager approval is required to pack orders with shortfalls.
                  </p>
                )}
              </div>
            )}

            {/* Confirm packing button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="pack-confirm-btn"
                onClick={handleConfirmPack}
                disabled={!canConfirm}
              >
                {packMutation.isPending
                  ? 'Confirming Packing...'
                  : isPartial
                  ? 'Confirm Partial Packing'
                  : 'Confirm Packing'}
              </button>
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Select an order from the queue to start packing.
          </div>
        )}
      </div>
    </div>
  );
};
