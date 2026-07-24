// Electron main process for Kubernetes Manager.
//
// Responsibilities:
//   1. Repair PATH — a Finder-launched .app inherits only a minimal PATH, so
//      kubectl (in /opt/homebrew/bin, /usr/local/bin, …) would be invisible to
//      the server's child_process calls. We reconstruct the user's real PATH.
//   2. Start server.js as a child process using Electron's bundled Node
//      (ELECTRON_RUN_AS_NODE), on the fixed backend port 3001.
//   3. Wait for the server to accept connections, then load it in a window.
//   4. Tear the server down on quit (which triggers its port-forward cleanup).
'use strict';

const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const BACKEND_PORT = 3001;
const SERVER_URL = `http://127.0.0.1:${BACKEND_PORT}`;

let serverProcess = null;
let mainWindow = null;

// --- 1. PATH repair -------------------------------------------------------
// Ask the user's login shell for its PATH, then union with the usual GUI-app
// blind spots. Falls back gracefully if the shell can't be queried.
function resolveUserPath() {
  const common = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), 'bin'),
  ];

  let shellPath = '';
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    // -l (login) + -i (interactive) so ~/.zprofile / ~/.zshrc PATH edits apply.
    shellPath = execFileSync(shell, ['-lic', 'echo -n "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
  } catch {
    // Non-fatal — we still have `common` and the inherited PATH.
  }

  const parts = [
    ...(shellPath ? shellPath.split(':') : []),
    ...(process.env.PATH ? process.env.PATH.split(':') : []),
    ...common,
  ].filter(Boolean);

  return [...new Set(parts)].join(':');
}

// --- 2. Start the backend -------------------------------------------------
// In a packaged app (asar disabled) the server lives next to this file under
// Contents/Resources/app; in dev it's the project root.
function serverRoot() {
  return app.getAppPath();
}

function startServer(fixedPath) {
  const root = serverRoot();
  const serverEntry = path.join(root, 'server.js');

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1', // run the bundled Electron binary as plain Node
      PATH: fixedPath,
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrTail = '';
  serverProcess.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr.on('data', (d) => {
    stderrTail = (stderrTail + d).slice(-2000);
    process.stderr.write(`[server] ${d}`);
  });

  serverProcess.on('exit', (code, signal) => {
    serverProcess = null;
    // If the server dies unexpectedly while the app is up, surface it.
    if (!app.isQuitting && code !== 0 && code !== null) {
      const portTaken = /EADDRINUSE|already in use/i.test(stderrTail);
      const detail = portTaken
        ? `Port ${BACKEND_PORT} is already in use — another copy of the app or a process on that port is running. Quit it and relaunch.`
        : `The backend exited unexpectedly (code ${code}${signal ? `, signal ${signal}` : ''}).` +
          (stderrTail.trim() ? `\n\n${stderrTail.trim().split('\n').slice(-4).join('\n')}` : '');
      dialog.showErrorBox('Kubernetes Manager', detail);
      app.quit();
    }
  });

  serverProcess.on('error', (err) => {
    dialog.showErrorBox('Kubernetes Manager', `Failed to start the backend:\n${err.message}`);
    app.quit();
  });
}

function stopServer() {
  if (serverProcess) {
    // SIGTERM lets server.js run its killAllForwards() cleanup handler.
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

// --- 3. Wait for readiness, then show the window --------------------------
function pingServer() {
  return new Promise((resolve) => {
    const req = http.get(SERVER_URL, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingServer()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Kubernetes Manager',
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Show a lightweight loading page immediately.
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open target=_blank / external links in the default browser, not a new window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function boot() {
  createWindow();

  // If a backend is already serving on the port (e.g. `npm run dev`, or a
  // second launch), reuse it instead of spawning a duplicate that would fail
  // to bind the port and exit.
  if (await pingServer()) {
    if (mainWindow) mainWindow.loadURL(SERVER_URL);
    return;
  }

  startServer(resolveUserPath());

  const ready = await waitForServer();
  if (!mainWindow) return; // window closed while we waited

  if (ready) {
    mainWindow.loadURL(SERVER_URL);
  } else {
    dialog.showErrorBox(
      'Kubernetes Manager',
      `The backend did not become ready on port ${BACKEND_PORT} within 30s.\n` +
        `Something else may be using the port. Free it and relaunch.`
    );
    app.quit();
  }
}

// --- App lifecycle --------------------------------------------------------
// Single-instance: the fixed port means two copies can't both bind it.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(buildMenu());
    boot();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) boot();
    });
  });
}

app.on('window-all-closed', () => {
  // Server-backed app: closing the window quits everything (incl. the backend).
  app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopServer();
});

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
    },
  ];
  return Menu.buildFromTemplate(template);
}
