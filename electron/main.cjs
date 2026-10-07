// The desktop shell: one window showing the editor, plus the file access the page asks for.
// Run with `npm start` (built app) or `npm run desktop:dev` (against the Vite dev server).
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const files = require('./files.cjs');

// Tests and the smoke run point these somewhere disposable.
if (process.env.SUNRISE_SCENES_USERDATA) app.setPath('userData', process.env.SUNRISE_SCENES_USERDATA);
const SMOKE = process.argv.includes('--smoke');
const statePath = () => path.join(app.getPath('userData'), 'workspace.json');

function loadState() { try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return null; } }
// Write to a temp file first so a crash mid-write cannot leave half a workspace behind.
function saveState(json) {
  const file = statePath(), tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, json); fs.renameSync(tmp, file);
}

let win = null;
function createWindow() {
  const saved = loadState(), b = (saved && saved.bounds) || {};
  win = new BrowserWindow({
    width: b.width || 1500, height: b.height || 900, x: b.x, y: b.y, minWidth: 1000, minHeight: 600,
    backgroundColor: '#14161b', title: 'Sunrise Scenes', show: !SMOKE,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  if (b.maximized) win.maximize();
  win.setMenuBarVisibility(false);
  // Links in the page open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  if (process.env.SUNRISE_SCENES_DEV) win.loadURL(process.env.SUNRISE_SCENES_DEV);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  if (SMOKE) smoke();
}
const bounds = () => (win ? { ...win.getNormalBounds(), maximized: win.isMaximized() } : {});

// The page may only name a root that is a folder that exists.
const rootOf = (root) => { if (typeof root !== 'string' || !files.isDir(root)) throw new Error('That folder no longer exists.'); return root; };
const pickFolder = async (title) => {
  const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0] || null;
};
ipcMain.handle('state:load', () => loadState());
ipcMain.handle('state:save', (_e, json) => { saveState(withBounds(json)); });
ipcMain.on('state:save-sync', (e, json) => { try { saveState(withBounds(json)); } catch { /* quitting anyway */ } e.returnValue = true; });
function withBounds(json) { try { const d = JSON.parse(json); d.bounds = bounds(); return JSON.stringify(d); } catch { return json; } }
ipcMain.handle('sunrise:find', () => files.findSunrise(process.env.SUNRISE_SCENES_ROOT ? [process.env.SUNRISE_SCENES_ROOT] : []));
// Any folder can be chosen: a Sunrise install (or the game folder around it), or a plain
// folder of scripts. files.chooseRoot decides which it is.
ipcMain.handle('sunrise:choose', async () => {
  const picked = await pickFolder('Choose your Destiny 2 folder, or any folder of mission scripts');
  return picked ? { picked, root: files.chooseRoot(picked) } : { picked: null, root: null };
});
ipcMain.handle('sunrise:describe', (_e, root, sdkDir) => files.describeRoot(root, sdkDir));
// The SDK folder a plain scripts folder borrows its keys from.
ipcMain.handle('sdk:choose', async () => {
  const picked = await pickFolder('Choose a Sunrise install (or its sdk folder) to read SDK keys from');
  return picked ? { picked, sdk: files.resolveSdk(picked) } : { picked: null, sdk: null };
});
ipcMain.handle('missions:list', (_e, root, sdkDir) => files.listMissions(rootOf(root), sdkDir));
ipcMain.handle('missions:read', (_e, root, name, sdkDir) => files.readMission(rootOf(root), name, sdkDir));
ipcMain.handle('missions:write', (_e, root, name, lua, scene, extra) => files.writeMission(rootOf(root), name, lua, scene, extra || {}));
ipcMain.handle('missions:sdk', (_e, root, scenario, activity, sdkDir) => files.sdkFor(rootOf(root), scenario, activity, sdkDir));
ipcMain.handle('missions:reveal', (_e, root, name) => { const m = files.readMission(rootOf(root), name); shell.showItemInFolder(m.path); });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// `electron . --smoke`: load the app with no window, report what the page sees, and quit.
// Used to check the packaged pieces fit together without a person looking at it.
function smoke() {
  const done = (result, code) => { console.log('SMOKE ' + JSON.stringify(result)); app.exit(code); };
  const timer = setTimeout(() => done({ error: 'timed out waiting for the page' }, 1), 20000);
  // Electron has passed this event's details two ways over the years; read either.
  win.webContents.on('console-message', (e, level, message) => {
    const lv = typeof level === 'number' ? level : { warning: 2, error: 3 }[e.level] || 0;
    if (lv >= 2) console.log('PAGE ' + (message || e.message));
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const script = fs.readFileSync(path.join(__dirname, 'smoke.js'), 'utf8');
      const result = await win.webContents.executeJavaScript(script, true);
      clearTimeout(timer); done(result, result && result.ok ? 0 : 1);
    } catch (e) { clearTimeout(timer); done({ error: String(e && e.message || e) }, 1); }
  });
  win.webContents.once('did-fail-load', (_e, code, desc) => { clearTimeout(timer); done({ error: 'page failed to load: ' + desc }, 1); });
}
