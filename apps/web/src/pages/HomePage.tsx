import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { DashboardDto } from '@dark-storage/shared';

interface HealthStatus {
  gateway: 'ok' | 'down';
  engine1: 'ok' | 'down';
  engine2: 'ok' | 'down';
  engine3: 'ok' | 'down';
}

export const HomePage: React.FC = () => {
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const fetchHealth = async () => {
    try {
      const res = await apiFetch<HealthStatus>('/api/health');
      setHealth(res);
    } catch {
      setHealth({
        gateway: 'down',
        engine1: 'down',
        engine2: 'down',
        engine3: 'down'
      });
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const { data: dashboard, isLoading } = useQuery<DashboardDto>({
    queryKey: ['dashboard'],
    queryFn: () => apiFetch('/api/dashboard'),
    refetchInterval: 15000
  });

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600 }}>Warehouse Operations Dashboard</h1>
        <p style={{ margin: '0.25rem 0 0', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
          Real-time metrics, warehouse inventory levels, active missions, and operations throughput.
        </p>
      </div>

      {/* Service Health Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          background: 'var(--color-bg-card)',
          padding: '1rem',
          borderRadius: '8px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className={`health-dot ${health?.gateway === 'ok' ? 'ok' : 'down'}`} />
          <span style={{ fontSize: '0.85rem' }}><strong>Gateway:</strong> {health?.gateway || 'checking...'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className={`health-dot ${health?.engine1 === 'ok' ? 'ok' : 'down'}`} />
          <span style={{ fontSize: '0.85rem' }}><strong>Engine 1 (Scheduler):</strong> {health?.engine1 || 'checking...'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className={`health-dot ${health?.engine2 === 'ok' ? 'ok' : 'down'}`} />
          <span style={{ fontSize: '0.85rem' }}><strong>Engine 2 (Optimizer):</strong> {health?.engine2 || 'checking...'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className={`health-dot ${health?.engine3 === 'ok' ? 'ok' : 'down'}`} />
          <span style={{ fontSize: '0.85rem' }}><strong>Engine 3 (Inventory):</strong> {health?.engine3 || 'checking...'}</span>
        </div>
      </div>

      {/* Metric Tiles */}
      {isLoading || !dashboard ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          Loading dashboard metrics...
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '1rem'
            }}
          >
            {/* Tile 1: Staged Units */}
            <div style={{ background: 'var(--color-bg-card)', padding: '1.25rem', borderRadius: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Staged Units
              </span>
              <p style={{ margin: '0.5rem 0 0', fontSize: '1.6rem', fontWeight: 700 }} data-testid="tile-staged-units">
                {dashboard.receiving.staged_units}
              </p>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                {dashboard.receiving.staged_lines} lines waiting
              </span>
            </div>

            {/* Tile 2: Reserved */}
            <div style={{ background: 'var(--color-bg-card)', padding: '1.25rem', borderRadius: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Reserved Units
              </span>
              <p style={{ margin: '0.5rem 0 0', fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-warning)' }} data-testid="tile-reserved-units">
                {dashboard.inventory.reserved_units}
              </p>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                Committed to orders
              </span>
            </div>

            {/* Tile 3: Available */}
            <div style={{ background: 'var(--color-bg-card)', padding: '1.25rem', borderRadius: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Available (ATP)
              </span>
              <p style={{ margin: '0.5rem 0 0', fontSize: '1.6rem', fontWeight: 700, color: '#10b981' }} data-testid="tile-available-units">
                {dashboard.inventory.available_units}
              </p>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                Stored: {dashboard.inventory.stored_units}
              </span>
            </div>

            {/* Tile 4: Pending Orders */}
            <div style={{ background: 'var(--color-bg-card)', padding: '1.25rem', borderRadius: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Pending Orders
              </span>
              <p style={{ margin: '0.5rem 0 0', fontSize: '1.6rem', fontWeight: 700 }} data-testid="tile-pending-orders">
                {dashboard.orders.reserved + dashboard.orders.assigned}
              </p>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                Picking: {dashboard.orders.picking} | Picked: {dashboard.orders.picked}
              </span>
            </div>

            {/* Tile 5: Active Missions */}
            <div style={{ background: 'var(--color-bg-card)', padding: '1.25rem', borderRadius: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Active Missions
              </span>
              <p style={{ margin: '0.5rem 0 0', fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-primary)' }} data-testid="tile-active-missions">
                {dashboard.missions.in_progress}
              </p>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                Assigned: {dashboard.missions.assigned}
              </span>
            </div>

            {/* Tile 6: Completed Today */}
            <div style={{ background: 'var(--color-bg-card)', padding: '1.25rem', borderRadius: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Completed Today
              </span>
              <p style={{ margin: '0.5rem 0 0', fontSize: '1.6rem', fontWeight: 700 }} data-testid="tile-completed-today">
                {dashboard.orders.completed_today}
              </p>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                Total: {dashboard.orders.completed_total}
              </span>
            </div>

            {/* Tile 7: Open Exceptions */}
            <div style={{ background: 'var(--color-bg-card)', padding: '1.25rem', borderRadius: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Open Exceptions
              </span>
              <p
                style={{
                  margin: '0.5rem 0 0',
                  fontSize: '1.6rem',
                  fontWeight: 700,
                  color: dashboard.exceptions.open > 0 ? 'var(--color-danger)' : 'inherit'
                }}
                data-testid="tile-open-exceptions"
              >
                {dashboard.exceptions.open}
              </p>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                Awaiting manager
              </span>
            </div>
          </div>

          {/* Middle Row: Warehouse Fill Bar + Movements Today */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            {/* Bin Fill Bar */}
            <div style={{ background: 'var(--color-bg-card)', padding: '1.25rem', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600 }}>Warehouse Capacity</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                <span>Occupied Bins: <strong>{dashboard.inventory.occupied_bins}</strong> / {dashboard.inventory.total_bins}</span>
                <span style={{ fontWeight: 600 }}>{dashboard.inventory.fill_pct}%</span>
              </div>
              <div style={{ width: '100%', height: '12px', background: 'rgba(255,255,255,0.08)', borderRadius: '6px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${dashboard.inventory.fill_pct}%`,
                    height: '100%',
                    background: 'var(--color-primary, #3b82f6)',
                    borderRadius: '6px'
                  }}
                />
              </div>

              {dashboard.engine && (
                <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: '1.5rem', fontSize: '0.85rem' }}>
                  <div>
                    <span style={{ color: 'var(--color-text-secondary)' }}>Scheduler Tasks:</span>{' '}
                    <strong>{dashboard.engine.queued_tasks} queued, {dashboard.engine.running_tasks} running</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--color-text-secondary)' }}>24h Failures:</span>{' '}
                    <strong>{dashboard.engine.failed_tasks_24h}</strong>
                  </div>
                </div>
              )}
            </div>

            {/* Movement Summary Today */}
            <div style={{ background: 'var(--color-bg-card)', padding: '1.25rem', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600 }}>Today's Movements Throughput</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem', textAlign: 'center' }}>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>RECEIVE</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.25rem' }}>{dashboard.movements.today.RECEIVE}</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>PUTAWAY</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.25rem' }}>{dashboard.movements.today.PUTAWAY}</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>PICK</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.25rem' }}>{dashboard.movements.today.PICK}</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>RELOCATE</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.25rem' }}>{dashboard.movements.today.RELOCATE}</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>ADJUST</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.25rem' }}>{dashboard.movements.today.ADJUSTMENT}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Latest 10 Movements Table */}
          <div style={{ background: 'var(--color-bg-card)', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Latest Stock Movements</h3>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Type</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.movements.latest.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-secondary)' }}>
                      No movements recorded yet.
                    </td>
                  </tr>
                ) : (
                  dashboard.movements.latest.map((m) => (
                    <tr key={m.ref}>
                      <td><span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{m.ref}</span></td>
                      <td><span className="badge badge-info">{m.type}</span></td>
                      <td>
                        <div>{m.product_name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>{m.sku}</div>
                      </td>
                      <td style={{ fontWeight: 600 }}>{m.qty}</td>
                      <td>{m.from_label}</td>
                      <td>{m.to_label}</td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
