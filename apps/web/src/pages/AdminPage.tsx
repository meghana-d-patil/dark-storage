import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { AuditItemDto } from '@dark-storage/shared';

interface IntegrityCheckResult {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  rows?: unknown[];
}

interface IntegrityReport {
  ok: boolean;
  checks: IntegrityCheckResult[];
}

interface AuditResponse {
  items: AuditItemDto[];
  total: number;
  page: number;
  page_size: number;
}

export const AdminPage: React.FC = () => {
  const { user } = useAuthStore();
  const isManager = user?.role === 'MANAGER';

  const [activeTab, setActiveTab] = useState<'audit' | 'integrity'>('audit');

  // Audit filter state
  const [filterEntityType, setFilterEntityType] = useState('');
  const [filterEntityId, setFilterEntityId] = useState('');
  const [filterActor, setFilterActor] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Active query filters applied
  const [appliedFilters, setAppliedFilters] = useState({
    entity_type: '',
    entity_id: '',
    actor: '',
    action: ''
  });

  const handleApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setAppliedFilters({
      entity_type: filterEntityType.trim(),
      entity_id: filterEntityId.trim(),
      actor: filterActor.trim(),
      action: filterAction.trim()
    });
  };

  const handleResetFilters = () => {
    setFilterEntityType('');
    setFilterEntityId('');
    setFilterActor('');
    setFilterAction('');
    setPage(1);
    setAppliedFilters({
      entity_type: '',
      entity_id: '',
      actor: '',
      action: ''
    });
  };

  // Build query string
  const auditQueryParams = new URLSearchParams();
  if (appliedFilters.entity_type) auditQueryParams.set('entity_type', appliedFilters.entity_type);
  if (appliedFilters.entity_id) auditQueryParams.set('entity_id', appliedFilters.entity_id);
  if (appliedFilters.actor) auditQueryParams.set('actor', appliedFilters.actor);
  if (appliedFilters.action) auditQueryParams.set('action', appliedFilters.action);
  auditQueryParams.set('page', String(page));
  auditQueryParams.set('page_size', String(pageSize));

  const {
    data: auditData,
    isLoading: auditLoading,
    error: auditError
  } = useQuery<AuditResponse>({
    queryKey: ['audit', appliedFilters, page],
    queryFn: () => apiFetch<AuditResponse>(`/api/audit?${auditQueryParams.toString()}`),
    enabled: isManager && activeTab === 'audit'
  });

  // Integrity query
  const {
    data: integrityData,
    isLoading: integrityLoading,
    isFetching: integrityFetching,
    error: integrityError,
    refetch: refetchIntegrity
  } = useQuery<IntegrityReport>({
    queryKey: ['admin-integrity'],
    queryFn: () => apiFetch<IntegrityReport>('/api/admin/integrity'),
    enabled: isManager && activeTab === 'integrity'
  });

  if (!isManager) {
    return (
      <div style={{ padding: 24 }}>
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <h2 style={{ color: 'var(--accent-danger)', marginBottom: 12 }}>Access Denied</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Manager privileges are required to access the Admin panel.
          </p>
        </div>
      </div>
    );
  }

  const totalPages = auditData ? Math.max(1, Math.ceil(auditData.total / pageSize)) : 1;

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>System Administration</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Audit logs, database verification, and system integrity status.
        </p>
      </div>

      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
          data-testid="tab-audit"
        >
          Audit Log
        </button>
        <button
          className={`tab-btn ${activeTab === 'integrity' ? 'active' : ''}`}
          onClick={() => setActiveTab('integrity')}
          data-testid="tab-integrity"
        >
          Database Integrity
        </button>
      </div>

      {activeTab === 'audit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Filters Form */}
          <form
            onSubmit={handleApplyFilters}
            className="card"
            style={{
              padding: 16,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr)) auto',
              gap: 12,
              alignItems: 'flex-end'
            }}
          >
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 12 }}>Entity Type</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. order, receipt"
                value={filterEntityType}
                onChange={(e) => setFilterEntityType(e.target.value)}
                data-testid="audit-filter-entity-type"
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 12 }}>Entity ID / Ref</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. ORD-0001"
                value={filterEntityId}
                onChange={(e) => setFilterEntityId(e.target.value)}
                data-testid="audit-filter-entity-id"
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 12 }}>Actor</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. manager1"
                value={filterActor}
                onChange={(e) => setFilterActor(e.target.value)}
                data-testid="audit-filter-actor"
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 12 }}>Action</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. ORDER_PACKED"
                value={filterAction}
                onChange={(e) => setFilterAction(e.target.value)}
                data-testid="audit-filter-action"
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary" data-testid="audit-filter-submit">
                Filter
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleResetFilters}
                data-testid="audit-filter-reset"
              >
                Reset
              </button>
            </div>
          </form>

          {/* Audit Table Card */}
          <div className="card" style={{ padding: 16 }}>
            {auditLoading ? (
              <p style={{ color: 'var(--text-secondary)', padding: 16 }}>Loading audit entries...</p>
            ) : auditError ? (
              <p style={{ color: 'var(--accent-danger)', padding: 16 }}>Failed to load audit log.</p>
            ) : !auditData || auditData.items.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', padding: 16 }}>No audit entries found.</p>
            ) : (
              <>
                <div className="table-container">
                  <table data-testid="audit-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                        <th style={{ padding: '8px 12px' }}>Timestamp</th>
                        <th style={{ padding: '8px 12px' }}>Actor</th>
                        <th style={{ padding: '8px 12px' }}>Role</th>
                        <th style={{ padding: '8px 12px' }}>Action</th>
                        <th style={{ padding: '8px 12px' }}>Entity Type</th>
                        <th style={{ padding: '8px 12px' }}>Entity ID</th>
                        <th style={{ padding: '8px 12px' }}>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditData.items.map((item) => (
                        <tr
                          key={item.id}
                          style={{ borderBottom: '1px solid var(--border-color)', fontSize: 13 }}
                        >
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                            {new Date(item.at).toLocaleString()}
                          </td>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{item.actor}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span className="badge badge-info">{item.role}</span>
                          </td>
                          <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>
                            {item.action}
                          </td>
                          <td style={{ padding: '8px 12px' }}>{item.entity_type}</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>
                            {item.entity_id}
                          </td>
                          <td style={{ padding: '8px 12px', maxWidth: 300 }}>
                            <pre
                              style={{
                                margin: 0,
                                fontSize: 11,
                                background: 'rgba(0,0,0,0.2)',
                                padding: '4px 6px',
                                borderRadius: 4,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                              title={JSON.stringify(item.details, null, 2)}
                            >
                              {JSON.stringify(item.details)}
                            </pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 16,
                    paddingTop: 12,
                    borderTop: '1px solid var(--border-color)'
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)', fontSize: 13 }} data-testid="audit-page-info">
                    Page {auditData.page} of {totalPages} ({auditData.total} entries)
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-secondary"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      data-testid="audit-prev-page"
                    >
                      Previous
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      data-testid="audit-next-page"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'integrity' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            className="card"
            style={{
              padding: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Warehouse Invariants Verifier</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>
                Executes all 13 database integrity checks against warehouse.db read-only.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {integrityData && (
                <span
                  data-testid="integrity-status"
                  className={`badge ${integrityData.ok ? 'badge-ok' : 'badge-danger'}`}
                  style={{ fontSize: 13, padding: '6px 12px' }}
                >
                  {integrityData.ok ? 'PASS: ALL CHECKS PASSING' : 'FAIL: INVARIANTS VIOLATED'}
                </span>
              )}
              <button
                className="btn btn-primary"
                onClick={() => refetchIntegrity()}
                disabled={integrityLoading || integrityFetching}
                data-testid="integrity-run-btn"
              >
                {integrityLoading || integrityFetching ? 'Running...' : 'Run integrity checks'}
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            {integrityLoading ? (
              <p style={{ color: 'var(--text-secondary)', padding: 16 }}>Running integrity checks...</p>
            ) : integrityError ? (
              <p style={{ color: 'var(--accent-danger)', padding: 16 }}>
                Failed to execute integrity checks: {String(integrityError)}
              </p>
            ) : !integrityData ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
                Click "Run integrity checks" to inspect database invariants.
              </div>
            ) : (
              <div className="table-container">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                      <th style={{ padding: '8px 12px', width: 80 }}>Check ID</th>
                      <th style={{ padding: '8px 12px' }}>Rule Description</th>
                      <th style={{ padding: '8px 12px', width: 120 }}>Status</th>
                      <th style={{ padding: '8px 12px' }}>Offending Rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {integrityData.checks.map((check) => (
                      <tr
                        key={check.id}
                        style={{ borderBottom: '1px solid var(--border-color)', fontSize: 13 }}
                      >
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {check.id}
                        </td>
                        <td style={{ padding: '8px 12px' }}>{check.name}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span
                            data-testid={`integrity-check-${check.id}`}
                            className={`badge ${
                              check.status === 'PASS'
                                ? 'badge-ok'
                                : check.status === 'FAIL'
                                ? 'badge-danger'
                                : 'badge-warning'
                            }`}
                          >
                            {check.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          {check.rows && check.rows.length > 0 ? (
                            <pre
                              data-testid={`integrity-rows-${check.id}`}
                              style={{
                                margin: 0,
                                fontSize: 11,
                                color: 'var(--accent-danger)',
                                background: 'rgba(239, 68, 68, 0.1)',
                                padding: '4px 8px',
                                borderRadius: 4,
                                maxHeight: 120,
                                overflow: 'auto'
                              }}
                            >
                              {JSON.stringify(check.rows, null, 2)}
                            </pre>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>None</span>
                          )}
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
  );
};
