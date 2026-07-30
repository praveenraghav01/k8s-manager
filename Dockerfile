# syntax=docker/dockerfile:1

# ============================================================
# Stage 1 — build the React/Vite frontend
# ============================================================
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ============================================================
# Stage 2 — install production backend dependencies
# ============================================================
FROM node:22-alpine AS server-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ============================================================
# Stage 3 — runtime image (Node + kubectl)
# ============================================================
FROM node:22-alpine AS runtime
WORKDIR /app

# TARGETARCH is provided by BuildKit (amd64 / arm64); default to amd64
ARG TARGETARCH=amd64

# Patch OS packages, then install kubectl (the app shells out to it).
# NOTE: helm is intentionally NOT installed — Helm releases are read directly
# via the Kubernetes API (see server.js), which also avoids the large cluster
# of Go-module CVEs that ship inside the helm binary.
RUN apk upgrade --no-cache \
  && apk add --no-cache bash curl ca-certificates \
  && KUBECTL_VERSION="$(curl -fsSL https://dl.k8s.io/release/stable.txt)" \
  && curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" -o /usr/local/bin/kubectl \
  && chmod +x /usr/local/bin/kubectl \
  # npm/npx/corepack aren't used at runtime (the app runs `node server.js`);
  # removing them drops the CVEs in npm's bundled dependencies.
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
            /usr/local/lib/node_modules/corepack /usr/local/bin/corepack

# Backend deps + source, and the built frontend
COPY --from=server-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
COPY assistant.js ./
COPY --from=client-build /app/client/dist ./client/dist

ENV NODE_ENV=production

EXPOSE 3001

# ------------------------------------------------------------------
# OCI image metadata.
# GHCR shows `description` as the package's short blurb and, via `source`,
# links the package to its GitHub repo — whose README then renders as the
# package "overview". The release workflow's docker/metadata-action overrides
# source/revision/created automatically; set IMAGE_SOURCE for manual builds.
# ------------------------------------------------------------------
ARG APP_VERSION="0.0.0"
LABEL org.opencontainers.image.title="Kubernetes Manager UI" \
      org.opencontainers.image.description="Web UI to browse and operate Kubernetes clusters — workloads, nodes, events, logs, in-browser exec/terminal, service port-forwarding, Helm releases, RBAC and CRDs. Reads your kubeconfig and serves the UI + REST API on port 3001." \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.licenses="MIT"

# Drop root — run as the unprivileged `node` user shipped in the base image.
# Its home (/home/node) is writable, so the default kubeconfig path becomes
# /home/node/.kube/config and the assistant config lands in /home/node/.config.
USER node

CMD ["node", "server.js"]
