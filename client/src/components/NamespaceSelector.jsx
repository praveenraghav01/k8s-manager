import React from 'react';

export default function NamespaceSelector({ namespaces, selectedNamespace, onSelect }) {
  return (
    <div className="namespace-selector">
      <h3>Namespace</h3>
      <div className="namespace-buttons">
        {namespaces.map(ns => (
          <button
            key={ns}
            className={`namespace-btn ${selectedNamespace === ns ? 'active' : ''}`}
            onClick={() => onSelect(ns)}
          >
            {ns}
          </button>
        ))}
      </div>
    </div>
  );
}
