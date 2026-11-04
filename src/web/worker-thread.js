/**
 * Worker threads (optimize-worker.js) for work that would hold the page:
 * the optimizer's scoring, the simulated spectrum. From the module beside
 * the page, or -- opened from a file, where no worker script may load --
 * from the browser-only bundle's own source, run with the worker as its
 * entry (a blob).
 */

let workerUrl = null;

/** A new worker thread, or null where none can start (the work then runs
 *  in this thread). */
export function startWorker() {
  if (typeof Worker === 'undefined') return null;
  try {
    if (location.protocol !== 'file:') return new Worker('optimize-worker.js', { type: 'module' });
    const bundle = globalThis.__MOSFETEER_BUNDLE;
    if (!bundle) return null;
    workerUrl ||= URL.createObjectURL(new Blob([`(${bundle})("src/web/optimize-worker.js");`], { type: 'text/javascript' }));
    return new Worker(workerUrl);
  } catch {
    return null;
  }
}
