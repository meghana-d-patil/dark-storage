import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';

interface Task {
  id: string;
  type: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_after: string;
  started_at: string | null;
  finished_at: string | null;
  error: { code: string; message: string } | null;
  http_status: number | null;
  created_at: string;
}

interface Lock {
  resource: string;
  task_id: string;
  task_type: string;
  fencing_token: number;
  acquired_at: string;
  expires_at: string;
}

interface QueueItem {
  id: string;
  type: string;
  priority: number;
  effective_score: number;
  resources: string[];
  created_at: string;
}

const PRIORITY_LABELS: Record<number, string> = {
  100: 'URGENT',
  200: 'HIGH',
  300: 'NORMAL',
  400: 'LOW'
};

export const TasksPage: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'tasks' | 'locks' | 'queue'>('tasks');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // 1. All tasks query
  const { data: tasksData, isLoading: tasksLoading } = useQuery<{ tasks: Task[] }>({
    queryKey: ['tasks', statusFilter, typeFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('type', typeFilter);
      return apiFetch(`/api/tasks?${params.toString()}`);
    },
    refetchInterval: 3000
  });

  // 2. Active locks query
  const { data: locksData, isLoading: locksLoading } = useQuery<{ locks: Lock[] }>({
    queryKey: ['tasks', 'locks'],
    queryFn: () => apiFetch('/api/tasks/locks'),
    refetchInterval: 3000,
    enabled: activeSubTab === 'locks'
  });

  // 3. Priority queue query
  const { data: queueData, isLoading: queueLoading } = useQuery<{ queue: QueueItem[] }>({
    queryKey: ['tasks', 'queue'],
    queryFn: () => apiFetch('/api/tasks/queue'),
    refetchInterval: 3000,
    enabled: activeSubTab === 'queue'
  });

  const formatDuration = (t: Task) => {
    if (!t.started_at) return '—';
    const start = new Date(t.started_at).getTime();
    const end = t.finished_at ? new Date(t.finished_at).getTime() : Date.now();
    const ms = end - start;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SUCCEEDED':
        return <span className="badge badge-active">SUCCEEDED</span>;
      case 'RUNNING':
        return <span className="badge badge-info">RUNNING</span>;
      case 'QUEUED':
        return <span className="badge badge-warning">QUEUED</span>;
      case 'FAILED':
        return <span className="badge badge-danger">FAILED</span>;
      default:
        return <span className="badge">{status}</span>;
    }
  };

  return (
    <div className="m3-page">
      <div className="m3-page-header">
        <div>
          <h1>Engine 1 Task Scheduler</h1>
          <p className="m3-subtitle">Asynchronous execution workers, distributed resource locks, and task queues</p>
        </div>
        <span className="badge badge-info" style={{ fontSize: '12px' }}>
          Live Poll: 3s
        </span>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab-btn ${activeSubTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('tasks')}
          data-testid="tasks-tab-all"
        >
          All Tasks ({tasksData?.tasks.length || 0})
        </button>
        <button
          className={`tab-btn ${activeSubTab === 'locks' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('locks')}
          data-testid="tasks-tab-locks"
        >
          Active Locks ({locksData?.locks.length || 0})
        </button>
        <button
          className={`tab-btn ${activeSubTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('queue')}
          data-testid="tasks-tab-queue"
        >
          Priority Queue ({queueData?.queue.length || 0})
        </button>
      </div>

      {/* Subtab 1: All Tasks */}
      {activeSubTab === 'tasks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="m3-toolbar">
            <select
              className="select"
              style={{ width: '180px' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="QUEUED">QUEUED</option>
              <option value="RUNNING">RUNNING</option>
              <option value="SUCCEEDED">SUCCEEDED</option>
              <option value="FAILED">FAILED</option>
            </select>

            <select
              className="select"
              style={{ width: '200px' }}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">All Types</option>
              <option value="PUTAWAY">PUTAWAY</option>
              <option value="RELOCATE">RELOCATE</option>
              <option value="RESERVE_ORDER">RESERVE_ORDER</option>
              <option value="PICK_CONFIRM">PICK_CONFIRM</option>
              <option value="EXCEPTION_RESOLVE">EXCEPTION_RESOLVE</option>
            </select>
          </div>

          {tasksLoading ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading tasks…</div>
          ) : !tasksData || tasksData.tasks.length === 0 ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No tasks found.
            </div>
          ) : (
            <div className="table-container">
              <table className="table" data-testid="tasks-table">
                <thead>
                  <tr>
                    <th>Task ID</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Attempts</th>
                    <th>Created</th>
                    <th>Duration</th>
                    <th>Result / Error</th>
                  </tr>
                </thead>
                <tbody>
                  {tasksData.tasks.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        <span title={t.id} style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{t.id.slice(0, 8)}…</span>
                      </td>
                      <td><strong>{t.type}</strong></td>
                      <td>{getStatusBadge(t.status)}</td>
                      <td><span className="badge badge-secondary">{PRIORITY_LABELS[t.priority] || t.priority}</span></td>
                      <td style={{ fontWeight: 600 }}>{t.attempts}</td>
                      <td style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{new Date(t.created_at).toLocaleTimeString()}</td>
                      <td style={{ fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{formatDuration(t)}</td>
                      <td>
                        {t.status === 'SUCCEEDED' ? (
                          <span style={{ color: 'var(--accent-success)', fontSize: '13px', fontWeight: 600 }}>HTTP {t.http_status || 200}</span>
                        ) : t.status === 'FAILED' ? (
                          <span style={{ color: 'var(--accent-danger)', fontSize: '13px', fontWeight: 600 }} title={t.error?.message}>
                            {t.error?.code || 'ERROR'}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Subtab 2: Active Locks */}
      {activeSubTab === 'locks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {locksLoading ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading locks…</div>
          ) : !locksData || locksData.locks.length === 0 ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No active resource locks held.
            </div>
          ) : (
            <div className="table-container">
              <table className="table" data-testid="locks-table">
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th>Holding Task</th>
                    <th>Fencing Token</th>
                    <th>Acquired At</th>
                    <th>Expires At</th>
                  </tr>
                </thead>
                <tbody>
                  {locksData.locks.map((l) => (
                    <tr key={l.resource}>
                      <td><strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)' }}>{l.resource}</strong></td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        <span title={l.task_id}>{l.task_id.slice(0, 8)}…</span> ({l.task_type})
                      </td>
                      <td style={{ fontWeight: 700 }}>#{l.fencing_token}</td>
                      <td style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{new Date(l.acquired_at).toLocaleTimeString()}</td>
                      <td style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{new Date(l.expires_at).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Subtab 3: Priority Queue */}
      {activeSubTab === 'queue' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {queueLoading ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading queue…</div>
          ) : !queueData || queueData.queue.length === 0 ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Queue is empty. No tasks currently awaiting execution.
            </div>
          ) : (
            <div className="table-container">
              <table className="table" data-testid="queue-table">
                <thead>
                  <tr>
                    <th>Task ID</th>
                    <th>Type</th>
                    <th>Priority</th>
                    <th>Effective Score</th>
                    <th>Target Resources</th>
                    <th>Enqueued At</th>
                  </tr>
                </thead>
                <tbody>
                  {queueData.queue.map((q) => (
                    <tr key={q.id}>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        <span title={q.id} style={{ color: 'var(--accent-primary)' }}>{q.id.slice(0, 8)}…</span>
                      </td>
                      <td><strong>{q.type}</strong></td>
                      <td><span className="badge badge-secondary">{PRIORITY_LABELS[q.priority] || q.priority}</span></td>
                      <td>
                        <strong style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{q.effective_score}</strong>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {q.resources.map((r) => (
                            <span key={r} className="badge badge-info" style={{ fontFamily: 'var(--font-mono)' }}>
                              {r}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{new Date(q.created_at).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
