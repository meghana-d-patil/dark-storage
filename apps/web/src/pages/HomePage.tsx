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
    <div className="m3-page">
      <div className="m3-page-header">
        <div>
          <h1>Warehouse Operations Dashboard</h1>
          <p className="m3-subtitle">
            Real-time metrics, warehouse inventory levels, active missions, and operations throughput.
          </p>
        </div>
      </div>

      {/* Service Health Strip */}
      <div
        className="card"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '14px',
          padding: '16px 20px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`health-dot ${health?.gateway === 'ok' ? 'ok' : 'down'}`} />
          <span style={{ fontSize: '13px' }}><strong style={{ color: 'var(--text-secondary)' }}>Gateway:</strong> {health?.gateway || 'checking...'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`health-dot ${health?.engine1 === 'ok' ? 'ok' : 'down'}`} />
          <span style={{ fontSize: '13px' }}><strong style={{ color: 'var(--text-secondary)' }}>Engine 1 (Scheduler):</strong> {health?.engine1 || 'checking...'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`health-dot ${health?.engine2 === 'ok' ? 'ok' : 'down'}`} />
          <span style={{ fontSize: '13px' }}><strong style={{ color: 'var(--text-secondary)' }}>Engine 2 (Optimizer):</strong> {health?.engine2 || 'checking...'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`health-dot ${health?.engine3 === 'ok' ? 'ok' : 'down'}`} />
          <span style={{ fontSize: '13px' }}><strong style={{ color: 'var(--text-secondary)' }}>Engine 3 (Inventory):</strong> {health?.engine3 || 'checking...'}</span>
        </div>
      </div>

      {/* Metric Tiles */}
      {isLoading || !dashboard ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Loading dashboard metrics...
        </div>
      ) : (
        <>
          <div className="m3-kpi-grid">
            {/* Tile 1: Staged Units */}
            <div className="m3-kpi-card">
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Staged Units
              </span>
              <p style={{ margin: '8px 0 2px', fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)' }} data-testid="tile-staged-units">
                {dashboard.receiving.staged_units}
              </p>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {dashboard.receiving.staged_lines} lines waiting
              </span>
            </div>

            {/* Tile 2: Reserved */}
            <div className="m3-kpi-card">
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Reserved Units
              </span>
              <p style={{ margin: '8px 0 2px', fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent-warning)' }} data-testid="tile-reserved-units">
                {dashboard.inventory.reserved_units}
              </p>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Committed to orders
              </span>
            </div>

            {/* Tile 3: Available */}
            <div className="m3-kpi-card">
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Available (ATP)
              </span>
              <p style={{ margin: '8px 0 2px', fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent-success)' }} data-testid="tile-available-units">
                {dashboard.inventory.available_units}
              </p>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Stored: {dashboard.inventory.stored_units}
              </span>
            </div>

            {/* Tile 4: Pending Orders */}
            <div className="m3-kpi-card">
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Pending Orders
              </span>
              <p style={{ margin: '8px 0 2px', fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)' }} data-testid="tile-pending-orders">
                {dashboard.orders.reserved + dashboard.orders.assigned}
              </p>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Picking: {dashboard.orders.picking} | Picked: {dashboard.orders.picked}
              </span>
            </div>

            {/* Tile 5: Active Missions */}
            <div className="m3-kpi-card">
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Active Missions
              </span>
              <p style={{ margin: '8px 0 2px', fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent-primary)' }} data-testid="tile-active-missions">
                {dashboard.missions.in_progress}
              </p>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Assigned: {dashboard.missions.assigned}
              </span>
            </div>

            {/* Tile 6: Completed Today */}
            <div className="m3-kpi-card">
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Completed Today
              </span>
              <p style={{ margin: '8px 0 2px', fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent-info)' }} data-testid="tile-completed-today">
                {dashboard.orders.completed_today}
              </p>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Total: {dashboard.orders.completed_total}
              </span>
            </div>

            {/* Tile 7: Open Exceptions */}
            <div className="m3-kpi-card">
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Open Exceptions
              </span>
              <p
                style={{
                  margin: '8px 0 2px',
                  fontSize: '1.75rem',
                  fontWeight: 800,
                  color: dashboard.exceptions.open > 0 ? 'var(--accent-danger)' : 'var(--text-primary)'
                }}
                data-testid="tile-open-exceptions"
              >
                {dashboard.exceptions.open}
              </p>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Awaiting manager
              </span>
            </div>
          </div>

          {/* Middle Row: Warehouse Fill Bar + Movements Today */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            {/* Bin Fill Bar */}
            <div className="card">
              <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700 }}>Warehouse Capacity</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Occupied Bins: <strong style={{ color: 'var(--text-primary)' }}>{dashboard.inventory.occupied_bins}</strong> / {dashboard.inventory.total_bins}</span>
                <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{dashboard.inventory.fill_pct}%</span>
              </div>
              <div className="fill-bar" style={{ height: '12px' }}>
                <div
                  className="fill-bar-inner med"
                  style={{ width: `${dashboard.inventory.fill_pct}%` }}
                />
              </div>

              {dashboard.engine && (
                <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '24px', fontSize: '13px', flexWrap: 'wrap' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Scheduler Tasks:</span>{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>{dashboard.engine.queued_tasks} queued, {dashboard.engine.running_tasks} running</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>24h Failures:</span>{' '}
                    <strong style={{ color: dashboard.engine.failed_tasks_24h > 0 ? 'var(--accent-danger)' : 'var(--text-primary)' }}>{dashboard.engine.failed_tasks_24h}</strong>
                  </div>
                </div>
              )}
            </div>

            {/* Movement Summary Today */}
            <div className="card">
              <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700 }}>Today's Movements Throughput</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: '10px', textAlign: 'center' }}>
                <div style={{ backgroundColor: 'var(--bg-surface)', padding: '12px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>RECEIVE</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '4px', color: 'var(--text-primary)' }}>{dashboard.movements.today.RECEIVE}</div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-surface)', padding: '12px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>PUTAWAY</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '4px', color: 'var(--accent-info)' }}>{dashboard.movements.today.PUTAWAY}</div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-surface)', padding: '12px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>PICK</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '4px', color: 'var(--accent-primary)' }}>{dashboard.movements.today.PICK}</div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-surface)', padding: '12px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>RELOCATE</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '4px', color: 'var(--accent-warning)' }}>{dashboard.movements.today.RELOCATE}</div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-surface)', padding: '12px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>ADJUST</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '4px', color: 'var(--accent-danger)' }}>{dashboard.movements.today.ADJUSTMENT}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Latest 10 Movements Table */}
          <div className="table-container">
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface)' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Latest Stock Movements</h3>
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
                    <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                      No movements recorded yet.
                    </td>
                  </tr>
                ) : (
                  dashboard.movements.latest.map((m) => (
                    <tr key={m.ref}>
                      <td><span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{m.ref}</span></td>
                      <td><span className="badge badge-info">{m.type}</span></td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{m.product_name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{m.sku}</div>
                      </td>
                      <td style={{ fontWeight: 700 }}>{m.qty}</td>
                      <td><span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{m.from_label}</span></td>
                      <td><span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{m.to_label}</span></td>
                      <td style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
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
