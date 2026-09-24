/**
 * Timing diagram template: one clock waveform per switch phase, drawn under
 * the drawing as plain annotations the author then edits into the real
 * timing. Each phase gets a free label (its own spelling, TeX drawn as math)
 * and a line annotation two cells tall with vertical edges: 4 cells low,
 * 8 high, 8 low, 4 high.
 */

import { GRID, ceilGrid, floorGrid } from './grid.js';
import { isTexSource, switchPhases } from './beats.js';

/** Waveform levels by run, in cells: [length, high?]. */
const WAVE = [[4, false], [8, true], [8, false], [4, true]];
const WAVE_HEIGHT = 2 * GRID;
const ROW_PITCH = 3 * GRID;
const GAP_BELOW_DRAWING = 2 * GRID;
const LABEL_GAP = GRID;

/** Points of one template waveform starting at (x, top). */
export function timingWavePoints(x, top) {
  const level = (high) => (high ? top : top + WAVE_HEIGHT);
  const points = [{ x, y: level(WAVE[0][1]) }];
  for (const [cells, high] of WAVE) {
    const last = points.at(-1);
    if (last.y !== level(high)) points.push({ x: last.x, y: level(high) });
    points.push({ x: last.x + cells * GRID, y: level(high) });
  }
  return points;
}

/**
 * Add the template under everything drawn so far. Returns the ids of the
 * labels and lines it added, row by row: [{ phase, label, line }].
 */
export function addTimingDiagram(circuit) {
  const phases = switchPhases(circuit);
  if (!phases.length) throw new Error('no switch has a phase yet: label switches with the signal that controls them');
  const drawn = circuit.bounds();
  const left = floorGrid(drawn.x);
  const top = ceilGrid(drawn.y + drawn.h) + GAP_BELOW_DRAWING;
  const labels = phases.map(({ source }, row) => circuit.addLabel({
    text: source,
    math: isTexSource(source),
    align: 'right',
    x: left,
    y: top + row * ROW_PITCH + WAVE_HEIGHT / 2,
  }));
  // Right-align the phase names in one column flush with the drawing's left
  // edge; the waveforms start one cell after the widest.
  const column = Math.max(...labels.map((label) => label.bbox().w));
  const edge = left + column;
  for (const label of labels) label.moveTo(edge - label.bbox().w / 2, label.anchor.y);
  return labels.map((label, row) => {
    const line = circuit.addAnnotation('line', { points: timingWavePoints(edge + LABEL_GAP, top + row * ROW_PITCH) });
    return { phase: phases[row].key, label: label.id, line: line.id };
  });
}
