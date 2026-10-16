const { app, BrowserWindow, ipcMain, dialog, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const TEAM_BUILDER_URL = 'https://www.ea.com/games/ea-sports-college-football/team-builder';
const EA_PARTITION = 'persist:ea-teambuilder';
const TEAM_JSON_RE = /^https:\/\/cdn\.mcr\.ea\.com\/\d+\/bundles-users\/[^/]+\/[^/]+\/[^/?#]*nonce-primary\.json(?:[?#].*)?$/i;

let mainWindow = null;
let signInWindow = null;
let dirty = false;
const captures = [];
const inFlight = new Set();

const capturesDir = () => path.join(app.getPath('userData'), 'captures');
const safeName = (s) => String(s || 'team').replace(/[^a-z0-9 _-]+/gi, '').trim().replace(/\s+/g, '-') || 'team';

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#071426',
    title: 'CFB TeamBuilder Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.on('close', (e) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Discard changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes.',
      detail: 'Save your team as a .json file first if you want to keep them.',
    });
    if (choice === 1) e.preventDefault();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// The website downloads the team as a plain CDN JSON file once you open it for
// editing. Primary path: read that response body straight off the page through
// the DevTools protocol (what extension v0.76 does with chrome.debugger), so we
// get exactly what the site loaded. Fallback: if the debugger couldn't attach or
// missed it, re-fetch the same URL in the signed-in session.
const urlKey = (url) => url.split(/[?#]/)[0];
const recentlyCaptured = new Map();
const wasJustCaptured = (url) => Date.now() - (recentlyCaptured.get(urlKey(url)) || 0) < 5000;

function attachDebuggerCapture(wc) {
  try {
    wc.debugger.attach('1.3');
  } catch {
    return; // e.g. DevTools already open -- the webRequest fallback still covers it
  }
  const pending = new Map();
  wc.debugger.on('message', async (_e, method, params) => {
    if (method === 'Network.responseReceived') {
      if (params.response.status === 200 && TEAM_JSON_RE.test(params.response.url)) {
        pending.set(params.requestId, params.response.url);
        recentlyCaptured.set(urlKey(params.response.url), Date.now());
      }
      return;
    }
    if (method !== 'Network.loadingFinished' || !pending.has(params.requestId)) return;
    const url = pending.get(params.requestId);
    pending.delete(params.requestId);
    try {
      const { body, base64Encoded } = await wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId });
      captureFromText(url, base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body);
    } catch {
      fetchAndCapture(session.fromPartition(EA_PARTITION), url);
    }
  });
  wc.debugger.sendCommand('Network.enable', { maxResourceBufferSize: 32 * 1024 * 1024, maxTotalBufferSize: 96 * 1024 * 1024 })
    .catch(() => {});
}

function installCapture() {
  const ses = session.fromPartition(EA_PARTITION);
  ses.webRequest.onCompleted({ urls: ['https://cdn.mcr.ea.com/*'] }, (details) => {
    if (details.statusCode !== 200 || !TEAM_JSON_RE.test(details.url)) return;
    // Give the debugger path a moment; only re-fetch if it didn't catch this one.
    setTimeout(() => { if (!wasJustCaptured(details.url)) fetchAndCapture(ses, details.url); }, 1500);
  });
}

function fetchAndCapture(ses, url) {
  const key = urlKey(url);
  if (inFlight.has(key)) return; // our own re-fetch also lands in onCompleted
  inFlight.add(key);
  recentlyCaptured.set(key, Date.now());
  ses.fetch(url, { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`Team Builder returned HTTP ${res.status} for the team file.`);
      captureFromText(url, await res.text());
    })
    .catch((err) => sendToRenderer('tb:capture-error', { message: err.message }))
    .finally(() => setTimeout(() => inFlight.delete(key), 4000));
}

function captureFromText(url, text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    sendToRenderer('tb:capture-error', { message: 'The team file Team Builder sent was not valid JSON.' });
    return;
  }
  if (!payload || !payload.teamData) {
    sendToRenderer('tb:capture-error', { message: 'Captured file is not a team JSON.' });
    return;
  }
  const infos = payload.teamData.teamInfos || {};
  const teamName = [infos.TEAM_NAME, infos.TEAM_NICKNAME].filter(Boolean).join(' ') || 'Unnamed team';

  // Keep an untouched copy of every capture, the same "original is protected"
  // promise the offline editor made with its verified backups.
  fs.mkdirSync(capturesDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const savedTo = path.join(capturesDir(), `${safeName(teamName)}-${stamp}-original.json`);
  fs.writeFileSync(savedTo, text, 'utf8');

  const existing = captures.findIndex((c) => urlKey(c.url) === urlKey(url));
  const entry = { id: `${Date.now()}`, url, teamName, savedTo, time: Date.now(), text };
  if (existing >= 0) captures.splice(existing, 1);
  captures.unshift(entry);
  sendToRenderer('tb:captured', publicCapture(entry));
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

const publicCapture = ({ id, url, teamName, savedTo, time }) => ({ id, url, teamName, savedTo, time });

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function openSignIn() {
  if (signInWindow && !signInWindow.isDestroyed()) {
    signInWindow.focus();
    return;
  }
  signInWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Team Builder — sign in and open your team',
    backgroundColor: '#ffffff',
    webPreferences: { partition: EA_PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  signInWindow.setMenuBarVisibility(false);
  // EA's login can open its own popup; keep it in the same signed-in session.
  signInWindow.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { webPreferences: { partition: EA_PARTITION, contextIsolation: true, sandbox: true } },
  }));
  attachDebuggerCapture(signInWindow.webContents);
  signInWindow.webContents.on('did-create-window', (child) => attachDebuggerCapture(child.webContents));
  signInWindow.loadURL(TEAM_BUILDER_URL);
  signInWindow.on('closed', () => { signInWindow = null; });
}

function samePath(a, b) {
  if (!a || !b) return false;
  const norm = (p) => path.resolve(p);
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

function registerIpc() {
  ipcMain.handle('tb:data', () =>
    fs.readFileSync(path.join(__dirname, 'data', 'tb-data.json'), 'utf8'));

  ipcMain.handle('tb:open-signin', () => { openSignIn(); });

  ipcMain.handle('tb:list-captures', () => captures.map(publicCapture));

  ipcMain.handle('tb:load-capture', (_e, id) => {
    const c = captures.find((x) => x.id === id);
    if (!c) throw new Error('That capture is no longer available.');
    return { text: c.text, name: c.teamName, path: c.savedTo };
  });

  ipcMain.handle('tb:open-file', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Open a Team Builder team .json',
      filters: [{ name: 'Team JSON', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const file = r.filePaths[0];
    const stat = fs.statSync(file);
    if (stat.size > 64 * 1024 * 1024) throw new Error('That file is too large to be a team JSON.');
    return { path: file, name: path.basename(file), text: fs.readFileSync(file, 'utf8') };
  });

  ipcMain.handle('tb:save-file', async (_e, { text, suggestedName, protectedPaths }) => {
    JSON.parse(text); // never write something that isn't valid JSON
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Save team JSON for MMC',
      defaultPath: path.join(app.getPath('documents'), `${safeName(suggestedName)}.json`),
      filters: [{ name: 'Team JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return null;
    if ((protectedPaths || []).some((p) => samePath(p, r.filePath))) {
      return { error: 'That is your original file. Choose a different name so the original stays untouched.' };
    }
    fs.writeFileSync(r.filePath, text, 'utf8');
    if (fs.readFileSync(r.filePath, 'utf8') !== text) {
      return { error: 'The file was written but could not be verified. Try saving again.' };
    }
    return { path: r.filePath };
  });

  ipcMain.handle('tb:save-report', async (_e, { text, suggestedName }) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Save change report',
      defaultPath: path.join(app.getPath('documents'), `${safeName(suggestedName)}-changes.txt`),
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, text, 'utf8');
    return { path: r.filePath };
  });

  ipcMain.handle('tb:open-captures-folder', () => {
    fs.mkdirSync(capturesDir(), { recursive: true });
    return shell.openPath(capturesDir());
  });

  ipcMain.on('tb:set-dirty', (_e, value) => { dirty = !!value; });
}

app.whenReady().then(() => {
  registerIpc();
  installCapture();
  createMainWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
