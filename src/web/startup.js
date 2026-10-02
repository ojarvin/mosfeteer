import { reducedMotion } from './motion.js';

/** Keep the first frame covered until its document or Atlas drawings are ready. */
let reveal = null;

export function revealStartup() {
  if (reveal) return reveal;
  const cover = document.getElementById('startup-cover');
  if (!cover) return Promise.resolve();
  const reduced = reducedMotion();
  reveal = cover.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: reduced ? 0 : 700, easing: 'ease-out', fill: 'forwards',
  }).finished.finally(() => cover.remove());
  return reveal;
}
