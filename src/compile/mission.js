// Mission mode: a flow of steps plus scenes, compiled to one self-contained script.
//
// After Bungie's split (GDC talk): the flow is the "script" side, which says what the player
// is asked to do next and switches scenes on; a scene is a drawn performance that runs once it
// is switched on and reports back through named outputs. Nothing here uses lib.campaign.
//
// Each graph (the flow, and every scene) is its own lib.flow graph. They talk through marks:
//   m.on.<tab>           a step ran this scene
//   m.out.<tab>.<name>   the scene fired this output
// A scene tagged with a leg also waits until the player is in that leg, because its triggers
// and squads only exist once that area is loaded.
//
// Carried over from lib.campaign, which learned them the hard way (see docs/SUNRISE.md):
// opening cutscenes hold the spawn and move on when ended or skipped; triggers are armed
// again whenever an area loads; a goal is sent again on entering an area so its marker shows;
// an interactable object gets its row before the goal that points at it.
import { graphOf, sentence } from '../graph.js';
import { tabsOf } from '../state.js';
import { EVENT_KINDS } from '../catalog.js';
import { compilerBase, ind } from './base.js';
import { flowGraph, helperLua, graphLua } from './scene.js';

const luaName = (s) => 'scene_' + String(s).replace(/[^A-Za-z0-9_]/g, '_');

export function compileMission(doc) {
  const B = compilerBase(doc), { pick, problems, stem } = B;
  const tabs = tabsOf(doc), flow = tabs.find((t) => t.id === 'flow'), scenes = tabs.filter((t) => t.id !== 'flow');
  const sceneOf = (id) => scenes.find((t) => t.id === id);
  const tabName = (id) => (sceneOf(id) ? sceneOf(id).name : null);
  const G = graphOf(flow.nodes), say = (n) => sentence(n, doc.inputs, G.node, tabName);
  const err = (msg, nid) => { B.err(msg, nid); problems[problems.length - 1].tab = 'flow'; };
  const warn = (msg, nid) => { B.warn(msg, nid); problems[problems.length - 1].tab = 'flow'; };
  const q = (s) => `"${s}"`;
  const heads = G.heads();
  const only = (type, missing) => {
    const found = heads.filter((n) => n.type === type);
    if (!found.length) err(missing);
    for (const extra of found.slice(1)) err('There are two of these stacks on the Flow tab; keep one.', extra.id);
    return found[0];
  };

  // ---- read the Flow tab
  const M = { key: '', sensor: null, voice: null, spawn: '', intro: [], legs: [], steps: [], complete: null, head: null };
  const head = only('m_mission', 'Add the orange Mission node on the Flow tab. It names the sensors, and the legs stack under it.');
  if (head) {
    const P = head.params;
    Object.assign(M, { head: head.id, key: P.key || '', sensor: pick(P.sensor, 'Slot'), voice: pick(P.voice, 'Slot'), spawn: (P.spawn || '').trim() });
    if (!/^[a-z0-9_]{1,12}$/.test(M.key)) err('Give the Mission node a short key (a-z, 0-9, _; at most 12 characters).', head.id);
    if (!M.sensor) err('Drop the directive sensor that shows the goals into the Mission node.', head.id);
    if (M.spawn && !/^(0x[0-9a-fA-F]{1,8}|\d+)$/.test(M.spawn)) err('The spawn set must be a number such as 0x8029E4B4.', head.id);
    for (const n of G.chain(head).slice(1)) {
      if (n.type === 'm_cut') {
        const state = pick(n.params.state, 'State'), cinematic = pick(n.params.cinematic, 'Slot');
        if (!state || !cinematic) err('An opening cutscene needs both a cinematic and a state.', n.id); else M.intro.push({ state, cinematic });
      } else if (n.type === 'm_leg') {
        const state = pick(n.params.state, 'State');
        if (!state) err(`Leg "${n.params.id}" has no state.`, n.id);
        if (!/^[a-z0-9_]+$/.test(n.params.id || '')) err('A leg has no id (a-z, 0-9, _).', n.id);
        else if (M.legs.some((l) => l.id === n.params.id)) err(`The leg id "${n.params.id}" is already taken.`, n.id);
        M.legs.push({ uid: n.id, id: n.params.id, state: state || 'nil' });
      } else warn(`"${say(n)}" does nothing under the Mission node; it is ignored.`, n.id);
    }
    if (!M.legs.length) err('Stack at least one Leg under the Mission node. The first leg is where the player lands.', head.id);
  }
  const legOf = (uid) => M.legs.find((l) => l.uid === uid);

  const story = only('m_story', 'Add the orange "When the player lands" node on the Flow tab. The steps stack under it.');
  const run = new Set(), triggers = new Set(), omit = new Set();
  if (story) {
    let cur = null;
    for (const n of G.chain(story).slice(1)) {
      const P = n.params;
      if (n.type === 'm_complete') { M.complete = n; cur = null; continue; }
      if (M.complete) { warn(`"${say(n)}" comes after the mission is completed; it is ignored.`, n.id); continue; }
      if (n.type === 'm_step') {
        if (!/^[a-z0-9_]+$/.test(P.id || '')) err('A step has no id (a-z, 0-9, _).', n.id);
        else if (M.steps.some((s) => s.id === P.id) || P.id === 'arrival' || P.id === 'done') err(`The step id "${P.id}" is already taken.`, n.id);
        cur = { uid: n.id, id: P.id, directive: pick(P.directive, 'Directive'), marker: pick(P.marker, 'Slot'), waypoint: pick(P.waypoint, 'Slot'), start: [], first: [], ends: [] };
        if ((P.marker || P.waypoint) && !cur.directive) warn(`Step "${P.id}" has a marker but no goal to attach it to.`, n.id);
        M.steps.push(cur); continue;
      }
      if (!cur) { err(`"${say(n)}" comes before the first Step node. Put a Step above it.`, n.id); continue; }
      const late = () => { if (cur.ends.length) warn(`"${say(n)}" sits below an Until node, but it still happens when step "${cur.id}" starts. Move it above to read true.`, n.id); };
      if (n.type === 'm_run') {
        late();
        if (!sceneOf(P.scene)) { err('Pick the scene this node runs.', n.id); continue; }
        run.add(P.scene); cur.start.push(`mark("m.on.${P.scene}")(context)   -- run scene ${tabName(P.scene)}`);
      } else if (n.type === 'm_say') {
        late();
        const cue = pick(P.cue, 'Cue'), filter = pick(P.filter, 'Slot');
        if (!cue) { err('This Say node has no line dropped in.', n.id); continue; }
        if (!M.voice) err('Steps play lines, so drop the dialogue sensor into the Mission node.', n.id);
        cur.start.push(`context:slot(${M.voice}):play_dialogue_cue{cue = ${cue}${filter ? `, filter = context:slot(${filter})` : ''}}`);
      } else if (n.type === 'm_move') {
        late();
        const devices = (P.devices || []).map((id) => pick(id, 'Slot')).filter(Boolean);
        if (!devices.length) { err('This device node has no device dropped in.', n.id); continue; }
        for (const d of devices) cur.start.push(`context:slot(${d}):transition{transition = context.sdk.device_transitions.${P.transition}}`);
      } else if (n.type === 'm_seq') {
        late();
        const sequence = pick(P.sequence, 'Slot');
        if (!sequence) { err('This Play sequence node has no sequence dropped in.', n.id); continue; }
        cur.start.push(`context:slot(${sequence}):play_sequence()`);
      } else if (n.type === 'm_until_trigger') {
        const list = (P.triggers || []).map((id) => pick(id, 'Slot')).filter(Boolean);
        if (!list.length) { err(`Step "${cur.id}": drop in the trigger it ends on.`, n.id); continue; }
        list.forEach((slot, k) => { triggers.add(slot); cur.start.push(`arm(context, ${slot})`); cur.ends.push({ kind: 'trigger', slot, fact: `${cur.id}.t${cur.ends.length + k}` }); });
      } else if (n.type === 'm_until_interact') {
        const slot = pick(P.object, 'Slot');
        if (!slot) { err(`Step "${cur.id}": drop in the object the player uses.`, n.id); continue; }
        // The row registers the object, so it goes before the goal that points at it.
        cur.first.push(`context:slot(${slot}):set_interactable_object{used = true}`);
        omit.add(slot);
        cur.ends.push({ kind: 'interact', slot, fact: `${cur.id}.used` });
      } else if (n.type === 'm_until_leg') {
        const leg = legOf(P.leg);
        if (!leg) { err(`Step "${cur.id}": pick the leg it ends in.`, n.id); continue; }
        cur.ends.push({ kind: 'leg', fact: `leg.${leg.id}`, shared: true });
      } else if (n.type === 'm_until_scene') {
        const tab = sceneOf(P.scene), name = P.output || '';
        if (!tab || !name) { err(`Step "${cur.id}": pick the scene and name the output it waits for.`, n.id); continue; }
        if (!tab.nodes.some((x) => x.type === 's_out' && x.params.name === name)) warn(`Scene "${tab.name}" has no "Trigger output ${name}" node, so step "${cur.id}" would wait for ever.`, n.id);
        cur.ends.push({ kind: 'scene', mark: `m.out.${tab.id}.${name}` });
      } else warn(`"${say(n)}" does nothing inside a step; it is ignored.`, n.id);
    }
  }
  for (const h of heads) if (h.type !== 'm_mission' && h.type !== 'm_story') warn(`"${say(h)}" is not attached to a stack, so it is ignored.`, h.id);
  if (!M.steps.length) err('Stack at least one Step under "When the player lands".');
  for (const s of M.steps) if (!s.ends.length) warn(`Step "${s.id}" has no Until node, so it finishes the moment it starts.`, s.uid);
  if (!M.complete && M.steps.length) warn('Nothing completes the mission. Stack a "Complete the mission" node under the last step when the story is all there.');

  // ---- the flow, as a lib.flow graph
  const first = M.legs[0] ? M.legs[0].state : 'nil';
  const facts = [], steps = [], handlers = new Set(['region_changed', 'client_state_changed']), helpers = new Set(['mark']);
  // The client spawns on the arrival answer. After a cutscene the move may not hold the spawn
  // again, so there the region report counts as well.
  facts.push(`{id = "arrival", observe = function(_, state, event)\n    local region = FIRST.region_index\n    if event.entered == true and event.held_region_index == region then return true end\n    return #INTRO > 0 and intro_done(state) and event.region_index == region\nend},`);
  for (const l of M.legs) facts.push(`{id = "leg.${l.id}", observe = function(_, _, event)\n    local region = ${l.state}.region_index\n    return event.region_index == region or (event.entered == true and event.held_region_index == region)\nend},`);
  steps.push('-- The player lands\n{id = "arrival", await = flow.fact("arrival")},');
  const goals = [];
  let prev = 'arrival';
  M.steps.forEach((s, k) => {
    const index = k + 1, body = [...s.first];
    if (s.directive) {
      goals.push(`GOALS[${index}] = function(context)\n    context:slot(${M.sensor}):set_directive{\n        directive = ${s.directive},${s.marker ? `\n        navpoint = context:slot(${s.marker}),` : ''}${s.waypoint ? `\n        waypoint = context:slot(${s.waypoint}),` : ''}\n    }\nend`);
      body.push(`GOALS[${index}](context)`);
    }
    body.push(`context:set_variable("m.goal", ${index})`, ...s.start);
    const conds = s.ends.map((e) => {
      if (e.kind === 'scene') return `marked("${e.mark}")`;
      if (e.kind === 'trigger') { helpers.add('slot_fact'); helpers.add('arm'); handlers.add('player_trigger'); facts.push(`slot_fact("${e.fact}", "player_trigger", ${e.slot}),`); }
      // An object may have been used before; only a use after its step began counts.
      if (e.kind === 'interact') { handlers.add('object_interacted'); facts.push(`{id = "${e.fact}", observe = function(context, state, event)\n    return kind == "object_interacted" and M:started(context, state, "${s.id}") and lib.is_slot(context, event, ${e.slot})\nend},`); }
      return `flow.fact("${e.fact}")`;
    });
    const awaitExpr = !conds.length ? '' : conds.length === 1 ? `, await = ${conds[0]}` : `, await = flow.any(${conds.join(', ')})`;
    steps.push(`-- Step ${s.id}\n{id = "${s.id}", after = {"${prev}"}, run = function(context)\n${ind(body.join('\n'), 4)}\nend${awaitExpr}},`);
    prev = s.id;
  });
  if (M.complete) steps.push(`-- Complete the mission\n{id = "done", after = {"${prev}"}, run = function(context)\n    context:slot(${M.sensor}):clear_directives()\n    context:complete_mission{}\nend},`);
  const flowG = { key: 'm', facts, stepText: steps };

  // ---- the scenes
  const graphs = [];
  for (const tab of scenes) {
    const leg = tab.leg ? legOf(tab.leg) : null;
    if (tab.leg && !leg) { B.warn(`Scene "${tab.name}" is tagged with a leg that no longer exists.`); problems[problems.length - 1].tab = tab.id; }
    if (!run.has(tab.id)) { B.warn(`No step runs scene "${tab.name}", so it never happens. Add a "Run scene ${tab.name}" node to a step.`); problems[problems.length - 1].tab = tab.id; }
    const on = `marked("m.on.${tab.id}")`;
    const g = flowGraph(doc, B, { nodes: tab.nodes, wires: tab.wires, key: tab.id, tab: tab.id, tabName,
      begin: () => `when = ${leg ? `flow.all(${on}, function(context, state) return M:fact(context, state, "leg.${leg.id}") end)` : on}, `,
      output: (name) => `m.out.${tab.id}.${name}` });
    for (const n of tab.nodes) if (n.type === 'trigger' && pick(n.params.trigger, 'Slot')) triggers.add(pick(n.params.trigger, 'Slot'));
    g.handlers.forEach((h) => handlers.add(h)); g.helpers.forEach((h) => helpers.add(h));
    graphs.push({ tab, g, name: luaName(tab.name) });
  }
  if (new Set(graphs.map((x) => x.name)).size !== graphs.length) B.err('Two scenes have names that come out the same in the script. Rename one.');
  if (M.intro.length) { handlers.add('cinematic_terminated'); handlers.add('cinematic_skip_requested'); }

  // Each flow keeps one variable per step and per fact, plus three; a mission has 512.
  const count = (g) => g.stepText.join('\n').split('{id = ').length - 1 + g.facts.length + 3;
  const variables = count(flowG) + graphs.reduce((a, x) => a + count(x.g), 0) + scenes.length * 2 + triggers.size + M.intro.length + 1;
  if (variables > 512) B.err(`This mission needs about ${variables} saved variables; the game allows 512. Use fewer or smaller scenes.`);
  else if (variables > 400) B.warn(`This mission needs about ${variables} of the 512 saved variables the game allows.`);

  // ---- the file
  const L = [...B.head(['local flow = require("lib.flow")']), ...B.inputTable()];
  L.push(...helperLua(helpers, true));
  L.push('-- Areas, in order. The player lands in the first.', `local FIRST = ${first}`, '',
    '-- An object the player must use spawns with its area unless it is kept out; it is kept out',
    '-- until the step that asks for it sends its interaction row.',
    `local OMIT = {${[...omit].join(', ')}}`, '',
    '-- Opening cutscenes: each plays in its own state, in order, before the first leg. The spawn',
    '-- is held meanwhile, so no body is placed inside the first leg\'s geometry.',
    'local INTRO = {', ...M.intro.map((c) => `    {state = ${c.state}, cinematic = ${c.cinematic}},`), '}',
    'local PLAYING, ENDED = 1, 2',
    'local function intro_key(index) return "m.intro." .. index end',
    'local function intro_done(state) return #INTRO == 0 or state:variable(intro_key(#INTRO)) == ENDED end',
    'local function start_intro(context, state, region)',
    '    for index, cut in ipairs(INTRO) do',
    '        if cut.state.region_index == region and state:variable(intro_key(index)) == nil then',
    '            context:set_variable(intro_key(index), PLAYING)',
    '            context:slot(cut.cinematic):set_cinematic_active{active = true}',
    '        end', '    end', 'end',
    'local function end_intro(context, state, index)',
    '    if state:variable(intro_key(index)) == ENDED then return end',
    '    context:set_variable(intro_key(index), ENDED)',
    '    -- Stop before the state change, or the rebuilt component plays the cutscene again.',
    '    context:slot(INTRO[index].cinematic):set_cinematic_active{active = false}',
    '    if index < #INTRO then',
    '        context:select_state(INTRO[index + 1].state)',
    '    else',
    '        context:select_state(FIRST, OMIT)',
    '        context:hold_spawn{active = false}',
    '    end', 'end',
    '-- End, skip and a refused start all name the cinematic that was playing.',
    'local function end_reported_intro(context, state, event)',
    '    for index, cut in ipairs(INTRO) do',
    '        if state:variable(intro_key(index)) == PLAYING and lib.is_slot(context, event, cut.cinematic) then',
    '            end_intro(context, state, index)',
    '        end', '    end', 'end', '',
    '-- The goal each step shows, kept so it can be sent again: a goal sent before its marker\'s',
    '-- area is loaded shows no marker, and sending it again moves the marker without a popup.',
    'local GOALS = {}', ...goals, '',
    '-- Every trigger some node waits on. One armed before its area loaded never reports, so the',
    '-- ones still waiting are armed again whenever an area is entered.',
    'local TRIGGERS = {', ...[...triggers].map((t) => `    ${t},`), '}', '',
    '-- The mission flow: what the player is asked to do, in order.', 'local M', '');
  const flowText = graphLua('M', flowG); flowText[0] = flowText[0].replace('local M = ', 'M = ');
  L.push(...flowText);
  for (const x of graphs) L.push(`-- Scene "${x.tab.name}"${x.tab.leg && legOf(x.tab.leg) ? `, in leg "${legOf(x.tab.leg).id}"` : ''}`, ...graphLua(x.name, x.g));
  L.push(`local GRAPHS = {${['M', ...graphs.map((x) => x.name)].join(', ')}}`, '',
    '-- Two passes: a step that runs a scene, and a scene whose output ends a step, both take',
    '-- effect in the same callback.',
    'local function advance(context, state)',
    '    for _ = 1, 2 do', '        for _, graph in ipairs(GRAPHS) do graph:advance(context, state) end', '    end', 'end',
    'local function handle(name, context, state, event)',
    '    kind = name',
    '    for _, graph in ipairs(GRAPHS) do graph:handle(context, state, event) end',
    '    advance(context, state)',
    '    kind = nil', 'end',
    '-- The player now holds an area: arm what is waiting there, and show the goal again.',
    'local function entered(name, context, state, event)',
    '    local goal = state:variable("m.goal")',
    '    for _, id in ipairs(TRIGGERS) do',
    '        if state:variable("armed/" .. id) == true then context:slot(id):fire_trigger() end',
    '    end',
    '    handle(name, context, state, event)',
    '    if goal ~= nil and state:variable("m.goal") == goal and GOALS[goal] ~= nil then GOALS[goal](context) end',
    'end', '',
    'return {',
    `    initial_state = {region_index = (INTRO[1] and INTRO[1].state or FIRST).region_index${M.spawn ? `, spawn_set_hash = ${M.spawn}` : ''}, omit = OMIT},`,
    '    on_start = function(context, state)',
    '        if #INTRO > 0 then context:hold_spawn{active = true} end',
    '        advance(context, state)', '    end,',
    '    -- A reattach lands in the world, so a cutscene still marked playing is ended, not replayed.',
    '    on_load = function(context, state)',
    '        for index in ipairs(INTRO) do',
    '            if state:variable(intro_key(index)) == PLAYING then end_intro(context, state, index) end',
    '        end',
    '        if #INTRO > 0 and intro_done(state) and not M:fact(context, state, "arrival") then context:select_state(FIRST, OMIT) end',
    '        advance(context, state)', '    end,');
  for (const h of EVENT_KINDS) {
    if (!handlers.has(h)) continue;
    if (h === 'region_changed') L.push('    on_event_region_changed = function(context, state, event)',
      '        start_intro(context, state, event.region_index)', '        entered("region_changed", context, state, event)', '    end,');
    else if (h === 'client_state_changed') L.push('    -- Only the arrival answer counts. A pending leg report names a region the client has not loaded.',
      '    on_event_client_state_changed = function(context, state, event)',
      '        if event.entered == true then',
      '            start_intro(context, state, event.held_region_index)', '            entered("client_state_changed", context, state, event)',
      '        end', '    end,');
    else if (h === 'player_trigger') L.push('    on_event_player_trigger = function(context, state, event)',
      '        -- An armed trigger reports on every update; disarm it on the first one.',
      '        local slot = event.slot',
      '        if slot ~= nil and state:variable("armed/" .. slot.id) == true then',
      '            context:clear_variable("armed/" .. slot.id)', '            slot:disarm_trigger()', '        end',
      '        handle("player_trigger", context, state, event)', '    end,');
    else if (h === 'cinematic_terminated' || h === 'cinematic_skip_requested') L.push(`    on_event_${h} = function(context, state, event)`,
      '        end_reported_intro(context, state, event)', `        handle("${h}", context, state, event)`, '    end,');
    else L.push(`    on_event_${h} = function(context, state, event) handle("${h}", context, state, event) end,`);
  }
  L.push('}', '');
  return { lua: L.join('\n'), problems, stem };
}
