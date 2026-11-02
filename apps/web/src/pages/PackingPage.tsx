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
    <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600 }}>Packing & Dispatch</h1>
        <p style={{ margin: '0.25rem 0 0', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
          Inspect picked units, handle shortfalls, and complete packing.
        </p>
      </div>

      {packSuccess && (
        <div className="banner banner-success" style={{ padding: '1rem', borderRadius: '8px' }} data-testid="pack-success-banner">
          ✓ {packSuccess.packing_ref} — Order <strong>{packSuccess.order_ref}</strong> completed ({packSuccess.fulfilment_type} fulfilment).
        </div>
      )}

      {/* Main Grid: Left Queue, Right Detail */}
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Left Column: Packing Queue */}
        <div style={{ background: 'var(--color-bg-card)', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Ready to Pack</h3>
            <span className="badge badge-info">{queue.length}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '600px', overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                Loading queue...
              </div>
            ) : queue.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                No orders waiting for packing.
              </div>
            ) : (
              queue.map((item) => {
                const isSelected = selectedOrder?.order_ref === item.order_ref;
                return (
                  <div
                    key={item.order_ref}
                    onClick={() => handleSelectOrder(item)}
                    data-testid={`pack-queue-item-${item.order_ref}`}
                    style={{
                      padding: '1rem',
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                      borderLeft: isSelected ? '3px solid var(--color-primary)' : '3px solid transparent'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{item.order_ref}</span>
                      <StatusBadge status={item.priority} />
                    </div>

                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
                      {item.customer_ref || 'Standard Customer'}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                      <span>
                        Units: <strong>{item.total_picked}</strong> / {item.total_ordered}
                      </span>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        {item.fulfilment_preview === 'PARTIAL' ? (
                          <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>PARTIAL</span>
                        ) : (
                          <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>FULL</span>
                        )}
                        {item.needs_manager_approval && (
                          <span className="badge badge-danger" style={{ fontSize: '0.7rem' }}>Needs Manager</span>
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
          <div style={{ background: 'var(--color-bg-card)', borderRadius: '8px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 600 }}>Packing {selectedOrder.order_ref}</h2>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                  Customer: <strong>{selectedOrder.customer_ref || 'Standard'}</strong> • Mission: <strong>{selectedOrder.mission_ref || 'N/A'}</strong>
                </span>
              </div>
              <div>
                {selectedOrder.fulfilment_preview === 'PARTIAL' ? (
                  <span className="badge badge-warning" style={{ fontSize: '0.85rem' }}>PARTIAL FULFILMENT</span>
                ) : (
                  <span className="badge badge-success" style={{ fontSize: '0.85rem' }}>FULL FULFILMENT</span>
                )}
              </div>
            </div>

            {packError && (
              <div className="banner banner-error" style={{ padding: '0.75rem', borderRadius: '4px' }} data-testid="pack-error-banner">
                {packError}
              </div>
            )}

            {/* Lines Table */}
            <div>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: 600 }}>Order Lines Verification</h4>
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
                          <div><strong>{l.product_name}</strong></div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>{l.sku}</div>
                        </td>
                        <td>{l.qty_ordered}</td>
                        <td style={{ fontWeight: 600, color: isComplete ? 'inherit' : 'var(--color-warning)' }}>{l.qty_picked}</td>
                        <td>{l.qty_short}</td>
                        <td>
                          {isComplete ? (
                            <span style={{ color: '#10b981', fontWeight: 700 }}>✓ Complete</span>
                          ) : (
                            <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚠ Short ({l.qty_short} short)</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Exceptions */}
            {selectedOrder.exceptions.length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: 600 }}>Resolved Exceptions</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {selectedOrder.exceptions.map((exc) => (
                    <div
                      key={exc.ref}
                      style={{
                        padding: '0.6rem 0.8rem',
                        background: 'rgba(255,255,255,0.02)',
                        borderRadius: '4px',
                        fontSize: '0.85rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <strong>{exc.ref}</strong> — <span className="badge badge-warning">{exc.type}</span> {exc.notes ? `("${exc.notes}")` : ''}
                      </div>
                      <span className="badge badge-info">{exc.resolution || 'RESOLVED'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes Input */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.25rem' }}>
                Packing Notes (Optional)
              </label>
              <textarea
                className="form-control"
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
                style={{
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.25)',
                  borderRadius: '6px',
                  padding: '1rem'
                }}
              >
                <div style={{ fontWeight: 600, color: '#fbbf24', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  Partial Fulfilment Warning ({selectedOrder.total_short} units short)
                </div>
                {isManager ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                    <input
                      type="checkbox"
                      data-testid="accept-partial-checkbox"
                      checked={acceptPartial}
                      onChange={(e) => setAcceptPartial(e.target.checked)}
                    />
                    <span>I accept partial fulfilment for this order</span>
                  </label>
                ) : (
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-secondary)' }} data-testid="staff-pack-disabled">
                    Manager approval is required to pack orders with shortfalls.
                  </p>
                )}
              </div>
            )}

            {/* Confirm packing button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="confirm-pack-btn"
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
          <div style={{ padding: '3rem', textAlign: 'center', background: 'var(--color-bg-card)', borderRadius: '8px', color: 'var(--color-text-secondary)' }}>
            Select an order from the queue to start packing.
          </div>
        )}
      </div>
    </div>
  );
};
