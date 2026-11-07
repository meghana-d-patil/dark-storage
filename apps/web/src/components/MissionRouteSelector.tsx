import React from 'react';
import { useActiveMissions } from '../hooks/useWarehouseData.js';

interface MissionRouteSelectorProps {
  selectedMission: string;
  onSelectMission: (missionRef: string) => void;
}

export const MissionRouteSelector: React.FC<MissionRouteSelectorProps> = ({
  selectedMission,
  onSelectMission
}) => {
  const { data, isLoading } = useActiveMissions();

  const missions = data?.missions || [];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <label
        htmlFor="mission-route-select"
        style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}
      >
        Mission Route:
      </label>
      <select
        id="mission-route-select"
        className="input-field"
        style={{
          minWidth: '260px',
          padding: '8px 12px',
          fontSize: '13px',
          fontFamily: 'var(--font-mono)'
        }}
        value={selectedMission}
        onChange={(e) => onSelectMission(e.target.value)}
        data-testid="mission-route-select"
        disabled={isLoading}
      >
        <option value="">-- No route overlay --</option>
        {missions.map((m) => {
          const pickerName = m.picker?.name || 'Unassigned';
          const label = `${m.ref} · ${m.order_ref} · ${pickerName} · ${m.status}`;
          return (
            <option key={m.ref} value={m.ref}>
              {label}
            </option>
          );
        })}
      </select>
    </div>
  );
};
