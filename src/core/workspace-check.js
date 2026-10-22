/**
 * The workspace check: what in a workspace's designs needs a hand. A link
 * naming a design no file is called is broken; a design renamed outside the
 * editor (in a file manager) still remembers the names it was saved under
 * (Circuit#savedNames), so the design a broken link meant can be found
 * again -- when exactly one design remembers that name. Two that do (a copy
 * made outside the editor) are never guessed between.
 */

/**
 * `designs`: [{ id, name, names?: [saved names], parts?: [{ id, link }],
 * noteLinks?: [names] }] -- `noteLinks` the designs its notes link to
 * (`[[amp]]`, notes.js), which name a design in any case.
 * Returns the broken links, one entry per design and missing name:
 * `{ design, name, link, parts: [refdes], notes?, to, candidates }` --
 * `notes` true when its notes link there too, `to` the design it most
 * likely meant (null when none or several remember it), `candidates` every
 * design that remembers the name.
 */
export function brokenLinks(designs) {
  const names = new Set(designs.map((design) => design.name));
  const lower = new Set(designs.map((design) => String(design.name).toLowerCase()));
  const out = [];
  for (const design of designs) {
    const byLink = new Map();
    const entry = (link) => {
      if (!byLink.has(link)) byLink.set(link, { parts: [], notes: false });
      return byLink.get(link);
    };
    for (const part of design.parts || []) {
      if (!part.link || names.has(part.link)) continue;
      entry(part.link).parts.push(part.id);
    }
    for (const link of design.noteLinks || []) {
      if (!link || lower.has(link.toLowerCase())) continue;
      // A part's link of the same name, in any case, is the same finding.
      const same = [...byLink.keys()].find((key) => key.toLowerCase() === link.toLowerCase());
      entry(same ?? link).notes = true;
    }
    for (const [link, { parts, notes }] of byLink) {
      const { to, candidates } = formerlyNamed(designs, link, { anyCase: !parts.length });
      out.push({ design: design.id, name: design.name, link, parts, ...(notes ? { notes } : {}), to, candidates });
    }
  }
  return out;
}

/** Where a broken link is: its parts, and the notes when they link too. */
export function brokenLinkPlaces(broken) {
  return [...broken.parts, ...(broken.notes ? ['notes'] : [])].join(', ');
}

/** The designs that were saved as `link` but are called something else
 *  now: `{ to, candidates }`, `to` the one name when there is exactly one.
 *  `anyCase` compares names as a notes' link does. */
export function formerlyNamed(designs, link, { anyCase = false } = {}) {
  const key = (name) => (anyCase ? String(name).toLowerCase() : name);
  const candidates = designs
    .filter((design) => key(design.name) !== key(link) && (design.names || []).some((name) => key(name) === key(link)))
    .map((design) => design.name);
  return { to: candidates.length === 1 ? candidates[0] : null, candidates };
}
