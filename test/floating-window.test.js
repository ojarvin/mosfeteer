import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLACE, floatingWindowPosition } from '../src/web/floating-window.js';

const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
const beats = readFileSync(new URL('../src/web/beats-ui.js', import.meta.url), 'utf8');

test('a floating window goes where it was put, or its default place, and stays in the pane', () => {
  const pane = { w: 1000, h: 600 };
  const size = { w: 300, h: 200 };
  assert.deepEqual(floatingWindowPosition(pane, size, null, PLACE.bottomCenter), { x: 350, y: 388 });
  assert.deepEqual(floatingWindowPosition(pane, size, { x: 120, y: 40 }, PLACE.bottomCenter), { x: 120, y: 40 });
  // Dragged (or left, by a pane that shrank) past an edge, it is pulled back in.
  assert.deepEqual(floatingWindowPosition(pane, size, { x: 900, y: -50 }, PLACE.topRight), { x: 692, y: 8 });
  // A window bigger than the pane keeps its title bar in reach.
  assert.deepEqual(floatingWindowPosition({ w: 200, h: 100 }, size, { x: 50, y: 50 }, PLACE.topRight), { x: 8, y: 8 });
});

test('beats, timing, and analysis are floating windows with one title bar and a close ×', () => {
  for (const id of ['analysis-dialog', 'beat-strip']) {
    const start = html.indexOf(`id="${id}"`);
    const head = html.slice(start, html.indexOf('</header>', start));
    assert.match(html.slice(html.lastIndexOf('<', start), start + 200), /class="[^"]*floating-window/);
    assert.match(head, /class="floating-window-header"[\s\S]*class="floating-window-title"[\s\S]*class="floating-window-close"[^>]*>×<\/button>\s*$/);
  }
  assert.match(beats, /element\('section', \{ class: 'floating-window timing-dialog'/);
  assert.match(beats, /element\('button', \{ type: 'button', class: 'floating-window-close'/);
  // No second close at the bottom.
  assert.doesNotMatch(beats, /button\('Close', 'Close \(Escape\)'/);
  // The windows live in the canvas pane, over the drawing; the side panel docks.
  const pane = html.slice(html.indexOf('<section class="canvas-pane">'), html.indexOf('<aside class="side-panel"'));
  assert.match(pane, /id="analysis-dialog"/);
  assert.match(pane, /id="beat-strip"/);
});

test('the toolbar groups the windows, and More lists them too', () => {
  const group = html.slice(html.indexOf('class="toolbar-cluster window-cluster"'), html.indexOf('class="toolbar-cluster view-cluster"'));
  assert.deepEqual([...group.matchAll(/<button id="([^"]+)"/g)].map((m) => m[1]), ['btn-window-beats', 'btn-window-timing', 'btn-analysis']);
  const more = html.slice(html.indexOf('id="document-menu"'), html.indexOf('class="toolbar-spacer"'));
  assert.match(more, /id="btn-beats"/);
  assert.match(more, /id="btn-timing-diagram"/);
  assert.match(more, /data-proxy-for="btn-analysis"[^>]*>Small-signal analysis/);
  // A folded toolbar drops the group: More has every window.
  const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  assert.match(css, /data-compact~="fold"\] :is\([^)]*\.window-cluster/);
});

test('the timing editor says each way to and from the beats once, in plain words', () => {
  for (const name of ["'Read beats'", "'Make beats'", "'Move under drawing'", "text: 'Gaps'", "section('Slots'", "section('Cursor row'", "section('Signals'"]) {
    assert.ok(beats.includes(name), name);
  }
  for (const old of ["'From beats'", "'Re-place'", "'Never overlap'", "'Repeat all'"]) assert.ok(!beats.includes(old), old);
  // Its controls are the style panel's: segmented icon groups and toggle chips.
  assert.match(beats, /segmented\('Falling edges', \[/);
  assert.match(beats, /class: 'timing-chip', 'aria-pressed'/);
  assert.match(html, />Make beats from phases<\/button>/);
});

test('the workspace reads as one: an Atlas button and tags by the name, one set of link verbs', async () => {
  const doc = html.slice(html.indexOf('class="toolbar-cluster document-cluster"'), html.indexOf('class="toolbar-cluster file-cluster"'));
  assert.match(doc, /id="btn-tags"[\s\S]*id="panel-tags"[\s\S]*id="btn-atlas"[^>]*>Atlas<\/button>/);
  const panel = html.slice(html.indexOf('<aside class="side-panel"'), html.indexOf('</aside>'));
  assert.doesNotMatch(panel, /panel-tags/);
  assert.doesNotMatch(html, /id="hierarchy-up"/);
  const hierarchy = readFileSync(new URL('../src/web/hierarchy.js', import.meta.url), 'utf8');
  assert.match(hierarchy, /`Peek at \$\{component\.link\}`[\s\S]*`Open \$\{component\.link\}`[\s\S]*`Show \$\{component\.link\} in the Atlas`, \(\) => void openAtlas\(\{ focus: component\.link \}\)/);
  assert.equal((hierarchy.match(/ appendLinkVerbs\(group, component, (\[component\]|parts)\);/g) || []).length, 2);
  const atlas = readFileSync(new URL('../src/web/atlas.js', import.meta.url), 'utf8');
  assert.match(atlas, /function focusNamed\(generation, name\)/);
});
