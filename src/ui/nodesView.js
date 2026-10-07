// The Nodes screen: write your own node types (actions, waits), tune prefabs, and move
// them between scenes as a pack file.
import { T, EVENT_KINDS, KINDS, setCustom, parseTemplate } from '../catalog.js';
import { S, addCustom, removeCustom, customDef, customUses, makeNode, renamePrefabSocket } from '../state.js';
import { lintDef } from '../lualint.js';
import { sentence } from '../graph.js';
import { $, el, ui, changed, download } from './dom.js';
import { nodeElement } from './canvas.js';
import { paletteLabel } from './sidebar.js';

const STARTERS = {
  action: () => ({ kind: 'action', mode: 'both', template: 'Turn darkness {mode:=on=true|off=false} on {zone:Slot}',
    run: 'context:slot({zone}):set_darkness_zone{enabled = {mode}}' }),
  wait: () => ({ kind: 'wait', template: 'When {actor:Slot} falls to {at:num} health', start: '', event: 'damage_state', listen: '',
    cond: 'lib.is_slot(context, event, {actor})\n    and type(event.health) == "number" and event.health >= 0\n    and event.health <= {at}' }),
};
const KIND_LABEL = { action: 'action', wait: 'wait', prefab: 'prefab' };

export function renderNodesView() {
  const list = $('def-list'); list.replaceChildren();
  if (!customDef(ui.editDef)) ui.editDef = S.custom.length ? S.custom[0].id : null;
  for (const def of S.custom) {
    const item = el('div', { class: `defitem g-${T(def.id).g}` + (def.id === ui.editDef ? ' on' : ''), title: def.template,
      onclick: () => { ui.editDef = def.id; renderNodesView(); } }, paletteLabel(def.id) || '(no sentence)', el('small', { textContent: KIND_LABEL[def.kind] }));
    list.append(item);
  }
  if (!S.custom.length) list.append(el('div', { class: 'note', textContent: 'No custom nodes yet. Start one with + Action or + Wait, or fold a stack into a prefab with "Make prefab" on the canvas.' }));
  renderEditor(); renderHelp();
}

function renderEditor() {
  const box = $('def-edit'), def = customDef(ui.editDef); box.replaceChildren();
  if (!def) return;
  const preview = el('div'), lint = el('ul', { class: 'lint' });
  // Any edit: rebuild the node type, recompile, and refresh the preview and the checks in place.
  const touch = () => { setCustom(S.custom); changed(); refresh(); };
  const refresh = () => {
    const sample = makeNode(def.id, 0, 0); S.seq--;   // a throwaway node just to draw the sentence
    const e = nodeElement(sample); e.classList.add('preview');
    preview.replaceChildren(e);
    const { errors, warnings } = lintDef(def); lint.replaceChildren();
    for (const m of errors) lint.append(el('li', { textContent: m }));
    for (const m of warnings) lint.append(el('li', { class: 'warn', textContent: m }));
    if (!errors.length && !warnings.length) lint.append(el('li', { class: 'ok', textContent: 'No problems found. The Lua is only checked for syntax; test the node in game.' }));
    const item = $('def-list').querySelector('.defitem.on');
    if (item) item.firstChild.textContent = paletteLabel(def.id) || '(no sentence)';
  };
  const field = (label, control, hint) => el('div', { class: 'field' }, el('label', null, el('b', { textContent: label }), hint ? ' — ' + hint : ''), control);
  const text = (key, placeholder) => { const i = el('input', { type: 'text', class: 'mono', value: def[key] || '', placeholder, spellcheck: false, oninput: () => { def[key] = i.value; touch(); } }); return i; };
  const area = (key, placeholder) => { const t = el('textarea', { value: def[key] || '', placeholder, spellcheck: false, oninput: () => { def[key] = t.value; touch(); } }); return t; };
  const pick = (key, options) => {
    const s = el('select', { onchange: () => { def[key] = s.value; setCustom(S.custom); changed(); renderEditor(); } });
    for (const [value, label] of options) s.append(el('option', { value, textContent: label }));
    s.value = def[key] || ''; return s;
  };

  box.append(field('Sentence', text('template', 'Do something to {target:Slot}'), 'what the node says. Sockets go in braces; see the reference on the right.'));
  box.append(field('Preview', preview));

  if (def.kind === 'action') {
    box.append(field('Available in', pick('mode', [['both', 'Free scene and campaign'], ['scene', 'Free scene only'], ['campaign', 'Campaign only']])));
    box.append(field('Lua', area('run', 'context:slot({target}):…'), 'runs once when the node starts. context is available (and state, in free scenes).'));
  } else if (def.kind === 'wait') {
    box.append(field('Lua to run when it starts', area('start', '(optional) e.g. arm or switch something on'), 'optional'));
    box.append(field('Finishes on', pick('event', [['', 'no single event: re-check the condition'], ...EVENT_KINDS.map((k) => [k, 'event: ' + k])])));
    if (!def.event) box.append(field('Re-check on these events', text('listen', 'squad_state, device_state'), 'the condition is tested each time one of these arrives'));
    box.append(field('Condition', area('cond', def.event ? 'lib.is_slot(context, event, {target}) and event.…' : 'context:cohort{squads = {squads}}.cleared'),
      def.event ? 'a Lua expression over context, state and event. The wait finishes the first time it is true.' : 'a Lua expression over context and state. The wait finishes when it is true.'));
  } else {
    const sockets = parseTemplate(def.template || '').filter((p) => p.kind === 'ref');
    const rows = el('div');
    for (const p of sockets) {
      const i = el('input', { type: 'text', class: 'mono', value: p.name });
      i.style.width = '180px';
      i.addEventListener('change', () => {
        const to = i.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
        if (to && to !== p.name && !sockets.some((x) => x.name === to)) { renamePrefabSocket(def, p.name, to); changed(); }
        renderEditor();
      });
      rows.append(el('div', { class: 'row' }, el('span', { class: 'chip k-' + p.ref, textContent: p.ref }), i));
    }
    box.append(field('Sockets', sockets.length ? rows : el('div', { class: 'note', textContent: 'This prefab names no inputs.' }), 'rename one here and the sentence, the steps and every node using it follow.'));
    const steps = el('ol', { class: 'steps' });
    for (const b of def.body) {
      const shown = { ...b, params: Object.fromEntries(Object.entries(b.params).map(([k, v]) => [k, v])) };
      const names = S.inputs.concat(sockets.map((p) => ({ id: '$' + p.name, name: '[' + p.name + ']' })));
      steps.append(el('li', { textContent: sentence(shown, names, () => null) }));
    }
    box.append(field('Steps', steps, 'what one of these nodes stands for. To change the steps, Unpack a node on the canvas, edit the stack and make a new prefab.'));
  }
  box.append(field('Checks', lint));

  const uses = customUses(def.id);
  box.append(el('div', { class: 'field row' },
    el('button', { textContent: 'Duplicate', onclick: () => { const copy = addCustom(JSON.parse(JSON.stringify(def))); ui.editDef = copy.id; changed(); renderNodesView(); } }),
    el('button', { textContent: 'Delete', onclick: () => {
      if (uses && !confirm(`${uses} node${uses === 1 ? '' : 's'} use this type. They will show as missing until you remove them. Delete it anyway?`)) return;
      removeCustom(def.id); ui.editDef = null; changed(); renderNodesView();
    } }),
    el('span', { class: 'note', textContent: uses ? `Used by ${uses} node${uses === 1 ? '' : 's'}.` : 'Not used yet. It is in the palette under "Your nodes".' })));
  refresh();
}

function renderHelp() {
  const box = $('def-help');
  if (box.firstChild) return;
  const div = el('div', { class: 'ref' });
  div.innerHTML = `
    <h4>Sockets in the sentence</h4>
    <table>
      <tr><td><code>{door:Slot}</code></td><td>a named input. Kinds: ${Object.keys(KINDS).join(', ')}.</td></tr>
      <tr><td><code>{marker:Slot?}</code></td><td>the same, but may be left empty.</td></tr>
      <tr><td><code>{squads:Squad*}</code></td><td>a list of inputs.</td></tr>
      <tr><td><code>{mode:=on|off}</code></td><td>a fixed choice. <code>=on=true|off=false</code> gives each choice the Lua it stands for.</td></tr>
      <tr><td><code>{seconds:num}</code></td><td>a number.</td></tr>
      <tr><td><code>{label:text}</code></td><td>typed text, placed in the Lua as a quoted string.</td></tr>
      <tr><td><code>{loud:flag}</code></td><td>a checkbox, <code>true</code> or <code>false</code> in the Lua.</td></tr>
    </table>
    <h4>Using them in the Lua</h4>
    <table>
      <tr><td><code>{door}</code></td><td>the input, as the id string <code>context:slot(…)</code>, <code>context:squad(…)</code> or <code>context:scene(…)</code> take. An empty optional socket is <code>nil</code>.</td></tr>
      <tr><td><code>{squads}</code></td><td>a list socket becomes a Lua table: <code>{a, b}</code>.</td></tr>
      <tr><td><code>{squad.slot}</code></td><td>for a Squad or Scene: the slot that shares its key.</td></tr>
      <tr><td><code>{node}</code></td><td>a string unique to this node on the canvas, for a timer or variable name.</td></tr>
      <tr><td><code>input.some_name</code></td><td>any input by its name, without a socket.</td></tr>
    </table>
    <h4>What the Lua can use</h4>
    <p><code>context</code> makes requests (<code>context:slot(id):transition{…}</code>, <code>context:squad(id):place{}</code> …). <code>state</code> reads variables. <code>event</code> is the report being handled, in a wait's condition. <code>lib</code> is <code>lib.mission_lib</code> (<code>lib.is_slot(context, event, id)</code>), <code>mission</code> the generated module.</p>
    <p>The sandbox has no <code>pairs</code>, <code>next</code>, <code>print</code>, pattern matching (<code>string.find/match/gsub</code>), <code>math.random</code>, <code>io</code> or <code>os</code>. The checks flag these.</p>
    <p>An unknown argument name in a request is an error in game and faults the whole script. The editor cannot check argument names; test each new node.</p>
    <h4>Campaign mode</h4>
    <p>Action nodes work under a Step or an Encounter and run inside its <code>on_start(context)</code>, so <code>state</code> is not available there. Custom waits and prefabs are free-scene only: lib.campaign fixes the ways a step can end.</p>
    <h4>State</h4>
    <p>Built-in nodes keep no variables on purpose, so two branches can never race. Custom Lua that calls <code>set_variable</code>, <code>start_timer</code> or <code>set_phase</code> is allowed, and the node is tagged "keeps state" so it stands out on the canvas.</p>
    <h4>Packs</h4>
    <p>Export pack saves every custom node here as one file. Import pack adds a file's nodes to this scene, replacing any it already has.</p>`;
  box.append(div);
}

$('b-new-action').onclick = () => { ui.editDef = addCustom(STARTERS.action()).id; changed(); renderNodesView(); };
$('b-new-wait').onclick = () => { ui.editDef = addCustom(STARTERS.wait()).id; changed(); renderNodesView(); };
$('b-pack-out').onclick = () => {
  if (!S.custom.length) { alert('There are no custom nodes to export yet.'); return; }
  download('nodes.pack.json', JSON.stringify({ format: 'sunrise-scenes-nodes', version: 1, nodes: S.custom }, null, 1), 'application/json');
};
$('b-pack-in').onclick = () => $('f-pack').click();
$('f-pack').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const pack = JSON.parse(await f.text());
    if (!pack || pack.format !== 'sunrise-scenes-nodes' || !Array.isArray(pack.nodes)) throw new Error('not a node pack');
    // A pack's ids only mean something in the scene it came from; prefab steps name other
    // pack nodes by id, so remap those as the nodes are added.
    const remap = new Map();
    for (const def of pack.nodes) {
      if (!def || !['action', 'wait', 'prefab'].includes(def.kind) || typeof def.template !== 'string') continue;
      const same = S.custom.find((d) => d.kind === def.kind && d.template === def.template);
      const old = def.id;
      if (same) { Object.assign(same, def, { id: same.id }); remap.set(old, same.id); }
      else remap.set(old, addCustom({ ...def }).id);
    }
    for (const def of S.custom) if (def.kind === 'prefab') for (const b of def.body || []) if (remap.has(b.type) && !customDef(b.type)) b.type = remap.get(b.type);
    setCustom(S.custom); changed(); renderNodesView();
  } catch (x) { alert('Could not import that file: ' + x.message); }
  e.target.value = '';
};
