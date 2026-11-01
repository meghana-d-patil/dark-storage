import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';

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

  return (
    <div>
      <h1 style={{ marginBottom: '20px' }}>System Status</h1>
      <div className="card">
        <h3 style={{ marginBottom: '16px' }}>Service Health</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div style={{ padding: '12px', background: 'var(--bg-surface)', borderRadius: '4px' }}>
            <span className={`health-dot ${health?.gateway === 'ok' ? 'ok' : 'down'}`} />
            <strong>Gateway</strong>: {health?.gateway || 'checking...'}
          </div>
          <div style={{ padding: '12px', background: 'var(--bg-surface)', borderRadius: '4px' }}>
            <span className={`health-dot ${health?.engine1 === 'ok' ? 'ok' : 'down'}`} />
            <strong>Engine 1 (Scheduler)</strong>: {health?.engine1 || 'checking...'}
          </div>
          <div style={{ padding: '12px', background: 'var(--bg-surface)', borderRadius: '4px' }}>
            <span className={`health-dot ${health?.engine2 === 'ok' ? 'ok' : 'down'}`} />
            <strong>Engine 2 (Optimizer)</strong>: {health?.engine2 || 'checking...'}
          </div>
          <div style={{ padding: '12px', background: 'var(--bg-surface)', borderRadius: '4px' }}>
            <span className={`health-dot ${health?.engine3 === 'ok' ? 'ok' : 'down'}`} />
            <strong>Engine 3 (Inventory)</strong>: {health?.engine3 || 'checking...'}
          </div>
        </div>
      </div>
    </div>
  );
};
