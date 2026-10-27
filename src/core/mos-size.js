/**
 * Transistor sizing: a MOS part's optional W/L and multiplier, drawn as an
 * owned math label, the size alone: (4 · 2 μm) / 400 nm. The size is
 * authored compactly (`2u/400n x4`) and kept on the part
 * (`ComponentInstance#size`); the label is a projection of it
 * (`Circuit#_syncSizeLabel`). It stands below the name label, or in its
 * place (`replacesName`), the name then hidden. A size may also draw no
 * label (`hidden`), when a parts table (parts-table.js) shows it instead.
 */

export const MOS_SIZE_ROLE = 'mos-size';
export const MOS_SIZE_TYPES = new Set(['nmos', 'pmos', 'nmosb', 'pmosb']);
/** Below the name label, beside the part's conduction column. */
export const MOS_SIZE_OFFSET = Object.freeze({ x: 40, y: 120 });

// SI prefixes of a length in meters; a bare number is in micrometers, as
// sizes are written on schematics (`2/0.18`).
const PREFIXES = { f: 'f', p: 'p', n: 'n', u: 'u', 'µ': 'u', 'μ': 'u', m: 'm', '': 'u' };
const PREFIX_TEX = { f: 'f', p: 'p', n: 'n', u: 'μ', m: 'm' };
const LENGTH = /^(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?\s*([fpnuµμm]?)m?$/i;

/** One length (`2u`, `400n`, `0.18um`; a bare number in μm), stored with
 *  its prefix letter. Throws on anything else. */
export function parseLength(text, what = 'length') {
  const match = String(text).trim().match(LENGTH);
  if (!match) throw new Error(`bad ${what} "${text}" (e.g. 2u, 400n, 0.18um)`);
  const number = match[2] ? String(Number(`${match[1]}e${match[2]}`)) : match[1].replace(/\.$/, '');
  if (!(Number(number) > 0)) throw new Error(`${what} must be positive`);
  return `${number}${PREFIXES[match[3].toLowerCase()] ?? PREFIXES[match[3]]}`;
}

const LENGTH_EXPONENT = { f: -15, p: -12, n: -9, u: -6, m: -3 };

/** A stored length's number in meters (`400n` is 4e-7), or NaN. */
export function lengthMeters(length) {
  const match = String(length ?? '').match(/^(.*?)([fpnum])$/);
  return match ? Number(`${match[1]}e${LENGTH_EXPONENT[match[2]]}`) : NaN;
}

/** A multiplier: a whole number from 1. */
export function parseMultiplier(text) {
  const m = Number(text);
  if (!Number.isInteger(m) || m < 1) throw new Error(`bad multiplier "${text}" (a whole number from 1)`);
  return m;
}

/** A size from its compact spelling: `W/L` with an optional multiplier as
 * `x4`, `*4`, `×4`, or `m=4` after it (or `4x` before it); `W=2u L=400n M=4`
 * also reads. Throws on anything else. */
export function parseMosSize(text) {
  let source = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (!source) throw new Error('a size is W/L, e.g. 2u/400n x4');
  let m = 1;
  const keyed = source.match(/^w\s*=\s*(\S+)\s+l\s*=\s*(\S+)(?:\s+m\s*=\s*(\S+))?$/i);
  if (keyed) {
    return { w: parseLength(keyed[1], 'W'), l: parseLength(keyed[2], 'L'), m: keyed[3] ? parseMultiplier(keyed[3]) : 1 };
  }
  const before = source.match(/^(\d+)\s*[x*×·]\s*(?=\S)/i);
  if (before) {
    m = parseMultiplier(before[1]);
    source = source.slice(before[0].length);
  } else {
    const after = source.match(/\s*(?:[x*×·]|m\s*=)\s*(\d+)$/i);
    if (after) {
      m = parseMultiplier(after[1]);
      source = source.slice(0, after.index);
    }
  }
  const parts = source.split('/');
  if (parts.length !== 2) throw new Error(`a size is W/L, e.g. 2u/400n x4 (got "${text}")`);
  return { w: parseLength(parts[0], 'W'), l: parseLength(parts[1], 'L'), m };
}

/** A stored size, checked; null for anything that is not one. */
export function normalizeMosSize(size) {
  if (!size || typeof size !== 'object') return null;
  try {
    const parsed = parseMosSize(`${size.w}/${size.l} x${size.m ?? 1}`);
    return { ...parsed, ...(size.replacesName ? { replacesName: true } : {}), ...(size.hidden ? { hidden: true } : {}) };
  } catch {
    return null;
  }
}

/** The compact spelling a size is edited in: `2u/400n`, `2u/400n x4`. */
export function formatMosSize(size) {
  if (!size) return '';
  return `${size.w}/${size.l}${size.m > 1 ? ` x${size.m}` : ''}`;
}

function lengthTex(length) {
  const [, number, prefix] = length.match(/^(.*?)([fpnum])$/);
  return `\\mathrm{${number}\\,${PREFIX_TEX[prefix]}m}`;
}

/** The label's TeX: the size alone, W over L, the multiplier (when not 1)
 *  in the numerator before W. */
export function mosSizeTex(size) {
  const multiplier = size.m > 1 ? `${size.m}\\cdot` : '';
  return `$\\frac{${multiplier}${lengthTex(size.w)}}{${lengthTex(size.l)}}$`;
}

/** Name labels a size label stands in for, so nothing draws or picks them. */
export function sizeReplacedNameLabels(circuit) {
  const hidden = new Set();
  for (const component of circuit.components.values()) {
    if (!component.size?.replacesName || component.size.hidden) continue;
    const name = circuit.labelOf(component.refdes);
    if (name) hidden.add(name.id);
  }
  return hidden;
}
