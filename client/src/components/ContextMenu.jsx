import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icons';

export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [expanded, setExpanded] = useState(null);

  // Re-measure after expansion so the menu stays on screen
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8) {
      setPos(p => ({ ...p, top: Math.max(8, window.innerHeight - rect.height - 8) }));
    }
  }, [expanded]);

  useEffect(() => {
    // Keep menu within the viewport
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = y - rect.height;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  useEffect(() => {
    const handleDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div className="context-menu" ref={ref} style={{ left: pos.left, top: pos.top }}>
      {items.map((item, i) => {
        if (item.divider) return <div key={i} className="context-menu-divider" />;

        // Expandable item with a submenu (e.g. Logs -> container names)
        if (item.children && item.children.length) {
          const isOpen = expanded === i;
          return (
            <div key={i}>
              <button
                className="context-menu-item"
                onClick={() => setExpanded(isOpen ? null : i)}
              >
                {item.icon && <Icon name={item.icon} size={15} />}
                {item.label}
                <span className="context-menu-caret">
                  <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12} strokeWidth={2.2} />
                </span>
              </button>
              {isOpen && (
                <div className="context-menu-sub">
                  {item.children.map((ch, j) => (
                    <button
                      key={j}
                      className="context-menu-item sub"
                      onClick={() => { ch.onClick(); onClose(); }}
                    >
                      {ch.icon && <Icon name={ch.icon} size={13} />}
                      {ch.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        }

        return (
          <button
            key={i}
            className={`context-menu-item ${item.danger ? 'danger' : ''}`}
            onClick={() => { item.onClick(); onClose(); }}
          >
            {item.icon && <Icon name={item.icon} size={15} />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
