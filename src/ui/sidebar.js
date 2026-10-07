// The editor's left column: inputs as draggable chips in groups, and the node palette.
import { T, KINDS, VALID_KEY, allTypes, fits, grouped, matches } from '../catalog.js';
import { S, save, addNode, onFlowTab } from '../state.js';
import { $, el, ui, go, pressThenDrag } from './dom.js';
import { chipDrag } from './sockets.js';
import { renderNodes, startDrag, toWs } from './canvas.js';

export function renderSide() {
  const box = $('side'), q = $('side-search').value.trim().toLowerCase(); box.replaceChildren();
  const groups = grouped(S.inputs.filter((i) => matches(i, q)));
  if (!groups.length) box.append(el('div', { id: 'side-empty', textContent: S.inputs.length ? 'Nothing matches.' : 'No inputs yet. Open Manage… to add doors, squads, triggers and goals.' }));
  for (const [label, kind, list] of groups) {
    const shut = !q && S.collapsed.includes(label);
    box.append(el('div', { class: 'grp k-' + kind, onclick: () => { S.collapsed = shut ? S.collapsed.filter((x) => x !== label) : S.collapsed.concat(label); save(); renderSide(); } },
      el('span', { textContent: shut ? '▸' : '▾' }), el('span', { class: 'dot' }), label, el('small', { textContent: list.length })));
    if (shut) continue;
    const chips = el('div', { class: 'chips' });
    for (const i of list.slice(0, 120)) {
      const chip = el('span', { class: 'chip k-' + i.kind + (VALID_KEY.test(i.key) ? '' : ' nokey'), textContent: i.name, title: (i.key ? KINDS[i.kind] + '.' + i.key : 'no key set') + '\nDrag into a node. Double-click to edit.' });
      chip.addEventListener('pointerdown', (ev) => { ev.preventDefault(); pressThenDrag(ev, (e) => chipDrag(i.id, null, e), () => {}); });
      chip.addEventListener('dblclick', () => go('inputs', i.id));
      chips.append(chip);
    }
    if (list.length > 120) chips.append(el('span', { class: 'more', textContent: `… ${list.length - 120} more. Search to narrow.` }));
    box.append(chips);
  }
}
$('side-search').addEventListener('input', renderSide);

// A node type as it reads in the palette: its sentence with the sockets named.
export function paletteLabel(type) {
  return T(type).parts.map((p) => (p.text != null ? p.text : p.kind === 'enum' ? p.options[0].replace(/_/g, ' ') + '/…' : p.kind === 'flag' ? '' : p.kind === 'code' ? '…' : '[' + p.name + ']'))
    .join('').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());
}
export function renderPalette() {
  const box = $('palette'), mode = S.meta.mode; box.replaceChildren();
  let customHead = false;
  for (const type of allTypes()) {
    if (!fits(type, mode, onFlowTab())) continue;
    const t = T(type), label = paletteLabel(type);
    if (t.custom && !customHead) { customHead = true; box.append(el('div', { class: 'pal-head', textContent: 'Your nodes' })); }
    const item = el('div', { class: `pal g-${t.g}`, textContent: label.length > 60 ? label.slice(0, 58) + '…' : label, title: label });
    item.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const at = toWs(ev), n = addNode(type, at.x - 20, at.y - 14);
      ui.selected = n.id; renderNodes(); startDrag(n, ev, true);
    });
    box.append(item);
  }
}
