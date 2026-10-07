// The document being edited and every change that can be made to it. No page access here
// except localStorage, so tests can drive it from Node.
import { T, T as TYPE, setCustom, fits, MODES } from './catalog.js';

const STORE = 'sunrise-scenes.v1';
// S.nodes and S.wires are the graph of the mode on screen; S.graphs holds the other modes'.
export let S = null;
export function setDoc(d) { S = d; setCustom(S.custom); }

export function blank() {
  return { meta: { activity: '', scenario: '', initial: '', mode: 'scene' }, inputs: [], custom: [], nodes: [], wires: [], graphs: {}, mission: blankMission(), collapsed: [], seq: 1 };
}
// Mission mode keeps several graphs: the flow, and one per scene. Like the modes, the tab on
// screen has its nodes in S.nodes and S.wires; its own entry holds null until it is put away.
function blankMission() { return { tabs: [{ id: 'flow', name: 'Flow', nodes: [], wires: [] }], active: 'flow' }; }
// Every tab with its graph, wherever that graph currently is.
export function tabsOf(doc) {
  return doc.mission.tabs.map((t) => (doc.meta.mode === 'mission' && t.id === doc.mission.active ? { ...t, nodes: doc.nodes, wires: doc.wires } : { ...t, nodes: t.nodes || [], wires: t.wires || [] }));
}
export const activeTab = () => S.mission.tabs.find((t) => t.id === S.mission.active);
export const onFlowTab = () => S.meta.mode === 'mission' && S.mission.active === 'flow';
// Put the graph on screen back where it lives, and take another one out.
function putAway() {
  if (S.meta.mode === 'mission') { const t = activeTab(); t.nodes = S.nodes; t.wires = S.wires; }
  else S.graphs[S.meta.mode] = { nodes: S.nodes, wires: S.wires };
}
function takeOut() {
  if (S.meta.mode === 'mission') { const t = activeTab(); S.nodes = t.nodes || []; S.wires = t.wires || []; t.nodes = t.wires = null; }
  else { const g = S.graphs[S.meta.mode] || { nodes: [], wires: [] }; S.nodes = g.nodes; S.wires = g.wires; delete S.graphs[S.meta.mode]; }
}
export function setTab(id) {
  if (S.meta.mode !== 'mission' || id === S.mission.active || !S.mission.tabs.some((t) => t.id === id)) return;
  putAway(); S.mission.active = id; takeOut();
}
export function addSceneTab(name) {
  const base = (name || 'scene').toLowerCase().replace(/[^a-z0-9_]+/g, '_') || 'scene';
  let n = base, k = 2; while (S.mission.tabs.some((t) => t.name === n)) n = base + '_' + k++;
  const tab = { id: 't' + S.seq++, name: n, leg: '', nodes: [], wires: [] };
  S.mission.tabs.push(tab); return tab;
}
export function removeTab(id) {
  if (id === 'flow') return;
  if (S.mission.active === id) setTab('flow');
  S.mission.tabs = S.mission.tabs.filter((t) => t.id !== id);
}

// Bring a saved document from any earlier version up to the current shape.
export function normalize(d) {
  d.meta.mode = MODES.includes(d.meta.mode) ? d.meta.mode : 'scene';
  d.custom = Array.isArray(d.custom) ? d.custom : [];
  d.graphs = d.graphs || {};
  // Before there were three modes the one other graph was kept as "other".
  if (d.other && Array.isArray(d.other.nodes)) d.graphs[d.meta.mode === 'campaign' ? 'scene' : 'campaign'] = d.other;
  setCustom(d.custom);
  const keep = (mode) => (n) => (T(n.type).missing ? String(n.type).startsWith('u_') : fits(n.type, mode));
  if (d.meta.mode !== 'mission') d.nodes = d.nodes.filter(keep(d.meta.mode));
  d.wires = d.wires || [];
  if (!d.mission || !Array.isArray(d.mission.tabs) || !d.mission.tabs.some((t) => t.id === 'flow')) d.mission = blankMission();
  if (!d.mission.tabs.some((t) => t.id === d.mission.active)) d.mission.active = 'flow';
  for (const t of d.mission.tabs) {
    const shown = d.meta.mode === 'mission' && t.id === d.mission.active;
    if (shown) { t.nodes = t.wires = null; } else { t.nodes = Array.isArray(t.nodes) ? t.nodes.filter((n) => TYPE(n.type).missing ? String(n.type).startsWith('u_') : fits(n.type, 'mission', t.id === 'flow')) : []; t.wires = t.wires || []; }
  }
  if (d.meta.mode === 'mission') d.nodes = d.nodes.filter((n) => TYPE(n.type).missing ? String(n.type).startsWith('u_') : fits(n.type, 'mission', d.mission.active === 'flow'));
  for (const mode of MODES) {
    if (mode === 'mission') { delete d.graphs.mission; continue; }
    if (mode === d.meta.mode) { delete d.graphs[mode]; continue; }
    const g = d.graphs[mode];
    d.graphs[mode] = { nodes: g && Array.isArray(g.nodes) ? g.nodes.filter(keep(mode)) : [], wires: (g && g.wires) || [] };
  }
  d.collapsed = d.collapsed || []; d.seq = d.seq || 1e6;
  delete d.campaign; delete d.other;
  return d;
}
export function load() {
  try { const d = JSON.parse(localStorage.getItem(STORE)); return d && d.meta && Array.isArray(d.nodes) ? normalize(d) : null; } catch (e) { return null; }
}
// In the browser the document autosaves to localStorage. The desktop app swaps this for
// its own saver, which writes the whole workspace to disk.
let saver = () => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* storage may be unavailable */ } };
export function setSaver(fn) { saver = fn; }
export function save() { saver(); }

export const node = (id) => S.nodes.find((n) => n.id === id);
export const parentOf = (id) => S.nodes.find((n) => n.next === id);
export function chain(n) { const out = []; while (n) { out.push(n); n = n.next != null ? node(n.next) : null; } return out; }

export function uniqueName(base) { let n = base, k = 2; while (S.inputs.some((i) => i.name === n)) n = base + '_' + k++; return n; }
export function addInput(kind, name, key, slotType) {
  const i = { id: 'i' + S.seq++, kind, name: uniqueName(name || kind.toLowerCase()), key: key || '' };
  if (slotType != null) i.slotType = slotType;
  S.inputs.push(i); return i;
}

// Give every slot input the type the SDK records for its key (and forget the type of any
// the SDK does not know). keys is parseSdk(...).keys. Returns how many inputs now have one.
export function stampSlotTypes(keys) {
  const types = new Map(keys.filter((k) => k.kind === 'Slot' && k.type != null).map((k) => [k.key, k.type]));
  // Which authored object each slot, squad and scene belongs to, for telling a scene's cast.
  const objects = new Map(keys.filter((k) => k.object).map((k) => [k.kind + ':' + k.key, k.object]));
  // The events each scene waits for, as the SDK lists them (only newer Sunrise builds do).
  const events = new Map(keys.filter((k) => k.kind === 'Scene' && k.events).map((k) => [k.key, k.events]));
  let n = 0;
  for (const i of S.inputs) {
    if (i.kind === 'Scene') { if (events.has(i.key)) i.events = events.get(i.key); else if (keys.length) delete i.events; }
    if (objects.has(i.kind + ':' + i.key)) i.object = objects.get(i.kind + ':' + i.key); else if (objects.size) delete i.object;
    if (i.kind !== 'Slot') { delete i.slotType; continue; }
    if (types.has(i.key)) { i.slotType = types.get(i.key); n++; } else if (types.size) delete i.slotType;
  }
  return n;
}

const ID_PREFIX = { c_step: 's', c_leg: 'leg', c_enc: 'enc', m_step: 's', m_leg: 'leg' };
// A node with every parameter at its default; not yet part of the document.
export function makeNode(type, x, y, params) {
  const n = { id: S.seq++, type, x, y, next: null, params: params || {} };
  for (const p of T(type).parts) {
    if (p.text != null || n.params[p.name] != null) continue;
    if (p.kind === 'enum') n.params[p.name] = p.options[0];
    else if (p.kind === 'num') n.params[p.name] = p.name === 'seconds' ? 5 : p.name === 'at' ? 0.5 : p.name === 'event' ? 1 : 0;   // region 0 is a real region; events count from 1
    else if (p.kind === 'flag') n.params[p.name] = false;
    else if (p.kind === 'id') n.params[p.name] = ID_PREFIX[type] ? ID_PREFIX[type] + n.id : '';
    else if (p.kind === 'text' || p.kind === 'code') n.params[p.name] = '';
    else if (p.list) n.params[p.name] = [];
  }
  return n;
}
export function addNode(type, x, y, params) { const n = makeNode(type, x, y, params); S.nodes.push(n); return n; }
export function removeNode(id) {
  const n = node(id), p = parentOf(id);
  if (p) p.next = n.next; else if (n.next != null) { const c = node(n.next); c.x = n.x; c.y = n.y; }
  S.nodes = S.nodes.filter((m) => m.id !== id);
  S.wires = S.wires.filter((w) => w.from !== id && w.to !== id);
}
// ---- copy and paste
// The input ids a node's sockets hold.
function refsOf(n) {
  return T(n.type).parts.filter((p) => p.kind === 'ref').flatMap((p) => [].concat(n.params[p.name] ?? [])).filter((v) => v != null && v !== '');
}
// A copy of the given nodes that stands on its own: the snaps and lines between them, and the
// inputs their sockets name, so it can be pasted into another tab, mode or mission.
export function copyNodes(ids) {
  const set = new Set(ids), nodes = S.nodes.filter((n) => set.has(n.id)).map((n) => JSON.parse(JSON.stringify(n)));
  for (const n of nodes) if (!set.has(n.next)) n.next = null;
  const used = new Set(nodes.flatMap(refsOf));
  return {
    nodes, wires: S.wires.filter((w) => set.has(w.from) && set.has(w.to)).map((w) => ({ ...w })),
    inputs: S.inputs.filter((i) => used.has(i.id)).map((i) => ({ ...i })),
  };
}
// Add a copy to the canvas on screen with its top-left corner at `at`. Nodes that do not belong
// on this canvas are left out. Inputs are matched to the ones already here (the very same one,
// else one of the same kind and key) and made when there is none. Returns { ids, skipped }.
export function pasteNodes(clip, at) {
  const flow = onFlowTab(), keep = clip.nodes.filter((n) => !T(n.type).missing && fits(n.type, S.meta.mode, flow));
  const out = { ids: [], skipped: clip.nodes.length - keep.length };
  if (!keep.length) return out;
  const inputOf = new Map();
  for (const i of clip.inputs) {
    const here = S.inputs.find((x) => x.id === i.id && x.kind === i.kind && x.key === i.key)
      || (i.key && S.inputs.find((x) => x.kind === i.kind && x.key === i.key));
    inputOf.set(i.id, (here || addInput(i.kind, i.name, i.key, i.slotType)).id);
  }
  const ox = Math.min(...keep.map((n) => n.x)), oy = Math.min(...keep.map((n) => n.y));
  const idOf = new Map(keep.map((n) => [n.id, S.seq++]));
  for (const src of keep) {
    const n = JSON.parse(JSON.stringify(src));
    n.id = idOf.get(src.id); n.next = idOf.get(src.next) ?? null;
    n.x = Math.round(src.x - ox + at.x); n.y = Math.round(src.y - oy + at.y);
    for (const p of T(n.type).parts) {
      const v = n.params[p.name];
      if (p.kind === 'ref') { if (v != null) n.params[p.name] = Array.isArray(v) ? v.map((x) => inputOf.get(x)).filter((x) => x != null) : inputOf.get(v) ?? null; }
      // a step, leg or encounter is told apart by its id, so a copy needs one of its own
      else if (p.kind === 'id' && v && S.nodes.some((m) => m.type === n.type && m.params[p.name] === v)) n.params[p.name] = ID_PREFIX[n.type] ? ID_PREFIX[n.type] + n.id : v + '_' + n.id;
    }
    S.nodes.push(n); out.ids.push(n.id);
  }
  for (const w of clip.wires) if (idOf.has(w.from) && idOf.has(w.to)) S.wires.push({ ...w, from: idOf.get(w.from), to: idOf.get(w.to) });
  return out;
}

// Every node that is not on screen: the graphs of the other modes.
export const offscreenNodes = () => Object.values(S.graphs).flatMap((g) => g.nodes).concat(S.mission.tabs.flatMap((t) => t.nodes || []));
export function setMode(mode) {
  if (mode === S.meta.mode) return;
  putAway(); S.meta.mode = mode; takeOut();
}

// ---- custom nodes
export const customDef = (id) => S.custom.find((d) => d.id === id);
export function addCustom(def) { def.id = 'u_' + S.seq++; S.custom.push(def); setCustom(S.custom); return def; }
export function removeCustom(id) { S.custom = S.custom.filter((d) => d.id !== id); setCustom(S.custom); }
export function customUses(id) {
  const direct = S.nodes.concat(offscreenNodes()).filter((n) => n.type === id).length;
  const inside = S.custom.filter((d) => d.kind === 'prefab' && d.body.some((b) => b.type === id)).length;
  return direct + inside;
}

// Fold a stack into one reusable node. The inputs it names become the prefab's sockets.
// Returns the new definition, or a string saying why this stack cannot be folded.
export function makePrefab(headId) {
  const head = node(headId), group = chain(head);
  for (const n of group) {
    const t = T(n.type);
    if (t.head || t.noNext || n.type === 'all' || t.missing || (t.custom && t.custom.kind === 'prefab')) {
      return 'A prefab can hold actions and waits. Take the Begin, End, Wait-for-all and prefab nodes out of the stack first.';
    }
  }
  const inner = new Set(group.map((n) => n.id)), tail = group[group.length - 1];
  if (S.wires.some((w) => (inner.has(w.from) && w.from !== tail.id) || (inner.has(w.to) && w.to !== head.id))) {
    return 'Lines may only enter the top node and leave the bottom node of a prefab. Remove the lines in between first.';
  }
  const names = new Map();   // input id -> socket name
  const body = group.map((n) => {
    const params = {};
    for (const p of T(n.type).parts) {
      if (p.text != null) continue;
      const v = n.params[p.name];
      const ref = (id) => {
        const i = S.inputs.find((x) => x.id === id && x.kind === p.ref);
        if (!i) return '';
        if (!names.has(id)) names.set(id, { name: i.name, kind: i.kind });
        return '$' + i.name;
      };
      params[p.name] = p.kind !== 'ref' ? v : p.list ? (v || []).map(ref).filter(Boolean) : ref(v);
    }
    return { type: n.type, params };
  });
  const count = S.custom.filter((d) => d.kind === 'prefab').length + 1;
  const sockets = [...names.values()].map((s) => `{${s.name}:${s.kind}}`).join(' ');
  const def = addCustom({ kind: 'prefab', template: `Prefab ${count}${sockets ? ': ' + sockets : ''}`, body });

  const inst = makeNode(def.id, head.x, head.y, Object.fromEntries([...names].map(([id, s]) => [s.name, id])));
  const p = parentOf(head.id);
  if (p) p.next = inst.id;
  inst.next = tail.next;
  for (const w of S.wires) { if (w.to === head.id) w.to = inst.id; if (w.from === tail.id) w.from = inst.id; }
  S.nodes = S.nodes.filter((n) => !inner.has(n.id)); S.nodes.push(inst);
  return { def, node: inst };
}
// The reverse: replace one prefab node with the steps it stands for.
export function unpackPrefab(id) {
  const inst = node(id), def = T(inst.type).custom;
  if (!def || def.kind !== 'prefab' || !def.body.length) return;
  const sub = (v) => (typeof v === 'string' && v[0] === '$' ? inst.params[v.slice(1)] || '' : v);
  const made = def.body.map((b) => makeNode(b.type, inst.x, inst.y,
    Object.fromEntries(Object.entries(b.params).map(([k, v]) => [k, Array.isArray(v) ? v.map(sub) : sub(v)]))));
  made.forEach((n, k) => { n.next = k < made.length - 1 ? made[k + 1].id : inst.next; });
  const p = parentOf(inst.id);
  if (p) p.next = made[0].id;
  for (const w of S.wires) { if (w.to === inst.id) w.to = made[0].id; if (w.from === inst.id) w.from = made[made.length - 1].id; }
  S.nodes = S.nodes.filter((n) => n.id !== inst.id).concat(made);
  return made[0];
}
// Rename a prefab socket everywhere it appears: the sentence, the steps, and every node using it.
export function renamePrefabSocket(def, from, to) {
  def.template = def.template.replace(new RegExp('\\{' + from + ':'), '{' + to + ':');
  for (const b of def.body) for (const k in b.params) {
    const v = b.params[k];
    b.params[k] = Array.isArray(v) ? v.map((x) => (x === '$' + from ? '$' + to : x)) : v === '$' + from ? '$' + to : v;
  }
  for (const n of S.nodes.concat(offscreenNodes())) if (n.type === def.id && from in n.params) { n.params[to] = n.params[from]; delete n.params[from]; }
  setCustom(S.custom);
}

// The Zavala plaza fight from the GDC talk (slides 85 to 89), as far as Sunrise can say it.
// Every key is a real one from the Homecoming scenario (mission_towerfall): Bungie's four
// plaza scenes, Zavala's squad and the eight "kill cabal" squads are all still in the data.
// The first of the four scenes is rebuilt here from Sunrise's own requests, using local
// triggers the way the original does; the other three are Bungie's authored scenes, started
// one after another. What the original also did, and Sunrise has no request for, is left out:
// making Zavala immovable, passive and untargetable, telling squads whom to target, and the
// cover and firing animations.
export function exampleZavala() {
  setDoc(blank());
  // Not named mission_towerfall on purpose: saving this must not replace the real script.
  S.meta = { activity: 'zavala_plaza_demo', scenario: 'MISSION_TOWERFALL', initial: '', mode: 'scene' };
  const I = {};
  [['plaza', 'State', 'STATE_80B500BC_0006_0000_80B500B6'], ['zavala_meet', 'Slot', 'PT_PLAZA_ZAVALA_MEET', 31],
   ['zavala', 'Squad', 'SQ_ZAVALA'], ['plaza_kill_cabal', 'Slot', 'OBJ_PLAZA_KILL_CABAL', 3],
   ['squad_kill_cabal_5', 'Squad', 'SQUAD_KILL_CABAL_5'], ['squad_kill_cabal_6', 'Squad', 'SQUAD_KILL_CABAL_6'],
   ['squad_kill_cabal_7', 'Squad', 'SQUAD_KILL_CABAL_7'], ['squad_kill_cabal_8', 'Squad', 'SQUAD_KILL_CABAL_8'],
   ['zavala_bunker_shield_bunker', 'Scene', 'SC_ZAVALA_BUNKER_SHIELD_BUNKER'], ['zavala_combat', 'Scene', 'SC_ZAVALA_COMBAT'],
   ['zavala_shield_death', 'Scene', 'SC_ZAVALA_SHIELD_DEATH'],
  ].forEach(([n, k, key, type]) => { I[n] = addInput(k, n, key, type).id; });
  const stack = (x, y, list) => list.map(([t, p]) => addNode(t, x, y, p)).map((n, i, a) => { if (a[i + 1]) n.next = a[i + 1].id; return n; });
  const wire = (from, to) => S.wires.push({ from: from.id, to: to.id });
  const spawn = (squad) => ['spawn', { squad: I[squad], objective: I.plaza_kill_cabal }];

  // Script's part in the original: start the scene when the player reaches Zavala.
  stack(40, 30, [['arrive', { state: I.plaza }], ['trigger', { trigger: I.zavala_meet }], ['fire', { name: 'zavala_start' }], ['fire', { name: 't_combat_start' }]]);
  stack(40, 220, [['on_local', { name: 'zavala_start' }], ['spawn', { squad: I.zavala }]]);

  // "When t_combat_start": four squads, in two pairs, each pair reporting when it is dead.
  const combat = stack(470, 30, [['on_local', { name: 't_combat_start' }]])[0];
  // Side by side, as in the original, so each line drops straight into its own column.
  const s6 = stack(470, 120, [spawn('squad_kill_cabal_6')])[0], s8 = stack(920, 120, [spawn('squad_kill_cabal_8')])[0];
  const s5 = stack(1370, 120, [spawn('squad_kill_cabal_5'), ['cleared', { squads: [I.squad_kill_cabal_5, I.squad_kill_cabal_6] }], ['fire', { name: 't_cabal_5_and_6_dead' }]])[0];
  const s7 = stack(1840, 120, [spawn('squad_kill_cabal_7'), ['cleared', { squads: [I.squad_kill_cabal_7, I.squad_kill_cabal_8] }], ['fire', { name: 't_cabal_7_and_8_dead' }]])[0];
  for (const s of [s6, s8, s5, s7]) wire(combat, s);

  // When both pairs are dead, hand over to Bungie's remaining scenes, one after another.
  const a = stack(470, 260, [['on_local', { name: 't_cabal_5_and_6_dead' }]])[0], b = stack(790, 260, [['on_local', { name: 't_cabal_7_and_8_dead' }]])[0];
  const rest = stack(630, 350, [['all', {}],
    ['scene', { mode: 'start', scene: I.zavala_bunker_shield_bunker }], ['scene_end', { scene: I.zavala_bunker_shield_bunker }],
    ['scene', { mode: 'start', scene: I.zavala_combat }], ['scene_end', { scene: I.zavala_combat }],
    ['scene', { mode: 'start', scene: I.zavala_shield_death }]]);
  wire(a, rest[0]); wire(b, rest[0]);
  return S;
}

// One placeholder mission (the docs' "Build a mission from scratch"), drawn once in each mode.
export function example(mode = S ? S.meta.mode : 'scene') {
  if (mode === 'mission') mode = 'scene';   // there is no gate-mission drawing for mission mode yet
  setDoc(blank());
  S.meta = { activity: 'my_mission', scenario: 'MY_SCENARIO', initial: '', mode };
  const I = {};
  [['arrival', 'State', 'STATE_AAAA_0001_0000_BBBB'], ['gate_area', 'State', 'STATE_AAAA_0002_0000_CCCC'],
   ['goals', 'Slot', 'M_DIRECTIVE_SENSOR_DDDD'], ['reach_the_gate', 'Directive', 'REACH_THE_GATE'],
   ['clear_the_area', 'Directive', 'CLEAR_THE_AREA'], ['gate_marker', 'Slot', 'AP_GATE'],
   ['ghost', 'Slot', 'M_DIALOG_SENSOR_DDDD'], ['gate_line', 'Cue', 'M_DIALOG_SENSOR_DDDD.CUE_3'],
   ['gate', 'Slot', 'D_GATE'], ['at_gate', 'Slot', 'PT_GATE'], ['at_exit', 'Slot', 'PT_EXIT'],
   ['gate_fight', 'Slot', 'OBJ_GATE_FIGHT'], ['guards_a', 'Squad', 'SQ_GATE_A'], ['guards_b', 'Squad', 'SQ_GATE_B'],
  ].forEach(([n, k, key]) => { I[n] = addInput(k, n, key).id; });
  S.meta.initial = I.arrival;
  const stack = (x, y, list) => list.map(([t, p]) => addNode(t, x, y, p)).map((n, i, a) => { if (a[i + 1]) n.next = a[i + 1].id; return n; });

  const a = stack(40, 30, [
    ['arrive', { state: I.arrival }],
    ['goal', { directive: I.reach_the_gate, sensor: I.goals, marker: I.gate_marker }],
    ['region', { state: I.gate_area }],
    ['trigger', { trigger: I.at_gate }],
    ['goal', { directive: I.clear_the_area, sensor: I.goals }],
    ['spawn', { squad: I.guards_a, objective: I.gate_fight }],
    ['spawn', { squad: I.guards_b, objective: I.gate_fight }],
    ['cleared', { squads: [I.guards_a, I.guards_b] }],
    ['device', { transition: 'open', device: I.gate }],
  ]);
  const b = stack(520, 330, [['moved', { device: I.gate }]]);
  const c = stack(520, 430, [['delay', { seconds: 2 }], ['line', { sensor: I.ghost, cue: I.gate_line }]]);
  const d = stack(900, 380, [['all', {}], ['trigger', { trigger: I.at_exit }], ['clear_goal', { sensor: I.goals }], ['complete', {}]]);
  const last = a[a.length - 1].id;
  const scene = { nodes: S.nodes, wires: [{ from: last, to: b[0].id }, { from: last, to: c[0].id }, { from: b[0].id, to: d[0].id }, { from: c[1].id, to: d[0].id }] };

  S.nodes = [];
  stack(40, 30, [
    ['c_setup', { key: 'mm', sensor: I.goals, voice: I.ghost }],
    ['c_leg', { id: 'landing', state: I.arrival }],
    ['c_leg', { id: 'gate', state: I.gate_area, arm: [I.at_gate, I.at_exit] }],
  ]);
  const enc = stack(1020, 150, [['c_enc', { id: 'guards', trigger: I.at_gate, squads: [I.guards_a, I.guards_b], objective: I.gate_fight }]])[0];
  const story = stack(520, 30, [
    ['c_story', {}],
    ['c_step', { id: 'reach', directive: I.reach_the_gate, marker: I.gate_marker }],
    ['c_end_trigger', { triggers: [I.at_gate] }],
    ['c_step', { id: 'fight', directive: I.clear_the_area, barrier: true }],
    ['c_end_clear', { encounters: [enc.id] }],
    ['c_step', { id: 'leave' }],
    ['c_say', { cue: I.gate_line }],
    ['c_move', { transition: 'open', devices: [I.gate] }],
    ['c_end_trigger', { triggers: [I.at_exit] }],
  ]);
  const camp = { nodes: S.nodes, wires: [{ from: story[1].id, to: enc.id }] };
  // Freeroam has no example: its content is generated from the game's own data.
  S.graphs = { scene, campaign: camp, freeroam: { nodes: [], wires: [] } };
  const on = S.graphs[mode]; S.nodes = on.nodes; S.wires = on.wires; delete S.graphs[mode];
  return S;
}
