import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { OrderDto } from '@dark-storage/shared';
import { StatusBadge } from '../components/StatusBadge.js';

export const OrdersPage: React.FC = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');

  const isManager = user?.role === 'MANAGER';

  const { data, isLoading } = useQuery<{ items: OrderDto[]; page: number; page_size: number; total: number }>({
    queryKey: ['orders', page, search, status, priority],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('page_size', '25');
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (priority) params.set('priority', priority);
      return apiFetch(`/api/orders?${params.toString()}`);
    },
    refetchInterval: 15000
  });

  const orders = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600 }}>Outbound Orders</h1>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
            Manage customer, transfer, and production orders with atomic stock reservations
          </p>
        </div>
        {isManager && (
          <button
            className="btn btn-primary"
            onClick={() => navigate('/orders/new')}
            data-testid="orders-new-btn"
          >
            + New Order
          </button>
        )}
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          flexWrap: 'wrap',
          background: 'var(--color-bg-card)',
          padding: '1rem',
          borderRadius: '8px'
        }}
      >
        <div style={{ flex: '1 1 200px' }}>
          <input
            type="text"
            className="form-control"
            placeholder="Search ref, customer, SKU, name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div style={{ width: '160px' }}>
          <select
            className="form-control"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Statuses</option>
            <option value="RESERVED">RESERVED</option>
            <option value="ASSIGNED">ASSIGNED</option>
            <option value="PICKING">PICKING</option>
            <option value="PICKED">PICKED</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>

        <div style={{ width: '160px' }}>
          <select
            className="form-control"
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Priorities</option>
            <option value="LOW">LOW</option>
            <option value="NORMAL">NORMAL</option>
            <option value="HIGH">HIGH</option>
            <option value="URGENT">URGENT</option>
          </select>
        </div>
      </div>

      {/* Orders Table */}
      <div style={{ background: 'var(--color-bg-card)', borderRadius: '8px', overflow: 'hidden' }}>
        <table className="table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Order Ref</th>
              <th>Type</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Customer</th>
              <th>Lines / Units</th>
              <th>Picker</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>
                  Loading orders...
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-secondary)' }}>
                  No orders found
                </td>
              </tr>
            ) : (
              orders.map((o) => {
                const totalUnits = o.lines.reduce((acc, l) => acc + l.qty_ordered, 0);
                return (
                  <tr
                    key={o.ref}
                    onClick={() => navigate(`/orders/${o.ref}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{o.ref}</td>
                    <td>{o.order_type}</td>
                    <td>
                      <span className={`badge badge-${o.priority === 'URGENT' ? 'danger' : o.priority === 'HIGH' ? 'warning' : 'secondary'}`}>
                        {o.priority}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td>{o.customer_ref || '—'}</td>
                    <td>
                      {o.lines.length} lines ({totalUnits} units)
                    </td>
                    <td>{typeof o.assigned_picker === 'object' && o.assigned_picker ? (o.assigned_picker as any).name : o.assigned_picker || '—'}</td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                      {new Date(o.created_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1rem',
              borderTop: '1px solid var(--color-border)'
            }}
          >
            <span style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
              Showing {orders.length} of {total} orders
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span style={{ alignSelf: 'center', padding: '0 0.5rem', fontSize: '0.875rem' }}>
                Page {page} of {totalPages}
              </span>
              <button
                className="btn btn-secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
