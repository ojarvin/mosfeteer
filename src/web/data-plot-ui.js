/**
 * Data plot (More menu): a text file's columns plotted on the drawing
 * (core/data-plot.js). A file is chosen, then a dialog shows how it reads --
 * the separator, decimal sign, and rows before the data, all guessed
 * (core/csv-data.js) and each changeable -- with the first rows as a table,
 * the columns to plot, each axis's scale, and the plot as it will be drawn.
 * The file is read once: the design keeps the traces, never the file. Given
 * a data plot, the dialog reads a file into that plot instead (Reload).
 */

import { element as el } from './dom.js';
import { MAX_DATA_TRACES, readTable } from '../core/csv-data.js';
import { dataPlot, placeDataPlot, replaceDataPlotTraces } from '../core/data-plot.js';
import { Circuit } from '../core/model.js';
import { svgString } from '../core/render.js';
import { editor } from './editor-state.js';
import { logLine } from './status-bar-ui.js';
import { canvasEl } from './elements.js';
import { alignLabelColumn, commit, render, setLabelSelection, setSelection } from './main.js';

/** Past this a file is refused rather than read into the page. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const PREVIEW_ROWS = 8;
const SEPARATORS = [[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab'], [' ', 'Spaces']];

/** Ask for a file, then open the dialog on it; `target` a data plot to
 *  read it into. */
export function chooseDataFile(target = null) {
  const input = el('input', { type: 'file', accept: '.csv,.tsv,.txt,.dat,.prn,text/csv,text/plain', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      logLine(`${file.name} is ${Math.round(file.size / 1e6)} MB; a data plot reads up to ${MAX_FILE_BYTES / 1e6} MB`, 'error');
      return;
    }
    openDataPlotDialog(await file.text(), file.name, target);
  }, { once: true });
  document.body.append(input);
  input.click();
}

/** The dialog on `text` (the file `name`): Place puts its plot on the
 *  drawing, or into `target`. */
export function openDataPlotDialog(text, name, target = null) {
  let options = {};
  let table = readTable(text);
  let x = table.x;
  let y = new Set(table.y);
  let scale = { ...table.scale };
  const dialog = el('dialog', { class: 'confirm-dialog data-plot-dialog', 'aria-label': 'Data plot' });
  const select = (label, id, choices, value, onchange) => el('label', { class: 'data-plot-field', for: id }, [
    el('span', { text: label }),
    el('select', { id, onchange: (ev) => onchange(ev.target.value) }, choices.map(([v, t]) => el('option', { value: v, text: t, selected: v === value }))),
  ]);
  const form = el('div', { class: 'data-plot-form' });
  const preview = el('div', { class: 'data-plot-table', role: 'region', 'aria-label': 'The first rows', tabindex: '0' });
  const columns = el('div', { class: 'data-plot-columns' });
  const picture = el('div', { class: 'data-plot-preview', 'aria-label': 'The plot', role: 'img' });
  const status = el('p', { class: 'field-hint', 'aria-live': 'polite' });
  const place = el('button', { type: 'button', class: 'primary-action', text: target ? 'Read into plot' : 'Place' });

  const reread = (change) => {
    options = { ...options, ...change };
    const before = table;
    table = readTable(text, options);
    // A new reading of the columns starts their choice over.
    if (before.names.length !== table.names.length || before.skip !== table.skip) {
      x = table.x;
      y = new Set(table.y);
      scale = { ...table.scale };
    }
    draw();
  };
  const plot = () => dataPlot(table, { x, y: [...y].filter((c) => c !== x).slice(0, MAX_DATA_TRACES), file: name, scale });

  function draw() {
    form.replaceChildren(
      select('Separator', 'data-plot-separator', SEPARATORS, table.separator, (v) => reread({ separator: v })),
      select('Decimal sign', 'data-plot-decimal', [['.', 'Point'], [',', 'Comma']], table.decimal, (v) => reread({ decimal: v })),
      el('label', { class: 'data-plot-field', for: 'data-plot-skip' }, [
        el('span', { text: 'Rows before the data' }),
        el('input', { id: 'data-plot-skip', type: 'number', min: '0', max: String(table.rows.length), value: String(table.skip), onchange: (ev) => reread({ skip: Math.max(0, Math.floor(Number(ev.target.value) || 0)) }) }),
      ]),
      el('label', { class: 'data-plot-check' }, [
        el('input', { type: 'checkbox', checked: table.header, disabled: !table.skip, onchange: (ev) => reread({ header: ev.target.checked }) }),
        ' The last of them names the columns',
      ]),
    );
    const rows = table.rows.slice(Math.max(0, table.skip - 3), table.skip + PREVIEW_ROWS);
    const width = Math.max(table.names.length, ...rows.map((row) => row.length));
    preview.replaceChildren(el('table', {}, [
      el('thead', {}, [el('tr', {}, Array.from({ length: width }, (_, c) => el('th', { text: table.names[c] || `Column ${c + 1}` })))]),
      el('tbody', {}, rows.map((row, i) => el('tr', { class: i + Math.max(0, table.skip - 3) < table.skip ? 'data-plot-skipped' : '' },
        Array.from({ length: width }, (_, c) => el('td', { text: row[c] ?? '' }))))),
    ]));
    const numeric = new Set(table.numeric);
    const xChoices = [['row', 'Row number'], ...table.numeric.map((c) => [String(c), table.names[c]])];
    columns.replaceChildren(
      select('X', 'data-plot-x', xChoices, x === null ? 'row' : String(x), (v) => { x = v === 'row' ? null : Number(v); y.delete(x); draw(); }),
      el('fieldset', { class: 'data-plot-y' }, [
        el('legend', { text: 'Y' }),
        ...table.names.map((n, c) => el('label', {}, [
          el('input', { type: 'checkbox', checked: y.has(c), disabled: !numeric.has(c) || c === x || (!y.has(c) && y.size >= MAX_DATA_TRACES), onchange: (ev) => { if (ev.target.checked) y.add(c); else y.delete(c); draw(); } }),
          ` ${n}`,
        ])),
      ]),
      select('X scale', 'data-plot-xscale', [['linear', 'Linear'], ['log', 'Log']], scale.x, (v) => { scale.x = v; draw(); }),
      select('Y scale', 'data-plot-yscale', [['linear', 'Linear'], ['log', 'Log']], scale.y, (v) => { scale.y = v; draw(); }),
    );
    const next = plot();
    place.disabled = !next;
    if (!next) {
      picture.replaceChildren();
      status.textContent = table.numeric.length ? 'Choose a column with two rows of numbers or more.' : 'No column of numbers: check the separator and the rows before the data.';
      return;
    }
    const points = next.traces.reduce((sum, trace) => sum + trace.points.length, 0);
    status.textContent = `${next.traces.length} trace${next.traces.length === 1 ? '' : 's'}, ${points} points kept from ${table.rows.length - table.skip} rows.`;
    const sketch = new Circuit();
    placeDataPlot(sketch, next, { at: { x: 0, y: 0 } });
    picture.innerHTML = svgString(sketch, { emptyHint: false, terminals: false });
  }

  place.addEventListener('click', () => {
    const next = plot();
    if (!next) return;
    dialog.close();
    let placed = null;
    commit(() => {
      if (target) placed = { box: target, legend: replaceDataPlotTraces(editor.circuit, target, next) };
      else placed = placeDataPlot(editor.circuit, next);
    });
    // The legend's sizes are estimates until the browser measures them.
    const legend = placed.legend;
    if (legend.length) alignLabelColumn(legend.map((label) => label.id), { left: Math.min(...legend.map((l) => l.bbox().x)), top: Math.min(...legend.map((l) => l.bbox().y)), gap: 0 });
    setSelection([]);
    setLabelSelection([placed.box.id]);
    logLine(target ? `read ${name} into the plot` : `plotted ${next.traces.length} trace${next.traces.length === 1 ? '' : 's'} from ${name}; drag to move it, its corners to resize`);
    render();
  });

  dialog.append(
    el('h2', { text: target ? `Read ${name} into the plot` : `Data plot from ${name}` }),
    form, preview, columns, picture, status,
    el('div', { class: 'dialog-actions' }, [el('button', { type: 'button', value: 'cancel', text: 'Cancel', onclick: () => dialog.close() }), place]),
  );
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('close', () => {
    dialog.remove();
    canvasEl.focus({ preventScroll: true });
  }, { once: true });
  draw();
  document.body.append(dialog);
  dialog.showModal();
  place.focus();
}

export function installDataPlotUi() {
  document.getElementById('btn-data-plot')?.addEventListener('click', () => chooseDataFile());
}
