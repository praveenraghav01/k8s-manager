import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icons';

// Auto-refresh cadences. `ms: 0` disables the timer. 'auto' is the default (1 min).
export const REFRESH_OPTIONS = [
  { key: 'auto', label: 'Auto', hint: '1 min', ms: 60000 },
  { key: '30s', label: '30 sec', ms: 30000 },
  { key: '1m', label: '1 min', ms: 60000 },
  { key: '5m', label: '5 min', ms: 300000 },
  { key: 'off', label: 'Off', ms: 0 },
];

// Split refresh control ([refresh now | interval ▾]) shown fixed at the top-right.
export default function RefreshControl({ refreshing, onRefresh, refreshInterval = 'auto', onSetRefreshInterval, row2 = false }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const activeOpt = REFRESH_OPTIONS.find((o) => o.key === refreshInterval) || REFRESH_OPTIONS[0];
  const badgeLabel = activeOpt.key === 'off' ? 'Off'
    : activeOpt.key === 'auto' ? '1m'
    : activeOpt.label.replace(' sec', 's').replace(' min', 'm');

  return (
    <div className={`refresh-control floating ${row2 ? 'row2' : ''}`} ref={menuRef}>
      <button
        className={`refresh-toggle ${refreshing ? 'spinning' : ''}`}
        onClick={onRefresh}
        disabled={refreshing}
        title="Refresh this page now"
      >
        <Icon name="refresh" size={16} />
      </button>
      <button
        className={`refresh-caret ${menuOpen ? 'open' : ''} ${activeOpt.key !== 'off' ? 'on' : ''}`}
        onClick={() => setMenuOpen((o) => !o)}
        title={activeOpt.key === 'off' ? 'Auto-refresh: off' : `Auto-refresh every ${activeOpt.key === 'auto' ? '1 min' : activeOpt.label}`}
      >
        <span className="refresh-badge">{badgeLabel}</span>
        <Icon name="chevronDown" size={11} strokeWidth={2.4} />
      </button>
      {menuOpen && (
        <div className="refresh-menu">
          <div className="refresh-menu-title">Auto-refresh</div>
          {REFRESH_OPTIONS.map((o) => (
            <button
              key={o.key}
              className={`refresh-menu-item ${refreshInterval === o.key ? 'active' : ''}`}
              onClick={() => { onSetRefreshInterval?.(o.key); setMenuOpen(false); }}
            >
              <span className="refresh-menu-check">
                {refreshInterval === o.key && <Icon name="check" size={13} strokeWidth={2.6} />}
              </span>
              <span className="refresh-menu-label">{o.label}</span>
              {o.hint && <span className="refresh-menu-hint">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
