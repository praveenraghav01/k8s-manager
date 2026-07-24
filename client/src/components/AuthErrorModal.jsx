import React from 'react';
import Icon from './Icons';

// Blocking popup shown before the app loads when the kubeconfig parses but the
// cluster credentials don't actually work (expired token, unreachable API
// server, untrusted TLS, missing exec auth plugin, …).

const TITLES = {
  'no-config': 'No kubeconfig loaded',
  unauthorized: 'Cluster authentication failed',
  unreachable: 'Cluster unreachable',
  tls: 'TLS certificate error',
  'exec-plugin': 'Auth plugin failed',
  error: 'Could not connect to the cluster',
};

const HINTS = {
  unauthorized: 'Refresh your credentials (e.g. re-run your cloud login) and retry, or load a different kubeconfig.',
  unreachable: 'Confirm the cluster is running and reachable — check your VPN, network, and the API server URL below.',
  tls: 'The API server certificate could not be verified. Check that your kubeconfig trusts the right CA.',
  'exec-plugin': 'Install the auth helper CLI referenced by your kubeconfig and make sure it is on PATH, then retry.',
};

export default function AuthErrorModal({ auth, onRetry, onChangeConfig, retrying }) {
  const reason = auth?.reason || 'error';
  const title = TITLES[reason] || TITLES.error;
  const hint = HINTS[reason];

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <span className="modal-icon danger"><Icon name="warning" size={20} /></span>
          <h2>{title}</h2>
        </div>

        <p className="modal-desc">{auth?.message || 'The cluster could not be reached with the current kubeconfig.'}</p>

        {hint && <p className="modal-desc" style={{ marginTop: -8 }}>{hint}</p>}

        <div className="auth-detail">
          {auth?.currentContext && (
            <div className="auth-detail-row">
              <span className="auth-detail-key">Context</span>
              <code>{auth.currentContext}</code>
            </div>
          )}
          {auth?.server && (
            <div className="auth-detail-row">
              <span className="auth-detail-key">API server</span>
              <code>{auth.server}</code>
            </div>
          )}
        </div>

        <div className="modal-actions" style={{ gap: 10 }}>
          {onChangeConfig && (
            <button className="modal-btn" onClick={onChangeConfig} disabled={retrying}>
              Load different kubeconfig
            </button>
          )}
          <button className="modal-btn primary" onClick={onRetry} disabled={retrying}>
            <Icon name="refresh" size={14} /> {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      </div>
    </div>
  );
}
