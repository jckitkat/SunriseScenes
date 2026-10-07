// Run with: npm test
// These check that the compilers produce Lua that parses and says what the drawing says.
// They cannot check that the game accepts it; only a run in Sunrise can.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, foldStem } from '../src/compile/index.js';
import { syntaxError, lintDef } from '../src/lualint.js';
import { parseSdk } from '../src/sdk.js';
import * as st from '../src/state.js';

const errors = (out) => out.problems.filter((p) => p.level === 'err').map((p) => p.msg);
const input = (name) => st.S.inputs.find((i) => i.name === name).id;
const ofType = (type) => st.S.nodes.find((n) => n.type === type);
const tailOf = (type) => st.chain(ofType(type)).pop();
function append(after, type, params) { const n = st.addNode(type, 0, 0, params); after.next = n.id; return n; }

test('script file name folds like the runtime does', () => {
  assert.equal(foldStem('Mission Deadzone-2'), 'mission_deadzone_2');
  assert.equal(foldStem('2fast'), '_2fast');
  assert.equal(foldStem(''), 'unnamed');
});

test('free scene example compiles to a lib.flow script that parses', () => {
  st.example('scene');
  const out = compile(st.S);
  assert.deepEqual(errors(out), []);
  assert.equal(syntaxError(out.lua), null);
  assert.match(out.lua, /local graph = flow\.new\{/);
  assert.match(out.lua, /initial_state = input\.arrival/);
  assert.match(out.lua, /after = \{"n\d+", "n\d+"\}/, 'Wait for all joins with after = {a, b}');
  assert.match(out.lua, /on_event_timer_elapsed = on\("timer_elapsed"\)/);
});

test('several lines into one node become a whichever-first join', () => {
  st.example('scene');
  const delay = ofType('delay'), exit = st.S.nodes.filter((n) => n.type === 'trigger')[1];
  st.S.wires.push({ from: delay.id, to: exit.id });
  const out = compile(st.S);
  assert.deepEqual(errors(out), []);
  assert.match(out.lua, /when = flow\.any\(marked\(/);
  assert.match(out.lua, /run = mark\("sc\.done\.n\d+"\)/);
  assert.equal(syntaxError(out.lua), null);
});

test('campaign example compiles to a lib.campaign table that parses', () => {
  st.example('campaign');
  const out = compile(st.S);
  assert.deepEqual(errors(out), []);
  assert.equal(syntaxError(out.lua), null);
  assert.match(out.lua, /return campaign\.new\{/);
  assert.match(out.lua, /ends = \{clear = "guards"\}/);
  assert.match(out.lua, /after = "reach"/);
  assert.match(out.lua, /unit\(input\.guards_a, input\.guards_a__slot\)/);
});

test('campaign reports a trigger no leg arms', () => {
  st.example('campaign');
  ofType('c_leg').next && (st.S.nodes.filter((n) => n.type === 'c_leg')[1].params.arm = []);
  const out = compile(st.S);
  assert.ok(errors(out).some((m) => /which no leg arms/.test(m)));
});

test('custom action node fills its sockets and works in both modes', () => {
  st.example('scene');
  const zone = st.addInput('Slot', 'dark_zone', 'HARD_WIPE_GLOBALS').id;
  const def = st.addCustom({ kind: 'action', mode: 'both', template: 'Turn darkness {mode:=on=true|off=false} on {zone:Slot}',
    run: 'context:slot({zone}):set_darkness_zone{enabled = {mode}}' });
  assert.deepEqual(lintDef(def).errors, []);
  const gate = ofType('device');
  const n = st.addNode(def.id, 0, 0, { zone, mode: 'off' }); n.next = gate.next; gate.next = n.id;
  let out = compile(st.S);
  assert.deepEqual(errors(out), []);
  assert.match(out.lua, /context:slot\(input\.dark_zone\):set_darkness_zone\{enabled = false\}/);
  assert.match(out.lua, /dark_zone = lib\.one\(mission\.Slot\.HARD_WIPE_GLOBALS/);

  st.setMode('campaign');
  append(tailOf('c_enc'), def.id, { zone, mode: 'on' });
  out = compile(st.S);
  assert.deepEqual(errors(out), []);
  assert.match(out.lua, /on_start = function\(context\)\s+context:slot\(input\.dark_zone\):set_darkness_zone\{enabled = true\}/);
  assert.equal(syntaxError(out.lua), null);
});

test('custom wait node becomes a fact on its event', () => {
  st.example('scene');
  const boss = st.addInput('Slot', 'boss', 'SQ_BOSS_BOSS').id;
  const def = st.addCustom({ kind: 'wait', template: 'When {actor:Slot} falls to {at:num} health', start: '', event: 'damage_state', listen: '',
    cond: 'lib.is_slot(context, event, {actor}) and event.health <= {at}' });
  assert.deepEqual(lintDef(def).errors, []);
  const gate = ofType('device');
  const n = st.addNode(def.id, 0, 0, { actor: boss, at: 0.25 }); n.next = gate.next; gate.next = n.id;
  const out = compile(st.S);
  assert.deepEqual(errors(out), []);
  assert.match(out.lua, /kind == "damage_state" and \(lib\.is_slot\(context, event, input\.boss\) and event\.health <= 0\.25\)/);
  assert.match(out.lua, /on_event_damage_state = on\("damage_state"\)/);
  assert.equal(syntaxError(out.lua), null);
});

test('lint catches sandbox-removed functions, bad syntax and state', () => {
  const lint = (run) => lintDef({ kind: 'action', mode: 'scene', template: 'Do it', run });
  assert.ok(lint('for k, v in pairs(t) do end').errors.some((m) => /pairs\(\) is removed/.test(m)));
  assert.ok(lint('local x = string.match(s, "a")').errors.some((m) => /string\.match is removed/.test(m)));
  assert.ok(lint('context:slot(').errors.some((m) => /^Lua:/.test(m)));
  assert.ok(lint('context:set_variable("a", 1)').warnings.some((m) => /keeps state/.test(m)));
  assert.deepEqual(lint('context:complete_mission{}').errors, []);
});

test('raw Lua node is emitted as written and pulls in the inputs it names', () => {
  st.example('scene');
  st.addInput('Slot', 'music', 'MUSIC_SENSOR');
  const gate = ofType('device');
  const n = st.addNode('lua', 0, 0, { code: 'context:slot(input.music):set_music_section{section = 3}' }); n.next = gate.next; gate.next = n.id;
  let out = compile(st.S);
  assert.deepEqual(errors(out), []);
  assert.match(out.lua, /music = lib\.one\(mission\.Slot\.MUSIC_SENSOR/);
  n.params.code = 'context:slot(input.nope):x()';
  out = compile(st.S);
  assert.ok(errors(out).some((m) => /no input called that/.test(m)));
  n.params.code = 'if then';
  out = compile(st.S);
  assert.ok(errors(out).some((m) => /Lua syntax error/.test(m)));
});

test('a prefab compiles to the same steps as the stack it was made from', () => {
  const strip = (lua) => lua.replace(/n\d+(p\d+)?/g, 'N').replace(/--.*$/gm, '').replace(/\s+/g, ' ');
  st.example('scene');
  const before = compile(st.S);
  const firstSpawn = ofType('spawn');
  st.S.nodes.find((n) => n.type === 'cleared').next = null;       // fold: spawn, spawn, cleared
  const open = ofType('device');
  const made = st.makePrefab(firstSpawn.id);
  assert.equal(typeof made, 'object', String(made));
  made.node.next = open.id;                                        // put "open gate" back under it
  assert.equal(st.S.nodes.filter((n) => n.type === 'spawn').length, 0);
  assert.deepEqual(lintDef(made.def).errors, []);
  const folded = compile(st.S);
  assert.deepEqual(errors(folded), []);
  assert.equal(syntaxError(folded.lua), null);
  assert.equal(strip(folded.lua), strip(before.lua));

  st.unpackPrefab(made.node.id);
  assert.equal(st.S.nodes.filter((n) => n.type === 'spawn').length, 2);
  assert.equal(strip(compile(st.S).lua), strip(before.lua));
});

test('SDK module parser sorts keys by the table they sit in', () => {
  const sample = ['local M = {}', 'M.states = {', '    STATE_A_0001 = { id = "x", region_index = 0 },', '}', 'M.Slot = {', '    PT_CAVE = "slot/1",', '    SQ_CAVE = "slot/3",', '}',
    'M.Squad = {', '    SQ_CAVE = "squad/1",', '}', 'M.Task = {', '    TASK_X = "t",', '}', 'M.DialogueCue = {', '    M_DIALOG_SENSOR_1 = {', '        CUE_1 = 1,', '    },', '}', 'return M'].join('\n');
  const { keys, known } = parseSdk(sample);
  assert.equal(known, true);
  assert.deepEqual(keys.map((k) => k.kind + ':' + k.key).sort(),
    ['Cue:M_DIALOG_SENSOR_1.CUE_1', 'Slot:PT_CAVE', 'Slot:SQ_CAVE', 'Squad:SQ_CAVE', 'State:STATE_A_0001']);
});

test('local triggers start a "When" stack without a line, and are scoped to the attempt', () => {
  st.exampleZavala();
  const out = compile(st.S);
  assert.deepEqual(errors(out), []);
  assert.equal(syntaxError(out.lua), null);
  assert.match(out.lua, /run = function\(context\)\s+mark\("sc\.on\.t_combat_start"\)\(context\)/);
  assert.match(out.lua, /\{id = "n\d+", when = marked\("sc\.on\.t_combat_start"\)\}/);
  assert.match(out.lua, /context:set_variable\(name, context\.attempt_generation\)/);
  assert.match(out.lua, /after = \{"n\d+", "n\d+"\}\},\s+-- start scene zavala_bunker_shield_bunker/i, 'both pairs dead, then the next scene');
  // A "When x" nobody triggers, and a trigger nobody waits for, are both called out.
  st.S.nodes.find((n) => n.type === 'fire' && n.params.name === 'zavala_start').params.name = 'zavala_strat';
  const warns = compile(st.S).problems.filter((p) => p.level === 'warn').map((p) => p.msg);
  assert.ok(warns.some((w) => /Nothing triggers "zavala_start"/.test(w)));
  assert.ok(warns.some((w) => /Nothing waits for "zavala_strat"/.test(w)));
});

test('a slot of the wrong type in a socket is an error once the SDK says what it is', async () => {
  const { parseSdk } = await import('../src/sdk.js');
  const sdk = ['local mission = {', '    slots = {', '    PT_GATE = { id = "slot/1/0/0/001f", name = "pt_gate", index = 0, type = 31, component_class = 1 },',
    '    D_GATE = { id = "slot/1/1/1/0017", name = "d_gate", index = 1, type = 23, component_class = 1 },', '    },', '}',
    'mission.Slot = {', '    PT_GATE = "slot/1/0/0/001f",', '    D_GATE = "slot/1/1/1/0017",', '}', 'return mission'].join('\n');
  const keys = parseSdk(sdk).keys;
  assert.deepEqual(keys.map((k) => `${k.key}:${k.type}`), ['D_GATE:23', 'PT_GATE:31']);
  st.example('campaign');
  assert.deepEqual(errors(compile(st.S)), [], 'types unknown: nothing to complain about');
  assert.equal(st.stampSlotTypes(keys), 2);
  assert.deepEqual(errors(compile(st.S)), [], 'the example uses each slot correctly');
  // The mistake from the field: a device dropped into a leg's list of triggers to arm.
  const leg = st.S.nodes.filter((n) => n.type === 'c_leg')[1], gate = st.S.inputs.find((i) => i.name === 'gate');
  leg.params.arm.push(gate.id);
  const out = compile(st.S), hit = out.problems.find((p) => /"gate" is a device \(D_GATE\), but this socket takes a player trigger/.test(p.msg));
  assert.ok(hit, errors(out).join(' | '));
  assert.equal(hit.nid, leg.id, 'the problem points at the node');
  assert.match(hit.msg, /not an exact type-31/);
});
// A small mission: one leg, two steps, one scene that reports back.
function smallMission() {
  st.example('scene');
  st.setMode('mission');
  const id = (n) => st.S.inputs.find((i) => i.name === n).id;
  const stack = (list) => list.map(([t, p]) => st.addNode(t, 40, 30, p)).map((n, i, a) => { if (a[i + 1]) n.next = a[i + 1].id; return n; });
  const fight = st.addSceneTab('gate_fight');
  st.setTab(fight.id);
  stack([['s_begin', {}], ['trigger', { trigger: id('at_gate') }], ['spawn', { squad: id('guards_a'), objective: id('gate_fight') }],
    ['cleared', { squads: [id('guards_a')] }], ['s_out', { name: 'cleared' }]]);
  st.setTab('flow');
  const setup = stack([['m_mission', { key: 'mm', sensor: id('goals'), voice: id('ghost') }], ['m_leg', { id: 'landing', state: id('arrival') }], ['m_leg', { id: 'gate', state: id('gate_area') }]]);
  fight.leg = setup[2].id;
  const story = stack([['m_story', {}],
    ['m_step', { id: 'reach', directive: id('reach_the_gate'), marker: id('gate_marker') }], ['m_run', { scene: fight.id }], ['m_until_scene', { scene: fight.id, output: 'cleared' }],
    ['m_step', { id: 'leave' }], ['m_move', { transition: 'open', devices: [id('gate')] }], ['m_say', { cue: id('gate_line') }], ['m_until_trigger', { triggers: [id('at_exit')] }],
    ['m_complete', {}]]);
  return { fight, setup, story };
}

test('mission mode: a flow of steps and a scene compile to one script that parses', () => {
  const { fight } = smallMission();
  const out = compile(st.S);
  assert.deepEqual(errors(out), []);
  assert.equal(syntaxError(out.lua), null);
  assert.doesNotMatch(out.lua, /lib\.campaign/, 'it does not lean on lib.campaign');
  // The step runs the scene; the scene waits for that and for its leg; its output ends the step.
  assert.match(out.lua, new RegExp('mark\\("m\\.on\\.' + fight.id + '"\\)\\(context\\)'));
  assert.match(out.lua, new RegExp('when = flow\\.all\\(marked\\("m\\.on\\.' + fight.id + '"\\), function\\(context, state\\) return M:fact\\(context, state, "leg\\.gate"\\) end\\)'));
  assert.match(out.lua, new RegExp('\\{id = "reach", after = \\{"arrival"\\}[\\s\\S]+?await = marked\\("m\\.out\\.' + fight.id + '\\.cleared"\\)\\}'));
  assert.match(out.lua, /local scene_gate_fight = flow\.new\{/);
  assert.match(out.lua, /local GRAPHS = \{M, scene_gate_fight\}/);
  // Steps run in order, and the last one completes the mission.
  assert.match(out.lua, /\{id = "leave", after = \{"reach"\}/);
  assert.match(out.lua, /\{id = "done", after = \{"leave"\}[\s\S]+?complete_mission\{\}/);
  // Every trigger any node waits on is listed, so it can be armed again when an area loads.
  assert.match(out.lua, /local TRIGGERS = \{\s+input\.at_exit,\s+input\.at_gate,\s+\}/);
});

test('mission mode reports problems on the tab they are on', () => {
  const { fight, story } = smallMission();
  st.setTab(fight.id);
  st.S.nodes.find((n) => n.type === 's_out').params.name = 'done';       // the step now waits on an output nobody fires
  st.S.nodes.find((n) => n.type === 'trigger').params.trigger = '';
  st.setTab('flow');
  story[2].params.scene = '';                                             // and nothing runs the scene
  const out = compile(st.S);
  assert.ok(out.problems.some((p) => p.tab === 'flow' && /no "Trigger output cleared" node/.test(p.msg)));
  assert.ok(out.problems.some((p) => p.tab === 'flow' && /Pick the scene this node runs/.test(p.msg)));
  assert.ok(out.problems.some((p) => p.tab === fight.id && /No step runs scene "gate_fight"/.test(p.msg)));
  assert.ok(out.problems.some((p) => p.tab === fight.id && /is missing its trigger/.test(p.msg)), 'a scene\'s own node problems carry its tab');
});

test('mission tabs survive saving and reopening, whichever tab was showing', () => {
  const { fight } = smallMission();
  const before = compile(st.S).lua;
  st.setTab(fight.id);
  assert.equal(st.S.nodes.some((n) => n.type === 's_begin'), true, 'the scene tab is on screen');
  st.setDoc(st.normalize(JSON.parse(JSON.stringify(st.S))));
  assert.equal(st.S.mission.active, fight.id);
  assert.equal(compile(st.S).lua, before);
  st.setMode('campaign'); st.setMode('mission');
  assert.equal(compile(st.S).lua, before, 'switching mode and back loses nothing');
});

test('Play sequence starts an authored sequence, in every mode, alongside what is stacked with it', () => {
  // free scene: straight after the device, in the same step run
  st.example('scene');
  const seq = st.addInput('Slot', 'door_explosion', 'SEQ_DOOR_EXPLOSION', 5).id, gate = ofType('device');
  let n = st.addNode('sequence', 0, 0, { sequence: seq }); n.next = gate.next; gate.next = n.id;
  let out = compile(st.S);
  assert.deepEqual(errors(out), []);
  assert.match(out.lua, /context:slot\(input\.door_explosion\):play_sequence\(\)/);
  // campaign: with the device move, inside the step's on_start
  st.setMode('campaign');
  n = st.addNode('c_seq', 0, 0, { sequence: seq }); const move = ofType('c_move'); n.next = move.next; move.next = n.id;
  out = compile(st.S);
  assert.deepEqual(errors(out), []);
  assert.match(out.lua, /move\(context, \{input\.gate\}, "open"\)\s+context:slot\(input\.door_explosion\):play_sequence\(\)/);
  // mission: in a step on the flow, and in a scene tab (which uses the free-scene node)
  const { fight, story } = smallMission();
  const s2 = st.addInput('Slot', 'door_explosion', 'SEQ_DOOR_EXPLOSION', 5).id, open = story.find((x) => x.type === 'm_move');
  n = st.addNode('m_seq', 0, 0, { sequence: s2 }); n.next = open.next; open.next = n.id;
  st.setTab(fight.id);
  const spawn = ofType('spawn'); n = st.addNode('sequence', 0, 0, { sequence: s2 }); n.next = spawn.next; spawn.next = n.id;
  st.setTab('flow');
  out = compile(st.S);
  assert.deepEqual(errors(out), []);
  assert.equal(out.lua.split('context:slot(input.door_explosion):play_sequence()').length - 1, 2);
  assert.equal(syntaxError(out.lua), null);
  // a slot that is not a sequence is refused
  st.S.inputs.find((i) => i.id === s2).slotType = 23;
  assert.ok(errors(compile(st.S)).some((e) => /this socket takes a sequence/.test(e)));
});

test('Start scene starts an authored scene with its cast, and falls back if the host refuses', () => {
  st.exampleZavala();
  let out = compile(st.S);
  assert.deepEqual(errors(out), []);
  assert.equal(syntaxError(out.lua), null);
  assert.match(out.lua, /local function start_scene\(context, id, name\)[\s\S]+?pcall\(function\(\) scene:activate\{spawn = true\} end\)[\s\S]+?scene:activate\{\}/);
  assert.match(out.lua, /start_scene\(context, input\.zavala_combat, "zavala_combat"\)/);
  assert.doesNotMatch(out.lua, /context:scene\(input\.zavala_combat\):activate\{\}/);
  // "start bare" and "stop" say exactly that
  const nodes = st.S.nodes.filter((n) => n.type === 'scene');
  nodes[0].params.mode = 'start_bare'; nodes[1].params.mode = 'stop';
  out = compile(st.S);
  assert.match(out.lua, /context:scene\(input\.zavala_bunker_shield_bunker\):activate\{\}/);
  assert.match(out.lua, /context:scene\(input\.zavala_combat\):stop\{\}/);
});

test('a scene started with its cast gets one note naming the squads spawned from its object', async () => {
  const { parseSdk } = await import('../src/sdk.js');
  const sdk = ['local mission = {', '    slots = {',
    '    SQUAD_CONTACT = { id = "slot/80b50ca7/000006/0006/0001", name = "a", index = 6, type = 1 },',
    '    SQUAD_BACKUP = { id = "slot/80b50ca7/000007/0007/0001", name = "d", index = 7, type = 1 },',
    '    SCENE_CONTACT = { id = "slot/80b50ca7/00000a/000a/002b", name = "b", index = 10, type = 43 },',
    '    SQ_ELSEWHERE = { id = "slot/80b5011f/000002/0002/0001", name = "c", index = 2, type = 1 },', '    },', '}',
    'mission.Slot = {', '    SQUAD_CONTACT = "slot/80b50ca7/000006/0006/0001",', '    SQUAD_BACKUP = "slot/80b50ca7/000007/0007/0001",', '    SCENE_CONTACT = "slot/80b50ca7/00000a/000a/002b",', '    SQ_ELSEWHERE = "slot/80b5011f/000002/0002/0001",', '}',
    'mission.Squad = {', '    SQUAD_CONTACT = "squad/1",', '    SQUAD_BACKUP = "squad/3",', '    SQ_ELSEWHERE = "squad/2",', '}', 'mission.Scene = {', '    SCENE_CONTACT = "symbol/1",', '}', 'return mission'].join('\n');
  const keys = parseSdk(sdk).keys;
  assert.equal(keys.find((k) => k.kind === 'Squad' && k.key === 'SQUAD_CONTACT').object, '80b50ca7');
  assert.equal(keys.find((k) => k.kind === 'Scene').object, '80b50ca7');
  st.example('scene');
  const add = (kind, name, key) => st.addInput(kind, name, key).id;
  const contact = add('Squad', 'contact', 'SQUAD_CONTACT'), backup = add('Squad', 'backup', 'SQUAD_BACKUP'), other = add('Squad', 'elsewhere', 'SQ_ELSEWHERE'), scene = add('Scene', 'contact_scene', 'SCENE_CONTACT');
  st.stampSlotTypes(keys);
  const gate = ofType('device');
  const chainOn = (type, params) => { const n = st.addNode(type, 0, 0, params); n.next = gate.next; gate.next = n.id; return n; };
  chainOn('spawn', { squad: contact }); chainOn('spawn', { squad: backup }); chainOn('spawn', { squad: other });
  const s = chainOn('scene', { mode: 'start', scene });
  const notes = () => compile(st.S).problems.filter((p) => /spawns its own actors/.test(p.msg));
  let warns = notes();
  assert.equal(warns.length, 1, 'one note, however many squads share the object');
  assert.equal(warns[0].level, 'warn');
  assert.equal(warns[0].nid, s.id, 'on the scene node, not on the Spawn nodes');
  assert.match(warns[0].msg, /2 squads .*"contact".*"backup"/);
  assert.doesNotMatch(warns[0].msg, /elsewhere/);
  s.params.mode = 'start_bare';   // the scene no longer spawns anyone
  assert.equal(notes().length, 0);
});

test('Send event sends the scene the key the SDK lists at that position', () => {
  const sdk = ['local mission = {', '    scenes = {',
    '    SC_WITH_EVENTS = { id = "symbol/80b500bc/0009/0000/80b50ca8/28/000000/80b50ca7/0012/002b", slot = 17374, config_tag = 0x80B509A1, resource_tag = 0x80B82774, event_keys = { 0x385838EC, 0x6F51AC66, 0xCFB8CB39 } },',
    '    SC_OLD_SDK = { id = "symbol/80b500bc/0009/0000/80b50ca8/28/000000/80b50ca7/0040/002b", slot = 17420, config_tag = 0x80B50A88, resource_tag = 0x80B82789 },',
    '    },', '}', 'mission.Scene = {', '    SC_WITH_EVENTS = "symbol/1",', '    SC_OLD_SDK = "symbol/2",', '}', 'return mission'].join('\n');
  const keys = parseSdk(sdk).keys;
  assert.deepEqual(keys.find((k) => k.key === 'SC_WITH_EVENTS').events, ['0x385838EC', '0x6F51AC66', '0xCFB8CB39']);
  assert.equal(keys.find((k) => k.key === 'SC_OLD_SDK').events, undefined);
  st.example('scene');
  const scene = st.addInput('Scene', 'intro', 'SC_WITH_EVENTS').id, old = st.addInput('Scene', 'old', 'SC_OLD_SDK').id;
  st.stampSlotTypes(keys);
  const gate = ofType('device');
  const node = st.addNode('scene_event', 0, 0, { scene, event: 2 }); node.next = gate.next; gate.next = node.id;
  let out = compile(st.S);
  assert.deepEqual(errors(out), []);
  assert.equal(syntaxError(out.lua), null);
  assert.match(out.lua, /context:scene\(input\.intro\):send_event\{key = 0x6F51AC66\}/);
  node.params.event = 4;
  assert.match(errors(compile(st.S)).join('|'), /has 3 events, so the event number must be from 1 to 3/);
  node.params.event = 1; node.params.scene = old;
  assert.match(errors(compile(st.S)).join('|'), /does not list the events of scene "old"/);
});

test('copy and paste keeps a stack snapped and wired, and gives a copied step its own id', () => {
  st.example('scene');
  const head = st.S.nodes.find((n) => !st.parentOf(n.id) && n.next != null), stack = st.chain(head);
  const before = st.S.nodes.length, wiresBefore = st.S.wires.length, inputsBefore = st.S.inputs.length;
  const clip = st.copyNodes(stack.map((n) => n.id));
  assert.equal(clip.nodes.length, stack.length);
  assert.equal(clip.nodes[clip.nodes.length - 1].next, null);
  const made = st.pasteNodes(clip, { x: 900, y: 700 });
  assert.equal(made.skipped, 0);
  assert.equal(st.S.nodes.length, before + stack.length);
  assert.equal(st.S.inputs.length, inputsBefore, 'the same document already has every input');
  const copy = made.ids.map(st.node);
  assert.deepEqual(copy.map((n) => n.type), stack.map((n) => n.type));
  assert.deepEqual(st.chain(copy[0]).map((n) => n.id), made.ids, 'the copy is one stack, snapped in the same order');
  assert.deepEqual([copy[0].x, copy[0].y], [900, 700]);
  assert.ok(made.ids.every((id) => !stack.some((n) => n.id === id)));
  assert.deepEqual(copy.map((n) => n.params), stack.map((n) => n.params));
  copy[0].params = { changed: true };
  assert.notDeepEqual(stack[0].params, copy[0].params, 'the copy does not share its parameters with the original');
  // a line between two copied nodes is copied; a line to a node left behind is not
  const [a, b] = [stack[0].id, stack[stack.length - 1].id];
  st.S.wires.push({ from: b, to: a });
  const both = st.pasteNodes(st.copyNodes([a, b]), { x: 0, y: 0 });
  assert.ok(st.S.wires.some((w) => w.from === both.ids[1] && w.to === both.ids[0]));
  assert.equal(st.pasteNodes(st.copyNodes([b]), { x: 0, y: 0 }).ids.length, 1);
  assert.equal(st.S.wires.length, wiresBefore + 2);

  st.example('campaign');
  const step = ofType('c_step'), twin = st.node(st.pasteNodes(st.copyNodes([step.id]), { x: 0, y: 0 }).ids[0]);
  assert.notEqual(twin.params.id, step.params.id);
});

test('pasting into another drawing brings the inputs along and leaves out nodes that do not belong', () => {
  st.example('scene');
  const spawn = ofType('spawn'), squad = st.S.inputs.find((i) => i.id === spawn.params.squad);
  const clip = st.copyNodes([spawn.id, ofType('arrive').id]);
  assert.ok(clip.inputs.some((i) => i.id === squad.id));

  // a fresh mission-mode drawing, on a scene tab: "arrive" is for a whole script and does not fit
  st.setDoc(st.blank()); st.setMode('mission'); st.setTab(st.addSceneTab('fight').id);
  let made = st.pasteNodes(clip, { x: 10, y: 10 });
  assert.equal(made.ids.length, 1); assert.equal(made.skipped, 1);
  const pasted = st.node(made.ids[0]), here = st.S.inputs.find((i) => i.id === pasted.params.squad);
  assert.equal(pasted.type, 'spawn');
  assert.ok(here && here.kind === 'Squad' && here.key === squad.key && here.name === squad.name);
  const count = st.S.inputs.length;
  made = st.pasteNodes(clip, { x: 50, y: 50 });   // a second paste finds the inputs by kind and key
  assert.equal(st.S.inputs.length, count);
  assert.equal(st.node(made.ids[0]).params.squad, here.id);

  st.setTab('flow');                                // nothing in the clip is a flow node
  made = st.pasteNodes(clip, { x: 0, y: 0 });
  assert.deepEqual(made, { ids: [], skipped: 2 });
});
