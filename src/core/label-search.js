import { Circuit, INTERFACE_PIN_TYPES, isReferenceMarker } from './model.js';
import { switchState } from './beats.js';

// Search and replace over the drawing's text: every label role (net names,
// part names, switch phases, rail names, annotations, equations, captions) and
// block captions. Matching is literal on the authored text, so markup such as
// `M_{1}` is searched as written. A replacement goes through the same model
// path as editing that text by hand -- a net label renames its net, a part
// label renames the part, a switch label sets its phase -- and is all or
// nothing: one rejected change (an invalid or duplicate part name) leaves the
// drawing untouched.

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

/** Every searchable text in the drawing, as { key, role, text, label?, refdes? }.
 * A label's key is `label:<id>`; a block caption's is `block:<refdes>`. */
export function searchableTexts(circuit) {
  const texts = [];
  for (const label of circuit.labels.values()) {
    if (label.role === 'signal-input-sign' || !label.text) continue;
    texts.push({ key: `label:${label.id}`, role: roleOf(circuit, label), text: label.text, label });
  }
  for (const component of circuit.components.values()) {
    if (component.type === 'block' && component.value) {
      texts.push({ key: `block:${component.refdes}`, role: 'block', text: String(component.value), refdes: component.refdes });
    }
  }
  return texts;
}

function pattern(find, matchCase) {
  if (typeof find !== 'string' || !find) throw new Error('search text is empty');
  return new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
}

/** The texts containing `find`, each with its match count and, when
 * `replacement` is given, the text it would become. */
export function findInLabels(circuit, find, { matchCase = false, replacement = null } = {}) {
  const re = pattern(find, matchCase);
  const found = [];
  for (const entry of searchableTexts(circuit)) {
    const count = entry.text.match(re)?.length || 0;
    if (!count) continue;
    found.push({ ...entry, count, ...(replacement === null ? {} : { next: entry.text.replace(re, () => replacement) }) });
  }
  return found;
}

function applyReplacements(circuit, find, replacement, { matchCase, keys }) {
  const re = pattern(find, matchCase);
  // Every target is fixed before any change. Renaming one net label renames
  // its net, so its other labels then already read the new name; a text that
  // no longer reads as found is skipped, never searched again.
  for (const { key, text } of findInLabels(circuit, find, { matchCase })) {
    if (keys && !keys.has(key)) continue;
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const next = text.replace(re, () => replacement).trim();
    if (kind === 'block') {
      if (circuit.components.get(id)?.value === text) circuit.setValue(id, next);
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
export function replaceInLabels(circuit, find, replacement, { matchCase = false, keys = null, dryRun = false } = {}) {
  replacement = String(replacement ?? '');
  const options = { matchCase, keys: keys && new Set(keys) };
  const before = findInLabels(circuit, find, { matchCase }).filter((entry) => !options.keys || options.keys.has(entry.key));
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
