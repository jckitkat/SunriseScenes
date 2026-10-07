// Read-only helpers over a list of nodes. Pure, so the compilers and tests can use them.
import { T } from './catalog.js';

export function graphOf(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n])), parent = new Map();
  for (const n of nodes) if (n.next != null) parent.set(n.next, n);
  return {
    node: (id) => byId.get(id),
    parentOf: (id) => parent.get(id),
    chain(n) { const out = []; while (n) { out.push(n); n = n.next != null ? byId.get(n.next) : null; } return out; },
    heads: () => nodes.filter((n) => !parent.has(n.id)),
  };
}

// A node as the sentence it shows, with input names filled in. Used in messages and Lua comments.
export function sentence(n, inputs, nodeOf, tabName) {
  const nm = (id) => { const i = inputs.find((x) => x.id === id); return i ? i.name : '?'; };
  const nodeName = (id) => { const m = nodeOf(id); return m ? m.params.id || '?' : '?'; };
  const parts = T(n.type).parts;
  return parts.map((p) => {
    if (p.text != null) return p.text;
    const v = n.params[p.name];
    if (p.kind === 'enum') return String(v).replace(/_/g, ' ');
    if (p.kind === 'num') return String(v);
    if (p.kind === 'id') return v || '?';
    if (p.kind === 'text') return v || 'none';
    if (p.kind === 'flag') return v ? '(' + p.name + ')' : '';
    if (p.kind === 'code') return '…';
    const name = p.kind === 'node' ? (p.ref === 'tab' ? (id) => (tabName && tabName(id)) || '?' : nodeName) : nm;
    if (p.list) return (v || []).map(name).join(', ') || (p.optional ? 'nothing' : '?');
    return v ? name(v) : (p.optional ? 'nothing' : '?');
  }).join('').replace(/\s+/g, ' ').trim().replace(/^./, (ch) => (parts[0] && parts[0].kind === 'enum' ? ch.toUpperCase() : ch));
}
