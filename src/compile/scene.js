// Free scene mode: any drawn flow becomes a lib.flow graph, one step per node.
import { T, EVENT_KINDS } from '../catalog.js';
import { graphOf, sentence } from '../graph.js';
import { listenList, sandboxProblems } from '../lualint.js';
import { compilerBase, ind } from './base.js';

// A prefab node stands for a run of ordinary nodes. Swap each one for its steps before
// compiling: the first step keeps the prefab's id (so whatever started it still does) and
// lines out of the prefab leave from its last step.
export function expandPrefabs(nodes, wires) {
  const out = [], tailOf = new Map();
  for (const n of nodes) {
    const def = T(n.type).custom;
    if (!def || def.kind !== 'prefab' || !def.body.length) { out.push(n); continue; }
    const sub = (v) => (typeof v === 'string' && v[0] === '$' ? n.params[v.slice(1)] || '' : v);
    const steps = def.body.map((b, k) => ({
      id: k === 0 ? n.id : `${n.id}p${k}`, origin: n.id, type: b.type, x: n.x, y: n.y + k * 0.001, next: null,
      params: Object.fromEntries(Object.entries(b.params).map(([key, v]) => [key, Array.isArray(v) ? v.map(sub) : sub(v)])),
    }));
    steps.forEach((s, k) => { s.next = k < steps.length - 1 ? steps[k + 1].id : n.next; });
    steps[0].prefab = n;
    tailOf.set(n.id, steps[steps.length - 1].id);
    out.push(...steps);
  }
  return { nodes: out, wires: wires.map((w) => (tailOf.has(w.from) ? { from: tailOf.get(w.from), to: w.to } : w)) };
}

// Turn one drawn graph into lib.flow facts and steps. opts:
//   nodes, wires   the graph
//   key            the flow key; also prefixes its timers and marks
//   standalone     true for a free scene, which must begin and complete on its own
//   begin(n)       the start clause of a Begin node ('' = starts at once); for a scene on a
//                  tab this is what holds it back until a step runs it
//   output(name)   the variable a "Trigger output" node marks
//   tab            the tab the graph is on, attached to its problems
export function flowGraph(doc, B, opts) {
  const { problems, inputs, refOf, twinOf } = B;
  const { nodes, wires } = expandPrefabs(opts.nodes, opts.wires);
  const G = graphOf(nodes), outer = graphOf(opts.nodes);
  const say = (n) => sentence(n, doc.inputs, G.node, opts.tabName);
  const at = (n) => (n.origin != null ? n.origin : n.id);   // the node on the canvas a problem points at
  const onTab = () => { if (opts.tab) problems[problems.length - 1].tab = opts.tab; };
  const err = (msg, n) => { B.err(msg, n && at(n)); onTab(); }, warn = (msg, n) => { B.warn(msg, n && at(n)); onTab(); };
  const FK = opts.key;

  // Resolve a built-in node's parameters to Lua expressions. Missing ones become problems.
  function args(n) {
    const out = { ok: true, raw: {} };
    for (const p of T(n.type).parts) {
      if (p.text != null) continue;
      const v = n.params[p.name];
      if (p.kind === 'num') {
        if (typeof v !== 'number' || !isFinite(v) || v < 0) { err(`"${say(n)}" needs a number.`, n); out.ok = false; }
        out[p.name] = v;
      } else if (p.kind !== 'ref') out[p.name] = v;
      else if (p.list) {
        const ids = (v || []).filter((id) => inputs.has(id) && inputs.get(id).kind === p.ref);
        if (!ids.length) { err(`"${say(n)}" needs at least one ${p.ref.toLowerCase()}.`, n); out.ok = false; }
        out[p.name] = ids.map(refOf); out.raw[p.name] = ids;
      } else {
        const i = inputs.get(v);
        if (i && i.kind === p.ref) { out[p.name] = refOf(v); out.raw[p.name] = v; }
        else if (!p.optional) { err(`"${say(n)}" is missing its ${p.name}.`, n); out.ok = false; }
      }
    }
    return out;
  }

  // What must finish before each node starts: the node above it, plus every line into it.
  const preds = new Map(nodes.map((n) => [n.id, []]));
  for (const n of nodes) if (n.next != null && preds.has(n.next)) preds.get(n.next).push(n.id);
  for (const w of wires) if (preds.has(w.to) && preds.has(w.from) && !preds.get(w.to).includes(w.from)) preds.get(w.to).push(w.from);

  // Local triggers: "Trigger local x" nodes fire a name, "When x" stacks wait for it.
  const fires = nodes.filter((n) => n.type === 'fire');
  const firing = (n) => fires.filter((f) => f.params.name && f.params.name === n.params.name);
  const localKey = (name) => `${FK}.on.${name}`;

  // Order nodes by when they can first start. Anything left over can never start.
  const order = [], placed = new Set();
  const sorted = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let progress = true; progress;) {
    progress = false;
    for (const n of sorted) {
      if (placed.has(n.id)) continue;
      const p = preds.get(n.id), begin = T(n.type).g === 'begin';
      const ready = begin ? true : n.type === 'on_local' ? firing(n).some((f) => placed.has(f.id))
        : !p.length ? false : n.type === 'all' ? p.every((id) => placed.has(id)) : p.some((id) => placed.has(id));
      if (ready) { placed.add(n.id); order.push(n); progress = true; }
    }
  }
  for (const n of sorted) {
    if (placed.has(n.id) || (n.origin != null && !n.prefab)) continue;
    const shown = n.prefab ? sentence(n.prefab, doc.inputs, outer.node) : say(n);
    if (n.type === 'on_local') warn(n.params.name ? `Nothing triggers "${n.params.name}", so the stack under "When ${n.params.name}" never runs. Add a "Trigger local ${n.params.name}" node.` : 'This "When" node has no trigger name.', n);
    else if (!preds.get(n.id).length) warn(`"${shown}" has nothing above it and no line into it, so it never runs.`, n);
    else warn(`"${shown}" can never start: it waits on nodes that never run.`, n);
  }
  if (!order.some((n) => T(n.type).g === 'begin')) err(opts.standalone ? 'Add an orange Begin node so the scene has somewhere to start.' : 'Add a "When this scene is run" node so the scene has somewhere to start.');
  if (opts.standalone && order.length && !order.some((n) => n.type === 'complete')) warn('Nothing completes the mission. Add a "Complete the mission" node.');

  // Emit one lib.flow step per node.
  const sid = (n) => 'n' + n.id;
  const doneId = (n) => (n.type === 'cinematic' ? sid(n) + '_off' : sid(n));   // the step that marks the node finished
  const facts = [], steps = [], handlers = new Set(), helpers = new Set(), orSources = new Set();
  let locals = false;   // any local trigger in use
  const slotFact = (id, kind, slot) => { helpers.add('slot_fact'); handlers.add(kind); facts.push(`slot_fact("${id}", "${kind}", ${slot}),`); };
  const rawFact = (id, kind, cond) => { handlers.add(kind); facts.push(`{id = "${id}", observe = function(context, state, event)\n    return kind == "${kind}" and ${cond}\nend},`); };

  for (const n of order) {
    const type = T(n.type), def = type.custom, id = sid(n);
    let run = [], awaitExpr = null, tail = null;
    if (type.missing) err('This node\'s type was deleted from the Nodes screen. Remove the node or recreate the type.', n);
    else if (def && def.kind === 'prefab') err('This prefab has no steps left. Delete it, or rebuild it from a stack.', n);
    else if (def) {
      // A custom node: the user's Lua with its sockets filled in.
      if (B.defOk(def, at(n)) && B.socketsFilled(n, at(n), say(n))) {
        const fill = (code) => B.fillLua(code || '', n, at(n));
        if (def.kind === 'action') run = fill(def.run).split('\n');
        else {
          if ((def.start || '').trim()) run = fill(def.start).split('\n');
          if (def.event) { rawFact(id, def.event, `(${fill(def.cond).trim()})`); awaitExpr = `flow.fact("${id}")`; }
          else {
            listenList(def).forEach((k) => handlers.add(k));
            awaitExpr = `function(context, state)\n    return ${fill(def.cond).trim()}\nend`;
          }
        }
      }
    } else {
      const a = args(n);
      if (a.ok) switch (n.type) {
        case 'start': case 's_begin': break;
        case 's_out':
          if (!a.name) { err('This "Trigger output" node has no name.', n); break; }
          helpers.add('mark'); run = [`mark("${opts.output(a.name)}")(context)`]; break;
        case 'arrive':
          rawFact(id, 'client_state_changed', `event.entered == true\n        and event.held_region_index == ${a.state}.region_index`);
          awaitExpr = `flow.fact("${id}")`; break;
        case 'region':
          rawFact(id, 'region_changed', `event.region_index == ${a.state}.region_index`);
          awaitExpr = `flow.fact("${id}")`; break;
        case 'trigger':
          helpers.add('arm'); run = [`arm(context, ${a.trigger})`];
          slotFact(id, 'player_trigger', a.trigger); awaitExpr = `flow.fact("${id}")`; break;
        case 'cleared':
          handlers.add('squad_state');
          awaitExpr = `function(context)\n    return context:cohort{squads = {${a.squads.join(', ')}}}.cleared\nend`; break;
        case 'interact':
          run = [`context:slot(${a.object}):set_interactable_object{used = true}`];
          slotFact(id, 'object_interacted', a.object); awaitExpr = `flow.fact("${id}")`; break;
        case 'destroyed':
          rawFact(id, 'object_state', `lib.is_slot(context, event, ${a.object})\n        and event.present == false`);
          awaitExpr = `flow.fact("${id}")`; break;
        case 'moved':
          handlers.add('device_state');
          awaitExpr = `function(context)\n    return context:slot(${a.device}):applied{\n        channel = context.sdk.device_channels.position,\n    }\nend`; break;
        case 'scene_end':
          slotFact(id, 'scene_finished', twinOf(a.raw.scene)); awaitExpr = `flow.fact("${id}")`; break;
        case 'goal':
          run = [`context:slot(${a.sensor}):set_directive{`, `    directive = ${a.directive},`];
          if (a.marker) run.push(`    navpoint = context:slot(${a.marker}),`);
          run.push('}'); break;
        case 'clear_goal': run = [`context:slot(${a.sensor}):clear_directives()`]; break;
        case 'line': run = [`context:slot(${a.sensor}):play_dialogue_cue{cue = ${a.cue}}`]; break;
        case 'spawn':
          // The objective goes first: a squad given one after its members exist briefly reports alive 0.
          if (a.objective) run.push(`context:slot(${twinOf(a.raw.squad)}):assign_combat_objective{`, `    objective = context:slot(${a.objective}),`, '}');
          run.push(`context:squad(${a.squad}):place{}`); break;
        case 'device':
          run = [`context:slot(${a.device}):transition{`, `    transition = context.sdk.device_transitions.${a.transition},`, '}']; break;
        case 'object': run = [`context:slot(${a.object}):set_object_active{active = ${a.mode === 'spawn'}}`]; break;
        case 'scene': {
          const label = inputs.get(a.raw.scene).name.slice(0, 40);
          if (a.mode === 'start') { helpers.add('start_scene'); run = [`start_scene(context, ${a.scene}, "${label}")`]; }
          else run = [`context:scene(${a.scene}):${a.mode === 'stop' ? 'stop' : 'activate'}{}`];
          break;
        }
        case 'scene_event': {
          const scene = inputs.get(a.raw.scene), list = scene.events, at = Math.round(a.event);
          if (!list) { err(`The SDK loaded for this mission does not list the events of scene "${scene.name}". Events are listed by Sunrise builds newer than 0.5.1; update Sunrise, let it regenerate the SDK, then reopen the mission.`, n); break; }
          if (!(at >= 1 && at <= list.length)) { err(`Scene "${scene.name}" has ${list.length === 1 ? 'one event' : list.length + ' events'}, so the event number must be ${list.length === 1 ? '1' : 'from 1 to ' + list.length}.`, n); break; }
          run = [`context:scene(${a.scene}):send_event{key = ${list[at - 1]}}`];
          break;
        }
        case 'cinematic': {
          run = [`context:slot(${a.cinematic}):set_cinematic_active{active = true}`];
          helpers.add('slot_fact'); handlers.add('cinematic_terminated'); handlers.add('cinematic_skip_requested');
          facts.push(`slot_fact("${id}", "cinematic_terminated", ${a.cinematic}),`, `slot_fact("${id}_skip", "cinematic_skip_requested", ${a.cinematic}),`);
          awaitExpr = `flow.any(flow.fact("${id}"), flow.fact("${id}_skip"))`;
          tail = `{id = "${id}_off", after = {"${id}"}, run = function(context)\n    context:slot(${a.cinematic}):set_cinematic_active{active = false}\nend},`;
          break;
        }
        // An authored sequence (an explosion, an announcement) on its type-5 slot. It is only
        // started here: nothing reports when it ends, so the next node does not wait for it.
        case 'sequence': run = [`context:slot(${a.sequence}):play_sequence()`]; break;
        case 'music': run = [`context:slot(${a.sensor}):set_music_section{section = ${Math.round(a.section)}}`]; break;
        case 'move': run = [`context:select_state(${a.state})`]; break;
        case 'path': run = [`context:slot(${a.actor}):play_actor_path{`, `    path = context:slot(${a.path}),`, '    spawn = false,', '}']; break;
        case 'lua': {
          const code = (a.code || '').trim();
          if (!code) { err('This Lua node is empty.', n); break; }
          for (const p of sandboxProblems(code)) err(`Lua node: ${p}.`, n);
          run = B.fillLua(code, n, at(n)).split('\n'); break;
        }
        case 'delay': {
          const timer = `${FK}.t.${id}`;
          run = [`context:start_timer("${timer}", ${Math.round(a.seconds * 1000)})`];
          rawFact(id, 'timer_elapsed', `event.timer_name == "${timer}"`);
          awaitExpr = `flow.fact("${id}")`; break;
        }
        case 'all': break;
        case 'fire':
          if (!a.name) { err('This "Trigger local" node has no name.', n); break; }
          if (!nodes.some((m) => m.type === 'on_local' && m.params.name === a.name)) warn(`Nothing waits for "${a.name}". Add a "When ${a.name}" node, or remove this one.`, n);
          helpers.add('mark'); locals = true; run = [`mark("${localKey(a.name)}")(context)`]; break;
        case 'on_local': break;
        case 'complete': run = ['context:complete_mission{}']; break;
      }
    }

    const p = preds.get(n.id).filter((x) => placed.has(x)).map((x) => G.node(x));
    let start = '';
    if (n.type === 'on_local') { helpers.add('mark'); locals = true; start = `when = marked("${localKey(n.params.name)}"), `; }
    else if (type.g === 'begin') { if (opts.begin) { start = opts.begin(n); if (start) helpers.add('mark'); } }
    else {
      if (n.type === 'all' || p.length === 1) start = `after = {${p.map((x) => `"${doneId(x)}"`).join(', ')}}, `;
      else {   // several lines in: whichever finishes first
        helpers.add('mark');
        p.forEach((x) => orSources.add(x.id));
        start = `when = flow.any(${p.map((x) => `marked("${FK}.done.${sid(x)}")`).join(', ')}), `;
      }
    }
    let text = n.prefab ? `-- [${sentence(n.prefab, doc.inputs, outer.node)}]\n` : '';
    text += `-- ${say(n)}\n{id = "${id}", ${start}`;
    const params = run.some((l) => /\bstate\b/.test(l)) ? 'context, state' : 'context';
    if (run.length) text += `run = function(${params})\n${run.map((l) => '    ' + l).join('\n')}\nend, `;
    if (awaitExpr) text += `await = ${awaitExpr}, `;
    text = text.replace(/, $/, '') + '},';
    steps.push({ n, text, tail });
  }
  // A node that feeds a "whichever first" join leaves a mark when it finishes.
  const stepText = steps.map((s) => {
    let t = s.text; if (s.tail) t += '\n' + s.tail;
    if (orSources.has(s.n.id)) t += `\n{id = "${sid(s.n)}_d", after = {"${doneId(s.n)}"}, run = mark("${FK}.done.${sid(s.n)}")},`;
    return t;
  });
  const stepCount = stepText.join('\n').split('{id = ').length - 1;
  if (stepCount > 64) err(`The scene needs ${stepCount} flow steps; lib.flow allows 64. Split it into two scenes.`);
  if (facts.length > 64) err(`The scene needs ${facts.length} facts; lib.flow allows 64.`);
  return { key: FK, facts, stepText, handlers, helpers, twice: orSources.size > 0 || locals, stepCount };
}

// The small Lua helpers a graph's steps and facts call, for the ones actually used.
export function helperLua(helpers, anyFacts) {
  const L = [];
  if (anyFacts) L.push('-- The event being handled, so a fact only latches on its own kind of event.', 'local kind = nil', '');
  if (helpers.has('slot_fact')) L.push('local function slot_fact(id, event_kind, slot)', '    return {id = id, observe = function(context, _, event)',
    '        return kind == event_kind and lib.is_slot(context, event, slot)', '    end}', 'end', '');
  if (helpers.has('arm')) L.push('-- Arm a trigger and remember it, so its first report can disarm it.', 'local function arm(context, id)',
    '    context:set_variable("armed/" .. id, true)', '    context:slot(id):fire_trigger()', 'end', '');
  if (helpers.has('start_scene')) L.push(
    '-- Start an authored scene with its cast: spawn = true has the host spawn the scene\'s own',
    '-- squads and bind its actors to them. Without it the scene runs with nobody in it. A scene',
    '-- whose cast the host cannot work out refuses spawn = true with an error; that one is started',
    '-- bare instead, and a debug variable on the Mission state page says so.',
    'local function start_scene(context, id, name)',
    '    local scene = context:scene(id)',
    '    if not pcall(function() scene:activate{spawn = true} end) then',
    '        context:set_variable("debug.scene." .. name, "started without a cast")',
    '        scene:activate{}',
    '    end', 'end', '');
  if (helpers.has('mark')) L.push('-- Marks for local triggers, outputs and "whichever finishes first" joins. They name the attempt, so a restart forgets them.',
    'local function mark(name)', '    return function(context) context:set_variable(name, context.attempt_generation) end', 'end',
    'local function marked(name)', '    return function(context, state) return state:variable(name) == context.attempt_generation end', 'end', '');
  return L;
}
// The flow.new{...} text for one graph.
export function graphLua(name, g) {
  const L = [`local ${name} = flow.new{`, `    key = "${g.key}",`, '    facts = {'];
  if (g.facts.length) L.push(ind(g.facts.join('\n'), 8));
  L.push('    },', '    steps = {');
  if (g.stepText.length) L.push(ind(g.stepText.join('\n\n'), 8));
  L.push('    },', '}', '');
  return L;
}

export function compileScene(doc) {
  const B = compilerBase(doc), { problems, inputs, stem, usedInputs, head, inputTable } = B;
  const g = flowGraph(doc, B, { nodes: doc.nodes, wires: doc.wires, key: 'sc', standalone: true });
  const { facts, handlers, helpers, twice } = g;

  // Assemble the file.
  const initial = inputs.get(doc.meta.initial);
  if (initial && initial.kind === 'State') usedInputs.add(initial.id);
  const L = [...head(['local flow = require("lib.flow")']), ...inputTable()];

  L.push(...helperLua(helpers, facts.length > 0), ...graphLua('graph', g));

  L.push('local function advance(context, state)', '    graph:advance(context, state)');
  if (twice) L.push('    graph:advance(context, state)   -- a second pass lets a join start in the same callback');
  L.push('end', '');
  if (handlers.size) {
    L.push('local function on(name)', '    return function(context, state, event)');
    if (facts.length) L.push('        kind = name');
    L.push('        graph:handle(context, state, event)');
    if (twice) L.push('        graph:advance(context, state)');
    if (facts.length) L.push('        kind = nil');
    L.push('    end', 'end', '');
  }
  L.push('return {');
  if (initial && initial.kind === 'State') L.push(`    initial_state = input.${B.luaField(initial.name)},`);
  L.push('    on_start = advance,', '    on_load = advance,');
  for (const h of EVENT_KINDS) {
    if (!handlers.has(h)) continue;
    if (h === 'client_state_changed') L.push('    on_event_client_state_changed = function(context, state, event)',
      '        -- The client reports state often; only the arrival answer matters here.',
      '        if event.entered == true then on("client_state_changed")(context, state, event) end', '    end,');
    else if (h === 'player_trigger') L.push('    on_event_player_trigger = function(context, state, event)',
      '        -- An armed trigger reports on every update; disarm it on the first one.',
      '        local slot = event.slot',
      '        if slot ~= nil and state:variable("armed/" .. slot.id) == true then',
      '            context:clear_variable("armed/" .. slot.id)', '            slot:disarm_trigger()', '        end',
      '        on("player_trigger")(context, state, event)', '    end,');
    else L.push(`    on_event_${h} = on("${h}"),`);
  }
  L.push('}', '');
  return { lua: L.join('\n'), problems, stem };
}
