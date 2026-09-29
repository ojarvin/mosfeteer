/**
 * How related two designs are, for laying out neighbourhoods on the Atlas
 * desk: a number from 0 (nothing in common) to 1. Several weak hints add up:
 *
 *   tags        a shared tag says so outright
 *   links       a part in one links to the other (hierarchy)
 *   name        shared words (`ota-folded`, `ota_5t`) or a shared stem
 *   folder      the same subfolder
 *   parts       a similar mix of part types (two SAR ADCs, two OTAs)
 *   nets        shared net names (`CLK`, `V_{REF}`)
 *
 * Each hint is a probability-like score; they combine as independent
 * evidence, 1 - prod(1 - s).
 */

import { searchKey } from './design-index.js';

// Words a name carries that say nothing about what the design is.
const FILLER = new Set(['v', 'ver', 'rev', 'new', 'old', 'copy', 'test', 'tmp', 'temp', 'final', 'draft', 'wip', 'backup', 'bak', 'the', 'and', 'of']);

/** A design name's words: split at punctuation, case changes, and digits. */
export function nameWords(name) {
  return String(name ?? '')
    .replace(/\.json$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !FILLER.has(word) && !/^\d+$/.test(word));
}

const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
};

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [key, value] of a) {
    na += value * value;
    dot += value * (b.get(key) || 0);
  }
  for (const value of b.values()) nb += value * value;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Parts every design has, which say nothing about kinship.
const COMMON_TYPES = new Set(['ground', 'supply', 'vcm', 'solder', 'port', 'input', 'output', 'inputoutput']);

/**
 * What relatedness looks at in one design ({ id, name, dir, tags, index,
 * links }): computed once per design.
 */
export function relatednessProfile({ id, name = '', dir = '', tags = [], index = null, links = [] }) {
  const types = new Map();
  const nets = new Set();
  for (const item of index?.items || []) {
    if (item.kind === 'part' && item.type && !COMMON_TYPES.has(item.type)) types.set(item.type, (types.get(item.type) || 0) + 1);
    if (item.kind === 'net' && item.text) nets.add(searchKey(item.text));
  }
  const words = nameWords(name);
  return {
    id,
    name: String(name).toLowerCase().replace(/[^a-z0-9]/g, ''),
    words: new Set(words),
    dir: String(dir || ''),
    tags: new Set((tags || []).map((tag) => String(tag).toLowerCase())),
    links: new Set(links || []),
    types,
    nets,
  };
}

/** Relatedness of two profiles, 0..1. */
export function relatedness(a, b) {
  const hints = [];
  if ([...a.tags].some((tag) => b.tags.has(tag))) hints.push(0.9);
  if (a.links.has(b.id) || b.links.has(a.id)) hints.push(0.9);
  const words = jaccard(a.words, b.words);
  if (words) hints.push(0.35 + 0.5 * words);
  else {
    // A shared stem with no word boundary: `ota5t`, `otafolded`.
    let stem = 0;
    while (stem < a.name.length && a.name[stem] === b.name[stem]) stem += 1;
    if (stem >= 3) hints.push(Math.min(0.6, 0.15 * stem));
  }
  if (a.dir && a.dir === b.dir) hints.push(0.25);
  const parts = cosine(a.types, b.types);
  if (parts > 0.5) hints.push(0.4 * (parts - 0.5) / 0.5);
  const nets = jaccard(a.nets, b.nets);
  if (nets) hints.push(0.35 * nets);
  return 1 - hints.reduce((keep, s) => keep * (1 - s), 1);
}

/** A relatedness function over item ids, from their profiles. */
export function relatednessOf(items) {
  const profiles = new Map(items.map((item) => [item.id, relatednessProfile(item)]));
  const memo = new Map();
  return (a, b) => {
    if (a === b) return 1;
    const key = a < b ? `${a}\n${b}` : `${b}\n${a}`;
    if (!memo.has(key)) memo.set(key, profiles.has(a) && profiles.has(b) ? relatedness(profiles.get(a), profiles.get(b)) : 0);
    return memo.get(key);
  };
}
