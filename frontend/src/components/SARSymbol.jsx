import * as React from 'react';
import { assetUrl } from '../utils/assetUrl';

/**
 * Saudi Riyal Symbol Component
 * Uses the official SAR symbol PNG image
 */
function SARSymbol({ size = 16, className = '', style = {} }) {
  return (
    <img
      src={assetUrl('Saudi_Riyal_Symbol.png')}
      alt="SAR"
      className={`sar-symbol-inline ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        display: 'inline-block',
        verticalAlign: 'middle',
        objectFit: 'contain',
        ...style
      }}
      aria-label="Saudi Riyal"
    />
  );
}

export default SARSymbol;

