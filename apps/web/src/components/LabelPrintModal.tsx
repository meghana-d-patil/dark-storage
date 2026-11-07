import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { BarcodeSvg } from './BarcodeSvg.js';
import { WarehouseLayoutResponse } from '../hooks/useWarehouseData.js';

export type LabelTab = 'receipt' | 'bin' | 'sku';
export type LabelPreset = '50x25' | '100x50';

export interface LabelPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: LabelTab;
  initialValue?: string;
}

interface ProductItem {
  sku: string;
  name: string;
}

interface ReceiptItem {
  ref: string;
  supplier?: string;
}

export const LabelPrintModal: React.FC<LabelPrintModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'sku',
  initialValue = ''
}) => {
  const [tab, setTab] = useState<LabelTab>(initialTab);
  const [value, setValue] = useState<string>(initialValue);
  const [preset, setPreset] = useState<LabelPreset>('50x25');
  const [copies, setCopies] = useState<number>(1);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setValue(initialValue || '');
      setCopied(false);
    }
  }, [isOpen, initialTab, initialValue]);

  // Fetch receipts data
  const { data: receiptsData } = useQuery<{ receipts: ReceiptItem[] }>({
    queryKey: ['receipts'],
    queryFn: () => apiFetch('/api/receipts'),
    enabled: isOpen && tab === 'receipt'
  });

  // Fetch layout for bin codes
  const { data: layoutData } = useQuery<WarehouseLayoutResponse>({
    queryKey: ['warehouse', 'layout'],
    queryFn: () => apiFetch('/api/warehouse/layout'),
    enabled: isOpen && tab === 'bin'
  });

  // Fetch products for SKUs
  const { data: productsData } = useQuery<{ products: ProductItem[] }>({
    queryKey: ['products'],
    queryFn: () => apiFetch('/api/products'),
    enabled: isOpen && tab === 'sku'
  });

  // Flatten bins from layout
  const allBins = React.useMemo(() => {
    if (!layoutData?.aisles) return [];
    const list: string[] = [];
    for (const aisle of layoutData.aisles) {
      for (const shelf of aisle.shelves) {
        for (const bin of shelf.bins) {
          list.push(bin.code);
        }
      }
    }
    return list.sort();
  }, [layoutData]);

  // Handle default selection when tab changes if empty
  useEffect(() => {
    if (!value) {
      if (tab === 'receipt' && receiptsData?.receipts?.length) {
        setValue(receiptsData.receipts[0].ref);
      } else if (tab === 'bin' && allBins.length) {
        setValue(allBins[0]);
      } else if (tab === 'sku' && productsData?.products?.length) {
        setValue(productsData.products[0].sku);
      }
    }
  }, [tab, value, receiptsData, allBins, productsData]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const moduleWidth = preset === '50x25' ? 1.4 : 2.2;
  const barHeight = preset === '50x25' ? 36 : 64;

  const labelCategory =
    tab === 'receipt' ? 'RECEIPT' : tab === 'bin' ? 'LOCATION' : 'SKU ITEM';

  return (
    <>
      {/* Modal Dialog */}
      <div
        className="modal-backdrop"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(2px)'
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="modal-card"
          data-testid="label-modal"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg, 12px)',
            width: '90%',
            maxWidth: '560px',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '24px',
            boxShadow: 'var(--shadow-lg)'
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid var(--border-color)',
              paddingBottom: '14px',
              marginBottom: '20px'
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
                🏷️ Print Barcode Labels
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Code 128 Subset B scannable labels for receipts, warehouse bins, and SKUs.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClose}
              style={{ fontSize: '14px', padding: '4px 8px' }}
            >
              ✕
            </button>
          </div>

          {/* Tab Selector */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
              marginBottom: '20px',
              backgroundColor: 'var(--bg-surface-elevated, var(--bg-surface))',
              padding: '4px',
              borderRadius: 'var(--radius-md, 8px)',
              border: '1px solid var(--border-color)'
            }}
          >
            <button
              type="button"
              data-testid="label-tab-receipt"
              onClick={() => {
                setTab('receipt');
                setValue('');
              }}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: 'none',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                backgroundColor: tab === 'receipt' ? 'var(--accent-primary)' : 'transparent',
                color: tab === 'receipt' ? '#ffffff' : 'var(--text-secondary)'
              }}
            >
              Receipt
            </button>
            <button
              type="button"
              data-testid="label-tab-bin"
              onClick={() => {
                setTab('bin');
                setValue('');
              }}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: 'none',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                backgroundColor: tab === 'bin' ? 'var(--accent-primary)' : 'transparent',
                color: tab === 'bin' ? '#ffffff' : 'var(--text-secondary)'
              }}
            >
              Bin Location
            </button>
            <button
              type="button"
              data-testid="label-tab-sku"
              onClick={() => {
                setTab('sku');
                setValue('');
              }}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: 'none',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                backgroundColor: tab === 'sku' ? 'var(--accent-primary)' : 'transparent',
                color: tab === 'sku' ? '#ffffff' : 'var(--text-secondary)'
              }}
            >
              SKU
            </button>
          </div>

          {/* Selection & Input Form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                  marginBottom: '6px'
                }}
              >
                Select {tab.toUpperCase()} or Enter Custom Code:
              </label>

              {tab === 'receipt' && receiptsData?.receipts?.length ? (
                <select
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    marginBottom: '8px',
                    fontSize: '13px'
                  }}
                >
                  <option value="">-- Choose from existing receipts --</option>
                  {receiptsData.receipts.map((r) => (
                    <option key={r.ref} value={r.ref}>
                      {r.ref} {r.supplier ? `(${r.supplier})` : ''}
                    </option>
                  ))}
                </select>
              ) : null}

              {tab === 'bin' && allBins.length ? (
                <select
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    marginBottom: '8px',
                    fontSize: '13px'
                  }}
                >
                  <option value="">-- Choose from warehouse bins --</option>
                  {allBins.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              ) : null}

              {tab === 'sku' && productsData?.products?.length ? (
                <select
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    marginBottom: '8px',
                    fontSize: '13px'
                  }}
                >
                  <option value="">-- Choose from catalog SKUs --</option>
                  {productsData.products.map((p) => (
                    <option key={p.sku} value={p.sku}>
                      {p.sku} · {p.name}
                    </option>
                  ))}
                </select>
              ) : null}

              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder={
                    tab === 'receipt'
                      ? 'e.g. RCV-0001'
                      : tab === 'bin'
                      ? 'e.g. A-01-L-1'
                      : 'e.g. SKU001'
                  }
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px'
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleCopy}
                  title="Copy value for pasting into scan inputs"
                  style={{ minWidth: '85px' }}
                >
                  {copied ? '✓ Copied!' : '📋 Copy'}
                </button>
              </div>
            </div>

            {/* Presets & Quantity Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    marginBottom: '6px'
                  }}
                >
                  Label Size Preset:
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setPreset('50x25')}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: '1px solid var(--border-color)',
                      backgroundColor: preset === '50x25' ? 'var(--accent-primary)' : 'var(--bg-surface)',
                      color: preset === '50x25' ? '#fff' : 'var(--text-secondary)'
                    }}
                  >
                    50 × 25 mm
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreset('100x50')}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: '1px solid var(--border-color)',
                      backgroundColor: preset === '100x50' ? 'var(--accent-primary)' : 'var(--bg-surface)',
                      color: preset === '100x50' ? '#fff' : 'var(--text-secondary)'
                    }}
                  >
                    100 × 50 mm
                  </button>
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    marginBottom: '6px'
                  }}
                >
                  Copies:
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)))}
                  style={{
                    width: '100%',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    fontSize: '13px'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Live Preview Section */}
          <div
            style={{
              padding: '16px',
              backgroundColor: 'var(--bg-surface-elevated, #f8fafc)',
              border: '1px dashed var(--border-color)',
              borderRadius: '8px',
              textAlign: 'center',
              marginBottom: '20px'
            }}
          >
            <span
              style={{
                display: 'block',
                fontSize: '11px',
                color: 'var(--text-muted)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: '10px'
              }}
            >
              Live Label Preview ({preset === '50x25' ? '50×25mm' : '100×50mm'})
            </span>

            {value ? (
              <div style={{ display: 'inline-block' }}>
                <BarcodeSvg
                  value={value}
                  label={labelCategory}
                  moduleWidth={moduleWidth}
                  barHeight={barHeight}
                />
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '1rem' }}>
                Enter or select a code to preview barcode.
              </div>
            )}
          </div>

          {/* Modal Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="label-print-btn"
              onClick={handlePrint}
              disabled={!value}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              🖨️ Print Label{copies > 1 ? `s (${copies})` : ''}
            </button>
          </div>
        </div>
      </div>

      {/* Printable Sheet (visible only during window.print()) */}
      <div className="printable-labels-sheet" aria-hidden="true">
        {Array.from({ length: copies }, (_, index) => (
          <div
            key={index}
            className={`printable-label-item label-${preset}`}
            style={{
              width: preset === '50x25' ? '50mm' : '100mm',
              height: preset === '50x25' ? '25mm' : '50mm',
              padding: '2mm',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #ccc',
              boxSizing: 'border-box',
              pageBreakInside: 'avoid',
              breakInside: 'avoid',
              marginBottom: '4mm'
            }}
          >
            {value && (
              <BarcodeSvg
                value={value}
                label={labelCategory}
                moduleWidth={moduleWidth}
                barHeight={barHeight}
                style={{
                  boxShadow: 'none',
                  border: 'none',
                  padding: 0
                }}
              />
            )}
          </div>
        ))}
      </div>
    </>
  );
};
