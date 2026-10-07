// Sockets: the places in a node's sentence that take a named input, and the two ways to
// fill one: dragging an input chip in, or clicking for a searchable list.
import { KINDS, matches, slotTypeName } from '../catalog.js';
import { S, addInput } from '../state.js';
import { $, el, changed, track } from './dom.js';

// element -> { kind, set(id), value }
export const sockets = new WeakMap();

// Looking an input up by id, without scanning the list each time: a freeroam drawing has
// thousands of inputs and as many sockets.
let indexed = null, indexSize = -1; const byId = new Map();
function inputById(id) {
  if (indexed !== S.inputs || indexSize !== S.inputs.length) {
    byId.clear(); for (const i of S.inputs) byId.set(i.id, i);
    indexed = S.inputs; indexSize = S.inputs.length;
  }
  return byId.get(id);
}

// Does this input fit a socket that only takes some slot types? Unknown types get the benefit of the doubt.
const fits = (i, types) => !types || i.kind !== 'Slot' || i.slotType == null || types.includes(i.slotType);
const needs = (types) => types.map(slotTypeName).join(' or ');
export function toast(text) {
  const old = $('toast'); if (old) old.remove();
  const t = el('div', { id: 'toast', textContent: text }); document.body.append(t);
  setTimeout(() => t.remove(), 4500);
}

export function socket(kind, value, set, optional, label, types) {
  const found = value ? inputById(value) : null, i = found && found.kind === kind ? found : null;
  const e = el('span', { class: 'sock k-' + kind + (i ? ' full' : optional ? ' opt' : ' need'), textContent: i ? i.name : label });
  e.dataset.kind = kind;
  const what = types ? needs(types) : kind.toLowerCase();
  e.title = i ? (i.key ? KINDS[kind] + '.' + i.key : 'no key set') + (i.slotType != null ? `\n${slotTypeName(i.slotType)}` : '') : `Drop ${/^[aeiou]/i.test(what) ? 'an' : 'a'} ${what} here, or click to search`;
  if (i && !fits(i, types)) { e.classList.add('wrong'); e.title += `\nThis socket takes ${needs(types)}.`; }
  sockets.set(e, { kind, set, value: i ? i.id : '', types });
  return e;
}

// Carry an input under the cursor and drop it into a socket of its kind. From a socket,
// the input moves: dropping it anywhere else empties the socket it came from.
export function chipDrag(id, source, ev) {
  const i = S.inputs.find((x) => x.id === id); if (!i) return;
  closePicker();
  const ghost = el('span', { class: 'chip ghost k-' + i.kind, textContent: i.name }); document.body.append(ghost);
  document.body.dataset.drag = i.kind;
  // Sockets of the right kind that would refuse this particular slot are dimmed, not lit.
  const dimmed = [...document.querySelectorAll(`.sock[data-kind="${i.kind}"]`)].filter((s) => sockets.has(s) && !fits(i, sockets.get(s).types));
  dimmed.forEach((s) => s.classList.add('nofit'));
  const place = (e) => { ghost.style.left = e.clientX + 10 + 'px'; ghost.style.top = e.clientY + 6 + 'px'; };
  place(ev);
  track(place, (e) => {
    ghost.remove(); delete document.body.dataset.drag; dimmed.forEach((s) => s.classList.remove('nofit'));
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    let target = hit && hit.closest('.sock');
    if (target && (!sockets.has(target) || sockets.get(target).kind !== i.kind)) target = null;
    if (target && !fits(i, sockets.get(target).types)) {
      toast(`"${i.name}" is ${slotTypeName(i.slotType)}; that socket takes ${needs(sockets.get(target).types)}.`);
      return;
    }
    if (!target && !source && hit) {   // dropped on the node itself: take its first free socket of this kind
      const ne = hit.closest('.node');
      if (ne) target = [...ne.querySelectorAll(`.sock:not(.full)[data-kind="${i.kind}"]`)].find((s) => sockets.has(s) && fits(i, sockets.get(s).types)) || null;
    }
    if (target === source) return;
    if (target) sockets.get(target).set(id);
    if (source) sockets.get(source).set('');
    if (target || source) changed('nodes');
  });
}

// Click a socket: a small searchable list of the inputs that fit it.
export function closePicker() { const p = $('picker'); if (p) p.remove(); }
export function openPicker(sock) {
  closePicker();
  const info = sockets.get(sock), r = sock.getBoundingClientRect(), kind = info.kind;
  const q = el('input', { type: 'text', placeholder: `find a ${kind.toLowerCase()}…` }), list = el('div', { class: 'plist' });
  const box = el('div', { id: 'picker' }, q, list);
  const done = (v, all) => { closePicker(); info.set(v); changed(all ? 'all' : 'nodes'); };
  let first = null;
  const item = (label, sub, fn) => {
    const d = el('div', { class: 'pitem', onclick: fn }, el('span', { class: sub === undefined ? '' : 'chip k-' + kind, textContent: label }), sub ? el('small', { textContent: sub }) : null);
    list.append(d); return d;
  };
  const fill = () => {
    list.replaceChildren(); first = null;
    const t = q.value.trim().toLowerCase(); let shown = 0, hidden = 0;
    for (const i of S.inputs) {
      if (i.kind !== kind || !matches(i, t)) continue;
      if (!fits(i, info.types)) { hidden++; continue; }
      if (shown++ >= 80) break;
      const d = item(i.name, i.key, () => done(i.id));
      if (!first) { first = () => done(i.id); d.classList.add('first'); }
    }
    const fresh = t.replace(/[^a-z0-9_]+/g, '_');
    const make = () => done(addInput(kind, fresh || undefined).id, true);
    item(`+ new ${kind.toLowerCase()}${fresh ? ' "' + fresh + '"' : ''}`, undefined, make);
    if (!first) first = make;
    if (info.value) item('✕ empty this socket', undefined, () => done(''));
    if (hidden) list.append(el('div', { class: 'pnote', textContent: `${hidden} slot${hidden === 1 ? '' : 's'} of other types not shown: this socket takes ${needs(info.types)}.` }));
  };
  q.addEventListener('input', fill);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && first) first(); if (e.key === 'Escape') closePicker(); });
  document.body.append(box); fill();
  box.style.left = Math.min(r.left, innerWidth - 260) + 'px';
  box.style.top = (r.bottom + 4 + box.offsetHeight > innerHeight ? Math.max(4, r.top - box.offsetHeight - 4) : r.bottom + 4) + 'px';
  q.focus();
}
addEventListener('pointerdown', (ev) => { const p = $('picker'); if (p && !p.contains(ev.target)) closePicker(); }, true);
