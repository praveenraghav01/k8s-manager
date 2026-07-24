#!/usr/bin/env bash
#
# Kubernetes Manager UI — install & run helper
#
# Usage:
#   ./run.sh                 Install deps (first run), build the UI, start the app (production)
#   ./run.sh dev             Install deps, run backend + Vite dev server with hot reload
#   ./run.sh install         Install root + client dependencies only
#   ./run.sh build           Build the production UI bundle only
#   ./run.sh --help
#
# Flags:
#   --skip-install           Don't install dependencies (assume node_modules present)
#   --force-install          Reinstall dependencies even if node_modules already exists
#   --no-tools               Don't try to auto-install kubectl if it's missing
#
# kubectl is installed automatically when missing (Homebrew on macOS, or the
# official release binary on Linux). The Helm view reads releases via the
# Kubernetes API, so the helm CLI is not required.
#
# The app reads your local kubeconfig (default ~/.kube/config, or $KUBECONFIG).
#
set -euo pipefail

# --- locate repo root (this script's directory) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- ports (backend port is fixed in server.js) ---
BACKEND_PORT=3001
DEV_UI_PORT=3000

# --- colors (disabled when not a TTY) ---
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; BLUE=''; RESET=''
fi
info()  { printf '%s\n' "${BLUE}${BOLD}==>${RESET} ${BOLD}$*${RESET}"; }
ok()    { printf '%s\n' "${GREEN}✓${RESET} $*"; }
warn()  { printf '%s\n' "${YELLOW}!${RESET} $*"; }
err()   { printf '%s\n' "${RED}✗${RESET} $*" >&2; }

# --- parse args ---
MODE="prod"
SKIP_INSTALL=0
FORCE_INSTALL=0
NO_TOOLS=0
for arg in "$@"; do
  case "$arg" in
    dev)              MODE="dev" ;;
    prod|start|run)   MODE="prod" ;;
    install)          MODE="install" ;;
    build)            MODE="build" ;;
    --skip-install)   SKIP_INSTALL=1 ;;
    --force-install)  FORCE_INSTALL=1 ;;
    --no-tools)       NO_TOOLS=1 ;;
    -h|--help)        MODE="help" ;;
    *) err "Unknown argument: $arg"; MODE="help" ;;
  esac
done

if [ "$MODE" = "help" ]; then
  # print the leading comment header (skip the shebang, stop at first code line)
  awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"
  exit 0
fi

# ------------------------------------------------------------------
# CLI tool auto-install (kubectl)
# ------------------------------------------------------------------
# Detect OS + arch in the naming used by the official release URLs.
os_name() {
  case "$(uname -s)" in
    Darwin) echo "darwin" ;;
    Linux)  echo "linux" ;;
    *)      echo "unknown" ;;
  esac
}
arch_name() {
  case "$(uname -m)" in
    x86_64|amd64)   echo "amd64" ;;
    arm64|aarch64)  echo "arm64" ;;
    *)              echo "unknown" ;;
  esac
}

# Pick a writable install dir for downloaded binaries (Linux path).
bin_install_dir() {
  if [ -w /usr/local/bin ] 2>/dev/null; then
    echo "/usr/local/bin"
  elif command -v sudo >/dev/null 2>&1; then
    echo "sudo:/usr/local/bin"
  else
    mkdir -p "$HOME/.local/bin"
    echo "$HOME/.local/bin"
  fi
}

install_kubectl() {
  local os arch dir
  os="$(os_name)"; arch="$(arch_name)"
  info "Attempting to install kubectl"

  if command -v brew >/dev/null 2>&1; then
    brew install kubectl && return 0
  fi

  if [ "$os" = "unknown" ] || [ "$arch" = "unknown" ]; then
    err "Can't auto-install kubectl for this platform ($(uname -s)/$(uname -m))."
    return 1
  fi

  local ver url tmp
  ver="$(curl -fsSL https://dl.k8s.io/release/stable.txt 2>/dev/null)" || {
    err "Could not fetch the latest kubectl version."
    return 1
  }
  url="https://dl.k8s.io/release/${ver}/bin/${os}/${arch}/kubectl"
  tmp="$(mktemp)"
  curl -fsSL -o "$tmp" "$url" || { err "Download failed: $url"; rm -f "$tmp"; return 1; }
  chmod +x "$tmp"

  dir="$(bin_install_dir)"
  if [ "${dir#sudo:}" != "$dir" ]; then
    sudo mv "$tmp" "${dir#sudo:}/kubectl"
  else
    mv "$tmp" "$dir/kubectl"
    case ":$PATH:" in *":$dir:"*) ;; *) warn "Add $dir to your PATH to use kubectl." ;; esac
  fi
}

# ------------------------------------------------------------------
# macOS quarantine cleanup
# ------------------------------------------------------------------
# When the project is downloaded via a browser (common in ~/Downloads), macOS
# tags every file with com.apple.quarantine. Gatekeeper then refuses to load
# quarantined native modules (e.g. @rollup/rollup-darwin-arm64/*.node), which
# breaks `vite build` with a misleading "Cannot find module" error. Strip the
# attribute from the project tree so native .node addons can load.
dequarantine_macos() {
  [ "$(os_name)" = "darwin" ] || return 0
  command -v xattr >/dev/null 2>&1 || return 0
  # Only act if something is actually quarantined, to avoid a needless
  # walk of the whole tree (incl. node_modules) on every run.
  if xattr -rl "$SCRIPT_DIR" 2>/dev/null | grep -q 'com.apple.quarantine'; then
    info "Clearing macOS quarantine flags (Gatekeeper blocks native modules otherwise)"
    xattr -dr com.apple.quarantine "$SCRIPT_DIR" 2>/dev/null || true
    ok "Quarantine flags cleared"
  fi
}

# ------------------------------------------------------------------
# Prerequisite checks
# ------------------------------------------------------------------
check_prereqs() {
  info "Checking prerequisites"
  local missing=0

  if ! command -v node >/dev/null 2>&1; then
    err "Node.js is not installed. Install Node.js 18+ from https://nodejs.org"
    missing=1
  else
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if [ "$major" -lt 18 ]; then
      err "Node.js 18+ required (found $(node -v))."
      missing=1
    else
      ok "Node.js $(node -v)"
    fi
  fi

  if ! command -v npm >/dev/null 2>&1; then
    err "npm is not installed (it ships with Node.js)."
    missing=1
  else
    ok "npm v$(npm -v)"
  fi

  # kubectl is required at runtime (metrics, topology, CRDs, port-forward).
  # NOTE: the Helm view no longer needs the helm CLI — releases are read
  # directly from Kubernetes via the API (see server.js).
  if ! command -v kubectl >/dev/null 2>&1; then
    if [ "$NO_TOOLS" -eq 1 ]; then
      err "kubectl not found on PATH. Install it: https://kubernetes.io/docs/tasks/tools/"
      missing=1
    else
      warn "kubectl not found — attempting to install it."
      if install_kubectl && command -v kubectl >/dev/null 2>&1; then
        ok "kubectl installed ($(command -v kubectl))"
      else
        err "Could not install kubectl automatically. Install it: https://kubernetes.io/docs/tasks/tools/"
        missing=1
      fi
    fi
  else
    ok "kubectl present"
  fi

  # kubeconfig sanity (non-fatal — the UI also has a path prompt)
  local kcfg="${KUBECONFIG:-$HOME/.kube/config}"
  if [ -f "${kcfg%%:*}" ]; then
    ok "kubeconfig found (${kcfg%%:*})"
  else
    warn "No kubeconfig at ${kcfg%%:*}. You can enter a path in the app when it loads."
  fi

  if [ "$missing" -ne 0 ]; then
    err "Missing required tools. Please install them and re-run."
    exit 1
  fi
}

# ------------------------------------------------------------------
# Dependency install
# ------------------------------------------------------------------
install_deps() {
  if [ "$SKIP_INSTALL" -eq 1 ]; then
    warn "Skipping dependency install (--skip-install)"
    return
  fi
  # Reuse an npm command that respects package-lock when present.
  local npm_ci="npm install"
  if [ -f package-lock.json ]; then npm_ci="npm ci"; fi

  if [ "$FORCE_INSTALL" -eq 1 ] || [ ! -d node_modules ]; then
    info "Installing backend dependencies"
    if [ "$FORCE_INSTALL" -eq 1 ]; then npm install; else eval "$npm_ci" || npm install; fi
    ok "Backend dependencies installed"
  else
    ok "Backend dependencies already installed (use --force-install to reinstall)"
  fi

  local client_ci="npm install"
  if [ -f client/package-lock.json ]; then client_ci="npm ci"; fi
  if [ "$FORCE_INSTALL" -eq 1 ] || [ ! -d client/node_modules ]; then
    info "Installing frontend dependencies"
    ( cd client && { [ "$FORCE_INSTALL" -eq 1 ] && npm install || { eval "$client_ci" || npm install; }; } )
    ok "Frontend dependencies installed"
  else
    ok "Frontend dependencies already installed"
  fi
}

# ------------------------------------------------------------------
# Build production UI
# ------------------------------------------------------------------
build_ui() {
  info "Building production UI bundle"
  ( cd client && npm run build )
  ok "UI built into client/dist"
}

# ------------------------------------------------------------------
# Port guard
# ------------------------------------------------------------------
port_in_use() {
  local p="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

warn_if_busy() {
  local p="$1" label="$2"
  if port_in_use "$p"; then
    warn "Port $p ($label) is already in use — the app may fail to bind. Free it and retry."
  fi
}

# ------------------------------------------------------------------
# Run
# ------------------------------------------------------------------
run_prod() {
  warn_if_busy "$BACKEND_PORT" "backend + UI"
  info "Starting Kubernetes Manager (production)"
  printf '%s\n' "${DIM}Open ${RESET}${BOLD}http://localhost:${BACKEND_PORT}${RESET}${DIM} — press Ctrl+C to stop.${RESET}"
  exec node server.js
}

run_dev() {
  warn_if_busy "$BACKEND_PORT" "backend/API"
  warn_if_busy "$DEV_UI_PORT" "Vite dev server"
  info "Starting Kubernetes Manager (dev — hot reload)"
  printf '%s\n' "${DIM}UI: ${RESET}${BOLD}http://localhost:${DEV_UI_PORT}${RESET}${DIM}  (API proxied to :${BACKEND_PORT}) — press Ctrl+C to stop.${RESET}"
  exec npm run dev
}

# ------------------------------------------------------------------
# main
# ------------------------------------------------------------------
dequarantine_macos
check_prereqs

case "$MODE" in
  install)
    install_deps
    ok "Done. Run ${BOLD}./run.sh${RESET} to build and start, or ${BOLD}./run.sh dev${RESET} for hot reload."
    ;;
  build)
    install_deps
    build_ui
    ok "Done. Run ${BOLD}./run.sh --skip-install${RESET} to start the server."
    ;;
  dev)
    install_deps
    run_dev
    ;;
  prod)
    install_deps
    build_ui
    run_prod
    ;;
esac
