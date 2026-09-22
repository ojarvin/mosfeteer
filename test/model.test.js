import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, referenceMarkerNameConflicts, ComponentInstance, Net, parseTermRef, LabelInstance, applyMarkup, containedWireSegments, extractWireIslands, extractWireFragments, transformWorldPoints, transformComponentWorld, parseLabelRuns } from '../src/core/model.js';
import { GRID, snap, onGrid } from '../src/core/grid.js';
import { segThroughInterior } from '../src/core/router.js';
import { svgString } from '../src/core/render.js';
import { moveWireRun } from '../src/core/wireedit.js';

test('parseTermRef parses REFDES.TERM and rejects malformed', () => {
  assert.deepEqual(parseTermRef('R1.a'), { comp: 'R1', term: 'a' });
  assert.deepEqual(parseTermRef('GROUND1.gnd'), { comp: 'GROUND1', term: 'gnd' });
  assert.throws(() => parseTermRef('R1'), /invalid terminal ref/);
  assert.throws(() => parseTermRef('.a'), /invalid terminal ref/);
  assert.throws(() => parseTermRef('R1.'), /invalid terminal ref/);
});

test('component label parsing requires explicit subscript markup', () => {
  assert.deepEqual(parseLabelRuns('M1', { autoSubscript: true }), [{ text: 'M1' }]);
  assert.deepEqual(parseLabelRuns('M_{1}'), [{ text: 'M' }, { text: '1', sub: true }]);
});

test('addComponent assigns refdes from prefix', () => {
  const c = new Circuit();
  assert.equal(c.addComponent('resistor').refdes, 'R1');
  assert.equal(c.addComponent('resistor').refdes, 'R2');
  assert.equal(c.addComponent('capacitor').refdes, 'C1');
  assert.equal(c.addComponent('inductor').refdes, 'L1');
  assert.equal(c.addComponent('diode').refdes, 'D1');
  assert.equal(c.addComponent('nmos').refdes, 'M1');
  assert.equal(c.addComponent('npn').refdes, 'Q1');
  assert.equal(c.addComponent('ground').refdes, 'GROUND1');
  assert.equal(c.addComponent('supply').refdes, 'SUPPLY1');
  assert.equal(c.addComponent('input').refdes, 'VI1');
  assert.equal(c.addComponent('output').refdes, 'VO1');
  assert.equal(c.addComponent('inputoutput').refdes, 'VIO1');
});

test('automatic component names reserve owned-label ids', () => {
  const c = new Circuit();
  c.addLabel({ id: 'R1', text: 'annotation', anchor: { x: 0, y: 0 } });
  assert.equal(c.addComponent('resistor').refdes, 'R2');

  const ports = new Circuit();
  ports.addLabel({ id: 'VI1', text: 'annotation', anchor: { x: 0, y: 0 } });
  assert.equal(ports.addComponent('input').refdes, 'VI2');
  assert.equal(ports.addComponent('input').refdes, 'VI3');
  assert.equal(ports.addComponent('output').refdes, 'VO1');
  assert.equal(ports.addComponent('inputoutput').refdes, 'VIO1');
});

test('explicit component names reject an occupied owned-label id before mutation', () => {
  const c = new Circuit();
  c.addLabel({ id: 'R1', text: 'annotation', anchor: { x: 0, y: 0 } });
  assert.throws(() => c.addComponent('resistor', { refdes: 'R1' }), /label id "R1" already in use/);
  assert.equal(c.components.size, 0);
});

test('component renames keep owned instance labels synchronized across symbols', () => {
  const c = new Circuit();
  const resistor = c.addComponent('resistor', { refdes: 'R1' });
  const mos = c.addComponent('nmos', { refdes: 'M1' });

  // Explicit TeX-style source is the persisted display form and must not
  // strand the owned label on the old refdes.
  c.labelOf('M1').setText('M_{1}');
  c.renameComponent('R1', 'R_{2}');
  c.renameComponent('M1', 'M2');

  assert.equal(resistor.refdes, 'R2');
  assert.equal(mos.refdes, 'M2');
  assert.equal(c.labelOf('R2').text, 'R_{2}');
  assert.equal(c.labelOf('M2').text, 'M_{2}');
  assert.deepEqual(c.labelOf('M2').runs(), [{ text: 'M' }, { text: '2', sub: true }]);
  const custom = c.addLabel({ text: 'sense', owner: 'R2', offset: { x: 0, y: 120 } });
  c.renameComponent('R2', 'R3');
  assert.equal(c.labelOf('R3').text, 'R_{3}');
  assert.equal(custom.text, 'sense', 'custom owned text remains independent of refdes renames');
  assert.equal(c.labelOf('R1'), null);
  assert.equal(c.labelOf('M1'), null);
});

test('component rename repairs a missing legacy child label and preserves marker names', () => {
  const c = new Circuit();
  const resistor = c.addComponent('resistor', { refdes: 'R1' });
  const instanceLabel = c.labelOf('R1');
  c.labels.delete(instanceLabel.id); // emulate a pre-owned-label document
  c.renameComponent('R1', 'R2');
  assert.equal(c.labelOf('R2')?.text, 'R_{2}');

  const ground = c.addComponent('ground', { refdes: 'GND1' });
  const markerLabel = c.addLabel({ text: 'LOCAL_RETURN', owner: ground.refdes, offset: { x: 0, y: 120 } });
  c.renameComponent('GND1', 'GND2');
  assert.equal(c.labelOf('GND2'), markerLabel);
  assert.equal(markerLabel.text, 'LOCAL_RETURN');
  assert.equal(resistor.refdes, 'R2');
});

test('component rename accepts numeric subscript notation without storing braces', () => {
  const c = new Circuit();
  const mos = c.addComponent('nmos', { refdes: 'M1' });
  c.renameComponent('M1', 'M_{3}');
  assert.equal(mos.refdes, 'M3');
  assert.equal(c.labelOf('M3').text, 'M_{3}');
});

test('component names and owned labels stay synchronized and reject duplicates', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1' });
  c.addComponent('resistor', { refdes: 'R2' });
  c.labelOf('R1').setText('R_{D}');
  assert.equal(c.getComponent('RD').refdes, 'RD');
  assert.equal(c.labelOf('RD').text, 'R_{D}');
  assert.throws(() => c.labelOf('R2').setText('R_{D}'), /already in use/);
  assert.equal(c.getComponent('R2').refdes, 'R2');
  assert.equal(c.labelOf('R2').text, 'R_{2}');
  c.renameComponent('RD', 'R_{3}');
  assert.equal(c.labelOf('R3').text, 'R_{3}');
  c.renameComponent('R_{3}', 'R_{4}');
  assert.equal(c.labelOf('R4').text, 'R_{4}');
});

test('adding VCM places its vcm terminal at the origin without an owned label', () => {
  const c = new Circuit();
  const vcm = c.addComponent('vcm', { x: 400, y: 120 });
  assert.equal(vcm.refdes, 'VCM1');
  assert.deepEqual(vcm.worldTerminals(), [{ name: 'vcm', x: 400, y: 120 }]);
  assert.equal(c.labels.size, 0);
});

test('addComponent snaps position and sets defaults', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 23, y: 97 });
  assert.equal(r.transform.x, 40);
  assert.equal(r.transform.y, 80);
  assert.equal(r.transform.rotation, 0);
  assert.equal(r.transform.mirrorX, false);
  assert.equal(r.transform.mirrorY, false);
});

test('small-signal attributes persist on devices and nets', () => {
  const c = new Circuit();
  c.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  c.addComponent('port', { refdes: 'VBN', x: -160, y: 0 });
  const net = c.connect('M1.g', 'VBN.p');
  c.setComponentAnalysis('M1', { model: 'triode' });
  c.setComponentAnalysis('M1', { channelLengthModulation: 'finite' });
  c.setComponentAnalysis('M1', { gmroLarge: true, ignoreBodyEffect: true });
  c.setComponentAnalysis('VBN', { role: 'dc-bias' });
  assert.equal(c.getComponent('M1').analysis.model, 'triode');
  assert.equal(c.getComponent('M1').analysis.channelLengthModulation, 'finite');
  assert.equal(c.getComponent('M1').analysis.gmroLarge, true);
  assert.equal(c.getComponent('M1').analysis.ignoreBodyEffect, true);
  assert.equal(c.getComponent('VBN').analysis.role, 'dc-bias');
  assert.equal(net.analysis.acGround, true);
  const loaded = Circuit.fromJSON(c.toJSON());
  assert.equal(loaded.getComponent('M1').analysis.model, 'triode');
  assert.equal(loaded.getComponent('M1').analysis.channelLengthModulation, 'finite');
  assert.equal(loaded.getComponent('M1').analysis.gmroLarge, true);
  assert.equal(loaded.getComponent('M1').analysis.ignoreBodyEffect, true);
  assert.equal(loaded.getComponent('VBN').analysis.role, 'dc-bias');
  assert.equal(loaded.netOfTerminal('VBN.p').analysis.acGround, true);
  // Port and net roles are one piece of metadata: either editing surface
  // updates the other side of the physical connection.
  const roleCircuit = new Circuit();
  roleCircuit.addComponent('input', { refdes: 'VI1', x: 0, y: 0 });
  roleCircuit.addComponent('output', { refdes: 'VO1', x: 160, y: 0 });
  const roleNet = roleCircuit.connect('VI1.p', 'VO1.p');
  roleCircuit.setComponentAnalysis('VI1', { role: 'input' });
  assert.equal(roleNet.analysis.role, 'input');
  assert.equal(roleCircuit.getComponent('VI1').analysis.role, 'input');
  assert.equal(roleCircuit.getComponent('VO1').analysis.role, 'input');
  const loadedRoleCircuit = Circuit.fromJSON(roleCircuit.toJSON());
  assert.equal(loadedRoleCircuit.netOfTerminal('VI1.p').analysis.role, 'input');
  assert.equal(loadedRoleCircuit.getComponent('VO1').analysis.role, 'input');
  roleCircuit.setNetAnalysis(roleNet, { role: 'output', acGround: false });
  assert.equal(roleCircuit.getComponent('VI1').analysis.role, 'output');
  assert.equal(roleCircuit.getComponent('VO1').analysis.role, 'output');
  roleCircuit.setComponentAnalysis('VI1', { role: null });
  assert.equal(roleNet.analysis.role, null);
  assert.equal(roleCircuit.getComponent('VO1').analysis.role, null);
  c.setComponentAnalysis('M1', { model: null, channelLengthModulation: null, gmroLarge: null, ignoreBodyEffect: null });
  assert.equal(c.getComponent('M1').analysis.model, null);
  assert.equal(c.getComponent('M1').analysis.channelLengthModulation, null);
  assert.equal(c.getComponent('M1').analysis.gmroLarge, null);
  assert.equal(c.getComponent('M1').analysis.ignoreBodyEffect, null);
});

test('obsolete MOS current-source model requests are rejected without mutation', () => {
  const configured = new Circuit().addComponent('nmos', {
    refdes: 'M1',
    analysis: {
      model: 'triode',
      channelLengthModulation: 'finite',
      gmroLarge: false,
      ignoreBodyEffect: false,
    },
  });
  assert.equal(configured.analysis.model, 'triode');
  assert.equal(configured.analysis.channelLengthModulation, 'finite');
  assert.equal(configured.analysis.gmroLarge, false);
  assert.equal(configured.analysis.ignoreBodyEffect, false);

  const c = new Circuit();
  c.addComponent('nmos', { refdes: 'M1' });
  c.setComponentAnalysis('M1', {
    model: 'triode',
    channelLengthModulation: 'finite',
    gmroLarge: true,
    ignoreBodyEffect: false,
  });
  const before = structuredClone(c.getComponent('M1').analysis);

  assert.throws(
    () => c.setComponentAnalysis('M1', { model: 'current-source' }),
    /current-source model override is no longer supported/,
  );
  assert.throws(
    () => c.setComponentAnalysis('M1', { smallSignalModel: 'CURRENT-SOURCE' }),
    /current-source model override is no longer supported/,
  );
  assert.deepEqual(c.getComponent('M1').analysis, before);

  const empty = new Circuit();
  assert.throws(
    () => empty.addComponent('nmos', { refdes: 'M1', analysis: { model: 'current-source' } }),
    /current-source model override is no longer supported/,
  );
  assert.equal(empty.components.size, 0);
});

test('fromJSON drops obsolete MOS current-source models without reinterpreting other attributes', () => {
  const data = {
    version: 2,
    grid: 40,
    components: [{
      refdes: 'M1',
      type: 'nmos',
      value: '',
      transform: { x: 0, y: 0, rotation: 0, mirrorX: false, mirrorY: false },
      analysis: {
        model: 'current-source',
        smallSignalModel: 'triode',
        role: 'output',
        channelLengthModulation: 'finite',
        gmroLarge: true,
        ignoreBodyEffect: false,
      },
    }],
    nets: [],
    labels: [],
  };
  const before = structuredClone(data);

  const loaded = Circuit.fromJSON(data);
  const analysis = loaded.getComponent('M1').analysis;
  assert.equal(analysis.model, null);
  assert.equal(analysis.role, 'output');
  assert.equal(analysis.channelLengthModulation, 'finite');
  assert.equal(analysis.gmroLarge, true);
  assert.equal(analysis.ignoreBodyEffect, false);
  assert.deepEqual(data, before, 'loading must not mutate serialized input');

  const saved = loaded.toJSON().components.find(({ refdes }) => refdes === 'M1');
  assert.notEqual(saved.analysis.model, 'current-source');
  assert.equal(saved.analysis.channelLengthModulation, 'finite');
  assert.equal(saved.analysis.gmroLarge, true);
  assert.equal(saved.analysis.ignoreBodyEffect, false);
});

test('saved sequential symbols keep reset pins across the variant rename', () => {
  const old = new Circuit();
  old.addComponent('dff_rst', { refdes: 'U1', x: 0, y: 0 });
  old.addComponent('latch_enb_rst', { refdes: 'U2', x: 480, y: 0 });
  old.wireTo('U1.RST', old.getComponent('U2').terminalWorld('RST'));
  const legacy = old.toJSON();
  delete legacy.sequentialVariantVersion;
  legacy.components[0].type = 'dff';
  legacy.components[1].type = 'latch_enb';

  const loaded = Circuit.fromJSON(legacy);
  assert.equal(loaded.getComponent('U1').type, 'dff_rst');
  assert.equal(loaded.getComponent('U2').type, 'latch_enb_rst');
  assert.deepEqual(loaded.netOfTerminal({ comp: 'U1', term: 'RST' })?.terminals,
    old.netOfTerminal({ comp: 'U1', term: 'RST' })?.terminals);

  const fresh = new Circuit();
  fresh.addComponent('dff', { refdes: 'U1' });
  fresh.addComponent('latch', { refdes: 'U2', x: 480 });
  const roundTrip = Circuit.fromJSON(fresh.toJSON());
  assert.equal(roundTrip.getComponent('U1').type, 'dff');
  assert.equal(roundTrip.getComponent('U2').type, 'latch');
  assert.equal(roundTrip.getComponent('U1').terminalDefs.some(({ name }) => name === 'RST'), false);
});

test('resistor infinity attributes persist and can be cleared', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.setComponentAnalysis('R1', { resistance: 'infinite' });
  assert.equal(c.getComponent('R1').analysis.resistance, 'infinite');
  const loaded = Circuit.fromJSON(c.toJSON());
  assert.equal(loaded.getComponent('R1').analysis.resistance, 'infinite');
  c.setComponentAnalysis('R1', { resistance: null });
  assert.equal(c.getComponent('R1').analysis.resistance, null);
});

test('math labels persist their TeX source marker', () => {
  const c = new Circuit();
  const label = c.addLabel({ text: 'Z_{out} = r_{o1}', x: 0, y: 0, math: true });
  assert.equal(label.math, true);
  const loaded = Circuit.fromJSON(c.toJSON());
  assert.equal(loaded.labels.get(label.id).math, true);
  assert.equal(loaded.labels.get(label.id).text, 'Z_{out} = r_{o1}');
});

test('math labels persist escaped parallel bars', () => {
  const c = new Circuit();
  const label = c.addLabel({ text: '$$R_{1} || R_{2}$$', x: 0, y: 0, math: true });
  assert.equal(label.text, '$$R_{1} \\|\\| R_{2}$$');
  label.setText('$$R_{3} || R_{4}$$');
  assert.equal(label.text, '$$R_{3} \\|\\| R_{4}$$');
});

test('symbol defaultMirror flags apply when not overridden', () => {
  const c = new Circuit();
  // output ports face outward by default (terminal on the circuit side)
  const o = c.addComponent('output');
  assert.equal(o.transform.mirrorX, true, 'output defaults to mirrorX');
  const i = c.addComponent('input');
  assert.equal(i.transform.mirrorX, false, 'input stays un-mirrored');
  const io = c.addComponent('inputoutput');
  assert.equal(io.transform.mirrorX, false, 'inputoutput stays un-mirrored');
  // pmos source points up by default
  const p = c.addComponent('pmos');
  assert.equal(p.transform.mirrorY, true, 'pmos defaults to mirrorY');
  // an explicit mirror flag still wins over the default
  const o2 = c.addComponent('output', { mirrorX: false });
  assert.equal(o2.transform.mirrorX, false, 'explicit mirrorX overrides the output default');
});

test('bulk MOS components use M refs, bulk terminal, and semantic label offsets', () => {
  const c = new Circuit();
  const n = c.addComponent('nmosb', { x: 400, y: 400 });
  const p = c.addComponent('pmosb', { x: 800, y: 400 });
  assert.equal(n.refdes, 'M1');
  assert.equal(p.refdes, 'M2');
  assert.deepEqual(n.worldTerminals().map(({ name, x, y }) => ({ name, x, y })), [
    { name: 'g', x: 280, y: 400 }, { name: 'd', x: 400, y: 320 },
    { name: 's', x: 400, y: 480 }, { name: 'b', x: 400, y: 400 },
  ]);
  assert.deepEqual(p.worldTerminals().find(({ name }) => name === 'b'), { name: 'b', x: 800, y: 400 });
  assert.deepEqual(c.labelOf(n.refdes).offset, { x: 40, y: -40 });
  assert.deepEqual(c.labelOf(p.refdes).offset, { x: 40, y: -40 });
  assert.equal(p.transform.mirrorY, true);
  assert.deepEqual(p.worldTerminals().find(({ name }) => name === 'd'), { name: 'd', x: 800, y: 480 });
  assert.deepEqual(c.labelOf(p.refdes).anchorWorld(), { x: 840, y: 440 });
});

test('addComponent rejects duplicate refdes', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R9' });
  assert.throws(() => c.addComponent('resistor', { refdes: 'R9' }), /already in use/);
});

test('adding a reference marker directly on a terminal connects immediately', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('ground', { refdes: 'GND1', x: 80, y: 0 });
  const net = c.netOfTerminal('R1.b');
  assert.ok(net);
  assert.deepEqual(net.terminals, [
    { comp: 'GND1', term: 'gnd' },
    { comp: 'R1', term: 'b' },
  ]);
});

test('getComponent returns and throws for unknown', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor');
  assert.equal(c.getComponent(r.refdes), r);
  assert.throws(() => c.getComponent('NOPE'), /unknown component/);
});

test('moveComponent snaps to grid', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor');
  c.moveComponent(r.refdes, 123, 456);
  assert.equal(r.transform.x, 120);
  assert.equal(r.transform.y, 440);
});

test('moveComponent defers coincident terminal connection until commit', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 400, y: 0 });

  // R1.b reaches R2.a at the preview position, but movement itself must not
  // mutate connectivity.
  c.moveComponent('R1', 240, 0);
  assert.equal(c.nets.size, 0);

  // The caller resolves coincidence at its commit boundary.
  assert.equal(c.connectCoincident('R1'), 1);
  assert.deepEqual(c.netOfTerminal('R1.b').terminals, [
    { comp: 'R1', term: 'b' },
    { comp: 'R2', term: 'a' },
  ]);
});

test('setTransform normalizes rotation into 0/90/180/270', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor');
  c.setTransform(r.refdes, { rotation: 90 });
  assert.equal(r.transform.rotation, 90);
  c.setTransform(r.refdes, { rotation: 270 });
  assert.equal(r.transform.rotation, 270);
  c.setTransform(r.refdes, { rotation: 360 });
  assert.equal(r.transform.rotation, 0);
  c.setTransform(r.refdes, { rotation: -90 });
  assert.equal(r.transform.rotation, 270);
  c.setTransform(r.refdes, { rotation: 920 });
  assert.ok([0, 90, 180, 270].includes(r.transform.rotation));
});

test('setTransform sets mirror flags', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor');
  c.setTransform(r.refdes, { mirrorX: true });
  assert.equal(r.transform.mirrorX, true);
  c.setTransform(r.refdes, { mirrorY: true });
  assert.equal(r.transform.mirrorY, true);
  c.setTransform(r.refdes, { mirrorX: false });
  assert.equal(r.transform.mirrorX, false);
});

test('setValue coerces to string', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor');
  c.setValue(r.refdes, '1k');
  assert.equal(r.value, '1k');
  c.setValue(r.refdes, 420);
  assert.equal(r.value, '420');
});

test('default value from symbol', () => {
  const c = new Circuit();
  assert.equal(c.addComponent('resistor').value, '');
  assert.equal(c.addComponent('supply').value, '');
  assert.equal(c.addComponent('output').value, '');
});

test('interface pins name their physical net and follow later renames', () => {
  const c = new Circuit();
  const pin = c.addComponent('input', { x: 0, y: 0 });
  const resistor = c.addComponent('resistor', { x: 240, y: 0 });
  const net = c.connect(`${pin.refdes}.p`, `${resistor.refdes}.a`);
  const pinLabel = c.labelOf(pin.refdes);

  assert.equal(net.name, pinLabel.text);
  assert.equal(pinLabel.text, 'V_{I1}');

  c.renameNet(net, 'VIN');
  assert.equal(net.name, 'VIN');
  assert.equal(pinLabel.text, 'VIN');

  // Editing the owned pin label uses the same physical-net naming API, so the
  // invariant also holds for the editor's inline label workflow.
  pinLabel.setText('DATA');
  assert.equal(net.name, 'DATA');
  assert.equal(pinLabel.text, 'DATA');
});

test('interface label restores a renamed single-pin net', () => {
  const c = new Circuit();
  const pin = c.addComponent('input', { refdes: 'VIN', x: 0, y: 0 });
  const resistor = c.addComponent('resistor', { x: 240, y: 0 });
  const net = c.connect(`${pin.refdes}.p`, `${resistor.refdes}.a`);
  const pinLabel = c.labelOf(pin.refdes);

  c.renameNet(net, 'OTHER');
  pinLabel.setText('V_{IN}');
  assert.equal(net.name, 'V_{IN}');
  assert.equal(pinLabel.text, 'V_{IN}');
});

test('interface markup is retained when the port is labeled before connection', () => {
  const c = new Circuit();
  const pin = c.addComponent('input', { refdes: 'VIN', x: 0, y: 0 });
  const pinLabel = c.labelOf(pin.refdes);
  pinLabel.setText('V_{IN}');
  const resistor = c.addComponent('resistor', { x: 240, y: 0 });
  const net = c.connect(`${pin.refdes}.p`, `${resistor.refdes}.a`);

  assert.equal(net.name, 'V_{IN}');
  assert.equal(pinLabel.text, 'V_{IN}');
});

test('two ports can never carry one name', () => {
  const c = new Circuit();
  const first = c.addComponent('input', { refdes: 'VIN', x: 0, y: 0 });
  const second = c.addComponent('input', { refdes: 'VI2', x: 0, y: 400 });
  c.addComponent('resistor', { refdes: 'R1', x: 240, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 240, y: 400 });
  const firstNet = c.connect(`${first.refdes}.p`, 'R1.a');
  const secondNet = c.connect(`${second.refdes}.p`, 'R2.a');

  // A port label is the port's identity, so the collision is the ordinary
  // component-name collision and nothing is mutated.
  assert.throws(() => c.labelOf(second.refdes).setText(firstNet.name), /already in use/);
  assert.equal(second.refdes, 'VI2');
  assert.equal(c.labelOf('VI2').text, 'V_{I2}');
  assert.equal(secondNet.name, 'V_{I2}');

  // The deliberate virtual connection is made on the net. The port keeps its
  // own identity, so its label never shows the other port's name.
  c.renameNet(secondNet, firstNet.name);
  assert.notEqual(firstNet.id, secondNet.id);
  assert.equal(c.logicallyConnected(firstNet, secondNet), true);
  assert.equal(second.refdes, 'VI2');
  assert.equal(c.labelOf('VI2').text, 'V_{I2}');
});

test('several ports on one net keep their own identities', () => {
  const c = new Circuit();
  c.addComponent('input', { refdes: 'VIN', x: 0, y: 0 });
  c.addComponent('output', { refdes: 'VOUT', x: 800, y: 0 });
  c.addComponent('resistor', { refdes: 'R1', x: 400, y: 400 });
  c.connect('VIN.p', 'R1.a');
  c.connect('VOUT.p', 'R1.b');
  const net = c.connect('VIN.p', 'VOUT.p');

  // The net keeps one name; neither port is relabelled with the other's.
  assert.equal(c.labelOf('VIN').text, 'VIN');
  assert.equal(c.labelOf('VOUT').text, 'VOUT');
  assert.equal(net.terminals.filter(({ comp }) => comp === 'VIN' || comp === 'VOUT').length, 2);
  assert.equal(net.name, 'VIN');

  // Dropping back to one port makes that port the net's name again.
  c.removeComponent('VIN');
  assert.equal(net.name, 'VOUT');
  assert.equal(c.labelOf('VOUT').text, 'VOUT');
});

test('renaming a net renames the port that names it', () => {
  const c = new Circuit();
  const pin = c.addComponent('input', { x: 0, y: 0 });
  c.addComponent('resistor', { refdes: 'R1', x: 240, y: 0 });
  const net = c.connect(`${pin.refdes}.p`, 'R1.a');
  assert.equal(pin.refdes, 'VI1');

  c.renameNet(net, 'V_{REF}');
  assert.equal(pin.refdes, 'VREF');
  assert.equal(c.labelOf('VREF').text, 'V_{REF}');
  assert.equal(net.name, 'V_{REF}');
  assert.equal(c.components.has('VI1'), false);

  // A name that cannot be a component identity stays on the net alone: the
  // port simply does not name this net, and its label stays its own.
  c.renameNet(net, 'N+');
  assert.equal(net.name, 'N+');
  assert.equal(pin.refdes, 'VREF');
  assert.equal(c.labelOf('VREF').text, 'V_{REF}');
});

test('all interface pin directions participate in net naming', () => {
  for (const type of ['input', 'output', 'inputoutput']) {
    const c = new Circuit();
    const pin = c.addComponent(type, { x: 0, y: 0 });
    const resistor = c.addComponent('resistor', { x: 240, y: 0 });
    const net = c.connect(`${pin.refdes}.p`, `${resistor.refdes}.a`);
    assert.equal(net.name, c.labelOf(pin.refdes).text, type);
    const displayPrefix = type === 'output' ? 'O' : type === 'inputoutput' ? 'IO' : 'I';
    assert.equal(c.labelOf(pin.refdes).text, `V_{${displayPrefix}1}`, type);
    c.renameNet(net, 'RENAMED');
    assert.equal(c.labelOf(pin.refdes).text, 'RENAMED', type);
  }
});

test('the circle port is an interface pin with an owned label that names its net', () => {
  const c = new Circuit();
  const pin = c.addComponent('port', { x: 0, y: 0 });
  assert.equal(pin.refdes, 'P1');
  const label = c.labelOf(pin.refdes);
  assert.equal(label.text, 'P_{1}');
  assert.deepEqual(label.offset, { x: -120, y: 0 });
  const resistor = c.addComponent('resistor', { x: 240, y: 0 });
  const net = c.connect(`${pin.refdes}.p`, `${resistor.refdes}.a`);
  assert.equal(net.name, label.text);

  label.setText('V_{BIAS}');
  assert.equal(c.getComponent('VBIAS').refdes, 'VBIAS');
  assert.equal(net.name, 'V_{BIAS}');
  c.renameNet(net, 'VREF');
  assert.equal(c.components.has('VBIAS'), false);
  assert.equal(c.getComponent('VREF').type, 'port');
  assert.equal(c.labelOf('VREF').text, 'VREF');
});

test('legacy filled and unlabelled ports load as labelled ports', () => {
  const c = new Circuit();
  c.addComponent('port', { refdes: 'P1', x: 0, y: 0 });
  c.addComponent('port', { refdes: 'P2', x: 0, y: 400 });
  const data = c.toJSON();
  data.components.find((component) => component.refdes === 'P2').type = 'port_filled';
  data.labels = [];
  const loaded = Circuit.fromJSON(data);
  assert.equal(loaded.getComponent('P2').type, 'port');
  assert.equal(loaded.labelOf('P1').text, 'P_{1}');
  assert.equal(loaded.labelOf('P2').text, 'P_{2}');
});

test('legacy two-input gate types load as explicit arity names', () => {
  const c = new Circuit();
  for (const [index, type] of ['and2_gate', 'nand2_gate', 'or2_gate', 'nor2_gate', 'xor2_gate', 'xnor2_gate'].entries()) {
    c.addComponent(type, { refdes: `U${index + 1}`, x: index * 400, y: 0 });
  }
  const data = c.toJSON();
  for (const [index, type] of ['and_gate', 'nand_gate', 'or_gate', 'nor_gate', 'xor_gate', 'xnor_gate'].entries()) {
    data.components[index].type = type;
  }
  const loaded = Circuit.fromJSON(data);
  assert.deepEqual([...loaded.components.values()].map((component) => component.type), [
    'and2_gate', 'nand2_gate', 'or2_gate', 'nor2_gate', 'xor2_gate', 'xnor2_gate',
  ]);
});

test('interface pin names and owned labels stay synchronized with their single-owner net', () => {
  const c = new Circuit();
  const pin = c.addComponent('input', { x: 0, y: 0 });
  const resistor = c.addComponent('resistor', { x: 240, y: 0 });
  const net = c.connect(`${pin.refdes}.p`, `${resistor.refdes}.a`);
  const label = c.labelOf(pin.refdes);

  label.setText('V_{IN}');
  assert.equal(c.getComponent('VIN').refdes, 'VIN');
  assert.equal(label.text, 'V_{IN}');
  assert.equal(net.name, 'V_{IN}');

  c.renameComponent('VIN', 'V_{SOURCE}', { displayLabel: 'V_{SOURCE}' });
  assert.equal(c.labelOf('VSOURCE').text, 'V_{SOURCE}');
  assert.equal(net.name, 'V_{SOURCE}');
});

test('formatted interface labels survive preview/load reconstruction', () => {
  const c = new Circuit();
  const output = c.addComponent('output', { x: 0, y: 0 });
  const resistor = c.addComponent('resistor', { x: 240, y: 0 });
  c.connect(`${output.refdes}.p`, `${resistor.refdes}.a`);
  c.renameComponent(output.refdes, 'VOUT', { displayLabel: 'V_{OUT}' });
  const data = c.toJSON();
  data.nets.find((net) => net.terminals.some((terminal) => terminal.comp === 'VOUT' && terminal.term === 'p')).name = 'VOUT';
  const loaded = Circuit.fromJSON(data);
  assert.equal(loaded.labelOf('VOUT').text, 'V_{OUT}');
  assert.equal(loaded.netOfTerminal('VOUT.p').name, 'V_{OUT}');
});

test('reference markers auto-name attached nets and preserve explicit names', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  const gnd = c.addComponent('ground', { refdes: 'GND1', x: -80, y: 0 });
  const net = c.connect(`${r1.refdes}.a`, `${gnd.refdes}.gnd`);
  assert.equal(net.name, 'VSS');

  const r2 = c.addComponent('resistor', { refdes: 'R2', x: 400, y: 0 });
  const supply = c.addComponent('supply', { refdes: 'SUPPLY1', x: 480, y: 0 });
  assert.equal(c.connect(`${r2.refdes}.a`, `${supply.refdes}.p`).name, 'VDD');

  const r3 = c.addComponent('resistor', { refdes: 'R3', x: 800, y: 0 });
  const vcm = c.addComponent('vcm', { refdes: 'VCM1', x: 880, y: 0 });
  assert.equal(c.connect(`${r3.refdes}.a`, `${vcm.refdes}.vcm`).name, 'VCM');

  const r4 = c.addComponent('resistor', { refdes: 'R4', x: 1200, y: 0 });
  const named = c.addComponent('ground', { refdes: 'GND2', x: 1120, y: 0 });
  const explicit = c.connect(`${r4.refdes}.a`, `${named.refdes}.gnd`);
  c.renameNet(explicit, 'LOCAL_RETURN');
  assert.equal(explicit.name, 'LOCAL_RETURN');
  c.connect(`${r4.refdes}.b`, `${r1.refdes}.b`);
  assert.equal(explicit.name, 'LOCAL_RETURN');
});

test('legacy GND naming remains a global ground alias without creating a child label', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('ground', { refdes: 'GND1', x: -80, y: 0 });
  const net = c.connect('R1.a', 'GND1.gnd');
  c.renameNet(net, 'GND');
  assert.equal(net.name, 'GND');
  assert.equal(c.labelOf('GND1'), null);
});

test('reference labels distinguish compatibility aliases from explicit local rails', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('ground', { refdes: 'GND1', x: -80, y: 0 });
  const net = c.connect('R1.a', 'GND1.gnd');
  c.renameNet(net, 'VBIAS');
  assert.equal(c.labelOf('GND1').referenceLocal, false);
  const restored = Circuit.fromJSON(c.toJSON());
  assert.equal(restored.labelOf('GND1').referenceLocal, false);
  restored.labelOf('GND1').setText('LOCAL_GND');
  assert.equal(restored.labelOf('GND1').referenceLocal, true);
});

test('a named reference marker becomes a local rail', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  const supply = c.addComponent('supply', { refdes: 'SUPPLY1', x: -80, y: 0, value: 'AVDD' });
  const net = c.connect(`${r.refdes}.a`, `${supply.refdes}.p`);
  assert.equal(net.name, 'VDD');
  assert.equal(supply.value, 'AVDD');
  const label = c.addLabel({ text: 'AVDD', owner: supply.refdes, offset: { x: 0, y: -120 } });
  label.setText('AVDD');
  assert.equal(net.name, 'AVDD');
});

test('reference marker child labels make the marker local and rename its net', () => {
  const c = new Circuit();
  const resistor = c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  const ground = c.addComponent('ground', { refdes: 'GND1', x: -80, y: 0 });
  const net = c.connect('R1.a', 'GND1.gnd');
  const label = c.addLabel({ text: '', owner: 'GND1', offset: { x: 0, y: 120 } });
  label.setText('LOCAL_GND');
  assert.equal(ground.value, 'LOCAL_GND');
  assert.equal(net.name, 'LOCAL_GND');
  assert.equal(c.labelOf(ground.refdes).text, 'LOCAL_GND');
  c.renameNet(net, 'LOCAL_RETURN');
  assert.equal(ground.value, 'LOCAL_RETURN');
  assert.equal(label.text, 'LOCAL_RETURN');
  assert.equal(resistor.refdes, 'R1');
});

test('deleting a marker child label restores the global rail and leaves no value text', () => {
  for (const [type, terminal, global, offset] of [['supply', 'p', 'VDD', -120], ['ground', 'gnd', 'VSS', 120], ['vcm', 'vcm', 'VCM', 120]]) {
    const c = new Circuit();
    c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
    const marker = c.addComponent(type, { refdes: 'M1', x: -80, y: 0 });
    const net = c.connect('R1.a', `M1.${terminal}`);
    const label = c.addLabel({ text: '', owner: 'M1', offset: { x: 0, y: offset } });
    label.setText('LOCAL_RAIL');
    assert.equal(net.name, 'LOCAL_RAIL');
    c.removeLabel(label.id);
    assert.equal(marker.value, '', `${type} keeps no orphaned value text`);
    assert.equal(net.name, global);
    assert.ok(!svgString(c, { grid: false }).includes('LOCAL_RAIL'));
  }
});

test('deleting one marker label keeps a name another local marker still owns', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('ground', { refdes: 'GND1', x: -80, y: 0 });
  c.addComponent('ground', { refdes: 'GND2', x: -80, y: 200 });
  const net = c.connect('R1.a', 'GND1.gnd');
  c.connect('GND2.gnd', 'GND1.gnd');
  const first = c.addLabel({ text: '', owner: 'GND1', offset: { x: 0, y: 120 } });
  first.setText('LOCAL_GND');
  const second = c.addLabel({ text: '', owner: 'GND2', offset: { x: 0, y: 120 } });
  second.setText('LOCAL_GND');
  assert.equal(net.name, 'LOCAL_GND');
  c.removeLabel(first.id);
  assert.equal(c.components.get('GND1').value, '');
  assert.equal(net.name, 'LOCAL_GND');
});

test('terminalWorld applies transform and stays on grid', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 400, y: 0 });
  assert.deepEqual(r.terminalWorld('a'), { x: 320, y: 0 });
  assert.deepEqual(r.terminalWorld('b'), { x: 480, y: 0 });
});

test('terminalWorld with rotation 90', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 400, y: 0, rotation: 90 });
  // local a=(-80,0)->(0,-80); b=(80,0) rotate 90 -> (0,80).
  assert.deepEqual(r.terminalWorld('a'), { x: 400, y: -80 });
  assert.deepEqual(r.terminalWorld('b'), { x: 400, y: 80 });
});

test('worldTerminals and bboxWorld', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 400, y: 0 });
  assert.deepEqual(r.worldTerminals(), [
    { name: 'a', x: 320, y: 0 },
    { name: 'b', x: 480, y: 0 },
  ]);
  assert.deepEqual(r.bboxWorld(), { x: 320, y: -40, w: 160, h: 80 });
});

test('countTerminals counts all symbol terminals', () => {
  const c = new Circuit();
  c.addComponent('resistor');
  c.addComponent('nmos');
  c.addComponent('ground');
  assert.equal(c.countTerminals(), 2 + 3 + 1);
});

test('connect creates a net and adds terminals', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 80, y: 0 });
  const r2 = c.addComponent('resistor', { x: 480, y: 0 });
  const net = c.connect(`${r1.refdes}.a`, `${r2.refdes}.a`);
  assert.ok(net.id.startsWith('N'));
  assert.equal(net.terminalCount(), 2);
  assert.equal(c.nets.size, 1);
});

test('connect merges existing nets into one', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 80, y: 0 });
  const r2 = c.addComponent('resistor', { x: 480, y: 0 });
  const r3 = c.addComponent('resistor', { x: 880, y: 0 });
  const n1 = c.connect(`${r1.refdes}.a`, `${r2.refdes}.a`);
  const n2 = c.connect(`${r2.refdes}.b`, `${r3.refdes}.b`);
  assert.equal(c.nets.size, 2);
  const merged = c.connect(`${r1.refdes}.a`, `${r3.refdes}.b`);
  assert.equal(c.nets.size, 1);
  assert.equal([...c.nets.values()][0].terminalCount(), 4);
  assert.equal(merged, n1);
  assert.equal(c.netOfTerminal(`${r2.refdes}.b`), merged);
});

test('coincident nets merge without routing a zero-length bridge', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 1000, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 800, y: 800, rotation: 90 });
  c.addComponent('resistor', { refdes: 'R4', x: 1200, y: 800 });
  const first = c.connect('R1.b', 'R3.a');
  const second = c.connect('R2.a', 'R4.a');
  c.components.get('R2').transform = { x: 160, y: 80, rotation: 90, mirrorX: false, mirrorY: false };

  const merged = c.connectCoincident(['R2']);

  assert.equal(merged, 1);
  assert.equal(c.nets.size, 1);
  const net = [...c.nets.values()][0];
  assert.equal(net.terminals.length, 4);
  assert.ok(net.paths().every((path) => path.length >= 2));
  assert.ok([first.id, second.id].includes(net.id));
  assert.equal(c.netOfTerminal('R1.b'), c.netOfTerminal('R2.a'));
});

test('merging nets preserves committed paths and adds one safe bridge', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 80, y: 0 });
  const r2 = c.addComponent('resistor', { x: 480, y: 0 });
  const r3 = c.addComponent('resistor', { x: 880, y: 0 });
  const a = c.connect(`${r1.refdes}.a`, `${r2.refdes}.a`);
  const b = c.connect(`${r2.refdes}.b`, `${r3.refdes}.b`);
  a.branches = [[{ x: 0, y: 0 }, { x: 0, y: 160 }, { x: 400, y: 160 }, { x: 400, y: 0 }]];
  a.route = a.branches[0];
  b.branches = [[{ x: 560, y: 0 }, { x: 560, y: -160 }, { x: 960, y: -160 }, { x: 960, y: 0 }]];
  b.route = b.branches[0];
  const committed = [a.branches[0].map((p) => ({ ...p })), b.branches[0].map((p) => ({ ...p }))];
  const merged = c.connect(`${r1.refdes}.a`, `${r3.refdes}.b`);
  const paths = merged.paths();
  const samePath = (aPath, bPath) => JSON.stringify(aPath) === JSON.stringify(bPath);
  assert.ok(paths.some((path) => samePath(path, committed[0])));
  assert.ok(paths.some((path) => samePath(path, committed[1])));
  for (const t of merged.terminals) {
    const p = c.getComponent(t.comp).terminalWorld(t.term);
    assert.ok(paths.some((path) => path.some((q) => q.x === p.x && q.y === p.y)), `${t.comp}.${t.term} is drawable`);
  }
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      for (const comp of c.components.values()) {
        if (comp.type === 'solder') continue;
        assert.equal(segThroughInterior(path[i - 1], path[i], comp.bboxWorld()), false);
      }
    }
  }
});

test('diagonal wirePointTo keeps a component terminal touched at its origin', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 200, y: 200 });
  const r2 = c.addComponent('resistor', { x: 600, y: 400 });
  const net = c.wirePointTo(
    r1.terminalWorld('b'),
    r2.terminalWorld('a'),
    [],
    null,
    { routeStyle: 'diagonal', allowDiagonal: true },
  );
  assert.deepEqual(net.terminals, [
    { comp: r1.refdes, term: 'b' },
    { comp: r2.refdes, term: 'a' },
  ]);
});

test('diode-connected managed nets merge through a visible safe bridge', () => {
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { x: 400, y: 400 });
  const m2 = c.addComponent('nmos', { x: 800, y: 400 });
  c.connect(`${m1.refdes}.g`, `${m1.refdes}.d`);
  c.connect(`${m2.refdes}.g`, `${m2.refdes}.d`);

  const merged = c.wireTo(`${m1.refdes}.g`, m2.terminalWorld('g'));
  assert.equal(c.nets.size, 1);
  assert.equal(merged.terminalCount(), 4);
  assert.ok(merged.branches.length >= 3, 'both diode trees and a bridge are drawable');
  for (const t of merged.terminals) {
    const p = c.getComponent(t.comp).terminalWorld(t.term);
    assert.ok(merged.paths().some((path) => path.some((q) => q.x === p.x && q.y === p.y)));
  }
  for (const path of merged.paths()) {
    for (let i = 1; i < path.length; i++) {
      for (const comp of c.components.values()) {
        if (comp.type === 'solder') continue;
        assert.equal(segThroughInterior(path[i - 1], path[i], comp.bboxWorld()), false);
      }
    }
  }
});

test('connect applies the same connected repair to diode-connected nets', () => {
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { x: 400, y: 400 });
  const m2 = c.addComponent('nmos', { x: 800, y: 400 });
  c.connect(`${m1.refdes}.g`, `${m1.refdes}.d`);
  c.connect(`${m2.refdes}.g`, `${m2.refdes}.d`);
  const merged = c.connect(`${m1.refdes}.g`, `${m2.refdes}.g`);
  assert.equal(c.nets.size, 1);
  assert.equal(merged.terminalCount(), 4);
  assert.ok(merged.paths().length >= 3);
  for (const t of merged.terminals) {
    const p = c.getComponent(t.comp).terminalWorld(t.term);
    assert.ok(merged.paths().some((path) => path.some((q) => q.x === p.x && q.y === p.y)));
  }
});

test('failed diode-net wire merge restores both managed nets exactly', () => {
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { x: 400, y: 400 });
  const m2 = c.addComponent('nmos', { x: 800, y: 400 });
  const a = c.connect(`${m1.refdes}.g`, `${m1.refdes}.d`);
  const b = c.connect(`${m2.refdes}.g`, `${m2.refdes}.d`);
  const before = new Map([a, b].map((n) => [n.id, {
    net: n,
    terminals: n.terminals.map((t) => ({ ...t })),
    branches: n.branches?.map((path) => path.map((p) => ({ ...p }))) || null,
  }]));
  const base = c._netEnv();
  c._netEnv = () => ({ ...base, rects: [{ x: -10000, y: -10000, w: 20000, h: 20000 }] });

  assert.throws(() => c.wireTo(`${m1.refdes}.g`, m2.terminalWorld('g')), /unable to route wire safely/);
  assert.deepEqual([...c.nets.keys()], [a.id, b.id]);
  for (const [id, saved] of before) {
    const net = c.nets.get(id);
    assert.equal(net, saved.net);
    assert.deepEqual(net.terminals, saved.terminals);
    assert.deepEqual(net.branches, saved.branches);
  }
});

test('failed connect merge restores both managed nets exactly', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 80, y: 0 });
  const r2 = c.addComponent('resistor', { x: 480, y: 0 });
  const r3 = c.addComponent('resistor', { x: 880, y: 0 });
  const a = c.connect(`${r1.refdes}.a`, `${r2.refdes}.a`);
  const b = c.connect(`${r2.refdes}.b`, `${r3.refdes}.b`);
  const saved = new Map([a, b].map((n) => [n.id, {
    net: n,
    terminals: n.terminals.map((t) => ({ ...t })),
    branches: n.branches?.map((path) => path.map((p) => ({ ...p }))) || null,
  }]));
  c._netEnv = () => ({ rects: [{ x: -10000, y: -10000, w: 20000, h: 20000 }], pins: new Map(), wires: [], labelRects: [] });

  assert.throws(() => c.connect(`${r1.refdes}.a`, `${r3.refdes}.b`), /unable to route wire safely/);
  assert.deepEqual([...c.nets.keys()], [a.id, b.id]);
  for (const [id, before] of saved) {
    const net = c.nets.get(id);
    assert.equal(net, before.net);
    assert.deepEqual(net.terminals, before.terminals);
    assert.deepEqual(net.branches, before.branches);
  }
});

test('connect throws on self-connection', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor');
  assert.throws(() => c.connect(`${r1.refdes}.a`, `${r1.refdes}.a`), /cannot connect a terminal to itself/);
});

test('netOfTerminal returns null when unconnected', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor');
  assert.equal(c.netOfTerminal(`${r1.refdes}.a`), null);
});

test('disconnect removes just that terminal and drops empty nets', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor');
  const r2 = c.addComponent('resistor');
  const net = c.connect(`${r1.refdes}.a`, `${r2.refdes}.a`);
  const back = c.disconnect(`${r1.refdes}.a`);
  assert.equal(back, net);
  assert.equal(net.terminalCount(), 1);
  assert.equal(c.netOfTerminal(`${r1.refdes}.a`), null);
  assert.equal(c.netOfTerminal(`${r2.refdes}.a`), net);
});

test('disconnect of the last terminal succeeds and drops the empty net', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 80, y: 0 });
  const r2 = c.addComponent('resistor', { x: 480, y: 0 });
  const net = c.connect(`${r1.refdes}.a`, `${r2.refdes}.a`);
  const r = net; // remove R1 first so R2 is last
  c.disconnect(`${r1.refdes}.a`);
  const back = c.disconnect(`${r2.refdes}.a`);
  assert.equal(back, net);
  assert.equal(c.nets.size, 0);
});

test('wire paths are canonical and deleting a segment splits terminal connectivity', () => {
  const c = new Circuit();
  const a = c.addComponent('resistor', { x: 80, y: 0 });
  const b = c.addComponent('resistor', { x: 480, y: 0 });
  const n = c.connect(`${a.refdes}.a`, `${b.refdes}.a`);
  n.branches = [[{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 400, y: 80 }, { x: 400, y: 0 }]];
  n.route = n.branches[0];
  c.deleteWireSegment(n.id, 0, 2);
  assert.equal(c.netOfTerminal(`${a.refdes}.a`)?.id, n.id);
  assert.notEqual(c.netOfTerminal(`${b.refdes}.a`)?.id, n.id);
  assert.equal(c.nets.size, 2);
});

test('solder dots are absent from ordinary elbows and floating space', () => {
  const c = new Circuit();
  const a = c.addComponent('resistor', { x: 80, y: 0 });
  const b = c.addComponent('resistor', { x: 480, y: 0 });
  const n = c.connect(`${a.refdes}.a`, `${b.refdes}.a`);
  n.branches = [[{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 400, y: 80 }, { x: 400, y: 0 }]];
  n.route = n.branches[0];
  c.syncJunctionSolders();
  assert.equal([...c.components.values()].filter((x) => x.type === 'solder').length, 0);
  c.addComponent('solder', { x: 1000, y: 1000 });
  c.syncJunctionSolders();
  assert.equal([...c.components.values()].filter((x) => x.type === 'solder').length, 0);
});

test('solder dots belong to one net junction, not another net crossing', () => {
  const c = new Circuit();
  const a = c.addComponent('resistor', { x: 80, y: 0 });
  const b = c.addComponent('resistor', { x: 480, y: 0 });
  const d = c.addComponent('resistor', { x: 80, y: 400 });
  const e = c.addComponent('resistor', { x: 480, y: 400 });
  const n1 = c.connect(`${a.refdes}.a`, `${b.refdes}.a`);
  const n2 = c.connect(`${d.refdes}.a`, `${e.refdes}.a`);
  n1.branches = [[{ x: 0, y: 0 }, { x: 400, y: 0 }]];
  n2.branches = [[{ x: 200, y: -200 }, { x: 200, y: 200 }]];
  c.syncJunctionSolders();
  assert.equal([...c.components.values()].filter((x) => x.type === 'solder').length, 0);
  n1.branches = [[{ x: 0, y: 0 }, { x: 200, y: 0 }], [{ x: 200, y: 0 }, { x: 400, y: 0 }], [{ x: 200, y: 0 }, { x: 200, y: 80 }]];
  c.syncJunctionSolders();
  const dots = [...c.components.values()].filter((x) => x.type === 'solder');
  assert.deepEqual(dots.map((x) => [x.transform.x, x.transform.y]), [[200, 0]]);
});

test('an auto solder dot can be removed without being regenerated', () => {
  const c = new Circuit();
  const a = c.addComponent('resistor', { x: 80, y: 0 });
  const b = c.addComponent('resistor', { x: 480, y: 0 });
  const d = c.addComponent('resistor', { x: 280, y: 400 });
  const n = c.connect(`${a.refdes}.a`, `${b.refdes}.a`, `${d.refdes}.a`);
  n.branches = [[{ x: 0, y: 0 }, { x: 200, y: 0 }], [{ x: 200, y: 0 }, { x: 400, y: 0 }], [{ x: 200, y: 0 }, { x: 200, y: 400 }]];
  n.route = n.branches[0];
  c.syncJunctionSolders();
  const dot = [...c.components.values()].find((x) => x.type === 'solder');
  assert.ok(dot);
  c.removeComponent(dot.refdes);
  c.syncJunctionSolders();
  assert.equal([...c.components.values()].filter((x) => x.type === 'solder').length, 0);
});

test('repeated component moves keep route endpoints attached and outside the body', () => {
  const c = new Circuit();
  const a = c.addComponent('resistor', { x: 80, y: 0 });
  const b = c.addComponent('resistor', { x: 480, y: 0 });
  const n = c.connect(`${a.refdes}.b`, `${b.refdes}.a`);
  n.branches = [[{ x: 160, y: 0 }, { x: 160, y: 160 }, { x: 400, y: 160 }, { x: 400, y: 0 }]];
  n.route = n.branches[0];
  c.moveComponent(a.refdes, 80, 80);
  c.rerouteNet(n, new Map([[a.refdes, { dx: 0, dy: 80 }]]));
  c.moveComponent(a.refdes, 80, 160);
  c.rerouteNet(n, new Map([[a.refdes, { dx: 0, dy: 80 }]]));
  const path = n.branches[0];
  assert.deepEqual(path[0], a.terminalWorld('b'));
  assert.deepEqual(path[path.length - 1], b.terminalWorld('a'));
  assert.equal(n.wiringErrors().length, 0);
  for (let i = 1; i < path.length; i++) assert.equal(segThroughInterior(path[i - 1], path[i], a.bboxWorld()), false);
});

test('moving a component with one wired terminal preserves its wire stub', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 80, y: 0 });
  const n = c.connect(`${r.refdes}.a`);
  n.branches = [[{ x: 0, y: 0 }, { x: 0, y: 160 }, { x: 200, y: 160 }]];
  n.route = n.branches[0];
  c.moveComponent(r.refdes, 160, 0);
  c.rerouteNet(n, new Map([[r.refdes, { dx: 80, dy: 0 }]]));
  assert.equal(c.netOfTerminal(`${r.refdes}.a`), n);
  assert.deepEqual(n.branches[0][0], r.terminalWorld('a'));
  assert.equal(n.wiringErrors().length, 0);
});

test('moving the target component keeps the target endpoint attached to its net', () => {
  const c = new Circuit();
  const source = c.addComponent('resistor', { x: 80, y: 0 });
  const target = c.addComponent('resistor', { x: 480, y: 0 });
  const n = c.connect(`${source.refdes}.b`, `${target.refdes}.a`);
  n.route = [{ x: 160, y: 0 }, { x: 160, y: 160 }, { x: 400, y: 160 }, { x: 400, y: 0 }];
  c.moveComponent(target.refdes, 480, 160);
  c.rerouteNet(n, new Map([[target.refdes, { dx: 0, dy: 160 }]]));
  const path = n.route;
  assert.deepEqual(new Set([path[0], path.at(-1)].map((p) => `${p.x},${p.y}`)), new Set([
    `${source.terminalWorld('b').x},${source.terminalWorld('b').y}`,
    `${target.terminalWorld('a').x},${target.terminalWorld('a').y}`,
  ]));
  assert.equal(n.wiringErrors().length, 0);
});

test('moving one block endpoint centers the new route elbow', () => {
  const c = new Circuit();
  c.addComponent('block', { refdes: 'B1', x: 320, y: 400 });
  c.addComponent('block', { refdes: 'B2', x: 320, y: 720 });
  const n = c.connect('B1.T11', 'B2.T9');

  c.moveComponent('B2', 280, 720);
  assert.equal(c.rerouteNet(n, new Map([['B2', { dx: -40, dy: 0 }]])), true);
  assert.deepEqual(n.paths()[0], [
    { x: 320, y: 480 },
    { x: 320, y: 560 },
    { x: 280, y: 560 },
    { x: 280, y: 640 },
  ]);
});

test('placing a component on an existing terminal connects it and later movement keeps the net', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 80, y: 0 });
  const r2 = c.addComponent('resistor', { x: 240, y: 0 });
  const n = c.netOfTerminal(`${r2.refdes}.a`);
  assert.ok(n);
  assert.equal(n, c.netOfTerminal(`${r1.refdes}.b`));
  c.moveComponent(r2.refdes, 240, 160);
  c.rerouteNet(n, new Map([[r2.refdes, { dx: 0, dy: 160 }]]));
  assert.equal(c.netOfTerminal(`${r2.refdes}.a`), n);
  const path = n.branches?.[0] || n.route || n.points();
  assert.deepEqual(new Set(path.slice(0, 1).concat(path.slice(-1)).map((p) => `${p.x},${p.y}`)), new Set([
    `${r1.terminalWorld('b').x},${r1.terminalWorld('b').y}`,
    `${r2.terminalWorld('a').x},${r2.terminalWorld('a').y}`,
  ]));
});

test('automatic routing never shorts two terminals through a component body', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 80, y: 0 });
  const n = c.connect(`${r.refdes}.a`, `${r.refdes}.b`);
  for (let i = 1; i < n.points().length; i++) assert.equal(segThroughInterior(n.points()[i - 1], n.points()[i], r.bboxWorld()), false);
});

test('an unrouted 3-terminal net has no obstacle-free drawable fallback', () => {
  const c = new Circuit();
  const a = c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  const b = c.addComponent('resistor', { refdes: 'R2', x: 400, y: 0 });
  const d = c.addComponent('resistor', { refdes: 'R3', x: 800, y: 0 });
  const net = c.createWireNet();
  net.terminals.push(
    { comp: a.refdes, term: 'a' },
    { comp: b.refdes, term: 'a' },
    { comp: d.refdes, term: 'a' },
  );
  assert.deepEqual(net.points(), []);
  assert.deepEqual(net.paths(), []);
});

test('failed branch routing rolls back connect and wireTo membership', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 400, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 800, y: 0 });
  const net = c.connect('R1.b', 'R2.a');
  const before = net.terminals.map((t) => `${t.comp}.${t.term}`);
  const route = net.paths();
  const baseEnv = c._routingEnv();
  const originalRoutingEnv = c._routingEnv;
  c._routingEnv = () => ({
    ...baseEnv,
    rects: [{ x: -10000, y: -10000, w: 20000, h: 20000 }],
  });
  try {
    assert.throws(() => c.connect('R1.b', 'R3.a'), /unable to route wire safely/);
    assert.deepEqual(net.terminals.map((t) => `${t.comp}.${t.term}`), before);
    assert.deepEqual(net.paths(), route);
    assert.equal(c.netOfTerminal('R3.a'), null);

    assert.throws(() => c.wireTo('R1.b', c.getComponent('R3').terminalWorld('a')), /unable to route wire safely/);
    assert.deepEqual(net.terminals.map((t) => `${t.comp}.${t.term}`), before);
    assert.deepEqual(net.paths(), route);
    assert.equal(c.netOfTerminal('R3.a'), null);
  } finally {
    c._routingEnv = originalRoutingEnv;
  }
});

test('routing environment cache invalidates when connectivity changes', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 320, y: 0 });
  const net = c.connect('R1.b', 'R2.a');
  const before = c._netEnv();
  c.addComponent('resistor', { refdes: 'R3', x: 640, y: 0 });
  c.connectTo(net.id, 'R3.a');
  assert.notStrictEqual(c._netEnv(), before);
  const rollbackBefore = c._netEnv();
  c.moveComponent('R1', 40, 0);
  c._rollbackComponentEdit();
  assert.notStrictEqual(c._netEnv(), rollbackBefore, 'rollback clears the cached environment');
});

test('label geometry and text edits invalidate routing obstacles', () => {
  const c = new Circuit();
  const label = c.addLabel({ text: 'x', x: 0, y: 0 });
  let env = c._netEnv();
  label.moveTo(160, 0);
  assert.notStrictEqual(c._netEnv(), env);
  assert.equal(c._netEnv().labelRects[0].x, 120);

  env = c._netEnv();
  label.setText('long label');
  assert.notStrictEqual(c._netEnv(), env);
  assert.ok(c._netEnv().labelRects[0].w > 80);
});

test('fixed geometry edits invalidate routing obstacles', () => {
  const c = new Circuit();
  const net = c.createWireNet({ routingMode: 'fixed', fixedPaths: [{ points: [{ x: 0, y: 0 }, { x: 40, y: 0 }], start: null, end: null }] });
  let env = c._netEnv();
  c.moveFixedEndpoint(c.fixedOpenEndpointAt({ x: 0, y: 0 }), { x: 80, y: 0 });
  assert.notStrictEqual(c._netEnv(), env);
  assert.deepEqual(c._netEnv().wires, [[{ x: 80, y: 0 }, { x: 40, y: 0 }]]);

  env = c._netEnv();
  c.restoreFixedGeometry(net, [{ points: [{ x: 120, y: 0 }, { x: 160, y: 0 }], start: null, end: null }], [{ x: 160, y: 0 }]);
  assert.notStrictEqual(c._netEnv(), env);
  assert.deepEqual(c._netEnv().wires, [[{ x: 120, y: 0 }, { x: 160, y: 0 }]]);

  env = c._netEnv();
  c.setFixedPathVertex(net, 0, 1, { x: 200, y: 0 });
  assert.notStrictEqual(c._netEnv(), env);
  env = c._netEnv();
  c.setFixedJunction(net, 0, { x: 240, y: 0 });
  assert.notStrictEqual(c._netEnv(), env);
});

test('failed movement reroute rolls back the component and keeps old endpoints consistent', () => {
  const c = new Circuit();
  const a = c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  const b = c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  const net = c.connect('R1.b', 'R2.a');
  net.route = [{ x: 160, y: 0 }, { x: 160, y: 160 }, { x: 400, y: 160 }, { x: 400, y: 0 }];
  const before = net.route.map((p) => ({ ...p }));
  const baseEnv = c._netEnv();
  c._netEnv = () => ({
    ...baseEnv,
    rects: [...baseEnv.rects, { x: 360, y: -2000, w: 80, h: 4000 }],
  });
  c.moveComponent(b.refdes, 480, 400);
  assert.equal(c.rerouteNet(net, new Map([[b.refdes, { dx: 0, dy: 400 }]])), false);
  assert.equal(b.transform.y, 0, 'failed reroute rolls the moved component back');
  assert.deepEqual(net.route, before, 'previous route remains intact');
  assert.deepEqual(net.route[0], a.terminalWorld('b'));
  assert.deepEqual(net.route.at(-1), b.terminalWorld('a'));
});

test('failed automatic routing does not commit a body-drilling straight fallback', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 }); // b=(80,0)
  const blocker = c.addComponent('resistor', { refdes: 'R2', x: 240, y: 0 }); // body x=160..320
  c.addComponent('resistor', { refdes: 'R3', x: 480, y: 0 }); // a=(400,0)

  // Make the router report this channel as completely enclosed while keeping
  // the real blocker in the model. The old [from,to] fallback would drill R2.
  const baseEnv = c._routingEnv();
  c._routingEnv = () => ({
    ...baseEnv,
    rects: [...baseEnv.rects, { x: 120, y: -2000, w: 240, h: 4000 }],
  });

  assert.throws(() => c.wireTo('R1.b', c.getComponent('R3').terminalWorld('a')), /unable to route wire safely/);
  assert.equal(c.nets.size, 0, 'failed routing does not leave a partially committed net');
  assert.equal(c.netOfTerminal('R1.b'), null);
  assert.equal(c.netOfTerminal('R3.a'), null);
  assert.equal(segThroughInterior({ x: 80, y: 0 }, { x: 400, y: 0 }, blocker.bboxWorld()), true);
});

test('moving a diode-connected MOSFET before joining a third terminal never creates diagonal branches', () => {
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { x: 120, y: 0 });
  const m2 = c.addComponent('nmos', { x: 520, y: 0 });
  const m3 = c.addComponent('nmos', { x: 920, y: 0 });
  const n = c.connect(`${m1.refdes}.g`, `${m1.refdes}.d`);
  c.rerouteNet(n);
  c.moveComponent(m1.refdes, 320, 0);
  c.rerouteNet(n, new Map([[m1.refdes, { dx: 200, dy: 0 }]]));
  c.connect(`${m1.refdes}.g`, `${m2.refdes}.d`);
  c.rerouteNet(n);
  c.connect(`${m3.refdes}.d`, `${m1.refdes}.g`);
  c.rerouteNet(n);
  for (const path of n.paths()) for (let i = 1; i < path.length; i++) {
    assert.ok(path[i].x === path[i - 1].x || path[i].y === path[i - 1].y, `diagonal branch: ${JSON.stringify(path)}`);
  }
});

test('loading a malformed diagonal route normalizes it before it can be rendered', () => {
  const c = Circuit.fromJSON({
    version: 1,
    grid: 40,
    components: [
      { refdes: 'R1', type: 'resistor', value: '', transform: { x: 80, y: 0, rotation: 0, mirrorX: false, mirrorY: false } },
      { refdes: 'R2', type: 'resistor', value: '', transform: { x: 480, y: 400, rotation: 0, mirrorX: false, mirrorY: false } },
    ],
    nets: [{ id: 'N1', name: '', terminals: [{ comp: 'R1', term: 'a' }, { comp: 'R2', term: 'a' }], route: [{ x: 0, y: 0 }, { x: 400, y: 400 }], branches: null }],
    labels: [],
  });
  for (const path of c.nets.get('N1').paths()) for (let i = 1; i < path.length; i++) {
    assert.ok(path[i].x === path[i - 1].x || path[i].y === path[i - 1].y);
  }
});

test('version-1 states remain managed and preserve the historic route shape', () => {
  const c = Circuit.fromJSON({
    version: 1,
    grid: 40,
    components: [
      { refdes: 'R1', type: 'resistor', value: '', transform: { x: 80, y: 0, rotation: 0, mirrorX: false, mirrorY: false } },
      { refdes: 'R2', type: 'resistor', value: '', transform: { x: 480, y: 0, rotation: 0, mirrorX: false, mirrorY: false } },
    ],
    nets: [{ id: 'N1', name: '', terminals: [{ comp: 'R1', term: 'b' }, { comp: 'R2', term: 'a' }], route: [{ x: 160, y: 0 }, { x: 400, y: 0 }], branches: null }],
    labels: [],
  });
  const n = c.nets.get('N1');
  assert.equal(n.routingMode, 'managed');
  assert.deepEqual(n.paths(), [[{ x: 160, y: 0 }, { x: 400, y: 0 }]]);
  assert.equal(n.fixedPaths.length, 0);
});

test('direct diagonal paths round-trip in fixed policy without orthogonalization', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  const n = c.wireDirectTo('R1.b', 'R2.a', [{ x: 240, y: 80 }, { x: 240, y: 80 }], { fixed: true });
  assert.equal(n.routingMode, 'fixed');
  assert.deepEqual(n.paths(), [[
    { x: 160, y: 0 }, { x: 240, y: 80 }, { x: 400, y: 400 },
  ]]);
  assert.deepEqual(n.fixedPaths[0].start, { comp: 'R1', term: 'b' });
  assert.deepEqual(n.fixedPaths[0].end, { comp: 'R2', term: 'a' });
  assert.equal(c.toJSON().version, 2);
  const c2 = Circuit.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
  assert.equal(c2.nets.get(n.id).routingMode, 'fixed');
  assert.deepEqual(c2.nets.get(n.id).fixedPaths, n.fixedPaths);
  assert.equal(c2.nets.get(n.id).length(), n.length());
});

test('a diagonal draft keeps legs between clicked points literal and routes pin legs', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  const n = c.wireTo('R1.b', c.getComponent('R2').terminalWorld('a'), [{ x: 240, y: 80 }, { x: 320, y: 320 }], { routeStyle: 'diagonal' });
  assert.equal(n.routingMode, 'managed');
  assert.equal(n.allowDiagonal, true);
  assert.equal(n.fixedPaths.length, 0);
  const [path] = n.paths();
  assert.deepEqual(path[0], { x: 160, y: 0 });
  assert.deepEqual(path.at(-1), { x: 400, y: 400 });
  const diagonals = path.slice(1).map((p, i) => [path[i], p]).filter(([a, b]) => a.x !== b.x && a.y !== b.y);
  assert.deepEqual(diagonals, [[{ x: 240, y: 80 }, { x: 320, y: 320 }]], 'only the clicked leg is diagonal; pin legs are routed');

  const copy = Circuit.fromJSON(JSON.parse(JSON.stringify(c.toJSON()))).nets.get(n.id);
  assert.equal(copy.routingMode, 'managed');
  assert.equal(copy.allowDiagonal, true);
  assert.deepEqual(copy.paths(), n.paths());
});

test('an orthogonal wire can splice into a protected diagonal segment', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  c.addComponent('resistor', { refdes: 'R3', x: 560, y: 160 });
  const n = c.wireTo('R1.b', c.getComponent('R2').terminalWorld('a'), [{ x: 240, y: 80 }, { x: 400, y: 240 }], { routeStyle: 'diagonal' });
  const joined = c.wireTo('R3.a', { x: 320, y: 160 }, [], { routeStyle: 'orthogonal' });

  assert.equal(joined, n);
  assert.equal(n.terminals.length, 3);
  assert.ok(n.junctions.some((p) => p.x === 320 && p.y === 160));
  const segments = n.paths().flatMap((path) => path.slice(1).map((p, i) => `${path[i].x},${path[i].y}-${p.x},${p.y}`));
  assert.ok(segments.includes('240,80-320,160') || segments.includes('320,160-240,80'), 'first diagonal half kept');
  assert.ok(segments.includes('320,160-400,240') || segments.includes('400,240-320,160'), 'second diagonal half kept');
  assert.equal(n.allowDiagonal, true);
});

test('loading converts legacy fixed nets into managed nets with protected diagonals', async () => {
  const { loadDocument } = await import('../src/core/document.js');
  const legacy = new Circuit();
  legacy.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  legacy.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  const fixed = legacy.wireDirectTo('R1.b', 'R2.a', [{ x: 240, y: 80 }, { x: 240, y: 240 }], { fixed: true });
  const json = JSON.parse(JSON.stringify(legacy.toJSON()));
  assert.equal(json.nets[0].routingMode, 'fixed');

  const loaded = loadDocument(json);
  const net = loaded.nets.get(fixed.id);
  assert.equal(net.routingMode, 'managed');
  assert.equal(net.allowDiagonal, true);
  assert.deepEqual(net.fixedPaths, []);
  assert.deepEqual(net.paths(), [[{ x: 160, y: 0 }, { x: 240, y: 80 }, { x: 240, y: 240 }, { x: 400, y: 400 }]]);
  assert.deepEqual(net.terminals.map((t) => `${t.comp}.${t.term}`).sort(), ['R1.b', 'R2.a']);
  assert.equal(Circuit.fromJSON(json).nets.get(fixed.id).routingMode, 'fixed', 'the core still reads fixed nets when asked directly');
});

test('the diagonal flag follows the drawn segments instead of spreading through joins', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  const n = c.wireTo('R1.b', c.getComponent('R2').terminalWorld('a'), [{ x: 240, y: 80 }, { x: 320, y: 320 }], { routeStyle: 'diagonal' });
  assert.equal(n.allowDiagonal, true);
  const path = n.paths()[0];
  const index = path.findIndex((p, i) => i > 0 && p.x !== path[i - 1].x && p.y !== path[i - 1].y);
  c.deleteWireSegments(n.id, [{ branch: 0, segment: index }]);
  for (const net of c.nets.values()) assert.equal(net.allowDiagonal, false, `${net.id} has no diagonal left`);
});

test('orthogonal terminal merge into a diagonal net skips whole-net optimization', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  c.addComponent('resistor', { refdes: 'R3', x: 680, y: 400 });
  const n = c.wireTo('R1.b', { x: 400, y: 400 }, [], { routeStyle: 'diagonal' });
  const diagonal = n.paths()[0].map((p) => ({ ...p }));

  const merged = c.wireTo('R3.a', { x: 400, y: 400 }, [], { routeStyle: 'orthogonal' });

  assert.strictEqual(merged, n);
  assert.deepEqual(merged.paths()[0], diagonal);
  assert.equal(merged.terminals.length, 3);
  assert.ok(merged.paths().some((path) => path.some((p) => p.x === 600 && p.y === 400)));
});

test('reattaching a diagonal island at a touched terminal preserves geometry', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  const diagonal = c.createWireNet({
    allowDiagonal: true,
    branches: [[{ x: 160, y: 0 }, { x: 400, y: 200 }]],
  });
  diagonal.terminals.push({ comp: r1.refdes, term: 'b' });
  const r3 = c.addComponent('resistor', { refdes: 'R3', x: 480, y: 0 });
  const target = c.createWireNet({
    branches: [[{ x: 400, y: 0 }, { x: 600, y: 0 }]],
  });
  target.terminals.push({ comp: r3.refdes, term: 'a' });
  const before = diagonal.paths().map((path) => path.map((p) => ({ ...p })));

  const merged = c.wirePointTo({ x: 400, y: 0 }, { x: 400, y: 0 }, [], diagonal.id, { routeStyle: 'orthogonal' });

  assert.equal(merged, diagonal);
  assert.equal(c.nets.size, 1);
  assert.deepEqual(merged.paths(), before.concat(target.paths()));
  assert.ok(merged.terminals.some((t) => t.comp === r3.refdes && t.term === 'a'));
});

test('wire target identity selects the intended orthogonal net at a coincident target', () => {
  const c = new Circuit();
  const a = c.createWireNet({ branches: [[{ x: 0, y: 0 }, { x: 400, y: 0 }]] });
  const b = c.createWireNet({ branches: [[{ x: 0, y: 0 }, { x: 400, y: 0 }]] });
  const selected = c.wirePointTo(
    { x: 0, y: 400 }, { x: 200, y: 0 }, [], null,
    { routeStyle: 'orthogonal', target: { netId: b.id, pathIndex: 0, segmentIndex: 1, point: { x: 200, y: 0 } } },
  );
  assert.equal(selected, b);
  assert.equal(a.branches.length, 1);
  assert.ok(b.branches.some((path) => path.some((p) => p.x === 0 && p.y === 400)));
});

test('wire target identity selects the intended diagonal net and rejects ambiguity', () => {
  const c = new Circuit();
  const a = c.createWireNet({ allowDiagonal: true, branches: [[{ x: 0, y: 0 }, { x: 400, y: 400 }]] });
  const b = c.createWireNet({ allowDiagonal: true, branches: [[{ x: 0, y: 0 }, { x: 400, y: 400 }]] });
  assert.throws(() => c.wirePointTo({ x: 0, y: 400 }, { x: 200, y: 200 }, [], null, { routeStyle: 'diagonal' }), /ambiguous wire target/);
  assert.throws(() => c.wirePointTo(
    { x: 0, y: 400 }, { x: 200, y: 200 }, [], null,
    { target: { netId: b.id, pathIndex: 0, segmentIndex: 1, point: { x: 160, y: 200 } } },
  ), /does not match the selected point/);

  const selected = c.wirePointTo(
    { x: 0, y: 400 },
    { x: 200, y: 200 },
    [],
    null,
    { routeStyle: 'diagonal', target: { netId: b.id, pathIndex: 0, segmentIndex: 1, point: { x: 200, y: 200 } } },
  );
  assert.equal(selected, b);
  assert.equal(selected.allowDiagonal, true);
  assert.ok(selected.paths().some((path) => path[0].x === 0 && path[0].y === 400));
  assert.equal(a.paths().length, 1);
});

test('moving an authorized diagonal endpoint through a blocker uses a safe replacement leg', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  c.addComponent('resistor', { refdes: 'BLOCK', x: 280, y: 0 });
  const n = c.wireDirectTo('R1.b', 'R2.a', [{ x: 240, y: 80 }]);
  assert.equal(n.routingMode, 'managed');
  c.moveComponent('R2', 480, 0);
  assert.equal(c.rerouteNet(n, new Map([['R2', { dx: 0, dy: -400 }]])), true);

  assert.deepEqual(n.paths()[0].slice(0, 2), [{ x: 160, y: 0 }, { x: 240, y: 80 }], 'the untouched diagonal stays put');
  assert.deepEqual(n.paths()[0].at(-1), { x: 400, y: 0 });
  for (const path of n.paths()) for (let i = 1; i < path.length; i++) {
    for (const comp of c.components.values()) {
      if (comp.type !== 'solder') assert.equal(segThroughInterior(path[i - 1], path[i], comp.bboxWorld()), false);
    }
  }
});

test('authorized diagonal re-anchor rejects an unsafe preserved suffix and rolls back', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 680, y: 120 });
  const n = c.wireTo('R1.b', { x: 600, y: 120 }, [{ x: 200, y: 120 }], { routeStyle: 'diagonal' });
  const before = n.paths();

  c.moveComponent('R1', 320, 120);
  assert.equal(c.rerouteNet(n, new Map([['R1', { dx: 240, dy: 120 }]])), false);
  assert.deepEqual(c.getComponent('R1').transform, {
    x: 80, y: 0, rotation: 0, mirrorX: false, mirrorY: false,
  });
  assert.deepEqual(n.paths(), before);
});

test('fixed geometry is protected from refresh and reduction but deletable literally', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  const n = c.wireDirectTo('R1.b', 'R2.a', [], { fixed: true });
  const before = n.paths();
  c.rerouteNet(n, 'refresh');
  c._reduceNet(n);
  assert.deepEqual(n.paths(), before);
  c.deleteWireSegment(n.id, 0, 1);
  assert.equal(c.nets.has(n.id), false, 'deleting the sole fixed segment removes the empty net');
});

test('fixed middle cuts preserve literal diagonal pieces and anchors per island', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  const n = c.wireDirectTo('R1.b', 'R2.a', [{ x: 240, y: 80 }, { x: 320, y: 240 }], { fixed: true });
  const originalId = n.id;
  c.deleteWireSegments(n.id, [{ branch: 0, segment: 2 }]);
  const nets = [...c.nets.values()];
  assert.equal(nets.length, 2);
  assert.ok(nets.every((island) => island.routingMode === 'fixed'));
  assert.deepEqual(c.nets.get(originalId).fixedPaths[0], {
    points: [{ x: 160, y: 0 }, { x: 240, y: 80 }],
    start: { comp: 'R1', term: 'b' }, end: null,
  });
  const other = nets.find((island) => island.id !== originalId);
  assert.deepEqual(other.fixedPaths[0], {
    points: [{ x: 320, y: 240 }, { x: 400, y: 400 }],
    start: null, end: { comp: 'R2', term: 'a' },
  });
  assert.deepEqual(nets.map((island) => island.terminals), [
    [{ comp: 'R1', term: 'b' }], [{ comp: 'R2', term: 'a' }],
  ]);
});

test('fixed first and last cuts drop only their original terminal anchors', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  const n = c.wireDirectTo('R1.b', 'R2.a', [{ x: 240, y: 80 }, { x: 320, y: 240 }], { fixed: true });
  c.deleteWireSegments(n.id, [{ branch: 0, segment: 1 }, { branch: 0, segment: 3 }]);
  assert.equal(c.nets.size, 1);
  assert.deepEqual(c.nets.get(n.id).fixedPaths[0], {
    points: [{ x: 240, y: 80 }, { x: 320, y: 240 }],
    start: null, end: null,
  });
  assert.deepEqual(c.nets.get(n.id).terminals, []);
});

test('fixed first and last cuts retain simultaneous floating fragments', () => {
  const c = new Circuit();
  const n = c.createWireNet({
    name: 'literal',
    routingMode: 'fixed',
    fixedPaths: [
      { points: [{ x: 0, y: 0 }, { x: 40, y: 40 }, { x: 80, y: 0 }], start: null, end: null },
      { points: [{ x: 200, y: 0 }, { x: 240, y: 40 }, { x: 280, y: 0 }], start: null, end: null },
    ],
  });
  c.deleteWireSegments(n.id, [{ branch: 0, segment: 1 }, { branch: 1, segment: 2 }]);
  assert.equal(c.nets.size, 2);
  assert.ok([...c.nets.values()].every((island) => island.routingMode === 'fixed'));
  assert.ok([...c.nets.values()].every((island) => island.name === 'literal'));
  assert.deepEqual([...c.nets.values()].map((island) => island.fixedPaths[0].points), [
    [{ x: 40, y: 40 }, { x: 80, y: 0 }],
    [{ x: 200, y: 0 }, { x: 240, y: 40 }],
  ]);
  assert.ok([...c.nets.values()].every((island) => island.terminals.length === 0));
});

test('fixed T branch deletion drops its junction but retains literal through paths', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 80, y: 400 });
  const n = c.createWireNet({
    routingMode: 'fixed',
    fixedPaths: [
      { points: [{ x: 160, y: 0 }, { x: 240, y: 0 }, { x: 400, y: 0 }], start: 'R1.b', end: 'R2.a' },
      { points: [{ x: 240, y: 0 }, { x: 160, y: 400 }], start: null, end: 'R3.b' },
      { points: [{ x: 240, y: 0 }, { x: 320, y: 0 }], start: null, end: null },
    ],
    junctions: [{ x: 240, y: 0 }],
  });
  c.syncJunctionSolders();
  c.deleteWireSegments(n.id, [{ branch: 1, segment: 1 }]);
  assert.equal(c.nets.get(n.id).routingMode, 'fixed');
  assert.deepEqual(c.nets.get(n.id).junctions, []);
  assert.deepEqual(c.nets.get(n.id).terminals, [
    { comp: 'R1', term: 'b' }, { comp: 'R2', term: 'a' },
  ]);
  assert.deepEqual(c.nets.get(n.id).fixedPaths.map((entry) => entry.points), [
    [{ x: 160, y: 0 }, { x: 240, y: 0 }, { x: 400, y: 0 }],
  ]);
  assert.equal(c.nets.size, 2, 'a path touching the through wire interior is separate without an explicit junction');
  assert.deepEqual([...c.nets.values()].find((island) => island.id !== n.id).fixedPaths[0].points, [
    { x: 240, y: 0 }, { x: 320, y: 0 },
  ]);
  assert.equal([...c.components.values()].filter((x) => x.type === 'solder').length, 0);
});

test('fixed junction with two directions and an anchored terminal arm survives', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.addComponent('ground', { refdes: 'G1', x: 240, y: 0 });
  const n = c.createWireNet({
    routingMode: 'fixed',
    fixedPaths: [
      { points: [{ x: 160, y: 0 }, { x: 240, y: 0 }, { x: 400, y: 0 }], start: 'R1.b', end: 'R2.a' },
      { points: [{ x: 240, y: 0 }, { x: 320, y: 0 }], start: 'G1.gnd', end: null },
      { points: [{ x: 240, y: 0 }, { x: 240, y: 400 }], start: null, end: null },
    ],
    junctions: [{ x: 240, y: 0 }],
  });
  c.syncJunctionSolders();
  c.deleteWireSegments(n.id, [{ branch: 2, segment: 1 }]);
  assert.equal(c.nets.get(n.id).routingMode, 'fixed');
  assert.deepEqual(c.nets.get(n.id).junctions, [{ x: 240, y: 0 }]);
  assert.deepEqual(c.nets.get(n.id).fixedPaths.map((entry) => entry.points), [
    [{ x: 160, y: 0 }, { x: 240, y: 0 }, { x: 400, y: 0 }],
    [{ x: 240, y: 0 }, { x: 320, y: 0 }],
  ]);
  assert.deepEqual(c.nets.get(n.id).terminals, [
    { comp: 'R1', term: 'b' }, { comp: 'R2', term: 'a' }, { comp: 'G1', term: 'gnd' },
  ]);
  assert.equal([...c.components.values()].filter((x) => x.type === 'solder').length, 1);
});

test('fixed island partition does not merge geometric crossings', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  c.addComponent('resistor', { refdes: 'R3', x: 80, y: 400 });
  c.addComponent('resistor', { refdes: 'R4', x: 480, y: 0 });
  const n = c.createWireNet({
    routingMode: 'fixed',
    fixedPaths: [
      { points: [{ x: 160, y: 0 }, { x: 240, y: 200 }, { x: 400, y: 400 }], start: 'R1.b', end: 'R2.a' },
      { points: [{ x: 160, y: 400 }, { x: 240, y: 200 }, { x: 400, y: 0 }], start: 'R3.b', end: 'R4.a' },
    ],
  });
  c.deleteWireSegments(n.id, [{ branch: 0, segment: 1 }]);
  assert.equal(c.nets.size, 2);
  assert.ok([...c.nets.values()].every((island) => island.routingMode === 'fixed'));
  assert.deepEqual([...c.nets.values()].map((island) => island.terminals), [
    [{ comp: 'R2', term: 'a' }],
    [{ comp: 'R3', term: 'b' }, { comp: 'R4', term: 'a' }],
  ]);
  const memberships = [...c.nets.values()].flatMap((island) => island.terminals.map((t) => `${t.comp}.${t.term}`));
  assert.equal(new Set(memberships).size, memberships.length, 'terminal memberships remain unique');
});

test('fixed path, vertex, and junction edits preserve anchors without reduction', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  const n = c.wireDirectTo('R1.b', 'R2.a', [], { fixed: true });
  n.junctions = [{ x: 240, y: 160 }];
  c.setFixedPath(n, 0, [
    { x: 160, y: 0 }, { x: 240, y: 160 }, { x: 400, y: 400 },
  ]);
  assert.deepEqual(n.fixedPaths[0].start, { comp: 'R1', term: 'b' });
  assert.deepEqual(n.fixedPaths[0].end, { comp: 'R2', term: 'a' });
  c.setFixedPathVertex(n, 0, 1, { x: 280, y: 120 });
  assert.deepEqual(n.fixedPaths[0].points, [
    { x: 160, y: 0 }, { x: 280, y: 120 }, { x: 400, y: 400 },
  ]);
  assert.deepEqual(n.junctions, [{ x: 280, y: 120 }]);
  c.setFixedJunction(n, 0, { x: 320, y: 80 });
  assert.deepEqual(n.fixedPaths[0].points, [
    { x: 160, y: 0 }, { x: 320, y: 80 }, { x: 400, y: 400 },
  ]);
  assert.deepEqual(n.junctions, [{ x: 320, y: 80 }]);
  assert.equal(n.routingMode, 'fixed');
});

test('managed operations cannot add phantom terminals to fixed nets', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  c.addComponent('resistor', { refdes: 'R3', x: 880, y: 400 });
  const n = c.wireDirectTo('R1.b', 'R2.a', [], { fixed: true });
  assert.throws(() => c.connect('R1.b', 'R3.a'), /cannot grow a fixed net/);
  assert.throws(() => c.connectTo(n.id, 'R3.a'), /cannot grow a fixed net/);
  assert.equal(c.netOfTerminal('R3.a'), null);
});

test('distinct coincident direct anchors retain a degenerate path until separation', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 240, y: 0 });
  const n = c.wireDirectTo('R1.b', 'R2.a', [], { fixed: true });
  assert.deepEqual(n.fixedPaths[0].points, [{ x: 160, y: 0 }, { x: 160, y: 0 }]);
  c.moveComponent('R2', 480, 0);
  c.rerouteNet(n, new Map([['R2', { dx: 240, dy: 0 }]]));
  assert.deepEqual(n.paths()[0], [{ x: 160, y: 0 }, { x: 400, y: 0 }]);
});

test('fixed authored vertices and anchors survive endpoint coincidence and reload', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  const n = c.wireDirectTo('R1.b', 'R2.a', [{ x: 240, y: 80 }], { fixed: true });
  c.moveComponent('R2', 320, 80);
  c.rerouteNet(n, new Map([['R2', { dx: -160, dy: -320 }]]));
  assert.deepEqual(n.fixedPaths[0].points, [
    { x: 160, y: 0 }, { x: 240, y: 80 }, { x: 240, y: 80 },
  ], 'the authored waypoint remains when the endpoint temporarily lands on it');
  const reloaded = Circuit.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
  assert.deepEqual(reloaded.nets.get(n.id).fixedPaths[0].points, n.fixedPaths[0].points);
  c.moveComponent('R2', 480, 400);
  c.rerouteNet(n, new Map([['R2', { dx: 160, dy: 320 }]]));
  assert.deepEqual(n.fixedPaths[0].points, [
    { x: 160, y: 0 }, { x: 240, y: 80 }, { x: 400, y: 400 },
  ]);
});

test('free fixed endpoints move while anchored and shared endpoints are rejected', () => {
  const c = new Circuit();
  const free = c.createWireNet({ routingMode: 'fixed', fixedPaths: [{ points: [{ x: 0, y: 0 }, { x: 40, y: 40 }], start: null, end: null }] });
  const endpoint = c.fixedOpenEndpointAt({ x: 0, y: 0 });
  assert.ok(endpoint);
  const saved = free.fixedPaths.map((entry) => ({
    points: entry.points.map((p) => ({ ...p })),
    start: entry.start,
    end: entry.end,
  }));
  c.moveFixedEndpoint(endpoint, { x: 80, y: 0 });
  assert.deepEqual(free.fixedPaths[0].points, [{ x: 80, y: 0 }, { x: 40, y: 40 }]);
  c.restoreFixedGeometry(free, saved);
  assert.deepEqual(free.fixedPaths[0].points, [{ x: 0, y: 0 }, { x: 40, y: 40 }]);

  const anchored = c.createWireNet({ routingMode: 'fixed', fixedPaths: [{ points: [{ x: 160, y: 0 }, { x: 200, y: 0 }], start: 'R1.a', end: null }] });
  assert.equal(c.fixedOpenEndpointAt({ x: 160, y: 0 }), null);
  assert.throws(() => c.moveFixedEndpoint(anchored.id, 0, 0, { x: 240, y: 0 }), /anchored or shared/);
  const shared = c.createWireNet({ routingMode: 'fixed', fixedPaths: [
    { points: [{ x: 280, y: 0 }, { x: 320, y: 0 }], start: null, end: null },
    { points: [{ x: 280, y: 0 }, { x: 280, y: 40 }], start: null, end: null },
  ] });
  assert.equal(c.fixedOpenEndpointAt({ x: 280, y: 0 }), null);
  assert.throws(() => c.moveFixedEndpoint(shared.id, 0, 0, { x: 360, y: 0 }), /anchored or shared/);
});

test('fixed endpoint extension preserves the old path and supports literal waypoints', () => {
  const c = new Circuit();
  const n = c.createWireNet({ routingMode: 'fixed', fixedPaths: [{ points: [{ x: 0, y: 0 }, { x: 40, y: 40 }], start: null, end: null }] });
  const endpoint = c.fixedOpenEndpointAt({ x: 0, y: 0 });
  c.extendFixedEndpoint(endpoint, [{ x: 0, y: 80 }, { x: 40, y: 120 }], { mode: 'literal' });
  assert.deepEqual(n.fixedPaths[0].points, [
    { x: 40, y: 120 }, { x: 0, y: 80 }, { x: 0, y: 0 }, { x: 40, y: 40 },
  ]);
  assert.equal(n.routingMode, 'fixed');
  assert.deepEqual(Circuit.fromJSON(c.toJSON()).nets.get(n.id).fixedPaths, n.fixedPaths);
  const smart = c.createWireNet({ routingMode: 'fixed', fixedPaths: [{ points: [{ x: 0, y: 160 }, { x: 40, y: 200 }], start: null, end: null }] });
  const smartEndpoint = c.fixedOpenEndpointAt({ x: 0, y: 160 });
  c.extendFixedEndpoint(smartEndpoint, [{ x: 120, y: 160 }], { mode: 'smart' });
  assert.deepEqual(smart.fixedPaths[0].points.slice(-2), [{ x: 0, y: 160 }, { x: 40, y: 200 }]);
  assert.equal(smart.fixedPaths[0].points[0].x, 120);
});

test('fixed endpoint attachment distinguishes terminal, endpoint, and interior wire targets', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 160, y: 0 });
  const source = c.createWireNet({ routingMode: 'fixed', fixedPaths: [{ points: [{ x: 0, y: 0 }, { x: 40, y: 0 }], start: null, end: null }] });
  const sourceEndpoint = c.fixedOpenEndpointAt({ x: 0, y: 0 });
  c.extendFixedEndpoint(sourceEndpoint, [{ x: 80, y: 0 }], { mode: 'literal' });
  c.attachWireEndpoint(source.id, 0, 0, 'R1.a');
  assert.deepEqual(source.fixedPaths[0].start, { comp: 'R1', term: 'a' });

  const target = c.createWireNet({ routingMode: 'fixed', fixedPaths: [{ points: [{ x: 120, y: 0 }, { x: 200, y: 0 }], start: null, end: null }] });
  const endpointTarget = { netId: target.id, pathIndex: 0, segmentIndex: 1, point: { x: 120, y: 0 } };
  const floating = c.createWireNet({ routingMode: 'fixed', fixedPaths: [{ points: [{ x: 120, y: 40 }, { x: 160, y: 40 }], start: null, end: null }] });
  const floatingEndpoint = c.fixedOpenEndpointAt({ x: 120, y: 40 });
  c.moveFixedEndpoint(floatingEndpoint, { x: 120, y: 0 });
  c.attachWireEndpoint(floating.id, 0, 0, endpointTarget);
  assert.deepEqual(c.nets.get(target.id).junctions, []);

  const interiorSource = c.createWireNet({ routingMode: 'fixed', fixedPaths: [{ points: [{ x: 0, y: 200 }, { x: 40, y: 200 }], start: null, end: null }] });
  const interiorEndpoint = c.fixedOpenEndpointAt({ x: 0, y: 200 });
  c.moveFixedEndpoint(interiorEndpoint, { x: 160, y: 0 });
  assert.throws(() => c.attachWireEndpoint(interiorSource.id, 0, 0, { x: 160, y: 0 }), /explicit identity/);
  c.attachWireEndpoint(interiorSource.id, 0, 0, {
    netId: target.id, pathIndex: 0, segmentIndex: 1, point: { x: 160, y: 0 },
  });
  assert.deepEqual(c.nets.get(target.id).junctions, [{ x: 160, y: 0 }]);

  const same = c.createWireNet({ routingMode: 'fixed', fixedPaths: [
    { points: [{ x: 0, y: 240 }, { x: 40, y: 240 }], start: null, end: null },
    { points: [{ x: 80, y: 240 }, { x: 160, y: 240 }], start: null, end: null },
  ] });
  const sameEndpoint = c.fixedOpenEndpointAt({ x: 0, y: 240 });
  c.moveFixedEndpoint(sameEndpoint, { x: 120, y: 240 });
  c.attachWireEndpoint(same.id, 0, 0, {
    netId: same.id, pathIndex: 1, segmentIndex: 1, point: { x: 120, y: 240 },
  });
  assert.deepEqual(same.junctions, [{ x: 120, y: 240 }]);
});

test('same-path fixed extension preserves a preselected interior junction', () => {
  const c = new Circuit();
  const net = c.createWireNet({ routingMode: 'fixed', fixedPaths: [{
    points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 0 }, { x: 160, y: 0 }],
    start: null, end: null,
  }] });
  const endpoint = c.fixedOpenEndpointAt({ x: 0, y: 0 });
  c.extendFixedEndpoint(endpoint, [{ x: 120, y: 0 }], { mode: 'literal' });
  c.attachWireEndpoint(net.id, 0, 0, {
    netId: net.id, pathIndex: 0, segmentIndex: 4, point: { x: 120, y: 0 }, interior: true,
  });
  assert.deepEqual(net.junctions, [{ x: 120, y: 0 }]);
});

test('fixed endpoint attachment promotes managed geometry without optimizing it', () => {
  const c = new Circuit();
  const managed = c.createWireNet({ branches: [[{ x: 120, y: 120 }, { x: 200, y: 120 }]], route: [{ x: 120, y: 120 }, { x: 200, y: 120 }] });
  const fixed = c.createWireNet({ routingMode: 'fixed', fixedPaths: [{ points: [{ x: 0, y: 0 }, { x: 40, y: 40 }], start: null, end: null }] });
  const endpoint = c.fixedOpenEndpointAt({ x: 0, y: 0 });
  c.moveFixedEndpoint(endpoint, { x: 120, y: 120 });
  c.attachWireEndpoint(fixed.id, 0, 0, { netId: managed.id, pathIndex: 0, segmentIndex: 1, point: { x: 120, y: 120 } });
  assert.equal(c.nets.has(fixed.id), false);
  assert.equal(managed.routingMode, 'fixed');
  assert.deepEqual(managed.fixedPaths[0].points, [{ x: 120, y: 120 }, { x: 200, y: 120 }]);
});

test('v2 loading sanitizes fixed anchors that are not net member terminals', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  const n = c.wireDirectTo('R1.b', 'R2.a', [], { fixed: true });
  const state = c.toJSON();
  state.nets[0].fixedPaths[0].start = { comp: 'R99', term: 'a' };
  state.nets[0].fixedPaths[0].end = { comp: 'R2', term: 'not-a-term' };
  const loaded = Circuit.fromJSON(state);
  assert.equal(loaded.nets.get(n.id).fixedPaths[0].start, null);
  assert.equal(loaded.nets.get(n.id).fixedPaths[0].end, null);
});

test('disconnect and removal clear fixed terminal anchors', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  const n = c.wireDirectTo('R1.b', 'R2.a', [], { fixed: true });
  c.disconnect('R1.b');
  assert.equal(n.fixedPaths[0].start, null);
  c.removeComponent('R2');
  assert.equal(n.fixedPaths[0].end, null);
});

test('promoting a managed net preserves explicit junctions and their solder marker', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 880, y: 400 });
  const n = c.connect('R1.b', 'R2.a');
  n.route = [{ x: 160, y: 0 }, { x: 400, y: 0 }];
  n.junctions = [{ x: 280, y: 0 }];
  c.wireDirectTo('R1.b', 'R3.a', [{ x: 640, y: 80 }], { fixed: true });
  assert.deepEqual(n.junctions, [{ x: 280, y: 0 }]);
  assert.equal([...c.components.values()].filter((x) => x.type === 'solder' && x.transform.x === 280 && x.transform.y === 0).length, 1);
  const reloaded = Circuit.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
  assert.deepEqual(reloaded.nets.get(n.id).junctions, [{ x: 280, y: 0 }]);
  assert.equal([...reloaded.components.values()].filter((x) => x.type === 'solder' && x.transform.x === 280 && x.transform.y === 0).length, 1);
});

test('reconnecting existing fixed members preserves paths, junctions, and solder', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  const n = c.wireDirectTo('R1.b', 'R2.a', [], { fixed: true });
  n.junctions = [{ x: 280, y: 0 }];
  c.syncJunctionSolders();
  const paths = n.paths();
  const junctions = n.junctions.map((p) => ({ ...p }));
  const solder = [...c.components.values()].find((x) => x.type === 'solder' && x.transform.x === 280 && x.transform.y === 0);
  assert.ok(solder);
  const again = c.connect('R1.b', 'R2.a');
  assert.strictEqual(again, n);
  assert.deepEqual(n.paths(), paths);
  assert.deepEqual(n.junctions, junctions);
  assert.ok([...c.components.values()].some((x) => x.refdes === solder.refdes && x.type === 'solder' && x.transform.x === 280 && x.transform.y === 0));
});

test('direct wiring promotes joined managed nets while retaining their visible paths', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 880, y: 400 });
  const n = c.connect('R1.b', 'R2.a');
  n.route = [{ x: 160, y: 0 }, { x: 400, y: 0 }];
  const joined = c.wireDirectTo('R1.b', 'R3.a', [{ x: 640, y: 80 }], { fixed: true });
  assert.equal(joined, n);
  assert.equal(joined.routingMode, 'fixed');
  assert.equal(joined.fixedPaths.length, 2);
  assert.deepEqual(joined.fixedPaths[0].points, [{ x: 160, y: 0 }, { x: 400, y: 0 }]);
  assert.deepEqual(joined.fixedPaths[1].points, [{ x: 160, y: 0 }, { x: 640, y: 80 }, { x: 800, y: 400 }]);
});

test('fixed endpoints repair in place and rigid moves translate all geometry', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  const n = c.wireDirectTo('R1.b', 'R2.a', [{ x: 240, y: 80 }], { fixed: true });
  c.moveComponent('R2', 480, 560);
  c.rerouteNet(n, new Map([['R2', { dx: 0, dy: 160 }]]));
  assert.deepEqual(n.paths()[0], [
    { x: 160, y: 0 }, { x: 240, y: 80 }, { x: 400, y: 560 },
  ]);
  c.moveComponent('R1', 160, 160);
  c.moveComponent('R2', 560, 720);
  c.rerouteNet(n, new Map([
    ['R1', { dx: 80, dy: 160 }],
    ['R2', { dx: 80, dy: 160 }],
  ]));
  assert.deepEqual(n.paths()[0], [
    { x: 240, y: 160 }, { x: 320, y: 240 }, { x: 480, y: 720 },
  ]);
});

test('crossing fixed paths remain separate and do not create a solder junction', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  c.addComponent('resistor', { refdes: 'R3', x: 80, y: 400 });
  c.addComponent('resistor', { refdes: 'R4', x: 480, y: 0 });
  const a = c.wireDirectTo('R1.b', 'R2.a', [], { fixed: true });
  const b = c.wireDirectTo('R3.b', 'R4.a', [], { fixed: true });
  assert.notEqual(a.id, b.id);
  assert.equal(c.nets.size, 2);
  assert.equal([...c.components.values()].filter((x) => x.type === 'solder').length, 0);
});

function mirroredMosPair(c, first = 'M1', second = 'M2', x = 0) {
  c.addComponent('nmos', { refdes: first, x: x + 120, y: 0, mirrorX: false, mirrorY: false });
  c.addComponent('nmos', { refdes: second, x: x + 280, y: 0, mirrorX: true, mirrorY: false });
}

test('managed reciprocal diagonal nets infer a cross-coupled pair with protected diagonals', () => {
  const c = new Circuit();
  mirroredMosPair(c);
  const a = c.wireTo('M1.d', c.getComponent('M2').terminalWorld('s'));
  const b = c.wireTo('M1.s', c.getComponent('M2').terminalWorld('d'));
  for (const net of [a, b]) {
    assert.equal(net.routingMode, 'managed');
    assert.equal(net.allowDiagonal, true);
    assert.equal(net.fixedPaths.length, 0);
    assert.equal(net.paths().length, 1);
  }
  assert.deepEqual(a.terminals.map((t) => `${t.comp}.${t.term}`).sort(), ['M1.d', 'M2.s']);
  assert.deepEqual(b.terminals.map((t) => `${t.comp}.${t.term}`).sort(), ['M1.s', 'M2.d']);
  assert.deepEqual(a.paths()[0], [{ x: 120, y: -80 }, { x: 280, y: 80 }]);
  assert.equal([...c.components.values()].filter((x) => x.type === 'solder').length, 0);
});

test('cross-coupling inference rejects unmirrored component transforms', () => {
  const c = new Circuit();
  c.addComponent('nmos', { refdes: 'M1', x: 120, y: 0, mirrorX: false, mirrorY: false });
  c.addComponent('nmos', { refdes: 'M2', x: 520, y: 0, mirrorX: false, mirrorY: false });
  c.connect('M1.d', 'M2.s');
  assert.throws(() => c.connect('M1.s', 'M2.d'), /unable to route wire safely/);
  assert.ok([...c.nets.values()].every((n) => n.routingMode === 'managed'));
  assert.equal(c.netOfTerminal('M1.s'), null);
  assert.equal(c.netOfTerminal('M2.d'), null);
});

test('cross-coupling inference never rewrites a fixed/manual net', () => {
  const c = new Circuit();
  mirroredMosPair(c);
  const fixed = c.wireDirectTo('M1.d', 'M2.s', [{ x: 200, y: -120 }], { fixed: true });
  const managed = c.connect('M1.s', 'M2.d');
  assert.equal(fixed.routingMode, 'fixed');
  assert.equal(managed.routingMode, 'managed');
  assert.deepEqual(fixed.fixedPaths[0].points, [
    { x: 120, y: -80 }, { x: 200, y: -120 }, { x: 280, y: 80 },
  ]);
});

test('cross-coupling inference rejects already routed multi-terminal structures', () => {
  const c = new Circuit();
  mirroredMosPair(c);
  c.connect('M1.d', 'M2.s', 'M1.g');
  assert.throws(() => c.connect('M1.s', 'M2.d'), /unable to route wire safely/);
  assert.ok([...c.nets.values()].every((n) => n.routingMode === 'managed'));
  assert.equal(c.netOfTerminal('M1.s'), null);
  assert.equal(c.netOfTerminal('M2.d'), null);
});

test('cross-coupling inference requires exactly one candidate', () => {
  const c = new Circuit();
  mirroredMosPair(c, 'M1', 'M2', 0);
  mirroredMosPair(c, 'M3', 'M4', 800);
  // Load two plausible candidates together, then invoke the same inference
  // trigger used after managed wiring. Loading itself must not mutate routes.
  const term = (comp, term) => ({ comp, term });
  const point = (comp, name) => c.getComponent(comp).terminalWorld(name);
  const state = c.toJSON();
  state.nets = [
    { id: 'N1', name: '', terminals: [term('M1', 'd'), term('M2', 's')], route: [point('M1', 'd'), point('M2', 's')], branches: null, junctions: [], routingMode: 'managed', fixedPaths: null },
    { id: 'N2', name: '', terminals: [term('M1', 's'), term('M2', 'd')], route: [point('M1', 's'), point('M2', 'd')], branches: null, junctions: [], routingMode: 'managed', fixedPaths: null },
    { id: 'N3', name: '', terminals: [term('M3', 'd'), term('M4', 's')], route: [point('M3', 'd'), point('M4', 's')], branches: null, junctions: [], routingMode: 'managed', fixedPaths: null },
    { id: 'N4', name: '', terminals: [term('M3', 's'), term('M4', 'd')], route: [point('M3', 's'), point('M4', 'd')], branches: null, junctions: [], routingMode: 'managed', fixedPaths: null },
  ];
  const loaded = Circuit.fromJSON(state);
  loaded._inferCrossCoupling();
  assert.ok([...loaded.nets.values()].every((n) => n.routingMode === 'managed'), 'ambiguous sibling candidates stay managed');
});

test('removeComponent sweeps terminals and drops empty nets', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 80, y: 0 });
  const r2 = c.addComponent('resistor', { x: 480, y: 0 });
  const r3 = c.addComponent('resistor', { x: 880, y: 0 });
  // netA = [R1.a, R2.a]; netB = [R2.b, R3.b]
  c.connect(`${r1.refdes}.a`, `${r2.refdes}.a`);
  const netB = c.connect(`${r2.refdes}.b`, `${r3.refdes}.b`);
  // Reduce netB to only R2.b so removing R2 empties (and drops) it.
  c.disconnect(`${r3.refdes}.b`);
  assert.equal(netB.terminalCount(), 1);

  c.removeComponent(r2.refdes);
  assert.equal(c.components.has(r2.refdes), false);
  // netA keeps R1.a; netB was emptied and dropped
  assert.equal(c.nets.size, 1);
  const remaining = [...c.nets.values()][0];
  assert.equal(remaining.terminalCount(), 1);
  assert.equal(remaining.terminals[0].comp, r1.refdes);
});

test('touching pins auto-connect and stay connected when dragged apart', () => {
  const c = new Circuit();
  const m = c.addComponent('nmos', { x: 120, y: 0 }); // s at (120,80)
  const g = c.addComponent('ground', { x: 120, y: 80 }); // gnd lands on M1.s
  const net = c.netOfTerminal(`${g.refdes}.gnd`);
  assert.ok(net, 'dropping a ground on a source connects them');
  assert.equal(net.terminalCount(), 2);
  // dragging the ground apart keeps the net; a wire is routed between the pins
  c.moveComponent(g.refdes, 120, 160);
  assert.equal(c.netOfTerminal(`${g.refdes}.gnd`), net, 'net survives the move');
  assert.ok(net.points().length >= 2, 'wire is drawn between the separated pins');
});

test('net.points routes between terminals', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 480, y: 0 });
  const r2 = c.addComponent('resistor', { x: 480, y: 120 });
  const net = c.connect(`${r1.refdes}.b`, `${r2.refdes}.a`);
  const pts = net.points();
  assert.ok(pts.length >= 2, 'has points');
  assert.deepEqual(pts[0], { x: 560, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 400, y: 120 });
  for (const p of pts) {
    assert.ok(onGrid(p.x) && onGrid(p.y), `point on grid (${p.x},${p.y})`);
  }
});

test('net.length is the manhattan length of its routed polyline', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 80, y: 0 });
  const r2 = c.addComponent('resistor', { x: 80, y: 120 });
  const net = c.connect(`${r1.refdes}.b`, `${r2.refdes}.a`);
  const pts = net.points();
  assert.deepEqual(pts[0], { x: 160, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 0, y: 120 });
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  assert.equal(net.length(), sum);
  assert.ok(net.length() > 0);
});

test('empty circuit bounds is zero', () => {
  const c = new Circuit();
  assert.deepEqual(c.bounds(), { x: 0, y: 0, w: 0, h: 0 });
});

test('bounds covers components and nets with margin', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 480, y: 0 });
  const b = c.bounds(40);
  assert.equal(b.x, 400 - 40);
  assert.ok(b.w > 0);
  assert.ok(b.h > 0);
});

test('toJSON / fromJSON round-trips refs, positions, transforms, net membership, length', () => {
  const c = new Circuit();
  const vcc = c.addComponent('supply', { x: 400, y: 0, value: '5V' });
  const r1 = c.addComponent('resistor', { x: 480, y: 80, rotation: 90, mirrorX: false, value: '1k' });
  const gnd = c.addComponent('ground', { x: 400, y: 200 });
  const n = c.connect(`${vcc.refdes}.p`, `${r1.refdes}.a`);
  n.name = 'rail';
  c.connect(`${r1.refdes}.b`, `${gnd.refdes}.gnd`);

  const data = JSON.parse(JSON.stringify(c.toJSON()));
  const c2 = Circuit.fromJSON(data);

  // same refs
  assert.deepEqual(
    [...c2.components.keys()].sort(),
    [...c.components.keys()].sort()
  );
  // same net count and lengths
  assert.equal(c2.nets.size, c.nets.size);
  for (const orig of c.nets.values()) {
    const round = [...c2.nets.values()].find((net) => net.id === orig.id);
    assert.ok(round, `net ${orig.id} exists after round-trip`);
    assert.equal(round.length(), orig.length());
    assert.equal(round.name, orig.name);
    assert.deepEqual(
      round.terminals.map((t) => `${t.comp}.${t.term}`).sort(),
      orig.terminals.map((t) => `${t.comp}.${t.term}`).sort()
    );
  }
  // same positions & transforms
  for (const comp of c.components.values()) {
    const rr = c2.getComponent(comp.refdes);
    assert.equal(rr.type, comp.type);
    assert.equal(rr.value, comp.value);
    assert.deepEqual(rr.transform, comp.transform);
    assert.deepEqual(rr.bboxWorld(), comp.bboxWorld());
  }
});

test('fromJSON restores coincident pin contacts omitted from wire nets', () => {
  const circuit = Circuit.fromJSON({
    version: 2,
    grid: 40,
    components: [
      { refdes: 'M1', type: 'nmos', value: '', transform: { x: 0, y: 0, rotation: 0, mirrorX: false, mirrorY: false } },
      { refdes: 'GND1', type: 'ground', value: '', transform: { x: 0, y: 80, rotation: 0, mirrorX: false, mirrorY: false } },
    ],
    nets: [],
    labels: [],
  });

  const net = circuit.netOfTerminal('M1.s');
  assert.ok(net);
  assert.equal(net, circuit.netOfTerminal('GND1.gnd'));

  circuit.addComponent('ground', { refdes: 'GND2', x: 0, y: 80 });
  assert.equal(net, circuit.netOfTerminal('GND2.gnd'));
});

test('topology-only snapshots preserve overlapping transient components without contacts', () => {
  const state = {
    version: 2,
    grid: 40,
    components: [
      { refdes: 'M1', type: 'nmos', value: '', transform: { x: 0, y: 0, rotation: 0, mirrorX: false, mirrorY: false } },
      { refdes: 'M2', type: 'nmos', value: '', transform: { x: 0, y: 0, rotation: 0, mirrorX: false, mirrorY: false } },
    ],
    nets: [],
    labels: [],
  };
  const normal = Circuit.fromJSON(JSON.parse(JSON.stringify(state)));
  assert.ok(normal.netOfTerminal('M1.g'), 'ordinary restores infer coincident contacts');

  const transient = Circuit.fromJSON({ ...state, topologyOnly: true });
  assert.equal(transient.netOfTerminal('M1.g'), null);
  assert.equal(transient.netOfTerminal('M2.g'), null);
});

test('draw order round-trips for components, nets, and labels', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { refdes: 'R1', x: 80, drawOrder: 7 });
  const r2 = c.addComponent('resistor', { refdes: 'R2', x: 480 });
  const net = c.connect(`${r1.refdes}.b`, `${r2.refdes}.a`);
  net.drawOrder = -3;
  const label = [...c.labels.values()].find((item) => item.owner === r1.refdes);
  label.drawOrder = 11;

  const restored = Circuit.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
  assert.equal(restored.getComponent('R1').drawOrder, 7);
  assert.equal(restored.getComponent('R2').drawOrder, 0);
  assert.equal(restored.getComponent('R1').circuit.netOfTerminal('R1.b').drawOrder, -3);
  assert.equal([...restored.labels.values()].find((item) => item.owner === 'R1').drawOrder, 11);
});

test('fromJSON rejects bad version', () => {
  assert.throws(() => Circuit.fromJSON({ version: 99 }), /unsupported state/);
});

// ----- labels -------------------------------------------------

test('addLabel places a standalone label with a grid-aligned anchor', () => {
  const c = new Circuit();
  const l = c.addLabel({ text: 'hello', x: 123, y: 57 });
  assert.ok(l.id);
  assert.equal(l.owner, null);
  assert.deepEqual(l.anchor, { x: 120, y: 40 }, 'anchor snaps to grid');
  const b = l.bbox();
  assert.equal(b.h, 2 * GRID, 'box height is an even (2-cell) grid multiple');
  assert.ok(Number.isInteger(b.w / GRID), `bbox width ${b.w} is a grid multiple`);
  assert.ok(Number.isInteger(b.w / GRID) && b.w / GRID % 2 === 0, `bbox width ${b.w} is an even grid multiple`);
  assert.ok(Number.isInteger(b.x / GRID), `bbox x ${b.x} on grid`);
  // center alignment: the box is centered on the anchor (a grid point)
  assert.equal(b.x + b.w / 2, l.anchor.x);
  assert.equal(b.y + b.h / 2, l.anchor.y);
});

test('a group of labels preserves relative anchors when moved together', () => {
  const c = new Circuit();
  const first = c.addLabel({ id: 'GROUP_A', text: 'A', x: 80, y: 120 });
  const second = c.addLabel({ id: 'GROUP_B', text: 'B', x: 280, y: 200 });
  const before = [first, second].map((label) => ({ ...label.anchorWorld() }));
  const delta = { x: 160, y: -80 };
  for (const label of [first, second]) {
    const point = label.anchorWorld();
    label.moveTo(point.x + delta.x, point.y + delta.y);
  }
  assert.deepEqual(first.anchorWorld(), { x: before[0].x + delta.x, y: before[0].y + delta.y });
  assert.deepEqual(second.anchorWorld(), { x: before[1].x + delta.x, y: before[1].y + delta.y });
  assert.deepEqual(
    { x: second.anchorWorld().x - first.anchorWorld().x, y: second.anchorWorld().y - first.anchorWorld().y },
    { x: before[1].x - before[0].x, y: before[1].y - before[0].y },
  );
});

test('label align keeps stable centered bounds and positions text inside them', () => {
  const c = new Circuit();
  const l = c.addLabel({ text: 'M1', x: 400, y: 0 });
  // The box is centered on the anchor for every text alignment.
  const center = l.bbox();
  assert.equal(center.x + center.w / 2, 400, 'center: box centered on anchor');
  assert.equal(center.y + center.h / 2, 0);

  let t = l.textPos();
  assert.equal(t.anchor, 'middle');
  assert.equal(t.x, 400);
  l.setAlign('left');
  const left = l.bbox();
  assert.deepEqual(left, center, 'left: alignment does not move or resize the bbox');
  assert.equal(left.x + left.w / 2, 400, 'left: box remains centered on anchor');
  t = l.textPos();
  assert.equal(t.anchor, 'start');
  assert.equal(t.x, left.x + GRID / 4, 'left: text starts a quarter cell inside the box left edge');
  l.setAlign('right');
  const right = l.bbox();
  assert.deepEqual(right, center, 'right: alignment does not move or resize the bbox');
  assert.equal(right.x + right.w / 2, 400, 'right: box remains centered on anchor');
  t = l.textPos();
  assert.equal(t.anchor, 'end');
  assert.equal(t.x, right.x + right.w - GRID / 4, 'right: text ends a quarter cell inside the box right edge');
});
test('arrow and box annotations persist geometry and move as selected labels', () => {
  const c = new Circuit();
  const arrow = c.addAnnotation('arrow', { x: 0, y: 0, end: { x: 120, y: 80 } });
  const box = c.addAnnotation('box', { x: 160, y: 40, end: { x: 320, y: 200 } });
  assert.deepEqual(arrow.toJSON().end, { x: 120, y: 80 });
  assert.deepEqual(box.bbox(), { x: 160, y: 40, w: 160, h: 160 });
  arrow.moveTo(40, 40);
  assert.deepEqual(arrow.anchor, { x: 40, y: 40 });
  assert.deepEqual(arrow.end, { x: 160, y: 120 });
  const restored = Circuit.fromJSON(c.toJSON());
  assert.equal(restored.labels.get(box.id).kind, 'box');
  assert.deepEqual(restored.labels.get(box.id).end, { x: 320, y: 200 });
  assert.throws(() => c.addAnnotation('arrow', { x: 0, y: 0, end: { x: 0, y: 0 } }), /non-zero length/);
  assert.throws(() => c.addAnnotation('box', { x: 0, y: 0, end: { x: 0, y: 40 } }), /non-zero width/);
});

test('line annotations preserve multi-point geometry and move as annotations', () => {
  const c = new Circuit();
  const line = c.addAnnotation('line', { points: [{ x: 0, y: 0 }, { x: 80, y: 40 }, { x: 160, y: 0 }] });
  assert.deepEqual(line.points, [{ x: 0, y: 0 }, { x: 80, y: 40 }, { x: 160, y: 0 }]);
  assert.deepEqual(line.bbox(), { x: 0, y: 0, w: 160, h: 40 });
  assert.equal(line.moveSegment(1, 40, 40), true);
  assert.deepEqual(line.points, [{ x: 40, y: 40 }, { x: 120, y: 80 }, { x: 160, y: 0 }]);
  assert.equal(line.moveVertex(1, 160, 80), true);
  assert.deepEqual(line.points, [{ x: 40, y: 40 }, { x: 160, y: 80 }, { x: 160, y: 0 }]);
  line.moveTo(40, 40);
  assert.deepEqual(line.points, [{ x: 40, y: 40 }, { x: 160, y: 80 }, { x: 160, y: 0 }]);
  const restored = Circuit.fromJSON(c.toJSON()).labels.get(line.id);
  assert.equal(restored.kind, 'line');
  assert.deepEqual(restored.points, line.points);
  assert.throws(() => c.addAnnotation('line', { points: [{ x: 0, y: 0 }] }), /at least two/);
});

test('line vertices may become collinear and segment drags preserve their angle', () => {
  const c = new Circuit();
  const line = c.addAnnotation('line', {
    points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: -80 }, { x: 160, y: -80 }, { x: 160, y: 40 }],
  });
  assert.equal(line.moveVertex(4, 160, 0), true);
  assert.deepEqual(line.points.at(-1), { x: 160, y: 0 });

  const before = line.points.slice(2, 4).map((point) => ({ ...point }));
  assert.equal(line.moveSegment(3, 40, 40), true);
  assert.deepEqual(
    line.points.slice(2, 4).map((point, i) => ({ x: point.x - before[i].x, y: point.y - before[i].y })),
    [{ x: 40, y: 40 }, { x: 40, y: 40 }],
  );
  assert.deepEqual(
    { x: line.points[3].x - line.points[2].x, y: line.points[3].y - line.points[2].y },
    { x: before[1].x - before[0].x, y: before[1].y - before[0].y },
  );
});

test('annotation labels are separate child labels that move and delete independently', () => {
  const c = new Circuit();
  const shape = c.addAnnotation('box', { x: 0, y: 0, end: { x: 160, y: 160 }, text: 'note' });
  const label = [...c.labels.values()].find((l) => l.parent === shape.id);
  assert.ok(label);
  label.moveTo(400, 400);
  assert.deepEqual(label.anchor, { x: 400, y: 400 });
  shape.moveTo(40, 40);
  assert.deepEqual(label.anchor, { x: 440, y: 440 });
  const state = c.toJSON();
  c.removeLabel(label.id);
  assert.equal(c.labels.has(shape.id), true);
  assert.equal(c.labels.has(label.id), false);
  const restored = Circuit.fromJSON(state);
  assert.equal(restored.labels.get(shape.id).kind, 'box');
  assert.equal([...restored.labels.values()].some((l) => l.parent === shape.id), true);
});

test('boxes default to dashed style and child labels inherit annotation color', () => {
  const c = new Circuit();
  const box = c.addAnnotation('box', { x: 0, y: 0, end: { x: 160, y: 160 }, text: 'note', style: { color: '#d00' } });
  assert.equal(box.style.lineStyle, 'dashed');
  const child = [...c.labels.values()].find((label) => label.parent === box.id);
  assert.equal(child.style.color, '#d00');
});

test('annotation text defaults attach to box top and arrow base direction', () => {
  const c = new Circuit();
  const box = c.addAnnotation('box', { x: 160, y: 200, end: { x: 480, y: 400 }, text: 'box' });
  const boxText = [...c.labels.values()].find((label) => label.parent === box.id);
  assert.equal(boxText.bbox().y + boxText.bbox().h, box.bbox().y);
  assert.equal(boxText.bbox().x + boxText.bbox().w / 2, (box.anchor.x + box.end.x) / 2);

  const upRight = c.addAnnotation('arrow', { x: 640, y: 400, end: { x: 800, y: 240 }, text: 'up-right' });
  const upRightText = [...c.labels.values()].find((label) => label.parent === upRight.id);
  assert.equal(upRightText.bbox().x + upRightText.bbox().w, upRight.anchor.x);
  assert.equal(upRightText.bbox().y, upRight.anchor.y);

  const downLeft = c.addAnnotation('arrow', { x: 960, y: 240, end: { x: 800, y: 400 }, text: 'down-left' });
  const downLeftText = [...c.labels.values()].find((label) => label.parent === downLeft.id);
  assert.equal(downLeftText.bbox().x, downLeft.anchor.x);
  assert.equal(downLeftText.bbox().y + downLeftText.bbox().h, downLeft.anchor.y);
});

test('setText resizes the bbox but keeps the anchor fixed', () => {
  const c = new Circuit();
  const l = c.addLabel({ text: 'R', x: 400, y: 0 });
  const w1 = l.bbox().w;
  l.setText('longer');
  const w2 = l.bbox().w;
  assert.ok(w2 >= w1, 'longer text widens the box');
  assert.equal(l.bbox().x + l.bbox().w / 2, 400);
});

test('browser-measured label bounds round outward to even grid-cell dimensions', () => {
  const c = new Circuit();
  const l = c.addLabel({ text: '$$A_v$$', x: 400, y: 0, math: true });
  assert.equal(l.setRenderedTextBounds(81, 41), true);
  assert.deepEqual(l.bbox(), { x: 320, y: -40, w: 160, h: 80 });
  assert.equal(l.setRenderedTextBounds(81, 41), false);
  const restored = Circuit.fromJSON(c.toJSON()).labels.get(l.id);
  assert.equal(restored._renderedTextBounds, null, 'runtime browser metrics are not persisted');
  assert.deepEqual(restored.bbox(), l.bbox(), 'the grid-sized math footprint is preserved before fresh measurement');
  assert.deepEqual(l.toJSON().mathBox, { w: 160, h: 80 });
  restored.setText('a different mathematical label');
  assert.equal(restored._mathBox, null, 'text edits invalidate the saved footprint');
});

test('sub-pixel measurement noise at a grid boundary does not shift aligned label edges', () => {
  const c = new Circuit();
  const label = c.addLabel({ text: '\\text{Assumptions}', x: 400, y: 240, math: true, align: 'left' });
  label.setRenderedTextBounds(320.00001, 160.00001);
  const before = label.bbox();
  assert.deepEqual(before, { x: 240, y: 160, w: 320, h: 160 });
  const loaded = Circuit.fromJSON(c.toJSON()).labels.get(label.id);
  loaded.setRenderedTextBounds(319.99999, 159.99999);
  assert.deepEqual(loaded.bbox(), before);
  loaded.setRenderedTextBounds(320.01, 160.01);
  assert.deepEqual(loaded.bbox(), { x: 200, y: 120, w: 400, h: 240 }, 'real overflow still expands outward');
});

test('applyMarkup wraps, unwraps, and reverts mixed selections', () => {
  // wrap a plain selection in subscript markup
  let r = applyMarkup('CGS', 1, 3, '_');
  assert.deepEqual(r, { text: 'C_{GS}', selStart: 3, selEnd: 5 });
  // selecting the subscripted text and pressing again unwraps it
  r = applyMarkup(r.text, r.selStart, r.selEnd, '_');
  assert.deepEqual(r, { text: 'CGS', selStart: 1, selEnd: 3 });
  // superscript uses ^{...}
  r = applyMarkup('VDD', 0, 1, '^');
  assert.deepEqual(r, { text: '^{V}DD', selStart: 2, selEnd: 3 });
  // a selection spanning markup + plain text reverts everything to normal
  r = applyMarkup('V_{IN}OUT', 1, 5, '_');
  assert.deepEqual(r, { text: 'VINOUT', selStart: 1, selEnd: 5 });
  // no selection -> null
  assert.equal(applyMarkup('abc', 1, 1, '_'), null);
});

test('owned label anchorWorld follows the component transform', () => {
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { x: 520, y: 0 });
  const lab = c.labelOf(m1.refdes);
  assert.ok(lab, 'nmos gets a dedicated instance label');
  assert.equal(lab.text, 'M_{1}');
  assert.equal(lab.owner, m1.refdes);
  // default offset (40,0) transforms to (560,0) at the origin (bulk side, gate height)
  assert.deepEqual(lab.anchorWorld(), { x: 560, y: 0 });
  c.moveComponent(m1.refdes, 560, 80);
  assert.deepEqual(lab.anchorWorld(), { x: 600, y: 80 });
});

test('owned label moveTo translates its local offset, keeping it on grid', () => {
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { x: 520, y: 0 });
  const lab = c.labelOf(m1.refdes);
  lab.moveTo(440, 160);
  assert.deepEqual(lab.anchorWorld(), { x: 440, y: 160 });
  lab.moveTo(95, 82);
  assert.deepEqual(lab.anchorWorld(), { x: 80, y: 80 }, 'offset snaps to grid');
});

test('all component types auto-create an owned instance label for their id', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 480, y: 0 });
  assert.equal(c.labels.size, 1);
  const lab = c.labelOf(r.refdes);
  assert.ok(lab, 'resistor gets an owned instance label like every other symbol');
  assert.equal(lab.owner, r.refdes);
  assert.equal(lab.text, 'R_{1}');
});

test('owned component labels inherit the component color', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { style: { color: '#d00' } });
  assert.equal(c.labelOf(r.refdes)?.style.color, '#d00');
});


test('nextRefdes reuses the smallest available index', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor');
  const r2 = c.addComponent('resistor');
  const r3 = c.addComponent('resistor');
  c.removeComponent(r2.refdes);
  assert.equal(c.addComponent('resistor').refdes, 'R2', 'R2 freed, reused next');
  assert.equal(c.addComponent('resistor').refdes, 'R4', 'R3 still in use, so skip to R4');
});

test('removeComponent removes its owned instance label', () => {
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { x: 520, y: 0 });
  assert.equal(c.labels.size, 1);
  const m2 = c.addComponent('pmos', { x: 720, y: 0 });
  assert.equal(c.labels.size, 2);
  c.removeComponent(m1.refdes);
  assert.equal(c.labels.size, 1);
  assert.equal(c.labelOf(m2.refdes)?.owner, m2.refdes);
});

test('labels round-trip through toJSON/fromJSON (standalone and owned)', () => {
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { x: 520, y: 0 });
  c.addLabel({ text: 'test point', x: 280, y: 240, align: 'left' });
  const lab = c.labelOf(m1.refdes);
  lab.moveTo(440, 160); // custom offset

  const c2 = Circuit.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
  assert.equal(c2.labels.size, 2);
  const owned = [...c2.labels.values()].find((l) => l.owner);
  assert.equal(owned.owner, 'M1');
  assert.equal(owned.text, 'M_{1}');
  assert.deepEqual(owned.anchorWorld(), { x: 440, y: 160 });
  const free = [...c2.labels.values()].find((l) => !l.owner);
  assert.equal(free.text, 'test point');
  assert.equal(free.align, 'left');
  assert.deepEqual(free.anchor, { x: 280, y: 240 });
});

test('label font style toggles round-trip independently', () => {
  const c = new Circuit();
  const label = c.addLabel({ id: 'STYLE_LABEL', text: 'note', x: 0, y: 0, style: { bold: false, italic: true } });
  const restored = Circuit.fromJSON(JSON.parse(JSON.stringify(c.toJSON()))).labels.get(label.id);
  assert.equal(restored.style.bold, false);
  assert.equal(restored.style.italic, true);
});

test('fromJSON drops orphaned owned labels (owner missing)', () => {
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { x: 520, y: 0 });
  const data = c.toJSON();
  data.labels[0].owner = 'M99';
  const c2 = Circuit.fromJSON(data);
  assert.equal(c2.labels.size, 0);
});

test('net-label boxes attach by an edge and preserve orientation on reload', () => {
  const c = new Circuit();
  const horizontal = c.createWireNet({ name: 'H', route: [{ x: 0, y: 0 }, { x: 160, y: 0 }] });
  const vertical = c.createWireNet({ name: 'V', route: [{ x: 400, y: 0 }, { x: 400, y: 160 }] });
  const h = c.addNetLabel(horizontal, { id: 'H_LABEL', anchor: { x: 80, y: 0 } });
  const v = c.addNetLabel(vertical, { id: 'V_LABEL', anchor: { x: 400, y: 80 } });
  assert.equal(c._nearestNetPathAttachment(horizontal, { x: 80, y: -40 }).side, 'above');
  assert.equal(c._nearestNetPathAttachment(horizontal, { x: 80, y: 40 }).side, 'below');
  assert.equal(c._nearestNetPathAttachment(vertical, { x: 360, y: 80 }).side, 'left');
  assert.equal(c._nearestNetPathAttachment(vertical, { x: 440, y: 80 }).side, 'right');
  assert.equal(h.netSide, 'above');
  assert.equal(h.bbox().y + h.bbox().h, h.anchorWorld().y);
  assert.equal(v.netSide, 'left');
  assert.equal(v.bbox().x + v.bbox().w, v.anchorWorld().x);
  assert.ok(h.textPos().y < h.anchorWorld().y, 'horizontal label text stays off the wire');
  assert.ok(v.textPos().x < v.anchorWorld().x, 'vertical label text stays off the wire');
  const restored = Circuit.fromJSON(c.toJSON());
  assert.equal(restored.labels.get('H_LABEL').netSide, 'above');
  assert.equal(restored.labels.get('V_LABEL').netSide, 'left');
});

test('net labels derive their text from the physical net and form logical groups', () => {
  const c = new Circuit();
  const a = c.createWireNet({ name: 'V_{IN}', route: [{ x: 0, y: 0 }, { x: 80, y: 0 }] });
  const b = c.createWireNet({ name: 'V_{IN}', route: [{ x: 160, y: 0 }, { x: 240, y: 0 }] });
  const label = c.addNetLabel(a, { id: 'VIN_LABEL', anchor: { x: 81, y: 1 } });
  assert.equal(label.netId, a.id);
  assert.equal(label.owner, null);
  assert.equal(label.text, 'V_{IN}');
  assert.deepEqual(label.anchor, { x: 80, y: 0 });
  assert.deepEqual(c.logicalNetGroup('V_{IN}').netIds, [a.id, b.id]);
  c.renameNet(a, 'V_{OUT}');
  assert.equal(label.text, 'V_{OUT}');
});

test('explicitly merging same-named physical nets inherits names and retargets labels', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 400, y: 0 });
  const a = c.connect('R1.a', 'R1.b');
  const b = c.connect('R2.a', 'R2.b');
  c.renameNet(a, 'SIG');
  c.renameNet(b, 'SIG');
  c.addNetLabel(a, { id: 'SIG_A', x: 0, y: 80 });
  const p = c.getComponent('R2').terminalWorld('a');
  const merged = c.wireTo('R1.a', p, [], { routeStyle: 'diagonal' });
  assert.equal(c.nets.size, 1);
  assert.equal(merged.name, 'SIG');
  assert.equal(c.labels.get('SIG_A').netId, merged.id);
});

test('removing a net removes its owned net labels and orphan labels do not load', () => {
  const c = new Circuit();
  const net = c.createWireNet({ name: 'CLK', route: [{ x: 0, y: 0 }, { x: 80, y: 0 }] });
  c.addNetLabel(net, { id: 'CLK_LABEL', x: 0, y: 0 });
  c.removeNet(net);
  assert.equal(c.labels.has('CLK_LABEL'), false);
  const state = {
    version: 2, grid: 40, components: [], nets: [],
    labels: [{ id: 'ORPHAN', text: 'CLK', netId: 'N99', owner: null, anchor: { x: 0, y: 0 } }],
  };
  const loaded = Circuit.fromJSON(state);
  assert.equal(loaded.labels.size, 0);
  assert.equal([...loaded.labels.values()].filter((label) => label.netId).length, 0);
});

test('net-label anchors must be drawable, IDs are unique, and foreign labels remain soft obstacles', () => {
  const c = new Circuit();
  const a = c.createWireNet({ name: 'A', route: [{ x: 0, y: 0 }, { x: 400, y: 0 }] });
  const b = c.createWireNet({ name: 'B', route: [{ x: 0, y: 80 }, { x: 400, y: 80 }] });
  const la = c.addNetLabel(a, { id: 'A_LABEL', x: 200, y: 0 });
  const lb = c.addNetLabel(b, { id: 'B_LABEL', x: 200, y: 80 });
  assert.throws(() => c.addNetLabel(a, { id: 'OFF_PATH', x: 200, y: 40 }), /anchor must lie/);
  assert.throws(() => c.addNetLabel(a, { id: la.id, text: 'RENAMED', x: 200, y: 0 }), /label id/);
  assert.equal(a.name, 'A', 'duplicate add does not rename the net');
  assert.throws(() => c.renameNet(a, '   '), /cannot clear name/);
  assert.throws(() => la.setText(''), /cannot clear name/);
  assert.equal(a.name, 'A');
  assert.throws(() => c.addLabel({ id: la.id, text: 'duplicate', x: 0, y: 0 }), /label id/);
  assert.throws(() => Circuit.fromJSON({
    version: 2, grid: 40, components: [], nets: [],
    labels: [{ id: 'DUP', text: 'a', anchor: { x: 0, y: 0 } }, { id: 'DUP', text: 'b', anchor: { x: 40, y: 0 } }],
  }), /label id/);
  const env = c._netEnv(a.id);
  assert.equal(env.labelRects.some((r) => r.x === la.bbox().x && r.y === la.bbox().y), false);
  assert.equal(env.labelRects.some((r) => r.x === lb.bbox().x && r.y === lb.bbox().y), true);
});

test('visual annotations are excluded from routing label obstacles', () => {
  const c = new Circuit();
  c.addAnnotation('box', { id: 'B1', x: 0, y: 0, end: { x: 400, y: 160 } });
  c.addAnnotation('arrow', { id: 'A1', x: 0, y: 0, end: { x: 400, y: 0 } });
  c.addLabel({ id: 'L1', text: 'NOTE', x: 800, y: 0 });
  const env = c._netEnv();
  assert.equal(env.labelRects.some((r) => r.x === c.labels.get('B1').bbox().x), false);
  assert.equal(env.labelRects.some((r) => r.x === c.labels.get('A1').bbox().x), false);
  assert.equal(env.labelRects.some((r) => r.x === c.labels.get('L1').bbox().x), true);
});

test('managed net merges preserve labels and inherit the physical name', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 400, y: 0 });
  const named = c.connect('R1.a', 'R1.b');
  const unnamed = c.connect('R2.a', 'R2.b');
  c.renameNet(named, 'SIG');
  const labelPoint = named.paths()[0][2];
  const label = c.addNetLabel(named, { id: 'SIG_LABEL', anchor: labelPoint });
  const namedPaths = named.paths();
  const unnamedPaths = unnamed.paths();

  const merged = c.connect('R1.a', 'R2.a');
  assert.equal(merged.name, 'SIG');
  assert.equal(label.netId, merged.id);
  assert.equal(c.nets.has(unnamed.id), false);
  for (const path of [...namedPaths, ...unnamedPaths]) {
    assert.ok(merged.paths().some((candidate) => JSON.stringify(candidate) === JSON.stringify(path)));
  }
});

test('splitting a fixed wire redistributes labels to their unique child paths', () => {
  const c = new Circuit();
  const net = c.createWireNet({
    name: 'SIG',
    routingMode: 'fixed',
    fixedPaths: [{ points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 0 }, { x: 120, y: 0 }], start: null, end: null }],
  });
  c.addNetLabel(net, { id: 'LEFT_LABEL', x: 20, y: 0 });
  c.addNetLabel(net, { id: 'RIGHT_LABEL', x: 100, y: 0 });
  c.deleteWireSegment(net.id, 0, 2);
  assert.equal(c.labels.get('LEFT_LABEL').netId, net.id);
  assert.notEqual(c.labels.get('RIGHT_LABEL').netId, net.id);
  assert.equal(c.netLabels(c.labels.get('RIGHT_LABEL').netId)[0].id, 'RIGHT_LABEL');
});

test('deleting all managed geometry removes the physical net and its labels', () => {
  const c = new Circuit();
  const net = c.createWireNet({ name: 'GONE', route: [{ x: 0, y: 0 }, { x: 40, y: 0 }] });
  c.addNetLabel(net, { id: 'GONE_LABEL', x: 20, y: 0 });
  c.deleteWireSegment(net.id, 0, 1);
  assert.equal(c.nets.has(net.id), false);
  assert.equal(c.labels.has('GONE_LABEL'), false);
});

test('rerouting a moved physical net keeps its labels attached by relocating them on-path', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  const target = c.addComponent('resistor', { refdes: 'R2', x: 400, y: 0 });
  const net = c.connect('R1.b', 'R2.a');
  c.renameNet(net, 'SIG');
  const oldPoint = net.paths()[0][1];
  const label = c.addNetLabel(net, { id: 'MOVE_LABEL', anchor: oldPoint });
  c.moveComponent(target.refdes, 400, 400);
  assert.equal(c.rerouteNet(net, new Map([[target.refdes, { dx: 0, dy: 400 }]])), true);
  assert.equal(c.labels.has(label.id), true);
  assert.equal(c._netLabelAnchorOnPath(net, label.anchorWorld()), true);
});

test('ensureUniqueTerminals rejects conflicting names before mutating memberships or labels', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  const a = c.createWireNet({ name: 'A', route: [{ x: -80, y: 0 }, { x: -120, y: 0 }] });
  const b = c.createWireNet({ name: 'B', route: [{ x: -80, y: 0 }, { x: -160, y: 0 }] });
  a.terminals.push({ comp: 'R1', term: 'a' });
  b.terminals.push({ comp: 'R1', term: 'a' });
  const la = c.addNetLabel(a, { id: 'A_LABEL', x: -120, y: 0 });
  const lb = c.addNetLabel(b, { id: 'B_LABEL', x: -120, y: 0 });
  assert.throws(() => c.ensureUniqueTerminals(), /conflicting net names/);
  assert.equal(c.nets.size, 2);
  assert.equal(la.netId, a.id);
  assert.equal(lb.netId, b.id);
});
test('reconnecting coincident net pieces restores terminals and junction solder', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 400, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 200, y: 400 });
  const left = c.createWireNet({
    branches: [[{ x: 80, y: 0 }, { x: 160, y: 0 }]],
  });
  left.terminals.push({ comp: 'R1', term: 'b' });
  const right = c.createWireNet({
    branches: [
      [{ x: 160, y: 0 }, { x: 320, y: 0 }],
      [{ x: 160, y: 0 }, { x: 120, y: 400 }],
    ],
  });
  right.terminals.push({ comp: 'R2', term: 'a' }, { comp: 'R3', term: 'a' });
  c.syncJunctionSolders();
  assert.equal(c.components.has('SOLDER1'), false);
  assert.equal(c.reconnectCoincidentNets(), 1);
  assert.equal(c.nets.size, 1);
  assert.equal(c.netOfTerminal('R1.b').id, c.netOfTerminal('R2.a').id);
  assert.equal(c.netOfTerminal('R3.a').id, c.netOfTerminal('R2.a').id);
  const junctionDots = [...c.components.values()].filter((component) => component.type === 'solder');
  assert.equal(junctionDots.length, 1);
  assert.ok(c.nets.values().next().value.junctions.length > 0);
});

test('reconnecting coincident nets prunes partial same-net overlap after closure', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 400, y: 0 });
  const left = c.createWireNet({
    style: { color: '#d00', lineStyle: 'dashed', width: 'thick' },
    branches: [[{ x: 80, y: 0 }, { x: 240, y: 0 }]],
  });
  left.terminals.push({ comp: 'R1', term: 'b' });
  const right = c.createWireNet({
    style: { color: '#00f', lineStyle: 'solid', width: 'normal' },
    branches: [[{ x: 240, y: 0 }, { x: 120, y: 0 }, { x: 320, y: 0 }]],
  });
  right.terminals.push({ comp: 'R2', term: 'a' });
  assert.equal(c.reconnectCoincidentNets(), 1);
  assert.equal(c.nets.size, 1);
  assert.equal(c.netOfTerminal('R1.b').id, left.id);
  assert.equal(c.netOfTerminal('R2.a').id, left.id);
  assert.deepEqual(left.style, { color: '#d00', lineStyle: 'dashed', width: 'thick' });
  assert.deepEqual(left.wireStyles, {
    '0:1': { color: '#d00', lineStyle: 'dashed', width: 'thick' },
    '1:1': { color: '#d00', lineStyle: 'dashed', width: 'thick' },
    '2:1': { color: '#00f', lineStyle: 'solid', width: 'normal' },
  });
  assert.deepEqual(left.branches, [
    [{ x: 80, y: 0 }, { x: 120, y: 0 }],
    [{ x: 120, y: 0 }, { x: 240, y: 0 }],
    [{ x: 240, y: 0 }, { x: 320, y: 0 }],
  ]);
});

test('reconnecting coincident nets preserves authored geometry without overlap', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 160, y: 0 });
  const left = c.createWireNet({
    style: { color: '#d00' },
    wireStyles: { '0:1': { color: '#0a0' } },
    branches: [[{ x: 0, y: 0 }, { x: 40, y: 0 }]],
  });
  left.terminals.push({ comp: 'R1', term: 'a' });
  const right = c.createWireNet({
    style: { color: '#00f', lineStyle: 'dotted' },
    wireStyles: { '1:1': { color: '#0a0', lineStyle: 'dashed' } },
    branches: [
      [{ x: 40, y: 0 }, { x: 80, y: 0 }],
      [{ x: 40, y: 0 }, { x: 40, y: 40 }],
    ],
  });
  right.terminals.push({ comp: 'R2', term: 'a' });
  const authored = right.branches.map((branch) => branch.map((point) => ({ ...point })));
  assert.equal(c.reconnectCoincidentNets(), 1);
  assert.deepEqual(left.branches, [
    [{ x: 0, y: 0 }, { x: 40, y: 0 }],
    ...authored,
  ]);
  assert.deepEqual(left.style, { color: '#d00', lineStyle: 'solid', width: 'normal' });
  assert.deepEqual(left.wireStyles, {
    '0:1': { color: '#0a0' },
    '1:1': { color: '#00f', lineStyle: 'dotted', width: 'normal' },
    '2:1': { color: '#0a0', lineStyle: 'dashed' },
  });
});

test('reconnecting a floating managed endpoint attaches a landed terminal', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 400, y: 0 });
  const net = c.createWireNet({ route: [{ x: 80, y: 0 }, { x: 320, y: 0 }] });
  net.terminals.push({ comp: 'R2', term: 'a' });
  assert.equal(c.netOfTerminal('R1.b'), null);
  c.reconnectCoincidentNets();
  assert.equal(c.netOfTerminal('R1.b').id, net.id);
  assert.deepEqual(net.terminals, [
    { comp: 'R2', term: 'a' },
    { comp: 'R1', term: 'b' },
  ]);
});

test('conflicting net names merge with a reconciliation warning', () => {
  const c = new Circuit();
  const a = c.createWireNet({ name: 'A', route: [{ x: 0, y: 0 }, { x: 40, y: 0 }] });
  const b = c.createWireNet({ name: 'B', route: [{ x: 40, y: 0 }, { x: 80, y: 0 }] });
  assert.equal(c.reconnectCoincidentNets(), 1);
  assert.equal(c.nets.size, 1);
  assert.equal(a.name, 'A');
  assert.deepEqual(c.netNameWarnings, [{
    netId: a.id,
    names: ['A', 'B'],
    message: 'merged nets retain "A" but also contained B',
  }]);
  const loaded = Circuit.fromJSON(c.toJSON());
  assert.deepEqual(loaded.netNameWarnings, c.netNameWarnings);
  c.renameNet(a, 'MERGED');
  assert.deepEqual(c.netNameWarnings, []);
});

test('splitting a merged net clears its stale name warning', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  const a = c.createWireNet({ name: 'A', route: [{ x: 160, y: 0 }, { x: 240, y: 0 }] });
  a.terminals.push({ comp: 'R1', term: 'b' });
  const b = c.createWireNet({ name: 'B', route: [{ x: 240, y: 0 }, { x: 400, y: 0 }] });
  b.terminals.push({ comp: 'R2', term: 'a' });
  c.reconnectCoincidentNets();
  assert.equal(c.netNameWarnings.length, 1);

  c.deleteWireSegments(a.id, [{ branch: 0, segment: 1 }]);
  assert.deepEqual(c.netNameWarnings, []);
});

test('loading a split net drops its persisted merge warning', () => {
  const c = new Circuit();
  c.createWireNet({ name: 'VOUT', route: [{ x: 0, y: 0 }, { x: 40, y: 0 }] });
  c.createWireNet({ name: 'VDD', route: [{ x: 80, y: 0 }, { x: 120, y: 0 }] });
  const data = c.toJSON();
  data.netNameWarnings = [{
    netId: 'N1',
    names: ['VOUT', 'VDD'],
    message: 'merged nets retain "VOUT" but also contained VDD',
  }];
  assert.deepEqual(Circuit.fromJSON(data).netNameWarnings, []);
});

test('floating managed and fixed wire nets survive serialization and have drawable points', () => {
  const c = new Circuit();
  const managed = c.createWireNet({ branches: [[{ x: 0, y: 0 }, { x: 40, y: 40 }]], route: [{ x: 0, y: 0 }, { x: 40, y: 40 }] });
  const fixed = c.createWireNet({ routingMode: 'fixed', fixedPaths: [{ points: [{ x: 80, y: 0 }, { x: 120, y: 40 }], start: null, end: null }] });
  const copy = Circuit.fromJSON(c.toJSON());
  assert.deepEqual(copy.nets.get(managed.id).paths()[0], managed.paths()[0]);
  assert.deepEqual(copy.nets.get(fixed.id).paths()[0], fixed.paths()[0]);
  assert.equal(copy.nets.size, 2);
  assert.ok(copy.nets.get(managed.id).points().length >= 2);
  assert.ok(copy.nets.get(fixed.id).points().length >= 2);
});

test('wire segment containment and extraction keep independent contiguous islands', () => {
  const paths = [[{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 120, y: 40 }]];
  assert.deepEqual(containedWireSegments(paths, { x0: 0, y0: 0, x1: 40, y1: 40 }), [
    { branch: 0, segment: 1 }, { branch: 0, segment: 2 },
  ]);
  assert.deepEqual(extractWireIslands(paths, [{ branch: 0, segment: 1 }, { branch: 0, segment: 2 }]), [
    [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }],
  ]);
  assert.deepEqual(containedWireSegments([[{ x: 0, y: 0 }, { x: 0, y: 0 }]], { x0: -1, y0: -1, x1: 1, y1: 1 }), []);
});

test('fragment extraction retains selected T topology at explicit junctions', () => {
  const paths = [
    [{ x: 0, y: 40 }, { x: 40, y: 40 }],
    [{ x: 40, y: 0 }, { x: 40, y: 40 }],
    [{ x: 40, y: 40 }, { x: 80, y: 40 }],
  ];
  const selected = [{ branch: 0, segment: 1 }, { branch: 1, segment: 1 }, { branch: 2, segment: 1 }];
  const fragments = extractWireFragments(paths, selected, [{ x: 40, y: 40 }]);
  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].paths.length, 3);
  assert.deepEqual(fragments[0].junctions, [{ x: 40, y: 40 }]);
  const fixed = extractWireFragments([[{ x: 0, y: 0 }, { x: 80, y: 80 }]], [{ branch: 0, segment: 1 }], [{ x: 40, y: 40 }]);
  assert.equal(fixed.length, 1);
  assert.equal(fixed[0].paths.length, 2, 'an interior fixed junction is retained as a shared vertex');
});

test('world-space point and component transforms share a snapped center', () => {
  const center = { x: 40, y: 40 };
  assert.deepEqual(transformWorldPoints([{ x: 0, y: 40 }, { x: 40, y: 40 }], center), [
    { x: 40, y: 0 }, { x: 40, y: 40 },
  ]);
  const t = transformComponentWorld({ x: 0, y: 40, rotation: 0, mirrorX: false, mirrorY: false }, center, 'rotate');
  assert.deepEqual({ x: t.x, y: t.y }, { x: 40, y: 0 });
  assert.deepEqual(transformWorldPoints([{ x: 0, y: 40 }, { x: 40, y: 40 }], center, 'rotate180'), [
    { x: 80, y: 40 }, { x: 40, y: 40 },
  ]);
});

test('world-space component rotation keeps orientation at half-grid centers', () => {
  const transformed = transformComponentWorld(
    { x: 0, y: 0, rotation: 0, mirrorX: false, mirrorY: false },
    { x: 20, y: 0 },
    'rotate',
  );
  assert.deepEqual({ x: transformed.x, y: transformed.y }, { x: 40, y: -0 });
  assert.equal(transformed.rotation, 90);
});

test('floating endpoint attachment is exact and preserves fixed geometry', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 120, y: 0 });
  const n = c.createWireNet({ routingMode: 'fixed', fixedPaths: [{ points: [{ x: 0, y: 0 }, { x: 40, y: 40 }, { x: 40, y: 0 }], start: null, end: null }] });
  const before = n.paths()[0].slice(0, 2);
  c.attachWireEndpoint(n, 0, 2, `${r.refdes}.a`);
  assert.deepEqual(n.paths()[0].slice(0, 2), before);
  assert.deepEqual(n.paths()[0][2], r.terminalWorld('a'));
  assert.deepEqual(n.terminals, [{ comp: r.refdes, term: 'a' }]);
  assert.throws(() => c.attachWireEndpoint(n, 0, 2, { x: 80, y: 80 }), /existing wire/);
  assert.throws(() => c.attachWireEndpoint(n, 0, 0, `${r.refdes}.a`), /not exactly landed/);
});

test('batched terminal membership cleanup leaves each terminal in one net', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor');
  const a = c.createWireNet({ branches: [[{ x: 0, y: 0 }, { x: 40, y: 0 }]] });
  const b = c.createWireNet({ branches: [[{ x: 40, y: 0 }, { x: 80, y: 0 }]] });
  a.terminals.push({ comp: r.refdes, term: 'a' });
  b.terminals.push({ comp: r.refdes, term: 'a' });
  c.ensureUniqueTerminals([r.refdes]);
  assert.equal([...c.nets.values()].filter((n) => n.terminals.some((t) => t.comp === r.refdes && t.term === 'a')).length, 1);
});

test('wirePointTo does not add a redundant branch within one connected net', () => {
  const c = new Circuit();
  const net = c.createWireNet({ preserveEmpty: true, branches: [[{ x: 0, y: 0 }, { x: 160, y: 0 }]] });
  const before = net.toJSON();
  assert.strictEqual(c.wirePointTo({ x: 0, y: 0 }, { x: 160, y: 0 }, [], net.id), net);
  assert.deepEqual(net.toJSON(), before);
});

test('wirePointTo can intentionally connect disconnected branches of one net', () => {
  const c = new Circuit();
  const net = c.createWireNet({
    preserveEmpty: true,
    branches: [
      [{ x: 0, y: 0 }, { x: 80, y: 0 }],
      [{ x: 200, y: 0 }, { x: 280, y: 0 }],
    ],
  });
  c.wirePointTo({ x: 80, y: 0 }, { x: 200, y: 0 }, [], net.id);
  // The connecting wire continues both pieces at plain end points, so the
  // run becomes one polyline instead of three abutting stubs.
  assert.deepEqual(net.branches, [[{ x: 0, y: 0 }, { x: 280, y: 0 }]]);
});

test('wirePointTo keeps a branch split where a terminal or junction sits', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 }); // b=(80,0)
  const net = c.wirePointTo({ x: 80, y: 0 }, { x: 240, y: 0 });
  c.wirePointTo({ x: 240, y: 0 }, { x: 400, y: 0 }, [], net.id);
  assert.deepEqual(net.branches, [[{ x: 80, y: 0 }, { x: 400, y: 0 }]], 'plain end point joins');
  c.wirePointTo({ x: 240, y: 0 }, { x: 240, y: 160 }, [], net.id);
  assert.equal(net.branches.length, 3, 'a T junction stays a branch boundary');
});

test('splitting a styled wire keeps arrowheads on the original endpoints', () => {
  for (const [arrowhead, expected] of [
    ['start', ['start', 'none']],
    ['end', ['none', 'end']],
    ['both', ['start', 'end']],
  ]) {
    const c = new Circuit();
    const net = c.createWireNet({
      preserveEmpty: true,
      branches: [[{ x: 0, y: 0 }, { x: 0, y: 400 }]],
      wireStyles: { '0:1': { color: '#d00', arrowhead } },
    });
    c.wirePointTo({ x: 160, y: 0 }, { x: 0, y: 200 }, [{ x: 160, y: 200 }], net.id);
    assert.equal(net.wireStyles['0:1'].arrowhead, expected[0], `${arrowhead} tail split`);
    assert.equal(net.wireStyles['1:1'].arrowhead, expected[1], `${arrowhead} head split`);
    assert.equal(net.wireStyles['0:1'].color, '#d00');
    assert.equal(net.wireStyles['1:1'].color, '#d00');
  }
});

test('moving a wire endpoint keeps its arrowhead on the new logical endpoint', () => {
  const c = new Circuit();
  c.addComponent('block', { refdes: 'B1', x: 0, y: 0 });
  c.addComponent('block', { refdes: 'B2', x: 0, y: 400 });
  const net = c.createWireNet({
    route: [{ x: 0, y: 80 }, { x: 0, y: 320 }],
    wireStyles: { '0:1': { arrowhead: 'end' } },
  });
  net.terminals = [
    { comp: 'B1', term: 'T11' },
    { comp: 'B2', term: 'T9' },
  ];

  c.moveComponent('B2', 160, 400);
  assert.equal(c.rerouteNet(net, new Map([['B2', { dx: 160, dy: 0 }]])), true);
  assert.deepEqual(net.paths()[0], [
    { x: 0, y: 80 }, { x: 0, y: 200 }, { x: 160, y: 200 }, { x: 160, y: 320 },
  ]);
  assert.equal(net.wireStyles['0:1'].arrowhead, 'none');
  assert.equal(net.wireStyles['0:2'].arrowhead, 'none');
  assert.equal(net.wireStyles['0:3'].arrowhead, 'end');
  const svg = svgString(c);
  assert.match(svg, /<polygon points="160 315\.20 178 283\.20 142 283\.20"/);
  assert.doesNotMatch(svg, /<polygon points="0 120/);
});

test('dragging a styled bend keeps a two-terminal route as one branch', () => {
  const c = new Circuit();
  c.addComponent('block', { refdes: 'B1', x: 320, y: 400 });
  c.addComponent('block', { refdes: 'B2', x: 280, y: 720 });
  const net = c.createWireNet({
    branches: [[
      { x: 320, y: 480 },
      { x: 320, y: 560 },
      { x: 280, y: 560 },
      { x: 280, y: 640 },
    ]],
    wireStyles: { '0:3': { arrowhead: 'end' } },
  });
  net.terminals = [
    { comp: 'B1', term: 'T11' },
    { comp: 'B2', term: 'T9' },
  ];

  const dragged = net.branches[0].map((point) => ({ ...point }));
  moveWireRun(dragged, 'h', 560, 520);
  net.branches[0] = dragged;
  net.route = dragged.map((point) => ({ ...point }));
  c._reduceNet(net);

  assert.deepEqual(net.branches, [[
    { x: 320, y: 480 },
    { x: 320, y: 520 },
    { x: 280, y: 520 },
    { x: 280, y: 640 },
  ]]);
  assert.equal(net.wireStyles['0:3'].arrowhead, 'end', 'the head stays on the logical route end');
  assert.deepEqual(net.junctions, [], 'an ordinary bend is not promoted to a junction');
});

test('collapsing a styled route keeps its arrowhead on the surviving end segment', () => {
  const c = new Circuit();
  const net = c.createWireNet({
    branches: [[
      { x: 0, y: 0 },
      { x: 0, y: 80 },
      { x: 160, y: 80 },
      { x: 160, y: 160 },
    ]],
    wireStyles: {
      '0:1': { arrowhead: 'none' },
      '0:2': { arrowhead: 'none' },
      '0:3': { arrowhead: 'end' },
    },
  });
  const before = net.paths();
  const savedStyles = Object.fromEntries(Object.entries(net.wireStyles).map(([key, style]) => [key, { ...style }]));
  net.branches = [[
    { x: 0, y: 0 },
    { x: 0, y: 80 },
    { x: 160, y: 80 },
  ]];
  net.route = net.branches[0].map((point) => ({ ...point }));

  c._reanchorWireArrowheads(net, before, net.paths(), savedStyles);

  assert.equal(net.wireStyles['0:1'].arrowhead, 'none');
  assert.equal(net.wireStyles['0:2'].arrowhead, 'end');
  assert.equal(Object.keys(net.wireStyles).includes('0:3'), false, 'the removed segment has no stale style');
});

test('wirePointTo preserves an explicit target path at a same-net crossing', () => {
  const c = new Circuit();
  const net = c.createWireNet({
    preserveEmpty: true,
    branches: [
      [{ x: 0, y: 0 }, { x: 160, y: 0 }],
      [{ x: 80, y: -80 }, { x: 80, y: 80 }],
    ],
  });
  c.wirePointTo(
    { x: 0, y: 0 }, { x: 80, y: 0 }, [], net.id,
    { target: { netId: net.id, pathIndex: 1, segmentIndex: 1, point: { x: 80, y: 0 } } },
  );
  assert.ok(net.branches.length > 2, 'explicit join materializes the crossing topology');
  assert.deepEqual(net.junctions, [{ x: 80, y: 0 }]);
});

test('wireTo materializes an explicit same-net crossing join', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: -160 });
  const net = c.createWireNet({
    preserveEmpty: true,
    branches: [
      [{ x: 0, y: 0 }, { x: 160, y: 0 }],
      [{ x: 80, y: -80 }, { x: 80, y: 80 }],
    ],
  });
  net.terminals.push({ comp: 'R1', term: 'a' });
  c.wireTo(
    'R1.a', { x: 80, y: 0 }, [],
    { target: { netId: net.id, pathIndex: 1, segmentIndex: 1, point: { x: 80, y: 0 } } },
  );
  assert.ok(net.branches.length > 2, 'the target crossing is split into an explicit join');
  assert.deepEqual(net.junctions, [{ x: 80, y: 0 }]);
});

test('wiring the same two terminals repeatedly keeps exactly one wire', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 }); // b at (160,0)
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 }); // a at (400,0)
  c.wireTo('R1.b', { x: 400, y: 0 });
  for (let i = 0; i < 5; i++) c.wireTo('R1.b', { x: 400, y: 0 });
  const n = [...c.nets.values()][0];
  assert.equal(n.terminals.length, 2, 'both terminals stay in the net');
  assert.equal(n.branches.length, 1, 'no parallel wires accumulate');
  assert.deepEqual(n.branches[0], [{ x: 160, y: 0 }, { x: 400, y: 0 }], 'cheapest path survives');
  assert.deepEqual(n.junctions, [], 'terminal points are not mislabelled as junctions');
  const dots = [...c.components.values()].filter((x) => x.type === 'solder');
  assert.equal(dots.length, 0, 'no spurious solder dots');
});

test('re-wiring an existing T-junction does not create a loop', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 360, y: -200 });
  c.wireTo('R1.b', { x: 400, y: 0 });
  c.wireTo('R3.b', { x: 280, y: 0 }); // T-join mid-wire
  c.wireTo('R3.b', { x: 280, y: 0 }); // duplicate join
  const n = [...c.nets.values()][0];
  assert.equal(n.terminals.length, 3);
  assert.equal(n.branches.length, 3, 'the T stays a tree: two bus halves + the stem');
  assert.deepEqual(n.junctions, [{ x: 280, y: 0 }]);
  const dots = [...c.components.values()].filter((x) => x.type === 'solder');
  assert.equal(dots.length, 1, 'one junction, one dot');
});

test('a committed detour is preserved when the same endpoints are re-wired', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.wireTo('R1.b', { x: 400, y: 0 });
  const straight = [{ x: 160, y: 0 }, { x: 400, y: 0 }];
  c.wireTo('R1.b', { x: 400, y: 0 }, [{ x: 160, y: 160 }, { x: 400, y: 160 }]);
  const n = [...c.nets.values()][0];
  assert.equal(n.branches.length, 2, 'the existing route and new branch both remain');
  assert.deepEqual(n.branches[0], straight, 'the committed route is unchanged');
  assert.deepEqual(n.branches[1], [
    { x: 160, y: 0 },
    { x: 160, y: 160 },
    { x: 400, y: 160 },
    { x: 400, y: 0 },
  ], 'the explicitly requested detour is committed as a second branch');
});

test('a wire run dragged onto a same-net wire merges on commit (no hidden overlap)', async () => {
  // Move the stem's horizontal run onto the bus, then commit the edit path.
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 360, y: -200 });
  c.wireTo('R1.b', { x: 400, y: 0 });       // bus (160,0)-(400,0)
  c.wireTo('R3.b', { x: 280, y: 0 });       // T stem via (280,-120)
  const n = [...c.nets.values()][0];
  const stem = n.branches.find((b) => b.some((p) => p.x === 280 && p.y === -120) && b[0].y !== 0);
  const bi = n.branches.indexOf(stem);
  // Drag the stem's horizontal run (x 280..440 at y=-120) down onto the bus row y=0.
  const { moveWireRun } = await import('../src/core/wireedit.js');
  const run = stem.map((p) => ({ ...p }));
  moveWireRun(run, 'h', -120, 0);
  n.branches[bi] = run;
  c.rerouteNet(n);
  c._reduceNet(n);
  // The bus is drawn once; every terminal stays connected; nothing overlaps.
  const terminals = n.terminals.map((t) => c.netOfTerminal(`${t.comp}.${t.term}`));
  assert.ok(terminals.every((net) => net === n), 'all terminals stay on the net');
  const segs = [];
  for (const b of n.branches) for (let i = 1; i < b.length; i++) segs.push([b[i - 1], b[i]]);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const [a, b] = segs[i];
      const [c2, d] = segs[j];
      const overlap = (a.x === b.x && c2.x === d.x && a.x === c2.x)
        ? Math.max(Math.min(a.y, b.y), Math.min(c2.y, d.y)) < Math.min(Math.max(a.y, b.y), Math.max(c2.y, d.y))
        : (a.y === b.y && c2.y === d.y && a.y === c2.y)
          ? Math.max(Math.min(a.x, b.x), Math.min(c2.x, d.x)) < Math.min(Math.max(a.x, b.x), Math.max(c2.x, d.x))
          : false;
      assert.ok(!overlap, `no collinear overlap after commit (${i} vs ${j})`);
    }
  }
  assert.ok(n.branches.length >= 2, 'bus + stem stub survive the merge');
});

test('connecting three terminals routes one centered Steiner junction with one solder dot', () => {
  const c = new Circuit();
  // R1.a(0,0) R2.a(400,0) R3.a(200,200): the RSMT junction lands at the
  // coordinate median, pushed clear of the resistor bodies by one cell.
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 280, y: 200 });
  const net = c.connect('R1.a', 'R2.a', 'R3.a');
  assert.ok(net.branches && net.branches.length >= 3, 'three-way net becomes a multi-branch tree');
  assert.equal(net.junctions.length, 1, 'exactly one junction for a Y');
  // Every terminal is a branch endpoint; the whole tree is orthogonal.
  const endpoints = net.branches.flatMap((b) => [b[0], b[b.length - 1]]);
  for (const t of net.terminals) {
    const p = c.getComponent(t.comp).terminalWorld(t.term);
    assert.ok(endpoints.some((q) => q.x === p.x && q.y === p.y), `${t.comp}.${t.term} is a branch endpoint`);
  }
  for (const b of net.branches) for (let i = 1; i < b.length; i++) {
    assert.ok(b[i].x === b[i - 1].x || b[i].y === b[i - 1].y, `orthogonal branch: ${JSON.stringify(b)}`);
  }
  const dots = [...c.components.values()].filter((x) => x.type === 'solder');
  assert.equal(dots.length, 1, 'one junction, one dot');
  assert.deepEqual(dots[0].transform, { x: net.junctions[0].x, y: net.junctions[0].y, rotation: 0, mirrorX: false, mirrorY: false }, 'dot sits on the junction');
});

test('editor wire-mode chaining appends a branch without refreshing the existing route', () => {
  // CMOS inverter input net, routed exactly like the editor's wire clicks:
  // wireTo(VIN.p, M2.g) then wireTo(VIN.p, M1.g). The first committed branch
  // remains unchanged; the second click adds one smart-routed branch.
  const c = new Circuit();
  c.addComponent('input', { refdes: 'VIN', x: -120, y: 0 }); // p at (-120,0)
  c.addComponent('pmos', { refdes: 'M2', x: 320, y: -120, mirrorY: true }); // g at (200,-120)
  c.addComponent('nmos', { refdes: 'M1', x: 320, y: 120 }); // g at (200,120)
  const g2 = c.getComponent('M2').terminalWorld('g');
  const g1 = c.getComponent('M1').terminalWorld('g');
  c.wireTo('VIN.p', g2);
  const first = [...c.nets.values()][0].paths()[0];
  const net = c.wireTo('VIN.p', g1);
  assert.equal(net.terminals.length, 3);
  assert.equal(net.length(), 880, `append-only route length (got ${net.length()})`);
  assert.equal(net.branches.length, 2, 'the existing branch and new gate leg remain');
  assert.deepEqual(net.branches[0], first, 'the first committed route is unchanged');
  assert.deepEqual(net.junctions, [{ x: -80, y: 0 }], 'the only new junction is on the shared trunk');
  const flat = net.branches.map((b) => JSON.stringify(b)).join('\n');
  assert.ok(flat.includes('[{"x":-120,"y":0},{"x":-80,"y":0},{"x":-80,"y":-120},{"x":200,"y":-120}]'), `pmos leg remains:\n${flat}`);
  assert.ok(flat.includes('[{"x":-120,"y":0},{"x":-80,"y":0},{"x":-80,"y":120},{"x":200,"y":120}]'), `nmos leg remains:\n${flat}`);
  const dots = [...c.components.values()].filter((x) => x.type === 'solder');
  assert.equal(dots.length, 1, 'one junction, one dot');
  assert.deepEqual(dots[0].transform, { x: -80, y: 0, rotation: 0, mirrorX: false, mirrorY: false }, 'dot on the new junction');
  assert.ok(!dots.some((d) => d.transform.x === -120 && d.transform.y === 0), 'no dot on the VIN port terminal');
});

test('connect four terminals finds the length-optimal tree (shorter than any chain)', () => {
  const c = new Circuit();
  // 400x200 rectangle corners as resistor terminals. Open-space RSMT is 800;
  // honoring one-cell body clearance the optimum is 960. A naive sequential
  // chain is 2280, so the DP must find the near-optimal tree.
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 }); // a=(0,0)
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 }); // a=(400,0)
  c.addComponent('resistor', { refdes: 'R3', x: 80, y: 200 }); // a=(0,200)
  c.addComponent('resistor', { refdes: 'R4', x: 480, y: 200 }); // a=(400,200)
  const net = c.connect('R1.a', 'R2.a', 'R3.a', 'R4.a');
  assert.ok(net.length() <= 960, `net length minimized (got ${net.length()})`);
  assert.ok(net.length() < 1200, `not a perimeter chain (got ${net.length()})`);
  assert.ok(net.junctions.length <= 2, `sparse junctions (got ${net.junctions.length})`);
  const endpoints = net.branches.flatMap((b) => [b[0], b[b.length - 1]]);
  for (const t of net.terminals) {
    const p = c.getComponent(t.comp).terminalWorld(t.term);
    assert.ok(endpoints.some((q) => q.x === p.x && q.y === p.y), `${t.comp}.${t.term} reachable`);
  }
});

test('deleteWireSegments cuts several segments of one branch at once', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 }); // b=(160,0)
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 }); // a=(400,0)
  const net = c.connect('R1.b', 'R2.a');
  // Replace the single straight wire with a winding single branch.
  net.branches = [[{ x: 160, y: 0 }, { x: 160, y: -80 }, { x: 280, y: -80 }, { x: 280, y: 0 }, { x: 400, y: 0 }]];
  net.route = net.branches[0].map((p) => ({ ...p }));
  // Cut the vertical legs (segments 1 and 3): R1.b loses its wire and detaches;
  // R2.a keeps the right stub as its only branch.
  c.deleteWireSegments(net.id, [{ branch: 0, segment: 1 }, { branch: 0, segment: 3 }]);
  assert.ok(c.netOfTerminal('R1.b') !== c.netOfTerminal('R2.a'), 'terminals split apart');
  const r2net = c.netOfTerminal('R2.a');
  assert.deepEqual(r2net.branches, [
    [{ x: 280, y: 0 }, { x: 400, y: 0 }],
  ]);
});

test('deleteWireSegments removes selected segments across different nets in one call', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 }); // b=(160,0)
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 }); // a=(400,0)
  c.addComponent('resistor', { refdes: 'R3', x: 80, y: 160 }); // b=(160,160)
  c.addComponent('resistor', { refdes: 'R4', x: 480, y: 160 }); // a=(400,160)
  const n1 = c.connect('R1.b', 'R2.a');
  const n2 = c.connect('R3.b', 'R4.a');
  // Both nets are single straight branches; delete segment 1 of each.
  c.deleteWireSegments(n1.id, [{ branch: 0, segment: 1 }]);
  c.deleteWireSegments(n2.id, [{ branch: 0, segment: 1 }]);
  assert.equal(c.netOfTerminal('R1.b'), c.netOfTerminal('R2.a'), 'top net still one component');
  assert.equal(c.netOfTerminal('R3.b'), c.netOfTerminal('R4.a'), 'bottom net still one component');
});

test('diff-pair virtual-ground net routes sources down with the T one cell clear (520u)', () => {
  // The balanced Steiner route for a diff-pair tail net must continue in the
  // source pins' terminal direction (DOWN) and keep the trunk one grid cell
  // clear of the bodies — not a shorter pin-row trunk at y=0.
  const c = new Circuit();
  c.addComponent('nmos', { refdes: 'M1', x: 40, y: -80 }); // s at (40,0)
  c.addComponent('nmos', { refdes: 'M2', x: 440, y: -80, mirrorX: true }); // s at (440,0)
  c.addComponent('nmos', { refdes: 'M3', x: 240, y: 160 }); // d at (240,80)
  const net = c.connect('M1.s', 'M2.s', 'M3.d');
  assert.equal(net.length(), 520, `conforming tail net length (got ${net.length()})`);
  assert.deepEqual(net.junctions, [{ x: 240, y: 40 }], 'T junction one cell below the source row');
  const flat = JSON.stringify(net.branches);
  assert.ok(flat.includes('[{"x":40,"y":0},{"x":40,"y":40}'), 'M1 source escapes DOWN');
  assert.ok(flat.includes('[{"x":440,"y":0},{"x":440,"y":40}'), 'M2 source escapes DOWN');
  // Every non-pin segment keeps one full cell of clearance from every body.
  const env = c._netEnv(net.id);
  const pins = new Set(net.terminalWorlds().map((p) => `${p.x},${p.y}`));
  for (const b of net.branches) {
    for (let i = 1; i < b.length; i++) {
      const a = b[i - 1], q = b[i];
      for (const r of env.rects) {
        const segDist = (() => {
          const x0 = Math.min(a.x, q.x), x1 = Math.max(a.x, q.x);
          const y0 = Math.min(a.y, q.y), y1 = Math.max(a.y, q.y);
          const dx = x0 > r.x + r.w ? x0 - (r.x + r.w) : x1 < r.x ? r.x - x1 : 0;
          const dy = y0 > r.y + r.h ? y0 - (r.y + r.h) : y1 < r.y ? r.y - y1 : 0;
          return Math.hypot(dx, dy);
        })();
        const aPin = pins.has(`${a.x},${a.y}`) && ((a.x === r.x || a.x === r.x + r.w) && a.y >= r.y && a.y <= r.y + r.h || (a.y === r.y || a.y === r.y + r.h) && a.x >= r.x && a.x <= r.x + r.w);
        const bPin = pins.has(`${q.x},${q.y}`) && ((q.x === r.x || q.x === r.x + r.w) && q.y >= r.y && q.y <= r.y + r.h || (q.y === r.y || q.y === r.y + r.h) && q.x >= r.x && q.x <= r.x + r.w);
        if (segDist < 40 && !aPin && !bPin) {
          assert.fail(`segment ${JSON.stringify(a)}-${JSON.stringify(q)} within 1 cell of bbox ${JSON.stringify(r)}`);
        }
      }
    }
  }
});

test('partial mirror re-routes only the changed terminal leg of a managed net', () => {
  const c = new Circuit();
  c.addComponent('nmos', { refdes: 'M2', x: 40, y: -80, mirrorX: false, mirrorY: false });
  c.addComponent('nmos', { refdes: 'M3', x: 440, y: -80, mirrorX: true, mirrorY: false });
  c.addComponent('nmos', { refdes: 'M1', x: 240, y: 160, mirrorX: false, mirrorY: false });
  const net = c.connect('M2.s', 'M3.s', 'M1.d');
  const untouched = net.paths().slice(1).map((path) => path.map((point) => ({ ...point })));
  const junction = net.junctions.map((point) => ({ ...point }));
  const m2 = c.getComponent('M2');
  const before = new Map(m2.worldTerminals().map((terminal) => [terminal.name, { x: terminal.x, y: terminal.y }]));

  c.setTransform('M2', { mirrorY: true });
  const terminals = new Map(m2.worldTerminals().map((terminal) => [terminal.name, {
    before: before.get(terminal.name),
    after: { x: terminal.x, y: terminal.y },
  }]));
  assert.equal(c.rerouteNet(net, new Map([['M2', { dx: 0, dy: 0, terminals }]])), true);

  assert.deepEqual(net.paths().slice(1), untouched, 'the M3/M1 side remains byte-for-byte stable');
  assert.deepEqual(net.junctions, junction, 'the existing solder junction stays put');
  assert.deepEqual(net.paths()[0][0], m2.terminalWorld('s'), 'the moved source is re-anchored');
  assert.ok(net.paths()[0].some((point) => point.y < -160), 'the moved leg escapes above the flipped device');
  assert.equal(net.wiringErrors().length, 0);

  const flippedPaths = net.paths();
  const flippedJunctions = net.junctions.map((point) => ({ ...point }));
  const beforeReturn = new Map(m2.worldTerminals().map((terminal) => [terminal.name, { x: terminal.x, y: terminal.y }]));
  c.setTransform('M2', { mirrorY: false });
  const returnTerminals = new Map(m2.worldTerminals().map((terminal) => [terminal.name, {
    before: beforeReturn.get(terminal.name),
    after: { x: terminal.x, y: terminal.y },
  }]));
  assert.equal(c.rerouteNet(net, new Map([['M2', { dx: 0, dy: 0, terminals: returnTerminals }]])), true);

  assert.deepEqual(net.paths().slice(1), flippedPaths.slice(1), 'returning the mirror keeps the untouched side stable');
  assert.deepEqual(net.paths()[0], [
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 240, y: 40 },
  ], 'returning the mirror simplifies the changed branch to the minimum-bend route');
  assert.deepEqual(net.junctions, junction, 'returning the mirror removes stale junctions');
  assert.equal(net.wiringErrors().length, 0);
});

test('three-terminal autorouting is order-independent for a symmetric tail net', () => {
  const edges = [
    ['M1.d', 'M2.s'],
    ['M1.d', 'M3.s'],
    ['M2.s', 'M3.s'],
  ];
  const make = () => {
    const c = new Circuit();
    c.addComponent('nmos', { refdes: 'M2', x: 40, y: -80, mirrorX: false, mirrorY: false });
    c.addComponent('nmos', { refdes: 'M3', x: 440, y: -80, mirrorX: true, mirrorY: false });
    c.addComponent('nmos', { refdes: 'M1', x: 240, y: 160, mirrorX: false, mirrorY: false });
    return c;
  };
  const pointOf = (c, ref) => {
    const [comp, term] = ref.split('.');
    return c.getComponent(comp).terminalWorld(term);
  };
  const canonical = (net) => {
    const paths = net.paths().map((path) => {
      const points = [path[0]];
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        for (const junction of net.junctions) {
          const onSegment = a.x === b.x
            ? junction.x === a.x && junction.y > Math.min(a.y, b.y) && junction.y < Math.max(a.y, b.y)
            : junction.y === a.y && junction.x > Math.min(a.x, b.x) && junction.x < Math.max(a.x, b.x);
          if (onSegment) points.push({ ...junction });
        }
        points.push(b);
      }
      return points;
    }).flatMap((path) => path.slice(1).map((point, i) => [path[i], point]));
    const segments = new Set(paths.map(([a, b]) => {
      const left = `${a.x},${a.y}`;
      const right = `${b.x},${b.y}`;
      return left < right ? `${left}-${right}` : `${right}-${left}`;
    }));
    return JSON.stringify([...segments].sort());
  };
  const results = new Set();
  for (const first of edges) for (const second of edges) {
    if (first === second) continue;
    const c = make();
    let net;
    assert.doesNotThrow(() => {
      net = c.wireTo(first[0], pointOf(c, first[1]));
      net = c.wireTo(second[0], pointOf(c, second[1]));
    }, `${first.join(' -> ')} then ${second.join(' -> ')}`);
    results.add(canonical(net));
  }
  assert.equal(results.size, 1, 'all symmetric connection orders produce the same tree');
});

test('a set move carries its wires (no stale endpoints, no floating stubs)', () => {
  // Two components wired together, both moved by the same delta (a Ctrl+A
  // style multi-select drag): the wire must translate with the set.
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { refdes: 'M1', x: 320, y: 120 });
  const m2 = c.addComponent('nmos', { refdes: 'M2', x: 560, y: 120 });
  const net = c.connect('M1.g', 'M2.g');
  const moved = new Map([
    ['M1', { dx: 160, dy: 0 }],
    ['M2', { dx: 160, dy: 0 }],
  ]);
  c.moveComponent('M1', 480, 120);
  c.moveComponent('M2', 720, 120);
  c.rerouteNet(net, moved);
  const pts = net.points();
  const terms = new Set(net.terminals.map((t) => {
    const p = c.getComponent(t.comp).terminalWorld(t.term);
    return `${p.x},${p.y}`;
  }));
  assert.deepEqual(pts[0], { x: 360, y: 120 }, 'start follows M1');
  assert.deepEqual(pts[pts.length - 1], { x: 600, y: 120 }, 'end follows M2');
  for (const p of [pts[0], pts[pts.length - 1]]) {
    assert.ok(terms.has(`${p.x},${p.y}`), 'no stale endpoint left behind');
  }
  assert.equal(net.wiringErrors().length, 0);
});

test('complete same-delta managed-net move translates branches, route, and junctions exactly', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 360, y: 400 });
  const net = c.connect('R1.b', 'R2.a', 'R3.a');
  net.branches = [
    [{ x: 160, y: 0 }, { x: 160, y: 160 }, { x: 280, y: 160 }],
    [{ x: 400, y: 0 }, { x: 400, y: 160 }, { x: 280, y: 160 }],
    [{ x: 280, y: 400 }, { x: 280, y: 160 }],
  ];
  net.route = net.branches[0].map((p) => ({ ...p }));
  net.junctions = [{ x: 280, y: 160 }];
  c.renameNet(net, 'INTERNAL');
  const label = c.addNetLabel(net, { id: 'INTERNAL_LABEL', anchor: net.junctions[0] });
  const before = {
    branches: net.branches.map((path) => path.map((p) => ({ ...p }))),
    route: net.route.map((p) => ({ ...p })),
    junctions: net.junctions.map((p) => ({ ...p })),
  };
  const moved = new Map([
    ['R1', { dx: 80, dy: 80 }],
    ['R2', { dx: 80, dy: 80 }],
    ['R3', { dx: 80, dy: 80 }],
  ]);

  c.moveComponent('R1', 160, 80);
  c.moveComponent('R2', 560, 80);
  c.moveComponent('R3', 440, 480);
  assert.equal(c.rerouteNet(net, moved), true);

  const translate = (path) => path.map((p) => ({ x: p.x + 80, y: p.y + 80 }));
  assert.deepEqual(net.branches, before.branches.map(translate));
  assert.deepEqual(net.route, translate(before.route));
  assert.deepEqual(net.junctions, translate(before.junctions));
  assert.equal(c._netLabelAnchorOnPath(net, label.anchorWorld()), true);
});

test('partial same-delta set move carries internal branches while preserving the boundary side', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 480, y: 400 });
  const net = c.connect('R1.b', 'R2.a', 'R3.a');
  const internal = [
    { x: 160, y: 0 }, { x: 160, y: 80 },
    { x: 400, y: 80 }, { x: 400, y: 0 },
  ];
  const boundary = [{ x: 400, y: 0 }, { x: 400, y: 400 }];
  net.branches = [
    internal.map((p) => ({ ...p })),
    boundary.map((p) => ({ ...p })),
  ];
  net.route = net.branches[0].map((p) => ({ ...p }));
  net.junctions = [];

  c.moveComponent('R1', 80, 80);
  c.moveComponent('R2', 480, 80);
  assert.equal(c.rerouteNet(net, new Map([
    ['R1', { dx: 0, dy: 80 }],
    ['R2', { dx: 0, dy: 80 }],
  ])), true);

  assert.deepEqual(net.branches[0], internal.map((p) => ({ x: p.x, y: p.y + 80 })));
  assert.deepEqual(net.branches[1], [
    { x: 400, y: 80 },
    { x: 400, y: 400 },
  ], 'the unmoved endpoint and vertical boundary body stay fixed');
  assert.deepEqual(c.getComponent('R3').transform, {
    x: 480, y: 400, rotation: 0, mirrorX: false, mirrorY: false,
  });
});

test('partial set move rejects a translated branch that loses one-cell clearance to an unmoved body', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 280, y: 120 });
  const net = c.connect('R1.b', 'R2.a', 'R3.a');
  const originalBranches = [
    [{ x: 160, y: 0 }, { x: 400, y: 0 }],
    [{ x: 400, y: 0 }, { x: 400, y: 40 }, { x: 200, y: 40 }, { x: 200, y: 120 }],
  ];
  net.branches = originalBranches.map((path) => path.map((p) => ({ ...p })));
  net.route = net.branches[0].map((p) => ({ ...p }));
  net.junctions = [];

  // The translated branch lands exactly on R3's top body edge: it no longer
  // drills the strict interior, but it has lost the automatic one-cell margin.
  c.moveComponent('R1', 80, 80);
  c.moveComponent('R2', 480, 80);
  assert.equal(c.rerouteNet(net, new Map([
    ['R1', { dx: 0, dy: 80 }],
    ['R2', { dx: 0, dy: 80 }],
  ])), false);
  assert.deepEqual(c.getComponent('R1').transform, {
    x: 80, y: 0, rotation: 0, mirrorX: false, mirrorY: false,
  });
  assert.deepEqual(c.getComponent('R2').transform, {
    x: 480, y: 0, rotation: 0, mirrorX: false, mirrorY: false,
  });
  assert.deepEqual(net.branches, originalBranches);
});

test('a fresh layout avoids collinearly overlapping another net wire', () => {
  const c = new Circuit();
  // Net 1: straight wire (160,0)-(400,0).
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  const n1 = c.connect('R1.b', 'R2.a');
  // Net 2 shares the same row: R3.a(160,0) and R4.a(400,0) would want a
  // straight run on the same line — the fresh layout must route around it
  // instead of piling on top of net 1's wire.
  c.addComponent('resistor', { refdes: 'R3', x: 240, y: -160 });
  c.addComponent('resistor', { refdes: 'R4', x: 480, y: -160 });
  const n2 = c.connect('R3.a', 'R4.a');
  c.rerouteNet(n2, 'refresh');
  // No collinear overlap between the two nets' drawn segments.
  const segs = (paths) => paths.flatMap((b, bi) => b.slice(1).map((q, i) => ({ a: b[i], b: q, bi })));
  const s1 = segs(n1.paths());
  const s2 = segs(n2.paths());
  const overlap = (a, b, c2, d) => {
    if (a.x === b.x && c2.x === d.x && a.x === c2.x) {
      return Math.max(Math.min(a.y, b.y), Math.min(c2.y, d.y)) < Math.min(Math.max(a.y, b.y), Math.max(c2.y, d.y));
    }
    if (a.y === b.y && c2.y === d.y && a.y === c2.y) {
      return Math.max(Math.min(a.x, b.x), Math.min(c2.x, d.x)) < Math.min(Math.max(a.x, b.x), Math.max(c2.x, d.x));
    }
    return false;
  };
  for (const x of s1) for (const y of s2) {
    assert.ok(!overlap(x.a, x.b, y.a, y.b), 'nets never share a collinear span');
  }
});

test('dangling branches with free endpoints are pruned after a reroute', () => {
  const c = new Circuit();
  c.addComponent('nmos', { refdes: 'M1', x: 320, y: 120 });
  c.addComponent('nmos', { refdes: 'M2', x: 320, y: -120, mirrorY: true });
  const net = c.connect('M1.g', 'M2.g');
  // Materialize the auto route as branches, then inject a floating stub whose
  // endpoints lead nowhere (no terminal, no junction, no shared vertex).
  net.branches = [...(net.branches || [net.route])].map((b) => b.map((p) => ({ ...p })));
  net.branches.push([{ x: 200, y: 0 }, { x: 200, y: 200 }]);
  net.route = net.branches[0].map((p) => ({ ...p }));
  // A real component move triggers the dangling-branch prune.
  c.moveComponent('M1', 240, 120);
  c.rerouteNet(net, new Map([['M1', { dx: 40, dy: 0 }]]));
  const flat = JSON.stringify(net.paths());
  assert.ok(!flat.includes('{"x":200,"y":200}'), 'floating stub pruned');
  assert.equal(net.wiringErrors().length, 0);
});

test('moveDiagonalSegment moves a diagonal rigidly and reroutes the orthogonal wire on each side', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  const n = c.wireTo('R1.b', c.getComponent('R2').terminalWorld('a'), [{ x: 240, y: 80 }, { x: 320, y: 320 }], { routeStyle: 'diagonal' });
  const path = n.paths()[0];
  const segment = path.findIndex((p, i) => i > 0 && p.x !== path[i - 1].x && p.y !== path[i - 1].y);
  assert.equal(c.moveDiagonalSegment(n, 0, segment, { dx: 80, dy: -40 }), true);

  const [moved] = n.paths();
  assert.deepEqual(moved[0], { x: 160, y: 0 }, 'still starts at R1.b');
  assert.deepEqual(moved.at(-1), { x: 400, y: 400 }, 'still ends at R2.a');
  const diagonals = moved.slice(1).map((p, i) => [moved[i], p]).filter(([a, b]) => a.x !== b.x && a.y !== b.y);
  assert.deepEqual(diagonals, [[{ x: 320, y: 40 }, { x: 400, y: 280 }]], 'same angle and length, shifted by the delta');
  for (let i = 1; i < moved.length; i++) {
    for (const comp of c.components.values()) {
      if (comp.type !== 'solder') assert.equal(segThroughInterior(moved[i - 1], moved[i], comp.bboxWorld()), false);
    }
  }
  assert.equal(c.moveDiagonalSegment(n, 0, 1, { dx: 40, dy: 0 }), false, 'an orthogonal segment is not a diagonal move');
});

test('moveDiagonalSegment is atomic when the moved diagonal would drill a component', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  c.addComponent('resistor', { refdes: 'BLOCK', x: 360, y: 200 });
  const n = c.wireTo('R1.b', c.getComponent('R2').terminalWorld('a'), [{ x: 240, y: 80 }, { x: 240, y: 320 }], { routeStyle: 'orthogonal' });
  const d = c.wireDirectTo({ x: 160, y: 160 }, { x: 240, y: 240 });
  const before = JSON.stringify(c.toJSON());
  assert.equal(c.moveDiagonalSegment(d, 0, 1, { dx: 200, dy: 0 }), false);
  assert.equal(JSON.stringify(c.toJSON()), before);
  assert.ok(n);
});

test('an unnamed reference marker on a differently named net is a rail conflict', async () => {
  const { runCommand } = await import('../src/core/commands.js');
  const c = new Circuit();
  for (const line of ['add resistor R1 --at 0 0', 'add resistor R2 --at 400 0', 'connect R1.b R2.a --name OUT', 'add ground G1 --at 160 200', 'add supply P1 --at 800 -200', 'add resistor R3 --at 800 0']) runCommand(c, line);
  assert.deepEqual(referenceMarkerNameConflicts(c), []);

  runCommand(c, 'connect R1.b G1.gnd');
  const net = c.netOfTerminal({ comp: 'G1', term: 'gnd' });
  assert.equal(net.name, 'OUT');
  assert.deepEqual(referenceMarkerNameConflicts(c), [{ netId: net.id, refdes: 'G1', name: 'OUT', railName: 'VSS' }]);

  // Taking the rail name resolves it; the marker stays a global reference.
  c.renameNet(net, 'VSS');
  assert.deepEqual(referenceMarkerNameConflicts(c), []);
  assert.equal(c.labelOf('G1'), null);

  // An unnamed net simply takes the rail name, and a legacy alias is no conflict.
  runCommand(c, 'connect R3.b P1.p');
  assert.equal(c.netOfTerminal({ comp: 'P1', term: 'p' }).name, 'VDD');
  c.renameNet(net, 'GND');
  assert.deepEqual(referenceMarkerNameConflicts(c), []);
});
