/**
 * The top toolbar is one row that gives way in stages as its space runs out,
 * least useful text first. Each stage adds one token to the toolbar's
 * `data-compact` list, and style.css keys its rules on the tokens:
 *
 *   export, new         those file actions become icons
 *   fold                New, Export, and the view toggles move into More
 *   save                Save becomes an icon
 *
 * The editor picks the first stage count at which the row fits and the
 * document title still shows a comfortable amount of its name.
 */
export const TOOLBAR_STAGES = ['export', 'new', 'fold', 'save'];

/** How much of the title (px) must stay visible before buttons drop text. */
export const TITLE_COMFORT_PX = 224;

/** First stage count for which `fits(count)` holds; all stages when none do. */
export function chooseToolbarStage(fits, count = TOOLBAR_STAGES.length) {
  for (let n = 0; n < count; n++) {
    if (fits(n)) return n;
  }
  return count;
}

/** The `data-compact` value for a stage count. */
export function toolbarStageTokens(count) {
  return TOOLBAR_STAGES.slice(0, Math.max(0, count)).join(' ');
}

/** The row fits when nothing overflows and the title is shown to at least
 *  the smaller of its full text and the comfort width. */
export function toolbarFits({ scrollWidth, clientWidth, titleWidth, titleTextWidth }) {
  return scrollWidth <= clientWidth + 1 && titleWidth + 1 >= Math.min(titleTextWidth, TITLE_COMFORT_PX);
}
