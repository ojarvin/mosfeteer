/**
 * The chrome steps back while the hand is on the drawing: while a part, a
 * label, or a wire is being moved, or a wire is being drawn, the root
 * element carries `data-chrome-quiet` and the stylesheet dims the toolbar,
 * the tool rail, and the floating windows. Panning, zooming, and a
 * selection box leave them as they are.
 */

/** Drags that look around or pick rather than change the drawing. */
const LOOKING = new Set(['pan', 'zoom', 'marquee', 'deletemarquee', 'radialpending', 'wirepick']);

/** Whether the chrome steps back for this drag and wire in progress. */
export function chromeQuiet(drag, wire) {
  if (wire?.source || wire?.points?.length) return true;
  return !!drag?.moved && !LOOKING.has(drag.mode);
}

/** Mark the root by the editor's drag and wire; render() calls it. */
export function syncChromeQuiet(drag, wire) {
  globalThis.document?.documentElement?.toggleAttribute('data-chrome-quiet', chromeQuiet(drag, wire));
}
