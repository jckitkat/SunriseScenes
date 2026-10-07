// The right column: the compiled script and the list of problems.
import { compile } from '../compile/index.js';
import { S, node } from '../state.js';
import { $, el, ui, download } from './dom.js';
import { renderNodes, markBad, markBadTabs, reveal } from './canvas.js';
import { setTab } from '../state.js';
import { changed } from './dom.js';

let last = { lua: '', shown: '', files: {}, stem: 'unnamed', problems: [] };
// The most recent compile: { lua, problems, stem }.
export const current = () => last;

export function renderOutput() {
  last = compile(S);
  const extra = Object.keys(last.files);
  $('path').textContent = `scripts/${last.stem}/${last.stem}.lua` + (extra.length ? ' + ' + extra.join(', ') : '');
  const list = $('problems'); list.replaceChildren();
  // In mission mode a problem may be on another tab than the one showing.
  const here = S.meta.mode === 'mission' ? S.mission.active : undefined, bad = new Set(), badTabs = new Set();
  for (const p of last.problems) {
    if (p.tab && p.tab !== here) badTabs.add(p.tab);
    if (p.nid != null && (p.tab || here) === here) bad.add(p.nid);
    list.append(el('li', { class: p.level === 'warn' ? 'warn' : '', textContent: p.msg, onclick: () => {
      if (p.tab && p.tab !== here) { setTab(p.tab); ui.selected = p.nid ?? null; changed('all'); if (p.nid != null && node(p.nid)) reveal(p.nid); return; }
      if (p.nid != null && node(p.nid)) { ui.selected = p.nid; reveal(p.nid); renderNodes(); markBad(bad); }
    } }));
  }
  if (!last.problems.length) list.append(el('li', { class: 'ok', textContent: 'No problems found. Check the script in game before you trust it.' }));
  markBad(bad); markBadTabs(badTabs);
  // A destination's zone table runs to thousands of lines; colouring that on every change would drag.
  if (last.shown.length > 200000) { $('lua').textContent = last.shown; return; }
  const esc = last.shown.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  $('lua').innerHTML = esc.split('\n').map((line) => {
    const c = line.search(/--(?=[^"]*$)/);
    const code = (c < 0 ? line : line.slice(0, c)).replace(/"[^"]*"/g, '<span class="s">$&</span>')
      .replace(/\b(local|function|return|end|if|then|and|or|not|nil|true|false)\b(?![^<]*<\/span>)/g, '<span class="k">$1</span>');
    return c < 0 ? code : code + '<span class="c">' + line.slice(c) + '</span>';
  }).join('\n');
}

$('b-dl').onclick = () => {
  download(last.stem + '.lua', last.lua, 'text/plain');
  for (const [name, text] of Object.entries(last.files)) download(name, text, 'text/plain');
};
$('b-copy').onclick = () => {
  navigator.clipboard.writeText(last.shown).then(() => { $('b-copy').textContent = 'Copied'; setTimeout(() => { $('b-copy').textContent = 'Copy'; }, 1200); });
};
