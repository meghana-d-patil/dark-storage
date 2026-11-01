import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../api/client.js';
import { OrderDto } from '@dark-storage/shared';

interface OrderLineItem {
  sku: string;
  name: string;
  qty: number;
}

export const NewOrderPage: React.FC = () => {
  const navigate = useNavigate();

  const [orderType, setOrderType] = useState('CUSTOMER');
  const [priority, setPriority] = useState('NORMAL');
  const [customerRef, setCustomerRef] = useState('');
  const [notes, setNotes] = useState('');

  const [lines, setLines] = useState<OrderLineItem[]>([]);
  const [selectedSku, setSelectedSku] = useState('');
  const [itemQty, setItemQty] = useState(1);
  const [itemError, setItemError] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [shortages, setShortages] = useState<Array<{ sku: string; product_name: string; requested: number; available: number }> | null>(null);
  const [generalError, setGeneralError] = useState('');

  // Fetch Inventory Summary with ATP numbers (refreshed every 15s)
  const { data: inventoryData } = useQuery<{ items: any[] }>({
    queryKey: ['inventory-summary-atp'],
    queryFn: () => apiFetch('/api/inventory/summary?page_size=100'),
    refetchInterval: 15000
  });

  const productsWithAtp = inventoryData?.items || [];
  const selectedProduct = productsWithAtp.find((p) => p.sku === selectedSku);

  const handleAddLine = () => {
    setItemError('');
    if (!selectedSku) {
      setItemError('Please select a product');
      return;
    }
    if (lines.some((l) => l.sku === selectedSku)) {
      setItemError('Already in the order — edit its quantity');
      return;
    }
    if (!Number.isInteger(itemQty) || itemQty < 1) {
      setItemError('Quantity must be an integer >= 1');
      return;
    }

    setLines([
      ...lines,
      {
        sku: selectedSku,
        name: selectedProduct?.product_name || selectedSku,
        qty: itemQty
      }
    ]);
    setSelectedSku('');
    setItemQty(1);
  };

  const handleRemoveLine = (sku: string) => {
    setLines(lines.filter((l) => l.sku !== sku));
  };

  const handleUpdateQty = (sku: string, newQty: number) => {
    setLines(lines.map((l) => (l.sku === sku ? { ...l, qty: newQty } : l)));
  };

  // Check if any line exceeds ATP
  const linesWithAtp = lines.map((l) => {
    const prod = productsWithAtp.find((p) => p.sku === l.sku);
    const atp = prod?.available_to_promise ?? 0;
    const isOver = l.qty > atp;
    return { ...l, atp, isOver };
  });

  const hasOverAtp = linesWithAtp.some((l) => l.isOver);
  const totalUnits = lines.reduce((acc, l) => acc + l.qty, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lines.length === 0 || hasOverAtp || isSubmitting) return;

    setIsSubmitting(true);
    setStatusMessage('');
    setShortages(null);
    setGeneralError('');

    const idemKey = `order-${Date.now()}-${crypto.randomUUID()}`;

    try {
      const payload = {
        order_type: orderType,
        priority,
        customer_ref: customerRef.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({ sku: l.sku, qty: l.qty }))
      };

      const res = await apiFetch<OrderDto | { task_id: string; status: string }>('/api/orders', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idemKey
        },
        body: JSON.stringify(payload)
      });

      // If 202 async task
      if ('task_id' in res) {
        setStatusMessage('Queued → Executing reservation in Engine 1...');
        const taskId = res.task_id;
        const start = Date.now();
        let finalOrder: OrderDto | null = null;

        while (Date.now() - start < 60000) {
          await new Promise((r) => setTimeout(r, 1000));
          const taskRes = await apiFetch<any>(`/api/tasks/${taskId}`);
          if (taskRes.status === 'SUCCEEDED') {
            finalOrder = taskRes.result as OrderDto;
            break;
          }
          if (taskRes.status === 'FAILED') {
            throw new ApiError(
              taskRes.error?.code || 'TASK_FAILED',
              taskRes.error?.message || 'Order creation failed',
              taskRes.error?.details
            );
          }
        }

        if (finalOrder) {
          navigate(`/orders/${finalOrder.ref}`, {
            state: { banner: `${finalOrder.ref} created — stock reserved` }
          });
          return;
        } else {
          setGeneralError('Order is still executing in background. Please check the Tasks tab.');
          setIsSubmitting(false);
          return;
        }
      }

      // Normal 201 response
      navigate(`/orders/${res.ref}`, {
        state: { banner: `${res.ref} created — stock reserved` }
      });
    } catch (err: any) {
      setIsSubmitting(false);
      setStatusMessage('');

      if (err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK' && err.details?.shortages) {
        setShortages(err.details.shortages as any);
      } else {
        setGeneralError(err.message || 'Failed to create order');
      }
    }
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <button className="btn btn-secondary" onClick={() => navigate('/orders')} style={{ marginBottom: '0.5rem' }}>
            ← Back to Orders
          </button>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600 }}>Create New Outbound Order</h1>
        </div>
      </div>

      {generalError && (
        <div className="banner banner-error" style={{ padding: '1rem', borderRadius: '8px' }}>
          {generalError}
        </div>
      )}

      {/* Shortage Table on 409 INSUFFICIENT_STOCK */}
      {shortages && (
        <div
          data-testid="order-shortage-table"
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid var(--color-danger)',
            padding: '1.25rem',
            borderRadius: '8px'
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem', color: 'var(--color-danger)' }}>Insufficient Stock (ATP)</h3>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem' }}>
            The order cannot be reserved because available-to-promise stock is insufficient for the following line(s):
          </p>
          <table className="table" style={{ background: 'var(--color-bg-card)', borderRadius: '6px' }}>
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
                    <strong>{s.product_name}</strong> · {s.sku}
                  </td>
                  <td style={{ color: 'var(--color-danger)', fontWeight: 600 }}>{s.requested}</td>
                  <td style={{ color: 'var(--color-success)', fontWeight: 600 }}>{s.available}</td>
                  <td style={{ color: 'var(--color-danger)' }}>{s.requested - s.available} short</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {statusMessage && (
        <div className="banner banner-info" style={{ padding: '1rem', borderRadius: '8px' }}>
          {statusMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Header fields */}
        <div style={{ background: 'var(--color-bg-card)', padding: '1.25rem', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>Order Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Order Type</label>
              <select
                className="form-control"
                data-testid="order-type"
                value={orderType}
                onChange={(e) => setOrderType(e.target.value)}
              >
                <option value="CUSTOMER">CUSTOMER</option>
                <option value="TRANSFER">TRANSFER</option>
                <option value="PRODUCTION">PRODUCTION</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Priority</label>
              <select
                className="form-control"
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

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Customer / Reference</label>
              <input
                type="text"
                className="form-control"
                data-testid="order-customer"
                placeholder="e.g. Acme Retail"
                value={customerRef}
                onChange={(e) => setCustomerRef(e.target.value)}
              />
            </div>
          </div>

          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Notes</label>
            <input
              type="text"
              className="form-control"
              placeholder="e.g. Deliver before Friday 5pm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        {/* Add item section */}
        <div style={{ background: 'var(--color-bg-card)', padding: '1.25rem', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>Add Order Line</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px auto', gap: '1rem', alignItems: 'flex-end' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Product</label>
              <select
                className="form-control"
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

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                Quantity {selectedProduct && <span style={{ color: 'var(--color-text-secondary)' }}>(max {selectedProduct.available_to_promise})</span>}
              </label>
              <input
                type="number"
                min="1"
                className="form-control"
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
              style={{ height: '38px' }}
            >
              + Add Item
            </button>
          </div>

          {/* ATP Chips */}
          {selectedProduct && (
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
              <span className="badge badge-secondary" style={{ padding: '0.4rem 0.6rem' }}>
                Stored: {selectedProduct.stored_qty}
              </span>
              <span className="badge badge-warning" style={{ padding: '0.4rem 0.6rem' }}>
                Reserved: {selectedProduct.reserved_qty}
              </span>
              <span
                className={`badge badge-${selectedProduct.available_to_promise > 0 ? 'success' : 'danger'}`}
                style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}
              >
                Available (ATP): {selectedProduct.available_to_promise}
              </span>
            </div>
          )}

          {itemError && (
            <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{itemError}</p>
          )}
        </div>

        {/* Lines table */}
        <div style={{ background: 'var(--color-bg-card)', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Order Lines ({lines.length})</h3>
          </div>

          {lines.length === 0 ? (
            <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-secondary)', margin: 0 }}>
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
                  <tr key={l.sku} style={{ background: l.isOver ? 'rgba(239, 68, 68, 0.08)' : undefined }}>
                    <td>
                      <strong>{l.name}</strong> · {l.sku}
                    </td>
                    <td>
                      <span className={`badge badge-${l.atp >= l.qty ? 'success' : 'danger'}`}>
                        {l.atp}
                      </span>
                    </td>
                    <td style={{ width: '140px' }}>
                      <input
                        type="number"
                        min="1"
                        className="form-control"
                        value={l.qty}
                        onChange={(e) => handleUpdateQty(l.sku, parseInt(e.target.value, 10) || 1)}
                        style={{ borderColor: l.isOver ? 'var(--color-danger)' : undefined }}
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
        <div style={{ background: 'var(--color-bg-card)', padding: '1.25rem', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
              Total: {lines.length} lines, {totalUnits} units
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
              Type: {orderType} · Priority: {priority}
            </div>
            {hasOverAtp && (
              <div style={{ color: 'var(--color-danger)', fontSize: '0.875rem', marginTop: '0.5rem', fontWeight: 600 }}>
                ⚠ Some lines exceed available stock (ATP). Reduce quantity before submitting.
              </div>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            data-testid="order-submit"
            disabled={lines.length === 0 || hasOverAtp || isSubmitting}
            style={{ minWidth: '180px', height: '42px', fontSize: '1rem' }}
          >
            {isSubmitting ? 'Reserving...' : 'Submit Order'}
          </button>
        </div>
      </form>
    </div>
  );
};
