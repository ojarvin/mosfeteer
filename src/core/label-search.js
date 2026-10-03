import { Circuit, INTERFACE_PIN_TYPES, canonicalNetName, isReferenceMarker } from './model.js';
import { switchState } from './beats.js';
import { MOS_SIZE_ROLE } from './mos-size.js';

// Search and replace over the drawing's text: every label role (net names,
// part names, switch phases, rail names, annotations, equations, captions),
// block captions, and net names no label shows. A search without markup
// looks through it (`M1` finds `M_{1}`, `phi1` finds `$\phi_1$`); one with
// markup matches as written; a regular expression matches the authored text.
// A replacement goes through the same model path as editing that text by
// hand -- a net label renames its net, a part label renames the part, a
// switch label sets its phase -- and is all or nothing: one rejected change
// (an invalid or duplicate part name) leaves the drawing untouched.

/** What a searchable text is, for display: net, part, switch, rail, port,
 * text, equation, caption, or block. */
function roleOf(circuit, label) {
  if (label.netId) return 'net';
  if (label.owner) {
    const owner = circuit.components.get(label.owner);
    if (switchState(owner)) return 'switch';
    if (isReferenceMarker(owner)) return 'rail';
    if (INTERFACE_PIN_TYPES.has(owner?.type)) return 'port';
    return 'part';
  }
  if (label.parent) return 'caption';
  return label.math ? 'equation' : 'text';
}

/** Whether the drawing already carries the net's name: a net label, the
 * owned label of a port or rail marker on it, or an unnamed ground, supply,
 * or VCM symbol whose global rail name it is. */
function netNameShown(circuit, net) {
  if (circuit.netLabels(net).length || circuit.unnamedReferenceInfo(net)) return true;
  for (const { comp } of net.terminals) {
    const label = circuit.labelOf(comp);
    if (label?.text && canonicalNetName(label.text) === net.name) return true;
  }
  return false;
}

/** Every searchable text in the drawing, as { key, role, text, label?,
 * refdes?, netId? }. A label's key is `label:<id>`, a block caption's
 * `block:<refdes>`, and a net name no label shows `net:<id>`. */
export function searchableTexts(circuit) {
  const texts = [];
  for (const label of circuit.labels.values()) {
    // Generated text (input signs, a transistor's size) is not authored here.
    if (label.role === 'signal-input-sign' || label.role === MOS_SIZE_ROLE || !label.text) continue;
    texts.push({ key: `label:${label.id}`, role: roleOf(circuit, label), text: label.text, label });
  }
  for (const component of circuit.components.values()) {
    if (component.type === 'block' && component.value) {
      texts.push({ key: `block:${component.refdes}`, role: 'block', text: String(component.value), refdes: component.refdes });
    }
  }
  for (const net of circuit.nets.values()) {
    if (net.name && !netNameShown(circuit, net)) texts.push({ key: `net:${net.id}`, role: 'net', text: net.name, netId: net.id });
  }
  return texts;
}

const MARKUP = /[$\\_^{}]/;

/**
 * How `find` is matched: `regex` compiles it as a regular expression over
 * the authored text; otherwise it is literal, and looks through markup
 * unless it carries markup itself. A pattern that matches empty text would
 * match everywhere and is refused.
 */
function matcher(find, { matchCase = false, regex = false } = {}) {
  if (typeof find !== 'string' || !find) throw new Error('search text is empty');
  const flags = matchCase ? 'g' : 'gi';
  if (regex) {
    let re;
    try { re = new RegExp(find, flags); } catch (err) { throw new Error(`invalid pattern: ${err.message.replace(/^Invalid regular expression: (\/.*\/[a-z]*: )?/, '')}`); }
    if (re.test('')) throw new Error('pattern matches empty text');
    return { re, regex: true, throughMarkup: false };
  }
  return { re: new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags), regex: false, throughMarkup: !MARKUP.test(find) };
}

/**
 * `text` as read without markup, and how its markup nests: `plain` keeps
 * every character but `$ \ _ ^ { }`, `at[i]` is where plain character i
 * stands in `text`, `pairs` are the `{...}` groups (taking in a `_` or `^`
 * before one) and the `$...$` spans, each as { start, end, inner: [from,
 * to) }, and `commands` the `\name` runs as { start, end }.
 */
function readThroughMarkup(text) {
  let plain = '';
  const at = [];
  const pairs = [];
  const commands = [];
  const braces = [];
  let dollar = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && /[A-Za-z]/.test(text[i + 1] || '')) {
      let end = i + 1;
      while (/[A-Za-z]/.test(text[end] || '')) end++;
      commands.push({ start: i, end });
      for (let j = i + 1; j < end; j++) { plain += text[j]; at.push(j); }
      i = end - 1;
    } else if (ch === '{') {
      braces.push(i);
    } else if (ch === '}') {
      if (!braces.length) continue;
      const brace = braces.pop();
      const marked = brace > 0 && (text[brace - 1] === '_' || text[brace - 1] === '^');
      pairs.push({ start: marked ? brace - 1 : brace, end: i + 1, inner: [brace + 1, i] });
    } else if (ch === '$') {
      if (dollar < 0) dollar = i;
      else { pairs.push({ start: dollar, end: i + 1, inner: [dollar + 1, i] }); dollar = -1; }
    } else if (ch !== '_' && ch !== '^' && ch !== '\\') {
      plain += ch;
      at.push(i);
    }
  }
  // Inner pairs first, so an outer one sees a match they widened.
  pairs.sort((p, q) => (p.end - p.start) - (q.end - q.start));
  return { plain, at, pairs, commands };
}

/**
 * The stretches of `text` that `find` matches, as [start, end, match].
 * Through markup, a match takes in the markup it covers whole -- a group or
 * `$...$` whose every character it spans, a command whose whole name it
 * spans -- and one that would cut markup in two is no match: its
 * replacement could not be placed without breaking the text.
 */
function matchSpans(text, { re, throughMarkup }) {
  if (!throughMarkup) return [...text.matchAll(re)].filter((m) => m[0]).map((m) => [m.index, m.index + m[0].length, m]);
  const { plain, at, pairs, commands } = readThroughMarkup(text);
  const spans = [];
  for (const m of plain.matchAll(re)) {
    if (!m[0]) continue;
    let a = at[m.index];
    let b = at[m.index + m[0].length - 1] + 1;
    let whole = true;
    for (const { start, end } of commands) {
      if (b <= start + 1 || a >= end) continue; // clear of its name
      if (a <= start + 1 && b >= end) a = Math.min(a, start);
      else whole = false;
    }
    for (const { start, end, inner: [from, to] } of pairs) {
      if (b <= start || a >= end) continue; // clear of it
      if (a >= from && b <= to) continue; // inside it
      const inside = at.filter((i) => i >= from && i < to);
      if (inside.length && a <= inside[0] && b > inside[inside.length - 1]) {
        a = Math.min(a, start);
        b = Math.max(b, end);
      } else whole = false;
    }
    if (whole) spans.push([a, b, m]);
  }
  return spans;
}

/** `text` with each span replaced; a regular expression's replacement may
 * use its groups (`$1`, `$&`). */
function replaceSpans(text, spans, replacement, { regex }) {
  let out = '';
  let last = 0;
  for (const [a, b, m] of spans) {
    out += text.slice(last, a) + (regex ? expandReplacement(replacement, m) : replacement);
    last = b;
  }
  return out + text.slice(last);
}

/** A regular expression replacement, with `$&`, `$1`..`$99`, and `$$`. */
function expandReplacement(replacement, m) {
  return replacement.replace(/\$(\$|&|\d{1,2})/g, (token, what) => {
    if (what === '$') return '$';
    if (what === '&') return m[0];
    const group = m[Number(what)];
    return group === undefined && Number(what) >= m.length ? token : (group ?? '');
  });
}

/** The texts containing `find`, each with its match count and, when
 * `replacement` is given, the text it would become. */
export function findInLabels(circuit, find, { matchCase = false, regex = false, replacement = null } = {}) {
  const match = matcher(find, { matchCase, regex });
  const found = [];
  for (const entry of searchableTexts(circuit)) {
    const spans = matchSpans(entry.text, match);
    if (!spans.length) continue;
    found.push({ ...entry, count: spans.length, ...(replacement === null ? {} : { next: replaceSpans(entry.text, spans, replacement, match) }) });
  }
  return found;
}

function applyReplacements(circuit, find, replacement, { matchCase, regex, keys }) {
  // Every target is fixed before any change. Renaming one net label renames
  // its net, so its other labels then already read the new name; a text that
  // no longer reads as found is skipped, never searched again.
  for (const { key, text, next: replaced } of findInLabels(circuit, find, { matchCase, regex, replacement })) {
    if (keys && !keys.has(key)) continue;
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const next = replaced.trim();
    if (kind === 'block') {
      if (circuit.components.get(id)?.value === text) circuit.setValue(id, next);
      continue;
    }
    if (kind === 'net') {
      const net = circuit.nets.get(id);
      if (!net || net.name !== text) continue;
      if (!next) throw new Error(`net name "${text}" would become empty`);
      circuit.renameNet(net, next);
      continue;
    }
    const label = circuit.labels.get(id);
    if (!label || label.text !== text) continue;
    if (!next) throw new Error(`"${text}" would become empty`);
    label.setText(next);
  }
}

/**
 * Replace every occurrence of `find` with `replacement` in the drawing's
 * texts (or only those whose keys are listed). Returns { changed, joins }:
 * the texts that changed, as { key, role, from, to }, and the names by which
 * a renamed net now joins another net (a virtual electrical connection).
 * Throws, changing nothing, when any single change is rejected. `dryRun`
 * reports the same result without changing the drawing.
 */
export function replaceInLabels(circuit, find, replacement, { matchCase = false, regex = false, keys = null, dryRun = false } = {}) {
  replacement = String(replacement ?? '');
  const options = { matchCase, regex, keys: keys && new Set(keys) };
  const before = findInLabels(circuit, find, { matchCase, regex }).filter((entry) => !options.keys || options.keys.has(entry.key));
  // Rehearse on a copy first, so a rejected rename leaves no half-done edit.
  const rehearsal = Circuit.fromJSON(circuit.toJSON());
  try {
    applyReplacements(rehearsal, find, replacement, options);
  } catch (err) {
    throw new Error(`replace changed nothing: ${err.message}`);
  }
  const after = new Map(searchableTexts(rehearsal).map((entry) => [entry.key, entry.text]));
  const changed = before
    .map((entry) => ({ key: entry.key, role: entry.role, from: entry.text, to: after.get(entry.key) ?? '' }))
    .filter((entry) => entry.to !== entry.from);
  const result = { changed, joins: joinedNames(circuit, rehearsal) };
  if (!dryRun) applyReplacements(circuit, find, replacement, options);
  return result;
}

/** Names under which nets that were apart before now share one name. */
function joinedNames(before, after) {
  const was = new Map([...before.nets.values()].map((net) => [net.id, before.netGroupKey(net)]));
  const groups = new Map();
  for (const net of after.nets.values()) {
    const group = after.netGroupKey(net);
    if (!groups.has(group)) groups.set(group, { name: net.name, was: new Set() });
    groups.get(group).was.add(was.get(net.id));
  }
  return [...groups.values()].filter((group) => group.was.size > 1).map((group) => group.name);
}
