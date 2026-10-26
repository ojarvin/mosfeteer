import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, LABEL_FONT_SIZE } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { newFigureId } from '../src/core/figures.js';
import { addBeat } from '../src/core/beats.js';
import { normalizePageGuide, parsePageGuide, pageGuideWidth } from '../src/core/page-guide.js';
import { buildReport, notesOutline, reportFigureSize, reportPage, reportTargets, resolveReportTarget } from '../src/core/report.js';
import { DESIGN_LINK, noteCompletion, noteDesignLinks, noteFigures } from '../src/core/notes.js';
import { renderNotes } from '../src/core/notes-markdown.js';

const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));

/** A resistor divider and a table the analysis put beside it (figure F1). */
function divider() {
  const circuit = new Circuit();
  run(circuit, 'add resistor R1 --at 0 0 --rot 90', 'add resistor R2 --at 0 240 --rot 90', 'connect R1.b R2.a --name V_{out}');
  circuit.addLabel({ text: '\\text{Gain} & A_v = 1/2', math: true, x: 600, y: 0, figure: { id: newFigureId(circuit), kind: 'equations', source: 'small-signal' } });
  return circuit;
}

const svgs = (html) => [...html.matchAll(/<figure id="(fig-\d+)"[^>]*>(<svg[^>]*>)?/g)].map((m) => ({ id: m[1], svg: m[2] || null }));
const svgWidthPt = (tag) => Number(tag.match(/ width="([\d.]+)pt"/)[1]);

test('a report can show the circuit, the whole drawing, a beat, or one annotated figure', () => {
  const circuit = divider();
  addBeat(circuit, { name: 'first' });
  assert.deepEqual(reportTargets(circuit).map((target) => target.name), ['circuit', 'drawing', 'beat 1', 'F1']);
  assert.equal(resolveReportTarget(circuit, ' Beat  1 ').kind, 'beat');
  assert.equal(resolveReportTarget(circuit, 'f1').figure.id, 'F1');
  assert.equal(resolveReportTarget(circuit, 'beat 2'), null);
});

test('the notes place numbered figures, refer to them, and link a mention to the first figure that shows it', () => {
  const circuit = divider();
  circuit.notes = [
    '# Divider',
    '',
    'Its gain is in [[#F1]]; @R1 is in [[#circuit]]. The table is [[#nothing]].',
    '',
    '![[circuit|The divider, $V_{out}$ at the middle.]]',
    '',
    '> ![[F1|The gain.]]',
    '',
    'Inline ![[F1]] stays text.',
    '',
    '```',
    '![[drawing]]',
    '```',
  ].join('\n');
  const report = buildReport(circuit, { name: 'divider' });
  assert.deepEqual(report.figures.map((f) => [f.number, f.name, f.kind]), [[1, 'circuit', 'circuit'], [2, 'F1', 'figure']]);
  const { html } = report;
  // The notes' own heading titles it.
  assert.match(html, /<h1>Divider<\/h1>/);
  assert.doesNotMatch(html, /<h1>divider<\/h1>/);
  assert.match(html, /<a href="#fig-2" class="note-figure-ref" data-figure="F1">Fig\. 2<\/a>/);
  assert.match(html, /<a href="#fig-1" class="note-figure-ref" data-figure="circuit">Fig\. 1<\/a>/);
  assert.match(html, /<a class="mention" href="#fig-1">R<sub>1<\/sub><\/a>|<a class="mention" href="#fig-1">R1<\/a>/);
  assert.match(html, /<figcaption><span class="figure-number">Fig\. 1\.<\/span> The divider, <math/);
  assert.match(html, /Inline !\[\[F1\]\] stays text\./);
  assert.match(html, /<pre><code>!\[\[drawing\]\]<\/code><\/pre>/);
  assert.deepEqual(report.warnings, ['[[#nothing]]: no figure of the notes shows it.']);
  // The circuit figure leaves the analysis's table out; the table figure is the table alone.
  const [circuitSvg, tableSvg] = svgs(html).map((figure) => figure.svg);
  assert.ok(circuitSvg && tableSvg);
  const circuitFigure = html.slice(html.indexOf('id="fig-1"'), html.indexOf('id="fig-2"'));
  assert.doesNotMatch(circuitFigure, /Gain/);
  assert.match(circuitFigure, /data-ref="R1"/);
  const tableFigure = html.slice(html.indexOf('id="fig-2"'));
  assert.doesNotMatch(tableFigure.slice(0, tableFigure.indexOf('</figure>')), /data-ref="R1"/);
  // A printable, self-contained page.
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /@page \{ size: A4; margin: 70\.87pt/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /<script/i);
});

test('every figure is set at the guide width, so narrow figures keep its text size and wide ones are fitted, with a warning', () => {
  const circuit = new Circuit();
  run(circuit, 'add resistor R1 --at 0 0', 'add resistor R2 --at 4000 0');
  circuit.notes = '![[circuit]]';
  const guide = normalizePageGuide('ieee-1col');
  const report = buildReport(circuit, { guide });
  const [figure] = svgs(report.html);
  assert.equal(svgWidthPt(figure.svg), 252, 'the column width');
  assert.ok(report.figures[0].textPt < 8);
  assert.match(report.warnings[0], /^Fig\. 1 \(circuit\): its text is \d\.\d pt, below the guide's 8 pt\.$/);
  // One resistor is narrower than the column: padded, at 8 pt.
  run(circuit, 'rm R2');
  const narrow = buildReport(circuit, { guide });
  assert.ok(Math.abs(narrow.figures[0].textPt - 8) < 1e-3);
  assert.deepEqual(narrow.warnings, []);
  assert.equal(svgWidthPt(svgs(narrow.html)[0].svg), 252);
});

test('the page holds the guide: A4 text by default, wider for a wider guide, and a figure never taller than the page', () => {
  const a4 = reportPage(normalizePageGuide('a4'));
  assert.ok(Math.abs(a4.textWidthPt - 453.54) < 0.01);
  const wide = reportPage(normalizePageGuide('ieee-2col'));
  assert.equal(wide.textWidthPt, 516);
  const poster = parsePageGuide('40cm@24');
  const capped = reportPage(poster);
  assert.ok(capped.textWidthPt < poster.widthPt, 'the sheet keeps 12 mm margins');
  // Wider than the page: scaled to it, the text with it.
  const guide = normalizePageGuide('a4');
  const width = pageGuideWidth(guide);
  const fits = reportFigureSize(guide, a4, width, width / 2);
  assert.ok(Math.abs(fits.textPt - 8) < 1e-9);
  const big = reportFigureSize(poster, capped, pageGuideWidth(poster), 100);
  assert.ok(Math.abs(big.widthPt - capped.textWidthPt) < 1e-9);
  assert.ok(big.textPt < 24);
  const tall = reportFigureSize(guide, a4, width, width * 4);
  assert.ok(tall.heightPt <= a4.textHeightPt);
  assert.ok(Math.abs(tall.textPt - (LABEL_FONT_SIZE * tall.widthPt) / width) < 1e-9);
});

test('notes that embed nothing get the drawing on top, under the design name; a missing figure is marked', () => {
  const circuit = divider();
  const plain = buildReport(circuit, { name: 'divider' });
  assert.match(plain.html, /<h1>divider<\/h1>\n<figure id="fig-drawing"><svg/);
  assert.deepEqual(plain.figures.map((f) => [f.number, f.name]), [[null, 'drawing']]);
  assert.doesNotMatch(plain.html, /<figcaption>/);
  circuit.notes = '## Notes\n\n![[F7|Gone]]';
  const missing = buildReport(circuit, { name: 'divider' });
  assert.match(missing.html, /<h2>Notes<\/h2>/, 'a ## heading under the title');
  assert.match(missing.html, /<figure id="fig-1" class="missing"><p>Nothing named “F7” to draw\.<\/p><figcaption><span class="figure-number">Fig\. 1\.<\/span> Gone<\/figcaption>/);
  assert.deepEqual(missing.warnings, ['Fig. 1: nothing named "F7" to draw.']);
});

test('a beat figure draws the circuit as that beat shows it, without the figures', () => {
  const circuit = divider();
  addBeat(circuit);
  run(circuit, 'beat hide 1 R2');
  circuit.notes = '![[beat 1]]\n\n![[drawing]]';
  const { html } = buildReport(circuit);
  const [beat, drawing] = html.split('<figure').slice(1);
  assert.match(drawing, /data-ref="R2"/);
  assert.match(drawing, /Gain/);
  assert.doesNotMatch(beat, /data-ref="R2"/);
  assert.match(beat, /data-ref="R1"/);
  assert.doesNotMatch(beat, /Gain/);
});

test('the report command lists the figures and warnings, and writes the HTML', () => {
  const circuit = divider();
  circuit.notes = '![[circuit|The divider.]]\n\n![[F9]]';
  const [out] = run(circuit, 'report --guide 12cm@9');
  assert.equal(out.text, 'Fig. 1 circuit (circuit, 9.0 pt text): The divider.\nFig. 2 F9 (nothing to draw)\nwarning: Fig. 2: nothing named "F9" to draw.');
  assert.match(out.json.html, /^<!doctype html>/);
  const files = {};
  runCommand(circuit, 'report --file out.html --name Divider', { writeTextFile: (file, text) => { files[file] = text; } });
  assert.match(files['out.html'], /<title>Divider<\/title>/);
  assert.throws(() => run(circuit, 'report --guide letter'), /a page guide is ieee-1col, ieee-2col, a4, or a width and text size/);
  assert.equal(out.mutated, false);
});

test('embeds and figure references are neither design links nor broken in the notes window', () => {
  assert.deepEqual(noteDesignLinks('![[circuit]] [[#F1]] [[amp]]'), ['amp']);
  assert.equal([...'![[x]]'.matchAll(DESIGN_LINK)].length, 0);
  assert.deepEqual(noteFigures('![[circuit|A]]\n\n```\n![[drawing]]\n```\n> ![[F1]]').map((f) => [f.number, f.name, f.caption]), [[1, 'circuit', 'A'], [2, 'F1', '']]);
  const circuit = divider();
  const html = renderNotes('See [[#F1]].\n\n![[F1|The gain.]]\n\n![[F5]]', { figure: (name) => resolveReportTarget(circuit, name) });
  assert.match(html, /<a href="#fig-1" class="note-figure-ref" data-figure="F1">Fig\. 1<\/a>/);
  assert.match(html, /<div id="fig-1" class="note-figure" data-figure="F1"><span class="note-figure-number">Fig\. 1<\/span> <span class="note-figure-name">F1<\/span><span class="note-figure-caption">The gain\.<\/span><\/div>/);
  assert.match(html, /class="note-figure broken" data-figure="F5"/);
});

test('completion offers what a figure can show after ![[ and [[#', () => {
  const figures = [{ name: 'circuit', detail: 'the drawing without its figures' }, { name: 'drawing', detail: 'the whole drawing' }, { name: 'F1', detail: 'equations (small-signal)' }];
  const embed = noteCompletion('Text\n![[ci', 9, { figures, designs: ['circle'] });
  assert.equal(embed.kind, 'figure');
  assert.deepEqual(embed.items.map((item) => item.insert), ['![[circuit]]']);
  assert.equal(embed.start, 5);
  const reference = noteCompletion('see [[#', 7, { figures });
  assert.deepEqual(reference.items.map((item) => item.insert), ['[[#circuit]]', '[[#drawing]]', '[[#F1]]']);
  assert.equal(noteCompletion('see [[ci', 8, { figures, designs: ['circle'] }).kind, 'design');
  const withDesigns = [...figures, { name: 'amp', detail: 'design, as a section', section: true }];
  assert.deepEqual(noteCompletion('![[am', 5, { figures: withDesigns }).items.map((item) => item.insert), ['![[amp]]']);
  assert.equal(noteCompletion('[[#am', 5, { figures: withDesigns }), null, 'a reference is to a figure');
});

test('a report ends with the sources its notes cite, each citation linked to its entry', () => {
  const circuit = divider();
  circuit.notes = '# Divider\n\nAs in [^https://example.com/divider|A divider note].\n\n![[circuit]]';
  const { html } = buildReport(circuit);
  assert.match(html, /<a href="#ref-1" class="note-cite"[^>]*>\[1\]<\/a>/);
  assert.match(html, /<section class="note-references"><h2>References<\/h2><ol><li id="ref-1">A divider note\. <a href="https:\/\/example\.com\/divider"/);
  assert.ok(html.indexOf('<section class="note-references"') > html.indexOf('<figure'), 'after the figures');
});

test('an outline places the circuit, the beats and timing, and every annotated figure, in sections', () => {
  const circuit = divider();
  addBeat(circuit, { name: '$\\varphi_1$' });
  addBeat(circuit);
  circuit.addLabel({ text: 'Parts', x: 1200, y: 0, table: { parts: ['R1', 'R2'] }, figure: { id: newFigureId(circuit), kind: 'table', source: 'sizing' } });
  const outline = notesOutline(circuit, { name: 'divider' });
  assert.equal(outline, [
    '# divider', '[TOC]', 'What the circuit is and does.', '![[circuit|The circuit.]]',
    '## Operation', 'How it works, step by step.', '![[beat 1|Beat 1: $\\varphi_1$.]]', '![[beat 2|Beat 2.]]',
    '## Analysis', 'What the analysis shows.', '![[F1|Equations (small-signal analysis).]]',
    '## Sizing', 'How the parts are sized.', '![[F2|Parts.]]',
  ].join('\n\n') + '\n');
  // Every figure it places draws.
  circuit.notes = outline;
  assert.deepEqual(buildReport(circuit).warnings, []);
  // A bare circuit: its heading, text, and figure only.
  const bare = new Circuit();
  run(bare, 'add resistor R1 --at 0 0');
  assert.equal(notesOutline(bare), '# Design\n\n[TOC]\n\nWhat the circuit is and does.\n\n![[circuit|The circuit.]]\n');
});

test('notes outline starts empty notes and never replaces written ones', () => {
  const circuit = divider();
  const [out] = run(circuit, 'notes outline --name divider');
  assert.equal(out.mutated, true);
  assert.match(circuit.notes, /^# divider\n/);
  assert.throws(() => run(circuit, 'notes outline'), /has notes already/);
});

test('a design embedded by name is a section: its notes a level down, figures numbered on, once however often embedded', () => {
  const system = divider();
  const amp = divider();
  const sub = new Circuit();
  run(sub, 'add capacitor C1 --at 0 0');
  system.notes = '# System\n\nUses [[amp]].\n\n![[circuit|The system.]]\n\n![[amp|The amplifier.]]\n\n![[amp]]\n\nCites [^https://a.example|A].';
  amp.notes = '# Amplifier\n\n@R1 is in [[#circuit]] [^https://b.example|B] [^https://a.example].\n\n![[circuit|Its circuit.]]\n\n![[sub]]\n\n![[system]]';
  sub.notes = '';
  const designs = { amp: { name: 'amp', circuit: amp }, sub: { name: 'sub', circuit: sub }, system: { name: 'system', circuit: system } };
  const report = buildReport(system, { name: 'system', design: (n) => designs[n.toLowerCase()] || null });
  assert.deepEqual(report.figures.map((f) => [f.number, f.name, f.design]), [[1, 'circuit', null], [2, 'circuit', 'amp'], [3, 'circuit', 'sub']]);
  assert.deepEqual(report.warnings, []);
  const { html } = report;
  assert.match(html, /Uses <a class="design" href="#design-amp">amp<\/a>\./);
  assert.match(html, /<section id="design-amp" class="design-section">\n<h2>Amplifier<\/h2>/);
  assert.match(html, /<section id="design-sub" class="design-section">\n<h3>sub<\/h3>\n<figure id="fig-3">/);
  // In the section, its own figures and parts.
  assert.match(html, /<a class="mention" href="#fig-2">R1<\/a> is in <a href="#fig-2" class="note-figure-ref" data-figure="circuit">Fig\. 2<\/a>/);
  // Embedded again, or embedding the report's own design: a link to its section.
  assert.equal(html.match(/<section id="design-amp"/g).length, 1);
  assert.match(html, /<p class="see-section">See <a class="design" href="#design-amp">amp<\/a>\.<\/p>/);
  assert.match(html, /<p class="see-section">See <a class="design" href="#design-system">system<\/a>\.<\/p>/);
  // Citations numbered in reading order, one list at the end.
  assert.match(html, /<a href="#ref-1" class="note-cite" title="B · https:\/\/b\.example">\[1\]<\/a> <a href="#ref-2" class="note-cite"/);
  assert.match(html, /Cites <a href="#ref-2" class="note-cite"/);
  assert.equal(html.match(/<section class="note-references">/g).length, 1);
  assert.match(html, /<section class="note-references"><h2>References<\/h2><ol><li id="ref-1">B\./);
  // Without the design, the embed is a missing figure.
  const alone = buildReport(system, { name: 'system' });
  assert.match(alone.warnings.join('\n'), /Fig\. 2: nothing named "amp" to draw\./);
});

test('renaming a design follows into the notes that embed it as a section', async () => {
  const { relinkNotes } = await import('../src/core/notes.js');
  assert.deepEqual(relinkNotes('![[amp|The amplifier.]]\n\n![[amp]] [[amp]] ![[circuit]]', 'amp', 'ota'), { text: '![[ota|The amplifier.]]\n\n![[ota]] [[ota]] ![[circuit]]', count: 3 });
});

test('the drawing put on top of notes without figures goes under their title', () => {
  const circuit = divider();
  circuit.notes = '# Divider\n\nSome text.';
  assert.match(buildReport(circuit).html, /<h1>Divider<\/h1>\n<figure id="fig-drawing">[\s\S]*<\/figure>\n<p>Some text\.<\/p>/);
});

test('an outline of a block diagram embeds each linked design once, as a section', () => {
  const circuit = new Circuit();
  run(circuit, 'add block U2 --at 0 0', 'add block U1 --at 800 0', 'add block U3 --at 1600 0');
  circuit.components.get('U1').link = 'ota';
  circuit.components.get('U2').link = 'filter';
  circuit.components.get('U3').link = 'ota';
  assert.match(notesOutline(circuit), /\n\n## Blocks\n\nThe blocks, each from its own design\.\n\n!\[\[ota\]\]\n\n!\[\[filter\]\]\n$/);
});

test('[TOC] lists the numbered sections where it stands, the references one of them, the title not', () => {
  const html = renderNotes('# Title\n\n[TOC]\n\n## Intro\n\n### Detail\n\n## Next [^https://a.example]\n\n[TOC]\n\n```\n[TOC]\n```');
  assert.match(html, /^<h3>Title<\/h3>\n<nav class="note-toc"><h4 class="note-toc-title">Contents<\/h4><ol>/);
  assert.match(html, /<li class="toc-level-0"><a href="#sec-1"><span class="section-number">1<\/span> Intro<\/a><\/li><li class="toc-level-1"><a href="#sec-1-1"><span class="section-number">1\.1<\/span> Detail<\/a><\/li><li class="toc-level-0"><a href="#sec-2"><span class="section-number">2<\/span> Next/);
  assert.match(html, /<li class="toc-level-0"><a href="#sec-3"><span class="section-number">3<\/span> References<\/a><\/li><\/ol><\/nav>/);
  assert.match(html, /<h4 id="sec-1"><span class="section-number">1<\/span> Intro<\/h4>/);
  assert.match(html, /<h4 id="sec-3"><span class="section-number">3<\/span> References<\/h4>/);
  assert.equal(html.match(/<nav class="note-toc">/g).length, 1, 'one contents');
  assert.match(html, /<pre><code>\[TOC\]<\/code><\/pre>/);
  // Without [TOC], nothing is numbered.
  assert.doesNotMatch(renderNotes('# Title\n\n## Intro'), /section-number/);
});

test('a report\'s [TOC] numbers its sections across the designs it includes, theirs dropped', () => {
  const system = divider();
  const amp = divider();
  system.notes = '# System\n\n[TOC]\n\n## Overview\n\n![[circuit]]\n\n![[amp]]';
  amp.notes = '# Amplifier\n\n[TOC]\n\n## Gain\n\n![[circuit]]';
  const { html } = buildReport(system, { name: 'system', design: (n) => (n === 'amp' ? { name: 'amp', circuit: amp } : null) });
  assert.equal(html.match(/<nav class="note-toc">/g).length, 1);
  const toc = html.slice(html.indexOf('<nav class="note-toc">'), html.indexOf('</nav>'));
  assert.deepEqual([...toc.matchAll(/<span class="section-number">([\d.]+)<\/span> ([^<]+)<\/a>/g)].map((m) => `${m[1]} ${m[2]}`), ['1 Overview', '2 Amplifier', '2.1 Gain']);
  assert.match(html, /<h1>System<\/h1>/, 'the title is not numbered');
  assert.match(html, /<h2 id="sec-2"><span class="section-number">2<\/span> Amplifier<\/h2>/);
});
