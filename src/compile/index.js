// compile(doc) -> { lua, files, shown, problems, stem }. Pure: give it a document, get the script.
//   lua    the main script, <stem>.lua
//   files  any further files that go beside it, by file name (freeroam writes content.lua)
//   shown  everything, joined for display and for telling whether anything changed
import { setCustom, T, slotTypeName } from '../catalog.js';
import { syntaxError } from '../lualint.js';
import { compileScene } from './scene.js';
import { compileCampaign } from './campaign.js';
import { compileFreeroam } from './freeroam.js';
import { compileMission } from './mission.js';
import { tabsOf } from '../state.js';

export { foldStem } from './base.js';

const article = (noun) => (/^[aeiou]/i.test(noun) ? 'an ' : 'a ') + noun;
const COMPILERS = { scene: compileScene, campaign: compileCampaign, mission: compileMission, freeroam: compileFreeroam };

export function compile(doc) {
  setCustom(doc.custom);
  const out = (COMPILERS[doc.meta.mode] || compileScene)(doc);
  out.files = out.files || {};
  const err = (msg, nid, tab) => out.problems.push({ msg, nid, tab, level: 'err' });
  // The game refuses a request made on the wrong type of slot and faults the whole script
  // ("activity slot is not an exact type-N"). Types are known once an SDK module was loaded.
  const inputs = new Map(doc.inputs.map((i) => [i.id, i]));
  // Every graph being compiled: the one on screen, or in mission mode all the tabs.
  const graphs = doc.meta.mode === 'mission' ? tabsOf(doc).map((t) => [t.id, t.nodes]) : [[undefined, doc.nodes]];
  for (const [tab, nodes] of graphs) for (const n of nodes) for (const p of T(n.type).parts) {
    if (p.kind !== 'ref' || !p.types) continue;
    for (const id of [].concat(n.params[p.name] || [])) {
      const i = inputs.get(id);
      if (i && i.kind === 'Slot' && i.slotType != null && !p.types.includes(i.slotType)) {
        err(`"${i.name}" is ${article(slotTypeName(i.slotType))} (${i.key}), but this socket takes ${article(slotTypeName(p.types[0]))}. In game the script would stop with "not an exact type-${p.types[0]}".`, n.id, tab);
      }
    }
  }
  // A scene started with its cast spawns that cast itself, and the host refuses a cast squad
  // that is already placed. The SDK does not say who is in a cast; all that can be told is which
  // squads sit in the scene's own authored object, which is often most of an area. So this is
  // one note on the scene node naming the candidates, not a complaint on every Spawn node.
  const warn = (msg, nid, tab) => out.problems.push({ msg, nid, tab, level: 'warn' });
  const all = graphs.flatMap(([tab, nodes]) => nodes.map((n) => ({ tab, n })));
  const placed = new Map();   // object -> names of the squads this drawing spawns from it
  for (const { n } of all) {
    const i = n.type === 'spawn' && inputs.get(n.params.squad);
    if (i && i.object) placed.set(i.object, (placed.get(i.object) || new Set()).add(i.name));
  }
  const told = new Set();
  for (const { tab, n } of all) {
    const i = n.type === 'scene' && n.params.mode === 'start' && inputs.get(n.params.scene);
    if (!i || !i.object || !placed.has(i.object) || told.has(i.id)) continue;
    told.add(i.id);
    // Squads named like the scene are listed first: a guess at order only, nothing is left out of the count.
    const words = i.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && w !== 'scene');
    const like = (s) => words.filter((w) => s.toLowerCase().split(/[^a-z0-9]+/).includes(w)).length;
    const names = [...placed.get(i.object)].sort((a, b) => like(b) - like(a)), few = names.slice(0, 4).map((s) => '"' + s + '"').join(', ') + (names.length > 4 ? ` and ${names.length - 4} more` : '');
    warn(`Scene "${i.name}" spawns its own actors when it starts. This drawing also spawns ${names.length === 1 ? 'a squad' : names.length + ' squads'} from the same part of the map (${few}). If any of them are actors in this scene, remove their Spawn nodes: the game will not hand an already spawned squad to a scene, and the scene then starts with nobody in it. The SDK does not say which squads those are.`, n.id, tab);
  }
  // Built-in nodes always emit valid Lua, so a syntax error here comes from hand-written Lua.
  for (const [name, text] of [[out.stem + '.lua', out.lua], ...Object.entries(out.files)]) {
    const broken = syntaxError(text);
    if (broken) err(`${name} has a Lua syntax error at line ${broken.line}: ${broken.message}. Check the custom and Lua nodes.`);
  }
  if (out.lua.length > 128 * 1024) err('The script is over 128 KiB, the limit for a main script.');
  out.shown = out.lua + Object.entries(out.files).map(([name, text]) => `\n-- ${'='.repeat(20)} ${name} ${'='.repeat(20)}\n${text}`).join('');
  return out;
}
