/**
 * The workspace check: what in a workspace's designs needs a hand. A link
 * naming a design no file is called is broken; a design renamed outside the
 * editor (in a file manager) still remembers the names it was saved under
 * (Circuit#savedNames), so the design a broken link meant can be found
 * again -- when exactly one design remembers that name. Two that do (a copy
 * made outside the editor) are never guessed between.
 */

/**
 * `designs`: [{ id, name, names?: [saved names], parts?: [{ id, link }] }].
 * Returns the broken links, one entry per design and missing name:
 * `{ design, name, link, parts: [refdes], to, candidates }` -- `to` the
 * design it most likely meant (null when none or several remember it),
 * `candidates` every design that remembers the name.
 */
export function brokenLinks(designs) {
  const names = new Set(designs.map((design) => design.name));
  const out = [];
  for (const design of designs) {
    const byLink = new Map();
    for (const part of design.parts || []) {
      if (!part.link || names.has(part.link)) continue;
      if (!byLink.has(part.link)) byLink.set(part.link, []);
      byLink.get(part.link).push(part.id);
    }
    for (const [link, parts] of byLink) {
      const { to, candidates } = formerlyNamed(designs, link);
      out.push({ design: design.id, name: design.name, link, parts, to, candidates });
    }
  }
  return out;
}

/** The designs that were saved as `link` but are called something else
 *  now: `{ to, candidates }`, `to` the one name when there is exactly one. */
export function formerlyNamed(designs, link) {
  const candidates = designs
    .filter((design) => design.name !== link && (design.names || []).includes(link))
    .map((design) => design.name);
  return { to: candidates.length === 1 ? candidates[0] : null, candidates };
}
