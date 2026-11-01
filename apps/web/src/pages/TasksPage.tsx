import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';

interface TaskItem {
  id: string;
  type: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  priority: number;
  attempts: number;
  http_status?: number;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

interface LockItem {
  resource: string;
  task_id: string;
  fencing_token: number;
  acquired_at: string;
  expires_at: string;
  task_type?: string;
  task_priority?: number;
}

interface QueueItem extends TaskItem {
  effective_score: number;
  resources: string[];
}

const PRIORITY_LABELS: Record<number, string> = {
  1: 'LOW (1)',
  2: 'NORMAL (2)',
  3: 'HIGH (3)',
  4: 'URGENT (4)'
};

export const TasksPage: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'tasks' | 'locks' | 'queue'>('tasks');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  // Auto-refetch every 3s
  const { data: tasksData, isLoading: tasksLoading } = useQuery<{ tasks: TaskItem[] }>({
    queryKey: ['tasks', statusFilter, typeFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (statusFilter) p.set('status', statusFilter);
      if (typeFilter) p.set('type', typeFilter);
      p.set('limit', '50');
      return apiFetch(`/api/tasks?${p.toString()}`);
    },
    refetchInterval: 3000
  });

  const { data: locksData, isLoading: locksLoading } = useQuery<{ locks: LockItem[] }>({
    queryKey: ['tasks', 'locks'],
    queryFn: () => apiFetch('/api/tasks/locks'),
    refetchInterval: 3000
  });

  const { data: queueData, isLoading: queueLoading } = useQuery<{ queue: QueueItem[] }>({
    queryKey: ['tasks', 'queue'],
    queryFn: () => apiFetch('/api/tasks/queue'),
    refetchInterval: 3000
  });

  const formatDuration = (task: TaskItem) => {
    if (!task.started_at) return '—';
    const start = new Date(task.started_at).getTime();
    const end = task.finished_at ? new Date(task.finished_at).getTime() : Date.now();
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Engine 1 Task Scheduler</h2>
        <span className="badge badge-info" style={{ fontSize: 12 }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <select
              className="select"
              style={{ width: 160 }}
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
              style={{ width: 180 }}
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
            <div style={{ padding: 24, textAlign: 'center' }}>Loading tasks…</div>
          ) : !tasksData || tasksData.tasks.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
              No tasks found.
            </div>
          ) : (
            <div className="table-container">
              <table data-testid="tasks-table">
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
                      <td style={{ fontFamily: 'monospace' }}>
                        <span title={t.id}>{t.id.slice(0, 8)}…</span>
                      </td>
                      <td><strong>{t.type}</strong></td>
                      <td>{getStatusBadge(t.status)}</td>
                      <td>{PRIORITY_LABELS[t.priority] || t.priority}</td>
                      <td>{t.attempts}</td>
                      <td style={{ fontSize: 12 }}>{new Date(t.created_at).toLocaleTimeString()}</td>
                      <td style={{ fontSize: 12 }}>{formatDuration(t)}</td>
                      <td>
                        {t.status === 'SUCCEEDED' ? (
                          <span style={{ color: '#4ade80', fontSize: 12 }}>HTTP {t.http_status || 200}</span>
                        ) : t.status === 'FAILED' ? (
                          <span style={{ color: '#ef4444', fontSize: 12 }} title={t.error?.message}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {locksLoading ? (
            <div style={{ padding: 24, textAlign: 'center' }}>Loading locks…</div>
          ) : !locksData || locksData.locks.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
              No active resource locks held.
            </div>
          ) : (
            <div className="table-container">
              <table data-testid="locks-table">
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
                      <td><strong>{l.resource}</strong></td>
                      <td style={{ fontFamily: 'monospace' }}>
                        <span title={l.task_id}>{l.task_id.slice(0, 8)}…</span> ({l.task_type})
                      </td>
                      <td>#{l.fencing_token}</td>
                      <td style={{ fontSize: 12 }}>{new Date(l.acquired_at).toLocaleTimeString()}</td>
                      <td style={{ fontSize: 12 }}>{new Date(l.expires_at).toLocaleTimeString()}</td>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {queueLoading ? (
            <div style={{ padding: 24, textAlign: 'center' }}>Loading queue…</div>
          ) : !queueData || queueData.queue.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
              Queue is empty. No tasks currently awaiting execution.
            </div>
          ) : (
            <div className="table-container">
              <table data-testid="queue-table">
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
                      <td style={{ fontFamily: 'monospace' }}>
                        <span title={q.id}>{q.id.slice(0, 8)}…</span>
                      </td>
                      <td><strong>{q.type}</strong></td>
                      <td>{PRIORITY_LABELS[q.priority] || q.priority}</td>
                      <td>
                        <strong style={{ color: 'var(--accent)' }}>{q.effective_score}</strong>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {q.resources.map((r) => (
                            <span key={r} className="badge" style={{ fontSize: 11 }}>
                              {r}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ fontSize: 12 }}>{new Date(q.created_at).toLocaleTimeString()}</td>
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
