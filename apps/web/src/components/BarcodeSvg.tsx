import React, { useMemo } from 'react';
import { encodeCode128B, generateBarcodeSvgPath } from '../lib/code128.js';

export interface BarcodeSvgProps {
  value: string;
  label?: string;
  moduleWidth?: number;
  barHeight?: number;
  showText?: boolean;
  quietZone?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const BarcodeSvg: React.FC<BarcodeSvgProps> = ({
  value,
  label,
  moduleWidth = 2,
  barHeight = 48,
  showText = true,
  quietZone = 10,
  className = '',
  style = {}
}) => {
  const result = useMemo(() => {
    if (!value || typeof value !== 'string') {
      return null;
    }
    try {
      const encoding = encodeCode128B(value.trim());
      const pathRes = generateBarcodeSvgPath(
        encoding.symbols,
        moduleWidth,
        barHeight,
        quietZone
      );
      return {
        ...encoding,
        ...pathRes
      };
    } catch (err) {
      console.warn('[BarcodeSvg] Error encoding Code 128:', err);
      return null;
    }
  }, [value, moduleWidth, barHeight, quietZone]);

  if (!result) {
    return (
      <div
        className={`barcode-container barcode-error ${className}`}
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '8px 12px',
          backgroundColor: '#fff',
          border: '1px dashed var(--accent-danger, #ef4444)',
          borderRadius: '4px',
          ...style
        }}
      >
        <span style={{ fontSize: '12px', color: 'var(--accent-danger, #ef4444)', fontWeight: 600 }}>
          Invalid Barcode Value
        </span>
      </div>
    );
  }

  const svgHeight = showText ? result.totalHeight + 20 : result.totalHeight;

  return (
    <div
      className={`barcode-container ${className}`}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        padding: '10px 14px',
        borderRadius: '6px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
        ...style
      }}
      title={`Code 128: ${value}`}
    >
      {label && (
        <span
          style={{
            fontSize: '10px',
            color: '#475569',
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: '4px'
          }}
        >
          {label}
        </span>
      )}

      <svg
        data-testid="barcode-svg"
        width={result.totalWidth}
        height={svgHeight}
        viewBox={`0 0 ${result.totalWidth} ${svgHeight}`}
        style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Single path for all bars */}
        <path d={result.pathData} fill="#000000" />

        {/* Human-readable text below bars */}
        {showText && (
          <text
            x={result.totalWidth / 2}
            y={result.totalHeight + 15}
            textAnchor="middle"
            fill="#000000"
            fontFamily="var(--font-mono, monospace)"
            fontSize="13"
            fontWeight="700"
            letterSpacing="0.08em"
          >
            {value}
          </text>
        )}
      </svg>
    </div>
  );
};
