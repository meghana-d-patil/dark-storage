import React, { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { OrderDto } from '@dark-storage/shared';
import { StatusBadge } from '../components/StatusBadge.js';

export const OrderDetailPage: React.FC = () => {
  const { ref } = useParams<{ ref: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const isManager = user?.role === 'MANAGER';
  const bannerMessage = (location.state as any)?.banner;

  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [expandedLines, setExpandedLines] = useState<Record<number, boolean>>({});

  const { data: order, isLoading, error } = useQuery<OrderDto>({
    queryKey: ['order', ref],
    queryFn: () => apiFetch(`/api/orders/${ref}`),
    refetchInterval: 5000,
    enabled: !!ref
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) =>
      apiFetch(`/api/orders/${ref}/cancel`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': `cancel-${ref}-${Date.now()}`
        },
        body: JSON.stringify({ reason })
      }),
    onSuccess: () => {
      setCancelModalOpen(false);
      setCancelReason('');
      setCancelError('');
      queryClient.invalidateQueries({ queryKey: ['order', ref] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err: any) => {
      setCancelError(err.message || 'Failed to cancel order');
    }
  });

  if (isLoading) {
    return <div style={{ padding: '2rem' }}>Loading order {ref}...</div>;
  }

  if (error || !order) {
    return (
      <div style={{ padding: '2rem' }}>
        <button className="btn btn-secondary" onClick={() => navigate('/orders')}>
          ← Back to Orders
        </button>
        <p style={{ color: 'var(--color-danger)', marginTop: '1rem' }}>Order not found or error loading.</p>
      </div>
    );
  }

  const cancellableStatuses = ['RESERVED', 'ASSIGNED', 'PICKING'];
  const totalPicked = order.lines.reduce((acc, l) => acc + l.qty_picked, 0);
  const canCancel =
    isManager &&
    (cancellableStatuses.includes(order.status) || (order.status === 'PICKED' && totalPicked === 0));

  const toggleLine = (lineNo: number) => {
    setExpandedLines((prev) => ({ ...prev, [lineNo]: !prev[lineNo] }));
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Navigation & Header */}
      <div>
        <button className="btn btn-secondary" onClick={() => navigate('/orders')} style={{ marginBottom: '0.5rem' }}>
          ← Back to Orders
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600 }}>{order.ref}</h1>
            <StatusBadge status={order.status} />
            <span className={`badge badge-${order.priority === 'URGENT' ? 'danger' : order.priority === 'HIGH' ? 'warning' : 'secondary'}`}>
              {order.priority}
            </span>
            <span className="badge badge-info">{order.order_type}</span>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {canCancel && (
              <button
                className="btn btn-danger"
                data-testid="order-cancel-btn"
                onClick={() => setCancelModalOpen(true)}
              >
                Cancel Order
              </button>
            )}
          </div>
        </div>
      </div>

      {bannerMessage && (
        <div className="banner banner-success" style={{ padding: '1rem', borderRadius: '8px' }}>
          ✓ {bannerMessage}
        </div>
      )}

      {order.status === 'CANCELLED' && (
        <div className="banner banner-error" style={{ padding: '1rem', borderRadius: '8px' }}>
          This order was cancelled. Reason: {order.cancelled_reason || 'No reason provided'}
        </div>
      )}

      {/* Facts Card */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          background: 'var(--color-bg-card)',
          padding: '1.25rem',
          borderRadius: '8px'
        }}
      >
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Customer Ref</span>
          <p style={{ margin: '0.25rem 0 0', fontWeight: 500 }}>{order.customer_ref || '—'}</p>
        </div>
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Requested By</span>
          <p style={{ margin: '0.25rem 0 0', fontWeight: 500 }}>{order.requested_by}</p>
        </div>
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Assigned Picker</span>
          <p style={{ margin: '0.25rem 0 0', fontWeight: 500 }}>
            {typeof order.assigned_picker === 'object' && order.assigned_picker
              ? (order.assigned_picker as any).name
              : order.assigned_picker || 'Unassigned'}
          </p>
        </div>
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Created At</span>
          <p style={{ margin: '0.25rem 0 0', fontWeight: 500 }}>{new Date(order.created_at).toLocaleString()}</p>
        </div>
        {order.notes && (
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Notes</span>
            <p style={{ margin: '0.25rem 0 0' }}>{order.notes}</p>
          </div>
        )}
      </div>

      {/* Reservation Summary Strip */}
      <div
        style={{
          display: 'flex',
          gap: '2rem',
          background: 'var(--color-bg-card)',
          padding: '1rem 1.25rem',
          borderRadius: '8px',
          alignItems: 'center'
        }}
      >
        <span style={{ fontWeight: 600 }}>Reservation Summary:</span>
        <span className="badge badge-warning" style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem' }}>
          Held Units: {order.reservation_summary.held_units}
        </span>
        <span className="badge badge-success" style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem' }}>
          Consumed Units: {order.reservation_summary.consumed_units}
        </span>
        <span className="badge badge-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem' }}>
          Released Units: {order.reservation_summary.released_units}
        </span>
      </div>

      {/* Order Lines with Expandable Reservations */}
      <div style={{ background: 'var(--color-bg-card)', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Order Lines & Bin Reservations</h3>
        </div>

        <table className="table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: '40px' }}></th>
              <th>Line #</th>
              <th>Product</th>
              <th>Ordered</th>
              <th>Picked</th>
              <th>Short</th>
              <th>Reserved Bins</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const isExpanded = expandedLines[l.line_no] ?? true;
              return (
                <React.Fragment key={l.line_no}>
                  <tr
                    onClick={() => toggleLine(l.line_no)}
                    style={{ cursor: 'pointer', background: 'rgba(255, 255, 255, 0.02)' }}
                  >
                    <td>{isExpanded ? '▼' : '▶'}</td>
                    <td>{l.line_no}</td>
                    <td>
                      <strong>{l.product_name}</strong> · {l.sku}
                    </td>
                    <td>{l.qty_ordered}</td>
                    <td>{l.qty_picked}</td>
                    <td>{l.qty_short}</td>
                    <td>
                      <span className="badge badge-info">{l.reservations.length} bin(s)</span>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td colSpan={7} style={{ padding: '0.5rem 1rem 1rem 3rem', background: 'rgba(0, 0, 0, 0.15)' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--color-text-secondary)' }}>
                          Allocated Bin Reservations:
                        </div>
                        <table className="table" style={{ margin: 0, background: 'var(--color-bg-card)', borderRadius: '6px' }}>
                          <thead>
                            <tr style={{ fontSize: '0.8rem' }}>
                              <th>Bin Location</th>
                              <th>Reserved Qty</th>
                              <th>Consumed</th>
                              <th>Released</th>
                              <th>Outstanding</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {l.reservations.map((r) => (
                              <tr key={r.id}>
                                <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{r.bin_code}</td>
                                <td>{r.qty}</td>
                                <td>{r.consumed_qty}</td>
                                <td>{r.released_qty}</td>
                                <td style={{ fontWeight: 600 }}>{r.outstanding}</td>
                                <td>
                                  <StatusBadge status={r.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Audit Timeline */}
      <div style={{ background: 'var(--color-bg-card)', padding: '1.25rem', borderRadius: '8px' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>Audit Timeline</h3>
        {order.audit.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>No audit logs recorded yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {order.audit.map((a, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '0.5rem 0',
                  borderBottom: '1px solid rgba(255,255,255,0.05)'
                }}
              >
                <div>
                  <strong style={{ color: 'var(--color-primary)' }}>{a.action}</strong> by {a.by}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                  {new Date(a.at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cancel Modal */}
      {cancelModalOpen && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: '480px' }}>
            <h3 style={{ margin: '0 0 1rem' }}>Cancel Order {order.ref}</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
              Cancelling will release all outstanding reserved units back to available inventory.
            </p>

            {cancelError && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{cancelError}</p>}

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Reason for cancellation</label>
              <textarea
                className="form-control"
                rows={3}
                placeholder="e.g. Customer cancelled order"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setCancelModalOpen(false)}
                disabled={cancelMutation.isPending}
              >
                Keep Order
              </button>
              <button
                className="btn btn-danger"
                data-testid="order-cancel-confirm"
                onClick={() => cancelMutation.mutate(cancelReason)}
                disabled={cancelReason.trim().length < 3 || cancelMutation.isPending}
              >
                {cancelMutation.isPending ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
