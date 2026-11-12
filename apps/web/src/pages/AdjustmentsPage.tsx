import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { useCan } from '../hooks/useCan.js';
import { StatusBadge } from '../components/StatusBadge.js';

interface AdjustmentItem {
  id: number;
  adj_ref: string;
  kind: 'COUNT_VARIANCE' | 'DAMAGE_WRITE_OFF' | 'EXPIRY_WRITE_OFF' | 'RTV';
  status: 'PENDING_MANAGER' | 'PENDING_ADMIN' | 'APPLIED' | 'REJECTED';
  bin_code: string;
  sku: string;
  lot_id?: string;
  delta_qty: number;
  value_paise: number;
  reason_code: string;
  note?: string;
  requested_by: string;
  requested_at: string;
  manager_id?: string;
  manager_at?: string;
  admin_id?: string;
  admin_at?: string;
  reject_reason?: string;
  source_ref?: string;
  version: number;
}

export const AdjustmentsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canApproveManager = useCan('adjust:approve');
  const canApproveAdmin = useCan('adjust:approve_high');

  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedAdj, setSelectedAdj] = useState<AdjustmentItem | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('COUNT_DISPUTED');
  const [rejectNote, setRejectNote] = useState('');
  const [approveNote, setApproveNote] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // New adjustment request modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [formBin, setFormBin] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formDelta, setFormDelta] = useState<number | ''>('');
  const [formReason, setFormReason] = useState('CYCLE_COUNT');
  const [formNote, setFormNote] = useState('');

  const queryParams = new URLSearchParams();
  if (statusFilter !== 'ALL') {
    queryParams.set('status', statusFilter);
  }

  const { data, isLoading } = useQuery<{ items: AdjustmentItem[] }>({
    queryKey: ['adjustments', statusFilter],
    queryFn: () => apiFetch(`/api/adjustments?${queryParams.toString()}`),
    refetchInterval: 5000,
  });

  const adjustments = data?.items || [];

  const approveMutation = useMutation({
    mutationFn: ({ ref, note }: { ref: string; note?: string }) =>
      apiFetch(`/api/adjustments/${encodeURIComponent(ref)}/approve`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    onSuccess: () => {
      setSelectedAdj(null);
      setApproveNote('');
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Failed to approve adjustment');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ ref, reasonCode, note }: { ref: string; reasonCode: string; note?: string }) =>
      apiFetch(`/api/adjustments/${encodeURIComponent(ref)}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reasonCode, note }),
      }),
    onSuccess: () => {
      setSelectedAdj(null);
      setRejectModalOpen(false);
      setRejectNote('');
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Failed to reject adjustment');
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: any) =>
      apiFetch('/api/adjustments/request', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setCreateModalOpen(false);
      setFormBin('');
      setFormSku('');
      setFormDelta('');
      setFormNote('');
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Failed to request adjustment');
    },
  });

  const handleApprove = (adj: AdjustmentItem) => {
    setSelectedAdj(adj);
    setErrorMessage(null);
    approveMutation.mutate({ ref: adj.adj_ref, note: approveNote || undefined });
  };

  const handleOpenReject = (adj: AdjustmentItem) => {
    setSelectedAdj(adj);
    setRejectReason('COUNT_DISPUTED');
    setRejectNote('');
    setErrorMessage(null);
    setRejectModalOpen(true);
  };

  const handleConfirmReject = () => {
    if (!selectedAdj) return;
    rejectMutation.mutate({
      ref: selectedAdj.adj_ref,
      reasonCode: rejectReason,
      note: rejectNote || undefined,
    });
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formBin || !formSku || formDelta === '') return;
    createMutation.mutate({
      binCode: formBin.trim(),
      sku: formSku.trim(),
      deltaQty: Number(formDelta),
      reasonCode: formReason,
      note: formNote.trim() || undefined,
    });
  };

  return (
    <div className="m3-page">
      <div className="m3-page-header">
        <div>
          <h1>Stock Adjustments & Dual-Control Approvals</h1>
          <p className="m3-subtitle">
            Authorise inventory variances, shrinkage, damage write-offs, and cycle count discrepancies.
          </p>
        </div>
        <div>
          <button
            className="btn btn-primary"
            onClick={() => setCreateModalOpen(true)}
            data-testid="request-adj-btn"
          >
            + Request Adjustment
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="banner banner-error" style={{ marginBottom: '16px' }}>
          {errorMessage}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="m3-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label className="form-label" style={{ margin: 0 }}>Status:</label>
          <select
            className="select"
            style={{ width: '180px' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            data-testid="adj-status-filter"
          >
            <option value="ALL">All Statuses</option>
            <option value="PENDING_MANAGER">Pending Manager</option>
            <option value="PENDING_ADMIN">Pending Admin (High-Value)</option>
            <option value="APPLIED">Applied</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>

        <div style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--text-secondary)' }}>
          Total Adjustments: <strong style={{ color: 'var(--text-primary)' }}>{adjustments.length}</strong>
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Status</th>
              <th>Kind</th>
              <th>Location</th>
              <th>SKU</th>
              <th>Delta Qty</th>
              <th>Value (₹)</th>
              <th>Reason</th>
              <th>Requested By</th>
              <th>Approver / Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  Loading adjustments...
                </td>
              </tr>
            ) : adjustments.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  No adjustments found.
                </td>
              </tr>
            ) : (
              adjustments.map((adj) => {
                const isPendingManager = adj.status === 'PENDING_MANAGER';
                const isPendingAdmin = adj.status === 'PENDING_ADMIN';
                const isHighValue = adj.value_paise >= 500000;
                const isOwnRequest = user?.username === adj.requested_by;
                const canAct =
                  (isPendingManager && canApproveManager && !isOwnRequest) ||
                  (isPendingAdmin && canApproveAdmin && (!isOwnRequest || user?.role === 'ADMIN'));

                return (
                  <tr key={adj.id} data-testid={`adj-row-${adj.adj_ref}`}>
                    <td>
                      <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)' }}>
                        {adj.adj_ref}
                      </span>
                      {adj.source_ref && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Src: {adj.source_ref}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={adj.status} />
                      {isHighValue && isPendingAdmin && (
                        <div style={{ marginTop: '4px' }}>
                          <span className="badge badge-warning" style={{ fontSize: '10px' }}>⚠️ High-Value (Admin)</span>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-info">{adj.kind}</span>
                    </td>
                    <td>
                      <strong style={{ fontFamily: 'var(--font-mono)' }}>{adj.bin_code}</strong>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{adj.sku}</span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontWeight: 700,
                          color: adj.delta_qty > 0 ? 'var(--status-ok)' : 'var(--status-danger)',
                        }}
                      >
                        {adj.delta_qty > 0 ? `+${adj.delta_qty}` : adj.delta_qty}
                      </span>
                    </td>
                    <td>
                      ₹{(adj.value_paise / 100).toFixed(2)}
                    </td>
                    <td>
                      <div>{adj.reason_code}</div>
                      {adj.note && (
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                          "{adj.note}"
                        </div>
                      )}
                    </td>
                    <td>
                      <div>{adj.requested_by}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {new Date(adj.requested_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td>
                      {adj.status === 'APPLIED' && (
                        <div>
                          <div style={{ color: 'var(--status-ok)', fontWeight: 600 }}>
                            {adj.admin_id ? `Admin #${adj.admin_id}` : `Mgr #${adj.manager_id}`}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {adj.admin_at || adj.manager_at ? new Date(adj.admin_at || adj.manager_at!).toLocaleDateString() : ''}
                          </div>
                        </div>
                      )}
                      {adj.status === 'REJECTED' && (
                        <div>
                          <span className="badge badge-danger">Rejected</span>
                          {adj.reject_reason && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{adj.reject_reason}</div>
                          )}
                        </div>
                      )}
                      {(isPendingManager || isPendingAdmin) && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Awaiting signature</span>
                      )}
                    </td>
                    <td>
                      {(isPendingManager || isPendingAdmin) ? (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={!canAct || approveMutation.isPending}
                            onClick={() => handleApprove(adj)}
                            data-testid={`approve-adj-${adj.adj_ref}`}
                            title={isOwnRequest ? 'Cannot approve own request' : 'Approve adjustment'}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={!canAct || rejectMutation.isPending}
                            onClick={() => handleOpenReject(adj)}
                            data-testid={`reject-adj-${adj.adj_ref}`}
                            title={isOwnRequest ? 'Cannot reject own request' : 'Reject adjustment'}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Reject Modal */}
      {rejectModalOpen && selectedAdj && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <h3 style={{ margin: '0 0 16px', fontWeight: 800 }}>
              Reject Adjustment <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedAdj.adj_ref}</span>
            </h3>

            <div className="form-group">
              <label className="form-label">Reject Reason Code</label>
              <select
                className="select"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              >
                <option value="COUNT_DISPUTED">Count Disputed / Recount Needed</option>
                <option value="UNAUTHORIZED">Unauthorized Variance</option>
                <option value="INCORRECT_SKU">Incorrect SKU / Lot</option>
                <option value="POLICY_VIOLATION">Policy Threshold Exceeded</option>
                <option value="OTHER">Other Reason</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label className="form-label">Notes (Optional)</label>
              <textarea
                className="input-field"
                rows={3}
                placeholder="Explanation for rejection..."
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRejectModalOpen(false)}
                disabled={rejectMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleConfirmReject}
                disabled={rejectMutation.isPending}
              >
                {rejectMutation.isPending ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Adjustment Modal */}
      {createModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <h3 style={{ margin: '0 0 16px', fontWeight: 800 }}>Request Stock Adjustment</h3>

            <form onSubmit={handleCreateSubmit}>
              <div className="form-group">
                <label className="form-label">Bin Code</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. A-01-01"
                  required
                  value={formBin}
                  onChange={(e) => setFormBin(e.target.value.toUpperCase())}
                />
              </div>

              <div className="form-group">
                <label className="form-label">SKU</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. SKU-SNACK-01"
                  required
                  value={formSku}
                  onChange={(e) => setFormSku(e.target.value.toUpperCase())}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Delta Qty (Negative for Loss, Positive for Gain)</label>
                <input
                  type="number"
                  className="input-field"
                  placeholder="e.g. -2 or 5"
                  required
                  value={formDelta}
                  onChange={(e) => setFormDelta(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Reason Code</label>
                <select
                  className="select"
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                >
                  <option value="CYCLE_COUNT">Cycle Count Discrepancy</option>
                  <option value="DAMAGED">Damaged Stock</option>
                  <option value="EXPIRED">Expired Product</option>
                  <option value="FOUND_STOCK">Found Stock / Untracked Gain</option>
                  <option value="SHRINKAGE">Shrinkage / Missing</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label className="form-label">Note</label>
                <textarea
                  className="input-field"
                  rows={2}
                  placeholder="Context for approving manager..."
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCreateModalOpen(false)}
                  disabled={createMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
