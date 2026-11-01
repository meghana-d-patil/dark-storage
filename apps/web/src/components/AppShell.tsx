import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore.js';

interface AppShellProps {
  navLinks?: Array<{ to: string; label: string; testId: string }>;
}

export const AppShell: React.FC<AppShellProps> = ({ navLinks }) => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isReceivingRole = user?.role === 'MANAGER' || user?.role === 'OPERATOR';
  const isPickingRole = user?.role === 'MANAGER' || user?.role === 'PICKER';
  const isManager = user?.role === 'MANAGER';

  const defaultLinks = [
    { to: '/', label: 'Home', testId: 'nav-home' },
    ...(isReceivingRole ? [{ to: '/receiving', label: 'Receiving', testId: 'nav-receiving' }] : []),
    { to: '/inventory', label: 'Inventory', testId: 'nav-inventory' },
    { to: '/orders', label: 'Orders', testId: 'nav-orders' },
    ...(isPickingRole ? [{ to: '/picking', label: 'Picking', testId: 'nav-picking' }] : []),
    ...(isPickingRole ? [{ to: '/exceptions', label: 'Exceptions', testId: 'nav-exceptions' }] : []),
    { to: '/warehouse', label: 'Warehouse', testId: 'nav-warehouse' },
    ...(isManager ? [{ to: '/tasks', label: 'Tasks', testId: 'nav-tasks' }] : [])
  ];


  const links = navLinks || defaultLinks;

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-brand">
          <span>Dark Storage WMS</span>
        </div>
        <div className="header-actions">
          <span className="badge badge-info" data-testid="ws-status">
            WS Ready
          </span>
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
