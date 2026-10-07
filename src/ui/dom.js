// Small page helpers, the UI's shared view state, and the hooks the screens use to reach
// each other without importing each other.
export const $ = (id) => document.getElementById(id);

export function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    if (k === 'class') e.className = props[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]);
    else if (k in e) e[k] = props[k];
    else e.setAttribute(k, props[k]);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
export function download(name, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// What is on screen, as opposed to what is in the document.
export const ui = { view: 'editor', selected: null, picked: new Set(), pan: { x: 0, y: 0 }, zoom: 1, sdkKeys: [], editDef: null };

// main.js fills these in. changed(what): 'nodes' redraws the canvas, 'all' the whole screen,
// nothing just saves and recompiles. go(view, focus) switches screen.
export const hooks = { changed: () => {}, go: () => {} };
export const changed = (what) => hooks.changed(what);
export const go = (view, focus) => hooks.go(view, focus);

// Follow the pointer until it is released.
export function track(move, up) {
  const m = (ev) => move(ev), u = (ev) => { removeEventListener('pointermove', m); removeEventListener('pointerup', u); up(ev); };
  addEventListener('pointermove', m); addEventListener('pointerup', u);
}
// A press that becomes a drag once the pointer moves, and a click if it never does.
export function pressThenDrag(ev, onDrag, onClick) {
  const sx = ev.clientX, sy = ev.clientY; let dragging = false;
  track((e) => { if (!dragging && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4) { dragging = true; onDrag(e); } }, () => { if (!dragging) onClick(); });
}
