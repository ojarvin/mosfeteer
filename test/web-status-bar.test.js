import test from 'node:test';
import assert from 'node:assert/strict';
import { LOG_DRAWER_CLOSED, contextKeyHints, logDrawerTransition, statusFields, zoomPercent } from '../src/web/status-bar.js';

const run = (events, start = LOG_DRAWER_CLOSED) => events.reduce((state, event) => logDrawerTransition(state, event), start);

test('the log drawer opens by click and closes by click, Escape, or an outside click', () => {
  const open = run([{ type: 'toggle' }]);
  assert.deepEqual(open, { open: true, pinned: false, reason: 'click' });
  assert.equal(run([{ type: 'toggle' }], open).open, false);
  assert.equal(run([{ type: 'dismiss' }], open).open, false);
  // A click-opened drawer ignores the pointer leaving; it was asked for.
  assert.equal(run([{ type: 'leave' }], open).open, true);
});

test('hover and error peeks are transient; a pointer inside keeps a peek open', () => {
  assert.equal(run([{ type: 'hover' }, { type: 'leave' }]).open, false);
  const peek = run([{ type: 'error' }]);
  assert.equal(peek.reason, 'peek');
  assert.equal(run([{ type: 'peek-timeout', inside: false }], peek).open, false);
  const held = run([{ type: 'peek-timeout', inside: true }], peek);
  assert.deepEqual(held, { open: true, pinned: false, reason: 'hover' });
  assert.equal(run([{ type: 'leave' }], held).open, false);
  // Clicking a peek turns it into an explicit open rather than closing it.
  assert.equal(run([{ type: 'toggle' }], peek).reason, 'click');
  // A second error never steals an open drawer's reason.
  assert.equal(run([{ type: 'error' }], run([{ type: 'toggle' }])).reason, 'click');
});

test('the command line opens the drawer and closes it when done, unless pinned', () => {
  const command = run([{ type: 'command' }]);
  assert.equal(command.reason, 'command');
  assert.equal(run([{ type: 'command-done' }], command).open, false);
  const pinned = run([{ type: 'pin' }], command);
  assert.equal(pinned.pinned, true);
  for (const type of ['command-done', 'dismiss', 'leave']) assert.equal(run([{ type }], pinned).open, true);
  // Unpinning leaves it open; the next dismissal closes it.
  const unpinned = run([{ type: 'pin' }], pinned);
  assert.deepEqual([unpinned.open, unpinned.pinned], [true, false]);
  assert.equal(run([{ type: 'dismiss' }], unpinned).open, false);
  assert.equal(logDrawerTransition(command, { type: 'unknown' }), command);
});

test('zoom reads as a percentage of the default scale; fields hide empty selection', () => {
  assert.equal(zoomPercent({ w: 1000 }, 700, 0.7), 100);
  assert.equal(zoomPercent({ w: 500 }, 700, 0.7), 200);
  assert.equal(zoomPercent(null, 700, 0.7), 100);
  assert.deepEqual(statusFields({ mode: 'WIRE', selection: '', cursor: { x: 40, y: -80 }, hints: ['a', '', 'b'] }),
    { mode: 'WIRE', selection: '', cursor: '40, -80', hint: 'a  ·  b' });
  assert.equal(statusFields({}).mode, 'NORMAL');
});

const keysOf = (ctx) => contextKeyHints(ctx).map(([keys]) => keys);

test('the key strip offers at most three keys for what is selected or pointed at', () => {
  assert.deepEqual(keysOf({ empty: true }), ['i', 'double-click', '?']);
  assert.deepEqual(keysOf({}), ['i', 'w', '?']);
  assert.deepEqual(keysOf({ selection: { parts: ['nmos'] } }), ['q', 'r', 'Space']);
  // A switch leads with its phase; the repeat key leads whenever it applies.
  assert.deepEqual(keysOf({ selection: { parts: ['switch_open'] } }), ['s', 'q', 'r']);
  assert.deepEqual(keysOf({ selection: { parts: ['nmos'] }, repeat: 'rotate' }), ['.', 'q', 'r']);
  assert.equal(contextKeyHints({ selection: { parts: ['nmos'] }, repeat: 'rotate' })[0][1], 'repeat rotate');
  assert.deepEqual(keysOf({ selection: { parts: ['nmos', 'pmos'] } }), ['m', 'q', 'Shift+T']);
  assert.deepEqual(keysOf({ selection: { labels: 1 } }), ['t', 'Shift+←/→', 'arrows']);
  assert.deepEqual(keysOf({ selection: { nets: 1 } }), ['Shift+T', 'Shift+L', 'dd']);
  // The repeat key needs something to act on.
  assert.deepEqual(keysOf({ repeat: 'rotate' }), ['i', 'w', '?']);
});

test('the key strip follows the pointer when nothing is selected', () => {
  assert.deepEqual(keysOf({ hover: { pin: { connected: false } } }), ['drag', 'g / v', 'w']);
  assert.deepEqual(keysOf({ hover: { pin: { connected: true } } }), ['drag', 'w']);
  assert.deepEqual(keysOf({ hover: { part: 'resistor' } }), ['t', 'q', 'right-drag']);
  // A selection outranks the pointer.
  assert.deepEqual(keysOf({ selection: { labels: 1 }, hover: { part: 'resistor' } }), ['t', 'Shift+←/→', 'arrows']);
});

test('an armed tool shows how to use and leave it', () => {
  for (const tool of ['move', 'copy', 'delete']) {
    const hints = keysOf({ tool, selection: { parts: ['nmos'] } });
    assert.equal(hints.length, 3, tool);
    assert.equal(hints.at(-1), 'Esc', tool);
  }
});
