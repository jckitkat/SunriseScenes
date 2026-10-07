// The desktop side of the page: the bridge Electron's preload exposes, the session (which
// Sunrise folder and mission are open), and saving the whole workspace so the app reopens
// exactly where it was left. In a plain browser `api` is null and none of this runs.
import { S } from './state.js';
import { ui } from './ui/dom.js';

export const api = (typeof window !== 'undefined' && window.desktop) || null;

export const session = {
  root: '',          // where the scripts are: a Sunrise install (<game>/bin/x64/Sunrise) or a plain folder of scripts
  sdkDir: '',        // for a plain folder: the sdk/lua folder it borrows SDK keys from, if any
  mission: null,     // { name, kind: 'visual' | 'text', imported } or null when nothing is open
  files: {},         // for a text mission: every Lua file in its folder, as being edited
  saved: {},         // ... and as they are on disk, to tell which have unsaved changes
  file: '',          // ... and which one is showing
  savedLua: null,    // for a drawing: what it compiled to when last saved or opened
  notes: [],         // things the importer could not carry over, shown until dismissed
  sdkPath: '',       // the generated module whose keys are loaded
};

const snapshot = () => JSON.stringify({
  version: 1, doc: S, session,
  ui: { view: ui.view, pan: ui.pan, zoom: ui.zoom, selected: ui.selected, editDef: ui.editDef },
});
let timer = null;
// Save soon. Called on every change, so it waits for a pause.
export function persist() { if (!api) return; clearTimeout(timer); timer = setTimeout(() => api.saveState(snapshot()), 400); }
// Save before the window goes away.
export function persistNow() { if (!api) return; clearTimeout(timer); api.saveStateNow(snapshot()); }
