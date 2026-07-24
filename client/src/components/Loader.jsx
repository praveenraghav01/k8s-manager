import React from 'react';

export default function Loader({ label = 'Loading…', size = 30, inline = false, style }) {
  return (
    <div className={`loader ${inline ? 'inline' : ''}`} style={style}>
      <span className="loader-spinner" style={{ width: size, height: size }} />
      {label && <span className="loader-label">{label}</span>}
    </div>
  );
}
