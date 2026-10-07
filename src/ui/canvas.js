// The canvas: nodes as sentences, stacks, lines, panning and zooming.
import { T, GROUPS, canIn, canOut } from '../catalog.js';
import { S, node, parentOf, chain, removeNode, copyNodes, pasteNodes, makePrefab, unpackPrefab, tabsOf, setTab, addSceneTab, removeTab, activeTab, onFlowTab } from '../state.js';
import { $, el, ui, changed, go, track, pressThenDrag } from './dom.js';
import { socket, sockets, chipDrag, openPicker, toast } from './sockets.js';
import { persist } from '../desktop.js';

const ws = $('ws'), canvas = $('canvas'), wg = $('wg');
export const els = new Map();   // node id -> element
const FOLD_OVER = 8, FOLD_TO = 6;
const unfolded = new Set();     // "node id:param" of long lists the user opened

// A dropdown over a list of {value, label}; used for picks that are not inputs.
function choice(options, value, onpick, placeholder, optional) {
  const s = el('select', { class: optional ? 'opt' : '' });
  s.append(el('option', { value: '', textContent: placeholder }));
  for (const o of options) s.append(el('option', { value: o.value, textContent: o.label }));
  const valid = options.some((o) => String(o.value) === String(value));
  s.value = valid ? value : ''; s.classList.toggle('empty', !valid);
  s.addEventListener('change', () => { onpick(s.value); changed('nodes'); });
  return s;
}

// The control for one parameter of a node's sentence.
function paramControl(n, p) {
  const P = n.params;
  if (p.kind === 'enum') {
    const s = el('select', { onchange: () => { P[p.name] = s.value; changed(); } });
    for (const o of p.options) s.append(el('option', { value: o, textContent: o.replace(/_/g, ' ') }));
    s.value = P[p.name]; return s;
  }
  if (p.kind === 'num') {
    const i = el('input', { type: 'number', min: 0, step: 'any', value: P[p.name], oninput: () => { P[p.name] = parseFloat(i.value); changed(); } });
    return i;
  }
  if (p.kind === 'id' || p.kind === 'text') {
    const i = el('input', { type: 'text', value: P[p.name] || '', placeholder: p.kind === 'id' ? p.name : 'none' });
    // Names can be long (t_cabal_5_and_6_dead); the box grows with what is typed.
    const fit = () => { i.style.width = Math.max(p.kind === 'id' ? 64 : 90, i.value.length * 7.4 + 18) + 'px'; };
    fit();
    i.addEventListener('input', () => {
      P[p.name] = i.value = p.kind === 'id' ? i.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_') : i.value.trim(); fit();
      // Other nodes name this one in their dropdowns; keep those labels current without a redraw.
      for (const o of ws.querySelectorAll(`select.noderef option[value="${n.id}"]`)) o.textContent = P.id || '(unnamed)';
      changed();
    });
    return i;
  }
  if (p.kind === 'code') {
    const t = el('textarea', { value: P[p.name] || '', spellcheck: false, placeholder: '-- Lua. context is available; name inputs as input.their_name' });
    t.addEventListener('input', () => { P[p.name] = t.value; changed(); });
    return t;
  }
  if (p.kind === 'flag') {
    const c = el('input', { type: 'checkbox', checked: !!P[p.name], onchange: () => { P[p.name] = c.checked; changed(); } });
    const tip = { barrier: 'A later step\'s trigger or leg must not skip this step', revisit: 'The end trigger was already crossed earlier; arm it again when this step starts' }[p.name] || '';
    return el('label', { class: 'flag', title: tip }, c, ' ' + p.name);
  }
  if (p.kind === 'node' && p.ref === 'tab') {   // a pick among the scenes (the tabs other than Flow)
    const options = S.mission.tabs.filter((t) => t.id !== 'flow').map((t) => ({ value: t.id, label: t.name }));
    return choice(options, P[p.name], (v) => { P[p.name] = v; }, 'pick scene…');
  }
  if (p.kind === 'node') {   // a pick among the Leg or Encounter nodes on the canvas
    const options = S.nodes.filter((m) => m.type === p.ref).map((m) => ({ value: m.id, label: m.params.id || '(unnamed)' }));
    const noun = p.ref === 'c_enc' ? 'encounter' : 'leg';
    const one = (value, onpick, placeholder, optional) => { const s = choice(options, value, (v) => onpick(v ? +v : ''), placeholder, optional); s.classList.add('noderef'); return s; };
    if (!p.list) return one(P[p.name], (v) => { P[p.name] = v; }, `pick ${noun}…`);
    const list = P[p.name] || (P[p.name] = []), span = el('span');
    list.forEach((id, idx) => span.append(one(id, (v) => { if (v) list[idx] = v; else list.splice(idx, 1); }, '(remove)', true), idx < list.length - 1 ? ', ' : ' '));
    span.append(one('', (v) => { if (v) list.push(v); }, list.length ? '+ and…' : `pick ${noun}…`, list.length > 0));
    return span;
  }
  if (p.list) {
    // A long list (a zone can patrol a hundred squads) shows its first few until asked for the rest.
    const list = P[p.name] || (P[p.name] = []), span = el('span'), key = n.id + ':' + p.name;
    const folded = list.length > FOLD_OVER && !unfolded.has(key), shown = folded ? FOLD_TO : list.length;
    for (let idx = 0; idx < shown; idx++) span.append(socket(p.ref, list[idx], (v) => { if (v) list[idx] = v; else list.splice(idx, 1); }, true, '?', p.types), ' ');
    if (folded) span.append(el('span', { class: 'more-socks', textContent: `+${list.length - FOLD_TO} more`, onclick: () => { unfolded.add(key); changed('nodes'); } }), ' ');
    else if (list.length > FOLD_OVER) span.append(el('span', { class: 'more-socks', textContent: 'show fewer', onclick: () => { unfolded.delete(key); changed('nodes'); } }), ' ');
    span.append(socket(p.ref, '', (v) => { if (v) list.push(v); }, p.optional || list.length > 0, list.length ? '+' : p.name, p.types));
    return span;
  }
  return socket(p.ref, P[p.name], (v) => { P[p.name] = v; }, p.optional, p.name, p.types);
}

// A node's element: its tag line and its sentence. Also used for the preview on the Nodes screen.
export function nodeElement(n) {
  const type = T(n.type), sent = el('div', { class: 'sent' });
  for (const p of type.parts) sent.append(p.text != null ? p.text : paramControl(n, p));
  return el('div', { class: `node g-${type.g}` }, type.tag ? el('span', { class: 'tag', textContent: type.tag }) : null, sent);
}

export function renderNodes() {
  for (const e of els.values()) e.remove(); els.clear();
  const mode = S.meta.mode, sel = picked();
  for (const n of S.nodes) {
    const e = nodeElement(n);
    e.append(el('button', { class: 'del', textContent: '✕', title: 'Delete node', onclick: () => { removeNode(n.id); ui.picked.delete(n.id); if (ui.selected === n.id) ui.selected = [...ui.picked][0] ?? null; changed('nodes'); } }));
    if (canIn(n.type, mode)) e.append(el('span', { class: 'port in' }));
    if (canOut(n.type, mode)) e.append(el('span', { class: 'port out', title: mode === 'campaign' ? 'Drag onto an Encounter to spawn it once this step has started' : 'Drag onto a node to start it when this one finishes' }));
    e.dataset.id = n.id;
    e.classList.toggle('sel', sel.has(n.id));
    ws.append(e); els.set(n.id, e);
  }
  layout(); drawWires(); syncTools(); renderTabs();
}

// Mission mode's tab strip: Flow, then a tab per scene. The scene on screen can be renamed,
// tagged with the leg it happens in, or removed.
let badTabs = new Set();
export function markBadTabs(ids) { badTabs = ids; for (const e of $('tabs').querySelectorAll('.tab')) e.classList.toggle('bad', badTabs.has(e.dataset.tab)); }
function renderTabs() {
  const bar = $('tabs'), mission = S.meta.mode === 'mission';
  bar.hidden = !mission; ws.style.marginTop = mission ? '34px' : '0';
  if (!mission) return;
  bar.replaceChildren();
  const legs = (tabsOf(S).find((t) => t.id === 'flow').nodes || []).filter((n) => n.type === 'm_leg');
  for (const t of S.mission.tabs) {
    const leg = legs.find((l) => l.id === t.leg);
    const e = el('span', { class: 'tab' + (t.id === S.mission.active ? ' on' : '') + (badTabs.has(t.id) ? ' bad' : ''), title: t.id === 'flow' ? 'The mission flow: legs and steps' : 'Scene',
      onclick: () => { setTab(t.id); ui.selected = null; resetView(); changed('all'); } }, t.name, leg ? el('small', { textContent: leg.params.id }) : null);
    e.dataset.tab = t.id; bar.append(e);
  }
  bar.append(el('button', { textContent: '+ scene', title: 'Add a scene: a drawn performance a step can run', onclick: () => { const t = addSceneTab('scene'); setTab(t.id); ui.selected = null; resetView(); changed('all'); } }));
  if (onFlowTab()) return;
  const t = activeTab(), tools = el('span', { class: 'tools' });
  const name = el('input', { type: 'text', value: t.name, title: 'Scene name' });
  name.addEventListener('input', () => { t.name = name.value = name.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_'); bar.querySelector('.tab.on').firstChild.textContent = t.name; changed(); });
  const where = el('select', { title: 'The leg this scene happens in. It then waits until the player is there, so its triggers and squads exist.', onchange: () => { t.leg = where.value ? +where.value : ''; changed('nodes'); } });
  where.append(el('option', { value: '', textContent: 'any leg' }));
  for (const l of legs) where.append(el('option', { value: l.id, textContent: 'in leg ' + (l.params.id || '?') }));
  where.value = legs.some((l) => l.id === t.leg) ? t.leg : '';
  tools.append('Scene ', name, where, el('button', { textContent: 'Remove scene', onclick: () => { if (confirm(`Remove scene "${t.name}" and everything on it?`)) { removeTab(t.id); ui.selected = null; resetView(); changed('all'); } } }));
  bar.append(tools);
}
// Position every stack: a node sits directly under the one it is snapped to.
function layout(only) {
  const roots = only ? [only] : S.nodes.filter((n) => !parentOf(n.id));
  for (const r of roots) {
    let y = r.y;
    chain(r).forEach((n, idx, all) => {
      const e = els.get(n.id); n.x = r.x; n.y = y;
      e.style.left = n.x + 'px'; e.style.top = n.y + 'px';
      e.classList.toggle('stacked', idx > 0);
      e.classList.toggle('hasnext', idx < all.length - 1);
      y += e.offsetHeight - 1;
    });
  }
}
// Where a line leaves a node (bottom) or enters one (top), and the node's right edge for routing round it.
const PORT_X = 27;
function port(n, side) {
  const e = els.get(n.id);
  return { x: n.x + PORT_X, y: n.y + (side === 'out' ? e.offsetHeight + 4 : -5), right: n.x + e.offsetWidth };
}
// A path through the points with rounded corners.
function rounded(pts, r) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
    const a = Math.min(r, Math.hypot(x - px, y - py) / 2), b = Math.min(r, Math.hypot(nx - x, ny - y) / 2);
    const ux = Math.sign(x - px), uy = Math.sign(y - py), vx = Math.sign(nx - x), vy = Math.sign(ny - y);
    d += ` L${x - ux * a} ${y - uy * a} Q${x} ${y} ${x + vx * b} ${y + vy * b}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last[0]} ${last[1]}`;
}
// Down out of the source, across, and down into the target; round the side when the target is not below.
const curve = (a, b) => {
  if (b.y >= a.y + 24) { const my = a.y + 12; return rounded([[a.x, a.y], [a.x, my], [b.x, my], [b.x, b.y]], 8); }
  const side = Math.max(a.right || a.x, b.right || b.x) + 26;
  return rounded([[a.x, a.y], [a.x, a.y + 12], [side, a.y + 12], [side, b.y - 14], [b.x, b.y - 14], [b.x, b.y]], 8);
};
function drawWires(tmp) {
  wg.replaceChildren();
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (cls, d) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('class', cls); p.setAttribute('d', d); return p; };
  for (const w of S.wires) {
    const a = node(w.from), b = node(w.to); if (!a || !b) continue;
    const d = curve(port(a, 'out'), port(b, 'in')), g = document.createElementNS(NS, 'g');
    const line = mk('w', d); line.setAttribute('marker-end', 'url(#arr)');
    const hit = mk('hit', d); hit.addEventListener('click', () => { S.wires = S.wires.filter((x) => x !== w); changed('nodes'); });
    const title = document.createElementNS(NS, 'title'); title.textContent = 'Click to remove this line'; hit.append(title);
    g.append(line, hit); wg.append(g);
  }
  if (tmp) wg.append(mk('w tmp', curve(tmp.a, tmp.b)));
}
export function markBad(bad) { for (const [id, e] of els) e.classList.toggle('bad', bad.has(id)); }

// ---- view: pan and zoom
export function applyPan() {
  const { pan, zoom } = ui;
  ws.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  canvas.style.backgroundPosition = `${pan.x}px ${pan.y}px`; canvas.style.backgroundSize = `${20 * zoom}px ${20 * zoom}px`;
  $('z-pct').textContent = Math.round(zoom * 100) + '%';
  persist();   // where you were looking is part of the saved workspace
}
// Lay a campaign's stacks out in columns by their real sizes: setup, story, then encounters.
// Used after reading a script in, when positions are only estimates.
export function tidy() {
  const heads = S.nodes.filter((n) => !parentOf(n.id));
  const size = (h) => { const c = chain(h).map((n) => els.get(n.id)); return { w: Math.max(...c.map((e) => e.offsetWidth)), h: c.reduce((a, e) => a + e.offsetHeight - 1, 0) }; };
  if (S.meta.mode === 'freeroam') {   // zones in rows of four, each row as tall as its tallest stack
    let x = 40, y = 30, rowH = 0;
    heads.forEach((h, i) => {
      if (i && i % 4 === 0) { x = 40; y += rowH + 40; rowH = 0; }
      const s = size(h); h.x = x; h.y = y; x += s.w + 50; rowH = Math.max(rowH, s.h);
    });
    return;
  }
  const of = (type) => heads.filter((n) => n.type === type);
  let x = 40;
  for (const h of [...of('c_setup'), ...of('c_story')]) { h.x = x; h.y = 30; x += size(h).w + 70; }
  let y = 30;
  for (const h of heads.filter((n) => n.type !== 'c_setup' && n.type !== 'c_story')) { h.x = x; h.y = y; y += size(h).h + 28; }
}
export function reveal(id) { const n = node(id); ui.pan.x = 80 - n.x * ui.zoom; ui.pan.y = 120 - n.y * ui.zoom; applyPan(); }
export function resetView() { ui.pan = { x: 0, y: 0 }; ui.zoom = 1; applyPan(); }
// Zoom by a factor, keeping the point under the cursor (or the centre of the canvas) still.
const ZOOM_MIN = 0.2, ZOOM_MAX = 1.5;
function zoomBy(factor, clientX, clientY) {
  const r = canvas.getBoundingClientRect(), pan = ui.pan;
  const mx = clientX == null ? r.width / 2 : clientX - r.left, my = clientY == null ? r.height / 2 : clientY - r.top;
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, ui.zoom * factor)), k = z / ui.zoom;
  pan.x = mx - (mx - pan.x) * k; pan.y = my - (my - pan.y) * k; ui.zoom = z; applyPan();
}
function zoomFit() {
  if (!S.nodes.length) { resetView(); return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of S.nodes) { const e = els.get(n.id); x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + e.offsetWidth); y1 = Math.max(y1, n.y + e.offsetHeight); }
  const r = canvas.getBoundingClientRect(), m = 40;
  ui.zoom = Math.min(1, Math.max(ZOOM_MIN, Math.min((r.width - 2 * m) / (x1 - x0), (r.height - 2 * m) / (y1 - y0))));
  ui.pan.x = (r.width - (x1 - x0) * ui.zoom) / 2 - x0 * ui.zoom; ui.pan.y = (r.height - (y1 - y0) * ui.zoom) / 2 - y0 * ui.zoom; applyPan();
}
export const toWs = (ev) => { const r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left - ui.pan.x) / ui.zoom, y: (ev.clientY - r.top - ui.pan.y) / ui.zoom }; };

// ---- selection: one node or several, highlighted; copied, pasted, moved and deleted together
// ui.selected is the node the single-node tools act on; ui.picked is everything highlighted.
// Other screens only ever set ui.selected, so the set is brought back in step with it here.
function picked() {
  if (ui.selected != null && !node(ui.selected)) ui.selected = null;
  if (ui.selected == null) ui.picked.clear();
  else if (!ui.picked.has(ui.selected)) ui.picked = new Set([ui.selected]);
  for (const id of ui.picked) if (!node(id)) ui.picked.delete(id);
  return ui.picked;
}
function pick(ids, primary) {
  ui.picked = new Set(ids); ui.selected = ui.picked.size ? (primary != null && ui.picked.has(primary) ? primary : [...ui.picked][0]) : null;
  for (const [nid, e] of els) e.classList.toggle('sel', ui.picked.has(nid));
  syncTools();
}
const select = (id) => pick(id == null ? [] : [id], id);
function toggle(id) { const s = new Set(picked()); if (!s.delete(id)) s.add(id); pick(s, s.has(id) ? id : null); }
let clip = null, pointer = null, pastes = 0;   // what was copied; where the pointer last was on the canvas; pastes since it moved
function syncTools() {
  const many = picked().size > 1, n = !many && ui.selected != null && node(ui.selected), def = n && T(n.type).custom;
  const prefab = !!def && def.kind === 'prefab';
  $('b-prefab').hidden = !n || !(S.meta.mode === 'scene' || (S.meta.mode === 'mission' && !onFlowTab())) || prefab || !!T(n.type).head;
  $('b-unpack').hidden = !prefab;
  $('b-copy-nodes').hidden = !ui.picked.size; $('b-copy-nodes').textContent = ui.picked.size > 1 ? `Copy ${ui.picked.size}` : 'Copy';
  $('b-paste-nodes').hidden = !clip;
}
function copyPicked() {
  if (!picked().size) return false;
  clip = copyNodes([...ui.picked]); pastes = 0; syncTools(); return true;
}
function removePicked() { for (const id of [...picked()]) removeNode(id); pick([]); changed('nodes'); }
// Paste where the pointer is (or in the middle of the view), stepping aside on each repeat.
function pasteClip() {
  if (!clip) return;
  const r = canvas.getBoundingClientRect(), step = 24 * pastes++;
  const at = pointer || { x: (r.width / 2 - ui.pan.x) / ui.zoom - 80, y: (r.height / 3 - ui.pan.y) / ui.zoom };
  const made = pasteNodes(clip, { x: at.x + step, y: at.y + step });
  if (made.skipped) toast(made.ids.length ? `${made.skipped} of the copied nodes do not belong on this canvas and were left out.` : 'None of the copied nodes belong on this canvas.');
  if (!made.ids.length) return;
  ui.picked = new Set(made.ids); ui.selected = made.ids[0];
  changed('all');   // pasting can add inputs, so the side list is redrawn too
}
// Drag a box on the background (with Shift held) to highlight every node it touches.
function startMarquee(ev, keep) {
  const a = toWs(ev), box = el('div', { class: 'marquee' }); ws.append(box);
  const inside = (b) => {
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    Object.assign(box.style, { left: x0 + 'px', top: y0 + 'px', width: x1 - x0 + 'px', height: y1 - y0 + 'px' });
    const hit = new Set(keep);
    for (const n of S.nodes) { const e = els.get(n.id); if (n.x < x1 && n.x + e.offsetWidth > x0 && n.y < y1 && n.y + e.offsetHeight > y0) hit.add(n.id); }
    return hit;
  };
  track((e) => { const hit = inside(toWs(e)); for (const [nid, ne] of els) ne.classList.toggle('sel', hit.has(nid)); }, (e) => { const hit = inside(toWs(e)); box.remove(); pick(hit, ui.selected); });
}
// Move every stack that holds a highlighted node, keeping them as they are to each other.
// A press that never moves is a plain click: it narrows the highlight to that one node.
function startGroupDrag(n, ev) {
  const start = toWs(ev), heads = new Map(); let moved = false;
  for (const id of ui.picked) { let h = node(id); for (let p = parentOf(h.id); p; p = parentOf(h.id)) h = p; heads.set(h.id, { h, x: h.x, y: h.y }); }
  track((e) => {
    const at = toWs(e), dx = at.x - start.x, dy = at.y - start.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    moved = true;
    for (const { h, x, y } of heads.values()) { h.x = x + dx; h.y = y + dy; layout(h); }
    drawWires();
  }, () => { if (moved) changed('nodes'); else select(n.id); });
}

// ---- dragging
// Drag a node (and everything stacked under it). Dropping it just below another node snaps it on.
export function startDrag(n, ev, fresh) {
  const start = toWs(ev), ox = n.x, oy = n.y; let moved = !!fresh, target = null, group = null;
  const lift = () => {
    const p = parentOf(n.id); if (p) p.next = null;
    group = chain(n); group.forEach((g) => els.get(g.id).classList.add('drag'));
    if (p) layout();
  };
  if (fresh) lift();
  track((e) => {
    const at = toWs(e);
    if (!moved) { if (Math.abs(at.x - start.x) + Math.abs(at.y - start.y) < 5) return; moved = true; lift(); }
    n.x = ox + at.x - start.x; n.y = oy + at.y - start.y; layout(n);
    if (target) els.get(target.id).classList.remove('snap');
    target = null;
    if (!T(n.type).head) for (const t of S.nodes) {
      if (group.includes(t) || T(t.type).noNext) continue;
      const te = els.get(t.id);
      if (Math.abs(n.x - t.x) < 40 && Math.abs(n.y - (t.y + te.offsetHeight)) < 22) { target = t; break; }
    }
    if (target) els.get(target.id).classList.add('snap');
    drawWires();
  }, (e) => {
    if (!moved) return;
    if (target) {
      const tail = group[group.length - 1];
      if (!T(tail.type).noNext || target.next == null) { if (target.next != null) tail.next = target.next; target.next = n.id; }
    } else if (fresh && !canvas.contains(document.elementFromPoint(e.clientX, e.clientY))) {
      n.x = (60 - ui.pan.x) / ui.zoom; n.y = (60 - ui.pan.y) / ui.zoom;   // dropped outside the canvas: park it in view
    }
    changed('nodes');
  });
}

// Drag a line from a node's right dot onto another node.
function startWire(n, ev) {
  const a = port(n, 'out'), mode = S.meta.mode;
  track((e) => drawWires({ a, b: toWs(e) }), (e) => {
    const hit = document.elementFromPoint(e.clientX, e.clientY), te = hit && hit.closest('.node');
    const t = te && node(+te.dataset.id);
    if (t && t.id !== n.id && canIn(t.type, mode) && n.next !== t.id && !S.wires.some((w) => w.from === n.id && w.to === t.id)) {
      if (mode === 'campaign') S.wires = S.wires.filter((w) => w.to !== t.id);   // an encounter follows one step
      S.wires.push({ from: n.id, to: t.id });
    }
    changed('nodes');
  });
}

canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || ev.target.closest('#zoom')) return;
  const ne = ev.target.closest('.node');
  if (!ne) {   // background: pan, or with Shift held draw a box round nodes
    if (ev.target.closest('path')) return;
    if (ev.shiftKey) { ev.preventDefault(); startMarquee(ev, ev.ctrlKey || ev.metaKey ? [...picked()] : []); return; }
    if (ui.selected != null) select(null);
    const sx = ev.clientX - ui.pan.x, sy = ev.clientY - ui.pan.y;
    track((e) => { ui.pan.x = e.clientX - sx; ui.pan.y = e.clientY - sy; applyPan(); }, () => {});
    return;
  }
  const n = node(+ne.dataset.id), sock = ev.target.closest('.sock');
  if (sock) {
    ev.preventDefault();
    const info = sockets.get(sock);
    pressThenDrag(ev, (e) => { if (info.value) chipDrag(info.value, sock, e); }, () => openPicker(sock));
    return;
  }
  if (ev.target.closest('.port.out')) { ev.preventDefault(); startWire(n, ev); return; }
  if (ev.target.closest('select, input, button, label, textarea, .more-socks')) return;
  ev.preventDefault(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (ev.shiftKey || ev.ctrlKey || ev.metaKey) { toggle(n.id); return; }   // add to, or take out of, the highlight
  if (picked().size > 1 && ui.picked.has(n.id)) { startGroupDrag(n, ev); return; }
  select(n.id);
  startDrag(n, ev);
});
// The wheel scrolls; with Ctrl (or a trackpad pinch) it zooms around the cursor.
canvas.addEventListener('wheel', (ev) => {
  if (ev.target.closest('textarea')) return;
  ev.preventDefault();
  if (ev.ctrlKey || ev.metaKey) zoomBy(Math.exp(-ev.deltaY * 0.002), ev.clientX, ev.clientY);
  else { ui.pan.x -= ev.deltaX; ui.pan.y -= ev.deltaY; applyPan(); }
}, { passive: false });
$('z-out').onclick = () => zoomBy(1 / 1.25);
$('z-in').onclick = () => zoomBy(1.25);
$('z-fit').onclick = zoomFit;
$('z-pct').ondblclick = () => zoomBy(1 / ui.zoom);
$('b-prefab').onclick = () => {
  const made = makePrefab(ui.selected);
  if (typeof made === 'string') { alert(made); return; }
  ui.selected = made.node.id;
  go('nodes', made.def.id);   // name it and word its sentence straight away
};
$('b-unpack').onclick = () => { const first = unpackPrefab(ui.selected); ui.selected = first ? first.id : null; changed('nodes'); };
$('b-copy-nodes').onclick = copyPicked;
$('b-paste-nodes').onclick = () => { pointer = null; pasteClip(); };   // the pointer is on the button, so paste mid-view
canvas.addEventListener('pointermove', (ev) => { if (!ev.target.closest('#zoom')) { pointer = toWs(ev); pastes = 0; } });
canvas.addEventListener('pointerleave', () => { pointer = null; });
addEventListener('keydown', (ev) => {
  // Only on the canvas, and never while typing or while text on the page is selected.
  if (ui.view !== 'editor' || $('ws').offsetParent === null || ev.target.closest('input, select, textarea')) return;
  const key = ev.key.toLowerCase(), cmd = ev.ctrlKey || ev.metaKey;
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && picked().size) { removePicked(); return; }
  if (ev.key === 'Escape' && picked().size) { select(null); return; }
  if (!cmd || String(getSelection()) !== '') return;
  if (key === 'a') { ev.preventDefault(); pick(S.nodes.map((n) => n.id), ui.selected); }
  else if (key === 'c') { if (copyPicked()) ev.preventDefault(); }
  else if (key === 'x') { if (copyPicked()) { ev.preventDefault(); removePicked(); } }
  else if (key === 'v' && clip) { ev.preventDefault(); pasteClip(); }
});
