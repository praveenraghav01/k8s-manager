import React from 'react';
import Icon from './Icons';
import CustomResourceTree from './CustomResourceTree';
import ContextSelector from './ContextSelector';

export default function Navigation({
  configStatus,
  onConfigChange,
  resourceType,
  onResourceTypeChange,
  navExpanded,
  onToggleNav,
  crSelection,
  onSelectCustomResource,
  theme,
  onToggleTheme
}) {
  const handleContextChange = async (context) => {
    try {
      const response = await fetch('/api/config/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextName: context })
      });
      if (response.ok && onConfigChange) {
        onConfigChange();
      }
    } catch (err) {
      console.error('Failed to change context:', err);
    }
  };

  const mainSections = [
    { key: 'cluster', label: 'Cluster', icon: 'cluster' },
    { key: 'nodes', label: 'Nodes', icon: 'nodes' },
    { key: 'namespaces', label: 'Namespaces', icon: 'namespace' },
    { key: 'topology', label: 'Topology', icon: 'topology' }
  ];

  const workloadTypes = [
    { key: 'overview', label: 'Overview', icon: 'overview' },
    { key: 'pod', label: 'Pods', icon: 'pod' },
    { key: 'deployment', label: 'Deployments', icon: 'deployment' },
    { key: 'statefulSet', label: 'StatefulSets', icon: 'statefulSet' },
    { key: 'daemonSet', label: 'DaemonSets', icon: 'daemonSet' },
    { key: 'replicaSet', label: 'Replica Sets', icon: 'replicaSet' },
    { key: 'replicationController', label: 'Replication Controllers', icon: 'replicationController' },
    { key: 'job', label: 'Jobs', icon: 'job' },
    { key: 'cronJob', label: 'Cron Jobs', icon: 'cronJob' }
  ];

  const networkTypes = [
    { key: 'service', label: 'Services', icon: 'service' },
    { key: 'ingress', label: 'Ingress', icon: 'ingress' },
    { key: 'networkPolicy', label: 'Network Policies', icon: 'networkPolicy' }
  ];

  const storageTypes = [
    { key: 'persistentVolume', label: 'PersistentVolumes', icon: 'persistentVolume' },
    { key: 'persistentVolumeClaim', label: 'PersistentVolumeClaims', icon: 'persistentVolumeClaim' },
    { key: 'storageClass', label: 'StorageClasses', icon: 'storageClass' }
  ];

  const configTypes = [
    { key: 'configMap', label: 'ConfigMaps', icon: 'configMap' },
    { key: 'secret', label: 'Secrets', icon: 'secret' },
    { key: 'serviceAccount', label: 'ServiceAccounts', icon: 'serviceAccount' }
  ];

  const otherSections = [
    { key: 'events', label: 'Events', icon: 'events' },
    { key: 'helm', label: 'Helm', icon: 'helm' },
    { key: 'accessControl', label: 'Access Control', icon: 'accessControl' }
  ];

  const renderTreeItem = (type) => (
    <div
      key={type.key}
      className={`nav-item ${resourceType === type.key ? 'active' : ''}`}
      onClick={() => onResourceTypeChange(type.key)}
      title={type.label}
    >
      <Icon name={type.icon} size={15} className="nav-lead-icon" />
      {type.label}
    </div>
  );

  const renderSection = (key, label, items) => (
    <div className="nav-section">
      <div className="nav-section-title" onClick={() => onToggleNav(key)}>
        <span className={`nav-section-chevron ${navExpanded[key] ? 'open' : ''}`}>
          <Icon name="chevronRight" size={13} strokeWidth={2.2} />
        </span>
        {label}
      </div>
      {navExpanded[key] && <div className="nav-items">{items.map(renderTreeItem)}</div>}
    </div>
  );

  return (
    <nav className="nav-sidebar">
      <div className="nav-header">
        <div className="nav-brand">
          <div className="nav-brand-logo">
            <Icon name="hexagon" size={18} strokeWidth={2} />
          </div>
          <div className="nav-brand-text">
            <span className="nav-brand-title">Kubernetes</span>
            <span className="nav-brand-sub">Manager</span>
          </div>
          <button
            className="theme-toggle"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>
        </div>
        <div className="nav-cluster">Context</div>
        <ContextSelector
          contexts={configStatus.contexts || []}
          currentContext={configStatus.currentContext}
          onChange={handleContextChange}
        />
      </div>

      <div className="nav-sections">
        {mainSections.map(section => (
          <div
            key={section.key}
            className={`nav-item simple ${resourceType === section.key ? 'active' : ''}`}
            onClick={() => onResourceTypeChange(section.key)}
          >
            <Icon name={section.icon} size={16} className="nav-lead-icon" />
            {section.label}
          </div>
        ))}

        <div className="nav-group-label">Workloads</div>
        {renderSection('workloads', 'Workloads', workloadTypes)}
        {renderSection('config', 'Config', configTypes)}
        {renderSection('network', 'Network', networkTypes)}
        {renderSection('storage', 'Storage', storageTypes)}

        <div className="nav-group-label">Cluster</div>
        {otherSections.map(section => (
          <div
            key={section.key}
            className={`nav-item simple ${resourceType === section.key ? 'active' : ''}`}
            onClick={() => onResourceTypeChange(section.key)}
          >
            <Icon name={section.icon} size={16} className="nav-lead-icon" />
            {section.label}
          </div>
        ))}

        <CustomResourceTree selection={crSelection} onSelect={onSelectCustomResource} />
      </div>
    </nav>
  );
}
