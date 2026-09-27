/**
 * Exporting the drawing: the export dialog (formats, folder, beat, selection,
 * page guide), writing the files, and copying the drawing as an image. The
 * drawing itself comes from core/document.js and drawing-export.js.
 */

import { resolveBeat } from '../core/beats.js';
import { circuitPageGuideFrame, pageGuideCaption } from '../core/page-guide.js';
import { DEFAULT_EXPORT_TEXT_PT, normalizePngDpi, pngRasterScale } from '../core/png-export.js';
import { renderDocument } from '../core/document.js';
import { DRAWING_EXPORT_OPTIONS, hasDrawableSelection, selectionDrawing, selectionSubset } from '../core/selection-drawing.js';
import { svgPixelSize } from '../core/render.js';
import { svgToPngDataUrl, applyExportDarkTheme, withEmbeddedMathFont } from './drawing-export.js';
import { writeDrawingToClipboard } from './clipboard.js';
import { defaultExportDirectory, validDocumentName } from './persistence.js';
import { confirmChoice, showFileDialog } from './file-dialog.js';
import { circuitNameEl, exportCircuitBtn, exportDialog, exportForm, exportCancel } from './elements.js';
import { logLine, renderStatus } from './status-bar-ui.js';
import { activeBeatIndex, beatLabel } from './beats-ui.js';
import { persistence, displayPath } from './document-session.js';
import { editor } from './editor-state.js';
import { copySelectionSource } from './copy-paste.js';
import { render, syncRenderedLabelMetrics } from './main.js';

const exportGridInput = exportForm?.querySelector('input[name="grid"]');

const exportDarkInput = exportForm?.querySelector('input[name="dark"]');

const exportSelectionInput = exportForm?.querySelector('input[name="selection"]');

// The selection as it stood when the export dialog opened.
let exportSelection = null;

let clipboardNoticeTimer = null;

let imageCopyInFlight = false;

// A PDF that falls back to an image keeps this fine raster whatever the PNG DPI.
const PDF_FALLBACK_PNG_SCALE = 3;
// ...but no side longer than this, which a whole Atlas sheet would pass.
const PDF_FALLBACK_MAX_PX = 4096;

// What the open dialog exports: null for the document, or the Atlas sheet
// ({ name, key, summary, build({ grid }) -> { svg, scale, count } }).
let exportTarget = null;

/** The remembered PNG resolution (export dialog), also used by copied images. */
function exportPngDpi() {
  try { return normalizePngDpi(JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) || 'null')?.pngDpi); } catch { return normalizePngDpi(null); }
}

/** PNG pixels per unit: label text at the page guide's size, else 10 pt, at `dpi`. */
function exportPngScale(dpi) {
  return pngRasterScale(dpi, editor.pageGuide?.textPt ?? DEFAULT_EXPORT_TEXT_PT);
}

function reportImageCopy(text, error = false) {
  editor.clipboardNotice = text;
  clearTimeout(clipboardNoticeTimer);
  logLine(text, error ? 'error' : 'status');
  renderStatus();
  clipboardNoticeTimer = setTimeout(() => { editor.clipboardNotice = ''; renderStatus(); }, 8000);
}

export async function copyAsImage() {
  if (imageCopyInFlight) return;
  imageCopyInFlight = true;
  try {
    // Capture the selected model synchronously; ClipboardItem's promised
    // payloads let the write start within this same user gesture.
    const svg = selectionDrawing(editor.circuit, copySelectionSource());
    const dpi = exportPngDpi();
    const write = writeDrawingToClipboard(svg, { dpi, scale: exportPngScale(dpi) });
    reportImageCopy('Copying image…');
    await write;
    reportImageCopy('Copied image — paste into another app.');
  } catch (err) {
    reportImageCopy(`Could not copy image: ${err.message}`, true);
  } finally {
    imageCopyInFlight = false;
  }
}

/**
 * `beat` is null for the whole drawing, a beat index for that beat, or 'all'
 * for every beat: numbered SVG and PNG files (`name-1`, `name-2`, ...) and
 * one PDF (`name.pdf`) with a page per beat. Beats share the whole drawing's
 * frame, so the files and pages line up when stepped through.
 */
async function runExport({ dir, name, formats, grid = false, dark = false, pngDpi = normalizePngDpi(null), selection = null, beat = null }) {
  const supportedFormats = persistence.supportedExportFormats || new Set(formats);
  const unsupported = formats.filter((format) => !supportedFormats.has(format));
  if (unsupported.length) {
    logLine(`Could not export: ${unsupported.join(', ')} export is unavailable in this mode.`, 'error');
    return;
  }
  const allBeats = beat === 'all';
  const onePdf = allBeats && formats.includes('pdf');
  const jobs = allBeats
    ? editor.circuit.beats.map((_, index) => ({ name: `${name}-${index + 1}`, beat: index, formats: formats.filter((format) => format !== 'pdf') }))
    : [{ name, beat, formats }];
  try {
    const files = [...jobs.flatMap((job) => job.formats.map((format) => `${job.name}.${format}`)), ...(onePdf ? [`${name}.pdf`] : [])];
    logLine(`Exporting ${files.join(', ')}…`);
    // Reserve a native PNG save target while the submit event still carries
    // user activation. Rasterization below is asynchronous and may otherwise
    // make a later download click get blocked by the browser. A set of beat
    // files is downloaded instead of asking for each one.
    const prepared = persistence.prepareExport && jobs.length === 1
      ? await persistence.prepareExport({ name, formats })
      : null;
    // A MathML label can acquire its final browser-sized box after the last
    // canvas paint. Sync it before taking bounds for the exported viewBox.
    for (let attempt = 0; attempt < 3 && syncRenderedLabelMetrics(); attempt += 1) {
      editor.committedCanvasKey = '';
      render();
    }
    // Only the selection: the same export, of the selected subset alone.
    const drawing = selection ? selectionSubset(editor.circuit, selection) : editor.circuit;
    if (editor.pageGuide) {
      const frame = circuitPageGuideFrame(drawing, editor.pageGuide, DRAWING_EXPORT_OPTIONS.padding);
      logLine(frame.fits
        ? `Padded to the page guide: ${pageGuideCaption(editor.pageGuide)}.`
        : `The drawing is wider than the page guide; at full width its text is ${frame.textPt.toFixed(1)} pt.`);
    }
    let overwrite = false;
    const paths = [];
    const notes = new Set();
    let folder = dir;
    const others = allBeats ? ' Replacing overwrites them, and any other beat files with this name.' : '';
    // Write one request's files; false when the user keeps existing ones.
    const write = async (request) => {
      const result = await writeExportFiles(request, { prepared, overwrite, others });
      if (!result) {
        logLine(paths.length ? `Export stopped after ${paths.length} file${paths.length === 1 ? '' : 's'}.` : 'Export canceled.');
        return false;
      }
      overwrite = result.overwrite;
      paths.push(...result.paths);
      folder = result.dir;
      for (const note of result.notes || []) notes.add(note);
      return true;
    };
    const pages = [];
    for (const job of jobs) {
      const view = job.beat === null ? null : resolveBeat(editor.circuit, job.beat);
      const renderedSvg = renderDocument(drawing, {
        ...DRAWING_EXPORT_OPTIONS,
        grid,
        pageGuide: editor.pageGuide,
        ...(view ? { beat: { view } } : {}),
      });
      const svg = await withEmbeddedMathFont(dark ? applyExportDarkTheme(renderedSvg) : renderedSvg);
      if (onePdf) pages.push(svg);
      if (!job.formats.length) continue;
      const request = { dir, name: job.name, formats: job.formats, svg };
      if (job.formats.includes('png')) request.png = await svgToPngDataUrl(svg, exportPngScale(pngDpi), { dpi: pngDpi });
      if (job.formats.includes('pdf')) request.pdfPng = await svgToPngDataUrl(svg, PDF_FALLBACK_PNG_SCALE);
      if (!await write(request)) return;
    }
    // Every beat: one PDF, a page per beat, for presenting or handing out.
    if (onePdf) {
      const pdfPngPages = [];
      for (const page of pages) pdfPngPages.push(await svgToPngDataUrl(page, PDF_FALLBACK_PNG_SCALE));
      if (!await write({ dir, name, formats: ['pdf'], svg: pages[0], pdfPages: pages, pdfPngPages })) return;
    }
    logLine(`Exported ${paths.map((path) => path.split(/[\\/]/).pop()).join(', ')} to ${displayPath(folder)}.`);
    for (const note of notes) logLine(note);
  } catch (err) {
    logLine(`Could not export: ${err.message}`, 'error');
  }
}

/** Write one export's files, asking before replacing any. Resolves to the
 *  server's result plus whether replacing was agreed to, or null when the
 *  user keeps the existing files. */
async function writeExportFiles(request, { prepared = null, overwrite = false, others = '' } = {}) {
  try {
    return { ...await persistence.exportFiles({ ...request, ...(overwrite ? { overwrite: true } : {}) }, { prepared }), overwrite };
  } catch (err) {
    if (err.code !== 'exists') throw err;
    const files = (err.existing || []).map((path) => path.split(/[\\/]/).pop());
    const replace = await confirmChoice({
      title: files.length === 1 ? 'Replace existing file?' : 'Replace existing files?',
      message: `${files.join(', ')} already ${files.length === 1 ? 'exists' : 'exist'} in ${displayPath(request.dir)}.${others || ` Replacing overwrites ${files.length === 1 ? 'it' : 'them'}.`}`,
      confirmLabel: 'Replace',
      danger: true,
    });
    if (!replace) return null;
    return { ...await persistence.exportFiles({ ...request, overwrite: true }, { prepared }), overwrite: true };
  }
}

/** The Atlas sheet: every design on the desk on one vector page. */
async function runAtlasExport({ dir, name, formats, grid = false, dark = false, target }) {
  const supportedFormats = persistence.supportedExportFormats || new Set(formats);
  const unsupported = formats.filter((format) => !supportedFormats.has(format));
  if (unsupported.length) {
    logLine(`Could not export: ${unsupported.join(', ')} export is unavailable in this mode.`, 'error');
    return;
  }
  const report = (text, kind) => {
    logLine(text, kind);
    target.onStatus?.(text);
  };
  try {
    report(`Exporting ${formats.map((format) => `${name}.${format}`).join(', ')}…`);
    const prepared = persistence.prepareExport ? await persistence.prepareExport({ name, formats }) : null;
    const { svg: sheet, scale, count } = target.build({ grid });
    const svg = await withEmbeddedMathFont(dark ? applyExportDarkTheme(sheet) : sheet);
    const request = { dir, name, formats, svg };
    if (formats.includes('pdf')) {
      const { width, height } = svgPixelSize(svg);
      request.pdfPng = await svgToPngDataUrl(svg, Math.min(PDF_FALLBACK_PNG_SCALE, PDF_FALLBACK_MAX_PX / Math.max(width, height)));
    }
    const result = await writeExportFiles(request, { prepared });
    if (!result) {
      report('Export canceled.');
      return;
    }
    report(`Exported ${count} design${count === 1 ? '' : 's'} to ${result.paths.map((path) => path.split(/[\\/]/).pop()).join(', ')} in ${displayPath(result.dir)}.`);
    if (scale < 1) report(`The sheet is larger than a PDF page can be, so its page is ${Math.round(scale * 100)}% of real size.`);
    for (const note of result.notes || []) logLine(note);
  } catch (err) {
    report(`Could not export: ${err.message}`, 'error');
  }
}

/** The export dialog offers beats only when the document has them, starting
 * from the beat on screen. A beat is exported whole, never as a selection. */
function syncExportBeatChoice() {
  const row = document.getElementById('export-beat-row');
  const select = document.getElementById('export-beat');
  if (!row || !select) return;
  row.hidden = !editor.circuit.beats.length;
  select.replaceChildren();
  const option = (value, text) => {
    const el = document.createElement('option');
    el.value = value;
    el.textContent = text;
    select.appendChild(el);
  };
  option('', 'Whole drawing');
  editor.circuit.beats.forEach((_, index) => option(String(index), beatLabel(index)));
  if (editor.circuit.beats.length) option('all', `Every beat (a ${editor.circuit.beats.length}-page PDF; numbered SVG and PNG files)`);
  const active = activeBeatIndex();
  select.value = active === null ? '' : String(active);
  syncExportSelectionForBeat();
}

function syncExportSelectionForBeat() {
  const beatChosen = !!document.getElementById('export-beat')?.value;
  if (!exportSelectionInput) return;
  const disabled = !exportSelection || beatChosen;
  if (beatChosen) exportSelectionInput.checked = false;
  exportSelectionInput.disabled = disabled;
  exportSelectionInput.closest('label')?.classList.toggle('disabled', disabled);
}

function chosenExportBeat() {
  const value = document.getElementById('export-beat')?.value || '';
  if (!value || !editor.circuit.beats.length) return null;
  return value === 'all' ? 'all' : Number(value);
}

const EXPORT_SETTINGS_KEY = 'mosfeteer:export';

let exportFolder = '';

function renderExportLocation() {
  const folderEl = document.getElementById('export-folder');
  if (folderEl) {
    folderEl.textContent = displayPath(exportFolder) || 'Choose a folder';
    folderEl.title = exportFolder;
  }
  const formats = [...exportForm.querySelectorAll('input[name="format"]:checked')].map((input) => `.${input.value}`);
  const extensions = document.getElementById('export-extensions');
  if (extensions) extensions.textContent = formats.join(' ');
  const dpi = exportForm.querySelector('select[name="pngDpi"]');
  if (dpi) dpi.disabled = !formats.includes('.png');
  const submit = document.getElementById('export-submit');
  if (submit) submit.disabled = !formats.length || !exportFolder || !validDocumentName(document.getElementById('export-name')?.value);
}

/**
 * Exports default to print-ready output (light, no grid) in the OS Pictures
 * folder in Node mode, or the browser download location in browser-only mode.
 * Formats, appearance, and a folder chosen for this document are remembered.
 */
export function exportCircuit() {
  exportTarget = null;
  setExportDialogTarget();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) || 'null'); } catch { /* storage unavailable */ }
  if (exportGridInput) exportGridInput.checked = saved?.grid === true;
  if (exportDarkInput) exportDarkInput.checked = saved?.dark === true;
  const dpiSelect = exportForm.querySelector('select[name="pngDpi"]');
  if (dpiSelect) dpiSelect.value = String(normalizePngDpi(saved?.pngDpi));
  // Selection-only is offered per export, never remembered: a later export
  // with nothing selected must not silently shrink to a stale choice.
  const source = copySelectionSource();
  exportSelection = hasDrawableSelection(source)
    ? { refs: new Set(source.refs), labels: [...source.labels], netIds: new Set(source.netIds), wireKeys: new Set(source.wireKeys) }
    : null;
  if (exportSelectionInput) {
    exportSelectionInput.checked = false;
    exportSelectionInput.disabled = !exportSelection;
    exportSelectionInput.closest('label')?.classList.toggle('disabled', !exportSelection);
  }
  const selectionCount = document.getElementById('export-selection-count');
  if (selectionCount) {
    const count = exportSelection ? exportSelection.refs.size + exportSelection.labels.length + exportSelection.netIds.size + exportSelection.wireKeys.size : 0;
    selectionCount.textContent = exportSelection ? `(${count} selected)` : '(nothing selected)';
  }
  // The Atlas's export shares these boxes: set every one.
  for (const input of exportForm.querySelectorAll('input[name="format"]')) {
    const supported = persistence.supportedExportFormats?.has(input.value) ?? true;
    input.checked = supported && (Array.isArray(saved?.formats) ? saved.formats.includes(input.value) : input.defaultChecked);
  }
  syncExportBeatChoice();
  const documentKey = editor.currentDocumentPath || '';
  const defaultFolder = defaultExportDirectory(editor.workspaceState, { browserOnly: persistence.browserOnly });
  exportFolder = (saved?.folders && saved.folders[documentKey]) || defaultFolder;
  const nameInput = document.getElementById('export-name');
  if (nameInput) nameInput.value = validDocumentName(circuitNameEl.value) || editor.currentCircuitName || 'circuit';
  renderExportLocation();
  exportDialog?.showModal();
}

/** Dress the dialog for what it exports: the document, or the Atlas sheet. */
function setExportDialogTarget() {
  if (!exportDialog) return;
  exportDialog.dataset.target = exportTarget ? 'atlas' : 'document';
  const title = document.getElementById('export-dialog-title');
  if (title) title.textContent = exportTarget ? 'Export atlas' : 'Export document';
  const content = document.getElementById('export-atlas-content');
  if (content) {
    content.hidden = !exportTarget;
    content.textContent = exportTarget?.summary || '';
  }
}

/**
 * The Atlas's Export: the same dialog, for one sheet of every design on the
 * desk. SVG and PDF only; the grid and dark choices are the document
 * export's, the formats and folder its own.
 */
export function exportAtlasSheet(target) {
  exportTarget = target;
  setExportDialogTarget();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) || 'null'); } catch { /* storage unavailable */ }
  if (exportGridInput) exportGridInput.checked = saved?.grid === true;
  if (exportDarkInput) exportDarkInput.checked = saved?.dark === true;
  const formats = Array.isArray(saved?.atlasFormats) ? saved.atlasFormats : ['pdf'];
  for (const input of exportForm.querySelectorAll('input[name="format"]')) {
    const supported = persistence.supportedExportFormats?.has(input.value) ?? true;
    input.checked = input.value !== 'png' && supported && formats.includes(input.value);
  }
  // Without PDF (browser-only), the sheet is an SVG.
  if (![...exportForm.querySelectorAll('input[name="format"]:checked')].length) {
    const svgInput = exportForm.querySelector('input[name="format"][value="svg"]');
    if (svgInput) svgInput.checked = true;
  }
  exportFolder = (saved?.folders && saved.folders[target.key]) || defaultExportDirectory(editor.workspaceState, { browserOnly: persistence.browserOnly });
  const nameInput = document.getElementById('export-name');
  if (nameInput) nameInput.value = validDocumentName(target.name) || 'atlas';
  renderExportLocation();
  exportDialog?.showModal();
}

export function installExportUi() {
  exportCircuitBtn?.addEventListener('click', exportCircuit);

  exportCancel?.addEventListener('click', () => exportDialog?.close());

  exportForm?.addEventListener('input', renderExportLocation);

  document.getElementById('export-beat')?.addEventListener('change', syncExportSelectionForBeat);

  exportForm?.addEventListener('change', renderExportLocation);

  document.getElementById('export-choose-folder')?.addEventListener('click', async () => {
    const choice = await showFileDialog(persistence, { mode: 'folder', dir: exportFolder, title: 'Choose export folder' });
    if (!choice) return;
    exportFolder = choice.path;
    renderExportLocation();
  });

  exportForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formats = [...exportForm.querySelectorAll('input[name="format"]:checked')].map((input) => input.value);
    const name = validDocumentName(document.getElementById('export-name')?.value);
    if (!formats.length || !name || !exportFolder) return;
    exportDialog.close();
    if (exportTarget) {
      const target = exportTarget;
      const settings = { grid: exportGridInput?.checked === true, dark: exportDarkInput?.checked === true };
      const vectorFormats = formats.filter((format) => format !== 'png');
      try {
        const saved = JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) || 'null') || {};
        const folders = { ...(saved.folders || {}) };
        if (exportFolder === defaultExportDirectory(editor.workspaceState, { browserOnly: persistence.browserOnly })) delete folders[target.key];
        else folders[target.key] = exportFolder;
        localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify({ ...saved, ...settings, atlasFormats: vectorFormats, folders }));
      } catch { /* storage unavailable */ }
      runAtlasExport({ dir: exportFolder, name, formats: vectorFormats, ...settings, target });
      return;
    }
    const settings = {
      grid: exportGridInput?.checked === true,
      dark: exportDarkInput?.checked === true,
      pngDpi: normalizePngDpi(exportForm.querySelector('select[name="pngDpi"]')?.value),
    };
    try {
      const saved = JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) || 'null') || {};
      // Remember a folder only when it differs from the document's own folder.
      const folders = { ...(saved.folders || {}) };
      const documentKey = editor.currentDocumentPath || '';
      const defaultFolder = defaultExportDirectory(editor.workspaceState, { browserOnly: persistence.browserOnly });
      if (exportFolder === defaultFolder || exportFolder === editor.currentDocumentDir) delete folders[documentKey];
      else folders[documentKey] = exportFolder;
      localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify({ ...saved, ...settings, formats, folders }));
    } catch { /* storage unavailable */ }
    const selection = exportSelectionInput?.checked && exportSelection ? exportSelection : null;
    runExport({ dir: exportFolder, name, formats, ...settings, selection, beat: chosenExportBeat() });
  });
}
