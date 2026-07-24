import React, { useState, useRef, useEffect } from 'react';

export default function NamespaceMultiSelect({ namespaces = [], selected = ['all'], onChange }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const realNamespaces = namespaces.filter(ns => ns !== 'all');
  const isAllSelected = selected.includes('all');

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleAll = () => {
    onChange(['all']);
  };

  const toggleNamespace = (ns) => {
    let next;
    if (isAllSelected) {
      next = [ns];
    } else if (selected.includes(ns)) {
      next = selected.filter(n => n !== ns);
    } else {
      next = [...selected, ns];
    }
    if (next.length === 0 || next.length === realNamespaces.length) {
      next = ['all'];
    }
    onChange(next);
  };

  const removeTag = (ns, e) => {
    e.stopPropagation();
    const next = selected.filter(n => n !== ns);
    onChange(next.length === 0 ? ['all'] : next);
  };

  const summaryLabel = () => {
    if (isAllSelected) return 'All namespaces';
    if (selected.length === 1) return selected[0];
    return `${selected.length} namespaces`;
  };

  return (
    <div className="namespace-multi-select" ref={containerRef}>
      <div className="namespace-multi-select-trigger" onClick={() => setOpen(!open)}>
        {isAllSelected || selected.length > 2 ? (
          <span className="namespace-multi-select-label">{summaryLabel()}</span>
        ) : (
          <div className="namespace-tags">
            {selected.map(ns => (
              <span key={ns} className="namespace-tag">
                {ns}
                <span className="namespace-tag-remove" onClick={(e) => removeTag(ns, e)}>×</span>
              </span>
            ))}
          </div>
        )}
        <span className="namespace-multi-select-arrow">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="namespace-multi-select-dropdown">
          <label className="namespace-option">
            <input type="checkbox" checked={isAllSelected} onChange={toggleAll} />
            All namespaces
          </label>
          <div className="namespace-option-divider" />
          {realNamespaces.map(ns => (
            <label key={ns} className="namespace-option">
              <input
                type="checkbox"
                checked={isAllSelected || selected.includes(ns)}
                onChange={() => toggleNamespace(ns)}
              />
              {ns}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
