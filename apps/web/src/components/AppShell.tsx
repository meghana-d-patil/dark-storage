import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore.js';
import { useRealtime } from '../hooks/useRealtime.js';
import { useRealtimeStore } from '../stores/realtimeStore.js';
import { apiFetch } from '../api/client.js';
import { AuthResponse } from '@dark-storage/shared';

interface AppShellProps {
  navLinks?: Array<{ to: string; label: string; testId: string }>;
}

const roleAccounts: Record<string, { username: string; label: string }> = {
  MANAGER: { username: 'manager1', label: 'Manager' },
  OPERATOR: { username: 'operator1', label: 'Operator' },
  PICKER: { username: 'picker1', label: 'Picker' },
  STAFF: { username: 'staff1', label: 'Staff' }
};

export const AppShell: React.FC<AppShellProps> = ({ navLinks }) => {
  const { user, login, logout } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useRealtime();
  const { connected, statusText } = useRealtimeStore();
  const [switchingRole, setSwitchingRole] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleRoleSwitch = async (targetRole: string) => {
    const account = roleAccounts[targetRole];
    if (!account || account.username === user?.username || switchingRole) return;
    setSwitchingRole(true);
    try {
      const resp = await apiFetch<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: account.username, password: 'Warehouse#2026' })
      });
      login(resp.token, resp.user);
      queryClient.clear();
      navigate('/');
    } catch (err) {
      console.error('Role switch failed:', err);
    } finally {
      setSwitchingRole(false);
    }
  };

  const isReceivingRole = user?.role === 'MANAGER' || user?.role === 'OPERATOR';
  const isPickingRole = user?.role === 'MANAGER' || user?.role === 'PICKER';
  const isPackingRole = user?.role === 'MANAGER' || user?.role === 'STAFF';
  const isManager = user?.role === 'MANAGER';

  const defaultLinks = [
    { to: '/', label: 'Home', testId: 'nav-home' },
    ...(isReceivingRole ? [{ to: '/receiving', label: 'Receiving', testId: 'nav-receiving' }] : []),
    { to: '/inventory', label: 'Inventory', testId: 'nav-inventory' },
    { to: '/orders', label: 'Orders', testId: 'nav-orders' },
    ...(isPickingRole ? [{ to: '/picking', label: 'Picking', testId: 'nav-picking' }] : []),
    ...(isPackingRole ? [{ to: '/packing', label: 'Packing', testId: 'nav-packing' }] : []),
    ...(isPickingRole ? [{ to: '/exceptions', label: 'Exceptions', testId: 'nav-exceptions' }] : []),
    { to: '/warehouse', label: 'Warehouse', testId: 'nav-warehouse' },
    ...(isManager ? [{ to: '/tasks', label: 'Tasks', testId: 'nav-tasks' }] : []),
    ...(isManager ? [{ to: '/admin', label: 'Admin', testId: 'nav-admin' }] : [])
  ];

  const links = navLinks || defaultLinks;

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-brand">
          <span className="header-brand-icon">DS</span>
          <span>Dark Storage WMS</span>
        </div>
        <div className="header-actions">
          <span
            className={`badge ${connected ? 'badge-ok' : 'badge-warning'}`}
            data-testid="ws-status"
          >
            {connected ? 'Live' : statusText || 'Reconnecting…'}
          </span>

          {/* Quick Top Bar Role Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
              Role:
            </span>
            <select
              className="select"
              value={user?.role || 'MANAGER'}
              onChange={(e) => handleRoleSwitch(e.target.value)}
              disabled={switchingRole}
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                height: '32px',
                borderRadius: 'var(--radius-pill)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                cursor: 'pointer',
                fontWeight: 600
              }}
              title="Switch role instantly"
              data-testid="header-role-switcher"
            >
              <option value="MANAGER">👔 Manager</option>
              <option value="OPERATOR">⚙️ Operator</option>
              <option value="PICKER">📦 Picker</option>
              <option value="STAFF">📋 Staff</option>
            </select>
          </div>

          {user && (
            <span className="user-badge" data-testid="header-user">
              {user.display_name} · {user.role}
            </span>
          )}
          <button className="btn btn-secondary" onClick={handleLogout} data-testid="logout-btn">
            Logout
          </button>
        </div>
      </header>
      <div className="main-body">
        <aside className="sidebar">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              data-testid={link.testId}
            >
              {link.label}
            </NavLink>
          ))}
        </aside>
        <main className="content-area">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
