// Campaign mode: the drawing becomes one lib.campaign content table, the shape the Red War
// drafts use. lib.campaign then arms triggers, replays markers, runs opening cutscenes and
// completes the mission, so none of that is generated here.
import { T } from '../catalog.js';
import { graphOf, sentence } from '../graph.js';
import { sandboxProblems } from '../lualint.js';
import { compilerBase, ind } from './base.js';

const END_LISTS = new Set(['trigger', 'monitor', 'clear', 'destroyed']);
// Nodes that happen when a step or an encounter starts.
const isStartNode = (n) => n.type === 'c_say' || n.type === 'c_move' || n.type === 'c_seq' || n.type === 'c_lua' || (T(n.type).custom && T(n.type).custom.kind === 'action');

// Read the drawing: the Campaign stack gives the setup and legs, the story stack is cut into
// steps at each Step node, and each Encounter stack is one encounter.
function campaignModel(doc, G, say, err, warn) {
  const C = { setup: null, key: '', directive_sensor: '', dialogue_sensor: '', spawn_set: '', omit: [], intro: [], legs: [], steps: [], encounters: [] };
  const heads = G.heads();
  const only = (type, missing) => {
    const found = heads.filter((n) => n.type === type);
    if (!found.length) err(missing);
    for (const extra of found.slice(1)) err(`There are two "${T(type).t.split(/[ {:]/)[0]}…" stacks; keep one.`, extra.id);
    return found[0];
  };
  const stray = (n, where) => warn(`"${say(n)}" does nothing ${where}; it is ignored.`, n.id);
  // One start node, filed under its step or encounter in the order it was drawn.
  const file = (holder, n) => {
    const P = n.params;
    if (n.type === 'c_say') holder.lines.push({ cue: P.cue, filter: P.filter, uid: n.id });
    else if (n.type === 'c_move') holder.start.push({ uid: n.id, transition: P.transition, devices: P.devices || [] });
    else holder.start.push({ uid: n.id, node: n });
  };

  const setup = only('c_setup', 'Add the green Campaign node. It names the sensors, and the legs stack under it.');
  if (setup) {
    const P = setup.params;
    Object.assign(C, { setup: setup.id, key: P.key || '', directive_sensor: P.sensor, dialogue_sensor: P.voice, spawn_set: (P.spawn || '').trim() });
    for (const n of G.chain(setup).slice(1)) {
      if (n.type === 'c_cut') C.intro.push({ uid: n.id, state: n.params.state, cinematic: n.params.cinematic });
      else if (n.type === 'c_leg') C.legs.push({ uid: n.id, id: n.params.id, state: n.params.state, arm: n.params.arm || [], watch: n.params.watch || [] });
      else if (n.type === 'c_omit') C.omit.push(...(n.params.objects || []));
      else stray(n, 'under the Campaign node');
    }
  }

  const owner = new Map();   // node id -> the step it belongs to
  const story = only('c_story', 'Add the green "When the player lands" node. The steps stack under it.');
  if (story) {
    let cur = null;
    for (const n of G.chain(story).slice(1)) {
      const P = n.params, type = T(n.type);
      if (n.type === 'c_step') {
        cur = { uid: n.id, id: P.id, directive: P.directive, navpoint: P.marker, waypoint: P.waypoint, scene: '', lines: [], start: [], ends: [], barrier: !!P.barrier, revisit: !!P.revisit };
        C.steps.push(cur); owner.set(n.id, cur); continue;
      }
      if (!cur) { err(`"${say(n)}" comes before the first Step node. Put a Step above it.`, n.id); continue; }
      owner.set(n.id, cur);
      if (type.end) {
        const value = { trigger: P.triggers, monitor: P.monitors, region: P.leg, clear: P.encounters, interact: P.object, ghost_link: P.link,
          destroyed: P.objects, scene: P.scene, health: { slot: P.actor, at: P.at } }[type.end];
        const same = cur.ends.find((e) => e.kind === type.end);
        if (same && END_LISTS.has(type.end)) same.value = same.value.concat(value || []);
        else if (same) err(`Step "${cur.id}" has two "${type.t.split(' {')[0]}" nodes; the library takes one.`, n.id);
        else cur.ends.push({ kind: type.end, value: END_LISTS.has(type.end) ? (value || []).slice() : value, uid: n.id });
        continue;
      }
      if (n.type !== 'c_scene' && !isStartNode(n)) { stray(n, 'inside a step'); continue; }
      if (cur.ends.length) warn(`"${say(n)}" sits below an Until node, but it still happens when step "${cur.id}" starts. Move it above to read true.`, n.id);
      if (n.type !== 'c_scene') file(cur, n);
      else if (cur.scene) err(`Step "${cur.id}" starts two scenes; the library starts one per step.`, n.id);
      else cur.scene = P.scene;
    }
  }

  for (const h of heads) {
    if (h.type !== 'c_enc') { if (h.type !== 'c_setup' && h.type !== 'c_story') warn(`"${say(h)}" is not attached to a stack, so it is ignored.`, h.id); continue; }
    const P = h.params, e = { uid: h.id, id: P.id, after: 'arrival', trigger: P.trigger, monitor: P.monitor, objective: P.objective, squads: P.squads || [], lines: [], start: [] };
    for (const n of G.chain(h).slice(1)) { if (isStartNode(n)) file(e, n); else stray(n, 'under an encounter'); }
    const from = doc.wires.filter((w) => w.to === h.id).map((w) => owner.get(w.from));
    if (from.length > 1) err(`Encounter "${e.id}" has ${from.length} lines into it; it can follow one step.`, h.id);
    else if (from.length && !from[0]) err(`The line into encounter "${e.id}" must come from a Step in the story stack.`, h.id);
    else if (from.length) e.after = from[0].uid;
    C.encounters.push(e);
  }
  return C;
}

export function compileCampaign(doc) {
  const B = compilerBase(doc), { err, warn, pick, twinOf, inputs } = B;
  const G = graphOf(doc.nodes), say = (n) => sentence(n, doc.inputs, G.node);
  const C = campaignModel(doc, G, say, err, warn);
  const bad = (uid, msg) => err(msg, uid);
  const name = (id) => (inputs.get(id) ? inputs.get(id).name : '?');
  const many = (ids, kind) => (ids || []).map((id) => pick(id, kind)).filter(Boolean);
  const oneOrList = (list) => (list.length === 1 ? list[0] : `{${list.join(', ')}}`);
  const q = (s) => `"${s}"`;
  const body = (fields) => '{' + fields[0] + (fields.length > 1 ? ',\n' + ind(fields.slice(1).join(',\n'), 4) : '') + '},';

  const sensor = pick(C.directive_sensor, 'Slot'), voice = pick(C.dialogue_sensor, 'Slot');
  if (C.setup != null) {
    if (!/^[a-z0-9_]{1,12}$/.test(C.key)) bad(C.setup, 'Give the Campaign node a short key (a-z, 0-9, _; at most 12 characters).');
    if (!sensor) bad(C.setup, 'Drop the directive sensor that shows the goals into the Campaign node.');
    if (C.spawn_set && !/^(0x[0-9a-fA-F]{1,8}|\d+)$/.test(C.spawn_set)) bad(C.setup, 'The spawn set must be a number such as 0x8029E4B4.');
    if (!C.legs.length) bad(C.setup, 'Stack at least one Leg under the Campaign node. The first leg is where the player lands.');
  }
  if (!C.steps.length) err('Stack at least one Step under "When the player lands".');

  // Names: every leg, step and encounter needs its own id.
  const ids = (list, what) => {
    const seen = new Set();
    for (const x of list) {
      if (!/^[a-z0-9_]+$/.test(x.id || '')) bad(x.uid, `${what === 'encounter' ? 'An' : 'A'} ${what} has no id (a-z, 0-9, _).`);
      else if (seen.has(x.id) || (what === 'step' && (x.id === 'arrival' || x.id === 'done'))) bad(x.uid, `The ${what} id "${x.id}" is already taken.`);
      else if (`flow.${C.key}.enc.step.${x.id}.scanned`.length > 63) bad(x.uid, `The ${what} id "${x.id}" is too long for a mission variable name.`);
      seen.add(x.id);
    }
  };
  ids(C.legs, 'leg'); ids(C.steps, 'step'); ids(C.encounters, 'encounter');
  const legId = new Map(C.legs.map((l) => [l.uid, l.id])), stepId = new Map(C.steps.map((s) => [s.uid, s.id]));
  const encId = new Map(C.encounters.map((e) => [e.uid, e.id]));
  const armed = new Set(), watched = new Set();
  for (const l of C.legs) { l.arm.forEach((t) => armed.add(t)); l.watch.forEach((t) => watched.add(t)); }
  let spoken = false;

  const linesOf = (holder) => {
    const out = [];
    for (const ln of holder.lines) {
      const cue = pick(ln.cue, 'Cue'), filter = pick(ln.filter, 'Slot');
      if (!cue) { bad(ln.uid, 'This Say node has no line dropped in.'); continue; }
      out.push(filter ? `line(${cue}, ${filter})` : `line(${cue})`); spoken = true;
    }
    return out.length ? `lines = {${out.join(', ')}}` : null;
  };
  // on_start: device moves, custom actions and raw Lua, in the order they were stacked.
  const startOf = (holder) => {
    const out = [];
    for (const s of holder.start) {
      if (!s.node) {
        const devices = many(s.devices, 'Slot');
        if (!devices.length) bad(s.uid, 'This device node has no device dropped in.');
        else out.push(`move(context, {${devices.join(', ')}}, "${s.transition}")`);
        continue;
      }
      const n = s.node, def = T(n.type).custom;
      if (n.type === 'c_seq') {
        const sequence = pick(n.params.sequence, 'Slot');
        if (!sequence) bad(n.id, 'This Play sequence node has no sequence dropped in.'); else out.push(`context:slot(${sequence}):play_sequence()`);
        continue;
      }
      let code = '';
      if (def) { if (B.defOk(def, n.id) && B.socketsFilled(n, n.id, say(n))) code = def.run; }
      else {
        code = (n.params.code || '').trim();
        if (!code) bad(n.id, 'This Lua node is empty.');
        for (const p of sandboxProblems(code)) bad(n.id, `Lua node: ${p}.`);
        if (/\bstate\b/.test(code)) bad(n.id, 'Lua node: "state" is not available here; the code runs inside on_start(context).');
      }
      if (code) out.push(...B.fillLua(code, n, n.id).split('\n'));
    }
    return out.length ? `on_start = function(context)\n${ind(out.join('\n'), 4)}\nend` : null;
  };

  const intro = [];
  for (const cut of C.intro) {
    const state = pick(cut.state, 'State'), cine = pick(cut.cinematic, 'Slot');
    if (!state || !cine) bad(cut.uid, 'An opening cutscene needs both a cinematic and a state.');
    else intro.push(`{state = ${state}, cinematic = ${cine}},`);
  }

  const legs = C.legs.map((l) => {
    const state = pick(l.state, 'State');
    if (!state) bad(l.uid, `Leg "${l.id}" has no state.`);
    const f = [`id = ${q(l.id)}`, `state = ${state || 'nil'}`];
    if (many(l.arm, 'Slot').length) f.push(`arm = {${many(l.arm, 'Slot').join(', ')}}`);
    if (many(l.watch, 'Slot').length) f.push(`watch = {${many(l.watch, 'Slot').join(', ')}}`);
    return body(f);
  });

  let factCount = 1 + C.legs.length;
  const counted = new Set();
  const steps = C.steps.map((s) => {
    const f = [`id = ${q(s.id)}`], ends = [];
    const directive = pick(s.directive, 'Directive');
    if (directive) f.push(`directive = ${directive}`);
    if (pick(s.navpoint, 'Slot')) f.push(`navpoint = ${pick(s.navpoint, 'Slot')}`);
    if (pick(s.waypoint, 'Slot')) f.push(`waypoint = ${pick(s.waypoint, 'Slot')}`);
    if ((s.navpoint || s.waypoint) && !directive) warn(`Step "${s.id}" has a marker but no goal to attach it to.`, s.uid);
    if (pick(s.scene, 'Scene')) f.push(`scene = ${pick(s.scene, 'Scene')}`);
    const lines = linesOf(s), start = startOf(s);
    if (lines) f.push(lines);
    if (start) f.push(start);
    for (const e of s.ends) {
      const fail = (msg) => bad(e.uid, `Step "${s.id}": ${msg}`);
      if (e.kind === 'trigger' || e.kind === 'monitor') {
        const set = e.kind === 'trigger' ? armed : watched, list = [];
        for (const id of e.value) {
          if (!pick(id, 'Slot')) continue;
          if (!set.has(id)) fail(`it ends on ${e.kind} "${name(id)}", which no leg ${e.kind === 'trigger' ? 'arms' : 'watches'}.`);
          list.push(pick(id, 'Slot'));
          if (s.revisit && e.kind === 'trigger') factCount++; else if (!counted.has(id)) { counted.add(id); factCount++; }
        }
        if (!list.length) fail(`drop in the ${e.kind} it ends on.`); else ends.push(`${e.kind} = ${oneOrList(list)}`);
      } else if (e.kind === 'region') {
        if (!legId.has(e.value)) fail('pick the leg it ends in.'); else ends.push(`region = ${q(legId.get(e.value))}`);
      } else if (e.kind === 'clear') {
        const list = e.value.filter((u) => encId.has(u)).map((u) => q(encId.get(u)));
        if (!list.length) fail('pick the encounter to clear.'); else ends.push(`clear = ${oneOrList(list)}`);
      } else if (e.kind === 'destroyed') {
        const list = many(e.value, 'Slot'); factCount += list.length;
        if (!list.length) fail('drop in the objects to destroy.'); else ends.push(`destroyed = {${list.join(', ')}}`);
      } else if (e.kind === 'health') {
        const slot = pick(e.value.slot, 'Slot'), at = e.value.at; factCount++;
        if (!slot || !(at >= 0 && at <= 1)) fail('the health end needs a combatant and a fraction from 0 to 1.');
        else ends.push(`health = {slot = ${slot}, at = ${at}}`);
      } else {
        const slot = e.kind === 'scene' ? (pick(e.value, 'Scene') && twinOf(e.value)) : pick(e.value, 'Slot');
        factCount += e.kind === 'ghost_link' ? 2 : 1;
        if (!slot) fail('this Until node has nothing dropped in.'); else ends.push(`${e.kind} = ${slot}`);
      }
    }
    if (s.barrier) f.push('barrier = true');
    if (s.revisit) f.push('revisit = true');
    if (ends.length) f.push(`ends = {${ends.join(', ')}}`);
    else if (!s.ends.length) warn(`Step "${s.id}" has no Until node, so it finishes the moment it starts.`, s.uid);
    return body(f);
  });

  const encounters = C.encounters.map((e) => {
    const f = [`id = ${q(e.id)}`];
    if (e.after !== 'arrival') f.push(`after = ${q(stepId.get(e.after))}`);
    const trigger = pick(e.trigger, 'Slot'), monitor = pick(e.monitor, 'Slot');
    if (trigger && !armed.has(e.trigger)) bad(e.uid, `Encounter "${e.id}" waits on trigger "${name(e.trigger)}", which no leg arms.`);
    if (monitor && !watched.has(e.monitor)) bad(e.uid, `Encounter "${e.id}" waits on monitor "${name(e.monitor)}", which no leg watches.`);
    if (trigger && monitor) warn(`Encounter "${e.id}" has a trigger and a monitor; the library only uses the trigger.`, e.uid);
    if (trigger) f.push(`trigger = ${trigger}`);
    if (monitor) f.push(`monitor = ${monitor}`);
    if (pick(e.objective, 'Slot')) f.push(`objective = ${pick(e.objective, 'Slot')}`);
    const lines = linesOf(e), start = startOf(e);
    if (lines) f.push(lines);
    if (start) f.push(start);
    const squads = e.squads.filter((id) => pick(id, 'Squad')).map((id) => `    unit(${pick(id, 'Squad')}, ${twinOf(id)}),`);
    // An encounter may exist only for its lines or its Lua; the library still wants the list.
    if (!squads.length && !lines && !start) warn(`Encounter "${e.id}" spawns nothing and does nothing.`, e.uid);
    f.push(squads.length ? `squads = {\n${squads.join('\n')}\n}` : 'squads = {}');
    return body(f);
  });
  if (spoken && !voice) bad(C.setup, 'Steps play lines, so drop the dialogue sensor into the Campaign node.');
  if (C.steps.length + 2 > 64) err(`${C.steps.length} steps is over what one flow holds (62).`);
  if (C.encounters.length > 64) err('lib.flow holds at most 64 encounters.');
  if (factCount > 64) err(`The steps need about ${factCount} facts; lib.flow holds 64. Use fewer distinct triggers or end conditions.`);

  const out = ['return campaign.new{', `    key = ${q(C.key)},`, `    directive_sensor = ${sensor || 'nil'},`];
  if (voice) out.push(`    dialogue_sensor = ${voice},`);
  if (C.spawn_set) out.push(`    spawn_set = ${C.spawn_set},`);
  const omit = many(C.omit, 'Slot');
  if (omit.length) out.push(`    omit = {${omit.join(', ')}},`);
  const block = (label, items) => { if (items.length) out.push(`    ${label} = {`, ind(items.join('\n'), 8), '    },'); };
  block('intro', intro); block('legs', legs); block('steps', steps); block('encounters', encounters);
  out.push('}', '');
  const table = out.join('\n');
  const locals = ['unit', 'line', 'move'].filter((n) => new RegExp('(^|[\\s{(,])' + n + '\\(').test(table));
  const requires = ['local campaign = require("lib.campaign")'];
  if (locals.length) requires.push(`local ${locals.join(', ')} = ${locals.map((n) => 'campaign.' + n).join(', ')}`);
  const lua = [...B.head(requires), ...B.inputTable()].join('\n') + '\n' + table;
  return { lua, problems: B.problems, stem: B.stem };
}
