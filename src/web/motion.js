/**
 * Reduced motion: the system's preference, or the app's own setting
 * (Settings → Reduce animations). While either asks for it the root element
 * carries `data-reduce-motion`, which the stylesheet's reduced-motion rules
 * key on, and reducedMotion() is what scripted animations ask.
 */

const SETTING_KEY = 'mosfeteer.reduceMotion';

const query = globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)') || null;

let setting = (() => {
  try { return globalThis.localStorage?.getItem(SETTING_KEY) === '1'; } catch { return false; }
})();

/** Whether to leave animations out, by the system's choice or the app's. */
export function reducedMotion() {
  return setting || !!query?.matches;
}

/** The app's own setting, whatever the system says. */
export function reduceMotionSetting() {
  return setting;
}

export function setReduceMotionSetting(on) {
  setting = !!on;
  try { globalThis.localStorage?.setItem(SETTING_KEY, setting ? '1' : ''); } catch { /* per-session only */ }
  syncReducedMotion();
}

function syncReducedMotion() {
  globalThis.document?.documentElement?.toggleAttribute('data-reduce-motion', reducedMotion());
}

query?.addEventListener?.('change', syncReducedMotion);
syncReducedMotion();
