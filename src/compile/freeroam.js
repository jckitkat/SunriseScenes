// Freeroam mode: the drawing becomes a lib.freeroam zone table. lib.freeroam does the
// work in game (placing patrols, respawns, running one public event per zone, Lost Sectors);
// this only writes down which zones exist and what is in them.
//
// Two files come out, the way the existing destinations are laid out: a short main script,
// and content.lua holding the zones. A destination's zone table is far larger than the
// 128 KiB a main script may be, and it names thousands of squads, so content.lua refers to
// the mission module directly (mission.Squad.X) instead of going through an input table.
import { KINDS, VALID_KEY } from '../catalog.js';
import { graphOf, sentence } from '../graph.js';
import { compilerBase } from './base.js';

export function compileFreeroam(doc) {
  const B = compilerBase(doc), { err, warn, inputs, stem } = B;
  const G = graphOf(doc.nodes), say = (n) => sentence(n, doc.inputs, G.node);
  const scenario = (doc.meta.scenario || '').trim() || 'MY_SCENARIO';

  // An input as the mission-module reference it stands for, or null.
  const complained = new Set();
  const ref = (id, kind) => {
    const i = inputs.get(id);
    if (!i || i.kind !== kind) return null;
    if (!VALID_KEY.test(i.key)) { if (!complained.has(id)) { complained.add(id); err(`Input "${i.name}" has no valid ${KINDS[kind]} key. Set it on the Inputs screen.`); } return null; }
    return `${KINDS[kind]}.${i.key}`;
  };
  // A squad goes with the slot that shares its key; its deaths are reported on that slot.
  const units = (ids) => (ids || []).map((id) => { const i = inputs.get(id); return ref(id, 'Squad') ? `unit(mission.Squad.${i.key}, mission.Slot.${i.key}),` : null; }).filter(Boolean);
  const slots = (ids) => (ids || []).map((id) => ref(id, 'Slot')).filter(Boolean).map((r) => r + ',');
  const list = (name, items, pad) => [`${pad}${name} = {`, ...items.map((x) => pad + '    ' + x), `${pad}},`];

  const zones = [], regions = new Map();
  for (const h of G.heads()) {
    if (h.type !== 'f_zone') { warn(`"${say(h)}" is not stacked under a Zone, so it is ignored.`, h.id); continue; }
    const P = h.params, state = ref(P.state, 'State'), region = P.region;
    if (!state) err('This zone has no state. Drop in the state row the zone is authored as.', h.id);
    if (!Number.isInteger(region) || region < 0) err('A zone\'s region must be a whole number: the region index of its state.', h.id);
    else if (regions.has(region)) err(`Two zones share region ${region}. Each zone needs its own.`, h.id);
    else regions.set(region, h.id);
    const L = ['        {', `            state = ${state || 'nil'},`, `            region = ${region},`];
    const patrol = units(P.patrol), ambient = units(P.ambient);
    if (ambient.length) L.push(...list('ambient', ambient, '            '));
    if (patrol.length) L.push(...list('patrol', patrol, '            '));
    const events = [];
    let sector = null;
    for (const n of G.chain(h).slice(1)) {
      const Q = n.params;
      if (n.type === 'f_event') {
        const sensor = ref(Q.sensor, 'Slot'), objective = ref(Q.objective, 'Slot'), squads = units(Q.squads);
        if (!sensor) err('This public event has no sensor. Drop in its public event sensor slot.', n.id);
        if (!objective) err('This public event has no objective. Drop in the objective slot it resets.', n.id);
        if (!squads.length) warn('This public event spawns no squads, so it can never be cleared.', n.id);
        events.push('                {', `                    sensor = ${sensor || 'nil'},`, `                    objective = ${objective || 'nil'},`,
          ...list('squads', squads, '                    '), ...list('chest', slots(Q.chest), '                    '), '                },');
      } else if (n.type === 'f_sector') {
        if (sector) { err('A zone can hold one Lost Sector. Put the second one in its own zone.', n.id); continue; }
        const squads = units(Q.squads), boss = ref(Q.boss, 'Slot');
        if (!squads.length) warn('This Lost Sector spawns no squads, so its chest never opens.', n.id);
        sector = ['            sector = {'];
        if (boss) sector.push(`                boss = ${boss},`);
        sector.push(...list('squads', squads, '                '), ...list('chest', slots(Q.chest), '                '), '            },');
      } else warn(`"${say(n)}" does nothing under a zone; it is ignored.`, n.id);
    }
    if (events.length) L.push('            events = {', ...events, '            },');
    if (sector) L.push(...sector);
    if (sector && (patrol.length || ambient.length || events.length)) {
      warn('This zone has a Lost Sector as well as patrols or events. lib.freeroam treats a zone with a sector as private sector content only.', h.id);
    }
    L.push('        },');
    zones.push({ region: Number.isInteger(region) ? region : Infinity, text: L.join('\n') });
  }
  if (!zones.length) err('Add a green Zone node. Each zone is one authored state of the destination.');
  if (zones.length > 64) err(`${zones.length} zones is more than a destination holds (64).`);
  zones.sort((a, b) => a.region - b.region);

  const lua = [`-- ${stem}.lua`, '-- Generated by Sunrise Scenes. Change the drawing and export again; edits here are lost.',
    `-- Install as: <game>/bin/x64/Sunrise/scripts/${stem}/${stem}.lua, with content.lua beside it.`,
    '-- Open world: population per zone, respawns, public event sites and Lost Sectors.', '',
    'local missions = require("missions")',
    `local mission = require(assert(missions.${scenario}, "unknown scenario: ${scenario}"))`,
    'local freeroam = require("lib.freeroam")',
    `local content = require("${stem}.content")`, '',
    'return freeroam.new{zones = content(mission, freeroam)}', ''].join('\n');
  const content = ['-- content.lua', '-- Generated by Sunrise Scenes from the drawing. Edits here are lost on the next export.',
    '-- One entry per zone: its state row, its region, and what lives there.',
    'return function(mission, freeroam)', '    local unit = freeroam.unit', '    return {', ...zones.map((z) => z.text), '    }', 'end', ''].join('\n');
  return { lua, files: { 'content.lua': content }, problems: B.problems, stem };
}
