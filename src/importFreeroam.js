// Reads an open-world destination script (lib.freeroam) back into a freeroam drawing.
// The zones usually live in a second file, content.lua, which the main script calls as
// content(mission, freeroam); both shapes are read. Pure: Lua text in, a document out.
import { blank, setDoc, S, addInput, addNode } from './state.js';
import { parseLua, evaluator } from './luaEval.js';

const TABLE = { Slot: 'Slot', Squad: 'Squad', states: 'State' };

export const looksLikeFreeroam = (lua) => /\bfreeroam\.new\s*[{(]/.test(lua) && /require\(\s*["']lib\.freeroam["']\s*\)/.test(lua);
// The file of this mission a require("<mission>.<file>") names, or null.
export const moduleFile = (name) => (/^[a-z0-9_]+\.[a-z0-9_]+$/.test(name) ? name.split('.')[1] + '.lua' : null);

// files: every Lua file in the mission's folder, by file name. The main script is `lua`.
export function importFreeroam(lua, files, activity) {
  const main = parseLua(lua);
  if (main.error) return { error: main.error };
  const E = evaluator(), found = E.run(main.ast.body);
  if (!found || !found.freeroam || !found.freeroam.kv) return { error: 'This script does not end in "return freeroam.new{...}", so it cannot be drawn.' };
  let zones = found.freeroam.kv.zones;
  const warnings = [], warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };

  if (zones && zones.moduleCall) {
    // zones = content(mission, freeroam): read the function the other file returns, with its
    // parameters standing for the two modules it is handed.
    const file = moduleFile(zones.moduleCall), text = file && files ? files[file] : null;
    if (text == null) return { error: `The zones are in ${file || zones.moduleCall}, which was not found beside the script.` };
    const part = parseLua(text);
    if (part.error) return { error: `${file}: ${part.error}` };
    const C = evaluator(), fn = C.run(part.ast.body);
    if (!fn || !fn.fn) return { error: `${file} does not return a function, so its zones cannot be read.` };
    fn.fn.parameters.forEach((p, i) => { if (zones.args[i] !== undefined) C.bind(p.name, zones.args[i]); });
    zones = C.run(fn.fn.body);
  }
  if (!zones || !Array.isArray(zones.list)) return { error: 'The zones of this script are built in a way that cannot be read as a table.' };

  setDoc(blank());
  S.meta = { activity: activity || '', scenario: E.seen.scenario, initial: '', mode: 'freeroam' };
  const have = new Map();   // kind:key -> input id; a destination names thousands, so no scanning
  const input = (kind, key) => {
    const k = kind + ':' + key;
    if (!have.has(k)) have.set(k, addInput(kind, key.toLowerCase().replace(/^([0-9])/, '_$1'), key).id);
    return have.get(k);
  };
  const ref = (v, want, what) => {
    if (v == null) return '';
    const kind = v.path && v.path[0] === 'mission' ? TABLE[v.path[1]] : null, key = kind ? v.path.slice(2).join('.') : '';
    if (kind !== want || !key) { warn(`${what}: could not read what it refers to; left empty.`); return ''; }
    return input(kind, key);
  };
  const listOf = (v) => (v == null ? [] : v.list && !v.path ? v.list : [v]);
  const slots = (v, what) => listOf(v).map((x) => ref(x, 'Slot', what)).filter(Boolean);
  const squads = (v, what) => listOf(v).map((u) => {
    const a = u && u.unit ? u.unit : [u];
    if (a[1] && a[1].path && a[0] && a[0].path && a[1].path[2] !== a[0].path[2]) warn(`${what}: a squad is paired with a slot of another name; the editor always uses the slot that shares the squad's key.`);
    return ref(a[0], 'Squad', what);
  }).filter(Boolean);
  const known = (t, keys, what) => { for (const k in t.kv) if (!keys.includes(k)) warn(`${what}: the field "${k}" has no node and was dropped.`); };

  zones.list.forEach((z, index) => {
    if (!z || !z.kv) { warn('A zone could not be read and was dropped.'); return; }
    const k = z.kv, region = k.region && k.region.num != null ? Number(k.region.num) : NaN, what = `Zone at region ${isNaN(region) ? '?' : region}`;
    known(z, ['state', 'region', 'patrol', 'ambient', 'events', 'sector'], what);
    const stack = [['f_zone', { state: ref(k.state, 'State', what + ' state'), region: isNaN(region) ? 0 : region, patrol: squads(k.patrol, what + ' patrol'), ambient: squads(k.ambient, what + ' ambient') }]];
    for (const e of listOf(k.events)) {
      if (!e || !e.kv) { warn(`${what}: a public event could not be read and was dropped.`); continue; }
      known(e, ['sensor', 'objective', 'squads', 'chest'], what + ' event');
      stack.push(['f_event', { sensor: ref(e.kv.sensor, 'Slot', what + ' event sensor'), objective: ref(e.kv.objective, 'Slot', what + ' event objective'),
        squads: squads(e.kv.squads, what + ' event'), chest: slots(e.kv.chest, what + ' event chest') }]);
    }
    if (k.sector && k.sector.kv) {
      const s = k.sector.kv;
      known(k.sector, ['boss', 'squads', 'chest'], what + ' Lost Sector');
      stack.push(['f_sector', { boss: ref(s.boss, 'Slot', what + ' sector boss'), squads: squads(s.squads, what + ' sector'), chest: slots(s.chest, what + ' sector chest') }]);
    }
    // Rough grid; the canvas lays the stacks out properly once it can measure them.
    const nodes = stack.map(([t, p]) => addNode(t, 40 + (index % 4) * 520, 30 + Math.floor(index / 4) * 420, p));
    nodes.forEach((n, i) => { if (nodes[i + 1]) n.next = nodes[i + 1].id; });
  });
  return { doc: S, warnings, scenario: E.seen.scenario };
}
