import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function ResourceDetail({ resource, namespace }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState(null);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    if (!resource) return;
    fetchDetails();
  }, [resource]);

  const fetchDetails = async () => {
    setLoading(true);
    try {
      const ns = resource?.namespace || namespace;
      const response = await axios.get(
        `/api/resource/${ns}/${resource.kind}/${resource.name}`
      );
      setDetails(response.data);
    } catch (err) {
      console.error('Failed to fetch details:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const ns = resource?.namespace || namespace;
      const response = await axios.get(
        `/api/logs/${ns}/${resource.name}`
      );
      setLogs(response.data);
      setShowLogs(true);
    } catch (err) {
      alert('Failed to fetch logs: ' + err.message);
    }
  };

  if (!resource) return <div className="no-selection"><p>Select a resource to view details</p></div>;
  if (loading) return <div className="no-selection"><p>Loading...</p></div>;
  if (!details) return <div className="no-selection"><p>No details available</p></div>;

  const metadata = details.metadata || {};
  const status = details.status || {};

  const getStatusColor = (phase) => {
    if (!phase) return 'detail-status';
    const lower = phase.toLowerCase();
    if (lower === 'running') return 'detail-status';
    if (lower === 'pending') return 'detail-status pending';
    if (lower === 'failed') return 'detail-status failed';
    return 'detail-status';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="detail-header">
        <div className="detail-title">
          <h2>{resource.name}</h2>
          <div className={getStatusColor(status.phase)}>
            {status.phase || 'Unknown'}
          </div>
        </div>
        <div className="detail-meta">
          <span>{resource.namespace || namespace}</span>
          <span>Created {new Date(metadata.creationTimestamp).toLocaleDateString()}</span>
        </div>
      </div>

      <div className="detail-content">
        {/* Metadata Section */}
        <div className="detail-section">
          <div className="detail-section-title">Metadata</div>
          <div className="detail-grid">
            <div className="detail-field">
              <div className="detail-field-label">Name</div>
              <div className="detail-field-value">{metadata.name}</div>
            </div>
            <div className="detail-field">
              <div className="detail-field-label">Namespace</div>
              <div className="detail-field-value">{metadata.namespace}</div>
            </div>
            <div className="detail-field">
              <div className="detail-field-label">UID</div>
              <div className="detail-field-value">{metadata.uid?.substring(0, 12)}...</div>
            </div>
            <div className="detail-field">
              <div className="detail-field-label">Created</div>
              <div className="detail-field-value">{new Date(metadata.creationTimestamp).toLocaleString()}</div>
            </div>
          </div>

          {metadata.labels && Object.keys(metadata.labels).length > 0 && (
            <>
              <div className="detail-section-title" style={{ marginTop: '16px' }}>Labels</div>
              <div className="detail-labels">
                {Object.entries(metadata.labels).map(([k, v]) => (
                  <div key={k} className="detail-label-item">
                    <span className="detail-label-key">{k}:</span>
                    <span className="detail-label-value">{v}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Status Section */}
        {resource.kind === 'Pod' && status.phase && (
          <div className="detail-section">
            <div className="detail-section-title">Pod Status</div>
            <div className="detail-grid">
              <div className="detail-field">
                <div className="detail-field-label">Phase</div>
                <div className="detail-field-value">{status.phase}</div>
              </div>
              <div className="detail-field">
                <div className="detail-field-label">Pod IP</div>
                <div className="detail-field-value">{status.podIP || 'N/A'}</div>
              </div>
              <div className="detail-field">
                <div className="detail-field-label">Node</div>
                <div className="detail-field-value">{status.nodeName || 'N/A'}</div>
              </div>
              <div className="detail-field">
                <div className="detail-field-label">Start Time</div>
                <div className="detail-field-value">
                  {status.startTime ? new Date(status.startTime).toLocaleString() : 'N/A'}
                </div>
              </div>
            </div>
          </div>
        )}

        {resource.kind === 'Deployment' && status.replicas && (
          <div className="detail-section">
            <div className="detail-section-title">Deployment Status</div>
            <div className="detail-grid">
              <div className="detail-field">
                <div className="detail-field-label">Desired</div>
                <div className="detail-field-value">{status.replicas}</div>
              </div>
              <div className="detail-field">
                <div className="detail-field-label">Current</div>
                <div className="detail-field-value">{status.currentReplicas || 0}</div>
              </div>
              <div className="detail-field">
                <div className="detail-field-label">Ready</div>
                <div className="detail-field-value">{status.readyReplicas || 0}</div>
              </div>
              <div className="detail-field">
                <div className="detail-field-label">Updated</div>
                <div className="detail-field-value">{status.updatedReplicas || 0}</div>
              </div>
            </div>
          </div>
        )}

        {/* Spec Section */}
        {details.spec && (
          <div className="detail-section">
            <div className="detail-section-title">Specification</div>
            {resource.kind === 'Service' && (
              <div className="detail-grid">
                <div className="detail-field">
                  <div className="detail-field-label">Type</div>
                  <div className="detail-field-value">{details.spec.type}</div>
                </div>
                <div className="detail-field">
                  <div className="detail-field-label">Cluster IP</div>
                  <div className="detail-field-value">{details.spec.clusterIP}</div>
                </div>
                {details.spec.ports && (
                  <div className="detail-field">
                    <div className="detail-field-label">Ports</div>
                    <div className="detail-field-value">
                      {details.spec.ports.map((p, i) => (
                        <div key={i}>{p.name}: {p.port}:{p.targetPort} ({p.protocol})</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {resource.kind === 'Deployment' && (
              <div className="detail-grid">
                <div className="detail-field">
                  <div className="detail-field-label">Strategy</div>
                  <div className="detail-field-value">{details.spec.strategy?.type}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
