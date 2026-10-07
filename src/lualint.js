// Checks on Lua a user wrote for a custom node: syntax, the sandbox's missing functions,
// and whether it keeps state. Pure; shared by the Nodes screen and the compiler.
import luaparse from 'luaparse';
import { checkTemplate, parseTemplate, EVENT_KINDS, defLua } from './catalog.js';

// What the mission sandbox removes (docs: "How a script runs" > "The sandbox").
const REMOVED = [
  [/\b(pairs|next|print|warn|load|loadfile|dofile|collectgarbage|getmetatable|rawequal|rawlen|xpcall)\s*\(/g, (m) => `${m[1]}() is removed in the mission sandbox`],
  [/\bstring\.(find|match|gmatch|gsub|dump)\b/g, (m) => `string.${m[1]} is removed in the mission sandbox`],
  [/:(find|match|gmatch|gsub)\s*\(/g, (m) => `:${m[1]}() is removed in the mission sandbox (no pattern matching)`],
  [/\bmath\.(random|randomseed)\b/g, (m) => `math.${m[1]} is removed in the mission sandbox`],
  [/\b(io|os|debug|coroutine|utf8|package)\./g, (m) => `the ${m[1]} library is removed in the mission sandbox`],
];
export function sandboxProblems(code) {
  const out = new Set();
  for (const [re, say] of REMOVED) for (const m of code.matchAll(re)) out.add(say(m));
  return [...out];
}

// A syntax error message for a whole Lua chunk, or null. The runtime is Lua 5.4; the parser
// knows 5.3, which covers everything but <const>/<close>.
export function syntaxError(code) {
  try { luaparse.parse(code, { luaVersion: '5.3', comments: false }); return null; }
  catch (e) { return { line: e.line || 0, message: String(e.message).replace(/^\[\d+:\d+\]\s*/, '') }; }
}
// The same for a snippet with {socket} placeholders still in it.
const blankSockets = (code) => code.replace(/\{\w+(\.slot)?\}/g, '__socket');
export const snippetError = (code) => syntaxError('local function _(context, state, event)\n' + blankSockets(code) + '\nend');
export const exprError = (code) => syntaxError('local function _(context, state, event)\nreturn (' + blankSockets(code) + '\n)\nend');

// Everything wrong with one custom node definition: { errors: [...], warnings: [...] }.
export function lintDef(def) {
  const errors = checkTemplate(def.template || ''), warnings = [];
  const sockets = new Set(parseTemplate(def.template || '').filter((p) => p.text == null).map((p) => p.name));
  if (def.kind === 'prefab') {
    const used = new Set();
    for (const b of def.body || []) for (const v of Object.values(b.params).flat()) if (typeof v === 'string' && v[0] === '$') used.add(v.slice(1));
    for (const name of used) if (!sockets.has(name)) errors.push(`The steps use "${name}", but the sentence has no {${name}:…} socket.`);
    for (const name of sockets) if (!used.has(name)) warnings.push(`The socket "${name}" is not used by any step.`);
    if (!(def.body || []).length) errors.push('This prefab has no steps.');
    return { errors, warnings };
  }
  const code = defLua(def);
  for (const m of code.matchAll(/\{(\w+)(?:\.slot)?\}/g)) {
    if (m[1] !== 'node' && !sockets.has(m[1])) warnings.push(`{${m[1]}} is not a socket in the sentence, so it is left as written.`);
  }
  errors.push(...sandboxProblems(code));
  const syn = (what, e) => { if (e) errors.push(`${what}: ${e.message}`); };
  if (def.kind === 'wait') {
    if (!(def.cond || '').trim()) errors.push('Write the condition that finishes the wait.');
    else syn('Condition', exprError(def.cond));
    if ((def.start || '').trim()) syn('Start Lua', snippetError(def.start));
    if (def.event && !EVENT_KINDS.includes(def.event)) errors.push(`"${def.event}" is not an event a script can listen for.`);
    if (!def.event) {
      const listen = listenList(def);
      if (!listen.length) errors.push('With no single event chosen, list at least one event to re-check the condition on.');
      for (const k of listen) if (!EVENT_KINDS.includes(k)) errors.push(`"${k}" is not an event a script can listen for.`);
      if (/\bevent\b/.test(def.cond || '')) errors.push('A re-checked condition has no event to read; choose a single event, or drop "event" from the condition.');
    }
  } else {
    if (!(def.run || '').trim()) errors.push('Write the Lua this node runs.');
    else syn('Lua', snippetError(def.run));
    if ((def.mode || 'both') !== 'scene' && /\bstate\b/.test(def.run || '')) errors.push('"state" is not available in campaign mode, where the Lua runs inside on_start(context). Make the node scene-only or drop "state".');
  }
  if (/\b(set_variable|clear_variable|start_timer|cancel_timer|set_phase)\b/.test(code)) {
    warnings.push('This node keeps state (variables, timers or the phase). Two of them running at once can race; the built-in nodes avoid that on purpose.');
  }
  return { errors, warnings };
}
export const listenList = (def) => (def.listen || '').split(/[\s,]+/).filter(Boolean);
