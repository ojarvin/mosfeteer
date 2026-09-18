/**
 * Where each symbol in a displayed equation came from.
 *
 * `devices.js` mints every symbolic parameter name through one chokepoint,
 * `parameterName(prefix, refdes)`, and tags every primitive it emits with
 * `metadata.component` and an `id` of the form `<refdes>.<role>`. That makes
 * the inversion below exact: it reads the table devices.js already built
 * rather than guessing at the spelling of a rendered name. Nothing here parses
 * TeX, and nothing here knows about the DOM.
 *
 * Keys are the raw expression symbol names (`gm1`, `ro1`, `RD`) as they appear
 * in `{kind:'symbol', name}` nodes — not their rendered forms (`g_{m1}`).
 * `present.js` owns that spelling and the two must not be confused.
 */

function roleOf(primitive) {
  const id = String(primitive?.id || '');
  const dot = id.lastIndexOf('.');
  const role = dot >= 0 ? id.slice(dot + 1) : '';
  return role || String(primitive?.kind || '');
}

/**
 * Invert one or more primitive lists into
 * `{ [symbolName]: {component, role, kind, primitives} }`. Earlier lists win,
 * so pass the solved model first and earlier modeling stages after it.
 *
 * Several lists are needed because a symbol can survive into a displayed
 * equation after its own primitive has left the solved set:
 *
 *  - A Miller shunt carries an expression, not a parameter name, so it mints no
 *    symbol of its own — but that expression still contains the feedback
 *    capacitor's `C_{GD}`, while the capacitor's primitive is gone.
 *  - `r_o -> infinity` drops a device's output resistance before the solve, yet
 *    the engine puts `r_o` back when removing it would make the solve singular.
 *
 * A symbol the table cannot resolve simply does not highlight, which is why
 * these gaps are invisible until someone points at the term and nothing
 * happens. Only primitives whose `value` is a symbolic name contribute, and a
 * symbol reached by more than one primitive keeps the first component and
 * accumulates the primitive ids.
 */
export function symbolProvenance(...primitiveLists) {
  const table = Object.create(null);
  for (const primitives of primitiveLists) {
    for (const primitive of primitives || []) {
      const name = primitive?.value;
      if (typeof name !== 'string' || !name) continue;
      const component = primitive?.metadata?.component;
      if (!component) continue;
      const existing = table[name];
      if (existing) {
        if (!existing.primitives.includes(primitive.id)) existing.primitives.push(primitive.id);
        continue;
      }
      table[name] = {
        component,
        role: roleOf(primitive),
        kind: primitive.kind,
        primitives: [primitive.id],
      };
    }
  }
  return table;
}

/** The distinct components a set of symbol names resolves to, in first-seen
 *  order. Used to label a rendered subexpression with everything it touches. */
export function componentsOfSymbols(names, table) {
  const seen = [];
  for (const name of names || []) {
    const component = table?.[name]?.component;
    if (component && !seen.includes(component)) seen.push(component);
  }
  return seen;
}
