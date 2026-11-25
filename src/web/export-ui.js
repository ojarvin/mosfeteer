/**
 * Exporting the drawing: the export dialog (formats, folder, beat, selection,
 * page guide), writing the files, and copying the drawing as an image. The
 * drawing itself comes from core/document.js and drawing-export.js. The
 * dialog also exports the report, the notes with their figures
 * (core/report.js), as HTML and PDF.
 */

import { printPagesHtml } from '../core/print-pages.js';
import { printHtml } from './print-pdf.js';
import { resolveBeat } from '../core/beats.js';
import { timingBeatBands } from '../core/timing-diagram.js';
import { circuitPageGuideFrame, normalizePageGuide, pageGuideCaption, pageGuideTitle } from '../core/page-guide.js';
import { DEFAULT_EXPORT_TEXT_PT, normalizePngDpi, pngRasterScale } from '../core/png-export.js';
import { renderDocument } from '../core/document.js';
import { DRAWING_EXPORT_OPTIONS, hasDrawableSelection, selectionDrawing, selectionSubset } from '../core/selection-drawing.js';
import { svgPixelSize } from '../core/render.js';
import { svgToPngDataUrl, applyExportDarkTheme, embeddedMathFontFace, withEmbeddedMathFont } from './drawing-export.js';
import { buildReport, embeddedDesignNames } from '../core/report.js';
import { loadDesign } from './example-designs.js';
import { loadDocument } from '../core/document.js';
import { writeDrawingToClipboard } from './clipboard.js';
import { defaultExportDirectory, validDocumentName } from './persistence.js';
import { confirmChoice, showFileDialog } from './file-dialog.js';
import { circuitNameEl, exportCircuitBtn, exportDialog, exportForm, exportCancel } from './elements.js';
import { logLine, renderStatus } from './status-bar-ui.js';
import { activeBeatIndex, beatLabel } from './beats-ui.js';
import { persistence, displayPath } from './document-session.js';
import { editor } from './editor-state.js';
import { copySelectionSource } from './copy-paste.js';
import { linkBubbleExtras, workspaceDesigns } from './hierarchy.js';
import { render, syncRenderedLabelMetrics } from './main.js';

const exportGridInput = exportForm?.querySelector('input[name="grid"]');
// The sketch (sketch-ui.js) goes in only when asked for, and is offered
// only when the design has one.
const exportSketchInput = exportForm?.querySelector('input[name="sketch"]');

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

// What the document's export writes: the drawing, or the report.
let exportContent = 'drawing';
/** The guide the dialog's ? opens, by what it exports (guides.js). */
const EXPORT_GUIDES = { drawing: 'export', report: 'report' };

// What the open dialog exports: null for the document, or the Atlas sheet
// ({ name, key, summary, build({ grid }) -> { svg, scale, count } }).
let exportTarget = null;

/** The export dialog's settings as this browser remembers them ({} with none). */
function savedExportSettings() {
  try { return JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) || 'null') || {}; } catch { return {}; }
}

/** Remember `changes` over the saved settings; `folder` ({ key, dir,
 *  remembered }) keeps an export folder by its document's key, or forgets it
 *  when it is the default one (`remembered` false). */
function rememberExportSettings(changes, folder = null) {
  const saved = savedExportSettings();
  const folders = { ...(saved.folders || {}) };
  if (folder?.remembered) folders[folder.key] = folder.dir;
  else if (folder) delete folders[folder.key];
  try { localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify({ ...saved, ...changes, ...(folder ? { folders } : {}) })); } catch { /* storage unavailable */ }
}

/** Whether `format` exports here (browser-only has no server PDF). */
const formatSupported = (format) => persistence.supportedExportFormats?.has(format) ?? true;

/** Whether every one of `formats` exports here; if not, the log says which. */
function formatsSupported(formats) {
  const unsupported = formats.filter((format) => !formatSupported(format));
  if (unsupported.length) logLine(`Could not export: ${unsupported.join(', ')} export is unavailable in this mode.`, 'error');
  return !unsupported.length;
}

/** Written files by name, for the log. */
const fileNames = (paths) => paths.map((path) => path.split(/[\\/]/).pop()).join(', ');

/** The remembered PNG resolution (export dialog), also used by copied images. */
export function exportPngDpi() {
  return normalizePngDpi(savedExportSettings().pngDpi);
}

/** PNG pixels per unit: label text at the page guide's size, else 10 pt, at `dpi`. */
export function exportPngScale(dpi) {
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
    const source = copySelectionSource();
    const extras = linkBubbleExtras(selectionSubset(editor.circuit, source));
    const svg = selectionDrawing(editor.circuit, source, { pageGuide: editor.pageGuide, ...(extras ? { extras } : {}) });
    const dpi = exportPngDpi();
    const write = writeDrawingToClipboard(svg, { dpi, scale: exportPngScale(dpi) });
    reportImageCopy('Copying image…');
    await write;
    reportImageCopy(`Copied image at ${dpi} dpi`);
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
async function runExport({ dir, name, formats, grid = false, dark = false, sketch = false, pngDpi = normalizePngDpi(null), selection = null, beat = null }) {
  if (!formatsSupported(formats)) return;
  const allBeats = beat === 'all';
  // Browser-only, the PDF is printed (print-pdf.js), every beat on a page of
  // its own, after the files are written.
  const printing = !!persistence.printsPdf && formats.includes('pdf');
  const fileFormats = printing ? formats.filter((format) => format !== 'pdf') : formats;
  const printed = [];
  const onePdf = allBeats && fileFormats.includes('pdf');
  const jobs = allBeats
    ? editor.circuit.beats.map((_, index) => ({ name: `${name}-${index + 1}`, beat: index, formats: fileFormats.filter((format) => format !== 'pdf') }))
    : [{ name, beat, formats: fileFormats }];
  try {
    const files = [...jobs.flatMap((job) => job.formats.map((format) => `${job.name}.${format}`)), ...(onePdf || printing ? [`${name}.pdf`] : [])];
    logLine(`Exporting ${files.join(', ')}…`);
    // Reserve a native PNG save target while the submit event still carries
    // user activation. Rasterization below is asynchronous and may otherwise
    // make a later download click get blocked by the browser. A set of beat
    // files is downloaded instead of asking for each one.
    const prepared = persistence.prepareExport
      ? await persistence.prepareExport({ name, formats: jobs.length === 1 ? fileFormats : [], dir })
      : null;
    // A MathML label can acquire its final browser-sized box after the last
    // canvas paint. Sync it before taking bounds for the exported viewBox.
    settleLabelMetrics();
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
    // Open linked-design bubbles export with the drawing, as vector drawing.
    const extras = linkBubbleExtras(drawing);
    const pages = [];
    for (const job of jobs) {
      const view = job.beat === null ? null : resolveBeat(editor.circuit, job.beat);
      const renderedSvg = renderDocument(drawing, {
        ...DRAWING_EXPORT_OPTIONS,
        grid,
        // Only the whole drawing carries the sketch; a selection is its parts.
        sketch: sketch && !selection,
        pageGuide: editor.pageGuide,
        ...(extras ? { extras } : {}),
        ...(view ? { beat: { view, timing: timingBeatBands(editor.circuit, view.index) } } : {}),
      });
      const svg = await withEmbeddedMathFont(dark ? applyExportDarkTheme(renderedSvg) : renderedSvg);
      if (onePdf) pages.push(svg);
      if (printing) printed.push(svg);
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
    if (paths.length) logLine(`Exported ${fileNames(paths)} to ${displayPath(folder)}.`);
    for (const note of notes) logLine(note);
    if (printing) await printPdf(printPagesHtml(printed, { title: name }), name);
  } catch (err) {
    logLine(`Could not export: ${err.message}`, 'error');
  }
}

/** Browser-only: the PDF from the browser's print dialog, where Save as PDF
 *  writes it (print-pdf.js). */
async function printPdf(html, name) {
  logLine(`Printing ${name}.pdf: choose Save as PDF in the print dialog.`);
  try {
    await printHtml(html, { name });
  } catch (err) {
    logLine(`Could not open the print dialog: ${err.message}`, 'error');
  }
}

/** Sync measured labels, so figures are framed as the canvas draws them. */
function settleLabelMetrics() {
  for (let attempt = 0; attempt < 3 && syncRenderedLabelMetrics(); attempt += 1) {
    editor.committedCanvasKey = '';
    render();
  }
}

/** The designs the report's notes embed as sections, and those theirs
 *  embed, read from the workspace: name (lower case) -> { name, circuit }.
 *  The design on screen is its own drawing, unsaved edits and all. */
async function reportDesigns() {
  const own = String(editor.currentCircuitName || '').toLowerCase();
  const found = new Map(own ? [[own, { name: editor.currentCircuitName, circuit: editor.circuit }]] : []);
  const queue = embeddedDesignNames(editor.circuit);
  while (queue.length) {
    const name = queue.shift().trim();
    if (found.has(name.toLowerCase())) continue;
    const doc = workspaceDesigns().find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (!doc) continue;
    try {
      const circuit = loadDocument((await loadDesign(doc)).state);
      found.set(name.toLowerCase(), { name: doc.name, circuit });
      queue.push(...embeddedDesignNames(circuit));
    } catch (err) {
      logLine(`Could not read ${doc.name} for the report: ${err.message}`, 'error');
    }
  }
  return found;
}

/** The report of the design on screen (core/report.js), with the math face
 *  when `fontCss` is given. */
async function currentReport(fontCss = '') {
  const designs = await reportDesigns();
  return buildReport(editor.circuit, {
    name: editor.currentCircuitName || 'Design', guide: editor.pageGuide, fontCss,
    design: (name) => designs.get(name.trim().toLowerCase()) || null,
  });
}

/** The report: one HTML document, and the PDF the server prints from it. */
async function runReportExport({ dir, name, formats }) {
  if (!formatsSupported(formats)) return;
  try {
    logLine(`Exporting ${formats.map((format) => `${name}.${format}`).join(', ')}…`);
    const prepared = persistence.prepareExport ? await persistence.prepareExport({ name, formats: [], dir }) : null;
    settleLabelMetrics();
    const report = await currentReport(await embeddedMathFontFace());
    // Browser-only, the PDF is printed from the report's own pages.
    const printing = !!persistence.printsPdf && formats.includes('pdf');
    const fileFormats = printing ? formats.filter((format) => format !== 'pdf') : formats;
    const count = report.figures.filter((figure) => figure.kind).length;
    if (fileFormats.length) {
      const result = await writeExportFiles({ dir, name, formats: fileFormats, report: report.html }, { prepared });
      if (!result) {
        logLine('Export canceled.');
        return;
      }
      logLine(`Exported the report (${count} figure${count === 1 ? '' : 's'}) to ${fileNames(result.paths)} in ${displayPath(result.dir)}.`);
      for (const note of result.notes || []) logLine(note);
    }
    for (const warning of report.warnings) logLine(warning, 'error');
    if (printing) await printPdf(report.html, name);
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
  if (!formatsSupported(formats)) return;
  const report = (text, kind) => {
    logLine(text, kind);
    target.onStatus?.(text);
  };
  try {
    report(`Exporting ${formats.map((format) => `${name}.${format}`).join(', ')}…`);
    const prepared = persistence.prepareExport ? await persistence.prepareExport({ name, formats, dir }) : null;
    const { svg: sheet, scale, count } = target.build({ grid });
    const svg = await withEmbeddedMathFont(dark ? applyExportDarkTheme(sheet) : sheet);
    // Browser-only, the PDF is printed (print-pdf.js) after the files.
    if (persistence.printsPdf && formats.includes('pdf')) {
      const rest = formats.filter((format) => format !== 'pdf');
      if (rest.length) {
        const result = await writeExportFiles({ dir, name, formats: rest, svg }, { prepared });
        if (!result) {
          report('Export canceled.');
          return;
        }
        report(`Exported ${count} design${count === 1 ? '' : 's'} to ${fileNames(result.paths)} in ${displayPath(result.dir)}.`);
      }
      await printPdf(printPagesHtml([svg], { title: name }), name);
      return;
    }
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
    report(`Exported ${count} design${count === 1 ? '' : 's'} to ${fileNames(result.paths)} in ${displayPath(result.dir)}.`);
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
  if (editor.circuit.beats.length) option('all', `All beats (a ${editor.circuit.beats.length}-page PDF; numbered SVG and PNG files)`);
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

/** The formats ticked that the dialog's content can be written as. */
function chosenFormats() {
  const allowed = exportTarget ? ['svg', 'pdf'] : exportContent === 'report' ? ['pdf', 'html'] : ['svg', 'pdf', 'png'];
  return [...exportForm.querySelectorAll('input[name="format"]:checked')].map((input) => input.value).filter((format) => allowed.includes(format));
}

/** Show the drawing's choices or the report's. */
function setExportContent(content) {
  exportContent = content === 'report' ? 'report' : 'drawing';
  if (exportDialog) exportDialog.dataset.content = exportTarget ? 'drawing' : exportContent;
  for (const button of document.querySelectorAll('[data-export-content]')) button.setAttribute('aria-pressed', String(button.dataset.exportContent === exportContent));
  if (exportContent === 'report' && !exportTarget) {
    const saved = savedExportSettings();
    const wanted = Array.isArray(saved.reportFormats) ? saved.reportFormats : [formatSupported('pdf') ? 'pdf' : 'html'];
    for (const format of ['pdf', 'html']) {
      const input = exportForm.querySelector(`input[name="format"][value="${format}"]`);
      if (input) input.checked = formatSupported(format) && wanted.includes(format);
    }
    renderReportSummary();
  }
  renderExportLocation();
}

/** What the report holds: its figures and the guide that sizes them, and
 *  anything to look at first. */
async function renderReportSummary() {
  const summary = document.getElementById('export-report-summary');
  if (!summary) return;
  settleLabelMetrics();
  const report = await currentReport();
  const count = report.figures.filter((figure) => figure.kind).length;
  const guide = pageGuideTitle(editor.pageGuide || normalizePageGuide('a4'));
  const sections = new Set(report.figures.map((figure) => figure.design).filter(Boolean)).size;
  const what = !editor.circuit.notes ? 'The drawing alone: the design has no notes yet'
    : `The notes with ${count} figure${count === 1 ? '' : 's'}${sections ? ` and ${sections === 1 ? 'a section from another design' : `${sections} sections from other designs`}` : ''}`;
  summary.replaceChildren(`${what}, sized for ${guide}.`, ...report.warnings.map((warning) => Object.assign(document.createElement('span'), { className: 'export-report-warning', textContent: warning })));
}

let exportFolder = '';

function renderExportLocation() {
  const folderEl = document.getElementById('export-folder');
  if (folderEl) {
    folderEl.textContent = displayPath(exportFolder) || 'Choose a folder';
    folderEl.title = exportFolder;
  }
  const formats = chosenFormats().map((format) => `.${format}`);
  const extensions = document.getElementById('export-extensions');
  if (extensions) extensions.textContent = formats.join(' ');
  const dpi = exportForm.querySelector('select[name="pngDpi"]');
  if (dpi) dpi.disabled = !formats.includes('.png');
  const submit = document.getElementById('export-submit');
  const choose = document.getElementById('export-choose-folder');
  if (choose && persistence.browserOnly) choose.hidden = !persistence.canChooseExportFolder;
  if (submit) submit.disabled = !formats.length || !exportFolder || !validDocumentName(document.getElementById('export-name')?.value);
}

/**
 * Exports default to print-ready output (light, no grid) in the OS Pictures
 * folder in Node mode, or the browser download location in browser-only mode.
 * Formats, appearance, and a folder chosen for this document are remembered.
 */
export function exportCircuit({ content = 'drawing' } = {}) {
  exportTarget = null;
  setExportDialogTarget();
  const saved = savedExportSettings();
  if (exportGridInput) exportGridInput.checked = saved.grid === true;
  if (exportDarkInput) exportDarkInput.checked = saved.dark === true;
  if (exportSketchInput) {
    exportSketchInput.checked = saved.sketch === true;
    exportSketchInput.closest('label').hidden = !editor.circuit.sketch?.strokes.length;
  }
  const dpiSelect = exportForm.querySelector('select[name="pngDpi"]');
  if (dpiSelect) dpiSelect.value = String(normalizePngDpi(saved.pngDpi));
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
    selectionCount.textContent = exportSelection ? `${count} selected` : 'nothing selected';
  }
  // The Atlas's export shares these boxes: set every one.
  for (const input of exportForm.querySelectorAll('input[name="format"]')) {
    input.checked = formatSupported(input.value) && (Array.isArray(saved.formats) ? saved.formats.includes(input.value) : input.defaultChecked);
  }
  setExportContent(content);
  syncExportBeatChoice();
  // The page guide is the Settings one: shown here, where it pads the export.
  const pageGuideSelect = document.getElementById('export-page-guide');
  if (pageGuideSelect) pageGuideSelect.value = editor.pageGuide?.preset || '';
  const documentKey = editor.currentDocumentPath || '';
  const defaultFolder = defaultExportDirectory(editor.workspaceState, { browserOnly: persistence.browserOnly });
  exportFolder = (saved.folders && saved.folders[documentKey]) || defaultFolder;
  const nameInput = document.getElementById('export-name');
  if (nameInput) nameInput.value = validDocumentName(circuitNameEl.value) || editor.currentCircuitName || 'circuit';
  renderExportLocation();
  exportDialog?.showModal();
}

/** Dress the dialog for what it exports: the document, or the Atlas sheet. */
function setExportDialogTarget() {
  if (!exportDialog) return;
  exportDialog.dataset.target = exportTarget ? 'atlas' : 'document';
  exportDialog.dataset.content = exportTarget ? 'drawing' : exportContent;
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
  const saved = savedExportSettings();
  if (exportGridInput) exportGridInput.checked = saved.grid === true;
  if (exportDarkInput) exportDarkInput.checked = saved.dark === true;
  // The Atlas's sheet has no sketch of its own.
  if (exportSketchInput) exportSketchInput.closest('label').hidden = true;
  const formats = Array.isArray(saved.atlasFormats) ? saved.atlasFormats : ['pdf'];
  for (const input of exportForm.querySelectorAll('input[name="format"]')) {
    input.checked = input.value !== 'png' && formatSupported(input.value) && formats.includes(input.value);
  }
  // With no format chosen, the sheet is an SVG.
  if (![...exportForm.querySelectorAll('input[name="format"]:checked')].length) {
    const svgInput = exportForm.querySelector('input[name="format"][value="svg"]');
    if (svgInput) svgInput.checked = true;
  }
  exportFolder = (saved.folders && saved.folders[target.key]) || defaultExportDirectory(editor.workspaceState, { browserOnly: persistence.browserOnly });
  const nameInput = document.getElementById('export-name');
  if (nameInput) nameInput.value = validDocumentName(target.name) || 'atlas';
  renderExportLocation();
  exportDialog?.showModal();
}

export function installExportUi() {
  const help = document.getElementById('export-help');
  help?.addEventListener('click', () => help.dispatchEvent(new CustomEvent('guide-request', { bubbles: true, detail: { id: EXPORT_GUIDES[exportContent] } })));
  exportCircuitBtn?.addEventListener('click', exportCircuit);

  exportCancel?.addEventListener('click', () => exportDialog?.close());

  exportForm?.addEventListener('input', renderExportLocation);

  document.getElementById('export-beat')?.addEventListener('change', syncExportSelectionForBeat);

  exportForm?.addEventListener('change', renderExportLocation);

  document.getElementById('export-choose-folder')?.addEventListener('click', async () => {
    // Browser-only mode picks an export folder of its own, never the workspace.
    let choice;
    try {
      choice = persistence.browserOnly
        ? await persistence.pickFile({ mode: 'export-folder', dir: exportFolder })
        : await showFileDialog(persistence, { mode: 'folder', dir: exportFolder, title: 'Choose export folder' });
    } catch (err) {
      logLine(`Could not choose the export folder: ${err.message}`, 'error');
      return;
    }
    if (!choice) return;
    exportFolder = choice.path;
    renderExportLocation();
  });

  // Choosing a page guide here chooses it in Settings: one preference.
  document.getElementById('export-page-guide')?.addEventListener('change', (event) => {
    document.querySelector(`#settings-menu [data-page-guide="${event.target.value}"]`)?.click();
    if (exportContent === 'report') renderReportSummary();
  });
  for (const button of document.querySelectorAll('[data-export-content]')) {
    button.addEventListener('click', () => setExportContent(button.dataset.exportContent));
  }
  exportForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formats = chosenFormats();
    const name = validDocumentName(document.getElementById('export-name')?.value);
    if (!formats.length || !name || !exportFolder) return;
    exportDialog.close();
    if (!exportTarget && exportContent === 'report') {
      rememberExportSettings({ reportFormats: formats });
      runReportExport({ dir: exportFolder, name, formats });
      return;
    }
    if (exportTarget) {
      const target = exportTarget;
      const settings = { grid: exportGridInput?.checked === true, dark: exportDarkInput?.checked === true };
      const vectorFormats = formats.filter((format) => format !== 'png');
      rememberExportSettings({ ...settings, atlasFormats: vectorFormats }, {
        key: target.key, dir: exportFolder,
        remembered: exportFolder !== defaultExportDirectory(editor.workspaceState, { browserOnly: persistence.browserOnly }),
      });
      runAtlasExport({ dir: exportFolder, name, formats: vectorFormats, ...settings, target });
      return;
    }
    const settings = {
      grid: exportGridInput?.checked === true,
      dark: exportDarkInput?.checked === true,
      sketch: exportSketchInput?.checked === true,
      pngDpi: normalizePngDpi(exportForm.querySelector('select[name="pngDpi"]')?.value),
    };
    // A folder is remembered only when it differs from the document's own folder.
    const defaultFolder = defaultExportDirectory(editor.workspaceState, { browserOnly: persistence.browserOnly });
    rememberExportSettings({ ...settings, formats }, {
      key: editor.currentDocumentPath || '', dir: exportFolder,
      remembered: exportFolder !== defaultFolder && exportFolder !== editor.currentDocumentDir,
    });
    const selection = exportSelectionInput?.checked && exportSelection ? exportSelection : null;
    runExport({ dir: exportFolder, name, formats, ...settings, selection, beat: chosenExportBeat() });
  });
}
