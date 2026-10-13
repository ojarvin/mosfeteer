import { reducedMotion } from './motion.js';

/** Keep the first frame covered until its document or Atlas drawings are ready. */
let reveal = null;

export function revealStartup() {
  if (reveal) return reveal;
  const cover = document.getElementById('startup-cover');
  if (!cover) return Promise.resolve();
  const reduced = reducedMotion();
  // Fading, it no longer stands in the way: what shows through takes input.
  cover.style.pointerEvents = 'none';
  reveal = cover.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: reduced ? 0 : 700, easing: 'ease-out', fill: 'forwards',
  }).finished.finally(() => cover.remove());
  return reveal;
}

/** Whether the editor opens onto the Atlas: no file was asked for, and
 *  either several designs are there to choose from, or (browser-only) none
 *  is open yet and the Atlas offers a new one, a file, or a folder. A
 *  design waiting for the browser's permission again does not count. */
export function opensOnAtlas({ openPath = '', documents = [], browserOnly = false }) {
  const designs = documents.filter((doc) => doc.kind === 'circuit' && !doc.locked).length;
  return !openPath && (designs > 1 || (browserOnly && designs === 0));
}
