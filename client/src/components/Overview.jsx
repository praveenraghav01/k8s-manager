import React from 'react';
import Icon from './Icons';
import NamespaceMultiSelect from './NamespaceMultiSelect';
import Loader from './Loader';

const COLORS = {
  running: '#3fb950',
  pending: '#d29922',
  failed: '#f85149',
  idle: '#30363d'
};

function Donut({ segments, centerNum, centerLabel }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;

  return (
    <div className="donut">
      <svg width="130" height="130" viewBox="0 0 130 130">
        <circle cx="65" cy="65" r={r} fill="none" stroke={COLORS.idle} strokeWidth="16" />
        {segments.map((seg, i) => {
          if (seg.value <= 0) return null;
          const len = (seg.value / total) * c;
          const dash = `${len} ${c - len}`;
          const el = (
            <circle
              key={i}
              cx="65"
              cy="65"
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth="16"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="donut-center">
        <div>
          <div className="num">{centerNum}</div>
          <div className="lbl">{centerLabel}</div>
        </div>
      </div>
    </div>
  );
}

export default function Overview({
  allResources,
  selectedNamespaces = ['all'],
  namespaces,
  onNamespaceSelect,
  onResourceTypeChange,
  loading
}) {
  const hasData = Object.keys(allResources || {}).length > 0;
  const pods = allResources.pods || [];
  const deployments = allResources.deployments || [];
  const statefulSets = allResources.statefulSets || [];
  const daemonSets = allResources.daemonSets || [];
  const services = allResources.services || [];

  const podHealth = pods.reduce(
    (acc, p) => {
      const s = (p.status || '').toLowerCase();
      if (s === 'running' || s === 'succeeded') acc.running++;
      else if (s === 'pending') acc.pending++;
      else acc.failed++;
      return acc;
    },
    { running: 0, pending: 0, failed: 0 }
  );

  const kpis = [
    { key: 'pod', label: 'Pods', value: pods.length, sub: `${podHealth.running} running`, icon: 'pod', tone: 'blue' },
    { key: 'deployment', label: 'Deployments', value: deployments.length, sub: 'workloads', icon: 'deployment', tone: 'green' },
    { key: 'statefulSet', label: 'StatefulSets', value: statefulSets.length, sub: 'stateful', icon: 'statefulSet', tone: 'purple' },
    { key: 'daemonSet', label: 'DaemonSets', value: daemonSets.length, sub: 'per-node', icon: 'daemonSet', tone: 'cyan' },
    { key: 'service', label: 'Services', value: services.length, sub: 'networking', icon: 'service', tone: 'yellow' }
  ];

  const workloadBars = [
    { label: 'Pods', value: pods.length, icon: 'pod', color: '#58a6ff' },
    { label: 'Deployments', value: deployments.length, icon: 'deployment', color: '#3fb950' },
    { label: 'StatefulSets', value: statefulSets.length, icon: 'statefulSet', color: '#bc8cff' },
    { label: 'DaemonSets', value: daemonSets.length, icon: 'daemonSet', color: '#39c5cf' },
    { label: 'Services', value: services.length, icon: 'service', color: '#d29922' }
  ];
  const maxBar = Math.max(...workloadBars.map(b => b.value), 1);

  const healthSegments = [
    { label: 'Running', value: podHealth.running, color: COLORS.running },
    { label: 'Pending', value: podHealth.pending, color: COLORS.pending },
    { label: 'Failed', value: podHealth.failed, color: COLORS.failed }
  ];

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>
          <Icon name="overview" size={18} />
          Cluster Overview
        </h2>
        <NamespaceMultiSelect
          namespaces={namespaces}
          selected={selectedNamespaces}
          onChange={onNamespaceSelect}
        />
      </div>

      {loading && !hasData ? (
        <Loader label="Loading cluster overview…" />
      ) : (
      <div className="dashboard-body">
        <div className="kpi-row">
          {kpis.map(k => (
            <div key={k.key} className="kpi-card" onClick={() => onResourceTypeChange(k.key)}>
              <div className={`kpi-icon ${k.tone}`}>
                <Icon name={k.icon} size={22} />
              </div>
              <div className="kpi-meta">
                <div className="kpi-value">{k.value}</div>
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-sub">{k.sub}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="chart-grid">
          <div className="chart-card">
            <div className="chart-card-title">
              <h3>Pod Health</h3>
              <span className="total">{pods.length} total</span>
            </div>
            <div className="donut-wrap">
              <Donut
                segments={healthSegments}
                centerNum={pods.length ? Math.round((podHealth.running / pods.length) * 100) + '%' : '0%'}
                centerLabel="healthy"
              />
              <div className="legend">
                {healthSegments.map(s => (
                  <div key={s.label} className="legend-item">
                    <span className="legend-dot" style={{ background: s.color }} />
                    {s.label}
                    <span className="legend-val">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-card-title">
              <h3>Workloads by Type</h3>
              <span className="total">{workloadBars.reduce((s, b) => s + b.value, 0)} objects</span>
            </div>
            <div className="bars">
              {workloadBars.map(b => (
                <div key={b.label} className="bar-row" onClick={() => onResourceTypeChange(b.label.toLowerCase().replace(/s$/, ''))}>
                  <div className="bar-head">
                    <span className="name">
                      <Icon name={b.icon} size={14} />
                      {b.label}
                    </span>
                    <span className="val">{b.value}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(b.value / maxBar) * 100}%`, background: b.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
