/**
 * The drawing brought up to date in place: its new markup, parsed, is laid
 * over the mounted drawing and only the subtrees that differ are replaced.
 * A preview that moves one part of a large drawing then restyles and lays
 * out that part, not every element of the drawing again. The equal-subtree
 * test is the browser's own (`isEqualNode`), so unchanged branches cost a
 * native walk, no script.
 */

/** The top-level nodes of the mounted drawing that are its own markup's:
 *  the layers other modules add to its root (the overlay, a mask, the
 *  beams) are not, and are left where they are. */
const own = new WeakSet();

/** Mark `svg`'s children as its markup's own: right after it is parsed. */
export function adoptDrawing(svg) {
  for (const node of svg.childNodes) own.add(node);
}

function syncAttributes(target, next) {
  for (const { name } of [...target.attributes]) if (!next.hasAttribute(name)) target.removeAttribute(name);
  for (const { name, value } of next.attributes) if (target.getAttribute(name) !== value) target.setAttribute(name, value);
}

function patchNode(target, next) {
  if (target.isEqualNode(next)) return;
  if (target.nodeType !== 1 || target.nodeName !== next.nodeName || target.childNodes.length !== next.childNodes.length) {
    target.replaceWith(next);
    return;
  }
  syncAttributes(target, next);
  const fresh = [...next.childNodes];
  [...target.childNodes].forEach((child, i) => patchNode(child, fresh[i]));
}

/** Bring `target`'s children to `next`'s (a parsed copy of new markup),
 *  pair by pair; with another number of children, all swapped. */
export function patchChildren(target, next) {
  const old = [...target.childNodes];
  const fresh = [...next.childNodes];
  if (old.length !== fresh.length) {
    target.replaceChildren(...fresh);
    return;
  }
  old.forEach((node, i) => patchNode(node, fresh[i]));
}

/** Bring the mounted `svg` to `next` (its new markup, parsed): its root's
 *  attributes and its own children, the others' layers kept. */
export function patchDrawing(svg, next) {
  syncAttributes(svg, next);
  const old = [...svg.childNodes].filter((node) => own.has(node));
  const fresh = [...next.childNodes];
  if (old.length === fresh.length) {
    old.forEach((node, i) => {
      patchNode(node, fresh[i]);
      // Replaced whole, the new node is the drawing's now.
      if (fresh[i].parentNode === svg) own.add(fresh[i]);
    });
    return;
  }
  // Another number of layers: the drawing's own swapped whole, in its place.
  const before = old[0] || svg.firstChild;
  for (const node of fresh) {
    svg.insertBefore(node, before);
    own.add(node);
  }
  for (const node of old) node.remove();
}
