import test from 'node:test';
import assert from 'node:assert/strict';
import { TITLE_COMFORT_PX, TOOLBAR_STAGES, chooseToolbarStage, toolbarFits, toolbarStageTokens } from '../src/web/toolbar-fit.js';

test('toolbar stages accumulate, least useful text first', () => {
  assert.deepEqual(TOOLBAR_STAGES, ['export', 'new', 'fold', 'save']);
  assert.equal(toolbarStageTokens(0), '');
  assert.equal(toolbarStageTokens(2), 'export new');
  assert.equal(toolbarStageTokens(99), TOOLBAR_STAGES.join(' '));
});

test('the first fitting stage wins; nothing fitting means every stage', () => {
  assert.equal(chooseToolbarStage(() => true), 0);
  assert.equal(chooseToolbarStage((n) => n >= 3), 3);
  assert.equal(chooseToolbarStage(() => false), TOOLBAR_STAGES.length);
});

test('a row fits without overflow while the title keeps a comfortable width', () => {
  const base = { scrollWidth: 800, clientWidth: 800 };
  assert.equal(toolbarFits({ ...base, titleWidth: 80, titleTextWidth: 80 }), true); // short title in full
  assert.equal(toolbarFits({ ...base, titleWidth: TITLE_COMFORT_PX, titleTextWidth: 600 }), true); // long title, comfortable
  assert.equal(toolbarFits({ ...base, titleWidth: 120, titleTextWidth: 600 }), false); // title squeezed
  assert.equal(toolbarFits({ scrollWidth: 820, clientWidth: 800, titleWidth: 80, titleTextWidth: 80 }), false); // overflow
});
