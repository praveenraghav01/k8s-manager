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
import AuthErrorModal from './components/AuthErrorModal';
import AccessControl from './components/AccessControl';
import Assistant from './components/Assistant';
import ClusterRail from './components/ClusterRail';
import { useToast } from './components/Toast';

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
  const toast = useToast();
  const [configStatus, setConfigStatus] = useState({ loaded: false, contexts: [] });
  const [configChecked, setConfigChecked] = useState(false);
  const [serverUnreachable, setServerUnreachable] = useState(false);
  // Cluster auth pre-check: { checked, ok, reason, message, currentContext, server }
  const [authState, setAuthState] = useState({ checked: false, ok: false });
  const [authRetrying, setAuthRetrying] = useState(false);
  const [forceConfigModal, setForceConfigModal] = useState(false);
  const [selectedNamespaces, setSelectedNamespaces] = useState(['all']);
  const [namespaces, setNamespaces] = useState([]);
  const [resourceType, setResourceType] = useState('overview');
  const [allResources, setAllResources] = useState({});
  const [selectedResource, setSelectedResource] = useState(null);
  const [loading, setLoading] = useState(false);
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

  const authOk = authState.ok;

  useEffect(() => {
    fetchConfigStatus();
  }, []);

  // Once a kubeconfig is parsed, verify the credentials actually work before
  // loading the app (unless the user asked to switch configs).
  useEffect(() => {
    if (configStatus.loaded && !forceConfigModal) checkAuth();
  }, [configStatus.loaded, forceConfigModal]);

  useEffect(() => {
    if (authOk) fetchNamespaces();
  }, [authOk]);

  useEffect(() => {
    if (authOk && !STANDALONE_RESOURCE_TYPES.includes(resourceType)) {
      fetchResources();
    }
  }, [selectedNamespaces, resourceType, authOk, namespaces]);

  const fetchConfigStatus = async () => {
    try {
      const response = await axios.get('/api/config/status');
      setConfigStatus(response.data);
      setServerUnreachable(false);
    } catch (err) {
      setServerUnreachable(true);
      setConfigStatus({ loaded: false, contexts: [] });
    } finally {
      setConfigChecked(true);
    }
  };

  // Verify the loaded kubeconfig can authenticate + reach the cluster.
  const checkAuth = async () => {
    try {
      const { data } = await axios.get('/api/config/auth');
      setAuthState({ ...data, checked: true });
      if (!data.ok && data.limited) toast.info(data.message, { title: 'Limited access' });
    } catch (err) {
      setAuthState({
        checked: true, ok: false, reason: 'error',
        message: 'Failed to reach the backend server on port 3001.',
      });
    }
  };

  const retryAuth = async () => {
    setAuthRetrying(true);
    if (serverUnreachable) await fetchConfigStatus();
    await checkAuth();
    setAuthRetrying(false);
  };

  // Switch the active cluster/context (from the pinned rail or the selector).
  const switchContext = async (ctx) => {
    if (!ctx || ctx === configStatus.currentContext) return;
    try {
      const resp = await fetch('/api/config/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextName: ctx }),
      });
      if (!resp.ok) throw new Error('switch failed');
      // Reset the view for the new cluster, then reload config + re-check auth.
      setResourceType('overview');
      setSelectedResource(null);
      setSelectedNamespaces(['all']);
      setAllResources({});
      setNamespaces([]);
      await fetchConfigStatus();
      await checkAuth();
    } catch (err) {
      toast.error(`Failed to switch to ${ctx}`, { title: 'Cluster' });
    }
  };

  // Load a kubeconfig from a user-provided path; returns an error string or null
  const loadConfigFromPath = async (filePath) => {
    try {
      await axios.post('/api/config/load', { filePath });
      setForceConfigModal(false);
      setAuthState({ checked: false, ok: false }); // re-gate on the new config
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
      toast.error('Failed to fetch namespaces', { title: 'Namespaces' });
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
    } catch (err) {
      if (fetchId === fetchIdRef.current) toast.error('Failed to fetch resources', { title: 'Resources' });
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

  // ---- gate: what to render before the app is ready ----
  const showConfigModal = configChecked && !serverUnreachable && (!configStatus.loaded || forceConfigModal);
  const checkingAuth = configStatus.loaded && !forceConfigModal && !authState.checked;
  const showAuthError = configStatus.loaded && !forceConfigModal && authState.checked && !authState.ok;

  return (
    <div className="app-lens">
      {serverUnreachable && configChecked && (
        <AuthErrorModal
          auth={{ reason: 'error', message: 'Cannot reach the backend server on port 3001. Is it running?' }}
          onRetry={retryAuth}
          retrying={authRetrying}
        />
      )}

      {!serverUnreachable && showConfigModal && (
        <KubeConfigModal
          defaultPath={configStatus.defaultPath}
          exists={configStatus.exists}
          onSubmit={loadConfigFromPath}
        />
      )}

      {!serverUnreachable && showAuthError && (
        <AuthErrorModal
          auth={authState}
          onRetry={retryAuth}
          onChangeConfig={() => setForceConfigModal(true)}
          retrying={authRetrying}
        />
      )}

      {authOk && (
        <Assistant
          context={{
            view: resourceType,
            namespaces: selectedNamespaces,
            selected: selectedResource
              ? { type: resourceType, namespace: selectedResource.namespace, name: selectedResource.name }
              : null,
          }}
        />
      )}

      {authOk ? (
        <div className="layout-lens">
          <ClusterRail
            contexts={configStatus.contexts || []}
            currentContext={configStatus.currentContext}
            onSwitch={switchContext}
          />
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
      ) : checkingAuth ? (
        <div className="loading-state">
          <Loader label="Checking cluster authentication…" size={36} />
        </div>
      ) : (
        // A modal (config / auth / server error) is overlaid above; keep a
        // neutral backdrop underneath it.
        <div className="loading-state" />
      )}
    </div>
  );
}

export default App;
