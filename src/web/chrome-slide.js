/**
 * The toolbars step aside for a camera move: the ones on screen slide off
 * toward their own edge of the window, the camera moves, and the next view's
 * toolbars slide in. Each set is marked in the page by its edge
 * (`data-editor-edge` for the editor's, `data-atlas-edge` for the Atlas's)
 * and is away while its root carries `chrome-away` (style.css). With reduced
 * motion they simply go and come.
 */

import { reducedMotion } from './motion.js';

const CHROME_SLIDE_MS = 180;


/** Slide the toolbars under `root` away (`away` true) or back. Resolves when
 *  they have arrived; at once when `animate` is false, with reduced motion,
 *  or when they are already there. */
export function slideChrome(root, away, { animate = true } = {}) {
  if (!root || root.classList.contains('chrome-away') === away) return Promise.resolve();
  if (!animate || reducedMotion()) {
    // No transition: the class change lands in one frame.
    root.classList.add('chrome-instant');
    root.classList.toggle('chrome-away', away);
    void root.offsetWidth;
    root.classList.remove('chrome-instant');
    return Promise.resolve();
  }
  root.classList.toggle('chrome-away', away);
  return new Promise((resolve) => setTimeout(resolve, CHROME_SLIDE_MS));
}
