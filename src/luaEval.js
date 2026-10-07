// Reads what a mission script declares, without running it. The importers use this to
// turn hand-written (or generated) Lua tables back into drawings. It follows locals,
// tables, and references into the mission module; it does not execute code.
//
// Values it produces:
//   { path: ['mission', 'Slot', 'PT_GATE'] }   a reference into a known module
//   { kv: {...}, list: [...] }                  a table
//   { unit: [...] } / { line: [...] }           a call to campaign.unit / freeroam.unit / campaign.line
//   { campaign: table } / { freeroam: table }   a call to campaign.new / freeroam.new
//   { fn: node }                                a function, kept as its syntax node
//   { num: '0x10' }, strings, booleans, null    literals (numbers keep their spelling)
//   { unknown: true }                           anything else
import luaparse from 'luaparse';

const ROOTS = ['mission', 'missions', 'campaign', 'freeroam', 'lib'];
const LIBS = { 'missions': 'missions', 'lib.campaign': 'campaign', 'lib.freeroam': 'freeroam', 'lib.mission_lib': 'lib' };
const str = (node) => node.raw.replace(/^\[=*\[|\]=*\]$/g, '').replace(/^["']|["']$/g, '');

export function parseLua(lua) {
  try { return { ast: luaparse.parse(lua, { luaVersion: '5.3', ranges: true, comments: false }) }; }
  catch (e) { return { error: 'The script does not parse: ' + e.message }; }
}

export function evaluator() {
  const env = new Map(), cache = new Map(), seen = { scenario: '', requires: [] };
  const ev = (node) => {
    if (cache.has(node)) return cache.get(node);
    cache.set(node, { unknown: true });   // guards against a local that names itself
    const v = evaluate(node); cache.set(node, v); return v;
  };
  const call = (node, args) => {
    const base = node.base;
    if (base.type === 'Identifier' && !env.has(base.name)) {
      if (base.name === 'assert') return args[0];
      if (base.name === 'require') {
        const a = args[0];
        if (typeof a === 'string') { seen.requires.push(a); return LIBS[a] ? { path: [LIBS[a]] } : { module: a }; }
        if (a && a.path && a.path[0] === 'missions' && a.path[1]) { seen.scenario = a.path[1]; return { path: ['mission'] }; }
        return { unknown: true };
      }
    }
    const f = ev(base), name = f && f.path ? f.path.join('.') : '';
    if (name === 'campaign.unit' || name === 'freeroam.unit') return { unit: args };
    if (name === 'campaign.line') return { line: args };
    if (name === 'campaign.new') return { campaign: args[0] };
    if (name === 'freeroam.new') return { freeroam: args[0] };
    if (name === 'lib.one') return args[0];
    if (name === 'lib.list') return { kv: {}, list: args };
    // require("x.content")(mission, ...): a call into another file of the same mission
    if (f && f.module) return { moduleCall: f.module, args };
    return { unknown: true };
  };
  function evaluate(node) {
    switch (node.type) {
      case 'Identifier':
        if (env.has(node.name)) { const v = env.get(node.name); return v && v.type ? ev(v) : v; }
        return ROOTS.includes(node.name) ? { path: [node.name] } : { unknown: true };
      case 'MemberExpression': {
        const b = ev(node.base), key = node.identifier.name;
        if (b && b.path) return { path: [...b.path, key] };
        if (b && b.kv && key in b.kv) return b.kv[key];
        return { unknown: true };
      }
      case 'IndexExpression': {
        const b = ev(node.base), key = ev(node.index);
        if (b && b.path && typeof key === 'string') return { path: [...b.path, key] };
        if (b && b.list && key && key.num) return b.list[Number(key.num) - 1];
        return { unknown: true };
      }
      case 'StringLiteral': return str(node);
      case 'NumericLiteral': return { num: node.raw };
      case 'BooleanLiteral': return node.value;
      case 'NilLiteral': return null;
      case 'TableConstructorExpression': {
        const t = { kv: {}, list: [], node };
        for (const f of node.fields) {
          if (f.type === 'TableValue') t.list.push(ev(f.value));
          else if (f.type === 'TableKeyString') t.kv[f.key.name] = ev(f.value);
          else { const k = ev(f.key); if (typeof k === 'string') t.kv[k] = ev(f.value); }
        }
        return t;
      }
      case 'CallExpression': return call(node, node.arguments.map(ev));
      case 'TableCallExpression': return call(node, [ev(node.arguments)]);
      case 'StringCallExpression': return call(node, [ev(node.argument)]);
      case 'FunctionDeclaration': return { fn: node };
      default: return { unknown: true };
    }
  }
  // Read a run of statements: record the locals, and give back what it returns (if anything).
  const run = (body) => {
    let result;
    for (const s of body) {
      if (s.type === 'LocalStatement') s.variables.forEach((v, i) => { if (s.init[i]) env.set(v.name, s.init[i]); });
      else if (s.type === 'FunctionDeclaration' && s.identifier && s.identifier.type === 'Identifier') env.set(s.identifier.name, s);
      else if (s.type === 'ReturnStatement' && s.arguments[0]) result = ev(s.arguments[0]);
    }
    return result;
  };
  // Bind names to values that are already known, such as a function's parameters.
  const bind = (name, value) => env.set(name, value);
  return { env, ev, run, bind, seen };
}
