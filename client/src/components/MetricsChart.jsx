import React from 'react';

const W = 300;
const H = 68;
const PAD = 6;

// utilisation → colour: <80 green, 80-90 yellow, >=90 red
const utilColor = (pct) => {
  if (pct == null) return null;
  if (pct >= 90) return '#f85149';
  if (pct >= 80) return '#d29922';
  return '#3fb950';
};

export default function MetricsChart({ id, label, data, limit, format, fallbackColor = '#58a6ff', thresholdLabel = 'limit' }) {
  const points = data && data.length ? data : [0];
  const current = points[points.length - 1];
  const pct = limit ? (current / limit) * 100 : null;
  const color = pct != null ? utilColor(pct) : fallbackColor;

  const dataMax = Math.max(...points, 0);
  const max = Math.max(dataMax, limit || 0, 1) * 1.15;
  const n = points.length;

  const yFor = (v) => H - PAD - (v / max) * (H - PAD * 2);
  const xy = points.map((v, i) => [n === 1 ? W : (i / (n - 1)) * W, yFor(v)]);
  const linePath = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${W} ${H} L 0 ${H} Z`;
  const last = xy[xy.length - 1];
  const limitY = limit ? yFor(limit) : null;

  const fmt = format || ((v) => Math.round(v));

  return (
    <div className="metric-chart">
      <div className="metric-chart-head">
        <span className="metric-chart-label">{label}</span>
        <span className="metric-chart-value" style={{ color }}>
          {fmt(current)}
          {limit ? (
            <span className="metric-chart-sub">
              {' / '}{fmt(limit)} {thresholdLabel}
              {pct != null && <span style={{ color, marginLeft: 6 }}>{Math.round(pct)}%</span>}
            </span>
          ) : null}
        </span>
      </div>
      <svg className="metric-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#grad-${id})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        {limitY != null && (
          <line
            x1="0" y1={limitY} x2={W} y2={limitY}
            stroke="#f85149" strokeWidth="1.2"
            strokeDasharray="5 4" vectorEffect="non-scaling-stroke" opacity="0.85"
          />
        )}
        {last && <circle cx={last[0]} cy={last[1]} r="2.8" fill={color} />}
      </svg>
    </div>
  );
}
