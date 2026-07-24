import React, { useState } from 'react';
import axios from 'axios';

export default function ConfigSelector({ configStatus, onConfigChange }) {
  const [customPath, setCustomPath] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLoadConfig = async () => {
    if (!customPath) return;
    setLoading(true);
    try {
      await axios.post('/api/config/load', { filePath: customPath });
      setCustomPath('');
      onConfigChange();
    } catch (err) {
      alert('Failed to load kubeconfig: ' + err.response?.data?.error);
    } finally {
      setLoading(false);
    }
  };

  const handleContextChange = async (e) => {
    const contextName = e.target.value;
    try {
      await axios.post('/api/config/context', { contextName });
      onConfigChange();
    } catch (err) {
      alert('Failed to switch context');
    }
  };

  return (
    <div className="config-selector">
      <h3>Context</h3>
      {configStatus.loaded ? (
        <>
          <select
            className="select-input"
            value={configStatus.currentContext || ''}
            onChange={handleContextChange}
          >
            {configStatus.contexts?.map(ctx => (
              <option key={ctx} value={ctx}>{ctx}</option>
            ))}
          </select>
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#999' }}>
            Current: {configStatus.currentContext}
          </div>
        </>
      ) : (
        <div style={{ fontSize: '12px', color: '#999' }}>
          No kubeconfig loaded
        </div>
      )}
    </div>
  );
}
