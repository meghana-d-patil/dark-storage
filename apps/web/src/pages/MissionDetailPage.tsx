import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { MissionDto, PickStopDto } from '@dark-storage/shared';
import { StatusBadge } from '../components/StatusBadge.js';

export const MissionDetailPage: React.FC = () => {
  const { ref } = useParams<{ ref: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [startError, setStartError] = useState('');

  // Active pick state
  const [scannedBin, setScannedBin] = useState('');
  const [scannedSku, setScannedSku] = useState('');
  const [pickedQty, setPickedQty] = useState<number | string>('');
  const [exceptionType, setExceptionType] = useState<'SHORT_PICK' | 'DAMAGED' | 'OTHER'>('SHORT_PICK');
  const [exceptionNotes, setExceptionNotes] = useState('');
  const [pickError, setPickError] = useState('');
  const [pickKey, setPickKey] = useState<string>('');

  // Report problem modal state
  const [showProblemModal, setShowProblemModal] = useState(false);
  const [problemType, setProblemType] = useState<'BIN_EMPTY' | 'DAMAGED' | 'WRONG_PRODUCT' | 'OTHER'>('BIN_EMPTY');
  const [problemNotes, setProblemNotes] = useState('');
  const [problemError, setProblemError] = useState('');
  const [problemKey, setProblemKey] = useState<string>('');

  const { data: mission, isLoading, error } = useQuery<MissionDto>({
    queryKey: ['mission', ref],
    queryFn: () => apiFetch(`/api/missions/${ref}`),
    refetchInterval: 5000,
    enabled: !!ref
  });

  // Find lowest seq PENDING stop
  const pendingStops = (mission?.stops || []).filter((s) => s.status === 'PENDING');
  pendingStops.sort((a, b) => a.seq - b.seq);
  const currentStop: PickStopDto | undefined = pendingStops[0];

  // Initialize or reset pick inputs when current stop changes
  useEffect(() => {
    if (currentStop) {
      setScannedBin('');
      setScannedSku('');
      setPickedQty(currentStop.qty_required);
      setExceptionType('SHORT_PICK');
      setExceptionNotes('');
      setPickError('');
      // Generate key for this stop attempt; key is kept on retry to ensure idempotent retry
      setPickKey(`pick-${currentStop.stop_ref}-${Date.now()}`);
      setProblemKey(`prob-${currentStop.stop_ref}-${Date.now()}`);
      setProblemNotes('');
      setProblemError('');
      setShowProblemModal(false);
    }
  }, [currentStop?.stop_ref]);

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

  const confirmMutation = useMutation({
    mutationFn: (body: any) =>
      apiFetch(`/api/pick-stops/${currentStop!.stop_ref}/confirm`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': pickKey
        },
        body: JSON.stringify(body)
      }),
    onSuccess: () => {
      setPickError('');
      queryClient.invalidateQueries({ queryKey: ['mission', ref] });
      queryClient.invalidateQueries({ queryKey: ['missions'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (err: any) => {
      // Friendly error handling
      const code = err.code || err.details?.code;
      if (code === 'PRODUCT_MISMATCH' || err.message?.includes('PRODUCT_MISMATCH')) {
        setPickError(`Product mismatch: expected ${currentStop?.sku}`);
      } else if (code === 'BIN_MISMATCH' || err.message?.includes('BIN_MISMATCH')) {
        setPickError(`Bin mismatch: expected ${currentStop?.bin_code}`);
      } else if (code === 'QUANTITY_EXCEEDS_RESERVATION' || err.message?.includes('QUANTITY_EXCEEDS_RESERVATION')) {
        setPickError(`Quantity exceeds reservation`);
      } else {
        setPickError(err.message || 'Failed to confirm pick');
      }
    }
  });

  const reportProblemMutation = useMutation({
    mutationFn: (body: any) =>
      apiFetch(`/api/pick-stops/${currentStop!.stop_ref}/exception`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': problemKey
        },
        body: JSON.stringify(body)
      }),
    onSuccess: () => {
      setShowProblemModal(false);
      setProblemError('');
      queryClient.invalidateQueries({ queryKey: ['mission', ref] });
      queryClient.invalidateQueries({ queryKey: ['missions'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (err: any) => {
      setProblemError(err.message || 'Failed to report problem');
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
  const isManager = user?.role === 'MANAGER';
  const canOperate = isAssignedPicker || isManager;
  const canStart = mission.status === 'ASSIGNED' && canOperate;
  const isPickingActive = mission.status === 'IN_PROGRESS' && canOperate;

  // Progress metrics
  const unitsPicked = mission.progress.units_picked;
  const unitsRequired = mission.progress.units_required;
  const unitsPct = unitsRequired > 0 ? Math.min(100, Math.round((unitsPicked / unitsRequired) * 100)) : 0;
  const stopsFinished = mission.progress.finished_stops;
  const totalStops = mission.progress.total_stops;
  const stopsPct = totalStops > 0 ? Math.min(100, Math.round((stopsFinished / totalStops) * 100)) : 0;

  // Validation for confirm pick
  const numericPickedQty = Number(pickedQty);
  const isShortPick = currentStop && numericPickedQty < currentStop.qty_required;
  const isConfirmDisabled =
    !currentStop ||
    confirmMutation.isPending ||
    !scannedBin.trim() ||
    !scannedSku.trim() ||
    isNaN(numericPickedQty) ||
    numericPickedQty <= 0 ||
    numericPickedQty > currentStop.qty_required ||
    (isShortPick && (!exceptionType || exceptionNotes.trim().length === 0));

  const handleConfirmPick = () => {
    if (!currentStop) return;
    if (numericPickedQty > currentStop.qty_required) {
      setPickError('Quantity exceeds reservation');
      return;
    }

    const payload: any = {
      scanned_bin: scannedBin.trim(),
      scanned_sku: scannedSku.trim(),
      picked_qty: numericPickedQty
    };

    if (numericPickedQty < currentStop.qty_required) {
      payload.exception = {
        type: exceptionType,
        notes: exceptionNotes.trim()
      };
    }

    confirmMutation.mutate(payload);
  };

  const handleReportProblem = () => {
    if (!currentStop) return;
    if (problemNotes.trim().length < 3) {
      setProblemError('Notes must be at least 3 characters');
      return;
    }

    reportProblemMutation.mutate({
      type: problemType,
      notes: problemNotes.trim()
    });
  };

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
                data-testid="mission-start-btn"
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

      {/* Progress Strip with visual progress bars */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1.25rem',
          background: 'var(--color-bg-card)',
          padding: '1.25rem',
          borderRadius: '8px'
        }}
      >
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Stops Completed</span>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{stopsPct}%</span>
          </div>
          <p style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 600 }}>
            {stopsFinished} / {totalStops}
          </p>
          <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              data-testid="progress-stops"
              style={{
                width: `${stopsPct}%`,
                height: '100%',
                background: 'var(--color-primary, #3b82f6)',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Units Picked</span>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{unitsPct}%</span>
          </div>
          <p style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 600 }}>
            {unitsPicked} / {unitsRequired}
          </p>
          <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              data-testid="progress-units"
              style={{
                width: `${unitsPct}%`,
                height: '100%',
                background: '#10b981',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
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
          {mission.progress.open_exceptions > 0 && (
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
              Awaiting manager resolution
            </p>
          )}
        </div>
      </div>

      {/* ACTIVE STOP CARD (When IN_PROGRESS) */}
      {isPickingActive && currentStop && (
        <div
          data-testid="current-stop-card"
          style={{
            background: 'var(--color-bg-card)',
            border: '2px solid var(--color-primary, #3b82f6)',
            borderRadius: '8px',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span className="badge badge-primary" style={{ marginBottom: '0.5rem', display: 'inline-block' }}>
                CURRENT STOP #{currentStop.seq} ({currentStop.stop_ref})
              </span>
              <div style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '0.05em' }}>
                {currentStop.bin_code}
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
                Shelf: <strong>{currentStop.shelf_code}</strong>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{currentStop.product_name}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                SKU: {currentStop.sku}
              </div>
              <div style={{ marginTop: '0.5rem', fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                Required: {currentStop.qty_required} unit{currentStop.qty_required === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          {pickError && (
            <div className="banner banner-error" style={{ padding: '0.75rem 1rem', borderRadius: '6px' }} data-testid="pick-error-banner">
              {pickError}
            </div>
          )}

          {/* Scans & Inputs */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              background: 'rgba(255,255,255,0.02)',
              padding: '1rem',
              borderRadius: '6px'
            }}
          >
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.35rem' }}>
                Scan Bin Barcode *
              </label>
              <input
                type="text"
                className="form-control"
                data-testid="pick-scan-bin"
                value={scannedBin}
                onChange={(e) => setScannedBin(e.target.value)}
                placeholder={`e.g. ${currentStop.bin_code}`}
                autoComplete="off"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.35rem' }}>
                Scan Product SKU Barcode *
              </label>
              <input
                type="text"
                className="form-control"
                data-testid="pick-scan-sku"
                value={scannedSku}
                onChange={(e) => setScannedSku(e.target.value)}
                placeholder={`e.g. ${currentStop.sku}`}
                autoComplete="off"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.35rem' }}>
                Picked Quantity *
              </label>
              <input
                type="number"
                className="form-control"
                data-testid="pick-qty"
                value={pickedQty}
                onChange={(e) => setPickedQty(e.target.value)}
                min={1}
                max={currentStop.qty_required}
              />
            </div>
          </div>

          {/* Short pick exception fields */}
          {isShortPick && (
            <div
              data-testid="short-pick-fields"
              style={{
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                padding: '1rem',
                borderRadius: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
              }}
            >
              <div style={{ fontWeight: 600, color: '#f87171', fontSize: '0.9rem' }}>
                Short Pick Detected ({numericPickedQty} of {currentStop.qty_required} picked). Exception reporting required:
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem' }}>Reason Type *</label>
                  <select
                    className="form-control"
                    data-testid="pick-exc-type"
                    value={exceptionType}
                    onChange={(e: any) => setExceptionType(e.target.value)}
                  >
                    <option value="SHORT_PICK">Short Pick</option>
                    <option value="DAMAGED">Damaged Goods</option>
                    <option value="OTHER">Other Reason</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem' }}>Notes *</label>
                  <input
                    type="text"
                    className="form-control"
                    data-testid="pick-exc-notes"
                    value={exceptionNotes}
                    onChange={(e) => setExceptionNotes(e.target.value)}
                    placeholder="Provide details for manager..."
                  />
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="pick-report-btn"
              onClick={() => setShowProblemModal(true)}
            >
              Report Problem (Zero Pick)
            </button>

            <button
              type="button"
              className="btn btn-primary"
              data-testid="pick-confirm-btn"
              onClick={handleConfirmPick}
              disabled={isConfirmDisabled}
            >
              {confirmMutation.isPending ? 'Confirming Pick...' : 'Confirm Pick'}
            </button>
          </div>
        </div>
      )}

      {/* Mission completed or no pending stops */}
      {mission.status === 'COMPLETED' && (
        <div className="banner banner-success" style={{ padding: '1.25rem', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Mission Completed</h3>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            All pick stops have been finished. The order is now ready for packing.
          </p>
        </div>
      )}

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
              <tr key={stop.id} style={currentStop?.id === stop.id ? { background: 'rgba(59, 130, 246, 0.08)' } : undefined}>
                <td style={{ fontWeight: 600 }}>
                  {currentStop?.id === stop.id ? `▶ ${stop.seq}` : stop.seq}
                </td>
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

      {/* Report Problem Modal */}
      {showProblemModal && currentStop && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.25rem' }}>Report Problem for Stop {currentStop.stop_ref}</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
              Reporting a problem halts this stop and opens an exception for a warehouse manager. No inventory will be deducted.
            </p>

            {problemError && (
              <div className="banner banner-error" style={{ padding: '0.75rem', marginBottom: '1rem', borderRadius: '4px' }}>
                {problemError}
              </div>
            )}

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem', fontWeight: 500 }}>
                Problem Type *
              </label>
              <select
                className="form-control"
                data-testid="problem-type-select"
                value={problemType}
                onChange={(e: any) => setProblemType(e.target.value)}
              >
                <option value="BIN_EMPTY">Bin Empty (No stock found)</option>
                <option value="DAMAGED">Damaged Goods</option>
                <option value="WRONG_PRODUCT">Wrong Product in Bin</option>
                <option value="OTHER">Other Issue</option>
              </select>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem', fontWeight: 500 }}>
                Notes (Min 3 characters) *
              </label>
              <textarea
                className="form-control"
                rows={3}
                data-testid="problem-notes-input"
                placeholder="Explain the problem clearly for the manager..."
                value={problemNotes}
                onChange={(e) => setProblemNotes(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowProblemModal(false)}
                disabled={reportProblemMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                data-testid="pick-report-submit"
                onClick={handleReportProblem}
                disabled={problemNotes.trim().length < 3 || reportProblemMutation.isPending}
              >
                {reportProblemMutation.isPending ? 'Reporting...' : 'Submit Problem'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
