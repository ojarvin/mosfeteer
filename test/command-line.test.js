import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { DOCUMENT_COMMANDS, EDITOR_COMMANDS, canonicalDocumentLine, commandCompletions, commandLineIntent, didYouMean, resolveEditorCommand, tabComplete } from '../src/web/command-line.js';

test('Tab completes a prefix, then Enter runs the editor command', () => {
  const step = tabComplete('sett');
  assert.equal(step.line, 'settings');
  assert.deepEqual(resolveEditorCommand(step.line), { name: 'settings', state: undefined });
});

test('synonyms complete to the canonical name and run as typed', () => {
  assert.equal(commandCompletions('pref')[0].name, 'settings');
  assert.equal(commandCompletions('pref')[0].via, 'preferences');
  assert.equal(commandCompletions('sidebar')[0].name, 'panel');
  assert.equal(resolveEditorCommand('preferences').name, 'settings');
  assert.equal(resolveEditorCommand(':drc').name, 'check');
});

test('Tab cycles through ranked candidates both ways', () => {
  const first = tabComplete('s');
  const names = first.session.candidates.map((entry) => entry.name);
  assert.equal(first.line, names[0]);
  const second = tabComplete(first.line, first.session);
  assert.equal(second.line, names[1]);
  assert.equal(tabComplete(second.line, second.session, -1).line, names[0]);
  assert.equal(tabComplete('s', null, -1).line, names.at(-1));
  assert.equal(tabComplete('zzzz'), null);
  // Only the command word completes.
  assert.equal(tabComplete('grid o'), null);
});

test('a single document completion leaves room for its arguments', () => {
  assert.equal(tabComplete('disc').line, 'disconnect ');
  assert.equal(tabComplete('supplyb').line, 'supplybar ');
});

test('toggles take on/off and friends; other arguments fall through to documents', () => {
  assert.deepEqual(resolveEditorCommand('grid off'), { name: 'grid', state: false });
  assert.deepEqual(resolveEditorCommand('panel show'), { name: 'panel', state: true });
  assert.deepEqual(resolveEditorCommand('analysis toggle'), { name: 'analysis', state: undefined });
  assert.deepEqual(resolveEditorCommand('theme light'), { name: 'dark', state: false });
  assert.deepEqual(resolveEditorCommand('light'), { name: 'dark', state: false });
  assert.deepEqual(resolveEditorCommand('page-guide ieee-2col'), { name: 'page-guide', state: 'ieee-2col' });
  assert.equal(resolveEditorCommand('page-guide a4'), null);
  assert.equal(resolveEditorCommand('find VOUT'), null);
  assert.equal(resolveEditorCommand('save out.json'), null);
  assert.equal(resolveEditorCommand('analyze transfer-function VOUT --input VIN'), null);
  assert.equal(resolveEditorCommand('beats list'), null);
  assert.equal(resolveEditorCommand('add resistor'), null);
  assert.equal(resolveEditorCommand(''), null);
});

test('document synonyms run as the command they name', () => {
  assert.equal(canonicalDocumentLine('delete R1'), 'rm R1');
  assert.equal(canonicalDocumentLine('ls'), 'list');
  assert.equal(canonicalDocumentLine(':connect R1.a R2.a'), 'connect R1.a R2.a');
  assert.equal(canonicalDocumentLine('frobnicate x'), 'frobnicate x');
});

test('an unknown word suggests near commands', () => {
  assert.match(didYouMean('setings'), /did you mean/);
  assert.equal(didYouMean('qqq'), '');
});

test('every word the command line offers is unique and dispatchable', () => {
  const words = [...EDITOR_COMMANDS, ...DOCUMENT_COMMANDS].flatMap((entry) => [entry.name, ...(entry.aliases || [])]);
  const editorWords = EDITOR_COMMANDS.flatMap((entry) => [entry.name, ...(entry.aliases || [])]);
  assert.equal(new Set(editorWords).size, editorWords.length);
  assert.equal(new Set(DOCUMENT_COMMANDS.flatMap((entry) => [entry.name, ...(entry.aliases || [])])).size,
    DOCUMENT_COMMANDS.flatMap((entry) => [entry.name, ...(entry.aliases || [])]).length);
  assert.ok(words.every((word) => word === word.toLowerCase() && !/\s/.test(word)));
  for (const entry of DOCUMENT_COMMANDS) {
    try {
      runCommand(new Circuit(), entry.name);
    } catch (err) {
      assert.doesNotMatch(String(err.message), /unknown command/, entry.name);
    }
  }
});

test('the document catalog covers every command the language dispatches', () => {
  const source = readFileSync(new URL('../src/core/commands.js', import.meta.url), 'utf8');
  const dispatched = new Set([...source.matchAll(/cmd === '([a-z_-]+)'/g)].map((match) => match[1]));
  const offered = new Set([...EDITOR_COMMANDS, ...DOCUMENT_COMMANDS].flatMap((entry) => [entry.name, ...(entry.aliases || [])]));
  const missing = [...dispatched].filter((cmd) => !offered.has(cmd) && !['wire', 'net_label'].includes(cmd));
  assert.deepEqual(missing, []);
});

test('every editor command has an action in the command-line UI', () => {
  const ui = readFileSync(new URL('../src/web/command-line-ui.js', import.meta.url), 'utf8');
  const actions = ui.slice(ui.indexOf('const ACTIONS = {'), ui.indexOf('\n};', ui.indexOf('const ACTIONS = {')));
  for (const { name } of EDITOR_COMMANDS) {
    assert.match(actions, new RegExp(`\\n  (${name}|'${name}'):`), name);
  }
});

test('a typo completes to its nearest command when nothing else matches', () => {
  assert.equal(tabComplete('setings').line, 'settings');
  assert.equal(commandCompletions('crosshiar')[0].name, 'crosshair');
  // A real prefix match never gives way to near misses.
  assert.ok(commandCompletions('gri').every((entry) => entry.name === 'grid'));
});

test('several words search what commands do', () => {
  assert.equal(commandCompletions('mirror hor')[0].name, 'mirror-horizontal');
  assert.equal(commandCompletions('beats phase')[0].name, 'phase-beats');
  assert.equal(commandCompletions('change type')[0].name, 'swap');
  // One word found only in a description is still found, after every name.
  assert.equal(commandCompletions('clockwise')[0].name, 'rotate');
  assert.equal(commandCompletions('rot')[0].name, 'rotate');
});

test('canvas actions run bare; with arguments their document command runs', () => {
  assert.deepEqual(resolveEditorCommand('rotate'), { name: 'rotate', state: undefined });
  assert.equal(resolveEditorCommand('rotate R1 180'), null);
  assert.equal(resolveEditorCommand('swap M1 pmos'), null);
  assert.equal(resolveEditorCommand('delete R1'), null);
  assert.equal(canonicalDocumentLine('delete R1'), 'rm R1');
  // align needs its side.
  assert.equal(resolveEditorCommand('align'), null);
  assert.deepEqual(resolveEditorCommand('align left'), { name: 'align', state: 'left' });
  for (const entry of EDITOR_COMMANDS.filter((command) => command.canvas)) assert.ok(/\(/.test(entry.help), `${entry.name} names its key`);
});

test('Enter runs an exact line, else the highlighted match, else fills in arguments', () => {
  assert.deepEqual(commandLineIntent('grid off'), { run: 'grid off' });
  assert.deepEqual(commandLineIntent('move R1 40 40'), { run: 'move R1 40 40' });
  assert.deepEqual(commandLineIntent('mirror hor'), { run: 'mirror-horizontal' });
  assert.deepEqual(commandLineIntent('rot'), { run: 'rotate' });
  // The second match when it is the one highlighted.
  assert.deepEqual(commandLineIntent('mirror-', 1), { run: commandCompletions('mirror-')[1].name });
  // A command's own words never hand its line to something else.
  assert.deepEqual(commandLineIntent('explain eval'), { run: 'explain eval' });
  assert.deepEqual(commandLineIntent('find VOUT'), { run: 'find VOUT' });
  // A document command or a choice needs its arguments first.
  assert.deepEqual(commandLineIntent('discon'), { fill: 'disconnect ' });
  assert.deepEqual(commandLineIntent('align'), { fill: 'align ' });
  assert.deepEqual(commandLineIntent('alig', 1), { fill: 'align ' });
  // Nothing matches: the line runs as typed, for its error and "did you mean".
  assert.deepEqual(commandLineIntent('zzzz'), { run: 'zzzz' });
});
