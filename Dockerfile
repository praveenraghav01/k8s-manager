# syntax=docker/dockerfile:1

# ============================================================
# Stage 1 — build the React/Vite frontend
# ============================================================
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ============================================================
# Stage 2 — install production backend dependencies
# ============================================================
FROM node:20-alpine AS server-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ============================================================
# Stage 3 — runtime image (Node + kubectl + helm)
# ============================================================
FROM node:20-alpine AS runtime
WORKDIR /app

# TARGETARCH is provided by BuildKit (amd64 / arm64); default to amd64
ARG TARGETARCH=amd64
ARG HELM_VERSION=v3.16.4

# Install kubectl and helm (the app shells out to both)
RUN apk add --no-cache bash curl ca-certificates \
  && KUBECTL_VERSION="$(curl -fsSL https://dl.k8s.io/release/stable.txt)" \
  && curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" -o /usr/local/bin/kubectl \
  && chmod +x /usr/local/bin/kubectl \
  && curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-${TARGETARCH}.tar.gz" | tar -xz -C /tmp \
  && mv "/tmp/linux-${TARGETARCH}/helm" /usr/local/bin/helm \
  && chmod +x /usr/local/bin/helm \
  && rm -rf "/tmp/linux-${TARGETARCH}"

# Backend deps + source, and the built frontend
COPY --from=server-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
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
LABEL org.opencontainers.image.title="Kubernetes Manager" \
      org.opencontainers.image.description="Web UI to browse and operate Kubernetes clusters — workloads, nodes, events, logs, in-browser exec/terminal, service port-forwarding, Helm releases, RBAC and CRDs. Reads your kubeconfig and serves the UI + REST API on port 3001." \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.licenses="MIT"

CMD ["node", "server.js"]
