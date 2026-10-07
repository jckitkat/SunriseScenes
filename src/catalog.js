// The node catalogue: built-in node types, input kinds, and the registry of custom types.
// Pure data and helpers; nothing here touches the page.

// Sentence templates. {name:Kind} is a socket for a named input (? optional, * list),
// {name:=a|b} a fixed choice (a=x gives the choice a the Lua value x), {name:num} a number,
// {name:id}/{name:text} typed text, {name:flag} a checkbox, {name:code} a Lua box,
// {name:@type} a pick among nodes of that type.
// Colour groups, after Bungie's tool: orange for triggers (Begin, When a trigger fires, Trigger),
// green for spawning, blue for actions, purple for waiting on the game, yellow for flow.
export const GROUPS = { begin: 'Begin', trigger: 'Trigger', spawn: 'Spawn', when: 'When', action: 'Action', control: 'Flow', end: 'End', step: 'Step', prefab: 'Prefab' };

const BUILTIN = {
  // Free scene: any flow, compiled to a lib.flow graph.
  start:     { g: 'begin',   t: 'When the mission starts' },
  arrive:    { g: 'begin',   t: 'When the player first arrives in {state:State}' },
  region:    { g: 'when',    t: 'When the player enters {state:State}' },
  trigger:   { g: 'when',    t: 'When the player crosses {trigger:Slot/31}' },
  cleared:   { g: 'when',    t: 'When {squads:Squad*} are cleared' },
  interact:  { g: 'when',    t: 'When the player uses {object:Slot/4}' },
  destroyed: { g: 'when',    t: 'When {object:Slot/4} is destroyed' },
  moved:     { g: 'when',    t: 'When {device:Slot/23} has finished moving' },
  scene_end: { g: 'when',    t: 'When scene {scene:Scene} finishes' },
  goal:      { g: 'action',  t: 'Show goal {directive:Directive} on {sensor:Slot/68} pointing at {marker:Slot/47?}' },
  clear_goal:{ g: 'action',  t: 'Clear the goal on {sensor:Slot/68}' },
  line:      { g: 'action',  t: '{sensor:Slot/53} plays line {cue:Cue}' },
  spawn:     { g: 'spawn',   t: 'Spawn {squad:Squad} fighting for {objective:Slot/3?}' },
  device:    { g: 'action',  t: '{transition:=open|close|power_on|power_off|lock|unlock} {device:Slot/23}' },
  object:    { g: 'action',  t: '{mode:=spawn|remove} object {object:Slot/4}' },
  // "start" starts an authored scene with its cast (its own squads spawned, its actors bound to
  // them); "start bare" only starts it, for a scene whose actors are already standing there.
  scene:     { g: 'action',  t: '{mode:=start|start_bare|stop} scene {scene:Scene}' },
  // A scene's graph waits at gates; each event sent lets it past one. "event 2" is the second
  // key the SDK lists for that scene (event_keys), since the keys themselves are unnamed hashes.
  scene_event: { g: 'action', t: 'Send event {event:num} to scene {scene:Scene}' },
  cinematic: { g: 'action',  t: 'Play cinematic {cinematic:Slot/6} until it ends' },
  sequence:  { g: 'action',  t: 'Play sequence {sequence:Slot/5}' },
  music:     { g: 'action',  t: 'Set music on {sensor:Slot/11} to section {section:num}' },
  move:      { g: 'action',  t: 'Move the player to {state:State}' },
  path:      { g: 'action',  t: '{actor:Slot/2} walks {path:Slot/58}' },
  lua:       { g: 'action',  tag: 'Lua', t: 'Run Lua {code:code}' },
  delay:     { g: 'control', t: 'Wait {seconds:num} seconds' },
  all:       { g: 'control', t: 'Wait for all' },
  // Local triggers: a name fired in one place and waited on in another, instead of a long line.
  fire:      { g: 'trigger', t: 'Trigger local {name:id}' },
  on_local:  { g: 'trigger', head: true, t: 'When {name:id}' },
  complete:  { g: 'end',     t: 'Complete the mission', noNext: true },

  // Campaign: a linear story, compiled to a lib.campaign content table.
  c_setup:   { g: 'begin',   tag: 'Campaign', t: 'Campaign {key:id}: goals show on {sensor:Slot/68}, lines play on {voice:Slot/53?}, spawn set {spawn:text}' },
  c_cut:     { g: 'action',  tag: 'Opening', t: 'Open with cutscene {cinematic:Slot/6} in {state:State}' },
  c_leg:     { g: 'when',    tag: 'Leg', t: 'Leg {id:id} is {state:State}. On entry arm {arm:Slot/31*?} and watch {watch:Slot/30*?}' },
  c_omit:    { g: 'control', tag: 'Seed', t: 'Keep {objects:Slot/4*} out of the seed' },
  c_story:   { g: 'begin',   t: 'When the player lands' },
  c_step:    { g: 'step',    t: 'Step {id:id}: show goal {directive:Directive?} pointing at {marker:Slot/47?} hidden inside {waypoint:Slot/60?} {barrier:flag} {revisit:flag}' },
  c_say:     { g: 'action',  t: 'Say {cue:Cue} heard inside {filter:Slot/60?}' },
  c_move:    { g: 'action',  t: '{transition:=open|close|power_on|power_off|lock|unlock} {devices:Slot/23*}' },
  c_scene:   { g: 'action',  t: 'Start scene {scene:Scene}' },
  c_seq:     { g: 'action',  t: 'Play sequence {sequence:Slot/5}' },
  c_lua:     { g: 'action',  tag: 'Lua', t: 'Run Lua {code:code}' },
  c_end_trigger:   { g: 'when', tag: 'Until', end: 'trigger',    t: 'Until the player crosses {triggers:Slot/31*}' },
  c_end_monitor:   { g: 'when', tag: 'Until', end: 'monitor',    t: 'Until a player is inside {monitors:Slot/30*}' },
  c_end_region:    { g: 'when', tag: 'Until', end: 'region',     t: 'Until the player enters leg {leg:@c_leg}' },
  c_end_clear:     { g: 'when', tag: 'Until', end: 'clear',      t: 'Until {encounters:@c_enc*} are cleared' },
  c_end_interact:  { g: 'when', tag: 'Until', end: 'interact',   t: 'Until the player uses {object:Slot/4}' },
  c_end_scan:      { g: 'when', tag: 'Until', end: 'ghost_link', t: 'Until Ghost finishes scanning {link:Slot/65}' },
  c_end_destroyed: { g: 'when', tag: 'Until', end: 'destroyed',  t: 'Until {objects:Slot/4*} are all destroyed' },
  c_end_scene:     { g: 'when', tag: 'Until', end: 'scene',      t: 'Until scene {scene:Scene} finishes' },
  c_end_health:    { g: 'when', tag: 'Until', end: 'health',     t: 'Until {actor:Slot/2} falls to {at:num} of full health' },
  c_enc:     { g: 'control', tag: 'Encounter', head: true, t: 'Encounter {id:id}: when the player crosses {trigger:Slot/31?} or is inside {monitor:Slot/30?}, spawn {squads:Squad*} fighting for {objective:Slot/3?}' },

  // Mission: a flow of steps on one tab, and scenes (drawn like free scenes) on tabs of their own.
  // The flow says what the player is asked to do next; a step runs scenes and waits for one to report.
  m_mission: { g: 'begin',   tag: 'Mission', t: 'Mission {key:id}: goals show on {sensor:Slot/68}, lines play on {voice:Slot/53?}, spawn set {spawn:text}' },
  m_cut:     { g: 'action',  tag: 'Opening', t: 'Open with cutscene {cinematic:Slot/6} in {state:State}' },
  m_leg:     { g: 'when',    tag: 'Leg', t: 'Leg {id:id} is {state:State}' },
  m_story:   { g: 'begin',   t: 'When the player lands' },
  m_step:    { g: 'step',    t: 'Step {id:id}: show goal {directive:Directive?} pointing at {marker:Slot/47?} hidden inside {waypoint:Slot/60?}' },
  m_run:     { g: 'trigger', t: 'Run scene {scene:@tab}' },
  m_say:     { g: 'action',  t: 'Say {cue:Cue} heard inside {filter:Slot/60?}' },
  m_move:    { g: 'action',  t: '{transition:=open|close|power_on|power_off|lock|unlock} {devices:Slot/23*}' },
  m_seq:     { g: 'action',  t: 'Play sequence {sequence:Slot/5}' },
  m_until_scene:    { g: 'when', tag: 'Until', t: 'Until scene {scene:@tab} fires {output:id}' },
  m_until_trigger:  { g: 'when', tag: 'Until', t: 'Until the player crosses {triggers:Slot/31*}' },
  m_until_interact: { g: 'when', tag: 'Until', t: 'Until the player uses {object:Slot/4}' },
  m_until_leg:      { g: 'when', tag: 'Until', t: 'Until the player enters leg {leg:@m_leg}' },
  m_complete: { g: 'end',    t: 'Complete the mission', noNext: true },
  s_begin:   { g: 'begin',   t: 'When this scene is run' },
  s_out:     { g: 'trigger', t: 'Trigger output {name:id}' },

  // Freeroam: an open-world destination, compiled to a lib.freeroam zone table.
  f_zone:    { g: 'begin',   tag: 'Zone', t: 'Zone {state:State}, region {region:num}. Patrols: {patrol:Squad*?} Ambient: {ambient:Squad*?}' },
  f_event:   { g: 'action',  tag: 'Public event', t: 'Public event on {sensor:Slot/71} for {objective:Slot/3}: spawn {squads:Squad*} then open {chest:Slot/4*?}' },
  f_sector:  { g: 'when',    tag: 'Lost Sector', t: 'Lost Sector with boss {boss:Slot/1?}: spawn {squads:Squad*} then open {chest:Slot/4*?}' },
};

// Input kinds and the generated-SDK table each one indexes.
export const KINDS = {
  State: 'mission.states', Slot: 'mission.Slot', Squad: 'mission.Squad',
  Scene: 'mission.Scene', Directive: 'mission.Directive', Cue: 'mission.DialogueCue',
};
export const KIND_HINT = {
  State: 'STATE_…', Slot: 'D_FRONT_DOOR', Squad: 'SQ_GUARDS', Scene: 'SC_BAR_SCENE',
  Directive: 'REACH_THE_GATE', Cue: 'M_DIALOG_SENSOR_….CUE_3',
};
// Slots are the big table, so the lists split them by the authoring prefixes the docs name.
const SLOT_GROUPS = [['Triggers', /^PT_/], ['Monitors', /^PM_/], ['Devices', /^D_/], ['Objectives', /^OBJ_/], ['Objects', /^O_/],
  ['Markers', /^(AP_|LOOK_AT_)/], ['Squad slots', /^(SQ_|SQUAD_)/], ['Sensors', /^M_/], ['Volumes', /^TV_/], ['Cinematics', /CINEMATIC/], ['Sequences', /^SEQ_/]];
const TYPE_GROUP = { 31: 'Triggers', 30: 'Monitors', 23: 'Devices', 3: 'Objectives', 4: 'Objects', 47: 'Markers', 1: 'Squad slots', 2: 'Actors', 60: 'Volumes', 6: 'Cinematics', 5: 'Sequences',
  11: 'Sensors', 42: 'Sensors', 53: 'Sensors', 68: 'Sensors', 70: 'Sensors', 71: 'Sensors', 65: 'Sensors', 58: 'Paths', 66: 'Spawn rules' };
const GROUP_ORDER = ['States', ...SLOT_GROUPS.map((g) => g[0]), 'Actors', 'Paths', 'Spawn rules', 'Other slots', 'Squads', 'Scenes', 'Goals', 'Lines'];
const KIND_GROUP = { State: 'States', Squad: 'Squads', Scene: 'Scenes', Directive: 'Goals', Cue: 'Lines' };
export function groupOf(i) {
  if (i.kind !== 'Slot') return KIND_GROUP[i.kind];
  if (i.slotType != null) return TYPE_GROUP[i.slotType] || 'Other slots';
  for (const [label, re] of SLOT_GROUPS) if (re.test(i.key)) return label;
  return 'Other slots';
}
// Inputs sorted into their groups, in a fixed order: [[label, kind, inputs], ...].
export function grouped(list) {
  const map = new Map();
  for (const i of list) { const g = groupOf(i); if (!map.has(g)) map.set(g, []); map.get(g).push(i); }
  return GROUP_ORDER.filter((g) => map.has(g)).map((g) => [g, map.get(g)[0].kind, map.get(g).sort((a, b) => a.name.localeCompare(b.name))]);
}
export const matches = (i, q) => !q || i.name.includes(q) || i.key.toLowerCase().includes(q);

// What each slot type is (docs: "The world model"), for messages and for grouping inputs.
export const SLOT_TYPES = { 1: 'squad spawner', 2: 'actor', 3: 'objective', 4: 'object', 5: 'sequence', 6: 'cinematic', 11: 'music sensor', 20: 'damage monitor',
  23: 'device', 30: 'occupancy monitor', 31: 'player trigger', 34: 'object filter', 35: 'darkness zone', 38: 'task sensor', 42: 'performance sensor', 43: 'scene',
  47: 'navigation marker', 53: 'dialogue sensor', 58: 'actor path', 60: 'trigger volume', 65: 'Ghost link', 66: 'spawn rule', 68: 'directive sensor',
  70: 'engagement sensor', 71: 'public event sensor' };
export const slotTypeName = (t) => SLOT_TYPES[t] || 'type-' + t + ' slot';

export const LUA_KEYWORDS = new Set('and break do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(' '));
export const TRANSITIONS = ['open', 'close', 'power_on', 'power_off', 'lock', 'unlock'];
export const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
// Every event a script can have a callback for (docs: "How a script runs"), minus the low-level ones.
export const EVENT_KINDS = ['client_state_changed', 'region_changed', 'player_trigger', 'trigger_entered', 'trigger_exited', 'squad_state',
  'entity_spawned', 'entity_died', 'squad_provoked', 'damage_state', 'object_state', 'object_interacted', 'device_state', 'ghost_link_state',
  'actor_path_state', 'scene_finished', 'objective_progress', 'cinematic_started', 'cinematic_terminated', 'cinematic_skip_requested',
  'fireteam_state', 'session_joined', 'session_left', 'timer_elapsed', 'phase_entered', 'effect_result'];

export function parseTemplate(t) {
  const parts = []; let last = 0;
  for (const m of t.matchAll(/\{(\w+):([^}]+)\}/g)) {
    if (m.index > last) parts.push({ text: t.slice(last, m.index) });
    const spec = m[2]; const p = { name: m[1] };
    if (spec[0] === '=') {
      p.kind = 'enum'; p.options = []; p.values = [];
      for (const o of spec.slice(1).split('|')) { const [label, value] = o.split('='); p.options.push(label); p.values.push(value === undefined ? label : value); }
    } else if (['num', 'id', 'text', 'flag', 'code'].includes(spec)) p.kind = spec;
    else {
      p.optional = spec.endsWith('?'); p.list = spec.includes('*');
      // Slot/31 narrows a slot socket to the slot types the game accepts there.
      const [ref, types] = spec.replace(/[?*@]/g, '').split('/');
      p.ref = ref; if (types) p.types = types.split('|').map(Number);
      p.kind = spec[0] === '@' ? 'node' : 'ref';
    }
    parts.push(p); last = m.index + m[0].length;
  }
  if (last < t.length) parts.push({ text: t.slice(last) });
  return parts;
}
// What is wrong with a sentence a user wrote for a custom node, if anything.
export function checkTemplate(t) {
  const out = [], seen = new Set();
  if (!t.trim()) out.push('The sentence is empty.');
  for (const p of parseTemplate(t)) {
    if (p.text != null) continue;
    if (seen.has(p.name)) out.push(`The sentence uses the socket name "${p.name}" twice.`);
    seen.add(p.name);
    if (p.name === 'node') out.push('"node" is reserved; pick another socket name.');
    if (p.kind === 'ref' && !KINDS[p.ref]) out.push(`"{${p.name}:${p.ref}}" is not a known socket. Use ${Object.keys(KINDS).join(', ')}, num, text, flag or =a|b.`);
    if (p.kind === 'node' || p.kind === 'id' || p.kind === 'code') out.push(`"{${p.name}:…}" uses a socket type that only built-in nodes have.`);
    if (p.kind === 'enum' && p.options.some((o) => !o)) out.push(`The choice "{${p.name}:=…}" has an empty option.`);
  }
  return out;
}
for (const k in BUILTIN) { const T = BUILTIN[k]; T.parts = parseTemplate(T.t); if (T.g === 'begin') T.head = true; }

// Custom node definitions live in the scene file; this turns them into node types.
const custom = new Map();
const CUSTOM_LOOK = { action: ['action', 'Custom'], wait: ['when', 'Custom wait'], prefab: ['prefab', 'Prefab'] };
const STATEFUL = /\b(set_variable|clear_variable|start_timer|cancel_timer|set_phase)\b/;
export const defLua = (def) => [def.run, def.start, def.cond].filter(Boolean).join('\n');
export function setCustom(defs) {
  custom.clear();
  for (const def of defs || []) {
    const [g, tag] = CUSTOM_LOOK[def.kind] || CUSTOM_LOOK.action;
    const stateful = STATEFUL.test(defLua(def));
    custom.set(def.id, { g, tag: stateful ? tag + ' · keeps state' : tag, t: def.template || '', parts: parseTemplate(def.template || ''), custom: def, stateful });
  }
}
const MISSING = { g: 'end', tag: 'Missing', t: 'This node type was deleted', parts: [{ text: 'This node type was deleted' }], missing: true };
export const T = (type) => BUILTIN[type] || custom.get(type) || MISSING;
export const allTypes = () => [...Object.keys(BUILTIN), ...custom.keys()];
export const MODES = ['scene', 'campaign', 'mission', 'freeroam'];
// Which editor mode a node type belongs to: one of MODES, or 'both' (free scene and campaign).
export function modeOf(type) {
  if (BUILTIN[type]) return type.startsWith('c_') ? 'campaign' : type.startsWith('f_') ? 'freeroam' : type.startsWith('m_') || type.startsWith('s_') ? 'mission' : 'scene';
  const t = custom.get(type);
  if (!t) return 'both';
  return t.custom.kind === 'action' ? t.custom.mode || 'both' : 'scene';
}
// Does a node type belong on this canvas? In mission mode it depends on the tab: the Flow tab
// takes the m_ nodes; a scene tab takes the free-scene nodes (it is drawn the same way), minus
// the ones that only make sense for a whole script, plus the two that tie a scene to a step.
const NOT_IN_A_TAB = new Set(['start', 'arrive', 'complete']);
export function fits(type, mode, flowTab) {
  const m = modeOf(type);
  if (mode !== 'mission') return m === mode || (m === 'both' && mode !== 'freeroam');
  if (flowTab) return type.startsWith('m_');
  return type.startsWith('s_') || ((m === 'scene' || m === 'both') && !NOT_IN_A_TAB.has(type));
}
// Lines mean different things per mode, so which nodes take and give them differs too.
const noLines = (type, mode) => mode === 'freeroam' || (mode === 'mission' && type.startsWith('m_'));
export const canIn = (type, mode) => (noLines(type, mode) ? false : mode === 'campaign' ? type === 'c_enc' : !T(type).head);
export const canOut = (type, mode) => (noLines(type, mode) ? false : mode === 'campaign' ? type === 'c_step' : !T(type).noNext);
