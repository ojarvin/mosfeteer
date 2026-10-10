import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { CALCULATOR_HISTORY, normalizeWindows } from '../src/core/window-state.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('window state is saved with the design and read back', () => {
  const circuit = new Circuit();
  assert.equal('windows' in circuit.toJSON(), false, 'none: nothing saved');
  circuit.windows.references = { items: [{ path: '/w/bias.json', name: 'bias' }, { picture: { src: PNG, aspect: 2, width: 400 } }], hidden: true };
  circuit.windows.calculator = { history: [{ input: '20*log(10)', result: '20' }] };
  circuit.windows.scope = { nets: ['OUT'], periods: 64 };
  const back = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(back.windows, circuit.windows);
});

test('window state keeps only what each window shows, bounded', () => {
  const windows = normalizeWindows({
    references: { items: [{ picture: { src: 'javascript:alert(1)', aspect: 1 } }, { picture: { src: PNG, aspect: -1 } }, 'junk', { name: 'amp' }] },
    calculator: { history: Array.from({ length: CALCULATOR_HISTORY + 5 }, (_, i) => ({ input: String(i), result: String(i) })).concat([{ input: '  ' }]) },
    scope: { nets: ['A', 7, ''] },
    unknown: { anything: true },
  });
  assert.deepEqual(windows.references, { items: [{ path: '', name: 'amp' }] });
  assert.equal(windows.calculator.history.length, CALCULATOR_HISTORY);
  assert.equal(windows.calculator.history.at(-1).input, String(CALCULATOR_HISTORY + 4));
  assert.deepEqual(windows.scope, { nets: ['A'] });
  assert.equal('unknown' in windows, false);
});
