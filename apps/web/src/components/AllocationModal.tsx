import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
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

export const AllocationModal: React.FC<AllocationModalProps> = ({ receiptLine, onClose }) => {
  const [qty, setQty] = useState<number>(receiptLine.qty_staged);
  const [showAllBins, setShowAllBins] = useState(false);
  const [selectedBin, setSelectedBin] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; message: string } | null>(null);

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

  const secondsAgo = Math.max(0, Math.floor((Date.now() - dataUpdatedAt) / 1000));

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div
        className="drawer-content"
        style={{ maxWidth: 680 }}
        onClick={(e) => e.stopPropagation()}
        data-testid="allocation-panel"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Smart Placement Allocation</h3>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {/* Header */}
        <div style={{ padding: 12, backgroundColor: 'var(--bg-surface)', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>
              <strong>{receiptLine.receipt_ref}</strong> · <ProductLabel sku={receiptLine.sku} name={receiptLine.product_name} />
            </span>
            <span>Staged: <strong>{receiptLine.qty_staged}</strong></span>
          </div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ fontSize: 13 }}>Quantity to allocate:</label>
            <input
              type="number"
              min="1"
              max={receiptLine.qty_staged}
              className="input"
              style={{ width: 100 }}
              value={qty}
              onChange={(e) => setQty(parseInt(e.target.value, 10) || 1)}
            />
            <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => refetch()}>
              Refresh ({secondsAgo}s ago)
            </button>
          </div>
        </div>

        {validationResult && (
          <div
            style={{
              padding: 10,
              borderRadius: 6,
              backgroundColor: validationResult.valid ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: validationResult.valid ? 'var(--accent-success)' : 'var(--accent-danger)',
              border: `1px solid ${validationResult.valid ? 'var(--accent-success)' : 'var(--accent-danger)'}`
            }}
            data-testid="alloc-validation-status"
          >
            Bin <strong>{selectedBin}</strong>: {validationResult.message}
          </div>
        )}

        {isLoading ? (
          <div>Loading recommendations...</div>
        ) : !data ? (
          <div>Failed to load recommendations.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Recommended Card */}
            {data.recommended ? (
              <div
                style={{
                  padding: 16,
                  border: '2px solid var(--accent-primary)',
                  borderRadius: 8,
                  backgroundColor: 'var(--bg-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}
                data-testid="recommended-bin-card"
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span className="badge badge-active" style={{ marginRight: 8 }}>Recommended</span>
                    <strong style={{ fontSize: 16 }}>{data.recommended.bin_code}</strong>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                      (Shelf {data.recommended.shelf_code}, L{data.recommended.level})
                    </span>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-primary)' }}>
                    Score: {data.recommended.score}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                  <div>Current Stock: {data.recommended.current_qty} {data.recommended.current_sku || ''}</div>
                  <div>Free Capacity: <strong>{data.recommended.free_capacity}</strong></div>
                  <div>Suggested Qty: <strong>{data.recommended.suggested_qty}</strong></div>
                  <div>Distance from Dock: {data.recommended.distance.toFixed(1)} units</div>
                </div>

                <p style={{ fontSize: 13, color: 'var(--text-primary)', fontStyle: 'italic' }}>
                  "{data.recommended.reason}"
                </p>

                {/* Factor Bars */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Factor Breakdown:</div>
                  {data.recommended.breakdown.map((b) => (
                    <div key={b.factor} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 90, textTransform: 'capitalize' }}>{b.factor}:</span>
                      <div className="fill-bar" style={{ height: 6 }}>
                        <div
                          className="fill-bar-inner med"
                          style={{ width: `${Math.round(b.value * 100)}%` }}
                        />
                      </div>
                      <span style={{ width: 140, color: 'var(--text-muted)' }}>
                        {b.applied
                          ? `${(b.weight * 100).toFixed(0)}% × ${(b.value * 100).toFixed(0)}% = +${b.contribution}`
                          : 'Not applied'}
                        {b.neutral ? ' (neutral)' : ''}
                      </span>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 8 }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => validateMutation.mutate(data.recommended!.bin_code)}
                    data-testid={`select-bin-${data.recommended.bin_code}`}
                  >
                    Select Recommended Bin
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--accent-warning)', padding: 12 }}>
                No single bin satisfies all constraints. See split plan or show all bins.
              </div>
            )}

            {/* Split Plan Box */}
            {data.recommended && !data.recommended.can_fit_full && data.split_plan.length > 1 && (
              <div
                style={{
                  padding: 12,
                  backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid var(--accent-warning)',
                  borderRadius: 6
                }}
              >
                <strong>Split Plan Required (Full quantity does not fit in one bin):</strong>
                <ul style={{ marginTop: 6, marginLeft: 20, fontSize: 13 }}>
                  {data.split_plan.map((sp) => (
                    <li key={sp.bin_code}>
                      Bin <strong>{sp.bin_code}</strong>: {sp.qty} units
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Alternatives Table */}
            {data.alternatives.length > 0 && (
              <div>
                <h4>Alternative Valid Bins</h4>
                <div className="table-container" style={{ marginTop: 8 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Bin</th>
                        <th>Shelf</th>
                        <th>Free</th>
                        <th>Distance</th>
                        <th>Score</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.alternatives.map((alt) => (
                        <tr key={alt.bin_code}>
                          <td><strong>{alt.bin_code}</strong></td>
                          <td>{alt.shelf_code}</td>
                          <td>{alt.free_capacity}</td>
                          <td>{alt.distance.toFixed(1)}</td>
                          <td><strong>{alt.score}</strong></td>
                          <td>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '2px 8px', fontSize: 12 }}
                              onClick={() => validateMutation.mutate(alt.bin_code)}
                              data-testid={`select-bin-${alt.bin_code}`}
                            >
                              Select
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
                  checked={showAllBins}
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
                            backgroundColor: b.valid ? undefined : 'rgba(255,255,255,0.02)'
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
                              disabled={!b.valid}
                              onClick={() => validateMutation.mutate(b.bin_code)}
                              data-testid={`select-bin-${b.bin_code}`}
                            >
                              Select
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
