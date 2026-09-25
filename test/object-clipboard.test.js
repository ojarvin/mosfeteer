import { editorSource } from './helpers/editor-source.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeObjectClipboard, decodeObjectClipboard, OBJECT_CLIPBOARD_FORMAT } from '../src/core/object-clipboard.js';

const buffer = () => ({
  comps: [
    { origRef: 'M1', type: 'nmos', x: 120, y: 120, rotation: 0, mirrorX: false, mirrorY: false, negativeInputs: [], joinBar: false, style: {}, value: '' },
    { origRef: 'R1', type: 'resistor', x: 120, y: -80, rotation: 90, mirrorX: false, mirrorY: false, negativeInputs: [], joinBar: false, style: {}, value: 'R_{D}' },
  ],
  labels: [
    { id: 'L1', kind: 'label', parent: null, text: 'hello', align: 'left', x: 0, y: 0, end: null, points: null, style: {}, math: false, mathBox: null },
    { id: 'L2', kind: 'arrow', parent: null, text: '', align: 'left', x: 0, y: 40, end: { x: 80, y: 40 }, points: null, style: {}, math: false, mathBox: null },
  ],
  nets: [{
    id: 'n1', name: 'out', routingMode: 'managed', drawOrder: 0,
    terminals: [{ comp: 'M1', term: 'd' }, { comp: 'R1', term: 'a' }],
    route: [{ x: 120, y: 40 }, { x: 120, y: 0 }], branches: null, junctions: [], fixedPaths: null,
    netLabels: [{ netId: 'n1', text: 'out', align: 'left', netSide: null, x: 160, y: 40 }],
  }],
  fragments: [{ name: null, routingMode: 'managed', allowDiagonal: false, drawOrder: 0, paths: [[{ x: 0, y: 200 }, { x: 80, y: 200 }]], junctions: [] }],
  anchor: { x: 120, y: 40 },
  style: null,
});

test('copied objects round-trip through the system clipboard text', () => {
  const text = encodeObjectClipboard(buffer());
  assert.equal(JSON.parse(text).format, OBJECT_CLIPBOARD_FORMAT);
  assert.deepEqual(decodeObjectClipboard(text), buffer());
});

test('clipboard text that is not copied objects is left to the editor buffer', () => {
  for (const text of ['', 'hello', '<svg/>', '{"format":"other"}', '{not json mosfeteer/objects', '[1,2]', null]) {
    assert.equal(decodeObjectClipboard(text), null, String(text));
  }
});

test('damaged or foreign-version copied objects are refused before any paste', () => {
  const version = JSON.parse(encodeObjectClipboard(buffer()));
  version.version = 99;
  assert.throws(() => decodeObjectClipboard(JSON.stringify(version)), /different Mosfeteer version/);

  const cases = [
    (data) => { data.comps[0].type = 'flux_capacitor'; },
    (data) => { data.comps[1].x = 'left'; },
    (data) => { data.labels[1].end = null; },
    (data) => { data.nets[0].terminals = [{ comp: 'M1' }]; },
    (data) => { data.nets[0].route = [{ x: 0 }]; },
    (data) => { data.fragments[0].paths = []; },
    (data) => { delete data.anchor; },
    (data) => { data.labels = {}; },
  ];
  for (const damage of cases) {
    const data = JSON.parse(encodeObjectClipboard(buffer()));
    damage(data);
    assert.throws(() => decodeObjectClipboard(JSON.stringify(data)), /could not be read/, damage.toString());
  }
});

test('Ctrl/Cmd+C publishes copies and Ctrl/Cmd+V is read from the browser paste event', async () => {
  const main = editorSource();
  assert.match(main, /k === 'c' && !ev\.shiftKey\) \{\s*ev\.preventDefault\(\);\s*if \(copySelection\(\)\) publishObjectClipboard\(\);/);
  assert.match(main, /key === 'y'\) \{\s*if \(copySelection\(\)\) publishObjectClipboard\(\);/);
  // Ctrl/Cmd+V must not prevent the default, or no paste event follows.
  assert.match(main, /k === 'v'\) \{\s*\/\/[^\n]*\n\s*armObjectPaste\(ev\.shiftKey \? 'style' : 'objects'\);\s*\}/);
  assert.match(main, /document\.addEventListener\('paste', /);
});

test('a copied net label crosses windows as just its name', () => {
  const copied = { comps: [], labels: [], nets: [], fragments: [], anchor: { x: 0, y: 0 }, netLabel: { text: 'V_{out}' }, style: null };
  assert.deepEqual(decodeObjectClipboard(encodeObjectClipboard(copied)), copied);
  for (const netLabel of [{ text: '' }, { text: 7 }, 'VOUT']) {
    assert.throws(() => decodeObjectClipboard(encodeObjectClipboard({ ...copied, netLabel })), /bad net label/);
  }
});

test('pasting a copied net label hands its name to the net label tool', () => {
  const main = editorSource();
  // Every paste route starts the placement instead of dropping loose text.
  assert.match(main, /if \(clipboard\.netLabel\) return beginNetLabelPaste\(clipboard\.netLabel\.text\);/);
  assert.match(main, /if \(clipboard\.netLabel\) \{\s*if \(recordHistory\) beginNetLabelPaste\(clipboard\.netLabel\.text\);\s*return;/);
  // Ctrl-drag drops it once, then returns to Select.
  assert.match(main, /beginNetLabelPaste\(label\.text, \{ once: true \}\);\s*drag = \{ mode: 'netlabelpaste'/);
  assert.match(main, /drag\.mode === 'netlabelpaste'\) \{\s*placeNetLabelAt\(w\);/);
  // Picking any tool forgets a pasted name, so plain Shift+L never inherits it.
  assert.match(main, /function activateLabelPlacement\(kind\) \{\s*leaveActiveInteraction\(\);\s*clearNetLabelPaste\(\);/);
  // A differently named net is renamed only after a confirmation.
  assert.match(main, /kind === 'rename' && !await confirmChoice\(/);
});
