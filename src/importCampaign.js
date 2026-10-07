// Reads a hand-written lib.campaign script (the shape of the Red War drafts) back into a
// campaign drawing. Pure: Lua text in, a document and a list of what could not be carried
// over out. It evaluates only what such a script declares statically: locals, tables,
// references into the mission module, and calls to campaign.unit / line / move.
import { blank, setDoc, S, addInput, addNode } from './state.js';
import { parseLua, evaluator } from './luaEval.js';

const TABLE = { Slot: 'Slot', Squad: 'Squad', Scene: 'Scene', Directive: 'Directive', states: 'State', DialogueCue: 'Cue' };
const END_NODE = { trigger: ['c_end_trigger', 'triggers'], monitor: ['c_end_monitor', 'monitors'], region: ['c_end_region', 'leg'], clear: ['c_end_clear', 'encounters'],
  interact: ['c_end_interact', 'object'], ghost_link: ['c_end_scan', 'link'], destroyed: ['c_end_destroyed', 'objects'], scene: ['c_end_scene', 'scene'], health: ['c_end_health', 'actor'] };

// Is this text a script the importer can read at all?
export const looksLikeCampaign = (lua) => /\bcampaign\.new\s*[{(]/.test(lua) && /require\(\s*["']lib\.campaign["']\s*\)/.test(lua);

export function importCampaign(lua, activity) {
  const { ast, error } = parseLua(lua);
  if (error) return { error };
  const { env, ev, run, seen } = evaluator(), warnings = [];
  const warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };
  const found = run(ast.body), scenario = seen.scenario;
  if (!found || !found.campaign || !found.campaign.kv) return { error: 'This script does not end in "return campaign.new{...}", so it cannot be drawn.' };
  const C = found.campaign.kv;

  // ---- build the drawing
  setDoc(blank());
  S.meta = { activity: activity || '', scenario, initial: '', mode: 'campaign' };
  const input = (kind, key) => {
    const have = S.inputs.find((i) => i.kind === kind && i.key === key);
    return (have || addInput(kind, key.split('.').pop().toLowerCase().replace(/^([0-9])/, '_$1'), key)).id;
  };
  // A value that should name something in the mission module -> the id of an input for it.
  const ref = (v, want, what) => {
    if (v == null) return '';
    const kind = v.path && v.path[0] === 'mission' ? TABLE[v.path[1]] : null, key = kind ? v.path.slice(2).join('.') : '';
    if (!kind || !key) { warn(`${what}: could not read what it refers to; left empty.`); return ''; }
    if (want === 'Scene' && kind === 'Slot') return input('Scene', key);   // a scene and its slot share one key
    if (kind !== want) { warn(`${what}: expected a ${want}, found mission.${v.path.slice(1).join('.')}; left empty.`); return ''; }
    return input(kind, key);
  };
  const listOf = (v) => (v == null ? [] : v.list && !v.path ? v.list : [v]);
  const refs = (v, want, what) => listOf(v).map((x) => ref(x, want, what)).filter(Boolean);
  const known = (t, keys, what) => { for (const k in t.kv) if (!keys.includes(k)) warn(`${what}: the field "${k}" has no node and was dropped.`); };

  // on_start bodies: campaign.move calls become device nodes; anything else is kept as Lua,
  // with the file's short names (Slot.X, cue.CUE_1, move) spelled out so it still resolves.
  const aliases = [...env.keys()].map((name) => [name, ev(env.get(name))]).filter(([, v]) => v && v.path).map(([name, v]) => [name, v.path.join('.')]);
  const helpers = [...env.keys()].filter((name) => !aliases.some(([a]) => a === name));
  const startNodes = (v, what) => {
    if (v == null) return [];
    if (!v.fn) { warn(`${what}: on_start is not a function written in place; dropped.`); return []; }
    const out = [], param = v.fn.parameters[0] && v.fn.parameters[0].name;
    let loose = [];
    const flush = () => {
      if (!loose.length) return;
      let code = lua.slice(loose[0].range[0], loose[loose.length - 1].range[1]);
      for (const [name, full] of aliases) code = code.replace(new RegExp('(?<![.:\\w])' + name + '\\b', 'g'), full);
      if (param && param !== 'context') code = code.replace(new RegExp('(?<![.:\\w])' + param + '\\b', 'g'), 'context');
      for (const h of helpers) if (new RegExp('(?<![.:\\w])' + h + '\\b').test(code)) warn(`${what}: its Lua uses "${h}", which is defined elsewhere in the old file and was not carried over.`);
      const lines = code.split('\n'), pad = Math.min(...lines.slice(1).filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length), 99);
      out.push(['c_lua', { code: lines.map((l, i) => (i ? l.slice(Math.min(pad, l.match(/^\s*/)[0].length)) : l)).join('\n') }]);
      loose = [];
    };
    for (const s of v.fn.body) {
      const e = s.type === 'CallStatement' ? s.expression : null, f = e && e.type === 'CallExpression' ? ev(e.base) : null;
      if (f && f.path && f.path.join('.') === 'campaign.move' && e.arguments.length === 3) {
        const transition = ev(e.arguments[2]), devices = refs(ev(e.arguments[1]), 'Slot', what);
        if (typeof transition === 'string' && devices.length) { flush(); out.push(['c_move', { transition, devices }]); continue; }
      }
      loose.push(s);
    }
    flush();
    return out;
  };
  const sayNodes = (v, what) => listOf(v).map((ln) => {
    const a = ln && ln.line ? ln.line : [ln];
    return ['c_say', { cue: ref(a[0], 'Cue', what + ' line'), filter: ref(a[1], 'Slot', what + ' line filter') }];
  });
  const stack = (x, y, list) => list.map(([t, p]) => addNode(t, x, y, p)).map((n, i, a) => { if (a[i + 1]) n.next = a[i + 1].id; return n; });

  known(found.campaign, ['key', 'directive_sensor', 'dialogue_sensor', 'legs', 'steps', 'encounters', 'intro', 'spawn_set', 'omit', 'finish'], 'campaign.new');
  if ('finish' in C) warn('campaign.new: the "finish" function has no node and was dropped.');

  // Encounters first: steps refer to them by id.
  const encNode = new Map(); let ey = 30;
  for (const e of listOf(C.encounters)) {
    if (!e || !e.kv) { warn('An encounter could not be read and was dropped.'); continue; }
    const k = e.kv, what = `Encounter "${k.id}"`, squads = [];
    known(e, ['id', 'after', 'trigger', 'monitor', 'objective', 'squads', 'lines', 'on_start'], what);
    for (const u of listOf(k.squads)) {
      const a = u && u.unit ? u.unit : [u], id = ref(a[0], 'Squad', what + ' squad');
      if (id) squads.push(id);
      if (a[1] && a[1].path && a[0] && a[0].path && a[1].path[2] !== a[0].path[2]) warn(`${what}: a squad is paired with a slot of another name; the editor always uses the slot that shares the squad's key.`);
      if (a[2] != null) warn(`${what}: task groups on squads have no node yet and were dropped.`);
    }
    const kids = [...sayNodes(k.lines, what), ...startNodes(k.on_start, what)];
    const nodes = stack(1060, ey, [['c_enc', { id: String(k.id || ''), trigger: ref(k.trigger, 'Slot', what + ' trigger'), monitor: ref(k.monitor, 'Slot', what + ' monitor'),
      objective: ref(k.objective, 'Slot', what + ' objective'), squads }], ...kids]);
    nodes[0].after = typeof k.after === 'string' ? k.after : '';
    encNode.set(String(k.id), nodes[0]);
    ey += 96 + 26 * Math.ceil(squads.length / 2) + 64 * kids.length;
  }

  const setup = [['c_setup', { key: String(C.key || ''), sensor: ref(C.directive_sensor, 'Slot', 'directive_sensor'), voice: ref(C.dialogue_sensor, 'Slot', 'dialogue_sensor'),
    spawn: C.spawn_set && C.spawn_set.num ? C.spawn_set.num : '' }]];
  for (const cut of listOf(C.intro)) if (cut && cut.kv) setup.push(['c_cut', { state: ref(cut.kv.state, 'State', 'intro state'), cinematic: ref(cut.kv.cinematic, 'Slot', 'intro cinematic') }]);
  const legNode = new Map();
  for (const leg of listOf(C.legs)) {
    if (!leg || !leg.kv) continue;
    known(leg, ['id', 'state', 'arm', 'watch'], `Leg "${leg.kv.id}"`);
    setup.push(['c_leg', { id: String(leg.kv.id || ''), state: ref(leg.kv.state, 'State', `Leg "${leg.kv.id}" state`), arm: refs(leg.kv.arm, 'Slot', 'leg arm'), watch: refs(leg.kv.watch, 'Slot', 'leg watch') }]);
  }
  if (C.omit) setup.push(['c_omit', { objects: refs(C.omit, 'Slot', 'omit') }]);
  for (const n of stack(40, 30, setup)) if (n.type === 'c_leg') legNode.set(n.params.id, n);

  const story = [['c_story', {}]], stepIds = [];
  for (const s of listOf(C.steps)) {
    if (!s || !s.kv) { warn('A step could not be read and was dropped.'); continue; }
    const k = s.kv, what = `Step "${k.id}"`;
    known(s, ['id', 'directive', 'navpoint', 'waypoint', 'lines', 'scene', 'on_start', 'ends', 'barrier', 'revisit'], what);
    stepIds.push(String(k.id));
    story.push(['c_step', { id: String(k.id || ''), directive: ref(k.directive, 'Directive', what + ' directive'), marker: ref(k.navpoint, 'Slot', what + ' navpoint'),
      waypoint: ref(k.waypoint, 'Slot', what + ' waypoint'), barrier: k.barrier === true, revisit: k.revisit === true }]);
    story.push(...sayNodes(k.lines, what));
    if (k.scene != null) story.push(['c_scene', { scene: ref(k.scene, 'Scene', what + ' scene') }]);
    story.push(...startNodes(k.on_start, what));
    const ends = k.ends && k.ends.kv ? k.ends.kv : {};
    for (const kind in ends) {
      const v = ends[kind], spec = END_NODE[kind];
      if (!spec) { warn(`${what}: the end "${kind}" has no node and was dropped.`); continue; }
      const [type, param] = spec;
      if (kind === 'region') { const leg = legNode.get(v); if (!leg) warn(`${what}: ends in the leg "${v}", which does not exist.`); story.push([type, { leg: leg ? leg.id : '' }]); }
      else if (kind === 'clear') story.push([type, { encounters: listOf(v).map((id) => encNode.get(String(id))).filter(Boolean).map((n) => n.id) }]);
      else if (kind === 'health') story.push([type, { actor: ref(v && v.kv && v.kv.slot, 'Slot', what + ' health'), at: v && v.kv && v.kv.at && v.kv.at.num ? Number(v.kv.at.num) : 0.5 }]);
      else if (kind === 'trigger' || kind === 'monitor' || kind === 'destroyed') story.push([type, { [param]: refs(v, 'Slot', `${what} ${kind}`) }]);
      else story.push([type, { [param]: ref(v, kind === 'scene' ? 'Scene' : 'Slot', `${what} ${kind}`) }]);
    }
  }
  const made = stack(540, 30, story);
  const stepNode = new Map(made.filter((n) => n.type === 'c_step').map((n) => [n.params.id, n]));
  for (const enc of encNode.values()) {
    if (enc.after && enc.after !== 'arrival') {
      if (stepNode.has(enc.after)) S.wires.push({ from: stepNode.get(enc.after).id, to: enc.id });
      else warn(`Encounter "${enc.params.id}" comes after the step "${enc.after}", which does not exist.`);
    }
    delete enc.after;
  }
  return { doc: S, warnings, scenario };
}
