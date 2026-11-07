import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { OrderDto } from '@dark-storage/shared';

interface OrderLineInput {
  sku: string;
  qty: number;
}

interface ShortageItem {
  sku: string;
  product_name: string;
  requested: number;
  available: number;
}

export const NewOrderPage: React.FC = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const [orderType, setOrderType] = useState('CUSTOMER');
  const [priority, setPriority] = useState('NORMAL');
  const [customerRef, setCustomerRef] = useState('');
  const [notes, setNotes] = useState('');

  const [lines, setLines] = useState<OrderLineInput[]>([]);
  const [selectedSku, setSelectedSku] = useState('');
  const [itemQty, setItemQty] = useState(1);
  const [itemError, setItemError] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState('');
  const [shortages, setShortages] = useState<ShortageItem[] | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  // Fetch ATP summary for product dropdown
  const { data: invData } = useQuery<{ items: any[] }>({
    queryKey: ['inventory-summary-atp'],
    queryFn: () => apiFetch('/api/inventory/summary?page_size=100'),
    refetchInterval: 15000
  });

  const productsWithAtp = invData?.items || [];
  const selectedProduct = productsWithAtp.find((p) => p.sku === selectedSku);

  // Poll background task if reservation is async
  useEffect(() => {
    if (!activeTaskId) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const task = await apiFetch<any>(`/api/tasks/${activeTaskId}`);
        if (cancelled) return;

        if (task.status === 'SUCCEEDED') {
          clearInterval(interval);
          setStatusMessage('Order reserved and created successfully! Redirecting...');
          setTimeout(() => {
            if (task.result?.order_ref) {
              navigate(`/orders/${task.result.order_ref}`);
            } else {
              navigate('/orders');
            }
          }, 1200);
        } else if (task.status === 'FAILED') {
          clearInterval(interval);
          setIsSubmitting(false);
          setActiveTaskId(null);
          setGeneralError(task.error_message || 'Order creation failed during reservation');
        } else {
          setStatusMessage(`Processing order allocation... status: ${task.status}`);
        }
      } catch {
        // keep polling
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTaskId, navigate]);

  const handleAddLine = () => {
    if (!selectedSku) {
      setItemError('Please select a product');
      return;
    }
    if (itemQty < 1) {
      setItemError('Quantity must be at least 1');
      return;
    }

    const existingIndex = lines.findIndex((l) => l.sku === selectedSku);
    if (existingIndex >= 0) {
      const updated = [...lines];
      updated[existingIndex].qty += itemQty;
      setLines(updated);
    } else {
      setLines([...lines, { sku: selectedSku, qty: itemQty }]);
    }

    setSelectedSku('');
    setItemQty(1);
    setItemError('');
  };

  const handleRemoveLine = (sku: string) => {
    setLines(lines.filter((l) => l.sku !== sku));
  };

  const handleUpdateQty = (sku: string, newQty: number) => {
    if (newQty < 1) return;
    setLines(lines.map((l) => (l.sku === sku ? { ...l, qty: newQty } : l)));
  };

  const linesWithAtp = lines.map((l) => {
    const prod = productsWithAtp.find((p) => p.sku === l.sku);
    const atp = prod?.available_to_promise ?? 0;
    return {
      sku: l.sku,
      name: prod?.product_name || l.sku,
      qty: l.qty,
      atp,
      isOver: l.qty > atp
    };
  });

  const hasOverAtp = linesWithAtp.some((l) => l.isOver);
  const totalUnits = lines.reduce((acc, l) => acc + l.qty, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lines.length === 0) {
      setGeneralError('Add at least one product line');
      return;
    }

    setIsSubmitting(true);
    setGeneralError('');
    setShortages(null);
    setStatusMessage('Submitting order and reserving stock...');

    try {
      const idempotencyKey = `order-create-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const res = await apiFetch<any>('/api/orders', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          order_type: orderType,
          priority,
          customer_ref: customerRef.trim() || undefined,
          notes: notes.trim() || undefined,
          lines: lines.map((l) => ({ sku: l.sku, qty: l.qty, qty_ordered: l.qty }))
        })
      });

      if (res.task_id) {
        setActiveTaskId(res.task_id);
      } else if (res.order_ref || res.ref) {
        setStatusMessage('Order created! Redirecting...');
        setTimeout(() => navigate(`/orders/${res.order_ref || res.ref}`), 800);
      } else {
        navigate('/orders');
      }
    } catch (err: any) {
      setIsSubmitting(false);
      setStatusMessage('');
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK' && err.details?.shortages) {
        setShortages(err.details.shortages as ShortageItem[]);
        setGeneralError('Insufficient stock (ATP) to satisfy order lines. See details below.');
      } else if (err instanceof ApiError && err.details?.issues) {
        const issueMsg = (err.details.issues as Array<{ path?: string[]; message?: string }>)
          .map((i) => `${(i.path || []).join('.')}: ${i.message || 'invalid'}`)
          .join(', ');
        setGeneralError(`Validation failed: ${issueMsg}`);
      } else {
        setGeneralError(err.message || 'Failed to create order');
      }
    }
  };

  return (
    <div className="m3-page" style={{ maxWidth: '960px' }}>
      <div>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/orders')} style={{ marginBottom: '12px' }}>
          ← Back to Orders
        </button>
        <div className="m3-page-header">
          <div>
            <h1>Create New Outbound Order</h1>
            <p className="m3-subtitle">Configure order specifications and reserve stock across warehouse bins</p>
          </div>
        </div>
      </div>

      {generalError && (
        <div className="banner banner-error">
          {generalError}
        </div>
      )}

      {/* Shortage Table on 409 INSUFFICIENT_STOCK */}
      {shortages && (
        <div
          data-testid="order-shortage-table"
          className="alert alert-danger"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <h3 style={{ margin: 0, color: 'var(--accent-danger)', fontSize: '1.1rem', fontWeight: 800 }}>Insufficient Stock (ATP)</h3>
          <p style={{ margin: 0, fontSize: '13.5px' }}>
            The order cannot be reserved because available-to-promise stock is insufficient for the following line(s):
          </p>
          <div className="table-container">
            <table className="table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Requested Qty</th>
                  <th>Available (ATP)</th>
                  <th>Shortage</th>
                </tr>
              </thead>
              <tbody>
                {shortages.map((s) => (
                  <tr key={s.sku}>
                    <td>
                      <strong>{s.product_name}</strong> · <span style={{ fontFamily: 'var(--font-mono)' }}>{s.sku}</span>
                    </td>
                    <td style={{ color: 'var(--accent-danger)', fontWeight: 700 }}>{s.requested}</td>
                    <td style={{ color: 'var(--accent-success)', fontWeight: 700 }}>{s.available}</td>
                    <td style={{ color: 'var(--accent-danger)', fontWeight: 700 }}>{s.requested - s.available} short</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {statusMessage && (
        <div className="banner banner-info">
          {statusMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Header fields */}
        <div className="card">
          <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700 }}>Order Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Order Type</label>
              <select
                className="select"
                data-testid="order-type"
                value={orderType}
                onChange={(e) => setOrderType(e.target.value)}
              >
                <option value="CUSTOMER">CUSTOMER</option>
                <option value="TRANSFER">TRANSFER</option>
                <option value="PRODUCTION">PRODUCTION</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Priority</label>
              <select
                className="select"
                data-testid="order-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="LOW">LOW</option>
                <option value="NORMAL">NORMAL</option>
                <option value="HIGH">HIGH</option>
                <option value="URGENT">URGENT</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Customer / Reference</label>
              <input
                type="text"
                className="input-field"
                data-testid="order-customer"
                placeholder="e.g. Acme Retail"
                value={customerRef}
                onChange={(e) => setCustomerRef(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginTop: '16px', marginBottom: 0 }}>
            <label className="form-label">Notes</label>
            <input
              type="text"
              className="input-field"
              placeholder="e.g. Deliver before Friday 5pm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        {/* Add item section */}
        <div className="card">
          <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700 }}>Add Order Line</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px auto', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Product</label>
              <select
                className="select"
                data-testid="order-line-sku"
                value={selectedSku}
                onChange={(e) => {
                  setSelectedSku(e.target.value);
                  setItemError('');
                }}
              >
                <option value="">-- Choose Product --</option>
                {productsWithAtp.map((p) => (
                  <option key={p.sku} value={p.sku}>
                    {p.product_name} ({p.sku}) — ATP: {p.available_to_promise}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">
                Quantity {selectedProduct && <span style={{ color: 'var(--text-muted)' }}>(max {selectedProduct.available_to_promise})</span>}
              </label>
              <input
                type="number"
                min="1"
                className="input-field"
                data-testid="order-line-qty"
                value={itemQty}
                onChange={(e) => setItemQty(parseInt(e.target.value, 10) || 0)}
              />
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              data-testid="order-add-line"
              onClick={handleAddLine}
              style={{ height: '42px' }}
            >
              + Add Item
            </button>
          </div>

          {/* ATP Chips */}
          {selectedProduct && (
            <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
              <span className="badge badge-secondary">
                Stored: {selectedProduct.stored_qty}
              </span>
              <span className="badge badge-warning">
                Reserved: {selectedProduct.reserved_qty}
              </span>
              <span
                className={`badge badge-${selectedProduct.available_to_promise > 0 ? 'success' : 'danger'}`}
              >
                Available (ATP): {selectedProduct.available_to_promise}
              </span>
            </div>
          )}

          {itemError && (
            <p style={{ color: 'var(--accent-danger)', fontSize: '13px', margin: '10px 0 0' }}>{itemError}</p>
          )}
        </div>

        {/* Lines table */}
        <div className="table-container">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface)' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Order Lines ({lines.length})</h3>
          </div>

          {lines.length === 0 ? (
            <p style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)', margin: 0 }}>
              No items added yet. Add items above.
            </p>
          ) : (
            <table className="table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Available ATP</th>
                  <th>Order Quantity</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {linesWithAtp.map((l) => (
                  <tr key={l.sku} style={{ backgroundColor: l.isOver ? 'rgba(239, 68, 68, 0.12)' : undefined }}>
                    <td>
                      <strong style={{ color: 'var(--text-primary)' }}>{l.name}</strong> · <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }}>{l.sku}</span>
                    </td>
                    <td>
                      <span className={`badge badge-${l.atp >= l.qty ? 'success' : 'danger'}`}>
                        {l.atp}
                      </span>
                    </td>
                    <td style={{ width: '150px' }}>
                      <input
                        type="number"
                        min="1"
                        className="input-field"
                        value={l.qty}
                        onChange={(e) => handleUpdateQty(l.sku, parseInt(e.target.value, 10) || 1)}
                        style={{ borderColor: l.isOver ? 'var(--accent-danger)' : undefined }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => handleRemoveLine(l.sku)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Order Summary & Submit */}
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>
              Total: {lines.length} lines, {totalUnits} units
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Type: <strong>{orderType}</strong> · Priority: <strong>{priority}</strong>
            </div>
            {hasOverAtp && (
              <div style={{ color: 'var(--accent-danger)', fontSize: '13px', marginTop: '8px', fontWeight: 700 }}>
                ⚠ Some lines exceed available stock (ATP). Reduce quantity before submitting.
              </div>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            data-testid="order-submit"
            disabled={lines.length === 0 || hasOverAtp || isSubmitting}
            style={{ minWidth: '180px', height: '44px' }}
          >
            {isSubmitting ? 'Reserving...' : 'Submit Order'}
          </button>
        </div>
      </form>
    </div>
  );
};
