// Entry point: loads the document (and, in the desktop app, the whole saved workspace),
// wires the top bar, and routes every change to the screens that need to redraw.
import './style.css';
import { setCustom } from './catalog.js';
import { S, setDoc, load, save, setSaver, blank, normalize, example, exampleZavala, setMode } from './state.js';
import { foldStem } from './compile/index.js';
import { api, session, persist, persistNow } from './desktop.js';
import { $, el, ui, hooks, changed, download } from './ui/dom.js';
import { renderNodes, applyPan, resetView } from './ui/canvas.js';
import { closePicker } from './ui/sockets.js';
import { renderSide, renderPalette } from './ui/sidebar.js';
import { renderInputsView } from './ui/inputsView.js';
import { renderNodesView } from './ui/nodesView.js';
import { renderOutput, current } from './ui/output.js';
import { renderMissionsView, renderMissionBar, reloadSdk, openMission, saveMission, isDirty, NO_MISSION } from './ui/missionsView.js';
import { renderTextView } from './ui/textView.js';

const HELP = {
  scene: `<p><b>Stack</b> nodes: a node snapped under another waits for the one above to finish.</p>
    <p><b>Lines</b> (drag from the dot under a node onto another node) start things in parallel. Several lines into one node means <b>whichever finishes first</b>; into <i style="background:var(--control)">Wait for all</i> it means <b>all of them</b>.</p>
    <p><i style="background:var(--begin)">orange</i> is a trigger (Begin, When, Trigger local), <i style="background:var(--spawn)">green</i> spawns, <i style="background:var(--action)">blue</i> acts, <i style="background:var(--when)">purple</i> waits for the game, <i style="background:var(--control)">yellow</i> controls flow, <i style="background:var(--end)">crimson</i> ends.</p>
    <p><b>Local triggers</b> save long lines: <b>Trigger local x</b> fires a name, and a stack headed <b>When x</b> starts when it fires. Every node runs at most once; built-in nodes hold no variables.</p>
    <p>Select a node and press <b>Make prefab</b> to fold it and the stack under it into one reusable <i style="background:var(--prefab)">prefab</i> node. <b>Unpack</b> turns one back into its steps.</p>`,
  campaign: `<p><b>Campaign mode</b> draws a linear story and writes a <b>lib.campaign</b> table, the format of the Red War drafts.</p>
    <p>Stack <b>Legs</b> under the green <b>Campaign</b> node, in order; the player lands in the first. A trigger only reports once its leg arms it.</p>
    <p>Stack the story under <b>When the player lands</b>. Each <i style="background:var(--step)">Step</i> node starts a step; the blue nodes below it happen when it starts and the purple <b>Until</b> nodes end it (any one of them). Unless it is a <b>barrier</b>, a step also ends when the player reaches a later step's trigger or leg.</p>
    <p>An <i style="background:var(--control)">Encounter</i> is its own stack. Drag a line from the dot under a Step onto it to spawn it once that step has started; with no line it can spawn from the landing on.</p>
    <p>The library arms triggers, replays markers, holds the spawn through opening cutscenes and completes the mission after the last step.</p>`,
  mission: `<p><b>Mission mode</b> splits a mission the way Bungie did: a <b>Flow</b> that says what the player is asked to do next, and <b>scenes</b> that play it out. Each is a tab.</p>
    <p>On the <b>Flow</b> tab, stack <b>Legs</b> (the areas, in order) under the Mission node, and <i style="background:var(--step)">Steps</i> under <b>When the player lands</b>. A step shows a goal, can <b>Run scene</b>s, and ends on an <b>Until</b> node: a trigger, an object used, a leg entered, or a scene firing an output.</p>
    <p>A <b>scene</b> tab is drawn like a free scene. It starts at <b>When this scene is run</b> and tells the flow something happened with <b>Trigger output x</b>. Tag a scene with its leg (top right) and it waits until the player is there; triggers are armed for you when a node starts waiting on them.</p>
    <p>Steps run strictly in order. Scenes keep running after their step ends, so a fight or an idle line can outlast the goal that started it.</p>`,
  freeroam: `<p><b>Freeroam mode</b> draws an open-world destination and writes a <b>lib.freeroam</b> zone table: a short script plus <b>content.lua</b> beside it.</p>
    <p>Each green <i style="background:var(--begin)">Zone</i> is one authored state of the destination, with its region number and the squads that patrol it.</p>
    <p>Stack <i style="background:var(--action)">Public event</i> nodes under a zone: the library runs one at a time and opens the chest when its squads are dead. Or stack one <i style="background:var(--when)">Lost Sector</i>: a zone with a sector is that sector's private content.</p>
    <p>The library places and respawns everything; there is nothing to wire. Long lists fold away: click <b>+N more</b> to see them all.</p>
    <p>These files are normally generated from the game's own data, so most of the time you will be trimming or correcting them, not writing them from nothing.</p>`,
  both: `<p><b>Inputs</b>: drag one from the left into a matching socket, or click a socket to search. Drag a filled socket away to empty it. Double-click an input to edit it; <b>Manage…</b> opens the full list.</p>
    <p><b>Your own nodes</b>: the <b>Nodes</b> tab is where you write new node types; they appear at the bottom of the palette.</p>
    <p><b>Ctrl + wheel</b> zooms, the wheel scrolls, <b>Del</b> removes the highlighted nodes, and clicking a line removes it.</p>
    <p><b>Highlighting</b>: click a node; <b>Shift</b>- or <b>Ctrl</b>-click adds or removes one; hold <b>Shift</b> and drag on the background to draw a box round several; <b>Ctrl+A</b> takes everything on the canvas. Drag any highlighted node to move them all. <b>Ctrl+C</b>, <b>Ctrl+X</b> and <b>Ctrl+V</b> copy, cut and paste them, into another scene tab or another mission too. Inputs come along.</p>`,
};

// A mission the canvas cannot draw is edited as text; the Editor tab shows that instead.
const textOpen = () => !!session.mission && session.mission.kind === 'text';

function renderMeta() {
  const text = textOpen();
  $('m-mode').value = S.meta.mode;
  $('l-initial').hidden = S.meta.mode !== 'scene';   // the other modes' libraries choose the spawn
  $('editor').hidden = ui.view !== 'editor' || text;
  $('text-view').hidden = ui.view !== 'editor' || !text;
  for (const v of ['missions', 'inputs', 'nodes']) $(v + '-view').hidden = ui.view !== v;
  for (const v of ['missions', 'editor', 'inputs', 'nodes']) $('v-' + v).classList.toggle('on', ui.view === v);
  $('help').innerHTML = HELP[S.meta.mode] + HELP.both;
  $('m-activity').value = S.meta.activity; $('m-scenario').value = S.meta.scenario;
  const sel = $('m-initial'); sel.replaceChildren(el('option', { value: '', textContent: 'default' }));
  for (const i of S.inputs) if (i.kind === 'State') sel.append(el('option', { value: i.id, textContent: i.name }));
  sel.value = S.inputs.some((i) => i.id === S.meta.initial && i.kind === 'State') ? S.meta.initial : '';
}

hooks.changed = (what) => {
  save();
  setCustom(S.custom);
  if (what === 'all') {
    renderMeta();
    if (ui.view === 'inputs') renderInputsView();
    else if (ui.view === 'nodes') renderNodesView();
    else if (ui.view === 'missions') renderMissionsView();
    else if (textOpen()) renderTextView();
    else { renderSide(); renderPalette(); }
  }
  if ((what === 'all' || what === 'nodes') && ui.view === 'editor' && !textOpen()) renderNodes();
  renderOutput();
  renderMissionBar();
};
hooks.go = (view, focus) => {
  ui.view = view; closePicker();
  if (view === 'inputs') $('iv-search').value = '';
  if (view === 'nodes' && focus) ui.editDef = focus;
  changed('all');
  if (view === 'inputs' && focus) renderInputsView(focus);
};

// Top bar and file actions.
$('m-activity').addEventListener('input', (e) => { S.meta.activity = e.target.value; changed(); });
$('m-scenario').addEventListener('input', (e) => { S.meta.scenario = e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'); changed(); });
$('m-initial').addEventListener('change', (e) => { S.meta.initial = e.target.value; changed(); });
$('m-mode').addEventListener('change', (e) => { setMode(e.target.value); ui.selected = null; resetView(); changed('all'); });
for (const v of ['missions', 'editor', 'inputs', 'nodes']) $('v-' + v).onclick = () => hooks.go(v);
$('b-manage').onclick = () => hooks.go('inputs');
$('b-custom').onclick = () => hooks.go('nodes');
$('b-help').onclick = () => { $('help').hidden = !$('help').hidden; };
addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { closePicker(); $('help').hidden = true; }
  if (api && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveMission(); }
});

// Replacing the drawing also lets go of the open mission: it is no longer that mission.
function replaceDoc(d) {
  if (isDirty() && !confirm(`"${session.mission.name}" has changes that are not saved to Sunrise. Continue and lose them?`)) return false;
  Object.assign(session, NO_MISSION());
  setDoc(d); ui.selected = null; resetView(); ui.view = 'editor'; changed('all');
  return true;
}
$('b-new').onclick = () => {
  if (!confirm('Start empty? The scene, the campaign, all inputs and all custom nodes are cleared.')) return;
  const d = blank(); d.meta.mode = S.meta.mode; replaceDoc(d);
};
$('b-example').onchange = (e) => {
  const which = e.target.value; e.target.value = '';
  if (!which || !confirm('Load this example? The current scene, campaign, inputs and custom nodes are replaced.')) return;
  const mode = S.meta.mode;
  if (!replaceDoc(blank())) return;
  if (which === 'zavala') exampleZavala(); else example(mode);
  changed('all');
};
$('b-save').onclick = () => download(foldStem(S.meta.activity) + '.scene.json', JSON.stringify(S, null, 1), 'application/json');
$('b-open').onclick = () => $('f-open').click();
$('f-open').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.inputs) || !d.meta) throw new Error('not a scene file');
    replaceDoc(normalize(d));
  } catch (x) { alert('Could not open that file: ' + x.message); }
  e.target.value = '';
};

// Start up. In the desktop app, pick up exactly where the last run stopped: the drawing,
// the open mission and its unsaved text, the screen, the pan and zoom.
async function boot() {
  let first = false;
  if (api) {
    let saved = null;
    try { saved = await api.loadState(); } catch (e) { /* unreadable workspace: start fresh */ }
    if (saved && saved.doc && saved.doc.meta && Array.isArray(saved.doc.nodes)) {
      setDoc(normalize(saved.doc));
      Object.assign(session, saved.session || {});
      const u = saved.ui || {};
      Object.assign(ui, { view: u.view || 'editor', selected: u.selected ?? null, editDef: u.editDef || null, zoom: u.zoom || 1, pan: u.pan && isFinite(u.pan.x) ? u.pan : { x: 0, y: 0 } });
    } else { example('scene'); first = true; }
    setSaver(persist);
    addEventListener('beforeunload', persistNow);
    // The folder may have been moved or deleted since last time.
    if (session.root && !(await api.describeRoot(session.root, session.sdkDir))) session.root = '';
    if (!session.root) session.root = (await api.findSunrise()) || '';
    await reloadSdk();
    if (first) ui.view = 'missions';
  } else {
    const d = load();
    if (d) setDoc(d); else example('scene');
  }
  applyPan(); changed('all');
  // A small handle for automated checks of the running app (see electron/smoke.js).
  window.sunriseScenes = { session, ui, doc: () => S, current, openMission, saveMission, go: hooks.go, ready: true };
}
boot();
