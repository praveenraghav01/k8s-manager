import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import YamlViewer from './YamlViewer';
import LogsViewer from './LogsViewer';
import TerminalViewer from './TerminalViewer';
import Events from './Events';
import NamespaceMultiSelect from './NamespaceMultiSelect';
import ResourceDrawer from './ResourceDrawer';
import ContextMenu from './ContextMenu';
import Loader from './Loader';
import Icon from './Icons';

const TAB_META = {
  logs: { icon: 'logs', label: 'Logs' },
  terminal: { icon: 'terminal', label: 'Terminal' },
  configuration: { icon: 'configuration', label: 'YAML' }
};

const formatAge = (createdAt) => {
  if (!createdAt) return '-';
  const seconds = Math.floor((new Date() - new Date(createdAt)) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

const RESOURCE_LABELS = {
  overview: { label: 'Overview', icon: 'overview' },
  pod: { label: 'Pods', icon: 'pod' },
  service: { label: 'Services', icon: 'service' },
  deployment: { label: 'Deployments', icon: 'deployment' },
  statefulSet: { label: 'StatefulSets', icon: 'statefulSet' },
  daemonSet: { label: 'DaemonSets', icon: 'daemonSet' },
  replicaSet: { label: 'Replica Sets', icon: 'replicaSet' },
  replicationController: { label: 'Replication Controllers', icon: 'replicationController' },
  job: { label: 'Jobs', icon: 'job' },
  cronJob: { label: 'Cron Jobs', icon: 'cronJob' },
  events: { label: 'Events', icon: 'events' },
  configMap: { label: 'ConfigMaps', icon: 'configMap' },
  secret: { label: 'Secrets', icon: 'secret' },
  serviceAccount: { label: 'ServiceAccounts', icon: 'serviceAccount' },
  ingress: { label: 'Ingresses', icon: 'ingress' },
  networkPolicy: { label: 'Network Policies', icon: 'networkPolicy' },
  persistentVolume: { label: 'Persistent Volumes', icon: 'persistentVolume' },
  persistentVolumeClaim: { label: 'Persistent Volume Claims', icon: 'persistentVolumeClaim' },
  storageClass: { label: 'Storage Classes', icon: 'storageClass' }
};

// Types shown as tabs at the top of the workloads viewer (Config/Network/etc.
// are navigated from the sidebar and get no tab strip).
const TAB_KEYS = ['overview', 'pod', 'service', 'deployment', 'statefulSet', 'daemonSet', 'replicaSet', 'replicationController', 'job', 'cronJob', 'events'];

export default function ResourceViewer({
  resourceType,
  resources,
  selectedResource,
  onSelectResource,
  selectedNamespaces = ['all'],
  namespaces = [],
  onNamespaceChange,
  loading,
  searchQuery,
  onSearchChange,
  totalCount,
  onResourceTypeChange,
  onNavigate
}) {
  const namespace = selectedNamespaces.includes('all') || selectedNamespaces.length !== 1
    ? 'all'
    : selectedNamespaces[0];
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [logSearch, setLogSearch] = useState('');
  const [podMetrics, setPodMetrics] = useState({});
  const [menu, setMenu] = useState(null); // { x, y, resource }
  const [selectedRows, setSelectedRows] = useState(new Set());
  const headerCheckRef = useRef(null);

  const rowKey = (r) => `${r.namespace}/${r.name}`;
  const isRowSelected = (r) => selectedRows.has(rowKey(r));
  const toggleRow = (r) => setSelectedRows(prev => {
    const next = new Set(prev);
    const k = rowKey(r);
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  });
  const allSelected = resources.length > 0 && resources.every(r => selectedRows.has(rowKey(r)));
  const someSelected = resources.some(r => selectedRows.has(rowKey(r)));
  const toggleAll = () => setSelectedRows(allSelected ? new Set() : new Set(resources.map(rowKey)));

  // reset selection when the view or namespace changes
  useEffect(() => { setSelectedRows(new Set()); }, [resourceType, namespace]);
  // native checkboxes need indeterminate set imperatively
  useEffect(() => {
    if (headerCheckRef.current) headerCheckRef.current.indeterminate = someSelected && !allSelected;
  });

  const openTab = (type, res, container) => {
    if (!res) return;
    const id = `${type}:${res.namespace}/${res.name}${container ? ':' + container : ''}`;
    setTabs(prev => (prev.some(t => t.id === id) ? prev : [...prev, { id, type, resource: res, resourceType, container }]));
    setActiveTabId(id);
  };

  const closeTab = (id) => {
    const remaining = tabs.filter(t => t.id !== id);
    setTabs(remaining);
    if (activeTabId === id) {
      setActiveTabId(remaining.length ? remaining[remaining.length - 1].id : null);
    }
  };

  const menuItems = (res) => {
    const items = [{ icon: 'details', label: 'Details', onClick: () => onSelectResource(res) }];
    if (resourceType === 'pod') {
      const cns = res.containerNames || [];
      if (cns.length > 1) {
        // Expandable: pick a container to view its logs
        items.push({
          icon: 'logs',
          label: 'Logs',
          children: cns.map(c => ({ icon: 'box', label: c, onClick: () => openTab('logs', res, c) }))
        });
      } else {
        items.push({ icon: 'logs', label: 'Logs', onClick: () => openTab('logs', res, cns[0]) });
      }
      items.push({ icon: 'terminal', label: 'Terminal', onClick: () => openTab('terminal', res) });
    }
    items.push({ icon: 'configuration', label: 'Edit YAML', onClick: () => openTab('configuration', res) });
    return items;
  };

  // Live pod metrics for the table CPU/Memory columns
  useEffect(() => {
    if (resourceType !== 'pod') {
      setPodMetrics({});
      return;
    }
    let active = true;
    const fetchMetrics = async () => {
      try {
        const res = await axios.get('/api/metrics/pods');
        if (active) setPodMetrics(res.data.metrics || {});
      } catch (e) { /* metrics optional */ }
    };
    fetchMetrics();
    const iv = setInterval(fetchMetrics, 15000);
    return () => { active = false; clearInterval(iv); };
  }, [resourceType]);

  const fmtCpu = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)}` : `${Math.round(m)}m`);
  const fmtMem = (b) => {
    const mi = b / 1024 / 1024;
    return mi >= 1024 ? `${(mi / 1024).toFixed(1)}Gi` : `${Math.round(mi)}Mi`;
  };

  const getStatusColor = (status) => {
    if (!status) return '#999999';
    const s = status.toLowerCase();
    if (s === 'running') return '#5eb575';
    if (s === 'pending') return '#f5a623';
    if (s === 'failed' || s === 'unknown') return '#ff6b6b';
    return '#999999';
  };

  const getTableColumns = () => {
    if (resourceType === 'pod') {
      return ['Name', 'Namespace', 'Containers', 'CPU', 'Memory', 'Restarts', 'Node', 'Age', 'Status'];
    }
    if (resourceType === 'configMap') return ['Name', 'Namespace', 'Keys', 'Age'];
    if (resourceType === 'secret') return ['Name', 'Namespace', 'Type', 'Keys', 'Age'];
    if (resourceType === 'serviceAccount') return ['Name', 'Namespace', 'Secrets', 'Age'];
    if (resourceType === 'ingress') return ['Name', 'Namespace', 'Class', 'Hosts', 'Age'];
    if (resourceType === 'networkPolicy') return ['Name', 'Namespace', 'Policy Types', 'Age'];
    if (resourceType === 'persistentVolumeClaim') return ['Name', 'Namespace', 'Status', 'Capacity', 'Storage Class', 'Volume', 'Age'];
    if (resourceType === 'persistentVolume') return ['Name', 'Capacity', 'Access Modes', 'Reclaim Policy', 'Status', 'Storage Class', 'Claim', 'Age'];
    if (resourceType === 'storageClass') return ['Name', 'Provisioner', 'Reclaim Policy', 'Binding Mode', 'Age'];
    return ['Name', 'Namespace', 'Status'];
  };

  const renderCell = (resource, column) => {
    switch (column) {
      case 'Name':
        return resource.name;
      case 'Namespace':
        return (
          <span
            className="xlink"
            onClick={(e) => { e.stopPropagation(); onNavigate?.toNamespace(resource.namespace); }}
            title={`Filter to ${resource.namespace}`}
          >
            {resource.namespace}
          </span>
        );
      case 'Status': {
        const status = resource.status || 'Unknown';
        const statusColor = getStatusColor(status);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '120px' }}>
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: statusColor,
                flexShrink: 0
              }}
            />
            <span style={{
              color: statusColor,
              fontSize: '12px',
              fontWeight: '500'
            }}>
              {status}
            </span>
          </div>
        );
      }
      case 'Containers': {
        const states = resource.containerStates;
        if (!states || !states.length) return '-';
        return (
          <span className="container-boxes">
            {states.map((c, i) => (
              <span
                key={i}
                className={`container-box ${c.status}`}
                title={`${c.name}: ${c.status}`}
              />
            ))}
          </span>
        );
      }
      case 'CPU': {
        const m = podMetrics[`${resource.namespace}/${resource.name}`];
        return m ? <span style={{ color: '#58a6ff', fontFamily: 'var(--mono)' }}>{fmtCpu(m.cpuMilli)}</span> : '—';
      }
      case 'Memory': {
        const m = podMetrics[`${resource.namespace}/${resource.name}`];
        return m ? <span style={{ color: '#bc8cff', fontFamily: 'var(--mono)' }}>{fmtMem(m.memBytes)}</span> : '—';
      }
      case 'Restarts':
        return resource.restarts != null ? resource.restarts : '0';
      case 'Node':
        return resource.node ? (
          <span
            className="xlink"
            onClick={(e) => { e.stopPropagation(); onNavigate?.toNode(resource.node); }}
            title={`View node ${resource.node}`}
          >
            {resource.node}
          </span>
        ) : '-';
      case 'Age':
        return formatAge(resource.createdAt);
      case 'Keys':
        return resource.dataKeys != null ? resource.dataKeys : '0';
      case 'Type':
        return <span className="drawer-chip">{resource.secretType || 'Opaque'}</span>;
      case 'Secrets':
        return resource.saSecrets != null ? resource.saSecrets : '0';
      case 'Class':
        return resource.ingressClass || '-';
      case 'Hosts':
        return resource.hosts || '-';
      case 'Policy Types':
        return resource.policyTypes || '-';
      case 'Capacity':
        return <span style={{ fontFamily: 'var(--mono)' }}>{resource.capacity || '-'}</span>;
      case 'Access Modes':
        return resource.accessModes || '-';
      case 'Reclaim Policy':
        return resource.reclaimPolicy || '-';
      case 'Storage Class':
        return resource.storageClass || '-';
      case 'Volume':
        return resource.volume || '-';
      case 'Claim':
        return resource.claim || '-';
      case 'Provisioner':
        return <span style={{ fontFamily: 'var(--mono)', fontSize: '11.5px' }}>{resource.provisioner || '-'}</span>;
      case 'Binding Mode':
        return resource.bindingMode || '-';
      default:
        return '-';
    }
  };

  const isTabbed = TAB_KEYS.includes(resourceType);

  return (
    <div className="resource-viewer">
      {isTabbed && (
        <div className="resource-tabs">
          {TAB_KEYS.map(key => (
            <button
              key={key}
              className={`resource-tab ${resourceType === key ? 'active' : ''}`}
              onClick={() => onResourceTypeChange(key)}
            >
              <Icon name={RESOURCE_LABELS[key].icon} size={15} />
              {RESOURCE_LABELS[key].label}
            </button>
          ))}
        </div>
      )}

      <div className="resource-header">
        <div>
          <h3>
            <Icon name={RESOURCE_LABELS[resourceType]?.icon} size={18} />
            {RESOURCE_LABELS[resourceType]?.label}
          </h3>
          <span className="resource-count">
            {totalCount} items{someSelected ? ` · ${selectedRows.size} selected` : ''}
          </span>
        </div>
        <div className="resource-controls">
          <NamespaceMultiSelect
            namespaces={namespaces}
            selected={selectedNamespaces}
            onChange={(next) => onNamespaceChange && onNamespaceChange(next)}
          />
          <div className="search-box">
            <input
              type="text"
              placeholder={`Search ${RESOURCE_LABELS[resourceType]?.label || ''}...`}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="search-input"
            />
            <span className="search-icon"><Icon name="search" size={15} /></span>
          </div>
        </div>
      </div>

      <div className="resource-table-wrapper">
        {resourceType === 'events' ? (
          <Events namespace={namespace} />
        ) : loading ? (
          <Loader label={`Loading ${RESOURCE_LABELS[resourceType]?.label || 'resources'}…`} />
        ) : resources.length === 0 ? (
          <div className="loading-indicator">No resources found</div>
        ) : (
          <table className="resource-table">
            <thead>
              <tr>
                <th className="ck-col">
                  <input
                    type="checkbox"
                    className="ck"
                    ref={headerCheckRef}
                    checked={!!allSelected}
                    onChange={toggleAll}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Select all"
                  />
                </th>
                {getTableColumns().map(col => (
                  <th key={col}>{col}</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {resources.map((resource, idx) => (
                <tr
                  key={`${resource.name}-${idx}`}
                  className={`resource-table-row ${
                    selectedResource?.name === resource.name ? 'active' : ''
                  } ${isRowSelected(resource) ? 'selected' : ''}`}
                  onClick={() => onSelectResource(resource)}
                >
                  <td className="ck-col" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="ck"
                      checked={!!isRowSelected(resource)}
                      onChange={() => toggleRow(resource)}
                      aria-label={`Select ${resource.name}`}
                    />
                  </td>
                  {getTableColumns().map(col => (
                    <td key={col}>
                      {col === 'Name' ? (
                        <span className="resource-name-cell">
                          <Icon name={RESOURCE_LABELS[resourceType]?.icon} size={15} className="rn-icon" />
                          <span className="rn-text">{resource.name}</span>
                        </span>
                      ) : (
                        renderCell(resource, col)
                      )}
                    </td>
                  ))}
                  <td
                    className="actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu({ x: e.clientX, y: e.clientY, resource });
                    }}
                  >
                    <Icon name="more" size={16} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {tabs.length > 0 && (
        <div className="bottom-panel">
          <div className="bottom-panel-tabs">
            {tabs.map(t => (
              <div
                key={t.id}
                className={`tab-chip ${activeTabId === t.id ? 'active' : ''}`}
                onClick={() => setActiveTabId(t.id)}
                title={`${TAB_META[t.type].label}: ${t.resource.name}${t.container ? ' · ' + t.container : ''}`}
              >
                <Icon name={TAB_META[t.type].icon} size={14} />
                <span className="tab-chip-label">
                  {t.resource.name}{t.container ? <span className="tab-chip-sub"> · {t.container}</span> : null}
                </span>
                <span
                  className="tab-chip-close"
                  onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
                >
                  <Icon name="close" size={12} />
                </span>
              </div>
            ))}
            <button
              className="bottom-panel-toggle"
              onClick={() => { setTabs([]); setActiveTabId(null); }}
              title="Close all"
            >
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="bottom-panel-content">
            {tabs.map(t => (
              <div key={t.id} className="tab-pane" style={{ display: activeTabId === t.id ? 'block' : 'none' }}>
                {t.type === 'logs' && (
                  <LogsViewer
                    resource={t.resource}
                    namespace={t.resource.namespace}
                    initialContainer={t.container}
                    searchQuery={logSearch}
                    onSearchChange={setLogSearch}
                  />
                )}
                {t.type === 'terminal' && (
                  <TerminalViewer resource={t.resource} namespace={t.resource.namespace} />
                )}
                {t.type === 'configuration' && (
                  <YamlViewer resource={t.resource} namespace={t.resource.namespace} resourceType={t.resourceType} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedResource && (
        <ResourceDrawer
          resource={selectedResource}
          namespace={namespace}
          resourceType={resourceType}
          onClose={() => onSelectResource(null)}
          onOpenTab={(type) => openTab(type, selectedResource)}
          onNavigate={onNavigate}
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.resource)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
