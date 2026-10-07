// Desktop only. A plain text editor for scripts the canvas cannot draw, with the same
// checks the custom-node editor uses. A mission can be several Lua files (its script, plus
// data or helper files beside it); each gets a tab.
import { syntaxError, sandboxProblems } from '../lualint.js';
import { session, persist } from '../desktop.js';
import { $, el } from './dom.js';
import { renderMissionBar } from './missionsView.js';

const area = $('text-area');
const text = () => session.files[session.file] ?? '';
const isMain = () => !!session.mission && session.file === session.mission.name + '.lua';

function check() {
  const list = $('text-problems'), value = text(); list.replaceChildren();
  const e = syntaxError(value);
  if (e) list.append(el('li', { textContent: `Line ${e.line}: ${e.message}`, onclick: () => jumpTo(e.line) }));
  for (const p of sandboxProblems(value)) list.append(el('li', { class: 'warn', textContent: p + '.' }));
  if (!list.firstChild) list.append(el('li', { class: 'ok', textContent: 'This file parses. That is all that is checked here; test it in game.' }));
  if (isMain() && value.length > 128 * 1024) list.append(el('li', { textContent: 'The script is over 128 KiB, the limit for a main script. Move data into another file beside it.' }));
}
function jumpTo(line) {
  const value = text(), at = value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
  area.focus(); area.setSelectionRange(at, at);
}
// One tab per file; a dot marks the ones with unsaved changes.
function tabs() {
  const box = $('text-files'); box.replaceChildren();
  for (const name of Object.keys(session.files)) {
    const dirty = session.files[name] !== session.saved[name];
    box.append(el('button', { class: name === session.file ? 'on' : '', textContent: (dirty ? '● ' : '') + name, onclick: () => { session.file = name; persist(); renderTextView(); } }));
  }
}

export function renderTextView() {
  const m = session.mission;
  if (!(session.file in session.files)) session.file = Object.keys(session.files)[0] || '';
  $('text-path').textContent = m && session.file ? `scripts/${m.name}/${session.file}` : '';
  tabs();
  if (area.value !== text()) { area.value = text(); area.scrollTop = 0; }
  area.disabled = !session.file;
  check();
}

area.addEventListener('input', () => { if (!session.file) return; session.files[session.file] = area.value; persist(); check(); tabs(); renderMissionBar(); });
// Tab indents instead of leaving the editor.
area.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Tab') return;
  ev.preventDefault();
  area.setRangeText('    ', area.selectionStart, area.selectionEnd, 'end');
  area.dispatchEvent(new Event('input'));
});
