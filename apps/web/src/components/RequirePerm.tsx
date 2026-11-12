import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore.js';
import { useCan } from '../hooks/useCan.js';

interface RequirePermProps {
  perm: string | string[];
  children?: React.ReactNode;
}

export const RequirePerm: React.FC<RequirePermProps> = ({ perm, children }) => {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const allowed = useCan(perm);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (!allowed) {
    const requiredStr = Array.isArray(perm) ? perm.join(' or ') : perm;
    return (
      <div style={{ padding: '40px', maxWidth: '600px', margin: '40px auto', textAlign: 'center' }} className="card">
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '8px' }}>Access Denied</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
          Your role (<strong>{user?.role}</strong>) does not have permission to view this section.
        </p>
        <div style={{ background: 'var(--surface-variant, #f1f5f9)', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace', marginBottom: '24px' }}>
          Required permission: {requiredStr}
        </div>
        <a href="/" className="btn btn-primary" style={{ display: 'inline-block' }}>
          Return to Dashboard
        </a>
      </div>
    );
  }

  return children ? <>{children}</> : <Outlet />;
};
