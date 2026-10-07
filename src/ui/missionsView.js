// Desktop only. The Missions screen (pick a script from the Sunrise install), opening a
// mission into the right editor, saving it back, and the mission bar in the header.
import { S, setDoc, blank, normalize, stampSlotTypes } from '../state.js';
import { foldStem } from '../compile/index.js';
import { parseSdk } from '../sdk.js';
import { importCampaign, looksLikeCampaign } from '../importCampaign.js';
import { importFreeroam, looksLikeFreeroam } from '../importFreeroam.js';
import { api, session, persist } from '../desktop.js';
import { $, el, ui, changed, go } from './dom.js';
import { resetView, tidy } from './canvas.js';
import { current } from './output.js';

const KIND = {
  scene: ['Drawn here', 'Opens exactly as it was saved.'],
  campaign: ['Campaign script', 'Hand-written lib.campaign script. It will be read into the canvas.'],
  freeroam: ['Freeroam script', 'An open-world destination (lib.freeroam). Its zones, read from content.lua, open on the canvas.'],
  lua: ['Lua script', 'Hand-written Lua the canvas cannot draw. Every Lua file in its folder opens in the text editor.'],
  helpers: ['Shared Lua', 'A folder of Lua that other scripts load, with no script of its own. Opens in the text editor.'],
  none: ['No script yet', 'An activity the SDK lists that nobody has scripted. Opens an empty canvas.'],
};
let missions = [], loadedFor = null, info = null;   // info: { root, kind: 'install' | 'scripts', scripts, sdk }

// A blank session's mission fields; used whenever the open mission is let go.
export const NO_MISSION = () => ({ mission: null, files: {}, saved: {}, file: '', savedLua: null, notes: [] });
export const isDirty = () => {
  const m = session.mission;
  if (!m) return false;
  if (m.kind !== 'text') return current().shown !== session.savedLua;
  return Object.keys(session.files).some((n) => session.files[n] !== session.saved[n]);
};

// The strip in the header: which mission is open, whether it has unsaved changes, Save.
export function renderMissionBar() {
  if (!api) return;
  const m = session.mission, bar = $('mission-bar');
  bar.hidden = false;
  $('mission-name').textContent = m ? (isDirty() ? '● ' : '') + m.name : 'no mission open';
  $('mission-name').title = m ? (isDirty() ? 'Unsaved changes. ' : 'Saved. ') + 'Click to show the script in its folder.' : 'Pick one on the Missions screen.';
  $('b-mission-save').disabled = !session.root;
  $('b-mission-save').textContent = info && info.kind === 'scripts' ? 'Save script' : 'Save to Sunrise';
  const notes = $('notes'); notes.hidden = !session.notes.length;
  if (session.notes.length && notes.dataset.shown !== String(session.notes.length)) {
    notes.dataset.shown = String(session.notes.length);
    notes.replaceChildren(el('b', { textContent: `Reading the old script, ${session.notes.length} thing${session.notes.length === 1 ? '' : 's'} could not be carried over:` }),
      el('ul', null, ...session.notes.map((n) => el('li', { textContent: n }))),
      el('button', { textContent: 'Dismiss', onclick: () => { session.notes = []; delete notes.dataset.shown; persist(); renderMissionBar(); } }));
  }
}

async function refresh(force) {
  if (!session.root) { missions = []; loadedFor = null; info = null; return; }
  if (!force && loadedFor === session.root + '|' + session.sdkDir) return;
  try { info = await api.describeRoot(session.root, session.sdkDir); if (!info) throw new Error('gone'); missions = await api.listMissions(session.root, session.sdkDir); loadedFor = session.root + '|' + session.sdkDir; }
  catch (e) { missions = []; loadedFor = null; info = null; session.root = ''; }
}

export async function renderMissionsView(force) {
  await refresh(force);
  const box = $('mission-list'); box.replaceChildren();
  const plain = !!info && info.kind === 'scripts';
  $('root-path').textContent = session.root || 'No folder chosen. Pick your Destiny 2 folder, or any folder that holds mission scripts.';
  $('root-path').classList.toggle('missing', !session.root);
  $('root-kind').textContent = !info ? '' : plain ? 'A plain folder of scripts. Each mission is a folder inside it with a .lua file of the same name.' : 'A Sunrise install. Scripts are in its scripts folder; SDK keys come from its sdk folder.';
  // A plain folder has no SDK of its own; it can borrow one from a Sunrise install.
  $('sdk-row').hidden = !plain;
  $('sdk-path').textContent = info && info.sdk ? info.sdk : 'None. Missions open without SDK keys to browse, and activities with no script are not listed.';
  $('sdk-path').classList.toggle('missing', !(info && info.sdk));
  if (!session.root) return;
  const q = $('mission-search').value.trim().toLowerCase(), only = $('mission-kind').value;
  const open = session.mission && session.mission.name;
  let shown = 0, total = 0;
  for (const group of [['Scripts', (m) => m.kind !== 'none' && m.kind !== 'helpers'], ['Shared Lua', (m) => m.kind === 'helpers'], ['Activities without a script', (m) => m.kind === 'none']]) {
    const list = missions.filter((m) => group[1](m) && (!only || m.kind === only) && (!q || m.name.includes(q) || m.scenario.toLowerCase().includes(q)));
    if (!list.length) continue;
    total += list.length;
    box.append(el('h3', null, group[0], el('small', { textContent: String(list.length) })));
    for (const m of list) {
      if (shown >= 300) break; shown++;
      box.append(el('div', { class: 'mrow kind-' + m.kind + (m.name === open ? ' on' : ''), title: KIND[m.kind][1], onclick: () => openMission(m.name) },
        el('span', { class: 'mname', textContent: m.name }), el('span', { class: 'mkind', textContent: KIND[m.kind][0] }),
        el('span', { class: 'mscen', textContent: m.scenario }), el('button', { textContent: m.name === open ? 'Reopen' : 'Open' })));
    }
  }
  if (!missions.length) box.append(el('div', { class: 'note', textContent: plain
    ? 'This folder has no mission scripts yet. A mission is a folder with a .lua file of the same name inside, for example my_mission/my_mission.lua. Draw one and press Save script to make the first.'
    : 'This Sunrise folder has no scripts and no generated SDK yet. Launch the game once so Sunrise writes its SDK, then press Refresh.' }));
  else if (!total) box.append(el('div', { class: 'note', textContent: 'Nothing matches.' }));
  else if (total > shown) box.append(el('div', { class: 'note', textContent: `Showing ${shown} of ${total}. Search to narrow.` }));
}

// On startup: read the open mission's SDK keys again, so the Inputs screen has them.
export async function reloadSdk() {
  if (!api || !session.root) return;
  try {
    info = await api.describeRoot(session.root, session.sdkDir);
    const sdk = await api.sdkFor(session.root, S.meta.scenario, session.mission ? session.mission.name : foldStem(S.meta.activity), session.sdkDir);
    ui.sdkKeys = sdk.text ? parseSdk(sdk.text).keys : [];
    session.sdkPath = sdk.text ? sdk.path : '';
    if (ui.sdkKeys.length) stampSlotTypes(ui.sdkKeys);
  } catch (e) { /* folder gone: keep going without keys */ }
}

export async function openMission(name) {
  if (isDirty() && !confirm(`"${session.mission.name}" has changes that are not saved. Open "${name}" and lose them?`)) return;
  let m;
  try { m = await api.readMission(session.root, name, session.sdkDir); } catch (e) { alert('Could not read that mission: ' + e.message); return; }
  let kind = 'visual', imported = false; const notes = [];
  const asText = (why) => { kind = 'text'; if (why) notes.push(why); };
  // A script in a shape the canvas knows is read into a drawing; anything else is text.
  const read = (r) => { if (r.error) asText(r.error + ' The script is shown as text instead.'); else { imported = true; notes.push(...r.warnings); } };
  if (m.scene) {
    try { setDoc(normalize(JSON.parse(m.scene))); }
    catch (e) { asText('The saved drawing next to this script could not be read, so the script is shown as text.'); }
  } else if (m.lua != null && looksLikeCampaign(m.lua)) read(importCampaign(m.lua, name));
  else if (m.lua != null && looksLikeFreeroam(m.lua)) read(importFreeroam(m.lua, m.files, name));
  else if (m.lua != null || Object.keys(m.files).length) asText();
  else { const d = blank(); d.meta.activity = name; setDoc(d); }

  if (kind === 'visual') S.meta.activity = name;
  ui.sdkKeys = m.sdk.text ? parseSdk(m.sdk.text).keys : [];
  session.sdkPath = m.sdk.text ? m.sdk.path : '';
  // Now each slot input knows what it is, so a slot in the wrong kind of socket is caught.
  if (kind === 'visual' && ui.sdkKeys.length) stampSlotTypes(ui.sdkKeys);
  if (kind === 'visual' && !S.meta.scenario && m.sdk.key) S.meta.scenario = m.sdk.key;
  if (!m.sdk.text && m.kind !== 'helpers') notes.push(m.sdk.key ? `The generated SDK module for ${m.sdk.key} was not found, so there are no keys to browse.` : 'Could not tell which scenario this activity runs, so no SDK keys were loaded.');
  const text = kind === 'text';
  Object.assign(session, { mission: { name, kind, imported }, files: text ? { ...m.files } : {}, saved: text ? { ...m.files } : {}, file: text ? Object.keys(m.files)[0] || '' : '', savedLua: null, notes });
  ui.selected = null; resetView();
  go('editor');
  if (imported) { tidy(); changed('nodes'); }
  // Unsaved changes are measured from what the drawing says right now. For a drawing saved
  // by this app, that is compared with what is on disk, so an outdated script shows as unsaved.
  if (!text) {
    const onDisk = m.lua == null ? null : m.lua + Object.entries(current().files).map(([n]) => m.files[n] || '').join('');
    const fresh = current().lua + Object.values(current().files).join('');
    session.savedLua = imported || m.lua == null || onDisk === fresh ? current().shown : '';
    renderMissionBar();
  }
  persist();
}

export async function saveMission() {
  if (!session.root) { alert('Choose a folder on the Missions screen first: your Sunrise install, or any folder of scripts.'); return; }
  const m = session.mission, text = m && m.kind === 'text';
  const name = text ? m.name : foldStem(S.meta.activity);
  if (!text && !S.meta.activity.trim()) { alert('Give the mission its activity name (top bar) first. The script is saved under that name.'); return; }
  const out = text ? null : current(), errors = out ? out.problems.filter((p) => p.level === 'err').length : 0;
  if (errors && !confirm(`The drawing has ${errors} problem${errors === 1 ? '' : 's'} listed on the right. A script with problems may fault in game. Save anyway?`)) return;
  const known = missions.find((x) => x.name === name);
  const replacesHandWritten = !text && (m && m.name === name ? m.imported : known && known.kind !== 'scene' && known.kind !== 'none');
  const alsoWrites = out ? Object.keys(out.files) : [];
  if (replacesHandWritten && !confirm(`This replaces the hand-written script for "${name}"${alsoWrites.length ? ' (and ' + alsoWrites.join(', ') + ')' : ''} with one written from the drawing. Each old file is kept beside it with .bak added. Continue?`)) return;
  try {
    if (text) {
      // Only the files that changed are written; the main script is one of them, if there is one.
      const changedFiles = Object.fromEntries(Object.entries(session.files).filter(([n, t]) => t !== session.saved[n]));
      await api.writeMission(session.root, name, null, null, changedFiles);
      session.saved = { ...session.files };
    } else {
      await api.writeMission(session.root, name, out.lua, JSON.stringify(S, null, 1), out.files);
      Object.assign(session, { mission: { name, kind: 'visual', imported: false }, savedLua: out.shown });
    }
    loadedFor = null; persist(); renderMissionBar();
    if (ui.view === 'missions') renderMissionsView();
  } catch (e) { alert('Could not save: ' + e.message); }
}

if (api) {
  $('v-missions').hidden = false;
  $('b-mission-save').onclick = saveMission;
  $('mission-name').onclick = () => { if (session.mission && session.root) api.reveal(session.root, session.mission.name); };
  $('mission-search').addEventListener('input', () => renderMissionsView());
  $('mission-kind').addEventListener('change', () => renderMissionsView());
  $('b-root-refresh').onclick = () => renderMissionsView(true);
  // Switching folder lets go of the open mission: its name means something else over there.
  const useRoot = async (root) => {
    if (root !== session.root && isDirty() && !confirm(`"${session.mission.name}" has changes that are not saved. Switch folder and lose them?`)) return;
    if (root !== session.root) Object.assign(session, NO_MISSION());
    session.root = root;
    // A plain scripts folder borrows SDK keys from a Sunrise install, when there is one to find.
    const d = await api.describeRoot(root, session.sdkDir);
    if (d && d.kind === 'scripts' && !d.sdk) { const found = await api.findSunrise(); if (found) session.sdkDir = found; }
    persist(); await renderMissionsView(true); changed('all');
  };
  $('b-root-find').onclick = async () => {
    const root = await api.findSunrise();
    if (!root) { alert('No Sunrise install was found where the launcher says the game is. Use "Choose folder…" to point at it, or at any folder of scripts.'); return; }
    useRoot(root);
  };
  $('b-root-choose').onclick = async () => {
    const r = await api.chooseRoot();
    if (!r.picked) return;
    if (!r.root) { alert('That folder could not be opened.'); return; }
    useRoot(r.root);
  };
  $('b-sdk-choose').onclick = async () => {
    const r = await api.chooseSdk();
    if (!r.picked) return;
    if (!r.sdk) { alert('No generated SDK was found there. Pick a Sunrise install (or its sdk folder): it must contain sdk/lua/missions.lua. Sunrise writes that after the game has been launched once.'); return; }
    session.sdkDir = r.sdk; persist(); await reloadSdk(); renderMissionsView(true);
  };
  $('b-sdk-clear').onclick = () => { session.sdkDir = ''; ui.sdkKeys = []; session.sdkPath = ''; persist(); renderMissionsView(true); };
  for (const k of ['', 'scene', 'campaign', 'freeroam', 'lua', 'helpers', 'none']) $('mission-kind').append(el('option', { value: k, textContent: k ? KIND[k][0] : 'All kinds' }));
}
