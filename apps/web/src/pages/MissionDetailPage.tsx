import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { MissionDto } from '@dark-storage/shared';
import { StatusBadge } from '../components/StatusBadge.js';

export const MissionDetailPage: React.FC = () => {
  const { ref } = useParams<{ ref: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [startError, setStartError] = useState('');

  const { data: mission, isLoading, error } = useQuery<MissionDto>({
    queryKey: ['mission', ref],
    queryFn: () => apiFetch(`/api/missions/${ref}`),
    refetchInterval: 5000,
    enabled: !!ref
  });

  const startMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/missions/${ref}/start`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': `start-${ref}-${Date.now()}`
        }
      }),
    onSuccess: () => {
      setStartError('');
      queryClient.invalidateQueries({ queryKey: ['mission', ref] });
      queryClient.invalidateQueries({ queryKey: ['missions'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
    },
    onError: (err: any) => {
      setStartError(err.message || 'Failed to start mission');
    }
  });

  if (isLoading) {
    return <div style={{ padding: '2rem' }}>Loading mission {ref}...</div>;
  }

  if (error || !mission) {
    return (
      <div style={{ padding: '2rem' }}>
        <button className="btn btn-secondary" onClick={() => navigate('/picking')}>
          ← Back to Picking
        </button>
        <p style={{ color: 'var(--color-danger)', marginTop: '1rem' }}>Mission not found or error loading.</p>
      </div>
    );
  }

  const isAssignedPicker = user?.role === 'PICKER' && user?.id === mission.picker.id;
  const canStart = mission.status === 'ASSIGNED' && isAssignedPicker;

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Navigation & Header */}
      <div>
        <button className="btn btn-secondary" onClick={() => navigate('/picking')} style={{ marginBottom: '0.5rem' }}>
          ← Back to Missions
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600 }}>{mission.ref}</h1>
            <StatusBadge status={mission.status} />
            <span className="badge badge-info">{mission.route.algorithm}</span>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {canStart && (
              <button
                className="btn btn-primary"
                data-testid="start-mission-btn"
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
              >
                {startMutation.isPending ? 'Starting...' : 'Start Mission'}
              </button>
            )}
          </div>
        </div>
      </div>

      {startError && (
        <div className="banner banner-error" style={{ padding: '1rem', borderRadius: '8px' }}>
          {startError}
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
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Associated Order</span>
          <p style={{ margin: '0.25rem 0 0', fontWeight: 500 }}>
            <Link to={`/orders/${mission.order_ref}`} style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
              {mission.order_ref}
            </Link>
          </p>
        </div>
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Assigned Picker</span>
          <p style={{ margin: '0.25rem 0 0', fontWeight: 500 }}>{mission.picker.name}</p>
        </div>
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Assigned By</span>
          <p style={{ margin: '0.25rem 0 0', fontWeight: 500 }}>{mission.assigned_by.name}</p>
        </div>
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Route Distance</span>
          <p style={{ margin: '0.25rem 0 0', fontWeight: 500 }}>{mission.route.total_distance.toFixed(1)} distance units</p>
        </div>
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Assigned At</span>
          <p style={{ margin: '0.25rem 0 0', fontWeight: 500 }}>{new Date(mission.assigned_at).toLocaleString()}</p>
        </div>
        {mission.started_at && (
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Started At</span>
            <p style={{ margin: '0.25rem 0 0', fontWeight: 500 }}>{new Date(mission.started_at).toLocaleString()}</p>
          </div>
        )}
      </div>

      {/* Progress Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          background: 'var(--color-bg-card)',
          padding: '1.25rem',
          borderRadius: '8px'
        }}
      >
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Stops Completed</span>
          <p style={{ margin: '0.25rem 0 0', fontSize: '1.25rem', fontWeight: 600 }}>
            {mission.progress.finished_stops} / {mission.progress.total_stops}
          </p>
        </div>
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Units Picked</span>
          <p style={{ margin: '0.25rem 0 0', fontSize: '1.25rem', fontWeight: 600 }}>
            {mission.progress.units_picked} / {mission.progress.units_required}
          </p>
        </div>
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Open Exceptions</span>
          <p
            style={{
              margin: '0.25rem 0 0',
              fontSize: '1.25rem',
              fontWeight: 600,
              color: mission.progress.open_exceptions > 0 ? 'var(--color-danger)' : 'inherit'
            }}
          >
            {mission.progress.open_exceptions}
          </p>
        </div>
      </div>

      {/* Route Panel */}
      <div style={{ background: 'var(--color-bg-card)', padding: '1.25rem', borderRadius: '8px' }}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', fontWeight: 600 }}>
          Optimized Picking Route ({mission.route.algorithm} · {mission.route.total_distance.toFixed(1)} units)
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', margin: '0 0 1rem' }}>
          Start at <strong>{mission.route.start}</strong> → visit {mission.stops.length} pick stop{mission.stops.length === 1 ? '' : 's'} in order → finish at <strong>{mission.route.end}</strong>.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '200px', overflowY: 'auto' }}>
          {mission.route.legs.map((leg, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '0.4rem 0.6rem',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: '4px',
                fontSize: '0.85rem'
              }}
            >
              <span>
                Leg {idx + 1}: {leg.path.join(' → ')}
              </span>
              <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                {leg.distance.toFixed(1)} u
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Stops Table */}
      <div style={{ background: 'var(--color-bg-card)', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Pick Stops (Visiting Order)</h3>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Seq</th>
              <th>Stop Ref</th>
              <th>Location</th>
              <th>Product</th>
              <th>Required</th>
              <th>Picked</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {mission.stops.map((stop) => (
              <tr key={stop.id}>
                <td style={{ fontWeight: 600 }}>{stop.seq}</td>
                <td>
                  <span style={{ fontWeight: 500, color: 'var(--color-primary)' }}>{stop.stop_ref}</span>
                </td>
                <td>
                  <div>
                    <strong>{stop.bin_code}</strong>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>Shelf {stop.shelf_code}</div>
                </td>
                <td>
                  <div>{stop.product_name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{stop.sku}</div>
                </td>
                <td>{stop.qty_required}</td>
                <td>{stop.qty_picked}</td>
                <td>
                  <StatusBadge status={stop.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
