import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Icon from './Icons';

// Lazy tree: Custom Resources → group → kind (CRD) → instance
export default function CustomResourceTree({ selection, onSelect }) {
  const [open, setOpen] = useState(false);
  const [crds, setCrds] = useState(null);   // null = not loaded
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [openGroups, setOpenGroups] = useState({});
  const [openKinds, setOpenKinds] = useState({});   // key: crd.name
  const [instances, setInstances] = useState({});    // key: crd.name -> { loading, items, error }

  const loadCrds = async () => {
    if (crds || loading) return;
    setLoading(true);
    try {
      const res = await axios.get('/api/customresources');
      setCrds(res.data.crds || []);
      setError(null);
    } catch (e) {
      setError('Failed to load CRDs');
    } finally {
      setLoading(false);
    }
  };

  const toggleRoot = () => {
    const next = !open;
    setOpen(next);
    if (next) loadCrds();
  };

  const loadInstances = async (crd) => {
    if (instances[crd.name]?.items || instances[crd.name]?.loading) return;
    setInstances(prev => ({ ...prev, [crd.name]: { loading: true } }));
    try {
      const res = await axios.get(`/api/customresources/${crd.group}/${crd.version}/${crd.plural}`);
      setInstances(prev => ({ ...prev, [crd.name]: { loading: false, items: res.data.items || [], error: res.data.error } }));
    } catch (e) {
      setInstances(prev => ({ ...prev, [crd.name]: { loading: false, items: [], error: e.message } }));
    }
  };

  const toggleGroup = (g) => setOpenGroups(prev => ({ ...prev, [g]: !prev[g] }));

  const toggleKind = (crd) => {
    const willOpen = !openKinds[crd.name];
    setOpenKinds(prev => ({ ...prev, [crd.name]: willOpen }));
    if (willOpen) loadInstances(crd);
  };

  // group CRDs by API group
  const groups = React.useMemo(() => {
    if (!crds) return [];
    const map = {};
    crds.forEach(c => { (map[c.group] = map[c.group] || []).push(c); });
    return Object.keys(map).sort().map(g => ({
      group: g,
      kinds: map[g].sort((a, b) => (a.kind || '').localeCompare(b.kind || ''))
    }));
  }, [crds]);

  const isSelected = (crd, instName, instNs) =>
    selection &&
    selection.plural === crd.plural &&
    selection.group === crd.group &&
    (instName ? (selection.name === instName && selection.namespace === instNs) : selection.level === 'kind' && !selection.name);

  return (
    <div className="crtree">
      <div className={`nav-item simple ${open ? 'expanded' : ''}`} onClick={toggleRoot}>
        <span className={`nav-section-chevron ${open ? 'open' : ''}`}>
          <Icon name="chevronRight" size={13} strokeWidth={2.2} />
        </span>
        <Icon name="customResources" size={16} className="nav-lead-icon" />
        Custom Resources
      </div>

      {open && (
        <div className="crtree-body">
          {loading && <div className="crtree-msg">Loading CRDs…</div>}
          {error && <div className="crtree-msg err">{error}</div>}
          {crds && groups.map(({ group, kinds }) => (
            <div key={group} className="crtree-group">
              <div className="crtree-row lvl1" onClick={() => toggleGroup(group)} title={group}>
                <span className={`nav-section-chevron ${openGroups[group] ? 'open' : ''}`}>
                  <Icon name="chevronRight" size={12} strokeWidth={2.2} />
                </span>
                <span className="crtree-label">{group}</span>
                <span className="crtree-count">{kinds.length}</span>
              </div>

              {openGroups[group] && kinds.map(crd => {
                const inst = instances[crd.name];
                return (
                  <div key={crd.name} className="crtree-kind">
                    <div className={`crtree-row lvl2 ${isSelected(crd) ? 'active' : ''}`} title={crd.kind}>
                      <span
                        className={`nav-section-chevron ${openKinds[crd.name] ? 'open' : ''}`}
                        onClick={(e) => { e.stopPropagation(); toggleKind(crd); }}
                      >
                        <Icon name="chevronRight" size={12} strokeWidth={2.2} />
                      </span>
                      <span
                        className="crtree-label"
                        onClick={() => onSelect({ level: 'kind', ...crd })}
                      >
                        {crd.kind}
                      </span>
                    </div>

                    {openKinds[crd.name] && (
                      <div className="crtree-instances">
                        {inst?.loading && <div className="crtree-msg lvl3">Loading…</div>}
                        {inst?.error && <div className="crtree-msg lvl3 err">error</div>}
                        {inst && !inst.loading && (inst.items || []).length === 0 && (
                          <div className="crtree-msg lvl3">no instances</div>
                        )}
                        {(inst?.items || []).map((it, i) => (
                          <div
                            key={`${it.namespace}/${it.name}-${i}`}
                            className={`crtree-row lvl3 leaf ${isSelected(crd, it.name, it.namespace) ? 'active' : ''}`}
                            title={`${it.name}${it.namespace && it.namespace !== '-' ? ` (${it.namespace})` : ''}`}
                            onClick={() => onSelect({ level: 'instance', ...crd, name: it.name, namespace: it.namespace })}
                          >
                            <span className="crtree-dot" />
                            <span className="crtree-label">{it.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
