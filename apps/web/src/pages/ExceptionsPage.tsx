import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { useCan } from '../hooks/useCan.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { Link } from 'react-router-dom';

interface PickExceptionItem {
  id: number;
  ref: string;
  exc_ref?: string;
  status: 'OPEN' | 'COUNT_REQUESTED' | 'COUNT_SUBMITTED' | 'RESOLVED';
  kind?: string;
  type?: string;
  mission_id?: number;
  mission_ref?: string;
  order_id?: number;
  order_ref?: string;
  stop_id?: number;
  stop_ref?: string;
  bin_code: string;
  sku: string;
  product_name?: string;
  expected_qty?: number;
  actual_qty?: number;
  notes?: string;
  raised_by?: string;
  raised_at?: string;
  reported_by?: any;
  reported_at?: string;
  escalated?: boolean;
  age_minutes?: number;
  due_at?: string;
  resolved_by?: string;
  resolution?: string;
  resolution_reason?: string;
  resolution_notes?: string;
  resolved_at?: string;
  count_task_ref?: string;
}

export const ExceptionsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canResolve = useCan('exception:resolve');
  const canRequestCount = useCan('count:request');

  const [statusFilter, setStatusFilter] = useState<string>('OPEN');
  const [page, setPage] = useState(1);

  // Modal state
  const [selectedExc, setSelectedExc] = useState<PickExceptionItem | null>(null);
  const [resolveReason, setResolveReason] = useState<string>('INVENTORY_ADJUSTED');
  const [resolveNote, setResolveNote] = useState<string>('');
  const [unfreezeBin, setUnfreezeBin] = useState<boolean>(true);
  const [resolveError, setResolveError] = useState<string>('');

  const queryParams = new URLSearchParams();
  if (statusFilter !== 'ALL') {
    queryParams.set('status', statusFilter);
  }
  queryParams.set('page', String(page));
  queryParams.set('page_size', '25');

  const { data, isLoading } = useQuery<{
    items?: PickExceptionItem[];
    exceptions?: PickExceptionItem[];
    total: number;
  }>({
    queryKey: ['exceptions', statusFilter, page],
    queryFn: () => apiFetch(`/api/exceptions?${queryParams.toString()}`),
    refetchInterval: 5000,
  });

  const exceptions = data?.items || data?.exceptions || [];
  const total = data?.total || exceptions.length;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  // Request count mutation
  const requestCountMutation = useMutation({
    mutationFn: (excRef: string) =>
      apiFetch(`/api/exceptions/${encodeURIComponent(excRef)}/request-count`, {
        method: 'POST',
        body: JSON.stringify({ note: 'Recount requested by manager' }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['floor-tasks'] });
    },
    onError: (err: any) => {
      alert(err.message || 'Failed to request count');
    },
  });

  // Resolve mutation
  const resolveMutation = useMutation({
    mutationFn: ({ ref, reasonCode, note, unfreeze }: { ref: string; reasonCode: string; note?: string; unfreeze: boolean }) =>
      apiFetch(`/api/exceptions/${encodeURIComponent(ref)}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ reasonCode, note, unfreeze }),
      }),
    onSuccess: () => {
      setSelectedExc(null);
      setResolveError('');
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse'] });
    },
    onError: (err: any) => {
      setResolveError(err.message || 'Failed to resolve exception');
    },
  });

  const openResolveDialog = (exc: PickExceptionItem) => {
    setSelectedExc(exc);
    setResolveReason('INVENTORY_ADJUSTED');
    setResolveNote('');
    setUnfreezeBin(true);
    setResolveError('');
  };

  const handleResolveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExc) return;
    resolveMutation.mutate({
      ref: selectedExc.ref || selectedExc.exc_ref!,
      reasonCode: resolveReason,
      note: resolveNote.trim() || undefined,
      unfreeze: unfreezeBin,
    });
  };

  return (
    <div className="m3-page">
      <div className="m3-page-header">
        <div>
          <h1>Pick Exceptions & Discrepancies</h1>
          <p className="m3-subtitle">
            Track missing stock, damaged goods, blocked bins, blind recount tasks, and resolution audits.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="m3-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label className="form-label" style={{ margin: 0 }}>Status:</label>
          <select
            className="select"
            style={{ width: '180px' }}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            data-testid="status-filter"
          >
            <option value="OPEN">Open (All Active)</option>
            <option value="COUNT_REQUESTED">Count Requested</option>
            <option value="COUNT_SUBMITTED">Count Submitted</option>
            <option value="RESOLVED">Resolved Only</option>
            <option value="ALL">All Statuses</option>
          </select>
        </div>

        <div style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--text-secondary)' }}>
          Total Exceptions: <strong style={{ color: 'var(--text-primary)' }}>{total}</strong>
        </div>
      </div>

      {/* Exceptions Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Status</th>
              <th>Kind</th>
              <th>Location</th>
              <th>SKU</th>
              <th>Order</th>
              <th>Reported By / Age</th>
              <th>Recount Task</th>
              <th>Resolution</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  Loading exceptions...
                </td>
              </tr>
            ) : exceptions.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  No exceptions matching criteria.
                </td>
              </tr>
            ) : (
              exceptions.map((exc) => {
                const excRef = exc.ref || exc.exc_ref;
                const kind = exc.kind || exc.type;
                const reporter = exc.raised_by || (exc.reported_by?.name || exc.reported_by);
                const isResolved = exc.status === 'RESOLVED';

                return (
                  <tr key={exc.id || excRef} data-testid={`exc-row-${excRef}`}>
                    <td>
                      <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
                        {excRef}
                      </span>
                      {exc.escalated && (
                        <div style={{ marginTop: '4px' }}>
                          <span className="badge badge-danger" style={{ fontSize: '10px' }}>⚠️ Escalated</span>
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={exc.status} />
                    </td>
                    <td>
                      <span className="badge badge-warning">{kind}</span>
                    </td>
                    <td>
                      <strong style={{ fontFamily: 'var(--font-mono)' }}>{exc.bin_code}</strong>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{exc.product_name || exc.sku}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {exc.sku}
                      </div>
                    </td>
                    <td>
                      {exc.order_ref ? (
                        <Link to={`/orders/${exc.order_ref}`} style={{ fontFamily: 'var(--font-mono)' }}>
                          {exc.order_ref}
                        </Link>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <div>{reporter || 'Picker'}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {exc.age_minutes != null ? `${exc.age_minutes}m ago` : ''}
                      </div>
                    </td>
                    <td>
                      {exc.count_task_ref ? (
                        <span className="badge badge-info" style={{ fontFamily: 'var(--font-mono)' }}>
                          {exc.count_task_ref}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                      )}
                    </td>
                    <td>
                      {isResolved ? (
                        <div>
                          <span className="badge badge-ok">{exc.resolution || 'RESOLVED'}</span>
                          {exc.resolution_reason && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                              {exc.resolution_reason}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Active</span>
                      )}
                    </td>
                    <td>
                      {!isResolved ? (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {canRequestCount && (
                            <button
                              className="btn btn-secondary btn-sm"
                              data-testid={`request-count-btn-${excRef}`}
                              onClick={() => requestCountMutation.mutate(excRef!)}
                              disabled={requestCountMutation.isPending}
                              title="Assign blind recount task to operators"
                            >
                              Request Count
                            </button>
                          )}
                          {canResolve && (
                            <button
                              className="btn btn-primary btn-sm"
                              data-testid={`resolve-exc-btn-${excRef}`}
                              onClick={() => openResolveDialog(exc)}
                              title="Resolve exception and unlock bin"
                            >
                              Resolve
                            </button>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Closed</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface)' }}>
            <button
              className="btn btn-secondary btn-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <span style={{ alignSelf: 'center', fontSize: '13px', color: 'var(--text-secondary)', padding: '0 8px' }}>
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
          <div className="modal-content" style={{ maxWidth: '540px' }}>
            <h3 style={{ margin: '0 0 16px', fontWeight: 800 }}>
              Resolve Exception <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedExc.ref || selectedExc.exc_ref}</span>
            </h3>

            {resolveError && (
              <div className="banner banner-error" style={{ marginBottom: '16px' }}>
                {resolveError}
              </div>
            )}

            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                marginBottom: '18px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                fontSize: '13px',
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Location / Bin:</span>
                <div>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>{selectedExc.bin_code}</strong>
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Product (SKU):</span>
                <div style={{ fontFamily: 'var(--font-mono)' }}>{selectedExc.sku}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Problem Kind:</span>
                <div>
                  <span className="badge badge-warning">{selectedExc.kind || selectedExc.type}</span>
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Current Status:</span>
                <div>
                  <StatusBadge status={selectedExc.status} />
                </div>
              </div>
            </div>

            <form onSubmit={handleResolveSubmit}>
              <div className="form-group">
                <label className="form-label">Resolution Reason Code</label>
                <select
                  className="select"
                  value={resolveReason}
                  onChange={(e) => setResolveReason(e.target.value)}
                  data-testid="resolve-reason-select"
                >
                  <option value="INVENTORY_ADJUSTED">Inventory Adjusted (Discrepancy Reconciled)</option>
                  <option value="COUNT_VERIFIED">Count Verified by Operator</option>
                  <option value="DAMAGED_RECORDED">Damaged Goods Quarantined</option>
                  <option value="FALSE_ALARM">False Alarm / Picker Overlooked Item</option>
                  <option value="OTHER">Other / Administrative Override</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Resolution Notes</label>
                <textarea
                  className="input-field"
                  rows={3}
                  placeholder="Details of investigation and resolution..."
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                  data-testid="resolve-notes-input"
                />
              </div>

              <div className="form-group" style={{ marginBottom: '24px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={unfreezeBin}
                    onChange={(e) => setUnfreezeBin(e.target.checked)}
                    data-testid="unfreeze-checkbox"
                  />
                  <span>Unfreeze Bin ({selectedExc.bin_code}) for future picks and allocations</span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedExc(null)}
                  disabled={resolveMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={resolveMutation.isPending}
                  data-testid="confirm-resolve-btn"
                >
                  {resolveMutation.isPending ? 'Resolving...' : 'Resolve & Unlock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
