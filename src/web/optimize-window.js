/**
 * The window a coefficient search runs in (optimize-ui.js: the optimizer
 * and the rounding): one small floating window over the drawing, so it is
 * plain that this is the run. It shows the specs' transfer functions at the
 * numbers the run started from (grey) and at its best so far (in colour),
 * redrawn as each new best is found, with the progress bar, the status
 * line, and Stop -- which turns to Close when the run is over.
 */

import { canvasEl } from './elements.js';
import { PLACE, floatingWindow } from './floating-window.js';

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children);
  return node;
};

let open = null;

/**
 * Open the run window. `title` names the run ("Optimizer", "Rounding");
 * `plotAt(values, role)` returns the plot's SVG element for the numbers
 * given -- role 'start' or 'best' -- or null; `onStop` stops the run.
 * Returns `{ say(text, error), progress(fraction), best(values), done(text,
 * error) }`.
 */
export function openRunWindow({ title, plotAt, onStop }) {
  open?.dispose();
  let finished = false;
  let startValues = null;
  const status = el('p', { class: 'field-hint run-window-status', 'aria-live': 'polite', text: 'Preparing...' });
  const bar = el('progress', { class: 'run-window-progress', max: '1', value: '0' });
  const plot = el('div', { class: 'run-window-plot' });
  const legend = el('p', { class: 'field-hint run-window-legend', text: 'Grey: where it started. Colour: the best so far.' });
  const stop = el('button', { type: 'button', class: 'run-window-stop', text: 'Stop', onclick: () => (finished ? dispose() : onStop()) });
  const dialog = el('section', { class: 'floating-window run-window', 'aria-labelledby': 'run-window-title' }, [
    el('header', { class: 'floating-window-header' }, [
      el('h2', { id: 'run-window-title', class: 'floating-window-title', text: title }),
      el('button', { type: 'button', class: 'floating-window-close', 'aria-label': `Close the ${title.toLowerCase()} window`, title: 'Close (stops the run)', text: '×' }),
    ]),
    el('div', { class: 'run-window-body' }, [plot, legend, bar, status]),
    el('div', { class: 'dialog-actions run-window-actions' }, [stop]),
  ]);
  function dispose() {
    if (!finished) onStop();
    dialog.remove();
    if (open?.dialog === dialog) open = null;
  }
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') dispose();
  });
  canvasEl.closest('.canvas-pane').append(dialog);
  const handle = floatingWindow(dialog, { key: 'run', onClose: dispose, place: PLACE.topCenter });
  handle.place();
  open = { dialog, dispose };

  const draw = (values) => {
    const svg = plotAt({ start: startValues, best: values });
    plot.replaceChildren(...(svg ? [svg] : []));
    plot.hidden = !svg;
    legend.hidden = !svg;
  };
  return {
    start(values) { startValues = values; draw(null); },
    say(text, error = false) { status.textContent = text; status.classList.toggle('analysis-error', error); },
    progress(fraction) { bar.value = fraction; },
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
