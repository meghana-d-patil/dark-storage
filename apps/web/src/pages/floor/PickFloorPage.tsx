import React, { useState, useEffect, useRef } from 'react';
import { apiFetch, ApiError } from '../../api/client.js';
import { PickerMissionDTO, PickerStopDTO } from '@dark-storage/shared';

export const PickFloorPage: React.FC = () => {
  const [mission, setMission] = useState<PickerMissionDTO | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [scanInput, setScanInput] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const fetchActiveMission = async () => {
    try {
      setLoading(true);
      const res = await apiFetch<PickerMissionDTO>('/api/picker/mission');
      setMission(res);
      setBanner(null);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'NO_MISSION_AVAILABLE') {
        setMission(null);
      } else {
        setBanner({ type: 'error', message: err.message || 'Failed to load mission' });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActiveMission();
  }, []);

  // Heartbeat every 15s while mission is open
  useEffect(() => {
    if (!mission || mission.status === 'COMPLETED') return;

    const interval = setInterval(async () => {
      try {
        await apiFetch(`/api/missions/${encodeURIComponent(mission.missionRef)}/heartbeat`, {
          method: 'POST',
        });
      } catch (err) {
        console.warn('Heartbeat failed:', err);
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [mission]);

  // Autofocus scan input whenever step changes
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, [mission]);

  const handleClaimNext = async () => {
    try {
      setSubmitting(true);
      setBanner(null);
      const res = await apiFetch<{ ok: boolean; mission: PickerMissionDTO }>('/api/missions/claim-next', {
        method: 'POST',
      });
      setMission(res.mission);
      setBanner({ type: 'success', message: `Mission ${res.mission.missionRef} claimed successfully!` });
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'No missions available to claim' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRelease = async () => {
    if (!mission) return;
    try {
      setSubmitting(true);
      await apiFetch(`/api/missions/${encodeURIComponent(mission.missionRef)}/release`, {
        method: 'POST',
      });
      setMission(null);
      setBanner({ type: 'success', message: 'Mission released back to queue.' });
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Failed to release mission' });
    } finally {
      setSubmitting(false);
    }
  };

  // Find active stop
  const activeStop: PickerStopDTO | undefined = mission?.stops.find(
    (s) => s.step !== 'DONE' && s.step !== 'SHORT'
  );

  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanInput.trim() || !activeStop || !mission) return;

    const scanValue = scanInput.trim();
    setScanInput('');
    setSubmitting(true);
    setBanner(null);

    const idempotencyKey = `scan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    try {
      let endpoint = '';
      let body: any = { scan: scanValue };

      if (activeStop.step === 'SCAN_BIN') {
        endpoint = `/api/pick-stops/${encodeURIComponent(activeStop.stopRef)}/scan-bin`;
      } else if (activeStop.step === 'SCAN_ITEM') {
        endpoint = `/api/pick-stops/${encodeURIComponent(activeStop.stopRef)}/scan-item`;
        body.qty = activeStop.qtyToPick;
      } else if (activeStop.step === 'SCAN_TOTE') {
        endpoint = `/api/pick-stops/${encodeURIComponent(activeStop.stopRef)}/scan-tote`;
      }

      const res = await apiFetch<{ ok: boolean; step: string; mission: PickerMissionDTO }>(endpoint, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify(body),
      });

      setMission(res.mission);
      setBanner({ type: 'success', message: `Scan accepted: ${scanValue}` });
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Scan rejected' });
    } finally {
      setSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center">
        <p className="text-gray-500">Loading picker workspace...</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-xl mx-auto space-y-4">
      {/* Banner */}
      {banner && (
        <div
          className={`p-3 rounded font-medium text-sm border ${
            banner.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
              : 'bg-rose-50 text-rose-800 border-rose-300'
          }`}
        >
          {banner.message}
        </div>
      )}

      {/* No active mission screen */}
      {!mission ? (
        <div className="bg-white border rounded-lg shadow-sm p-8 text-center space-y-6">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto text-2xl font-bold">
            📦
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Floor Picking Station</h1>
            <p className="text-sm text-gray-500 mt-1">Ready for your next picking assignment.</p>
          </div>
          <button
            onClick={handleClaimNext}
            disabled={submitting}
            className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-700 text-white text-lg font-bold rounded-lg shadow-md transition disabled:opacity-50"
          >
            {submitting ? 'Claiming Mission...' : 'Claim Next Mission'}
          </button>
        </div>
      ) : (
        /* Active mission screen */
        <div className="space-y-4">
          {/* Header */}
          <div className="bg-white border rounded-lg p-4 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Active Mission</div>
              <div className="text-lg font-bold text-gray-900">{mission.missionRef}</div>
            </div>
            <div className="text-right">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Progress</div>
              <div className="text-lg font-bold text-blue-600">
                {mission.doneStops} / {mission.totalStops} Stops
              </div>
            </div>
          </div>

          {activeStop ? (
            /* Current Stop Card */
            <div className="bg-white border-2 border-blue-500 rounded-lg p-6 shadow-md space-y-6">
              <div className="flex justify-between items-center border-b pb-3">
                <span className="px-2.5 py-1 bg-blue-100 text-blue-800 rounded font-semibold text-xs uppercase tracking-wide">
                  Stop #{activeStop.seq} of {mission.totalStops}
                </span>
                <span className="text-xs font-mono text-gray-500">{activeStop.stopRef}</span>
              </div>

              {/* Big Location Display */}
              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="p-3 bg-gray-50 border rounded-lg">
                  <div className="text-xs text-gray-500 font-medium">Aisle</div>
                  <div className="text-2xl font-black text-gray-800 mt-1">{activeStop.aisleLabel}</div>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="text-xs text-blue-700 font-medium">Bin Code</div>
                  <div className="text-2xl font-black text-blue-900 mt-1">{activeStop.binCode}</div>
                </div>
              </div>

              {/* Item and Quantity Display */}
              <div className="p-4 bg-gray-50 border rounded-lg space-y-2">
                <div className="text-xs font-semibold text-gray-400 uppercase">Product to Pick</div>
                <div className="text-lg font-bold text-gray-900">{activeStop.productName}</div>
                <div className="flex items-center justify-between pt-2 border-t text-sm">
                  <span className="font-mono text-gray-600">{activeStop.sku}</span>
                  <span className="text-xl font-extrabold text-emerald-600">Pick {activeStop.qtyToPick} units</span>
                </div>
              </div>

              {/* Current Step Instruction & Barcode Scanner Form */}
              <form onSubmit={handleScanSubmit} className="space-y-3 pt-2">
                <label className="block text-sm font-bold text-gray-800">
                  {activeStop.step === 'SCAN_BIN' && '👉 Step 1: Scan Bin Barcode'}
                  {activeStop.step === 'SCAN_ITEM' && '👉 Step 2: Scan Product Barcode'}
                  {activeStop.step === 'SCAN_TOTE' && (
                    <span>
                      👉 Step 3: Scan Tote Barcode{' '}
                      {mission.toteCode ? (
                        <span className="text-blue-600 font-bold">({mission.toteCode})</span>
                      ) : (
                        <span className="text-emerald-600 font-normal">(Any free tote)</span>
                      )}
                    </span>
                  )}
                </label>
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    placeholder={
                      activeStop.step === 'SCAN_BIN'
                        ? 'Scan or enter bin code...'
                        : activeStop.step === 'SCAN_ITEM'
                        ? 'Scan or enter item SKU...'
                        : 'Scan or enter tote code...'
                    }
                    disabled={submitting}
                    className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg text-lg font-mono focus:border-blue-600 focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={submitting || !scanInput.trim()}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg disabled:opacity-50"
                  >
                    Enter
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* All stops finished */
            <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-6 text-center space-y-4">
              <div className="text-3xl">🎉</div>
              <h2 className="text-xl font-bold text-emerald-900">All stops completed!</h2>
              <p className="text-sm text-emerald-700">Mission has been marked as completed.</p>
              <button
                onClick={() => setMission(null)}
                className="py-2.5 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg"
              >
                Done
              </button>
            </div>
          )}

          {/* Release Mission Button */}
          <div className="text-center pt-2">
            <button
              onClick={handleRelease}
              disabled={submitting}
              className="text-xs text-rose-600 hover:text-rose-800 hover:underline"
            >
              Release Mission to Queue
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
