import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { useCan } from '../hooks/useCan.js';
import { useAuthStore } from '../stores/authStore.js';

interface AuditItem {
  id: number;
  seq: number;
  at: string;
  actor: string;
  role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  prev_hash?: string;
  row_hash?: string;
  details: any;
}

interface VerifyResult {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  head: {
    last_seq: number;
    last_hash: string;
  } | null;
}

export const AuditPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { token } = useAuthStore();
  const canVerify = useCan('audit:verify');
  const canExport = useCan('audit:export');

  // Filters
  const [entityType, setEntityType] = useState('');
  const [entityRef, setEntityRef] = useState('');
  const [action, setAction] = useState('');
  const [verifyStatus, setVerifyStatus] = useState<VerifyResult | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});

  const { data, isLoading, refetch } = useQuery<{ items: AuditItem[]; total: number }>({
    queryKey: ['audit-log', entityType, entityRef, action],
    queryFn: () => {
      const params = new URLSearchParams();
      if (entityType) params.set('entityType', entityType);
      if (entityRef) params.set('entityRef', entityRef);
      if (action) params.set('action', action);
      params.set('limit', '100');
      return apiFetch(`/api/audit?${params.toString()}`);
    },
    refetchInterval: 10000
  });

  const verifyMutation = useMutation({
    mutationFn: () => apiFetch<VerifyResult>('/api/audit/verify'),
    onSuccess: (res) => {
      setVerifyStatus(res);
      refetch();
    }
  });

  const handleExportCsv = async () => {
    try {
      const res = await fetch('/api/audit/export', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Failed to export CSV:', err);
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const items = data?.items || [];

  return (
    <div className="m3-page">
      <div className="m3-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Immutable Audit Ledger</h1>
          <p className="m3-subtitle">Cryptographically hash-chained tamper-evident audit history</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {canExport && (
            <button
              className="btn btn-secondary"
              onClick={handleExportCsv}
              data-testid="audit-export-btn"
            >
              📥 Export CSV
            </button>
          )}
          {canVerify && (
            <button
              className="btn btn-primary"
              onClick={() => verifyMutation.mutate()}
              disabled={verifyMutation.isPending}
              data-testid="audit-verify-btn"
            >
              {verifyMutation.isPending ? 'Verifying Chain...' : '🛡️ Verify Chain Integrity'}
            </button>
          )}
        </div>
      </div>

      {verifyStatus && (
        <div
          className={`banner ${verifyStatus.ok ? 'banner-success' : 'banner-error'}`}
          data-testid="audit-verify-banner"
          style={{ marginBottom: '16px' }}
        >
          {verifyStatus.ok ? (
            <div>
              <strong>✓ Chain Intact:</strong> Successfully verified {verifyStatus.checked} sequentially linked records. Head sequence: <code>{verifyStatus.head?.last_seq}</code>.
            </div>
          ) : (
            <div>
              <strong>⚠️ Tampering Detected:</strong> Audit hash chain broken at sequence <code>{verifyStatus.brokenAtSeq}</code>!
            </div>
          )}
        </div>
      )}

      {/* Filter Bar */}
      <div className="card" style={{ marginBottom: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: '160px' }}>
          <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Entity Type</label>
          <input
            className="input"
            placeholder="e.g. ORDER, BIN, system_config"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
          />
        </div>
        <div style={{ flex: 1, minWidth: '160px' }}>
          <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Entity Ref / ID</label>
          <input
            className="input"
            placeholder="e.g. ORD-001, A-01-01"
            value={entityRef}
            onChange={(e) => setEntityRef(e.target.value)}
          />
        </div>
        <div style={{ flex: 1, minWidth: '160px' }}>
          <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Action</label>
          <input
            className="input"
            placeholder="e.g. ORDER_CREATED, config.changed"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', height: '100%', paddingTop: '16px' }}>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setEntityType('');
              setEntityRef('');
              setAction('');
            }}
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="table" data-testid="audit-table">
          <thead>
            <tr>
              <th style={{ width: '60px' }}>Seq</th>
              <th style={{ width: '170px' }}>Timestamp</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Hash Chain (SHA-256)</th>
              <th style={{ width: '80px' }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '30px' }}>
                  Loading audit ledger...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                  No audit entries found matching filters.
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <React.Fragment key={row.id}>
                  <tr>
                    <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>
                      #{row.seq ?? row.id}
                    </td>
                    <td style={{ fontSize: '12px' }}>
                      {new Date(row.at).toLocaleString()}
                    </td>
                    <td>
                      <strong>{row.actor}</strong>
                      <span className="badge badge-info" style={{ marginLeft: '6px', fontSize: '10px' }}>
                        {row.role}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                        {row.action}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{row.entity_type}:</span>{' '}
                      <strong>{row.entity_id}</strong>
                    </td>
                    <td style={{ fontSize: '11px', fontFamily: 'monospace', maxWidth: '180px' }}>
                      <div title={`Row Hash: ${row.row_hash || 'none'}`}>
                        Hash: {row.row_hash ? row.row_hash.slice(0, 12) + '…' : '—'}
                      </div>
                      <div style={{ color: 'var(--text-muted)' }} title={`Prev Hash: ${row.prev_hash || 'none'}`}>
                        Prev: {row.prev_hash ? row.prev_hash.slice(0, 10) + '…' : '—'}
                      </div>
                    </td>
                    <td>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => toggleExpand(row.id)}
                        style={{ fontSize: '11px', padding: '2px 8px' }}
                      >
                        {expandedRows[row.id] ? 'Hide' : 'View'}
                      </button>
                    </td>
                  </tr>
                  {expandedRows[row.id] && (
                    <tr style={{ backgroundColor: 'var(--bg-surface)' }}>
                      <td colSpan={7} style={{ padding: '12px 20px' }}>
                        <div style={{ fontSize: '12px', marginBottom: '4px', fontWeight: 700 }}>Record Metadata & Payload:</div>
                        <pre style={{ margin: 0, padding: '10px', background: 'var(--bg-card, #1e293b)', color: '#f8fafc', borderRadius: '6px', fontSize: '11px', overflowX: 'auto' }}>
                          {JSON.stringify({
                            seq: row.seq,
                            prev_hash: row.prev_hash,
                            row_hash: row.row_hash,
                            details: row.details
                          }, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
