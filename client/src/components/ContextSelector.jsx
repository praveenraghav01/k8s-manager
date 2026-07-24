import React, { useState, useRef, useEffect } from 'react';
import Icon from './Icons';

export default function ContextSelector({ contexts = [], currentContext, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
    else setQuery('');
  }, [open]);

  const filtered = contexts.filter(c => !query || c.toLowerCase().includes(query.toLowerCase()));

  const pick = (ctx) => {
    setOpen(false);
    if (ctx !== currentContext) onChange(ctx);
  };

  return (
    <div className="ctx-select" ref={ref}>
      <button className={`ctx-trigger ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} title={currentContext}>
        <Icon name="cluster" size={15} className="ctx-trigger-icon" />
        <span className="ctx-trigger-label">{currentContext || 'Select context'}</span>
        <span className="ctx-trigger-arrow"><Icon name={open ? 'chevronUp' : 'chevronDown'} size={13} strokeWidth={2.2} /></span>
      </button>

      {open && (
        <div className="ctx-dropdown">
          <div className="ctx-search">
            <Icon name="search" size={14} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search contexts…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="ctx-list">
            {filtered.length === 0 && <div className="ctx-empty">No matches</div>}
            {filtered.map(ctx => (
              <button
                key={ctx}
                className={`ctx-option ${ctx === currentContext ? 'active' : ''}`}
                onClick={() => pick(ctx)}
                title={ctx}
              >
                <span className="ctx-option-check">
                  {ctx === currentContext && <Icon name="check" size={14} strokeWidth={2.4} />}
                </span>
                <span className="ctx-option-label">{ctx}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
