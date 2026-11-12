import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { useAuthStore } from '../../stores/authStore.js';
import { StatusBadge } from '../../components/StatusBadge.js';

interface FloorTask {
  id: number;
  task_ref: string;
  type: 'COUNT' | 'RELOCATE' | 'REPLENISH' | 'PUTAWAY' | 'PICK';
  status: 'OPEN' | 'ASSIGNED' | 'CLAIMED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  priority: number;
  bin_code: string;
  to_bin_code?: string;
  sku: string;
  lot_id?: string;
  qty?: number;
  claimed_by?: string;
  claimed_at?: string;
  due_at?: string;
}

export const OperatorFloorPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [activeTask, setActiveTask] = useState<FloorTask | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form states for COUNT
  const [countBinScan, setCountBinScan] = useState('');
  const [countedQty, setCountedQty] = useState<number | ''>('');

  // Form states for RELOCATE
  const [fromScan, setFromScan] = useState('');
  const [itemScan, setItemScan] = useState('');
  const [toScan, setToScan] = useState('');

  // Ad-hoc action modal (Damage Flag or Relocate Request)
  const [actionTab, setActionTab] = useState<'TASKS' | 'FLAG_DAMAGE' | 'NEW_RELOCATE'>('TASKS');
  const [damageBin, setDamageBin] = useState('');
  const [damageQty, setDamageQty] = useState<number | ''>('');
  const [damageNote, setDamageNote] = useState('');

  const [relocFrom, setRelocFrom] = useState('');
  const [relocTo, setRelocTo] = useState('');
  const [relocSku, setRelocSku] = useState('');
  const [relocQty, setRelocQty] = useState<number | ''>('');
  const [relocReason, setRelocReason] = useState('REBALANCE');

  // Fetch open and claimed floor tasks
  const { data: tasksData, isLoading } = useQuery<{ items: FloorTask[] }>({
    queryKey: ['floor-tasks'],
    queryFn: () => apiFetch('/api/floor-tasks'),
    refetchInterval: 5000,
  });

  const allTasks = tasksData?.items || [];
  const myClaimedTask = allTasks.find(
    (t) => (t.status === 'CLAIMED' || t.status === 'IN_PROGRESS') && t.claimed_by === user?.username
  );

  // Sync active task
  useEffect(() => {
    if (myClaimedTask && (!activeTask || activeTask.task_ref !== myClaimedTask.task_ref)) {
      setActiveTask(myClaimedTask);
      setCountBinScan('');
      setCountedQty('');
      setFromScan('');
      setItemScan('');
      setToScan('');
      setErrorMessage(null);
    } else if (!myClaimedTask && activeTask) {
      setActiveTask(null);
    }
  }, [myClaimedTask]);

  // Heartbeat loop for active claimed task
  useEffect(() => {
    if (!activeTask) return;
    const interval = setInterval(async () => {
      try {
        await apiFetch(`/api/floor-tasks/${encodeURIComponent(activeTask.task_ref)}/heartbeat`, {
          method: 'POST',
        });
      } catch (err) {
        console.error('Task heartbeat failed:', err);
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [activeTask]);

  // Claim task mutation
  const claimMutation = useMutation({
    mutationFn: (ref: string) =>
      apiFetch(`/api/floor-tasks/${encodeURIComponent(ref)}/claim`, { method: 'POST' }),
    onSuccess: (data: any) => {
      setErrorMessage(null);
      setSuccessMessage('Task claimed successfully.');
      queryClient.invalidateQueries({ queryKey: ['floor-tasks'] });
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Failed to claim task');
    },
  });

  // Release task mutation
  const releaseMutation = useMutation({
    mutationFn: (ref: string) =>
      apiFetch(`/api/floor-tasks/${encodeURIComponent(ref)}/release`, { method: 'POST' }),
    onSuccess: () => {
      setActiveTask(null);
      setErrorMessage(null);
      setSuccessMessage('Task released.');
      queryClient.invalidateQueries({ queryKey: ['floor-tasks'] });
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Failed to release task');
    },
  });

  // Count submission mutation
  const countMutation = useMutation({
    mutationFn: ({ ref, binScan, countedQty }: { ref: string; binScan: string; countedQty: number }) =>
      apiFetch(`/api/floor-tasks/${encodeURIComponent(ref)}/count`, {
        method: 'POST',
        body: JSON.stringify({ binScan, countedQty }),
      }),
    onSuccess: () => {
      setActiveTask(null);
      setErrorMessage(null);
      setSuccessMessage('Blind count submitted. Task completed.');
      queryClient.invalidateQueries({ queryKey: ['floor-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Count submission failed');
    },
  });

  // Relocate submission mutation
  const relocateMutation = useMutation({
    mutationFn: ({
      ref,
      fromScan,
      itemScan,
      toScan,
    }: {
      ref: string;
      fromScan: string;
      itemScan: string;
      toScan: string;
    }) =>
      apiFetch(`/api/floor-tasks/${encodeURIComponent(ref)}/relocate`, {
        method: 'POST',
        body: JSON.stringify({ fromScan, itemScan, toScan }),
      }),
    onSuccess: () => {
      setActiveTask(null);
      setErrorMessage(null);
      setSuccessMessage('Relocation complete. Stock moved.');
      queryClient.invalidateQueries({ queryKey: ['floor-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Relocation failed');
    },
  });

  // Flag damage mutation
  const damageMutation = useMutation({
    mutationFn: (body: any) =>
      apiFetch('/api/inventory/damage-flag', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setDamageBin('');
      setDamageQty('');
      setDamageNote('');
      setErrorMessage(null);
      setSuccessMessage('Damage recorded. Stock moved to QUARANTINE and write-off adjustment created.');
      setActionTab('TASKS');
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Failed to flag damage');
    },
  });

  // Request relocation mutation
  const requestRelocMutation = useMutation({
    mutationFn: (body: any) =>
      apiFetch('/api/relocations/request', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setRelocFrom('');
      setRelocTo('');
      setRelocSku('');
      setRelocQty('');
      setErrorMessage(null);
      setSuccessMessage('Relocation floor task requested.');
      setActionTab('TASKS');
      queryClient.invalidateQueries({ queryKey: ['floor-tasks'] });
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Failed to request relocation');
    },
  });

  const handleCountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTask || !countBinScan || countedQty === '') return;
    countMutation.mutate({
      ref: activeTask.task_ref,
      binScan: countBinScan.trim().toUpperCase(),
      countedQty: Number(countedQty),
    });
  };

  const handleRelocateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTask || !fromScan || !itemScan || !toScan) return;
    relocateMutation.mutate({
      ref: activeTask.task_ref,
      fromScan: fromScan.trim().toUpperCase(),
      itemScan: itemScan.trim().toUpperCase(),
      toScan: toScan.trim().toUpperCase(),
    });
  };

  const handleDamageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!damageBin || damageQty === '') return;
    damageMutation.mutate({
      binCode: damageBin.trim().toUpperCase(),
      qty: Number(damageQty),
      note: damageNote.trim() || undefined,
    });
  };

  const handleRelocReqSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!relocFrom || !relocTo || !relocSku || relocQty === '') return;
    requestRelocMutation.mutate({
      fromBin: relocFrom.trim().toUpperCase(),
      toBin: relocTo.trim().toUpperCase(),
      sku: relocSku.trim().toUpperCase(),
      qty: Number(relocQty),
      reasonCode: relocReason,
    });
  };

  return (
    <div className="m3-page" style={{ maxWidth: '960px', margin: '0 auto' }}>
      <div className="m3-page-header">
        <div>
          <h1>Operator Floor Console</h1>
          <p className="m3-subtitle">
            Perform blind cycle counts, stock relocations, and floor inventory management.
          </p>
        </div>

        {/* Tab switchers */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`btn ${actionTab === 'TASKS' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActionTab('TASKS')}
          >
            Tasks ({allTasks.filter((t) => t.status === 'OPEN').length})
          </button>
          <button
            className={`btn ${actionTab === 'FLAG_DAMAGE' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActionTab('FLAG_DAMAGE')}
          >
            Flag Damage
          </button>
          <button
            className={`btn ${actionTab === 'NEW_RELOCATE' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActionTab('NEW_RELOCATE')}
          >
            Request Relocate
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="banner banner-error" style={{ marginBottom: '16px' }}>
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div className="banner banner-success" style={{ marginBottom: '16px' }}>
          {successMessage}
        </div>
      )}

      {/* ACTIVE TASK VIEW */}
      {actionTab === 'TASKS' && activeTask && (
        <div className="card" style={{ marginBottom: '24px', border: '2px solid var(--accent-primary)', padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <span className="badge badge-primary" style={{ marginRight: '8px', fontSize: '13px' }}>
                ACTIVE TASK: {activeTask.type}
              </span>
              <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '16px' }}>{activeTask.task_ref}</strong>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => releaseMutation.mutate(activeTask.task_ref)}
              disabled={releaseMutation.isPending}
            >
              Release Task
            </button>
          </div>

          {/* COUNT FORM */}
          {activeTask.type === 'COUNT' && (
            <div>
              <div
                style={{
                  padding: '16px',
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '20px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '12px',
                }}
              >
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Location to Count:</span>
                  <div style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                    {activeTask.bin_code}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Product SKU:</span>
                  <div style={{ fontSize: '15px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {activeTask.sku}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Priority:</span>
                  <div>
                    <span className="badge badge-warning">Priority {activeTask.priority}</span>
                  </div>
                </div>
              </div>

              <div className="banner banner-info" style={{ marginBottom: '20px' }}>
                ℹ️ <strong>Blind Count Protocol:</strong> System stock levels are hidden. Physically verify the bin and enter the exact units present.
              </div>

              <form onSubmit={handleCountSubmit}>
                <div className="form-group">
                  <label className="form-label">Scan Bin Barcode</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder={`Scan or type ${activeTask.bin_code}...`}
                    required
                    value={countBinScan}
                    onChange={(e) => setCountBinScan(e.target.value.toUpperCase())}
                    data-testid="count-bin-scan-input"
                    autoFocus
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label className="form-label">Physical Counted Quantity</label>
                  <input
                    type="number"
                    className="input-field"
                    placeholder="Enter total units found in bin (e.g. 0 if empty)..."
                    required
                    min={0}
                    value={countedQty}
                    onChange={(e) => setCountedQty(e.target.value === '' ? '' : Number(e.target.value))}
                    data-testid="counted-qty-input"
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '12px', fontSize: '15px' }}
                  disabled={countMutation.isPending}
                  data-testid="submit-count-btn"
                >
                  {countMutation.isPending ? 'Verifying & Submitting...' : 'Submit Blind Count'}
                </button>
              </form>
            </div>
          )}

          {/* RELOCATE FORM */}
          {activeTask.type === 'RELOCATE' && (
            <div>
              <div
                style={{
                  padding: '16px',
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '20px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '12px',
                }}
              >
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>From Bin:</span>
                  <div style={{ fontSize: '16px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                    {activeTask.bin_code}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>To Bin:</span>
                  <div style={{ fontSize: '16px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)' }}>
                    {activeTask.to_bin_code || 'TBD'}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>SKU:</span>
                  <div style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {activeTask.sku}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Qty to Move:</span>
                  <div style={{ fontSize: '16px', fontWeight: 800 }}>
                    {activeTask.qty || 1} units
                  </div>
                </div>
              </div>

              <form onSubmit={handleRelocateSubmit}>
                <div className="form-group">
                  <label className="form-label">1. Scan Source Bin ({activeTask.bin_code})</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Scan source bin..."
                    required
                    value={fromScan}
                    onChange={(e) => setFromScan(e.target.value.toUpperCase())}
                    data-testid="relocate-from-scan"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">2. Scan Product Barcode ({activeTask.sku})</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Scan product barcode..."
                    required
                    value={itemScan}
                    onChange={(e) => setItemScan(e.target.value.toUpperCase())}
                    data-testid="relocate-item-scan"
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label className="form-label">3. Scan Target Bin ({activeTask.to_bin_code})</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Scan target bin..."
                    required
                    value={toScan}
                    onChange={(e) => setToScan(e.target.value.toUpperCase())}
                    data-testid="relocate-to-scan"
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '12px', fontSize: '15px' }}
                  disabled={relocateMutation.isPending}
                  data-testid="submit-relocate-btn"
                >
                  {relocateMutation.isPending ? 'Moving Stock...' : 'Confirm Relocation'}
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* OPEN TASKS QUEUE */}
      {actionTab === 'TASKS' && !activeTask && (
        <div className="card" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontWeight: 800 }}>Available Floor Tasks</h3>

          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
              Loading open floor tasks...
            </div>
          ) : allTasks.filter((t) => t.status === 'OPEN').length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
              No open floor tasks right now. Great job!
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Type</th>
                    <th>Location</th>
                    <th>Target</th>
                    <th>SKU</th>
                    <th>Qty</th>
                    <th>Priority</th>
                    <th>Due Time</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {allTasks
                    .filter((t) => t.status === 'OPEN')
                    .map((task) => (
                      <tr key={task.id} data-testid={`task-row-${task.task_ref}`}>
                        <td>
                          <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)' }}>
                            {task.task_ref}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${task.type === 'COUNT' ? 'badge-warning' : 'badge-info'}`}>
                            {task.type}
                          </span>
                        </td>
                        <td>
                          <strong style={{ fontFamily: 'var(--font-mono)' }}>{task.bin_code}</strong>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{task.to_bin_code || '—'}</span>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{task.sku}</span>
                        </td>
                        <td>{task.qty || '—'}</td>
                        <td>
                          <span className="badge badge-secondary">{task.priority}</span>
                        </td>
                        <td>
                          {task.due_at ? (
                            <span style={{ fontSize: '12px' }}>
                              {new Date(task.due_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => claimMutation.mutate(task.task_ref)}
                            disabled={claimMutation.isPending}
                            data-testid={`claim-task-${task.task_ref}`}
                          >
                            Claim Task
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* FLAG DAMAGE TAB */}
      {actionTab === 'FLAG_DAMAGE' && (
        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ margin: '0 0 8px', fontWeight: 800 }}>Flag Damaged Stock</h3>
          <p className="m3-subtitle" style={{ marginBottom: '20px' }}>
            Immediately quarantines damaged product from a bin and submits a write-off adjustment for manager approval.
          </p>

          <form onSubmit={handleDamageSubmit}>
            <div className="form-group">
              <label className="form-label">Bin Code</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. B-02-03"
                required
                value={damageBin}
                onChange={(e) => setDamageBin(e.target.value.toUpperCase())}
                data-testid="damage-bin-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Damaged Quantity</label>
              <input
                type="number"
                className="input-field"
                placeholder="Number of damaged units..."
                required
                min={1}
                value={damageQty}
                onChange={(e) => setDamageQty(e.target.value === '' ? '' : Number(e.target.value))}
                data-testid="damage-qty-input"
              />
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label className="form-label">Damage Note / Details</label>
              <textarea
                className="input-field"
                rows={3}
                placeholder="Description of damage (e.g. crushed box, torn packaging)..."
                value={damageNote}
                onChange={(e) => setDamageNote(e.target.value)}
                data-testid="damage-note-input"
              />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="submit"
                className="btn btn-danger"
                disabled={damageMutation.isPending}
                data-testid="submit-damage-btn"
              >
                {damageMutation.isPending ? 'Quarantining Stock...' : 'Flag Damage & Quarantine'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setActionTab('TASKS')}
              >
                Back to Tasks
              </button>
            </div>
          </form>
        </div>
      )}

      {/* NEW RELOCATE TAB */}
      {actionTab === 'NEW_RELOCATE' && (
        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ margin: '0 0 8px', fontWeight: 800 }}>Request Stock Relocation</h3>
          <p className="m3-subtitle" style={{ marginBottom: '20px' }}>
            Schedule an internal warehouse relocation from one bin to another (e.g. zone rebalancing or consolidation).
          </p>

          <form onSubmit={handleRelocReqSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Source Bin</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. A-01-01"
                  required
                  value={relocFrom}
                  onChange={(e) => setRelocFrom(e.target.value.toUpperCase())}
                  data-testid="reloc-from-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Destination Bin</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. B-01-02"
                  required
                  value={relocTo}
                  onChange={(e) => setRelocTo(e.target.value.toUpperCase())}
                  data-testid="reloc-to-input"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Product SKU</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. SKU-SNACK-01"
                  required
                  value={relocSku}
                  onChange={(e) => setRelocSku(e.target.value.toUpperCase())}
                  data-testid="reloc-sku-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Quantity</label>
                <input
                  type="number"
                  className="input-field"
                  placeholder="Units to relocate..."
                  required
                  min={1}
                  value={relocQty}
                  onChange={(e) => setRelocQty(e.target.value === '' ? '' : Number(e.target.value))}
                  data-testid="reloc-qty-input"
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label className="form-label">Reason</label>
              <select
                className="select"
                value={relocReason}
                onChange={(e) => setRelocReason(e.target.value)}
              >
                <option value="REBALANCE">Zone Rebalance</option>
                <option value="CONSOLIDATION">Space Consolidation</option>
                <option value="DAMAGED_SHELF">Damaged Shelf / Rack</option>
                <option value="FAST_PICK">Fast Pick Relocation</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={requestRelocMutation.isPending}
                data-testid="submit-reloc-req-btn"
              >
                {requestRelocMutation.isPending ? 'Scheduling Task...' : 'Create Relocation Task'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setActionTab('TASKS')}
              >
                Back to Tasks
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
