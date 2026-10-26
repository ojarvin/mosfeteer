import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { loadDocument, relinkDocumentState } from '../src/core/document.js';
import { designIndex, searchDesign } from '../src/core/design-index.js';
import { findMentions, mentionToken, noteDesignLinks, normalizeNotes, noteCompletion, notesMarkdown, relinkNotes, renameMentions, resolveMention } from '../src/core/notes.js';
import { renderNotes } from '../src/core/notes-markdown.js';

const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));

function amp() {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at 0 240', 'add pmos M2 --at 0 0', 'connect M1.d M2.d --name V_{out}');
  return circuit;
}

test('mentions read bare, subscripted, and braced names, but not addresses', () => {
  const found = findMentions('@V_{out} and @X2_stage_opamp, mail a@b.c, @M1. @{tail bias} @V_out^{2}');
  assert.deepEqual(found.map((m) => m.name), ['V_{out}', 'X2_stage_opamp', 'M1', 'tail bias', 'V_out^{2}']);
  assert.equal(mentionToken('M1'), '@M1');
  assert.equal(mentionToken('tail bias'), '@{tail bias}');
});

test('a mention finds a part first, then nets by name through markup', () => {
  const circuit = amp();
  assert.deepEqual(resolveMention(circuit, 'M1'), { kind: 'component', refdes: 'M1' });
  const net = resolveMention(circuit, 'vout');
  assert.equal(net.kind, 'net');
  assert.equal(net.name, 'V_{out}');
  assert.equal(net.ids.length, 1);
  assert.equal(resolveMention(circuit, 'M9'), null);
});

test('renaming a part rewrites its mentions, not mentions in code or of other parts', () => {
  assert.equal(renameMentions('@M1 sets @M10, `@M1` stays, @M_{1} too', 'M1', 'M7'), '@M7 sets @M10, `@M1` stays, @M7 too');
  assert.equal(renameMentions('```\n@M1\n```\n@M1', 'M1', 'M2'), '```\n@M1\n```\n@M2');
  const circuit = amp();
  circuit.notes = 'Size @M1 for gm; mirror @M2.';
  runCommand(circuit, 'rename M1 Min');
  assert.equal(circuit.notes, 'Size @Min for gm; mirror @M2.');
});

test('renaming a net rewrites its mentions once no other net keeps the name', () => {
  const circuit = amp();
  circuit.notes = 'Swing at @V_{out}.';
  const net = [...circuit.nets.values()].find((candidate) => candidate.name === 'V_{out}');
  circuit.renameNet(net, 'V_{o}');
  assert.equal(circuit.notes, 'Swing at @V_{o}.');

  // Two nets of one name: renaming one alone leaves the mention to the other.
  const twin = new Circuit();
  run(twin, 'add resistor R1 --at 0 0', 'add resistor R2 --at 400 0', 'connect R1.a R1.b --name X', 'connect R2.a R2.b --name X');
  twin.notes = '@X';
  const [first] = [...twin.nets.values()].filter((candidate) => candidate.name === 'X');
  twin.renameNet(first, 'Y');
  assert.equal(twin.notes, '@X');
  twin.renameNetGroup([...twin.nets.values()].find((candidate) => candidate.name === 'X'), 'Y');
  assert.equal(twin.notes, '@Y');
});

test('notes are saved with the design, normalized, and left out when empty', () => {
  const circuit = amp();
  assert.equal('notes' in circuit.toJSON(), false);
  circuit.notes = normalizeNotes('line one\r\nline two');
  const loaded = loadDocument(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.equal(loaded.notes, 'line one\nline two');
  assert.equal(normalizeNotes('   \n '), '');
  assert.equal(normalizeNotes(42), '');
});

test('design links in notes are listed and follow a renamed design', () => {
  assert.deepEqual(noteDesignLinks('see [[amp]], [[bias]] and [[amp]]'), ['amp', 'bias']);
  assert.deepEqual(relinkNotes('[[amp]] [[AMP]] [[ampx]]', 'amp', 'ota'), { text: '[[ota]] [[ota]] [[ampx]]', count: 2 });
  const state = { ...amp().toJSON(), notes: 'from [[amp]]' };
  assert.equal(relinkDocumentState(state, 'amp', 'ota'), 1);
  assert.equal(state.notes, 'from [[ota]]');
});

test('the Atlas search finds a design by its notes', () => {
  const circuit = amp();
  circuit.notes = 'Chosen for low flicker noise';
  const index = designIndex(circuit);
  assert.ok(searchDesign(index, 'amp', 'flicker'));
  assert.ok(searchDesign(index, 'amp', 'flicker M1'));
  assert.equal(searchDesign(index, 'amp', 'thermal'), null);
});

test('the design index lists the designs the notes link to', () => {
  const circuit = amp();
  assert.equal('noteLinks' in designIndex(circuit), false);
  circuit.notes = 'Biased by [[bias-gen]], see [[bias-gen]] and [[ota]]';
  assert.deepEqual(designIndex(circuit).noteLinks, ['bias-gen', 'ota']);
});

test('rendered notes escape HTML and keep only safe links', () => {
  const html = renderNotes('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](https://example.com) **b** *i*');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes('<a href="https://example.com" target="_blank" rel="noopener noreferrer">ok</a>'));
  assert.ok(html.includes('<strong>b</strong>') && html.includes('<em>i</em>'));
});

test('rendered notes: blocks, math, mentions, and design links', () => {
  const context = { mention: (name) => (name === 'M1' ? { kind: 'component' } : null), design: (name) => name === 'amp' };
  const html = renderNotes([
    '# Bias',
    'Gain $g_m r_o$ from @M1, not @M9; see [[amp]] and [[gone]].',
    '',
    '- [ ] check @M1',
    '- [x] done',
    '',
    '1. one',
    '2. two',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '```',
    '@M1 <b>',
    '```',
    '$$',
    '\\frac{1}{2}',
    '$$',
    '> quoted',
    '---',
  ].join('\n'), context);
  assert.match(html, /<h3>Bias<\/h3>/);
  assert.match(html, /<math [^>]*display="inline"/);
  assert.match(html, /class="note-mention note-mention-component" data-mention="M1"/);
  assert.match(html, /class="note-mention note-mention-missing" data-mention="M9"/);
  assert.match(html, /class="note-design" data-design="amp"/);
  assert.match(html, /class="note-design broken" data-design="gone"/);
  assert.match(html, /<li class="note-task">/);
  assert.match(html, /<li class="note-task done">/);
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(html, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<pre><code>@M1 &lt;b&gt;<\/code><\/pre>/);
  assert.match(html, /<div class="note-display-math"><math [^>]*display="block"/);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
});

test('notes command: print, set, append, clear, and a usage error', () => {
  const circuit = amp();
  assert.equal(runCommand(circuit, 'notes').text, '(no notes)');
  const set = runCommand(circuit, 'notes set Bias: $V_{ov} \\neq 0$ -- "keep" @M1');
  assert.equal(set.mutated, true);
  assert.equal(circuit.notes, 'Bias: $V_{ov} \\neq 0$ -- "keep" @M1');
  runCommand(circuit, 'notes append "- second line"');
  assert.equal(circuit.notes, 'Bias: $V_{ov} \\neq 0$ -- "keep" @M1\n- second line');
  assert.equal(runCommand(circuit, 'notes').text, circuit.notes);
  assert.equal(runCommand(circuit, 'notes clear').mutated, true);
  assert.equal(circuit.notes, '');
  assert.throws(() => runCommand(circuit, 'notes bogus'), /usage: notes/);
});

test('the notes as plain Markdown: mentions and design links as their names, code untouched', () => {
  const text = 'Gain from @M1 into @V_{out} and @{tail mirror}; see [[bias-gen]], a@b.c\n`@M2 [[x]]` then @M3\n```\n@M4 [[y]]\n```\n[[z]]';
  assert.equal(notesMarkdown(text), 'Gain from M1 into $V_{out}$ and tail mirror; see bias-gen, a@b.c\n`@M2 [[x]]` then M3\n```\n@M4 [[y]]\n```\nz');
  const circuit = amp();
  assert.equal(runCommand(circuit, 'notes markdown').text, '(no notes)');
  circuit.notes = 'See @V_{out} in [[amp]]';
  const result = runCommand(circuit, 'notes markdown');
  assert.equal(result.text, 'See $V_{out}$ in amp');
  assert.deepEqual(result.json, { markdown: 'See $V_{out}$ in amp' });
  assert.equal(result.mutated, false);
  assert.equal(circuit.notes, 'See @V_{out} in [[amp]]');
});

test('lists nest by indentation, and indented lines continue their item', () => {
  const html = renderNotes(['- bias', '  - tail', '    1. size', '    2. check', '  - [x] mirror', '    ratio 1:4', '- output', '', 'after'].join('\n'));
  assert.equal(html, '<ul><li>bias<ul><li>tail<ol><li>size</li><li>check</li></ol></li><li class="note-task done"><span class="note-check" aria-hidden="true"></span>mirror<br>ratio 1:4</li></ul></li><li>output</li></ul>\n<p>after</p>');
  // A tab counts as two spaces.
  assert.equal(renderNotes('- a\n\t- b'), '<ul><li>a<ul><li>b</li></ul></li></ul>');
});

test('completion offers designs after [[ and parts and nets after @, best matches first', () => {
  const names = {
    designs: ['amp', 'bias-gen', 'Opamp 2'],
    parts: [{ name: 'M12', type: 'nmos' }, { name: 'M1', type: 'nmos' }, { name: 'VDD', type: 'vdd' }],
    nets: ['V_{out}', 'V_{DD}', 'tail node', 'V_{out}'],
  };
  const at = (text, caret = text.length) => noteCompletion(text, caret, names);
  const shown = (found) => found?.items.map((item) => item.insert);

  // Designs: a match at the start first, then anywhere; [[ alone lists all.
  assert.deepEqual(shown(at('see [[amp')), ['[[amp]]', '[[Opamp 2]]']);
  assert.deepEqual({ ...at('see [[b'), items: undefined }, { kind: 'design', start: 4, end: 7, items: undefined });
  assert.deepEqual(shown(at('see [[')), ['[[amp]]', '[[bias-gen]]', '[[Opamp 2]]']);
  // A link closed after the caret is replaced to its close.
  assert.equal(at('see [[b]] then', 7).end, 9);

  // Mentions: parts and nets compared as mentions are; a net a part's name
  // would win over (V_{DD}, VDD) is not offered; spaces get braces.
  assert.deepEqual(shown(at('gain @M')), ['@M1', '@M12']);
  assert.deepEqual(shown(at('gain @vo')), ['@V_{out}']);
  assert.deepEqual(shown(at('gain @vd')), ['@VDD']);
  assert.deepEqual(shown(at('gain @{tai')), ['@{tail node}']);
  assert.deepEqual(at('gain @M1 x', 7), { kind: 'mention', start: 5, end: 8, items: at('gain @M1 x', 7).items });
  assert.equal(at('gain @').items.length, 5);
  assert.deepEqual(at('gain @M')?.items[0], { name: 'M1', kind: 'part', detail: 'nmos', insert: '@M1' });

  // Nothing: an address, code, no match, or only what is written there.
  assert.equal(at('mail a@b'), null);
  assert.equal(at('`@M`', 3), null);
  assert.equal(at('```\n[[a'), null);
  assert.equal(at('@zz'), null);
  assert.equal(at('[[bias-gen]]', 10), null);
  assert.equal(at('@M12'), null);
});

test('citations are numbered by first use, one number a source, and listed at the end', async () => {
  const { noteCitations } = await import('../src/core/notes.js');
  const text = 'CLS [^https://doi.org/10.1000/xyz123|Gregoire and Moon] and a book [^Razavi, Analog CMOS].\n\nAgain [^HTTPS://doi.org/10.1000/xyz123], [^doi:10.1/x] and `[^not cited]`.';
  assert.deepEqual(noteCitations(text).map((c) => [c.number, c.url, c.title || c.key]), [
    [1, 'https://doi.org/10.1000/xyz123', 'Gregoire and Moon'],
    [2, null, 'Razavi, Analog CMOS'],
    [3, 'https://doi.org/10.1/x', 'doi:10.1/x'],
  ]);
  const html = renderNotes(text);
  assert.equal(html.match(/<a href="#ref-1" class="note-cite"[^>]*>\[1\]<\/a>/g).length, 2);
  assert.match(html, /<code>\[\^not cited\]<\/code>/);
  assert.match(html, /<section class="note-references"><h4>References<\/h4><ol><li id="ref-1">Gregoire and Moon\. <a href="https:\/\/doi\.org\/10\.1000\/xyz123" target="_blank"/);
  assert.match(html, /<li id="ref-2">Razavi, Analog CMOS<\/li>/);
  // A source that is no address, a javascript: one too, is never a link.
  assert.doesNotMatch(renderNotes('[^javascript:alert(1)]'), /href="javascript/);
  assert.doesNotMatch(renderNotes('no citations'), /References/);
  assert.match(notesMarkdown(text), /^CLS \[1\] and a book \[2\]\.\n\nAgain \[1\], \[3\] and `\[\^not cited\]`\.\n\n## References\n\n1\. Gregoire and Moon, https:\/\/doi\.org\/10\.1000\/xyz123\n2\. Razavi, Analog CMOS\n3\. https:\/\/doi\.org\/10\.1/);
});
