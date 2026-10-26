import { GRID } from './grid.js';
import { LABEL_FONT_SIZE } from './model.js';

// Page guides. A figure placed at 100% of a LaTeX column width is scaled so its
// exported width fills the column, so its text size follows from that width
// alone. The guide shows the drawing width at which label text lands at the
// template's text size, and export pads the figure to exactly that width.
//
// Normal-weight labels are LABEL_FONT_SIZE world units tall. That is the
// base text: subscripts and superscripts are set smaller around it, as they
// are in the page's own body text, so they never set the target. A figure W units
// wide set at a column of C points scales text to LABEL_FONT_SIZE * C / W
// points, so the width for T-point text is W = LABEL_FONT_SIZE * C / T.

const PAGE_GUIDES = Object.freeze({
  // IEEEtran journal: 3.5 in columns and 7.16 in text width. Figure text at
  // 8 pt matches the captions and leaves a usable width (10 pt body-size text
  // would allow only about 24 grid cells across a column).
  'ieee-1col': { name: 'IEEE single column', widthPt: 252, widthLabel: '3.5 in', textPt: 8, latexWidth: '\\columnwidth' },
  'ieee-2col': { name: 'IEEE double column', widthPt: 516, widthLabel: '7.16 in', textPt: 8, latexWidth: '\\textwidth' },
  // An A4 page with 25 mm margins (16 cm of text), at the same 8 pt.
  a4: { name: 'A4 page', widthPt: 453.54, widthLabel: '16 cm', textPt: 8, latexWidth: '\\textwidth' },
});

/** Points per unit a custom guide's width may be given in. */
export const PAGE_GUIDE_UNITS = Object.freeze({ in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pt: 1 });

// A custom guide's bounds: from a narrow column to a poster, and text from
// fine print to slide size.
const CUSTOM_WIDTH_PT = [36, 2880];
const CUSTOM_TEXT_PT = [4, 36];

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * A custom guide, `{ width, unit, textPt }` (a width of `width` units, text
 * at `textPt`), normalized; null when it is not one. Throws with `strict`,
 * saying what is wrong, for a form to show.
 */
export function customPageGuide(value, { strict = false } = {}) {
  const fail = (message) => {
    if (strict) throw new Error(message);
    return null;
  };
  const unit = PAGE_GUIDE_UNITS[value?.unit] ? value.unit : null;
  if (!unit) return fail('choose in, cm, mm, or pt');
  const width = Number(value.width);
  const textPt = Number(value.textPt);
  if (!Number.isFinite(width) || width <= 0) return fail('the width must be a positive number');
  const widthPt = width * PAGE_GUIDE_UNITS[unit];
  if (widthPt < CUSTOM_WIDTH_PT[0] || widthPt > CUSTOM_WIDTH_PT[1]) {
    const [low, high] = CUSTOM_WIDTH_PT.map((bound) => round(bound / PAGE_GUIDE_UNITS[unit], 2));
    return fail(`the width must be from ${low} to ${high} ${unit}`);
  }
  if (!Number.isFinite(textPt) || textPt < CUSTOM_TEXT_PT[0] || textPt > CUSTOM_TEXT_PT[1]) return fail(`the text size must be from ${CUSTOM_TEXT_PT[0]} to ${CUSTOM_TEXT_PT[1]} pt`);
  const label = `${round(width, 3)} ${unit}`;
  return {
    preset: 'custom', width: round(width, 3), unit, textPt: round(textPt, 2),
    name: 'Custom', widthPt, widthLabel: label, latexWidth: `${round(width, 3)}${unit}`,
  };
}

/** A stored guide choice, normalized; null when no guide is on. A preset is
 *  its id or `{ preset }`; a custom guide `{ preset: 'custom', width, unit,
 *  textPt }`. */
export function normalizePageGuide(value) {
  if (value?.preset === 'custom') return customPageGuide(value);
  const preset = typeof value === 'string' ? value : value?.preset;
  if (!Object.hasOwn(PAGE_GUIDES, preset)) return null;
  return { preset, ...PAGE_GUIDES[preset] };
}

/** A guide as a command names it: a preset id, or a custom width and text
 *  size, `12cm@9` (`3.5in@8pt`). Throws, saying what it takes. */
export function parsePageGuide(text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (Object.hasOwn(PAGE_GUIDES, value)) return normalizePageGuide(value);
  const custom = value.match(/^(\d+(?:\.\d+)?)\s*(in|cm|mm|pt)\s*@\s*(\d+(?:\.\d+)?)\s*(?:pt)?$/);
  if (!custom) throw new Error(`a page guide is ${Object.keys(PAGE_GUIDES).join(', ')}, or a width and text size such as 12cm@9`);
  return customPageGuide({ width: custom[1], unit: custom[2], textPt: custom[3] }, { strict: true });
}

/** World width at which label text exports at the guide's text size. */
export function pageGuideWidth(guide) {
  return (LABEL_FONT_SIZE * guide.widthPt) / guide.textPt;
}

/** Text size (pt) that labels of a figure `width` units wide get in the column. */
export function pageGuideTextSize(guide, width) {
  return (LABEL_FONT_SIZE * guide.widthPt) / width;
}

/** The horizontal frame for a figure whose natural export extends x0..x1:
 *  centered on it and exactly the guide's width. When the drawing is wider it
 *  cannot be padded to fit; the frame keeps the natural extent and `fits` is
 *  false, with the text size the figure would get instead, the guide's own
 *  width centered on the drawing as `target`, and how many grid cells to trim
 *  from each side to fit (`trimCells`). */
export function pageGuideFrame(guide, x0, x1) {
  const width = pageGuideWidth(guide);
  const natural = x1 - x0;
  if (natural > width + 1e-6) {
    return {
      x: x0,
      width: natural,
      fits: false,
      textPt: pageGuideTextSize(guide, natural),
      target: { x: (x0 + x1) / 2 - width / 2, width },
      trimCells: (natural - width) / 2 / GRID,
    };
  }
  return { x: (x0 + x1) / 2 - width / 2, width, fits: true, textPt: guide.textPt };
}

/** One line naming what the guide is for, e.g. for the canvas caption. */
export function pageGuideCaption(guide) {
  return `${guide.name} (${guide.widthLabel}) · ${guide.textPt} pt text with \\includegraphics[width=${guide.latexWidth}]`;
}

/** The guide's name in a list, e.g. `A4 page (16 cm)`; a custom one with its text size. */
export function pageGuideTitle(guide) {
  return guide.preset === 'custom' ? `Custom (${guide.widthLabel}, ${guide.textPt} pt)` : `${guide.name} (${guide.widthLabel})`;
}

/** The frame an export of `circuit` would get, with the same bounds and
 *  padding the drawing export uses; an empty drawing centers it on the origin. */
export function circuitPageGuideFrame(circuit, guide, padding = GRID) {
  // The same visible extent the export frames (render.js svgString).
  const b = circuit.inkBounds(0);
  if (b.w <= 0 && b.h <= 0) return pageGuideFrame(guide, 0, 0);
  return {
    ...pageGuideFrame(guide, Math.floor(b.x) - padding, Math.ceil(b.x + b.w) + padding),
    // The figure's vertical extent, so an overflow can be marked clear of it.
    top: Math.floor(b.y) - padding,
    bottom: Math.ceil(b.y + b.h) + padding,
  };
}
