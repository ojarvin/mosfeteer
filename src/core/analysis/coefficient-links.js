/**
 * Linked coefficients (signal-flow analysis): a coefficient may follow
 * others instead of holding its own number -- `c_1 = b_1`, `c_2 = 2*b_1`,
 * `T_d = T/2` -- so dragging b_1 moves c_1 with it. A link is an expression
 * in other coefficients (+ - * / ^, numbers, names); saved with the
 * document (`analysisValues.links`), resolved wherever the numbers are used.
 */

import { parseExpression } from '../transfer-function.js';

/** The names an expression AST reads. */
function names(node, out = new Set()) {
  switch (node.t) {
    case 'sym': out.add(node.name); break;
    case 'add': node.terms.forEach((term) => names(term.node, out)); break;
    case 'mul': node.factors.forEach((factor) => names(factor, out)); break;
    case 'div': names(node.num, out); names(node.den, out); break;
    case 'pow': names(node.base, out); break;
    case 'var': case 'exp': throw new Error('a link is an expression of other coefficients, without s or delays');
    default: break;
  }
  return out;
}

/** A link's text (`b_1`, `= 2*b_1`) as `{ ast, reads }`; throws when it does not read. */
export function parseCoefficientLink(text) {
  const source = String(text ?? '').trim().replace(/^=\s*/, '');
  if (!source) throw new Error('a link needs an expression, such as = b_1');
  const ast = parseExpression(source);
  return { ast, reads: names(ast), text: source };
}

function evaluate(node, lookup) {
  switch (node.t) {
    case 'num': return Number(node.v);
    case 'sym': return lookup(node.name);
    case 'add': return node.terms.reduce((sum, { sign, node: term }) => sum + sign * evaluate(term, lookup), 0);
    case 'mul': return node.factors.reduce((product, factor) => product * evaluate(factor, lookup), 1);
    case 'div': return evaluate(node.num, lookup) / evaluate(node.den, lookup);
    case 'pow': return evaluate(node.base, lookup) ** node.n;
    default: return NaN;
  }
}

/**
 * Whether linking `name` to `text` would make a coefficient follow itself,
 * through any chain of the other links.
 */
export function linkMakesCycle(name, text, links) {
  const next = { ...links, [name]: text };
  const seen = new Set();
  const visit = (current, path) => {
    if (path.has(current)) return true;
    if (!Object.hasOwn(next, current) || seen.has(current)) return false;
    seen.add(current);
    let reads;
    try { reads = parseCoefficientLink(next[current]).reads; } catch { return false; }
    const deeper = new Set(path).add(current);
    return [...reads].some((read) => visit(read, deeper));
  };
  return visit(name, new Set());
}

/**
 * Every coefficient's number: its own (`values`, 1 when unset) or, when
 * linked, its link's value through any chain. A link that does not read,
 * or runs in a circle, falls back to the coefficient's own number.
 */
export function resolveCoefficients(values = {}, links = {}) {
  const resolved = {};
  const parsed = new Map();
  for (const [name, text] of Object.entries(links || {})) {
    try { parsed.set(name, parseCoefficientLink(text)); } catch { /* falls back */ }
  }
  const own = (name) => (Number.isFinite(values[name]) ? values[name] : 1);
  const visiting = new Set();
  const lookup = (name) => {
    if (Object.hasOwn(resolved, name)) return resolved[name];
    const link = parsed.get(name);
    if (!link) return (resolved[name] = own(name));
    if (visiting.has(name)) return own(name);
    visiting.add(name);
    const value = evaluate(link.ast, lookup);
    visiting.delete(name);
    resolved[name] = Number.isFinite(value) ? value : own(name);
    return resolved[name];
  };
  for (const name of new Set([...Object.keys(values || {}), ...parsed.keys()])) lookup(name);
  return resolved;
}
