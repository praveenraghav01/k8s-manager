import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Icon from './Icons';
import Loader from './Loader';

export default function LogsViewer({ resource, namespace, searchQuery, onSearchChange, initialContainer }) {
  const containerNames = resource?.containerNames || [];
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tailLines, setTailLines] = useState(0);
  const [formatEnabled, setFormatEnabled] = useState(true);
  const [container, setContainer] = useState(initialContainer || containerNames[0] || '');
  const logsEndRef = useRef(null);

  // Reset the selected container when switching pods (honor a requested container)
  useEffect(() => {
    setContainer(initialContainer || resource?.containerNames?.[0] || '');
  }, [resource?.name, initialContainer]);

  useEffect(() => {
    if (resource?.name) {
      fetchLogs();
    }
  }, [resource, container]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const ns = resource?.namespace || namespace;
      const response = await axios.get(`/api/logs/${ns}/${resource.name}`, {
        params: container ? { container } : {}
      });
      const logsText = response.data?.logs || '';
      setLogs(String(logsText));
      setError(null);
    } catch (err) {
      setError(`Failed to load logs: ${err.message}`);
      setLogs('');
    } finally {
      setLoading(false);
    }
  };

  const formatLogLine = (line) => {
    const parts = [];
    let lastIndex = 0;

    // Match timestamp pattern (ISO 8601 or similar)
    const timestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    const match = line.match(timestampRegex);

    if (match) {
      parts.push({
        type: 'timestamp',
        text: match[0],
        start: 0,
        end: match[0].length
      });
      lastIndex = match[0].length;
    }

    // Match log levels
    const levelRegex = /\s(ERROR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL|PANIC)\s/gi;
    let levelMatch;
    while ((levelMatch = levelRegex.exec(line)) !== null) {
      if (levelMatch.index >= lastIndex) {
        parts.push({
          type: 'text',
          text: line.substring(lastIndex, levelMatch.index + 1)
        });
        parts.push({
          type: 'level-' + levelMatch[1].toUpperCase(),
          text: levelMatch[1]
        });
        lastIndex = levelMatch.index + levelMatch[0].length - 1;
      }
    }

    // Add remaining text
    if (lastIndex < line.length) {
      parts.push({
        type: 'text',
        text: line.substring(lastIndex)
      });
    }

    return parts;
  };

  const renderFormattedLog = (line) => {
    if (!formatEnabled) {
      return <span>{line}</span>;
    }

    const parts = formatLogLine(line);
    return (
      <>
        {parts.map((part, idx) => {
          if (part.type === 'timestamp') {
            return <span key={idx} style={{ color: '#61AFEF' }}>{part.text}</span>;
          }
          if (part.type === 'level-ERROR' || part.type === 'level-FATAL' || part.type === 'level-PANIC') {
            return <span key={idx} style={{ color: '#E06C75', fontWeight: 'bold' }}>{part.text}</span>;
          }
          if (part.type === 'level-WARN' || part.type === 'level-WARNING') {
            return <span key={idx} style={{ color: '#E5C07B', fontWeight: 'bold' }}>{part.text}</span>;
          }
          if (part.type === 'level-INFO') {
            return <span key={idx} style={{ color: '#98C379', fontWeight: 'bold' }}>{part.text}</span>;
          }
          if (part.type === 'level-DEBUG' || part.type === 'level-TRACE') {
            return <span key={idx} style={{ color: '#56B6C2' }}>{part.text}</span>;
          }
          return <span key={idx}>{part.text}</span>;
        })}
      </>
    );
  };

  const displayLogs = () => {
    if (!logs) return [];

    let lines = logs.split('\n');

    // Apply tail filter
    if (tailLines > 0) {
      lines = lines.slice(-tailLines);
    }

    // Apply search filter
    if (searchQuery) {
      lines = lines.filter(line => line.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    return lines;
  };

  const handleDownload = () => {
    const element = document.createElement('a');
    element.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(logs);
    element.download = `${resource.name}-logs.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const displayLines = displayLogs();
  const lineCount = logs.split('\n').length;

  return (
    <div className="logs-viewer">
      <div className="logs-toolbar">
        {containerNames.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '8px' }}>
            <Icon name="box" size={14} style={{ color: '#8b949e' }} />
            <select
              className="logs-container-select"
              value={container}
              onChange={(e) => setContainer(e.target.value)}
              title="Select container"
            >
              {containerNames.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
        <input
          type="text"
          placeholder="Search logs..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="logs-search"
          style={{ flex: 1, marginRight: '8px' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '8px' }}>
          <label style={{ fontSize: '12px', color: '#aaa' }}>Tail:</label>
          <input
            type="number"
            placeholder="All"
            value={tailLines || ''}
            onChange={(e) => setTailLines(parseInt(e.target.value) || 0)}
            className="logs-tail-input"
            style={{
              width: '60px',
              padding: '6px',
              backgroundColor: '#2d2d30',
              color: '#d4d4d4',
              border: '1px solid #555',
              borderRadius: '4px',
              fontSize: '12px'
            }}
            title="Show only last N lines"
          />
        </div>
        <button
          className={`logs-action-btn ${formatEnabled ? 'active' : ''}`}
          onClick={() => setFormatEnabled(!formatEnabled)}
          title="Toggle log formatting"
        >
          <Icon name="values" size={15} />
        </button>
        <button className="logs-action-btn" onClick={handleDownload} title="Download"><Icon name="download" size={15} /></button>
        <button className="logs-action-btn" onClick={fetchLogs} title="Refresh"><Icon name="refresh" size={15} /></button>
      </div>
      <div style={{ fontSize: '11px', color: '#888', padding: '8px 12px', borderBottom: '1px solid #444' }}>
        Showing {displayLines.length} of {lineCount} lines
      </div>
      <div className="logs-content">
        {loading && <Loader label="Loading logs…" inline />}
        {error && <div className="logs-error">{error}</div>}
        {!loading && !error && (
          <div className="logs-text">
            {displayLines.length === 0 ? (
              <div style={{ padding: '12px', color: '#888' }}>No logs available</div>
            ) : (
              displayLines.map((line, idx) => (
                <div key={idx} style={{ display: 'flex' }}>
                  <span style={{
                    minWidth: '50px',
                    color: '#666',
                    marginRight: '12px',
                    textAlign: 'right',
                    userSelect: 'none'
                  }}>
                    {idx + 1}
                  </span>
                  <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {renderFormattedLog(line)}
                  </span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}
