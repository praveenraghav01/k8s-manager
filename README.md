# Kubernetes Manager UI

A modern, Lens-style web UI for browsing and operating a Kubernetes cluster using your local `kubeconfig`.

![Kubernetes Manager — cluster dashboard](docs/screenshot-dashboard.png)

## Features

- **Cluster overview** — live dashboard (node/pod health donuts, workload charts, capacity)
- **Workloads** — Pods, Deployments, StatefulSets, DaemonSets, Services, etc. with live CPU/memory (metrics-server), per-container status boxes, and cross-links (namespace → node → pod → owner)
- **Nodes** — live per-node CPU/memory graphs with capacity thresholds, and the pods running on each node
- **Namespaces** — searchable list; click a namespace to filter its workloads
- **Topology** — interactive pan/zoom graph of Deployment → ReplicaSet → Pod → Service relationships
- **Custom Resources** — lazy-loaded sidebar tree (group → kind → instance) with YAML details
- **Helm** — releases with values and rendered manifest
- **Detail drawer** — Lens-style right-side panel with metadata, live metric graphs, conditions, containers
- **Pod logs** — search, tail, formatting, and per-container selection
- **Interactive shell** — a real TTY into pods (`kubectl exec -it` streamed over WebSocket to xterm.js)
- **Port forwarding** — forward a Service port to `localhost` (choose a port or get a random one)
- **Multi-tab bottom panel** — logs/terminal/YAML tabs open side by side
- **Light & dark themes** with persistence

## Prerequisites

- **Node.js 18+** and npm
- **`kubectl`** on your `PATH` — the app shells out to it for metrics, topology, CRDs, port-forward, etc.
- **`helm`** (v3) on your `PATH` — for the Helm releases view
- A working **`kubeconfig`** (default `~/.kube/config`, or set `KUBECONFIG`) with access to a cluster

Verify:

```bash
kubectl version --client
helm version
kubectl get nodes   # confirms cluster access
```

## Install

```bash
npm install
cd client && npm install && cd ..
```

## Run — development (hot reload)

```bash
npm run dev
```

- Frontend (Vite): **http://localhost:3000**  ← open this
- Backend (API + WebSocket): **http://localhost:3001** (Vite proxies `/api` and `/ws` to it)

## Run — production (single port)

Build the frontend, then start the server, which serves both the UI and the API on one port:

```bash
npm run build     # builds client/dist
npm start         # serves everything on http://localhost:3001
```

Open **http://localhost:3001**.

## Run — Docker

The image bundles Node and `kubectl`, and serves the UI + API on port `3001`.

**Run the published image** (from GitHub Container Registry):

```bash
docker run --rm -p 8080:3001 \
  -v "$HOME/.kube:/root/.kube:ro" \
  ghcr.io/OWNER/k8s-manager:latest
```

**Or build it locally:**

```bash
docker build -t k8s-manager .

docker run --rm -p 8080:3001 \
  -v "$HOME/.kube:/root/.kube:ro" \
  k8s-manager
```

Open **http://localhost:8080**.

Notes:
- Mount your kubeconfig at `/root/.kube/config` (as above) or pass `-e KUBECONFIG=/path/inside/container`.
- If your kubeconfig references cloud auth plugins (EKS/GKE/AKS exec credentials), those CLIs must be available inside the container too, or use a static-token kubeconfig.
- The build auto-selects `amd64`/`arm64` via BuildKit's `TARGETARCH`.

## Run — Mac app (Electron)

Package the whole thing as a native `Kubernetes Manager.app` / `.dmg`:

```bash
npm install          # installs Electron + electron-builder (first time)
npm run app:dist     # builds the UI and produces release/Kubernetes Manager-*.dmg (arm64)
```

The artifacts land in `release/`. The default target is **arm64** (Apple Silicon);
to also build an Intel `x64` DMG, add `"x64"` to the `build.mac.target[].arch`
array in `package.json` (this triggers a second Electron binary download).

To try it without packaging a DMG:

```bash
npm run app          # runs the UI in an Electron window (uses the current client/dist)
npm run app:pack     # builds an unpacked .app into release/mac* (faster than app:dist)
```

How it works: the Electron main process (`electron/main.cjs`) starts `server.js`
as a child using Electron's bundled Node, waits for port `3001`, then loads the
UI in a window. Because a Finder-launched app doesn't inherit your shell `PATH`,
the main process reconstructs it (querying your login shell + the usual Homebrew
paths) so `kubectl` is found at runtime.

Notes:
- `kubectl` still has to be installed on the machine — the app shells out to it.
- The build is **ad-hoc signed** (no Apple Developer ID) by `electron/after-pack.cjs`,
  so it runs on the machine that built it. If you copy the `.dmg` to *another* Mac,
  macOS quarantines the download and Gatekeeper will block it — the recipient
  right-clicks the app → **Open**, or runs
  `xattr -dr com.apple.quarantine "/Applications/Kubernetes Manager.app"`.
  For frictionless distribution, add a Developer ID signature + notarization
  (set `CSC_LINK`/`CSC_KEY_PASSWORD` and an `afterSign` notarize step).

## Usage

1. **Pick a context** — the searchable selector in the sidebar switches clusters (`kubectl config use-context`).
2. **Filter namespaces** — the multi-select in each view, or click a namespace name anywhere.
3. **Click a row** — opens the right-side detail drawer (with live metric graphs for pods).
4. **⋮ menu** — per row: Details, Logs (expands to pick a container), Terminal, Edit YAML.
5. **Port-forward** — open a Service's drawer → Port Forwarding → Forward.
6. **Toggle theme** — the sun/moon button in the sidebar header.

## Configuration

| Variable | Purpose | Default |
|----------|---------|---------|
| `KUBECONFIG` | Path to kubeconfig | `~/.kube/config` |

The backend always listens on port **3001**; map it to any host port with Docker (`-p <host>:3001`).

## Architecture

- **Backend** (`server.js`) — Express + `@kubernetes/client-node`. Reads the kubeconfig, exposes a REST API and a `/ws/exec` WebSocket for interactive shells, and shells out to `kubectl`/`helm` for features without a clean typed-API path. Responses are cached with short TTLs; in production it also serves the built frontend.
- **Frontend** (`client/`) — React + Vite. Same-origin calls to `/api/*` and `/ws/exec`, xterm.js terminal, token-driven theming.

## Troubleshooting

- **"No kubeconfig loaded"** — ensure `~/.kube/config` exists or set `KUBECONFIG`.
- **Empty metrics / CPU-Memory show `—`** — the cluster needs **metrics-server** installed.
- **Helm view empty or erroring** — `helm` must be on the server's `PATH` and able to reach the cluster.
- **Terminal won't open** — the target container needs a shell (`sh`); distroless images won't work.
- **"All namespaces" is slow the first time** — it fetches every namespace (cached afterward); pick a single namespace for faster loads.
