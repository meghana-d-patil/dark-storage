import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../api/client.js';
import { ProductLabel } from './ProductLabel.js';

interface AllocationModalProps {
  receiptLine: {
    line_id: number;
    receipt_ref: string;
    sku: string;
    product_name: string;
    qty_staged: number;
  };
  onClose: () => void;
}

interface ScoredCandidate {
  bin_code: string;
  shelf_code: string;
  level: number;
  capacity: number;
  current_qty: number;
  current_sku: string | null;
  free_capacity: number;
  can_fit_full: boolean;
  suggested_qty: number;
  distance: number;
  score: number;
  breakdown: Array<{
    factor: string;
    weight: number;
    value: number;
    contribution: number;
    applied: boolean;
    neutral?: boolean;
    note?: string;
  }>;
  reason: string;
}

interface RecommendationData {
  receipt_line: {
    line_id: number;
    receipt_ref: string;
    sku: string;
    product_name: string;
    qty_staged: number;
  };
  requested_qty: number;
  generated_at: string;
  scoring: {
    weights: Record<string, number>;
    velocity_applied: boolean;
    velocity_note: string;
  };
  recommended: ScoredCandidate | null;
  alternatives: ScoredCandidate[];
  split_plan: Array<{ bin_code: string; qty: number }>;
  split_plan_complete: boolean;
  rejected_summary: Record<string, number>;
  all_bins?: Array<{ bin_code: string; valid: boolean; reason?: string; score?: number }>;
}

const ERROR_MESSAGE_MAP: Record<string, string> = {
  SKU_CONFLICT: 'Another product is already stored in that bin',
  CAPACITY_EXCEEDED: 'Bin capacity would be exceeded',
  BIN_NOT_RECEIVABLE: 'Bin or shelf is not in active receivable state',
  STORAGE_CLASS_MISMATCH: 'Product storage class does not match shelf storage class',
  INSUFFICIENT_STAGED_STOCK: 'Requested quantity exceeds staged stock',
  ENGINE1_UNAVAILABLE: 'Scheduler service is temporarily unavailable',
  ENGINE3_UNAVAILABLE: 'Inventory engine is temporarily unavailable'
};

export const AllocationModal: React.FC<AllocationModalProps> = ({ receiptLine, onClose }) => {
  const queryClient = useQueryClient();
  const [qty, setQty] = useState<number>(receiptLine.qty_staged);
  const [showAllBins, setShowAllBins] = useState(false);
  const [selectedBin, setSelectedBin] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; message: string } | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatusText, setSubmitStatusText] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<RecommendationData>({
    queryKey: ['placement', 'recommend', receiptLine.line_id, qty, showAllBins],
    queryFn: () =>
      apiFetch('/api/placement/recommend', {
        method: 'POST',
        body: JSON.stringify({
          receipt_line_id: receiptLine.line_id,
          qty,
          include_all: showAllBins
        })
      })
  });

  // Auto-select recommended bin when data arrives if not selected yet
  useEffect(() => {
    if (data?.recommended && !selectedBin) {
      setSelectedBin(data.recommended.bin_code);
      setValidationResult({
        valid: true,
        message: `Valid — free capacity ${data.recommended.free_capacity}`
      });
    }
  }, [data?.recommended, selectedBin]);

  const validateMutation = useMutation({
    mutationFn: async (binCode: string) => {
      setSelectedBin(binCode);
      return apiFetch('/api/placement/validate', {
        method: 'POST',
        body: JSON.stringify({
          dest_bin: binCode,
          qty,
          receipt_line_id: receiptLine.line_id
        })
      });
    },
    onSuccess: (res: any) => {
      if (res.valid) {
        setValidationResult({
          valid: true,
          message: `Valid — free capacity ${res.free_capacity}`
        });
      } else {
        setValidationResult({
          valid: false,
          message: `Invalid: ${res.reason || 'Not suitable'}`
        });
      }
    },
    onError: (err: any) => {
      setValidationResult({
        valid: false,
        message: err.message || 'Validation failed'
      });
    }
  });

  const handleConfirmPutaway = async () => {
    if (!selectedBin || isSubmitting || validationResult?.valid !== true) return;
    if (qty <= 0 || qty > receiptLine.qty_staged) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setSubmitStatusText('Validating bin freshness…');

    try {
      // 1. Re-validate against fresh state
      const valRes: any = await apiFetch('/api/placement/validate', {
        method: 'POST',
        body: JSON.stringify({
          dest_bin: selectedBin,
          qty,
          receipt_line_id: receiptLine.line_id
        })
      });

      if (!valRes.valid) {
        const mapped = ERROR_MESSAGE_MAP[valRes.reason] || `Invalid: ${valRes.reason || 'Placement invalid'}`;
        setErrorMessage(mapped);
        setValidationResult({ valid: false, message: mapped });
        setIsSubmitting(false);
        setSubmitStatusText(null);
        refetch();
        return;
      }

      setSubmitStatusText('Submitting put-away task…');
      const idemKey = crypto.randomUUID();

      const putawayRes: any = await apiFetch('/api/putaways', {
        method: 'POST',
        idempotencyKey: idemKey,
        body: JSON.stringify({
          receipt_line_id: receiptLine.line_id,
          dest_bin: selectedBin,
          qty,
          recommended_bin: data?.recommended?.bin_code
        })
      });

      // If 202 async task
      if (putawayRes.task_id && putawayRes.status !== 'SUCCEEDED') {
        setSubmitStatusText('Queued → Executing…');
        const taskId = putawayRes.task_id;
        let pollCount = 0;
        const maxPolls = 60; // 60 seconds

        const pollInterval = setInterval(async () => {
          pollCount++;
          try {
            const task: any = await apiFetch(`/api/tasks/${taskId}`);
            if (task.status === 'SUCCEEDED') {
              clearInterval(pollInterval);
              const r = task.result;
              setSuccessBanner(
                `${r.ref} completed: ${r.qty} × ${r.product_name} → ${r.dest_bin} (${(r.selection_mode || 'RECOMMENDED').toLowerCase()})`
              );
              setIsSubmitting(false);
              setSubmitStatusText(null);
              queryClient.invalidateQueries({ queryKey: ['receipts'] });
              queryClient.invalidateQueries({ queryKey: ['inventory'] });
              queryClient.invalidateQueries({ queryKey: ['staged'] });
              queryClient.invalidateQueries({ queryKey: ['putaways'] });
            } else if (task.status === 'FAILED') {
              clearInterval(pollInterval);
              const code = task.error?.code || 'TASK_FAILED';
              setErrorMessage(ERROR_MESSAGE_MAP[code] || task.error?.message || 'Task failed');
              setIsSubmitting(false);
              setSubmitStatusText(null);
              refetch();
            } else if (pollCount >= maxPolls) {
              clearInterval(pollInterval);
              setSubmitStatusText('Task is still running — check the Tasks page');
              setIsSubmitting(false);
            }
          } catch (pollErr: any) {
            clearInterval(pollInterval);
            setErrorMessage(pollErr.message || 'Error checking task status');
            setIsSubmitting(false);
            setSubmitStatusText(null);
          }
        }, 1000);
      } else {
        // Immediate 201 result
        setSuccessBanner(
          `${putawayRes.ref} completed: ${putawayRes.qty} × ${putawayRes.product_name} → ${putawayRes.dest_bin} (${(putawayRes.selection_mode || 'RECOMMENDED').toLowerCase()})`
        );
        setIsSubmitting(false);
        setSubmitStatusText(null);
        queryClient.invalidateQueries({ queryKey: ['receipts'] });
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
        queryClient.invalidateQueries({ queryKey: ['staged'] });
        queryClient.invalidateQueries({ queryKey: ['putaways'] });
      }
    } catch (err: any) {
      setIsSubmitting(false);
      setSubmitStatusText(null);
      const code = err.code || '';
      const mapped = ERROR_MESSAGE_MAP[code] || err.message || 'Put-away failed';
      setErrorMessage(mapped);
      refetch();
    }
  };

  const elapsedSeconds = dataUpdatedAt ? Math.floor((Date.now() - dataUpdatedAt) / 1000) : 0;

  return (
    <div className="modal-backdrop">
      <div className="modal-content" style={{ maxWidth: 960, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Smart Allocation & Put-Away</h2>
          <button className="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>✕</button>
        </div>

        {/* Success Banner */}
        {successBanner && (
          <div className="alert alert-success" style={{ marginBottom: 16 }} data-testid="putaway-success-banner">
            <div style={{ fontWeight: 'bold' }}>✓ Put-away Confirmed</div>
            <div style={{ marginTop: 4 }}>{successBanner}</div>
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div className="alert alert-danger" style={{ marginBottom: 16 }} data-testid="putaway-error-banner">
            <strong>Put-away Error:</strong> {errorMessage}
          </div>
        )}

        {/* In-progress status */}
        {submitStatusText && (
          <div className="alert alert-info" style={{ marginBottom: 16 }} data-testid="putaway-progress-banner">
            <span className="spinner" style={{ marginRight: 8 }}>⏳</span> {submitStatusText}
          </div>
        )}

        {/* Context bar */}
        <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <span className="text-muted" style={{ fontSize: 12 }}>Receipt Ref</span>
            <div><strong>{receiptLine.receipt_ref}</strong></div>
          </div>
          <div>
            <span className="text-muted" style={{ fontSize: 12 }}>Product</span>
            <div><ProductLabel name={receiptLine.product_name} sku={receiptLine.sku} /></div>
          </div>
          <div>
            <span className="text-muted" style={{ fontSize: 12 }}>Total Staged</span>
            <div><strong>{receiptLine.qty_staged}</strong></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label htmlFor="putaway-qty" style={{ fontSize: 12, fontWeight: 'bold' }}>Qty to Put Away:</label>
            <input
              id="putaway-qty"
              type="number"
              min={1}
              max={receiptLine.qty_staged}
              value={qty}
              disabled={isSubmitting || !!successBanner}
              onChange={(e) => setQty(parseInt(e.target.value, 10) || 0)}
              style={{ width: 80, padding: '4px 8px' }}
              data-testid="alloc-qty"
            />
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="text-muted" style={{ fontSize: 12 }}>
              Generated {elapsedSeconds < 60 ? `${elapsedSeconds}s ago` : `${Math.floor(elapsedSeconds / 60)}m ago`}
            </span>
            <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => refetch()} disabled={isLoading || isSubmitting}>
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Validation result pill */}
        {selectedBin && validationResult && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 4,
              marginBottom: 16,
              fontSize: 13,
              backgroundColor: validationResult.valid ? 'rgba(74, 222, 128, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: validationResult.valid ? '#4ade80' : '#ef4444',
              border: `1px solid ${validationResult.valid ? '#4ade80' : '#ef4444'}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
            data-testid="alloc-validation-status"
          >
            <div>
              Selected Destination: <strong>{selectedBin}</strong> — {validationResult.message}
            </div>
            {selectedBin !== data?.recommended?.bin_code && data?.recommended && (
              <span className="badge badge-warning" style={{ fontSize: 11 }}>MANUAL SELECTION</span>
            )}
          </div>
        )}

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>Calculating optimal placement…</div>
        ) : !data ? (
          <div>No recommendation available.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Top Recommended Bin */}
            {data.recommended ? (
              <div
                className="card"
                data-testid="alloc-recommended-card"
                style={{
                  padding: 16,
                  border: selectedBin === data.recommended.bin_code ? '2px solid var(--accent)' : '1px solid var(--border)',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="badge badge-active" style={{ fontSize: 13 }}>RECOMMENDED CHOICE</span>
                    <h3 style={{ margin: 0, fontSize: 18 }}>Bin: {data.recommended.bin_code}</h3>
                    <span className="text-muted">Shelf: {data.recommended.shelf_code} (Level {data.recommended.level})</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 18, fontWeight: 'bold', color: 'var(--accent)' }}>
                      Score: {data.recommended.score.toFixed(1)}
                    </span>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '4px 12px' }}
                      disabled={isSubmitting || !!successBanner}
                      onClick={() => validateMutation.mutate(data.recommended!.bin_code)}
                      data-testid="alloc-select-recommended"
                    >
                      {selectedBin === data.recommended.bin_code ? '✓ Selected' : 'Use Recommended'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 13 }}>
                  <div>Free Capacity: <strong>{data.recommended.free_capacity}</strong> / {data.recommended.capacity}</div>
                  <div>Current SKU: <strong>{data.recommended.current_sku || '(empty)'}</strong></div>
                  <div>Current Qty: <strong>{data.recommended.current_qty}</strong></div>
                  <div>Distance from Dock: <strong>{data.recommended.distance} m</strong></div>
                  <div>Fits Full: <strong>{data.recommended.can_fit_full ? 'YES' : 'NO'}</strong></div>
                </div>

                {/* Score breakdown bar */}
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 4 }}>Score Breakdown:</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {data.recommended.breakdown.map((b) => (
                      <div
                        key={b.factor}
                        style={{
                          backgroundColor: 'var(--bg-primary)',
                          padding: '4px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          border: '1px solid var(--border)'
                        }}
                      >
                        <span className="text-muted">{b.factor}: </span>
                        <strong>+{b.contribution.toFixed(1)}</strong>
                        <span style={{ opacity: 0.7 }}> ({(b.value * 100).toFixed(0)}% × {b.weight})</span>
                        {b.neutral && <span style={{ color: '#fbbf24', marginLeft: 4 }} title={b.note}>ⓘ</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="alert alert-warning">
                No single bin can receive this item. Review rejected reasons or split plan below.
              </div>
            )}

            {/* Split Plan Box */}
            {data.split_plan && data.split_plan.length > 1 && (
              <div className="card" style={{ padding: 16, backgroundColor: 'rgba(251, 191, 36, 0.05)', border: '1px solid rgba(251, 191, 36, 0.3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: 0, color: '#fbbf24' }}>Split Placement Plan</h4>
                  <span className="text-muted" style={{ fontSize: 12 }}>Full quantity cannot fit into a single bin</span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <table style={{ width: '100%', fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th>Bin</th>
                        <th>Put-away Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.split_plan.map((sp, idx) => (
                        <tr key={idx}>
                          <td><strong>{sp.bin_code}</strong></td>
                          <td>{sp.qty} units</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Alternatives Table */}
            {data.alternatives && data.alternatives.length > 0 && (
              <div>
                <h4 style={{ marginBottom: 8 }}>Top Ranked Alternatives</h4>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Bin</th>
                        <th>Shelf</th>
                        <th>Level</th>
                        <th>Free / Total</th>
                        <th>Current SKU</th>
                        <th>Distance</th>
                        <th>Score</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.alternatives.map((alt) => (
                        <tr
                          key={alt.bin_code}
                          style={{
                            backgroundColor: selectedBin === alt.bin_code ? 'rgba(74, 222, 128, 0.08)' : undefined
                          }}
                        >
                          <td><strong>{alt.bin_code}</strong></td>
                          <td>{alt.shelf_code}</td>
                          <td>L{alt.level}</td>
                          <td>{alt.free_capacity} / {alt.capacity}</td>
                          <td>{alt.current_sku || '—'}</td>
                          <td>{alt.distance} m</td>
                          <td><strong>{alt.score.toFixed(1)}</strong></td>
                          <td>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '2px 8px', fontSize: 12 }}
                              disabled={isSubmitting || !!successBanner}
                              onClick={() => validateMutation.mutate(alt.bin_code)}
                              data-testid={`alloc-select-bin-${alt.bin_code}`}
                            >
                              {selectedBin === alt.bin_code ? 'Selected' : 'Select'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Show All Bins Toggle */}
            <div style={{ marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  data-testid="alloc-show-all-toggle"
                  checked={showAllBins}
                  disabled={isSubmitting || !!successBanner}
                  onChange={(e) => setShowAllBins(e.target.checked)}
                />
                <strong>Show all 192 bins (manual selection)</strong>
              </label>

              {showAllBins && data.all_bins && (
                <div className="table-container" style={{ marginTop: 12, maxHeight: 300, overflowY: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Bin</th>
                        <th>Status / Reason</th>
                        <th>Score</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.all_bins.map((b) => (
                        <tr
                          key={b.bin_code}
                          style={{
                            opacity: b.valid ? 1 : 0.5,
                            backgroundColor: selectedBin === b.bin_code ? 'rgba(74, 222, 128, 0.08)' : (b.valid ? undefined : 'rgba(255,255,255,0.02)')
                          }}
                        >
                          <td><strong>{b.bin_code}</strong></td>
                          <td>
                            {b.valid ? (
                              <span className="badge badge-active">VALID</span>
                            ) : (
                              <span className="badge badge-danger">{b.reason}</span>
                            )}
                          </td>
                          <td>{b.score !== undefined ? b.score : '—'}</td>
                          <td>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '2px 8px', fontSize: 12 }}
                              disabled={!b.valid || isSubmitting || !!successBanner}
                              onClick={() => validateMutation.mutate(b.bin_code)}
                              data-testid={`alloc-select-bin-${b.bin_code}`}
                            >
                              {selectedBin === b.bin_code ? 'Selected' : 'Select'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer with Confirm Action */}
            <div
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                {selectedBin && (
                  <span className="text-muted" style={{ fontSize: 13 }}>
                    Ready to put away <strong>{qty}</strong> units into <strong>{selectedBin}</strong>
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  className="btn btn-secondary"
                  onClick={onClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  style={{ minWidth: 160 }}
                  disabled={
                    !selectedBin ||
                    isSubmitting ||
                    !!successBanner ||
                    validationResult?.valid !== true ||
                    qty <= 0 ||
                    qty > receiptLine.qty_staged
                  }
                  onClick={handleConfirmPutaway}
                  data-testid="alloc-confirm-btn"
                >
                  {isSubmitting ? 'Confirming…' : 'Confirm Put-away'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
