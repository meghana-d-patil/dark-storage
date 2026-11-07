import React, { useMemo } from 'react';

interface BarcodeSvgProps {
  value: string;
  label?: string;
  width?: number;
  height?: number;
}

export const BarcodeSvg: React.FC<BarcodeSvgProps> = ({
  value,
  label,
  width = 170,
  height = 36
}) => {
  // Generate deterministic Code 128 / Code 39 pseudo barcode pattern
  const bars = useMemo(() => {
    const pattern: number[] = [2, 1, 1, 2]; // start quiet & guard
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      pattern.push(
        (c % 3) + 1,
        ((c >> 1) % 2) + 1,
        ((c >> 2) % 3) + 1,
        ((c >> 3) % 2) + 1
      );
    }
    pattern.push(2, 1, 2, 2); // stop guard
    return pattern;
  }, [value]);

  const totalWidthUnits = bars.reduce((a, b) => a + b, 0);
  let currentX = 0;

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        padding: '6px 12px',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
        border: '1px solid rgba(255, 255, 255, 0.4)'
      }}
      title={`Barcode: ${value}`}
    >
      {label && (
        <span
          style={{
            fontSize: '9px',
            color: '#475569',
            fontWeight: 800,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            marginBottom: '3px'
          }}
        >
          {label}
        </span>
      )}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${totalWidthUnits * 2} 40`}
        style={{ display: 'block' }}
      >
        {bars.map((barWidth, idx) => {
          const x = currentX;
          currentX += barWidth * 2;
          if (idx % 2 === 0) {
            return (
              <rect
                key={idx}
                x={x}
                y={0}
                width={barWidth * 1.9}
                height={40}
                fill="#0f172a"
              />
            );
          }
          return null;
        })}
      </svg>
      <span
        style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '11px',
          fontWeight: 700,
          color: '#0f172a',
          marginTop: '3px',
          letterSpacing: '0.12em'
        }}
      >
        *{value}*
      </span>
    </div>
  );
};
