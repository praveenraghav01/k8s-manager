import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Icon from './Icons';

export default function ServicePortForward({ namespace, name, ports = [] }) {
  const [forwards, setForwards] = useState({}); // remotePort -> { id, localPort }
  const [inputs, setInputs] = useState({});     // remotePort -> string
  const [busy, setBusy] = useState({});         // remotePort -> bool
  const [error, setError] = useState(null);

  useEffect(() => {
    loadActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, name]);

  const loadActive = async () => {
    try {
      const res = await axios.get('/api/portforward');
      const map = {};
      (res.data.forwards || []).forEach(f => {
        if (f.namespace === namespace && f.name === name) map[f.remotePort] = f;
      });
      setForwards(map);
    } catch (e) { /* ignore */ }
  };

  const start = async (remotePort) => {
    setBusy(b => ({ ...b, [remotePort]: true }));
    setError(null);
    try {
      const localPort = inputs[remotePort] ? parseInt(inputs[remotePort], 10) : undefined;
      const res = await axios.post('/api/portforward', { namespace, name, remotePort, localPort });
      setForwards(f => ({ ...f, [remotePort]: res.data }));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(b => ({ ...b, [remotePort]: false }));
    }
  };

  const stop = async (remotePort) => {
    const fwd = forwards[remotePort];
    if (!fwd) return;
    setBusy(b => ({ ...b, [remotePort]: true }));
    try {
      await axios.delete(`/api/portforward/${fwd.id}`);
      setForwards(prev => {
        const next = { ...prev };
        delete next[remotePort];
        return next;
      });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(b => ({ ...b, [remotePort]: false }));
    }
  };

  if (!ports.length) return null;

  return (
    <div className="drawer-section">
      <div className="drawer-section-title">Port Forwarding</div>
      {error && <div className="drawer-error" style={{ padding: '2px 0 8px' }}>{error}</div>}
      {ports.map((p, i) => {
        const rp = p.port;
        const fwd = forwards[rp];
        return (
          <div key={i} className="pf-row">
            <div className="pf-port">
              {rp}
              <span className="drawer-dim">/{p.protocol || 'TCP'}{p.name ? ` · ${p.name}` : ''}</span>
            </div>
            {fwd ? (
              <div className="pf-controls">
                <a
                  className="xlink pf-link"
                  href={`http://localhost:${fwd.localPort}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    window.open(`http://localhost:${fwd.localPort}`, '_blank', 'noopener,noreferrer');
                  }}
                  title={`Open http://localhost:${fwd.localPort} in a new tab`}
                >
                  <Icon name="ingress" size={13} /> localhost:{fwd.localPort}
                </a>
                <button className="pf-btn stop" onClick={() => stop(rp)} disabled={busy[rp]}>
                  {busy[rp] ? '…' : 'Stop'}
                </button>
              </div>
            ) : (
              <div className="pf-controls">
                <input
                  className="pf-input"
                  placeholder="random"
                  value={inputs[rp] || ''}
                  onChange={(e) => setInputs(s => ({ ...s, [rp]: e.target.value.replace(/[^0-9]/g, '') }))}
                  title="Local port (leave blank for a random port)"
                />
                <button className="pf-btn" onClick={() => start(rp)} disabled={busy[rp]}>
                  {busy[rp] ? '…' : 'Forward'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
