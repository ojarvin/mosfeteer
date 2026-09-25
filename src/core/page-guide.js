import { GRID } from './grid.js';
import { LABEL_FONT_SIZE } from './model.js';

// Page guides. A figure placed at 100% of a LaTeX column width is scaled so its
// exported width fills the column, so its text size follows from that width
// alone. The guide shows the drawing width at which label text lands at the
// template's text size, and export pads the figure to exactly that width.
//
// Normal-weight labels are LABEL_FONT_SIZE world units tall. A figure W units
// wide set at a column of C points scales text to LABEL_FONT_SIZE * C / W
// points, so the width for T-point text is W = LABEL_FONT_SIZE * C / T.

export const PAGE_GUIDES = Object.freeze({
  // IEEEtran journal: 3.5 in columns and 7.16 in text width. Figure text at
  // 8 pt matches the captions and leaves a usable width (10 pt body-size text
  // would allow only about 24 grid cells across a column).
  'ieee-1col': { name: 'IEEE single column', widthPt: 252, widthLabel: '3.5 in', textPt: 8 },
  'ieee-2col': { name: 'IEEE double column', widthPt: 516, widthLabel: '7.16 in', textPt: 8 },
});

/** A stored guide choice, normalized; null when no guide is on. */
export function normalizePageGuide(value) {
  const preset = typeof value === 'string' ? value : value?.preset;
  if (!PAGE_GUIDES[preset]) return null;
  return { preset, textPt: PAGE_GUIDES[preset].textPt };
}

/** World width at which label text exports at the guide's text size. */
export function pageGuideWidth(guide) {
  const preset = PAGE_GUIDES[guide.preset];
  return (LABEL_FONT_SIZE * preset.widthPt) / guide.textPt;
}

/** Text size (pt) that labels of a figure `width` units wide get in the column. */
export function pageGuideTextSize(guide, width) {
  return (LABEL_FONT_SIZE * PAGE_GUIDES[guide.preset].widthPt) / width;
}

/** The horizontal frame for a figure whose natural export extends x0..x1:
 *  centred on it and exactly the guide's width. When the drawing is wider it
 *  cannot be padded to fit; the frame keeps the natural extent and `fits` is
 *  false, with the text size the figure would get instead, the guide's own
 *  width centred on the drawing as `target`, and how many grid cells to trim
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
  const preset = PAGE_GUIDES[guide.preset];
  const width = guide.preset === 'ieee-2col' ? '\\textwidth' : '\\columnwidth';
  return `${preset.name} (${preset.widthLabel}) · ${guide.textPt} pt text with \\includegraphics[width=${width}]`;
}

/** The frame an export of `circuit` would get, with the same bounds and
 *  padding the drawing export uses; an empty drawing centres it on the origin. */
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
