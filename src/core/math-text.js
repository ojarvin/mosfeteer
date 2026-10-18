/**
 * Plot text set as TeX sets math, for the math font (Latin Modern Math): a
 * variable -- a single Latin letter or lowercase Greek one -- in the font's
 * math italic letters, words and units (dB, Re, step response) upright, and
 * numbers upright with a true minus sign. The font has no italic face of its
 * own, so its italics are these letters rather than a slanted style. Used by
 * the plots on the drawing (render.js) and in the windows (plot-view.js).
 */

import { parseLabelRuns } from './model.js';

/** A letter's math italic form, or the letter when it has none. */
export function mathItalic(ch) {
  const code = ch.codePointAt(0);
  if (ch === 'h') return 'ℎ'; // the block's one gap: Planck's constant stands in
  if (code >= 0x41 && code <= 0x5a) return String.fromCodePoint(0x1d434 + code - 0x41);
  if (code >= 0x61 && code <= 0x7a) return String.fromCodePoint(0x1d44e + code - 0x61);
  if (code >= 0x3b1 && code <= 0x3c9) return String.fromCodePoint(0x1d6fc + code - 0x3b1);
  return ch;
}

// The math italic letters: Latin, Planck's h, lowercase Greek.
const ITALIC = /[\u{1D434}-\u{1D467}\u{1D6FC}-\u{1D714}ℎ]/u;
const HAIR = ' ';

/** `text` with its lone letters in math italic and its minus signs true. A
 *  bar or closing parenthesis against an italic letter is kept off it by a
 *  hair space, as TeX's italic correction keeps |T| from touching. */
export function mathText(text) {
  return String(text)
    .replace(/[A-Za-zα-ω]+/g, (word) => (word.length === 1 ? mathItalic(word) : word))
    .replace(/(^|[\s(=])-(?=[\d.∞])/g, '$1−')
    .replace(new RegExp(`(${ITALIC.source})(?=[|)])`, 'gu'), `$1${HAIR}`)
    .replace(new RegExp(`\\|(?=${ITALIC.source})`, 'gu'), `|${HAIR}`);
}

/** A plot text's runs (_{} and ^{} markup, as parseLabelRuns reads it),
 *  each run's text set as math. A run opening on a bar or parenthesis after
 *  one ending in an italic letter (the |A_{v}| closing bar) is kept off it too. */
export function mathRuns(text) {
  const runs = parseLabelRuns(String(text)).map((run) => ({ ...run, text: mathText(run.text) }));
  for (let i = 1; i < runs.length; i++) {
    if (/^[|)]/.test(runs[i].text) && new RegExp(`${ITALIC.source}$`, 'u').test(runs[i - 1].text)) runs[i].text = HAIR + runs[i].text;
  }
  return runs;
}
