import test from 'node:test';
import assert from 'node:assert/strict';
import { INSERT_RECENT_LIMIT, componentPaletteItems, editorKeymapText, fuzzyScore, layerActionForKey, placementSearchScore, withRecentType, PLACEMENT_ALIASES, PLACEMENT_LABELS } from '../src/web/toolbar.js';

test('component palette omits generated solder dots but keeps real components', () => {
  const items = componentPaletteItems([
    { refdes: 'M1', type: 'nmos' },
    { refdes: 'J1', type: 'solder' },
    { refdes: 'R1', type: 'resistor' },
  ]);
  assert.deepEqual(items.map(({ refdes }) => refdes), ['M1', 'R1']);
});

test('layer shortcuts dispatch only in an idle normal editor', () => {
  assert.equal(layerActionForKey({ key: 'ArrowUp', shiftKey: true }), 'bring-front');
  assert.equal(layerActionForKey({ key: 'ArrowDown', shiftKey: true }), 'send-back');
  for (const state of [
    { key: 'ArrowUp' },
    { key: 'ArrowLeft', shiftKey: true },
    { key: 'ArrowUp', shiftKey: true, ctrlKey: true },
    { key: 'ArrowUp', shiftKey: true, mode: 'insert' },
    { key: 'ArrowUp', shiftKey: true, wire: true },
    { key: 'ArrowUp', shiftKey: true, moveMode: 'connected' },
    { key: 'ArrowUp', shiftKey: true, textEntry: true },
  ]) assert.equal(layerActionForKey(state), null);
});

test('block help exposes only block-domain tools', () => {
  const help = editorKeymapText('block');
  assert.match(help, /draw a Connector/);
  assert.doesNotMatch(help, /electrical wire|net label|component or label/i);
});

test('keyboard help is generated from current bindings without Vim movement keys', () => {
  const help = editorKeymapText();
  assert.match(help, /Arrow keys/);
  assert.match(help, /console separator/);
  assert.match(help, /-- draw --\n/);
  assert.match(help, /-- file and console --\n/);
  assert.doesNotMatch(help, /\\n/);
  assert.match(help, /l\s+.*line annotation/);
  assert.match(help, /e\s+.*LaTeX equation label/);
  assert.doesNotMatch(help, /h j k|h j k l|hjkl/i);
});

test('fuzzy ranking prefers prefix, then substring, then subsequence', () => {
  const prefix = fuzzyScore('res', 'resistor');
  const substring = fuzzyScore('sist', 'resistor');
  const subsequence = fuzzyScore('rstr', 'resistor');
  assert.ok(prefix > substring, 'prefix outranks substring');
  assert.ok(substring > subsequence, 'substring outranks subsequence');
  assert.equal(fuzzyScore('zzz', 'resistor'), -1);
  assert.equal(fuzzyScore('', 'resistor'), 0);
  // Within one tier the shorter name wins.
  assert.ok(fuzzyScore('n', 'nmos') > fuzzyScore('n', 'nmosb'));
});

test('insert search matches a symbol by id, display name, or alias', () => {
  assert.ok(placementSearchScore('nmos', 'nmos') > 0);
  assert.ok(placementSearchScore('transistor', 'nmos') > 0, 'display name "NMOS transistor"');
  assert.ok(placementSearchScore('pot', 'variable_resistor') > 0, 'alias "potentiometer"');
  assert.ok(placementSearchScore('bjt', 'npn') > 0, 'alias');
  assert.equal(placementSearchScore('zzzz', 'nmos'), -1);
});

test('vccs is named and searchable in the insert palette', () => {
  assert.equal(PLACEMENT_LABELS.vccs, 'VCCS (voltage-controlled current source)');
  assert.ok(PLACEMENT_ALIASES.vccs.includes('transconductance'));
  assert.ok(placementSearchScore('gm', 'vccs') > 0);
});

test('three-input logic gates are named and searchable', () => {
  assert.equal(PLACEMENT_LABELS.and3_gate, '3-input AND gate');
  assert.equal(PLACEMENT_LABELS.xnor3_gate, '3-input XNOR gate');
  assert.ok(placementSearchScore('three input', 'and3_gate') > 0);
});

test('two-input logic gates use explicit arity names', () => {
  assert.equal(PLACEMENT_LABELS.and2_gate, '2-input AND gate');
  assert.equal(PLACEMENT_LABELS.xnor2_gate, '2-input XNOR gate');
  assert.ok(placementSearchScore('two input', 'and2_gate') > 0);
});

test('tri-state logic gates are named and searchable', () => {
  assert.equal(PLACEMENT_LABELS.tristate_inverter, 'Tri-state inverter');
  assert.equal(PLACEMENT_LABELS.tristate_buffer, 'Tri-state buffer');
  assert.ok(placementSearchScore('enable', 'tristate_inverter') > 0);
});

test('multiplexer is named and searchable', () => {
  assert.equal(PLACEMENT_LABELS.mux2, '2:1 multiplexer');
  assert.ok(PLACEMENT_ALIASES.mux2.includes('multiplexer'));
  assert.ok(placementSearchScore('select', 'mux2') > 0);
});

test('D flip-flop variants are named and searchable in the sequential palette', () => {
  assert.equal(PLACEMENT_LABELS.dff, 'D flip-flop (CLK, Q)');
  assert.equal(PLACEMENT_LABELS.dff_rst, 'D flip-flop (CLK, RST)');
  assert.equal(PLACEMENT_LABELS.dff_clkb_rstb_qb, 'D flip-flop (CLKB, RSTB, Q, QB)');
  assert.ok(PLACEMENT_ALIASES.dff.includes('flip-flop'));
  assert.ok(placementSearchScore('sequential', 'dff_qb') > 0);
});

test('latch variants are named and searchable in the sequential palette', () => {
  assert.equal(PLACEMENT_LABELS.latch, 'L latch (EN, Q)');
  assert.equal(PLACEMENT_LABELS.latch_rst, 'L latch (EN, RST)');
  assert.equal(PLACEMENT_LABELS.latch_enb_rstb_qb, 'L latch (ENB, RSTB, Q, QB)');
  assert.ok(PLACEMENT_ALIASES.latch.includes('level sensitive'));
  assert.ok(placementSearchScore('latch', 'latch_qb') > 0);
});

test('image clipboard shortcut is discoverable once in each editor keymap', () => {
  for (const kind of ['circuit', 'block']) {
    const help = editorKeymapText(kind);
    assert.equal(help.split('Ctrl/Cmd+Shift+C').length - 1, 1);
    assert.match(help, /copy selection \(or whole drawing\) as an image for other apps/);
  }
});

test('recent placements keep one entry each, newest first, within the limit', () => {
  let recent = [];
  for (const type of ['resistor', 'nmos', 'pmos']) recent = withRecentType(recent, type);
  assert.deepEqual(recent, ['pmos', 'nmos', 'resistor']);
  // Placing something again promotes it instead of listing it twice.
  recent = withRecentType(recent, 'resistor');
  assert.deepEqual(recent, ['resistor', 'pmos', 'nmos']);
  // The oldest entry falls off the end rather than growing the group.
  for (const type of ['capacitor', 'inductor', 'diode', 'ground']) recent = withRecentType(recent, type);
  assert.equal(recent.length, INSERT_RECENT_LIMIT);
  assert.deepEqual(recent, ['ground', 'diode', 'inductor', 'capacitor', 'resistor']);
  // Nothing placed, nothing recorded; the caller's list is never mutated.
  const before = [...recent];
  assert.deepEqual(withRecentType(recent, null), before);
  assert.deepEqual(recent, before);
});
