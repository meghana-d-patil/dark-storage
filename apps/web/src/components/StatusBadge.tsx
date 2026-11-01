import React from 'react';

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const norm = status.toLowerCase().replace(/_/g, '-');
  return <span className={`badge badge-${norm}`}>{status}</span>;
};
