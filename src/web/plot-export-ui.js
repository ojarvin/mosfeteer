/**
 * Export data… (any plot's right-click menu): the plot's numbers as a CSV
 * file (core/plot-export.js). The curves to include, the separator, and the
 * decimal sign are chosen over a preview of the first rows; Save asks where
 * (or downloads), Copy puts the text on the clipboard.
 */

import { element as el } from './dom.js';
import { plotCsv, plotSeries, seriesTable } from '../core/plot-export.js';
import { logLine } from './status-bar-ui.js';
import { canvasEl } from './elements.js';

const PREVIEW_ROWS = 8;
const SEPARATORS = [[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab']];
const KIND_NAMES = { response: 'response', step: 'step-response', wave: 'waveforms', swing: 'swing', locus: 'root-locus', data: 'data' };

/** A file name for the plot's data: its file's, else its kind's. */
function suggestedName(plot) {
  const file = plot.kind === 'data' && plot.file ? plot.file.split(', ')[0].replace(/\.[^.]*$/, '') : '';
  return `${file || KIND_NAMES[plot.kind] || 'bode'}.csv`;
}

/** Save `text` as `name`: where the save picker says, else as a download. */
async function saveText(text, name) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }] });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return handle.name;
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      if (error?.name !== 'NotSupportedError' && error?.name !== 'SecurityError') throw error;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const link = el('a', { href: url, download: name, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return name;
}

/** The export dialog for the plot box `box`. */
export function openPlotExport(box) {
  if (!box?.plot) return;
  const series = plotSeries(box.plot);
  const chosen = new Set(series.map((_, i) => i));
  let separator = ',';
  let decimal = '.';
  const select = (label, id, choices, value, onchange) => el('label', { class: 'data-plot-field', for: id }, [
    el('span', { text: label }),
    el('select', { id, onchange: (ev) => onchange(ev.target.value) }, choices.map(([v, t]) => el('option', { value: v, text: t, selected: v === value }))),
  ]);
  const form = el('div', { class: 'data-plot-form' });
  const preview = el('div', { class: 'data-plot-table', role: 'region', 'aria-label': 'The first rows', tabindex: '0' });
  const status = el('p', { class: 'field-hint', 'aria-live': 'polite' });
  const save = el('button', { type: 'button', class: 'primary-action', text: 'Save…' });
  const copy = el('button', { type: 'button', text: 'Copy' });
  const csv = () => plotCsv(box.plot, { traces: [...chosen].sort((a, b) => a - b), separator, decimal });

  function draw() {
    form.replaceChildren(
      el('fieldset', { class: 'data-plot-y' }, [
        el('legend', { text: 'Traces' }),
        ...series.map((s, i) => el('label', {}, [
          el('input', { type: 'checkbox', 'data-trace': String(i), checked: chosen.has(i), onchange: (ev) => { if (ev.target.checked) chosen.add(i); else chosen.delete(i); draw(); } }),
          ` ${s.name}`,
        ])),
      ]),
      select('Separator', 'plot-export-separator', SEPARATORS, separator, (v) => { separator = v; if (v === ',' && decimal === ',') decimal = '.'; draw(); }),
      select('Decimal sign', 'plot-export-decimal', [['.', 'Point'], [',', 'Comma']], decimal, (v) => { decimal = v; if (v === ',' && separator === ',') separator = ';'; draw(); }),
    );
    save.disabled = !chosen.size;
    copy.disabled = !chosen.size;
    if (!chosen.size) {
      preview.replaceChildren();
      status.textContent = 'Choose a trace to export.';
      return;
    }
    const table = seriesTable([...chosen].sort((a, b) => a - b).map((i) => series[i]));
    const number = (v) => (v === null || !Number.isFinite(v) ? '' : decimal === ',' ? String(v).replace('.', ',') : String(v));
    preview.replaceChildren(el('table', {}, [
      el('thead', {}, [el('tr', {}, table.header.map((text) => el('th', { text })))]),
      el('tbody', {}, table.rows.slice(0, PREVIEW_ROWS).map((row) => el('tr', {}, row.map((v) => el('td', { text: number(v) }))))),
    ]));
    status.textContent = `${table.rows.length} rows, ${table.header.length} columns. The numbers as the plot keeps them.`;
  }

  save.addEventListener('click', async () => {
    const text = csv();
    dialog.close();
    try {
      const saved = await saveText(text, suggestedName(box.plot));
      if (saved) logLine(`saved the plot's data as ${saved}`);
    } catch (error) {
      logLine(`could not save the plot's data: ${error.message}`, 'error');
    }
  });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(csv());
      logLine('copied the plot\'s data as CSV');
    } catch (error) {
      logLine(`could not copy the plot's data: ${error.message}`, 'error');
    }
  });

  const dialog = el('dialog', { class: 'confirm-dialog data-plot-dialog', 'aria-label': 'Export plot data' });
  dialog.append(
    el('h2', { text: 'Export plot data' }),
    form, preview, status,
    el('div', { class: 'dialog-actions' }, [el('button', { type: 'button', text: 'Cancel', onclick: () => dialog.close() }), copy, save]),
  );
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('close', () => {
    dialog.remove();
    canvasEl.focus({ preventScroll: true });
  }, { once: true });
  draw();
  document.body.append(dialog);
  dialog.showModal();
  save.focus();
}
