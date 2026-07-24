import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawnSync, spawn, execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
import http from 'http';
import zlib from 'zlib';
import { PassThrough, Writable } from 'stream';
import { WebSocketServer } from 'ws';
import * as k8s from '@kubernetes/client-node';
import yaml from 'js-yaml';
import compression from 'compression';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Fixed backend port. In dev, Vite (3000) proxies /api and /ws here; in the
// Docker image this same server also serves the built UI. Map it at runtime
// with `docker run -p <host>:3001`.
const PORT = 3001;
const CLIENT_DIST = path.join(__dirname, 'client', 'dist');

// Response caching with TTL
const cache = new Map();
const CACHE_TTL = {
  resources: 30000, // 30 seconds
  events: 15000,    // 15 seconds
  namespaces: 60000, // 60 seconds
  yaml: 60000        // 60 seconds
};

const getCacheKey = (prefix, params) => `${prefix}:${JSON.stringify(params)}`;
const setCache = (key, value, ttl) => {
  cache.set(key, { value, expiry: Date.now() + ttl });
};
const getCache = (key) => {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiry) {
    cache.delete(key);
    return null;
  }
  return item.value;
};

app.use(compression());
app.use(cors());
app.use(express.json());

// Serve the built frontend in production (when client/dist exists)
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
}

let currentContext = null;
let kubeConfig = null;

const getKubeConfigPath = () => {
  const envPath = process.env.KUBECONFIG;
  if (envPath) return envPath;
  return path.join(process.env.HOME, '.kube', 'config');
};

const loadKubeConfig = (configPath) => {
  try {
    kubeConfig = new k8s.KubeConfig();
    kubeConfig.loadFromFile(configPath);
    currentContext = kubeConfig.getCurrentContext();
    return true;
  } catch (error) {
    console.error('Failed to load kubeconfig:', error.message);
    return false;
  }
};

// Initialize with default kubeconfig
const defaultPath = getKubeConfigPath();
if (fs.existsSync(defaultPath)) {
  loadKubeConfig(defaultPath);
}

// API Endpoints

app.get('/api/config/status', (req, res) => {
  if (!kubeConfig) {
    const attemptedPath = getKubeConfigPath();
    return res.json({
      loaded: false,
      contexts: [],
      defaultPath: attemptedPath,
      exists: fs.existsSync(attemptedPath)
    });
  }

  res.json({
    loaded: true,
    currentContext,
    contexts: kubeConfig.contexts.map(c => c.name),
    clusters: kubeConfig.clusters.map(c => c.name)
  });
});

app.post('/api/config/load', (req, res) => {
  const { filePath } = req.body;

  if (!fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'File not found' });
  }

  if (loadKubeConfig(filePath)) {
    res.json({
      success: true,
      currentContext,
      contexts: kubeConfig.contexts.map(c => c.name)
    });
  } else {
    res.status(400).json({ error: 'Invalid kubeconfig format' });
  }
});

app.post('/api/config/context', (req, res) => {
  const { contextName } = req.body;

  if (!kubeConfig) {
    return res.status(400).json({ error: 'No kubeconfig loaded' });
  }

  const context = kubeConfig.contexts.find(c => c.name === contextName);
  if (!context) {
    return res.status(400).json({ error: 'Context not found' });
  }

  try {
    // Use kubectl to set the context
    execSync(`kubectl config use-context ${contextName}`);

    // Reload kubeconfig to get updated context
    const configPath = getKubeConfigPath();
    loadKubeConfig(configPath);

    res.json({ success: true, currentContext });
  } catch (error) {
    res.status(500).json({ error: `Failed to set context: ${error.message}` });
  }
});

app.get('/api/namespaces', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const cacheKey = 'namespaces';
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedData);
    }

    const api = kubeConfig.makeApiClient(k8s.CoreV1Api);
    const response = await api.listNamespace();
    const items = response.body.items;
    const namespaces = items.map(ns => ns.metadata.name);
    const details = items.map(ns => ({
      name: ns.metadata.name,
      status: ns.status?.phase || 'Active',
      createdAt: ns.metadata.creationTimestamp,
      labels: ns.metadata.labels || {}
    }));
    const result = { namespaces, details };

    setCache(cacheKey, result, CACHE_TTL.namespaces);
    res.set('X-Cache', 'MISS');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/resources/:namespace', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const namespace = req.params.namespace;
    const cacheKey = getCacheKey('resources', { namespace });

    // Check cache first
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedData);
    }

    const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
    const appsApi = kubeConfig.makeApiClient(k8s.AppsV1Api);
    const netApi = kubeConfig.makeApiClient(k8s.NetworkingV1Api);

    const empty = () => ({ body: { items: [] } });

    // All in-process API calls (no kubectl process spawn), fetched in parallel
    const [pods, services, deployments, statefulSets, daemonSets, configMaps, secrets, serviceAccounts, ingresses, networkPolicies, pvcs] = await Promise.all([
      coreApi.listNamespacedPod(namespace).catch(empty),
      coreApi.listNamespacedService(namespace).catch(empty),
      appsApi.listNamespacedDeployment(namespace).catch(empty),
      appsApi.listNamespacedStatefulSet(namespace).catch(empty),
      appsApi.listNamespacedDaemonSet(namespace).catch(empty),
      coreApi.listNamespacedConfigMap(namespace).catch(empty),
      coreApi.listNamespacedSecret(namespace).catch(empty),
      coreApi.listNamespacedServiceAccount(namespace).catch(empty),
      netApi.listNamespacedIngress(namespace).catch(empty),
      netApi.listNamespacedNetworkPolicy(namespace).catch(empty),
      coreApi.listNamespacedPersistentVolumeClaim(namespace).catch(empty)
    ]);

    const resources = {
      pods: pods.body.items.map(item => formatResource(item, 'Pod')),
      services: services.body.items.map(item => formatResource(item, 'Service')),
      deployments: deployments.body.items.map(item => formatResource(item, 'Deployment')),
      statefulSets: statefulSets.body.items.map(item => formatResource(item, 'StatefulSet')),
      daemonSets: daemonSets.body.items.map(item => formatResource(item, 'DaemonSet')),
      configMaps: configMaps.body.items.map(item => formatResource(item, 'ConfigMap')),
      secrets: secrets.body.items.map(item => formatResource(item, 'Secret')),
      serviceAccounts: serviceAccounts.body.items.map(item => formatResource(item, 'ServiceAccount')),
      ingresses: ingresses.body.items.map(item => formatResource(item, 'Ingress')),
      networkPolicies: networkPolicies.body.items.map(item => formatResource(item, 'NetworkPolicy')),
      persistentVolumeClaims: pvcs.body.items.map(item => formatResource(item, 'PersistentVolumeClaim'))
    };

    // Cache the response
    setCache(cacheKey, resources, CACHE_TTL.resources);
    res.set('X-Cache', 'MISS');
    res.json(resources);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cluster-scoped storage: PersistentVolumes + StorageClasses (not per-namespace)
app.get('/api/storage', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const cacheKey = 'storage';
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedData);
    }

    const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
    const storageApi = kubeConfig.makeApiClient(k8s.StorageV1Api);
    const empty = () => ({ body: { items: [] } });

    const [pvs, scs] = await Promise.all([
      coreApi.listPersistentVolume().catch(empty),
      storageApi.listStorageClass().catch(empty)
    ]);

    const result = {
      persistentVolumes: pvs.body.items.map(item => formatResource(item, 'PersistentVolume')),
      storageClasses: scs.body.items.map(item => formatResource(item, 'StorageClass'))
    };

    setCache(cacheKey, result, CACHE_TTL.resources);
    res.set('X-Cache', 'MISS');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Access Control (RBAC): roles, bindings, cluster roles/bindings, service accounts
app.get('/api/rbac', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const cacheKey = 'rbac';
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedData);
    }

    const rbac = kubeConfig.makeApiClient(k8s.RbacAuthorizationV1Api);
    const core = kubeConfig.makeApiClient(k8s.CoreV1Api);
    const empty = () => ({ body: { items: [] } });

    const [roles, roleBindings, clusterRoles, clusterRoleBindings, sas] = await Promise.all([
      rbac.listRoleForAllNamespaces().catch(empty),
      rbac.listRoleBindingForAllNamespaces().catch(empty),
      rbac.listClusterRole().catch(empty),
      rbac.listClusterRoleBinding().catch(empty),
      core.listServiceAccountForAllNamespaces().catch(empty)
    ]);

    const base = (i) => ({
      name: i.metadata.name,
      namespace: i.metadata.namespace || '-',
      createdAt: i.metadata.creationTimestamp
    });
    const binding = (i) => ({
      ...base(i),
      roleRef: i.roleRef ? `${i.roleRef.kind}/${i.roleRef.name}` : '-',
      subjects: (i.subjects || []).length
    });

    const result = {
      serviceAccounts: sas.body.items.map(i => ({ ...base(i), secrets: (i.secrets || []).length })),
      roles: roles.body.items.map(i => ({ ...base(i), rules: (i.rules || []).length })),
      roleBindings: roleBindings.body.items.map(binding),
      clusterRoles: clusterRoles.body.items.map(i => ({ ...base(i), rules: (i.rules || []).length })),
      clusterRoleBindings: clusterRoleBindings.body.items.map(binding)
    };

    setCache(cacheKey, result, CACHE_TTL.resources);
    res.set('X-Cache', 'MISS');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/resource/:namespace/:kind/:name', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const { namespace, kind, name } = req.params;

    let resource;
    try {
      switch(kind) {
        case 'Pod':
          resource = await kubeConfig.makeApiClient(k8s.CoreV1Api).readNamespacedPod(name, namespace);
          break;
        case 'Service':
          resource = await kubeConfig.makeApiClient(k8s.CoreV1Api).readNamespacedService(name, namespace);
          break;
        case 'Deployment':
          resource = await kubeConfig.makeApiClient(k8s.AppsV1Api).readNamespacedDeployment(name, namespace);
          break;
        case 'StatefulSet':
          resource = await kubeConfig.makeApiClient(k8s.AppsV1Api).readNamespacedStatefulSet(name, namespace);
          break;
        case 'DaemonSet':
          resource = await kubeConfig.makeApiClient(k8s.AppsV1Api).readNamespacedDaemonSet(name, namespace);
          break;
        case 'ConfigMap':
          resource = await kubeConfig.makeApiClient(k8s.CoreV1Api).readNamespacedConfigMap(name, namespace);
          break;
        case 'Secret':
          resource = await kubeConfig.makeApiClient(k8s.CoreV1Api).readNamespacedSecret(name, namespace);
          break;
        case 'ServiceAccount':
          resource = await kubeConfig.makeApiClient(k8s.CoreV1Api).readNamespacedServiceAccount(name, namespace);
          break;
        case 'Role':
          resource = await kubeConfig.makeApiClient(k8s.RbacAuthorizationV1Api).readNamespacedRole(name, namespace);
          break;
        case 'RoleBinding':
          resource = await kubeConfig.makeApiClient(k8s.RbacAuthorizationV1Api).readNamespacedRoleBinding(name, namespace);
          break;
        case 'ClusterRole':
          resource = await kubeConfig.makeApiClient(k8s.RbacAuthorizationV1Api).readClusterRole(name);
          break;
        case 'ClusterRoleBinding':
          resource = await kubeConfig.makeApiClient(k8s.RbacAuthorizationV1Api).readClusterRoleBinding(name);
          break;
        case 'Ingress':
          resource = await kubeConfig.makeApiClient(k8s.NetworkingV1Api).readNamespacedIngress(name, namespace);
          break;
        case 'NetworkPolicy':
          resource = await kubeConfig.makeApiClient(k8s.NetworkingV1Api).readNamespacedNetworkPolicy(name, namespace);
          break;
        case 'PersistentVolumeClaim':
          resource = await kubeConfig.makeApiClient(k8s.CoreV1Api).readNamespacedPersistentVolumeClaim(name, namespace);
          break;
        case 'PersistentVolume':
          resource = await kubeConfig.makeApiClient(k8s.CoreV1Api).readPersistentVolume(name);
          break;
        case 'StorageClass':
          resource = await kubeConfig.makeApiClient(k8s.StorageV1Api).readStorageClass(name);
          break;
        default:
          return res.status(400).json({ error: 'Unsupported resource kind' });
      }
    } catch (apiError) {
      return res.status(404).json({ error: `Resource not found: ${apiError.message}` });
    }

    res.json(resource.body);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/logs/:namespace/:pod', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const { namespace, pod } = req.params;
    const container = req.query.container || undefined;
    const tail = parseInt(req.query.tail) || undefined; // Get last N lines
    const cacheKey = getCacheKey('logs', { namespace, pod, container, tail });

    // Check cache
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedData);
    }

    const api = kubeConfig.makeApiClient(k8s.CoreV1Api);
    let logs = await api.readNamespacedPodLog(pod, namespace, container, tail, true);

    // Handle different response formats from Kubernetes API
    if (logs && typeof logs === 'object' && logs.response) {
      logs = logs.response.body || logs.response || '';
    } else if (logs && typeof logs === 'object' && logs.body) {
      logs = logs.body;
    }

    // Convert buffer to string if needed
    if (Buffer.isBuffer(logs)) {
      logs = logs.toString('utf8');
    }

    logs = logs || 'No logs available';
    const result = { logs };

    setCache(cacheKey, result, CACHE_TTL.yaml);
    res.set('X-Cache', 'MISS');
    res.json(result);
  } catch (error) {
    console.error(`Failed to get logs for ${pod}/${namespace}:`, error.message);
    res.status(500).json({ error: `Failed to get logs: ${error.message}` });
  }
});

app.post('/api/exec', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const { namespace, pod, command, container } = req.body;

    if (!namespace || !pod || !command) {
      return res.status(400).json({ error: 'Missing namespace, pod, or command' });
    }

    // Pass the command as a single argument to `sh -c` (no shell interpolation),
    // so quotes, pipes, redirects and special chars are handled safely.
    const args = ['exec', '-n', namespace, pod];
    if (container) args.push('-c', container);
    args.push('--', 'sh', '-c', command);

    const result = spawnSync('kubectl', args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000
    });

    if (result.error) {
      return res.json({ output: result.error.message, code: -1 });
    }
    const output = (result.stdout || '') + (result.stderr || '');
    res.json({ output, code: result.status == null ? 0 : result.status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// Port forwarding to local (kubectl port-forward svc/<name>)
// ============================================================
const portForwards = new Map(); // id -> { id, namespace, name, remotePort, localPort, proc, status, startedAt, error }
let pfCounter = 0;

app.post('/api/portforward', (req, res) => {
  if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });
  const { namespace, name, remotePort } = req.body;
  const localPort = req.body.localPort ? parseInt(req.body.localPort, 10) : null;

  if (!namespace || !name || !remotePort) {
    return res.status(400).json({ error: 'Missing namespace, name, or remotePort' });
  }

  // No local port -> ":remote" lets kubectl pick a random free local port
  const portArg = localPort ? `${localPort}:${remotePort}` : `:${remotePort}`;
  const proc = spawn('kubectl', ['port-forward', '-n', namespace, `svc/${name}`, portArg]);

  const id = `pf-${++pfCounter}`;
  const entry = { id, namespace, name, remotePort, localPort, proc, status: 'starting', startedAt: Date.now(), error: '' };
  portForwards.set(id, entry);

  let responded = false;
  const respond = (fn) => { if (!responded) { responded = true; fn(); } };

  const timer = setTimeout(() => {
    respond(() => res.status(504).json({ error: 'Timed out starting port-forward' }));
    try { proc.kill(); } catch (e) {}
    portForwards.delete(id);
  }, 10000);

  proc.stdout.on('data', (data) => {
    const m = data.toString().match(/Forwarding from 127\.0\.0\.1:(\d+)/);
    if (m) {
      entry.localPort = parseInt(m[1], 10);
      entry.status = 'active';
      clearTimeout(timer);
      respond(() => res.json({ id, namespace, name, remotePort, localPort: entry.localPort, status: 'active', startedAt: entry.startedAt }));
    }
  });
  proc.stderr.on('data', (data) => { entry.error += data.toString(); });
  proc.on('exit', (code) => {
    entry.status = 'stopped';
    clearTimeout(timer);
    respond(() => res.status(500).json({ error: (entry.error || `port-forward exited (code ${code})`).trim() }));
  });
  proc.on('error', (err) => {
    entry.status = 'error';
    clearTimeout(timer);
    respond(() => res.status(500).json({ error: err.message }));
  });
});

app.get('/api/portforward', (req, res) => {
  const forwards = Array.from(portForwards.values())
    .filter(f => f.status === 'active')
    .map(({ id, namespace, name, remotePort, localPort, status, startedAt }) =>
      ({ id, namespace, name, remotePort, localPort, status, startedAt }));
  res.json({ forwards });
});

app.delete('/api/portforward/:id', (req, res) => {
  const entry = portForwards.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Port-forward not found' });
  try { entry.proc.kill(); } catch (e) {}
  portForwards.delete(req.params.id);
  res.json({ success: true });
});

// Kill all forwards when the server shuts down
const killAllForwards = () => {
  for (const entry of portForwards.values()) {
    try { entry.proc.kill(); } catch (e) {}
  }
};
process.on('exit', killAllForwards);
process.on('SIGINT', () => { killAllForwards(); process.exit(0); });
process.on('SIGTERM', () => { killAllForwards(); process.exit(0); });

app.get('/api/yaml/:namespace/:kind/:name', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const { namespace, kind, name } = req.params;

    let resource;
    try {
      switch(kind) {
        case 'pod':
          resource = await kubeConfig.makeApiClient(k8s.CoreV1Api).readNamespacedPod(name, namespace);
          break;
        case 'service':
          resource = await kubeConfig.makeApiClient(k8s.CoreV1Api).readNamespacedService(name, namespace);
          break;
        case 'deployment':
          resource = await kubeConfig.makeApiClient(k8s.AppsV1Api).readNamespacedDeployment(name, namespace);
          break;
        case 'statefulSet':
          resource = await kubeConfig.makeApiClient(k8s.AppsV1Api).readNamespacedStatefulSet(name, namespace);
          break;
        case 'daemonSet':
          resource = await kubeConfig.makeApiClient(k8s.AppsV1Api).readNamespacedDaemonSet(name, namespace);
          break;
        case 'configMap':
          resource = await kubeConfig.makeApiClient(k8s.CoreV1Api).readNamespacedConfigMap(name, namespace);
          break;
        case 'secret':
          resource = await kubeConfig.makeApiClient(k8s.CoreV1Api).readNamespacedSecret(name, namespace);
          break;
        case 'serviceAccount':
          resource = await kubeConfig.makeApiClient(k8s.CoreV1Api).readNamespacedServiceAccount(name, namespace);
          break;
        case 'role':
          resource = await kubeConfig.makeApiClient(k8s.RbacAuthorizationV1Api).readNamespacedRole(name, namespace);
          break;
        case 'roleBinding':
          resource = await kubeConfig.makeApiClient(k8s.RbacAuthorizationV1Api).readNamespacedRoleBinding(name, namespace);
          break;
        case 'clusterRole':
          resource = await kubeConfig.makeApiClient(k8s.RbacAuthorizationV1Api).readClusterRole(name);
          break;
        case 'clusterRoleBinding':
          resource = await kubeConfig.makeApiClient(k8s.RbacAuthorizationV1Api).readClusterRoleBinding(name);
          break;
        case 'ingress':
          resource = await kubeConfig.makeApiClient(k8s.NetworkingV1Api).readNamespacedIngress(name, namespace);
          break;
        case 'networkPolicy':
          resource = await kubeConfig.makeApiClient(k8s.NetworkingV1Api).readNamespacedNetworkPolicy(name, namespace);
          break;
        case 'persistentVolumeClaim':
          resource = await kubeConfig.makeApiClient(k8s.CoreV1Api).readNamespacedPersistentVolumeClaim(name, namespace);
          break;
        case 'persistentVolume':
          resource = await kubeConfig.makeApiClient(k8s.CoreV1Api).readPersistentVolume(name);
          break;
        case 'storageClass':
          resource = await kubeConfig.makeApiClient(k8s.StorageV1Api).readStorageClass(name);
          break;
        default:
          return res.status(400).json({ error: 'Unsupported resource kind' });
      }
    } catch (apiError) {
      return res.status(404).json({ error: `Resource not found: ${apiError.message}` });
    }

    const yamlString = yaml.dump(resource.body, { indent: 2 });
    res.json({ yaml: yamlString });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events/:namespace?', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const { namespace } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100 per page
    const cacheKey = getCacheKey('events', { namespace, page, limit });

    // Check cache
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedData);
    }

    const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);

    try {
      let response;
      if (namespace && namespace !== 'all') {
        response = await coreApi.listNamespacedEvent(namespace);
      } else {
        response = await coreApi.listEventForAllNamespaces();
      }

      const events = response.body.items.map(event => ({
        message: event.message,
        namespace: event.metadata.namespace,
        type: event.type,
        reason: event.reason,
        involvedObject: event.involvedObject.kind + '/' + event.involvedObject.name,
        source: event.source.component || event.source.host,
        count: event.count,
        firstTimestamp: event.firstTimestamp,
        lastTimestamp: event.lastTimestamp,
        age: Math.floor((new Date() - new Date(event.lastTimestamp)) / 1000)
      }));

      // Sort by lastTimestamp descending (newest first)
      events.sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp));

      // Pagination
      const total = events.length;
      const start = (page - 1) * limit;
      const paginatedEvents = events.slice(start, start + limit);

      const result = {
        events: paginatedEvents,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };

      setCache(cacheKey, result, CACHE_TTL.events);
      res.set('X-Cache', 'MISS');
      res.json(result);
    } catch (error) {
      res.json({ events: [], pagination: { page, limit, total: 0, pages: 0 } });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const fetchNodesWithKubectl = () => {
  try {
    const output = execSync('kubectl get nodes -o json', {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 5000
    });
    const data = JSON.parse(output);
    return data.items || [];
  } catch (error) {
    console.error(`Error fetching nodes with kubectl: ${error.message}`);
    return [];
  }
};

function formatNode(item) {
  const conditions = item.status?.conditions || [];
  const readyCondition = conditions.find(c => c.type === 'Ready');
  const isReady = readyCondition?.status === 'True';

  const labels = item.metadata?.labels || {};
  const roles = Object.keys(labels)
    .filter(key => key.startsWith('node-role.kubernetes.io/'))
    .map(key => key.replace('node-role.kubernetes.io/', ''))
    .filter(Boolean);

  const addresses = item.status?.addresses || [];
  const internalIp = addresses.find(a => a.type === 'InternalIP')?.address || '-';
  const externalIp = addresses.find(a => a.type === 'ExternalIP')?.address || '-';

  const taints = item.spec?.taints || [];

  return {
    name: item.metadata.name,
    status: isReady ? 'Ready' : 'NotReady',
    roles: roles.length > 0 ? roles.join(', ') : 'worker',
    version: item.status?.nodeInfo?.kubeletVersion || '-',
    os: item.status?.nodeInfo?.osImage || '-',
    kernelVersion: item.status?.nodeInfo?.kernelVersion || '-',
    containerRuntime: item.status?.nodeInfo?.containerRuntimeVersion || '-',
    internalIp,
    externalIp,
    cpuCapacity: item.status?.capacity?.cpu || '-',
    memoryCapacity: item.status?.capacity?.memory || '-',
    cpuAllocatable: item.status?.allocatable?.cpu || '-',
    memoryAllocatable: item.status?.allocatable?.memory || '-',
    createdAt: item.metadata.creationTimestamp,
    unschedulable: !!item.spec?.unschedulable,
    taints: taints.length
  };
}

app.get('/api/nodes', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const cacheKey = 'nodes';
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedData);
    }

    const kubectlNodes = fetchNodesWithKubectl();
    const nodes = kubectlNodes.map(formatNode);
    const result = { nodes };

    setCache(cacheKey, result, CACHE_TTL.resources);
    res.set('X-Cache', 'MISS');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const fetchPodsForNodeWithKubectl = (nodeName) => {
  try {
    const output = execSync(
      `kubectl get pods --all-namespaces --field-selector=spec.nodeName=${nodeName} -o json`,
      {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 5000
      }
    );
    const data = JSON.parse(output);
    return data.items || [];
  } catch (error) {
    console.error(`Error fetching pods for node with kubectl: ${error.message}`);
    return [];
  }
};

function formatPodForNode(item) {
  const containerStatuses = item.status?.containerStatuses || [];
  const readyCount = containerStatuses.filter(c => c.ready).length;
  const restarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount || 0), 0);

  return {
    name: item.metadata.name,
    namespace: item.metadata.namespace,
    status: item.status?.phase || 'Unknown',
    ready: `${readyCount}/${containerStatuses.length}`,
    restarts,
    createdAt: item.metadata.creationTimestamp
  };
}

app.get('/api/nodes/:name/pods', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const { name } = req.params;
    const cacheKey = getCacheKey('node-pods', { name });

    const cachedData = getCache(cacheKey);
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedData);
    }

    const kubectlPods = fetchPodsForNodeWithKubectl(name);
    const pods = kubectlPods.map(formatPodForNode);
    const result = { pods };

    setCache(cacheKey, result, CACHE_TTL.resources);
    res.set('X-Cache', 'MISS');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------------
// Helm — read release storage directly via the Kubernetes API.
//
// Helm has no official JS SDK, but it persists each release revision as a
// Secret of type `helm.sh/release.v1` (labeled `owner=helm`) in the release's
// namespace. The `data.release` field is base64(gzip(json)) — and Kubernetes
// base64-encodes Secret data on top of that. Decoding it gives us everything
// `helm list` / `helm get values` / `helm get manifest` would return, with no
// CLI dependency.
// ------------------------------------------------------------------
const HELM_RELEASE_MAGIC_GZIP = [0x1f, 0x8b, 0x08];

// Decode a Helm release Secret into the stored release object.
const decodeHelmRelease = (secret) => {
  const encoded = secret?.data?.release;
  if (!encoded) return null;
  try {
    // Layer 1: Kubernetes returns Secret data base64-encoded → the Helm blob.
    let buf = Buffer.from(encoded, 'base64');
    // Layer 2: Helm itself base64-encodes gzip(json).
    buf = Buffer.from(buf.toString('utf-8'), 'base64');
    // Helm gzips by default (magic 0x1f 0x8b 0x08); older/plain blobs are raw JSON.
    if (buf.length >= 3 &&
        buf[0] === HELM_RELEASE_MAGIC_GZIP[0] &&
        buf[1] === HELM_RELEASE_MAGIC_GZIP[1] &&
        buf[2] === HELM_RELEASE_MAGIC_GZIP[2]) {
      buf = zlib.gunzipSync(buf);
    }
    return JSON.parse(buf.toString('utf-8'));
  } catch (error) {
    console.error(`Error decoding helm release ${secret?.metadata?.name}: ${error.message}`);
    return null;
  }
};

// List all Helm release Secrets, optionally scoped to a namespace.
const listHelmReleaseSecrets = async (namespace) => {
  const core = kubeConfig.makeApiClient(k8s.CoreV1Api);
  const labelSelector = 'owner=helm';
  const resp = namespace
    ? await core.listNamespacedSecret(namespace, undefined, undefined, undefined, undefined, labelSelector)
    : await core.listSecretForAllNamespaces(undefined, undefined, undefined, labelSelector);
  return resp.body.items || [];
};

// Decode + keep only the latest revision per (namespace, name).
const latestHelmReleases = (secrets) => {
  const latest = new Map();
  for (const secret of secrets) {
    const rel = decodeHelmRelease(secret);
    if (!rel) continue;
    const key = `${rel.namespace}/${rel.name}`;
    const prev = latest.get(key);
    if (!prev || (rel.version || 0) > (prev.version || 0)) {
      latest.set(key, rel);
    }
  }
  return [...latest.values()];
};

// Find the latest revision of one named release (for values/manifest lookups).
const getLatestHelmRelease = async (namespace, name) => {
  const secrets = await listHelmReleaseSecrets(namespace);
  const releases = latestHelmReleases(secrets).filter(r => r.name === name);
  return releases[0] || null;
};

app.get('/api/helm/releases', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const cacheKey = 'helm-releases';
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedData);
    }

    const secrets = await listHelmReleaseSecrets();
    const releases = latestHelmReleases(secrets);

    const result = {
      releases: releases.map(r => {
        const chartMeta = r.chart?.metadata || {};
        return {
          name: r.name,
          namespace: r.namespace,
          revision: String(r.version ?? ''),
          updated: r.info?.last_deployed || r.info?.first_deployed || '',
          status: r.info?.status || '',
          chart: chartMeta.name ? `${chartMeta.name}-${chartMeta.version}` : '',
          appVersion: chartMeta.appVersion || ''
        };
      })
    };

    setCache(cacheKey, result, CACHE_TTL.resources);
    res.set('X-Cache', 'MISS');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: `Failed to list helm releases: ${error.message}` });
  }
});

app.get('/api/helm/releases/:namespace/:name/values', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const { namespace, name } = req.params;
    const release = await getLatestHelmRelease(namespace, name);
    if (!release) return res.status(404).json({ error: `Release ${name} not found in ${namespace}` });

    // `helm get values` returns the user-supplied values (release.config).
    const values = release.config || {};
    const output = Object.keys(values).length ? yaml.dump(values) : '{}\n';
    res.json({ yaml: output });
  } catch (error) {
    res.status(500).json({ error: `Failed to get values: ${error.message}` });
  }
});

app.get('/api/helm/releases/:namespace/:name/manifest', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const { namespace, name } = req.params;
    const release = await getLatestHelmRelease(namespace, name);
    if (!release) return res.status(404).json({ error: `Release ${name} not found in ${namespace}` });

    res.json({ yaml: release.manifest || '' });
  } catch (error) {
    res.status(500).json({ error: `Failed to get manifest: ${error.message}` });
  }
});

const CRD_JSONPATH = '{range .items[*]}{.metadata.name}{"\\t"}{.spec.group}{"\\t"}{.spec.names.kind}{"\\t"}{.spec.names.plural}{"\\t"}{.spec.names.singular}{"\\t"}{.spec.scope}{"\\t"}{.metadata.creationTimestamp}{"\\t"}{.spec.versions[?(@.storage==true)].name}{"\\n"}{end}';

const fetchCrdsWithKubectl = async () => {
  try {
    // execFile (no shell) + async so we never block the event loop
    const { stdout: output } = await execFileAsync(
      'kubectl',
      ['get', 'crds', '-o', `jsonpath=${CRD_JSONPATH}`],
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 15000 }
    );
    return output
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, group, kind, plural, singular, scope, createdAt, version] = line.split('\t');
        return { name, group, kind, plural, singular, scope, createdAt, version: version || '-' };
      });
  } catch (error) {
    console.error(`Error fetching CRDs: ${error.message}`);
    return [];
  }
};

app.get('/api/customresources', async (req, res) => {
  try {
    const cacheKey = 'crds';
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedData);
    }

    const crds = await fetchCrdsWithKubectl();
    const result = { crds };

    setCache(cacheKey, result, CACHE_TTL.namespaces);
    res.set('X-Cache', 'MISS');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/customresources/:group/:version/:plural', async (req, res) => {
  try {
    const { group, version, plural } = req.params;
    const cacheKey = getCacheKey('cr-instances', { group, version, plural });

    const cachedData = getCache(cacheKey);
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedData);
    }

    // execFile (no shell) + async so a slow/large CR list never blocks the event loop
    const { stdout: output } = await execFileAsync(
      'kubectl',
      ['get', `${plural}.${version}.${group}`, '-A', '-o', 'json'],
      { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024, timeout: 20000 }
    );
    const data = JSON.parse(output);
    const items = (data.items || []).map(item => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace || '-',
      createdAt: item.metadata.creationTimestamp
    }));

    const result = { items };
    setCache(cacheKey, result, CACHE_TTL.resources);
    res.set('X-Cache', 'MISS');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message, items: [] });
  }
});

// Full YAML for a single custom-resource instance
app.get('/api/customresource/:group/:version/:plural/:name', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });
    const { group, version, plural, name } = req.params;
    const namespace = req.query.namespace;

    const args = ['get', `${plural}.${version}.${group}`, name];
    if (namespace && namespace !== '-') args.push('-n', namespace);
    args.push('-o', 'yaml');

    // async execFile (no shell) so a single-resource fetch never blocks the event loop
    const { stdout } = await execFileAsync('kubectl', args, {
      encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 15000
    });
    res.json({ yaml: stdout || '' });
  } catch (error) {
    const msg = (error.stderr || error.message || 'Failed to get resource').trim();
    res.status(500).json({ error: msg });
  }
});

const parseCpuCores = (s) => {
  if (!s || s === '-') return 0;
  if (String(s).endsWith('m')) return parseInt(s) / 1000;
  return parseFloat(s) || 0;
};

// returns bytes
const parseMemBytes = (s) => {
  if (!s || s === '-') return 0;
  const m = String(s).match(/^(\d+(?:\.\d+)?)\s*([KMGTP]i)?$/);
  if (!m) return parseFloat(s) || 0;
  const val = parseFloat(m[1]);
  const unit = m[2];
  const mult = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5 };
  return val * (mult[unit] || 1);
};

app.get('/api/cluster/summary', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const cacheKey = 'cluster-summary';
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedData);
    }

    // Kubernetes version
    let serverVersion = 'unknown';
    let platform = '';
    try {
      const v = JSON.parse(execSync('kubectl version -o json', { encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024, timeout: 8000 }));
      serverVersion = v.serverVersion?.gitVersion || 'unknown';
      platform = v.serverVersion?.platform || '';
    } catch (e) { /* ignore */ }

    // Nodes (reuse existing helpers)
    const nodes = fetchNodesWithKubectl().map(formatNode);
    const nodeSummary = {
      total: nodes.length,
      ready: nodes.filter(n => n.status === 'Ready').length,
      notReady: nodes.filter(n => n.status !== 'Ready').length
    };

    const roles = {};
    let cpuCapacity = 0, cpuAllocatable = 0, memCapacity = 0, memAllocatable = 0;
    const versions = new Set();
    const osImages = new Set();
    for (const n of nodes) {
      String(n.roles || 'worker').split(',').map(r => r.trim()).filter(Boolean).forEach(r => {
        roles[r] = (roles[r] || 0) + 1;
      });
      cpuCapacity += parseCpuCores(n.cpuCapacity);
      cpuAllocatable += parseCpuCores(n.cpuAllocatable);
      memCapacity += parseMemBytes(n.memoryCapacity);
      memAllocatable += parseMemBytes(n.memoryAllocatable);
      if (n.version) versions.add(n.version);
      if (n.os) osImages.add(n.os);
    }

    // Pod phases
    const podPhases = { Running: 0, Pending: 0, Succeeded: 0, Failed: 0, Unknown: 0 };
    let podTotal = 0;
    try {
      const out = execSync(
        `kubectl get pods -A -o jsonpath='{range .items[*]}{.status.phase}{"\\n"}{end}'`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 12000 }
      );
      out.split('\n').filter(Boolean).forEach(p => {
        podPhases[p] = (podPhases[p] || 0) + 1;
        podTotal++;
      });
    } catch (e) { /* ignore */ }

    // Namespace count
    let namespaceCount = 0;
    try {
      const out = execSync(
        `kubectl get ns -o jsonpath='{range .items[*]}{.metadata.name}{"\\n"}{end}'`,
        { encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024, timeout: 8000 }
      );
      namespaceCount = out.split('\n').filter(Boolean).length;
    } catch (e) { /* ignore */ }

    const result = {
      currentContext: currentContext,
      serverVersion,
      platform,
      contexts: kubeConfig.contexts.map(c => c.name),
      clusters: kubeConfig.clusters.map(c => c.name),
      nodes: nodeSummary,
      roles,
      capacity: {
        cpuCapacity: +cpuCapacity.toFixed(1),
        cpuAllocatable: +cpuAllocatable.toFixed(1),
        memCapacityBytes: memCapacity,
        memAllocatableBytes: memAllocatable
      },
      versions: Array.from(versions),
      osImages: Array.from(osImages),
      pods: { total: podTotal, phases: podPhases },
      namespaceCount
    };

    setCache(cacheKey, result, CACHE_TTL.resources);
    res.set('X-Cache', 'MISS');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const parseCpuMilli = (s) => {
  if (!s) return 0;
  s = String(s);
  if (s.endsWith('n')) return parseFloat(s) / 1e6;   // nanocores
  if (s.endsWith('u')) return parseFloat(s) / 1e3;   // microcores
  if (s.endsWith('m')) return parseFloat(s);         // millicores
  return parseFloat(s) * 1000;                        // cores
};

const fetchMetricsRaw = (path) => {
  const out = execSync(`kubectl get --raw "${path}"`, {
    encoding: 'utf-8',
    maxBuffer: 30 * 1024 * 1024,
    timeout: 10000
  });
  return JSON.parse(out);
};

const summarizePodMetrics = (item) => {
  let cpuMilli = 0;
  let memBytes = 0;
  const containers = (item.containers || []).map(c => {
    const cm = parseCpuMilli(c.usage?.cpu);
    const mb = parseMemBytes(c.usage?.memory);
    cpuMilli += cm;
    memBytes += mb;
    return { name: c.name, cpuMilli: +cm.toFixed(1), memBytes: mb };
  });
  return {
    cpuMilli: +cpuMilli.toFixed(1),
    memBytes,
    containers,
    timestamp: item.timestamp,
    window: item.window
  };
};

// Metrics for all pods (optionally scoped to a namespace) — keyed by "namespace/name"
app.get('/api/metrics/pods/:namespace?', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });
    const { namespace } = req.params;
    const cacheKey = getCacheKey('metrics-pods', { namespace: namespace || 'all' });

    const cachedData = getCache(cacheKey);
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedData);
    }

    const path = namespace && namespace !== 'all'
      ? `/apis/metrics.k8s.io/v1beta1/namespaces/${namespace}/pods`
      : `/apis/metrics.k8s.io/v1beta1/pods`;

    let data;
    try {
      data = fetchMetricsRaw(path);
    } catch (err) {
      return res.json({ metrics: {}, available: false });
    }

    const metrics = {};
    (data.items || []).forEach(item => {
      const key = `${item.metadata.namespace}/${item.metadata.name}`;
      metrics[key] = summarizePodMetrics(item);
    });

    const result = { metrics, available: true };
    setCache(cacheKey, result, 8000);
    res.set('X-Cache', 'MISS');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message, metrics: {} });
  }
});

// Metrics for a single pod (used for live polling in the detail drawer)
app.get('/api/metrics/pod/:namespace/:pod', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });
    const { namespace, pod } = req.params;

    let item;
    try {
      item = fetchMetricsRaw(`/apis/metrics.k8s.io/v1beta1/namespaces/${namespace}/pods/${pod}`);
    } catch (err) {
      return res.json({ available: false });
    }

    res.json({ available: true, ...summarizePodMetrics(item) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Live metrics + capacity for a single node (for node detail graphs)
app.get('/api/metrics/node/:name', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });
    const { name } = req.params;

    let usage;
    try {
      const m = fetchMetricsRaw(`/apis/metrics.k8s.io/v1beta1/nodes/${name}`);
      usage = m.usage || {};
    } catch (err) {
      return res.json({ available: false });
    }

    let cpuCap = '0', memCap = '0', cpuAlloc = '0', memAlloc = '0';
    try {
      const out = execSync(
        `kubectl get node ${name} -o jsonpath='{.status.capacity.cpu}|{.status.capacity.memory}|{.status.allocatable.cpu}|{.status.allocatable.memory}'`,
        { encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024, timeout: 8000 }
      );
      [cpuCap, memCap, cpuAlloc, memAlloc] = out.split('|');
    } catch (e) { /* ignore */ }

    res.json({
      available: true,
      cpuMilli: +parseCpuMilli(usage.cpu).toFixed(1),
      memBytes: parseMemBytes(usage.memory),
      cpuCapacityMilli: parseCpuMilli(cpuCap),
      memCapacityBytes: parseMemBytes(memCap),
      cpuAllocatableMilli: parseCpuMilli(cpuAlloc),
      memAllocatableBytes: parseMemBytes(memAlloc)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/topology/:namespace', async (req, res) => {
  try {
    if (!kubeConfig) return res.status(400).json({ error: 'No kubeconfig loaded' });

    const { namespace } = req.params;
    const cacheKey = getCacheKey('topology', { namespace });

    const cachedData = getCache(cacheKey);
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.json(cachedData);
    }

    // Namespaced resources across workloads / network / storage / config / rbac.
    // async execFile (no shell) so a big fetch never blocks the event loop.
    let data;
    try {
      const { stdout } = await execFileAsync('kubectl', [
        'get',
        'deployments,replicasets,statefulsets,daemonsets,jobs,cronjobs,pods,' +
        'services,ingresses,networkpolicies,configmaps,secrets,serviceaccounts,' +
        'persistentvolumeclaims,roles,rolebindings',
        '-n', namespace, '-o', 'json'
      ], { encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024, timeout: 25000 });
      data = JSON.parse(stdout);
    } catch (err) {
      return res.status(500).json({ error: `Failed to build topology: ${(err.stderr || err.message).trim()}`, nodes: [], edges: [] });
    }

    const items = data.items || [];
    const byKind = {};
    for (const it of items) {
      if (it.kind) (byKind[it.kind] = byKind[it.kind] || []).push(it);
    }
    const get = (k) => byKind[k] || [];

    const CATEGORY = {
      Deployment: 'workload', ReplicaSet: 'workload', StatefulSet: 'workload',
      DaemonSet: 'workload', Job: 'workload', CronJob: 'workload', Pod: 'workload',
      Service: 'network', Ingress: 'network', NetworkPolicy: 'network',
      PersistentVolumeClaim: 'storage', PersistentVolume: 'storage', StorageClass: 'storage',
      ConfigMap: 'config', Secret: 'config',
      ServiceAccount: 'rbac', Role: 'rbac', ClusterRole: 'rbac', RoleBinding: 'rbac'
    };

    const workloadStatus = (item) => {
      const s = item.status || {};
      const spec = item.spec || {};
      const kind = item.kind;
      if (kind === 'Pod') return s.phase || 'Unknown';
      if (kind === 'PersistentVolumeClaim' || kind === 'PersistentVolume') return s.phase || 'Unknown';
      if (['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job'].includes(kind)) {
        const desired = spec.replicas != null ? spec.replicas
          : (s.desiredNumberScheduled != null ? s.desiredNumberScheduled : null);
        const ready = s.readyReplicas != null ? s.readyReplicas
          : (s.numberReady != null ? s.numberReady : (s.succeeded != null ? s.succeeded : 0));
        if (desired == null) return 'Ready';
        return ready >= desired && desired > 0 ? 'Ready' : (ready === 0 && desired === 0 ? 'Ready' : 'Pending');
      }
      return 'Active';
    };

    const idFor = (kind, name) => `${kind}/${name}`;
    const nodes = [];
    const nodeIndex = new Map();
    const edges = [];
    const rawByKind = new Map(items.map(it => [idFor(it.kind, it.metadata?.name), it]));

    const addNode = (kind, name, extra = {}) => {
      if (!kind || !name) return null;
      const id = idFor(kind, name);
      if (!nodeIndex.has(id)) {
        const item = rawByKind.get(id);
        const node = {
          id, kind, name,
          category: CATEGORY[kind] || 'workload',
          ...extra,
          status: item ? workloadStatus(item) : (extra.status || 'Active')
        };
        nodeIndex.set(id, node);
        nodes.push(node);
      }
      return id;
    };
    const addEdge = (source, target, type) => {
      if (source && target) edges.push({ source, target, type });
    };

    // ---- workloads + pods (always shown) ----
    const WORKLOAD_KINDS = ['Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'Pod'];
    for (const kind of WORKLOAD_KINDS) {
      for (const item of get(kind)) {
        const id = addNode(kind, item.metadata.name);
        for (const owner of item.metadata?.ownerReferences || []) {
          addEdge(idFor(owner.kind, owner.name), id, 'owns');
        }
      }
    }

    const pods = get('Pod');

    // ---- network: services, ingresses, network policies ----
    for (const svc of get('Service')) {
      const svcId = addNode('Service', svc.metadata.name);
      const selector = svc.spec?.selector;
      if (selector && Object.keys(selector).length) {
        for (const pod of pods) {
          const labels = pod.metadata?.labels || {};
          if (Object.entries(selector).every(([k, v]) => labels[k] === v)) {
            addEdge(idFor('Pod', pod.metadata.name), svcId, 'service');
          }
        }
      }
    }
    for (const ing of get('Ingress')) {
      const ingId = addNode('Ingress', ing.metadata.name);
      const spec = ing.spec || {};
      const svcNames = new Set();
      if (spec.defaultBackend?.service?.name) svcNames.add(spec.defaultBackend.service.name);
      (spec.rules || []).forEach(r => (r.http?.paths || []).forEach(p => {
        if (p.backend?.service?.name) svcNames.add(p.backend.service.name);
      }));
      svcNames.forEach(n => addEdge(idFor('Service', n), ingId, 'network'));
    }
    for (const np of get('NetworkPolicy')) {
      const npId = addNode('NetworkPolicy', np.metadata.name);
      const sel = np.spec?.podSelector?.matchLabels || {};
      for (const pod of pods) {
        const labels = pod.metadata?.labels || {};
        if (Object.entries(sel).every(([k, v]) => labels[k] === v)) {
          addEdge(idFor('Pod', pod.metadata.name), npId, 'network');
        }
      }
    }

    // ---- storage: pvc -> pv / storageclass, pod -> pvc ----
    const pvcNames = new Set();
    const scNames = new Set();
    const pvNames = new Set();
    for (const pvc of get('PersistentVolumeClaim')) {
      const pvcId = addNode('PersistentVolumeClaim', pvc.metadata.name);
      pvcNames.add(pvc.metadata.name);
      if (pvc.spec?.volumeName) { pvNames.add(pvc.spec.volumeName); }
      if (pvc.spec?.storageClassName) {
        scNames.add(pvc.spec.storageClassName);
        addEdge(pvcId, addNode('StorageClass', pvc.spec.storageClassName), 'storage');
      }
    }

    // ---- config + rbac + storage refs discovered from pod specs ----
    const cmSet = new Set(), secretSet = new Set(), saSet = new Set();
    const podRefs = (pod) => {
      const spec = pod.spec || {};
      const containers = [...(spec.containers || []), ...(spec.initContainers || [])];
      (spec.volumes || []).forEach(v => {
        if (v.configMap?.name) cmSet.add(v.configMap.name);
        if (v.secret?.secretName) secretSet.add(v.secret.secretName);
        if (v.persistentVolumeClaim?.claimName) pvcNames.add(v.persistentVolumeClaim.claimName);
        (v.projected?.sources || []).forEach(s => {
          if (s.configMap?.name) cmSet.add(s.configMap.name);
          if (s.secret?.name) secretSet.add(s.secret.name);
        });
      });
      containers.forEach(c => {
        (c.envFrom || []).forEach(ef => {
          if (ef.configMapRef?.name) cmSet.add(ef.configMapRef.name);
          if (ef.secretRef?.name) secretSet.add(ef.secretRef.name);
        });
        (c.env || []).forEach(e => {
          if (e.valueFrom?.configMapKeyRef?.name) cmSet.add(e.valueFrom.configMapKeyRef.name);
          if (e.valueFrom?.secretKeyRef?.name) secretSet.add(e.valueFrom.secretKeyRef.name);
        });
      });
      (spec.imagePullSecrets || []).forEach(s => { if (s.name) secretSet.add(s.name); });
      return spec.serviceAccountName || spec.serviceAccount || null;
    };

    for (const pod of pods) {
      const podId = idFor('Pod', pod.metadata.name);
      const beforeCm = new Set(cmSet), beforeSec = new Set(secretSet);
      const sa = podRefs(pod);
      // edges: pod -> each newly-referenced cm/secret it introduced
      for (const name of pod.spec?.volumes?.map(v => v.persistentVolumeClaim?.claimName).filter(Boolean) || []) {
        addEdge(podId, idFor('PersistentVolumeClaim', name), 'storage');
      }
      // re-derive this pod's own references for precise edges
      const spec = pod.spec || {};
      const containers = [...(spec.containers || []), ...(spec.initContainers || [])];
      const myCm = new Set(), mySec = new Set();
      (spec.volumes || []).forEach(v => {
        if (v.configMap?.name) myCm.add(v.configMap.name);
        if (v.secret?.secretName) mySec.add(v.secret.secretName);
        (v.projected?.sources || []).forEach(s => {
          if (s.configMap?.name) myCm.add(s.configMap.name);
          if (s.secret?.name) mySec.add(s.secret.name);
        });
      });
      containers.forEach(c => {
        (c.envFrom || []).forEach(ef => {
          if (ef.configMapRef?.name) myCm.add(ef.configMapRef.name);
          if (ef.secretRef?.name) mySec.add(ef.secretRef.name);
        });
        (c.env || []).forEach(e => {
          if (e.valueFrom?.configMapKeyRef?.name) myCm.add(e.valueFrom.configMapKeyRef.name);
          if (e.valueFrom?.secretKeyRef?.name) mySec.add(e.valueFrom.secretKeyRef.name);
        });
      });
      (spec.imagePullSecrets || []).forEach(s => { if (s.name) mySec.add(s.name); });
      myCm.forEach(n => addEdge(podId, addNode('ConfigMap', n), 'config'));
      mySec.forEach(n => addEdge(podId, addNode('Secret', n), 'config'));
      if (sa) { saSet.add(sa); addEdge(podId, addNode('ServiceAccount', sa), 'rbac'); }
    }

    // rbac chain: serviceaccount -> rolebinding -> role
    for (const rb of get('RoleBinding')) {
      const subjects = rb.subjects || [];
      const linkedSAs = subjects.filter(s => s.kind === 'ServiceAccount' && saSet.has(s.name));
      if (!linkedSAs.length) continue;
      const rbId = addNode('RoleBinding', rb.metadata.name);
      linkedSAs.forEach(s => addEdge(idFor('ServiceAccount', s.name), rbId, 'rbac'));
      const ref = rb.roleRef;
      if (ref?.name) addEdge(rbId, addNode(ref.kind || 'Role', ref.name), 'rbac');
    }

    // ---- cluster-scoped storage (PVs + StorageClasses) bound to this namespace ----
    if (pvNames.size || scNames.size) {
      try {
        const { stdout } = await execFileAsync('kubectl', ['get', 'pv,storageclass', '-o', 'json'],
          { encoding: 'utf-8', maxBuffer: 40 * 1024 * 1024, timeout: 15000 });
        const cluster = JSON.parse(stdout).items || [];
        for (const it of cluster) {
          if (it.kind === 'PersistentVolume' && pvNames.has(it.metadata.name)) {
            rawByKind.set(idFor('PersistentVolume', it.metadata.name), it);
            const pvId = addNode('PersistentVolume', it.metadata.name);
            // pvc -> pv
            const claim = it.spec?.claimRef;
            if (claim && claim.namespace === namespace) {
              addEdge(idFor('PersistentVolumeClaim', claim.name), pvId, 'storage');
            }
            if (it.spec?.storageClassName) {
              addEdge(pvId, addNode('StorageClass', it.spec.storageClassName), 'storage');
            }
          }
          if (it.kind === 'StorageClass' && scNames.has(it.metadata.name)) {
            rawByKind.set(idFor('StorageClass', it.metadata.name), it);
            // ensure node exists (status Active) if referenced
            addNode('StorageClass', it.metadata.name);
          }
        }
      } catch { /* cluster-scoped fetch optional; skip on RBAC failure */ }
    }

    // keep only edges whose endpoints exist as nodes; dedupe
    const seen = new Set();
    const validEdges = edges.filter(e => {
      if (!nodeIndex.has(e.source) || !nodeIndex.has(e.target)) return false;
      const key = `${e.source}|${e.target}|${e.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const result = { nodes, edges: validEdges };
    setCache(cacheKey, result, CACHE_TTL.resources);
    res.set('X-Cache', 'MISS');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message, nodes: [], edges: [] });
  }
});

// Derive a simple status for a single container from its containerStatus.
// running -> 'running', waiting(bad reason)/terminated(non-zero) -> 'failed',
// waiting(other) -> 'pending', missing status -> 'unknown'
function containerState(cs) {
  if (!cs || !cs.state) return 'unknown';
  if (cs.state.running) return 'running';
  if (cs.state.terminated) {
    return cs.state.terminated.exitCode === 0 ? 'running' : 'failed';
  }
  if (cs.state.waiting) {
    const reason = cs.state.waiting.reason || '';
    const bad = /CrashLoopBackOff|Error|ImagePull|InvalidImageName|CreateContainer|RunContainer|CreateContainerConfigError/i.test(reason);
    return bad ? 'failed' : 'pending';
  }
  return 'unknown';
}

function formatResource(item, kind) {
  const resolvedKind = kind || item.kind;
  const out = {
    name: item.metadata.name,
    namespace: item.metadata.namespace,
    kind: resolvedKind,
    createdAt: item.metadata.creationTimestamp,
    status: getResourceStatus(item, resolvedKind)
  };
  if (resolvedKind === 'Pod') {
    out.node = item.spec?.nodeName || null;
    out.containerNames = (item.spec?.containers || []).map(c => c.name);
    const cs = item.status?.containerStatuses || [];
    const byName = {};
    cs.forEach(c => { byName[c.name] = c; });
    out.containerStates = (item.spec?.containers || []).map(c => ({
      name: c.name,
      status: containerState(byName[c.name])
    }));
    out.containers = out.containerNames.length || cs.length;
    out.restarts = cs.reduce((s, c) => s + (c.restartCount || 0), 0);
  }
  if (resolvedKind === 'ConfigMap') {
    out.dataKeys = Object.keys(item.data || {}).length + Object.keys(item.binaryData || {}).length;
  }
  if (resolvedKind === 'Secret') {
    out.secretType = item.type || 'Opaque';
    out.dataKeys = Object.keys(item.data || {}).length;
  }
  if (resolvedKind === 'ServiceAccount') {
    out.saSecrets = (item.secrets || []).length;
  }
  if (resolvedKind === 'NetworkPolicy') {
    out.policyTypes = (item.spec?.policyTypes || []).join(', ') || '-';
  }
  if (resolvedKind === 'Ingress') {
    out.ingressClass = item.spec?.ingressClassName || '-';
    out.hosts = (item.spec?.rules || []).map(r => r.host).filter(Boolean).join(', ') || '-';
  }
  if (resolvedKind === 'PersistentVolumeClaim') {
    out.capacity = item.status?.capacity?.storage || item.spec?.resources?.requests?.storage || '-';
    out.storageClass = item.spec?.storageClassName || '-';
    out.volume = item.spec?.volumeName || '-';
    out.accessModes = (item.spec?.accessModes || []).join(',') || '-';
  }
  if (resolvedKind === 'PersistentVolume') {
    out.capacity = item.spec?.capacity?.storage || '-';
    out.storageClass = item.spec?.storageClassName || '-';
    out.reclaimPolicy = item.spec?.persistentVolumeReclaimPolicy || '-';
    out.claim = item.spec?.claimRef ? `${item.spec.claimRef.namespace}/${item.spec.claimRef.name}` : '-';
    out.accessModes = (item.spec?.accessModes || []).join(',') || '-';
  }
  if (resolvedKind === 'StorageClass') {
    out.provisioner = item.provisioner || '-';
    out.reclaimPolicy = item.reclaimPolicy || 'Delete';
    out.bindingMode = item.volumeBindingMode || 'Immediate';
  }
  return out;
}

// `kind` is passed explicitly because list items from the client library
// don't carry a per-item `kind` field.
function getResourceStatus(item, kind) {
  const status = item.status || {};
  if (kind === 'Pod') {
    return status.phase || 'Unknown';
  }
  if (kind === 'Deployment' || kind === 'StatefulSet' || kind === 'DaemonSet') {
    const ready = status.readyReplicas != null ? status.readyReplicas
      : (status.numberReady != null ? status.numberReady : 0);
    const desired = status.replicas != null ? status.replicas
      : (status.desiredNumberScheduled != null ? status.desiredNumberScheduled : 0);
    return `${ready}/${desired}`;
  }
  if (kind === 'Service') {
    return item.spec?.type || 'Unknown';
  }
  if (kind === 'PersistentVolume' || kind === 'PersistentVolumeClaim') {
    return status.phase || 'Unknown';
  }
  if (kind === 'StorageClass') {
    return '';
  }
  return 'Unknown';
}

// SPA fallback: serve index.html for non-API routes (production build)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  const indexFile = path.join(CLIENT_DIST, 'index.html');
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  next();
});

// ============================================================
// Interactive shell over WebSocket (real TTY via k8s exec)
// ============================================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/exec' });

wss.on('connection', async (browserWs, req) => {
  if (!kubeConfig) {
    browserWs.close(1011, 'No kubeconfig loaded');
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const namespace = url.searchParams.get('namespace');
  const pod = url.searchParams.get('pod');
  const container = url.searchParams.get('container') || undefined;

  if (!namespace || !pod) {
    browserWs.close(1008, 'Missing namespace or pod');
    return;
  }

  const exec = new k8s.Exec(kubeConfig);
  const stdin = new PassThrough();
  const toBrowser = (chunk) => {
    if (browserWs.readyState === 1) browserWs.send(chunk.toString('utf-8'));
  };
  const stdout = new Writable({ write(chunk, enc, cb) { toBrowser(chunk); cb(); } });
  const stderr = new Writable({ write(chunk, enc, cb) { toBrowser(chunk); cb(); } });

  let k8sWs = null;

  // Resize is sent to the k8s exec stream on channel 4 (v4/v5 binary protocol)
  const sendResize = (cols, rows) => {
    if (!k8sWs || k8sWs.readyState !== 1 || !cols || !rows) return;
    try {
      const payload = Buffer.from(JSON.stringify({ Width: cols, Height: rows }));
      k8sWs.send(Buffer.concat([Buffer.from([4]), payload]));
    } catch (e) { /* ignore */ }
  };

  try {
    k8sWs = await exec.exec(
      namespace,
      pod,
      container,
      ['sh', '-c', 'exec $(command -v bash || command -v sh || echo /bin/sh)'],
      stdout,
      stderr,
      stdin,
      true, // tty
      (status) => {
        if (status?.status === 'Failure' && browserWs.readyState === 1) {
          browserWs.send(`\r\n\x1b[31m${status.message || 'Shell exited'}\x1b[0m\r\n`);
        }
      }
    );
  } catch (err) {
    if (browserWs.readyState === 1) {
      browserWs.send(`\r\n\x1b[31mFailed to start shell: ${err.message}\x1b[0m\r\n`);
    }
    browserWs.close();
    return;
  }

  k8sWs.on('close', () => { try { browserWs.close(); } catch (e) {} });
  k8sWs.on('error', () => { try { browserWs.close(); } catch (e) {} });

  browserWs.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (msg.type === 'data') {
      stdin.write(msg.data);
    } else if (msg.type === 'resize') {
      sendResize(msg.cols, msg.rows);
    }
  });

  browserWs.on('close', () => {
    try { stdin.end(); } catch (e) {}
    try { k8sWs && k8sWs.close(); } catch (e) {}
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
