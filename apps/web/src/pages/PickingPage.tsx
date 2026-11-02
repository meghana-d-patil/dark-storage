import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { MissionDto } from '@dark-storage/shared';
import { StatusBadge } from '../components/StatusBadge.js';

export const PickingPage: React.FC = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const isPicker = user?.role === 'PICKER';
  const isManager = user?.role === 'MANAGER';

  const { data, isLoading } = useQuery<{ missions: MissionDto[]; total: number; page: number; page_size: number }>({
    queryKey: ['missions', statusFilter, page],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('page_size', '25');
      if (statusFilter) params.set('status', statusFilter);
      return apiFetch(`/api/missions?${params.toString()}`);
    },
    refetchInterval: 10000
  });

  const missions = data?.missions || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600 }}>
            {isPicker ? 'My Picking Missions' : 'Picking Missions'}
          </h1>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
            {isPicker
              ? 'View assigned picking missions and execute optimized pick routes'
              : 'Monitor warehouse picking routes, assignments, and mission progress'}
          </p>
        </div>

        {isManager && (
          <div style={{ width: '180px' }}>
            <select
              className="form-control"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Statuses</option>
              <option value="ASSIGNED">ASSIGNED</option>
              <option value="IN_PROGRESS">IN_PROGRESS</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </div>
        )}
      </div>

      {isLoading ? (
        <div>Loading missions...</div>
      ) : missions.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', background: 'var(--color-bg-card)', borderRadius: '8px' }}>
          <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
            {isPicker ? 'No active picking missions assigned to you.' : 'No missions found.'}
          </p>
        </div>
      ) : (
        <div style={{ background: 'var(--color-bg-card)', borderRadius: '8px', overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Mission Ref</th>
                <th>Order Ref</th>
                {!isPicker && <th>Picker</th>}
                <th>Algorithm</th>
                <th>Distance</th>
                <th>Stops</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {missions.map((m) => (
                <tr key={m.id} data-testid={`mission-row-${m.ref}`}>
                  <td>
                    <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{m.ref}</span>
                  </td>
                  <td>{m.order_ref}</td>
                  {!isPicker && <td>{m.picker.name}</td>}
                  <td>
                    <span className="badge badge-info">{m.route.algorithm}</span>
                  </td>
                  <td>{m.route.total_distance.toFixed(1)} u</td>
                  <td>
                    {m.progress.finished_stops} / {m.progress.total_stops}
                  </td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                  <td>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => navigate(`/picking/${m.ref}`)}
                    >
                      View Mission
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.75rem 1rem',
                borderTop: '1px solid rgba(255,255,255,0.05)'
              }}
            >
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                Page {page} of {totalPages} ({total} missions)
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
