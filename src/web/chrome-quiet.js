/**
 * The chrome steps back while the hand is on the drawing: while a part, a
 * label, or a wire is being moved, a wire is being drawn, or the view is
 * being panned, the root element carries `data-chrome-quiet` and the
 * stylesheet dims the toolbar, the tool rail, and the floating windows. A
 * zoom box and a selection box leave them as they are.
 */

/** Drags that pick rather than change the drawing or move the view. */
const LOOKING = new Set(['zoom', 'marquee', 'deletemarquee', 'radialpending', 'wirepick']);

/** Whether the chrome steps back for this drag and wire in progress. A pan
 *  does from its press to its release. */
export function chromeQuiet(drag, wire) {
  if (wire?.source || wire?.points?.length) return true;
  if (drag?.mode === 'pan') return true;
  return !!drag?.moved && !LOOKING.has(drag.mode);
}

/** Mark the root by the editor's drag and wire; render() calls it. */
export function syncChromeQuiet(drag, wire) {
  globalThis.document?.documentElement?.toggleAttribute('data-chrome-quiet', chromeQuiet(drag, wire));
}
