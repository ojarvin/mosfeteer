/**
 * The global rail names. Unnamed ground, supply, and VCM markers name their
 * nets V_{SS}, V_{DD}, and V_{CM}; the plain spellings VSS, VDD, and VCM
 * (older documents, typed net labels) are the same rails.
 */

export const RAIL_NAMES = Object.freeze({ ground: 'V_{SS}', supply: 'V_{DD}', vcm: 'V_{CM}' });

/** A name read without its script markup: `V_{SS}` reads `VSS`. */
export function plainName(name) {
  return String(name ?? '').trim().replace(/([_^])\{([^}]*)\}/g, '$2');
}

const ALIASES = new Map(Object.values(RAIL_NAMES).map((name) => [plainName(name), name]));

/** The one spelling a rail name compares by (`VSS` -> `V_{SS}`); any other
 *  name as written. */
export function railNameKey(name) {
  const text = String(name ?? '').trim();
  let key = railKeys.get(text);
  if (key === undefined) {
    // Every net is keyed on every redraw, from a handful of distinct names.
    if (railKeys.size >= 4096) railKeys.clear();
    key = ALIASES.get(plainName(text)) || text;
    railKeys.set(text, key);
  }
  return key;
}

const railKeys = new Map();
