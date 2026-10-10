/**
 * The window a coefficient search runs in (optimize-ui.js: the optimizer
 * and the rounding): one small floating window over the drawing, so it is
 * plain that this is the run. It shows the specs' transfer functions at the
 * numbers the run started from (grey) and at its best so far (in colour),
 * redrawn as each new best is found, with the progress bar, the status
 * line, and Stop -- which turns to Close when the run is over. Closing the
 * window leaves the run going; its progress then shows in the analysis
 * window again (`onClose`).
 */

import { canvasEl } from './elements.js';
import { PLACE, floatingWindow } from './floating-window.js';
import { createPlotView } from './plot-view.js';
import { element as el } from './dom.js';


let open = null;

/**
 * Open the run window. `title` names the run ("Optimizer", "Rounding");
 * `plotAt({ start, best })` returns the plot's spec (plot-spec.js) for the numbers
 * given -- role 'start' or 'best' -- or null; `onStop` stops the run;
 * `onClose` is told when the window closes. Returns `{ say(text, error),
 * progress(fraction), best(values), done(text, error), isOpen() }`.
 */
export function openRunWindow({ title, plotAt, onStop, onClose = () => {} }) {
  open?.dispose();
  let finished = false;
  let startValues = null;
  const status = el('p', { class: 'field-hint run-window-status', 'aria-live': 'polite', text: 'Preparing...' });
  const bar = el('progress', { class: 'run-window-progress', max: '1', value: '0' });
  // The plot takes whatever room the window has: resize it for a larger one.
  const plotView = createPlotView({ height: 220, fill: true });
  const plot = el('div', { class: 'run-window-plot' }, [plotView.el]);
  const legend = el('p', { class: 'field-hint run-window-legend', text: 'Grey: where it started. Colour: the best so far.' });
  const stop = el('button', { type: 'button', class: 'run-window-stop', text: 'Stop', onclick: () => (finished ? dispose() : onStop()) });
  const dialog = el('section', { class: 'floating-window run-window', 'aria-labelledby': 'run-window-title' }, [
    el('header', { class: 'floating-window-header' }, [
      el('h2', { id: 'run-window-title', class: 'floating-window-title', text: title }),
      el('button', { type: 'button', class: 'floating-window-close', 'aria-label': `Close the ${title.toLowerCase()} window`, title: 'Close (the run goes on; Stop stops it)', text: '×' }),
    ]),
    el('div', { class: 'run-window-body' }, [plot, legend, bar, status]),
    el('div', { class: 'dialog-actions run-window-actions' }, [stop]),
  ]);
  let closed = false;
  function dispose() {
    if (closed) return;
    closed = true;
    dialog.remove();
    plotView.dispose();
    if (open?.dialog === dialog) open = null;
    onClose();
  }
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') dispose();
  });
  canvasEl.closest('.canvas-pane').append(dialog);
  const handle = floatingWindow(dialog, { key: 'run', onClose: dispose, place: PLACE.topCenter, resizable: true });
  handle.place();
  open = { dialog, dispose };

  const draw = (values) => {
    const spec = plotAt({ start: startValues, best: values });
    plotView.set(spec);
    plot.hidden = !spec;
    legend.hidden = !spec;
  };
  return {
    start(values) { startValues = values; draw(null); },
    say(text, error = false) { status.textContent = text; status.classList.toggle('analysis-error', error); },
    progress(fraction) { bar.value = fraction; },
    isOpen: () => !closed,
    best(values) { draw(values); },
    done(text, error = false) {
      finished = true;
      status.textContent = text;
      status.classList.toggle('analysis-error', error);
      bar.value = 1;
      stop.textContent = 'Close';
      stop.classList.add('primary-action');
    },
  };
}
