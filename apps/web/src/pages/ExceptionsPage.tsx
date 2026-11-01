import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { PickExceptionDto } from '@dark-storage/shared';
import { StatusBadge } from '../components/StatusBadge.js';
import { Link } from 'react-router-dom';

export const ExceptionsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isManager = user?.role === 'MANAGER';

  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'RESOLVED'>('OPEN');
  const [missionFilter, setMissionFilter] = useState('');
  const [page, setPage] = useState(1);

  // Modal state
  const [selectedExc, setSelectedExc] = useState<PickExceptionDto | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');
  const [recountQty, setRecountQty] = useState<string>('');
  const [resolveError, setResolveError] = useState('');
  const [resolveKey, setResolveKey] = useState<string>('');

  const queryParams = new URLSearchParams();
  if (statusFilter !== 'ALL') {
    queryParams.set('status', statusFilter);
  }
  if (missionFilter.trim()) {
    queryParams.set('mission', missionFilter.trim());
  }
  queryParams.set('page', String(page));
  queryParams.set('page_size', '25');

  const { data, isLoading } = useQuery<{
    exceptions: PickExceptionDto[];
    total: number;
    page: number;
    page_size: number;
  }>({
    queryKey: ['exceptions', statusFilter, missionFilter, page],
    queryFn: () => apiFetch(`/api/exceptions?${queryParams.toString()}`),
    refetchInterval: 5000
  });

  const exceptions = data?.exceptions || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  const resolveMutation = useMutation({
    mutationFn: (body: any) =>
      apiFetch(`/api/exceptions/${selectedExc!.ref}/resolve`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': resolveKey
        },
        body: JSON.stringify(body)
      }),
    onSuccess: () => {
      setSelectedExc(null);
      setResolveError('');
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['mission'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err: any) => {
      setResolveError(err.message || 'Failed to resolve exception');
    }
  });

  const openResolveDialog = (exc: PickExceptionDto) => {
    setSelectedExc(exc);
    setResolveNotes('');
    setRecountQty('');
    setResolveError('');
    setResolveKey(`resolve-${exc.ref}-${Date.now()}`);
  };

  const handleResolve = (action: 'REALLOCATE' | 'ACCEPT_SHORT') => {
    if (!selectedExc) return;

    const payload: any = {
      action,
      notes: resolveNotes.trim() || undefined
    };

    if (recountQty !== '') {
      const q = Number(recountQty);
      if (!isNaN(q) && q >= 0) {
        payload.recount = { counted_qty: q };
      }
    }

    resolveMutation.mutate(payload);
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600 }}>Pick Exceptions</h1>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
            Review and resolve picking problems, missing stock, and damaged items.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          alignItems: 'center',
          background: 'var(--color-bg-card)',
          padding: '1rem',
          borderRadius: '8px',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>Status:</label>
          <select
            className="form-control"
            value={statusFilter}
            onChange={(e: any) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            data-testid="status-filter"
          >
            <option value="OPEN">Open Only</option>
            <option value="RESOLVED">Resolved Only</option>
            <option value="ALL">All Statuses</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>Mission:</label>
          <input
            type="text"
            className="form-control"
            placeholder="Search mission ref..."
            value={missionFilter}
            onChange={(e) => {
              setMissionFilter(e.target.value);
              setPage(1);
            }}
            data-testid="mission-filter"
          />
        </div>

        <div style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
          Total Exceptions: <strong>{total}</strong>
        </div>
      </div>

      {/* Exceptions Table */}
      <div style={{ background: 'var(--color-bg-card)', borderRadius: '8px', overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Status</th>
              <th>Type</th>
              <th>Mission / Order</th>
              <th>Location</th>
              <th>Product</th>
              <th>Expected / Actual</th>
              <th>Reported By</th>
              <th>Resolution</th>
              {isManager && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '2rem' }}>
                  Loading exceptions...
                </td>
              </tr>
            ) : exceptions.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-secondary)' }}>
                  No exceptions matching criteria.
                </td>
              </tr>
            ) : (
              exceptions.map((exc) => (
                <tr key={exc.id}>
                  <td>
                    <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{exc.ref}</span>
                  </td>
                  <td>
                    <StatusBadge status={exc.status} />
                  </td>
                  <td>
                    <span className="badge badge-warning">{exc.type}</span>
                  </td>
                  <td>
                    <div>
                      <Link to={`/picking/${exc.mission_ref}`} style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
                        {exc.mission_ref}
                      </Link>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                      <Link to={`/orders/${exc.order_ref}`} style={{ color: 'inherit' }}>
                        {exc.order_ref}
                      </Link>
                    </div>
                  </td>
                  <td>
                    <strong>{exc.bin_code}</strong>
                  </td>
                  <td>
                    <div>{exc.product_name || exc.sku}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                      {exc.sku}
                    </div>
                  </td>
                  <td>
                    <div>
                      Req: <strong>{exc.expected_qty}</strong> | Picked: <strong>{exc.actual_qty}</strong>
                    </div>
                    {exc.notes && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontStyle: 'italic', marginTop: '0.2rem' }}>
                        "{exc.notes}"
                      </div>
                    )}
                  </td>
                  <td>
                    <div>{exc.reported_by?.name || `User #${exc.reported_by?.id || exc.reported_by}`}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                      {new Date(exc.reported_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </td>
                  <td>
                    {exc.resolution ? (
                      <div>
                        <span className="badge badge-info">{exc.resolution}</span>
                        {exc.resolution_notes && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                            {exc.resolution_notes}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>—</span>
                    )}
                  </td>
                  {isManager && (
                    <td>
                      {exc.status === 'OPEN' ? (
                        <button
                          className="btn btn-secondary btn-sm"
                          data-testid={`resolve-exc-btn-${exc.ref}`}
                          onClick={() => openResolveDialog(exc)}
                        >
                          Resolve
                        </button>
                      ) : (
                        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>Done</span>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', padding: '1rem' }}>
            <button
              className="btn btn-secondary btn-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <span style={{ alignSelf: 'center', fontSize: '0.85rem' }}>
              Page {page} of {totalPages}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Resolve Dialog Modal */}
      {selectedExc && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '560px' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.25rem' }}>Resolve Exception {selectedExc.ref}</h3>

            {resolveError && (
              <div className="banner banner-error" style={{ padding: '0.75rem', marginBottom: '1rem', borderRadius: '4px' }}>
                {resolveError}
              </div>
            )}

            {/* Facts Card */}
            <div
              style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '6px',
                padding: '1rem',
                marginBottom: '1rem',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.75rem',
                fontSize: '0.85rem'
              }}
            >
              <div>
                <span style={{ color: 'var(--color-text-secondary)' }}>Mission / Order:</span>
                <div>
                  <strong>{selectedExc.mission_ref}</strong> / {selectedExc.order_ref}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-secondary)' }}>Stop Ref:</span>
                <div>{selectedExc.stop_ref}</div>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-secondary)' }}>Location / Bin:</span>
                <div>
                  <strong>{selectedExc.bin_code}</strong>
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-secondary)' }}>Product (SKU):</span>
                <div>
                  {selectedExc.product_name} ({selectedExc.sku})
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-secondary)' }}>Problem Type:</span>
                <div>
                  <span className="badge badge-warning">{selectedExc.type}</span>
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-secondary)' }}>Quantities:</span>
                <div>
                  Expected: {selectedExc.expected_qty} | Picked: {selectedExc.actual_qty}
                </div>
              </div>
              {selectedExc.notes && (
                <div style={{ gridColumn: 'span 2' }}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>Picker Notes:</span>
                  <div style={{ fontStyle: 'italic' }}>"{selectedExc.notes}"</div>
                </div>
              )}
            </div>

            {/* Form Inputs */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem', fontWeight: 500 }}>
                Resolution Notes
              </label>
              <textarea
                className="form-control"
                rows={2}
                data-testid="resolve-notes-input"
                placeholder="Details of manager inspection..."
                value={resolveNotes}
                onChange={(e) => setResolveNotes(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem', fontWeight: 500 }}>
                Physical Count of Bin (Optional Recount)
              </label>
              <input
                type="number"
                className="form-control"
                data-testid="resolve-recount-input"
                placeholder="e.g. 0 if bin is truly empty"
                value={recountQty}
                onChange={(e) => setRecountQty(e.target.value)}
                min={0}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', display: 'block', marginTop: '0.25rem' }}>
                Providing a count clears the bin's quarantine recount flag and adjusts inventory.
              </span>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedExc(null)}
                disabled={resolveMutation.isPending}
              >
                Cancel
              </button>

              <button
                type="button"
                className="btn btn-warning"
                data-testid="resolve-accept-short-btn"
                onClick={() => handleResolve('ACCEPT_SHORT')}
                disabled={resolveMutation.isPending}
              >
                {resolveMutation.isPending ? 'Resolving...' : 'Accept Short'}
              </button>

              <button
                type="button"
                className="btn btn-primary"
                data-testid="resolve-reallocate-btn"
                onClick={() => handleResolve('REALLOCATE')}
                disabled={resolveMutation.isPending}
              >
                {resolveMutation.isPending ? 'Resolving...' : 'Reallocate from Other Bins'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
