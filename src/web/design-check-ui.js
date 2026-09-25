/**
 * Design Check in the editor: running it, the side panel's issue list, the
 * status chip, and focusing an issue's parts on the canvas. The checks
 * themselves are evaluate() in core/commands.js.
 */

import { evaluate } from '../core/commands.js';
import { snap } from '../core/grid.js';
import { statusCheckEl, checkSummaryBodyEl, clearCheckButtonEl } from './elements.js';
import { logLine } from './status-bar-ui.js';
import { editor } from './editor-state.js';
import { animateViewTo, maxViewW, minViewW, paneSize } from './canvas-view.js';
import { setPanelCollapsed, setSidePanelVisible, sidePanelVisible } from './side-panel.js';
import { render } from './main.js';

export function resetCheckState() {
  editor.lastCheckReport = null;
  editor.diagnosticSelection = { components: new Set(), nets: new Set(), labels: new Set() };
}

export function clearCheckReport() {
  editor.lastCheckReport = null;
  clearDiagnosticFocus();
  renderCheckSummary();
}

export function clearDiagnosticFocus() {
  editor.diagnosticSelection = { components: new Set(), nets: new Set(), labels: new Set() };
}

function evaluationText(report) {
  const problems = [
    report.unconnectedTerminals?.length && `${report.unconnectedTerminals.length} unconnected terminal(s)`,
    report.overlappingBBoxes?.length && `${report.overlappingBBoxes.length} overlapping bbox pair(s)`,
    report.wireThroughBBoxes?.length && `${report.wireThroughBBoxes.length} wire/body violation(s)`,
    report.diagonalWireSegments?.length && `${report.diagonalWireSegments.length} diagonal segment(s)`,
    report.gridViolations?.length && `${report.gridViolations.length} grid violation(s)`,
    report.crossNetOverlaps?.length && `${report.crossNetOverlaps.length} cross-net overlap(s)`,
    report.labelComponentOverlaps?.length && `${report.labelComponentOverlaps.length} label/component overlap(s)`,
    report.labelOverlaps?.length && `${report.labelOverlaps.length} label overlap(s)`,
    report.netNameWarnings?.length && `${report.netNameWarnings.length} merged net name conflict(s)`,
  ].filter(Boolean);
  return problems.length ? `Check: ${problems.join('; ')}` : 'Check: no evaluator violations';
}

const CHECK_CATEGORIES = [
  ['unconnectedTerminals', 'Unconnected terminals'],
  ['overlappingBBoxes', 'Overlapping components'],
  ['wireThroughBBoxes', 'Wire through component body'],
  ['diagonalWireSegments', 'Diagonal segments'],
  ['gridViolations', 'Grid violations'],
  ['crossNetOverlaps', 'Cross-net wire overlaps'],
  ['labelComponentOverlaps', 'Label/component overlaps'],
  ['labelOverlaps', 'Label overlaps'],
];

const CHECK_ISSUE_KINDS = {
  unconnectedTerminals: 'unconnected-terminal',
  overlappingBBoxes: 'component-overlap',
  wireThroughBBoxes: 'wire-through-body',
  diagonalWireSegments: 'managed-diagonal',
  gridViolations: 'grid-violation',
  crossNetOverlaps: 'cross-net-overlap',
  labelComponentOverlaps: 'label-component-overlap',
  labelOverlaps: 'label-overlap',
};

function checkIssueTargets(category, value, structuredIssue) {
  const text = String(value);
  const components = new Set();
  const nets = new Set();
  const labels = new Set();
  if (category === 'labelComponentOverlaps') {
    // Label targets come from evaluate().issues, not from the human-readable
    // legacy strings in labelComponentOverlaps.
    if (structuredIssue?.labelId && editor.circuit.labels.has(structuredIssue.labelId)) labels.add(structuredIssue.labelId);
    if (structuredIssue?.componentRef && editor.circuit.components.has(structuredIssue.componentRef)) components.add(structuredIssue.componentRef);
  } else if (category === 'labelOverlaps') {
    for (const id of structuredIssue?.labelIds || []) if (editor.circuit.labels.has(id)) labels.add(id);
  } else if (category === 'unconnectedTerminals') {
    const match = text.match(/^([A-Za-z][A-Za-z0-9_-]*)\./);
    if (match) components.add(match[1]);
  } else if (category === 'overlappingBBoxes') {
    for (const ref of text.split('/')) if (editor.circuit.components.has(ref)) components.add(ref);
  } else {
    const net = text.match(/\bnet\s+([^\s:]+)/i);
    if (net && editor.circuit.nets.has(net[1])) nets.add(net[1]);
    const through = text.match(/\bthrough\s+([A-Za-z][A-Za-z0-9_-]*)/i);
    if (through && editor.circuit.components.has(through[1])) components.add(through[1]);
    const first = text.match(/^([A-Za-z][A-Za-z0-9_-]*)\b/);
    if (category === 'gridViolations' && first && editor.circuit.components.has(first[1])) components.add(first[1]);
  }
  if (category === 'crossNetOverlaps' && value) {
    for (const key of [value.key, value.otherKey]) {
      const id = String(key || '').split(':')[0];
      if (editor.circuit.nets.has(id)) nets.add(id);
    }
  }
  return { components, nets, labels };
}

function checkIssues(report) {
  const out = [];
  for (const [key, label] of CHECK_CATEGORIES) {
    const values = report[key] || [];
    const kind = CHECK_ISSUE_KINDS[key];
    const structured = kind ? (report.issues || []).filter((issue) => issue.kind === kind) : [];
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      const targets = checkIssueTargets(key, value, structured[index]);
      out.push({ category: key, label, value, detail: structured[index] || (report.issues || []).find((issue) => issue.kind === kind && issue.message === value), ...targets });
    }
  }
  return out;
}

function diagnosticFromReport(report) {
  const components = new Set();
  const nets = new Set();
  const labels = new Set();
  for (const issue of checkIssues(report)) {
    for (const ref of issue.components) components.add(ref);
    for (const id of issue.nets) nets.add(id);
    for (const id of issue.labels) labels.add(id);
  }
  editor.diagnosticSelection = { components, nets, labels };
}

function focusCheckIssue(issue) {
  const points = [];
  for (const ref of issue.components) {
    const comp = editor.circuit.components.get(ref);
    if (comp) {
      const b = comp.bboxWorld();
      points.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h });
    }
  }
  for (const id of issue.labels) {
    const label = editor.circuit.labels.get(id);
    if (label) {
      const b = label.bbox();
      points.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h });
    }
  }
  for (const id of issue.nets) {
    const net = editor.circuit.nets.get(id);
    for (const path of net?.paths() || []) points.push(...path);
  }
  editor.diagnosticSelection = { components: new Set(issue.components), nets: new Set(issue.nets), labels: new Set(issue.labels) };
  if (!points.length) { render(); return; }
  const x0 = Math.min(...points.map((p) => p.x));
  const y0 = Math.min(...points.map((p) => p.y));
  const x1 = Math.max(...points.map((p) => p.x));
  const y1 = Math.max(...points.map((p) => p.y));
  const p = paneSize();
  const aspect = p ? p.w / p.h : editor.view.w / editor.view.h;
  let w = Math.max(editor.view.w, x1 - x0 + 240);
  let h = Math.max(editor.view.h, y1 - y0 + 240);
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  w = Math.min(Math.max(w, minViewW()), maxViewW());
  h = w / aspect;
  editor.viewPane = p;
  editor.cursor = { x: snap((x0 + x1) / 2), y: snap((y0 + y1) / 2) };
  animateViewTo({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h });
}

let renderedCheckReport;

/** One collapsible group per issue category; rows show only the location,
 * since the group header already names the problem. */
export function renderCheckSummary() {
  if (!checkSummaryBodyEl || renderedCheckReport === editor.lastCheckReport) return;
  renderedCheckReport = editor.lastCheckReport;
  checkSummaryBodyEl.replaceChildren();
  const countEl = document.getElementById('check-count');
  if (!editor.lastCheckReport) {
    if (countEl) countEl.textContent = '';
    checkSummaryBodyEl.textContent = 'Not checked yet.';
    syncCheckChip(null);
    return;
  }
  const issues = checkIssues(editor.lastCheckReport);
  syncCheckChip(issues.length);
  if (countEl) {
    countEl.textContent = issues.length ? String(issues.length) : '✓';
    countEl.classList.toggle('issue', issues.length > 0);
  }
  if (!issues.length && !(editor.lastCheckReport.netNameWarnings || []).length) {
    const pass = document.createElement('div');
    pass.className = 'check-pass';
    pass.textContent = 'No issues found';
    checkSummaryBodyEl.appendChild(pass);
    return;
  }
  for (const [key, label] of CHECK_CATEGORIES) {
    const group = issues.filter((issue) => issue.category === key);
    if (!group.length) continue;
    const details = document.createElement('details');
    details.className = 'check-group';
    details.open = true;
    const summary = document.createElement('summary');
    summary.className = 'check-category issue';
    const name = document.createElement('span');
    name.textContent = label;
    const count = document.createElement('span');
    count.className = 'check-group-count';
    count.textContent = String(group.length);
    summary.append(name, count);
    details.appendChild(summary);
    for (const issue of group) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'check-issue';
      button.textContent = checkIssueLocation(issue);
      const spoken = `${issue.label}: ${button.textContent}`;
      button.title = issue.detail?.hint ? `${spoken}\n${issue.detail.hint}` : spoken;
      button.setAttribute('aria-label', issue.detail?.hint ? `${spoken}. ${issue.detail.hint}` : spoken);
      button.addEventListener('click', () => focusCheckIssue(issue));
      details.appendChild(button);
    }
    checkSummaryBodyEl.appendChild(details);
  }
  for (const warning of editor.lastCheckReport.netNameWarnings || []) {
    const row = document.createElement('div');
    row.className = 'check-category warning';
    row.textContent = `Net naming warning: ${warning.message}`;
    checkSummaryBodyEl.appendChild(row);
  }
}

/** `M1.d@(80,80)` reads as `M1.d  (80, 80)`; boxes read as their corners. */
function checkIssueLocation(issue) {
  const value = issue.value;
  if (typeof value !== 'string') return `(${value.x0}, ${value.y0}) – (${value.x1}, ${value.y1})`;
  return value.replace(/@\((-?[\d.]+),\s*(-?[\d.]+)\)/g, '  ($1, $2)');
}

/** Design check has one control in the status bar whether or not the side
 * panel is showing: "Check" runs it; after a run the chip shows the result
 * and opens the report. The panel's own button reads Re-check once a report
 * exists, and Clear appears beside it. */
function syncCheckChip(count) {
  const pending = count === null || count === undefined;
  if (statusCheckEl) {
    statusCheckEl.textContent = pending ? 'Check' : count ? `⚠ ${count}` : '✓';
    statusCheckEl.classList.toggle('pending', pending);
    statusCheckEl.classList.toggle('issue', !!count);
    statusCheckEl.title = pending
      ? 'Check the current schematic (x)'
      : count
        ? `${count} design check issue${count === 1 ? '' : 's'}; click to review`
        : 'Design check passed; click to review';
  }
  const runButton = document.getElementById('btn-check');
  const label = runButton ? [...runButton.childNodes].find((node) => node.nodeType === Node.TEXT_NODE) : null;
  if (label) label.textContent = pending ? 'Check' : 'Re-check';
  if (clearCheckButtonEl) clearCheckButtonEl.hidden = pending;
}

function focusCheckSummary() {
  if (!sidePanelVisible()) setSidePanelVisible(true);
  setPanelCollapsed('check-summary', false);
  const section = document.getElementById('check-summary');
  section?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  (section?.querySelector('.check-issue') || document.getElementById('check-summary-heading'))?.focus();
}

export function runCheck() {
  try {
    const report = evaluate(editor.circuit);
    editor.lastCheckReport = report;
    diagnosticFromReport(report);
    setPanelCollapsed('check-summary', false);
    renderCheckSummary();
    document.getElementById('check-summary')?.scrollIntoView({ block: 'nearest' });
    const hasProblems = report.ok === false || CHECK_CATEGORIES.map(([key]) => key)
      .some((key) => report[key]?.length);
    logLine(evaluationText(report), hasProblems ? 'error' : undefined, { peek: false });
    return report;
  } catch (err) {
    logLine(`Check failed: ${err.message || err}`, 'error');
    return null;
  }
}

export function installDesignCheckUi() {
  statusCheckEl?.addEventListener('click', () => {
    if (editor.lastCheckReport) focusCheckSummary();
    else runCheck();
  });
}
