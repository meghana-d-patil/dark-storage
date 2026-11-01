import React from 'react';

interface ProductLabelProps {
  sku: string;
  name: string;
  className?: string;
}

export const ProductLabel: React.FC<ProductLabelProps> = ({ sku, name, className = '' }) => {
  return (
    <span className={`product-label ${className}`}>
      <span className="product-name">{name}</span>
      <span className="product-separator">·</span>
      <span className="product-sku">{sku}</span>
    </span>
  );
};
