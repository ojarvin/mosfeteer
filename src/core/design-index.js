/**
 * What a design contains, for searching a workspace: its tags, parts (name,
 * label, type), named nets, and texts, each with where it is drawn. It is
 * small and plain JSON, so the Atlas keeps it beside a design's cached
 * drawing and never reparses an unchanged file to search it.
 *
 * Matching looks through markup: `vcm`, `V_CM`, and `V_{CM}` are the same
 * word, as are `phi1` and `$\phi_1$`.
 */

import { isReferenceMarker, normalizeTags } from './model.js';

export { normalizeTags };

/** Tags as typed in a tag field: words split on spaces or commas. */
export function parseTags(text) {
  return normalizeTags(String(text ?? '').split(/[\s,]+/));
}

/** Tags as a tag field shows them. */
export function tagsText(tags) {
  return normalizeTags(tags).join(' ');
}

/** Text as it is searched: lower case, markup and spacing gone. */
export function searchKey(text) {
  return String(text ?? '').toLowerCase().replace(/[\s$\\_^{}]/g, '');
}

const box = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h });

/** A wire segment as a thin box along it, to highlight the wire itself. */
function segmentBox(a, b, pad = 10) {
  return { x: Math.min(a.x, b.x) - pad, y: Math.min(a.y, b.y) - pad, w: Math.abs(b.x - a.x) + 2 * pad, h: Math.abs(b.y - a.y) + 2 * pad };
}

/**
 * The index of one circuit: `{ tags, items }`, each item
 * `{ kind: 'part'|'net'|'text', id, text, type?, boxes }` in drawing units.
 */
export function designIndex(circuit) {
  const items = [];
  for (const component of circuit.components.values()) {
    if (component.type === 'solder') continue;
    const label = circuit.labelOf(component.refdes);
    const words = [isReferenceMarker(component) && !label ? '' : component.refdes, label?.text, component.type === 'block' ? component.value : ''];
    items.push({
      kind: 'part',
      id: component.refdes,
      text: words.filter(Boolean).join(' '),
      type: component.type,
      boxes: [box(component.bboxWorld())],
    });
  }
  for (const net of circuit.nets.values()) {
    if (!net.name) continue;
    const boxes = [];
    for (const path of net.paths()) for (let i = 1; i < path.length; i++) boxes.push(segmentBox(path[i - 1], path[i]));
    for (const label of circuit.netLabels(net)) boxes.push(box(label.inkRect()));
    items.push({ kind: 'net', id: net.id, text: net.name, boxes });
  }
  for (const label of circuit.labels.values()) {
    if (label.owner || label.netId || label.role || !label.text) continue;
    items.push({ kind: 'text', id: label.id, text: label.text, boxes: [box(label.inkRect())] });
  }
  return { tags: normalizeTags(circuit.tags), items };
}

/**
 * Search one design. Every word of `query` must be found -- in the design's
 * name, its tags, or one of its items (a part's type counts: `pmos`,
 * `current source`); `#word` looks only at tags. Returns null when the design
 * does not match, else `{ hits }`: the items that matched a word.
 */
export function searchDesign(index, name, query) {
  const terms = String(query ?? '').trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  const tagKeys = (index?.tags || []).map(searchKey);
  const items = index?.items || [];
  const hits = new Set();
  for (const term of terms) {
    const tagOnly = term.startsWith('#');
    const key = searchKey(tagOnly ? term.slice(1) : term);
    if (!key) continue;
    const inTags = tagKeys.some((tag) => tag.includes(key));
    if (tagOnly) {
      if (!inTags) return null;
      continue;
    }
    const matching = items.filter((item) => searchKey(item.text).includes(key) || (item.type && searchKey(item.type).includes(key)));
    for (const item of matching) hits.add(item);
    if (!matching.length && !inTags && !searchKey(name).includes(key)) return null;
  }
  return { hits: [...hits] };
}
