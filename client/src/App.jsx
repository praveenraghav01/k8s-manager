import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';
import Navigation from './components/Navigation';
import ResourceViewer from './components/ResourceViewer';
import Overview from './components/Overview';
import Cluster from './components/Cluster';
import Nodes from './components/Nodes';
import Helm from './components/Helm';
import CustomResourceDetail from './components/CustomResourceDetail';
import Topology from './components/Topology';
import Loader from './components/Loader';
import Namespaces from './components/Namespaces';
import KubeConfigModal from './components/KubeConfigModal';
import AccessControl from './components/AccessControl';

// Views that load their own data and should NOT trigger the shared resource fetch.
// (Overview is intentionally excluded — its dashboard is built from the shared fetch.)
const STANDALONE_RESOURCE_TYPES = ['cluster', 'nodes', 'namespaces', 'helm', 'customResources', 'accessControl', 'topology'];

// Maps a resourceType to the key it lives under in allResources.
// Naive `type + 's'` breaks for a few types.
const PLURAL_KEY = { ingress: 'ingresses', networkPolicy: 'networkPolicies', storageClass: 'storageClasses' };
const pluralKey = (rt) => PLURAL_KEY[rt] || `${rt}s`;

// Cluster-scoped types come from a single /api/storage call (not per-namespace)
const CLUSTER_SCOPED = ['persistentVolume', 'storageClass'];

function App() {
  const [configStatus, setConfigStatus] = useState({ loaded: false, contexts: [] });
  const [configChecked, setConfigChecked] = useState(false);
  const [selectedNamespaces, setSelectedNamespaces] = useState(['all']);
  const [namespaces, setNamespaces] = useState([]);
  const [resourceType, setResourceType] = useState('overview');
  const [allResources, setAllResources] = useState({});
  const [selectedResource, setSelectedResource] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusResource, setFocusResource] = useState(null); // { type, namespace, name }
  const [focusNode, setFocusNode] = useState(null);
  const [crSelection, setCrSelection] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  const fetchIdRef = useRef(0);
  const [navExpanded, setNavExpanded] = useState({
    workloads: true,
    network: false,
    storage: false,
    config: false
  });

  useEffect(() => {
    fetchConfigStatus();
  }, []);

  useEffect(() => {
    if (configStatus.loaded) {
      fetchNamespaces();
    }
  }, [configStatus]);

  useEffect(() => {
    if (configStatus.loaded && !STANDALONE_RESOURCE_TYPES.includes(resourceType)) {
      fetchResources();
    }
  }, [selectedNamespaces, resourceType, configStatus.loaded, namespaces]);

  const fetchConfigStatus = async () => {
    try {
      const response = await axios.get('/api/config/status');
      setConfigStatus(response.data);
      setError(null);
    } catch (err) {
      setError('Failed to reach the server');
      setConfigStatus({ loaded: false, contexts: [] });
    } finally {
      setConfigChecked(true);
    }
  };

  // Load a kubeconfig from a user-provided path; returns an error string or null
  const loadConfigFromPath = async (filePath) => {
    try {
      await axios.post('/api/config/load', { filePath });
      await fetchConfigStatus();
      return null;
    } catch (err) {
      return err.response?.data?.error || err.message || 'Failed to load kubeconfig';
    }
  };

  const fetchNamespaces = async () => {
    try {
      const response = await axios.get('/api/namespaces');
      setNamespaces(['all', ...response.data.namespaces]);
    } catch (err) {
      setError('Failed to fetch namespaces');
    }
  };

  const resolveNamespaces = () => {
    if (selectedNamespaces.includes('all') || selectedNamespaces.length === 0) {
      return namespaces.filter(n => n !== 'all');
    }
    return selectedNamespaces;
  };

  const fetchResources = async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    try {
      // Cluster-scoped types (PersistentVolumes, StorageClasses) are a single call
      if (CLUSTER_SCOPED.includes(resourceType)) {
        const res = await axios.get('/api/storage');
        if (fetchId !== fetchIdRef.current) return;
        setAllResources(res.data);
        setError(null);
        return;
      }

      const namespacesToFetch = resolveNamespaces();
      const allData = {};

      // Fetch namespaces in parallel with a bounded concurrency pool.
      // The backend now uses in-process API calls (no process spawn), so we
      // can afford a higher fan-out.
      const CONCURRENCY = 12;
      let cursor = 0;
      const worker = async () => {
        while (cursor < namespacesToFetch.length) {
          if (fetchId !== fetchIdRef.current) return; // a newer fetch started
          const ns = namespacesToFetch[cursor++];
          try {
            const response = await axios.get(`/api/resources/${ns}`);
            if (fetchId !== fetchIdRef.current) return;
            // Synchronous merge — safe on JS's single thread, no data race
            Object.keys(response.data).forEach(key => {
              if (!allData[key]) allData[key] = [];
              allData[key].push(...response.data[key]);
            });
          } catch (e) {
            // Skip a namespace that fails (e.g. RBAC) rather than failing all
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, namespacesToFetch.length) }, worker)
      );

      if (fetchId !== fetchIdRef.current) return;
      setAllResources(allData);
      setError(null);
    } catch (err) {
      if (fetchId === fetchIdRef.current) setError('Failed to fetch resources');
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  };

  // Clear the selected resource (and drawer) only when the resource type changes.
  useEffect(() => {
    setSelectedResource(null);
  }, [resourceType]);

  // Resolve a pending focus target once its list has loaded (cross-link navigation).
  useEffect(() => {
    if (!focusResource) return;
    const list = allResources[focusResource.type + 's'] || [];
    const match = list.find(r => r.name === focusResource.name && r.namespace === focusResource.namespace);
    if (match) {
      setSelectedResource(match);
      setFocusResource(null);
    }
  }, [allResources, focusResource]);

  // Cross-navigation used by tables, drawers and the topology/nodes views.
  const nav = {
    toNamespace: (ns) => {
      if (!ns) return;
      setSelectedNamespaces([ns]);
      if (STANDALONE_RESOURCE_TYPES.includes(resourceType) || resourceType === 'overview') {
        setResourceType('pod');
      }
    },
    toNode: (name) => {
      if (!name) return;
      setFocusNode(name);
      setResourceType('nodes');
    },
    toResource: ({ type, namespace, name }) => {
      if (!type || !name) return;
      setSelectedNamespaces([namespace || 'all']);
      setResourceType(type);
      setFocusResource({ type, namespace, name });
    }
  };

  const toggleNavSection = (section) => {
    setNavExpanded(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const getFilteredResources = () => {
    const baseResources = allResources[pluralKey(resourceType)] || [];

    if (!searchQuery) return baseResources;
    return baseResources.filter(r =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.namespace.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  const getTotalCount = () => (allResources[pluralKey(resourceType)] || []).length;

  return (
    <div className="app-lens">
      {error && <div className="error-banner">{error}</div>}

      {configStatus.loaded ? (
        <div className="layout-lens">
          <Navigation
            configStatus={configStatus}
            onConfigChange={fetchConfigStatus}
            resourceType={resourceType}
            onResourceTypeChange={setResourceType}
            navExpanded={navExpanded}
            onToggleNav={toggleNavSection}
            crSelection={crSelection}
            onSelectCustomResource={(sel) => { setResourceType('customResources'); setCrSelection(sel); }}
            theme={theme}
            onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
          />

          {resourceType === 'overview' ? (
            <Overview
              allResources={allResources}
              selectedNamespaces={selectedNamespaces}
              namespaces={namespaces}
              onNamespaceSelect={setSelectedNamespaces}
              loading={loading}
              onResourceTypeChange={setResourceType}
            />
          ) : resourceType === 'cluster' ? (
            <Cluster configStatus={configStatus} />
          ) : resourceType === 'nodes' ? (
            <Nodes focusNode={focusNode} onFocusHandled={() => setFocusNode(null)} onNavigate={nav} />
          ) : resourceType === 'namespaces' ? (
            <Namespaces onNavigate={nav} />
          ) : resourceType === 'topology' ? (
            <Topology namespaces={namespaces} />
          ) : resourceType === 'helm' ? (
            <Helm />
          ) : resourceType === 'customResources' ? (
            <CustomResourceDetail selection={crSelection} onSelect={setCrSelection} />
          ) : resourceType === 'accessControl' ? (
            <AccessControl onNavigate={nav} />
          ) : (
            <ResourceViewer
              resourceType={resourceType}
              resources={getFilteredResources()}
              selectedResource={selectedResource}
              onSelectResource={setSelectedResource}
              selectedNamespaces={selectedNamespaces}
              namespaces={namespaces}
              onNamespaceChange={setSelectedNamespaces}
              loading={loading}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              totalCount={getTotalCount()}
              onResourceTypeChange={setResourceType}
              onNavigate={nav}
            />
          )}
        </div>
      ) : !configChecked ? (
        <div className="loading-state">
          <Loader label="Loading kubeconfig…" size={36} />
        </div>
      ) : (
        <KubeConfigModal
          defaultPath={configStatus.defaultPath}
          exists={configStatus.exists}
          onSubmit={loadConfigFromPath}
        />
      )}
    </div>
  );
}

export default App;
