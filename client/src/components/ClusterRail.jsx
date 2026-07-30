import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icons';

// A narrow far-left rail of pinned clusters (contexts) for quick switching.
// Pins are stored in localStorage; clicking one switches the active context.

const STORE_KEY = 'pinnedClusters';

const loadPins = () => {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY)); return Array.isArray(v) ? v : []; } catch { return []; }
};
const savePins = (pins) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(pins)); } catch { /* ignore */ } };

// Deterministic hue from the context name, for the avatar color.
const hueOf = (name) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
};
const initials = (name) => {
  const parts = String(name).split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(name).replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
};

export default function ClusterRail({ contexts = [], currentContext, onSwitch }) {
  const [pins, setPins] = useState(loadPins);
  const [adding, setAdding] = useState(false);
  const addRef = useRef(null);

  // Seed with the active context so the rail is never empty on first use.
  useEffect(() => {
    if (currentContext && pins.length === 0) {
      const next = [currentContext];
      setPins(next); savePins(next);
    }
  }, [currentContext]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onDown = (e) => { if (addRef.current && !addRef.current.contains(e.target)) setAdding(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Only show pins that still exist in the kubeconfig.
  const known = new Set(contexts);
  const visiblePins = pins.filter((p) => known.has(p) || p === currentContext);
  const unpinned = contexts.filter((c) => !pins.includes(c));

  const update = (next) => { setPins(next); savePins(next); };
  const pin = (ctx) => { if (!pins.includes(ctx)) update([...pins, ctx]); setAdding(false); onSwitch(ctx); };
  const unpin = (ctx, e) => { e.stopPropagation(); update(pins.filter((p) => p !== ctx)); };

  return (
    <div className="cluster-rail">
      <div className="cluster-rail-label" title="Pinned clusters">PINS</div>

      <div className="cluster-rail-pins">
        {visiblePins.map((ctx) => {
          const active = ctx === currentContext;
          return (
            <button
              key={ctx}
              className={`cluster-pin ${active ? 'active' : ''}`}
              title={ctx}
              onClick={() => onSwitch(ctx)}
              style={{ '--pin-hue': hueOf(ctx) }}
            >
              <span className="cluster-pin-badge">{initials(ctx)}</span>
              {!active && (
                <span className="cluster-pin-remove" title="Unpin" onClick={(e) => unpin(ctx, e)}>
                  <Icon name="close" size={10} strokeWidth={2.6} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="cluster-add-wrap" ref={addRef}>
        <button className="cluster-add" title="Pin a cluster" onClick={() => setAdding((a) => !a)}>
          <Icon name="plus" size={18} strokeWidth={2.2} />
        </button>
        {adding && (
          <div className="cluster-add-menu">
            <div className="cluster-add-title">Pin a cluster</div>
            {unpinned.length === 0 ? (
              <div className="cluster-add-empty">All contexts are pinned.</div>
            ) : (
              unpinned.map((ctx) => (
                <button key={ctx} className="cluster-add-option" title={ctx} onClick={() => pin(ctx)}>
                  <span className="cluster-add-dot" style={{ '--pin-hue': hueOf(ctx) }}>{initials(ctx)}</span>
                  <span className="cluster-add-name">{ctx}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
