// Reads the keys out of a generated mission module (Sunrise/sdk/lua/missions/<name>.lua).
// The module is plain Lua. "Name = {" is read as the start of a table and "KEY =" inside a
// known table as one entry of that kind. The format is not documented, so anything outside
// a recognised table is skipped rather than guessed at.
const SECTION = { states: 'State', Slot: 'Slot', Squad: 'Squad', Scene: 'Scene', Directive: 'Directive', DialogueCue: 'Cue', slots: '#rows', scenes: '#scenes' };

export function parseSdk(text) {
  const out = new Map(), types = new Map(), objects = new Map(), events = new Map(); let section = null, sensor = null, known = false;
  const add = (key, kind) => out.set(kind + ':' + key, { key, kind });
  for (const line of text.split('\n')) {
    const opener = line.match(/(?:^|[\s.])([A-Za-z]+)\s*=\s*\{\s*$/), entry = line.match(/^\s*([A-Z][A-Z0-9_]{2,})\s*=/);
    if (opener && !entry) { section = SECTION[opener[1]] || null; sensor = null; known = known || !!section; continue; }
    if (!entry || !section) continue;
    // slots = { KEY = { id = ..., type = 31, ... } }: the rows that say what type each slot is
    if (section === '#rows') {
      const t = line.match(/\btype = (\d+)/), o = line.match(/id = "slot\/([0-9a-f]+)\//);
      if (t) types.set(entry[1], Number(t[1]));
      if (o) objects.set(entry[1], o[1]);
      continue;
    }
    // scenes = { KEY = { id = ..., event_keys = { 0x385838EC, ... } } }: the events a scene's graph waits for, in order
    if (section === '#scenes') {
      const e = line.match(/\bevent_keys = \{([^}]*)\}/);
      if (e) events.set(entry[1], e[1].split(',').map((x) => x.trim()).filter((x) => /^0x[0-9A-Fa-f]{1,8}$/.test(x)));
      continue;
    }
    if (section !== 'Cue') add(entry[1], section);
    else if (/=\s*\{\s*$/.test(line)) sensor = entry[1];
    else if (sensor && /^CUE_/.test(entry[1])) add(sensor + '.' + entry[1], 'Cue');
  }
  if (!known) {   // no table recognised: fall back to every upper-case name, sorted by prefix
    for (const m of text.matchAll(/(?:^|[\s{,])([A-Z][A-Z0-9_]{2,})\s*=/g)) add(m[1], /^STATE_/.test(m[1]) ? 'State' : /^SC_/.test(m[1]) ? 'Scene' : 'Slot');
  }
  for (const k of out.values()) {
    if (k.kind === 'Slot' && types.has(k.key)) k.type = types.get(k.key);
    // a squad and a scene share their key with their slot, so they share its object too
    if (objects.has(k.key) && (k.kind === 'Slot' || k.kind === 'Squad' || k.kind === 'Scene')) k.object = objects.get(k.key);
    if (k.kind === 'Scene' && events.has(k.key)) k.events = events.get(k.key);
  }
  return { keys: [...out.values()].sort((a, b) => a.key.localeCompare(b.key)), known };
}
