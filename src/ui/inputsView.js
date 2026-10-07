// The Inputs screen: every input in a table, and a browser over a loaded SDK module.
import { KINDS, KIND_HINT, VALID_KEY, grouped, matches, slotTypeName } from '../catalog.js';
import { S, addInput, stampSlotTypes } from '../state.js';
import { parseSdk } from '../sdk.js';
import { $, el, ui, changed, go } from './dom.js';

export function renderInputsView(focusId) {
  const box = $('in-table'), q = $('iv-search').value.trim().toLowerCase(); box.replaceChildren();
  // Count every use once; with thousands of inputs, searching per row would crawl.
  const uses = new Map();
  for (const m of JSON.stringify([S.nodes, S.graphs, S.meta.initial]).matchAll(/"(i\d+)"/g)) uses.set(m[1], (uses.get(m[1]) || 0) + 1);
  const groups = grouped(S.inputs.filter((i) => matches(i, q)));
  if (!S.inputs.length) box.append(el('div', { class: 'note', textContent: 'No inputs yet. Add one with the buttons above, or load a mission module on the right and add its keys.' }));
  let shown = 0, total = 0;
  for (const [label, kind, list] of groups) {
    total += list.length;
    if (shown >= 400) continue;
    box.append(el('h3', { class: 'k-' + kind }, el('span', { class: 'dot' }), label, el('small', { textContent: `${list.length} · ${KINDS[kind]}` })));
    for (const i of list) { if (shown >= 400) break; shown++; box.append(inputRow(i, uses.get(i.id) || 0)); }
  }
  if (total > shown) box.append(el('div', { class: 'note', textContent: `Showing ${shown} of ${total}. Search to narrow.` }));
  renderSdk();
  const row = focusId && box.querySelector(`[data-id="${focusId}"]`);
  if (row) { row.scrollIntoView({ block: 'center' }); row.querySelector('.key').focus(); }
}
function inputRow(i, uses) {
  const row = el('div', { class: 'irow k-' + i.kind + (VALID_KEY.test(i.key) ? '' : ' bad') }); row.dataset.id = i.id;
  const name = el('input', { type: 'text', class: 'name', value: i.name, title: 'The name nodes show for this input',
    oninput: () => { name.value = i.name = name.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^([0-9])/, '_$1'); changed(); } });
  const kind = el('select', { onchange: () => { i.kind = kind.value; changed('all'); } });
  for (const k in KINDS) kind.append(el('option', { value: k, textContent: k }));
  kind.value = i.kind;
  const key = el('input', { type: 'text', class: 'key', value: i.key, placeholder: KIND_HINT[i.kind], title: KINDS[i.kind] + '.<key>',
    oninput: () => {
      i.key = key.value = key.value.trim(); row.classList.toggle('bad', !VALID_KEY.test(i.key)); suggest(key, i.kind);
      // A slot's type comes from the SDK entry of its key; a new key means a new type (or none known).
      const known = i.kind === 'Slot' && ui.sdkKeys.find((k) => k.kind === 'Slot' && k.key === i.key);
      if (known && known.type != null) i.slotType = known.type; else delete i.slotType;
      changed();
    } });
  key.setAttribute('list', 'keys');
  key.addEventListener('focus', () => suggest(key, i.kind));
  row.append(name, kind, key, el('small', { textContent: (uses ? `used ${uses}×` : 'unused'), title: i.slotType != null ? 'This slot is ' + slotTypeName(i.slotType) + ' (type ' + i.slotType + ').' : '' }),
    el('button', { textContent: '✕', title: 'Remove input', onclick: () => { S.inputs = S.inputs.filter((x) => x !== i); changed('all'); } }));
  return row;
}
// Fill the shared datalist with the closest SDK keys of this kind for what is typed so far.
function suggest(input, kind) {
  const list = $('keys'); list.replaceChildren();
  const q = input.value.toUpperCase(); let n = 0;
  for (const k of ui.sdkKeys) { if (k.kind === kind && k.key.includes(q)) { list.append(el('option', { value: k.key })); if (++n >= 60) break; } }
}

// The keys of a loaded mission module, each one click away from being an input.
function renderSdk() {
  const box = $('sdk-list'), q = $('sdk-search').value.trim().toUpperCase(), only = $('sdk-kind').value; box.replaceChildren();
  if (!ui.sdkKeys.length) { box.append(el('div', { class: 'note', textContent: 'Load the generated module for your scenario (Sunrise/sdk/lua/missions/<name>.lua) to browse its states, slots, squads, scenes, goals and lines here and add them with one click.' })); return; }
  const have = new Set(S.inputs.map((i) => i.kind + ':' + i.key));
  let shown = 0, total = 0;
  for (const k of ui.sdkKeys) {
    if ((only && k.kind !== only) || !k.key.includes(q)) continue;
    total++; if (shown >= 300) continue; shown++;
    const taken = have.has(k.kind + ':' + k.key);
    box.append(el('div', { class: 'srow k-' + k.kind }, el('span', { textContent: k.key, title: k.key }), el('i', { textContent: k.type != null ? slotTypeName(k.type) : k.kind }),
      el('button', { textContent: taken ? 'added' : '+ add', disabled: taken, onclick: () => {
        addInput(k.kind, k.key.split('.').pop().toLowerCase().replace(/^([0-9])/, '_$1'), k.key, k.type); changed('all');
      } })));
  }
  box.append(el('div', { class: 'note', textContent: total > shown ? `Showing ${shown} of ${total}. Search to narrow.` : `${total} key${total === 1 ? '' : 's'}.` }));
}

$('iv-search').addEventListener('input', () => renderInputsView());
$('sdk-search').addEventListener('input', renderSdk);
$('sdk-kind').addEventListener('change', renderSdk);
$('sdk-kind').append(el('option', { value: '', textContent: 'All kinds' }));
for (const k in KINDS) {
  $('sdk-kind').append(el('option', { value: k, textContent: k }));
  $('iv-add').append(el('button', { textContent: '+ ' + k, title: `Add a ${KINDS[k]} input`, onclick: () => go('inputs', addInput(k).id) }), ' ');
}
$('b-sdk').onclick = () => $('f-sdk').click();
$('f-sdk').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const parsed = parseSdk(await f.text());
  ui.sdkKeys = parsed.keys; e.target.value = '';
  stampSlotTypes(ui.sdkKeys); changed('all');
  if (ui.sdkKeys.length && !parsed.known) $('sdk-list').prepend(el('div', { class: 'note', textContent: 'This file did not look like a mission module, so kinds are guessed from name prefixes. Check each one after adding.' }));
};
