// Learn's report example: two designs that show the notes as a report. A
// first-order delta-sigma modulator, whose integrator links to a
// switched-capacitor integrator with correlated level shifting; the
// modulator's notes place its drawing, its annotated equations and plots,
// and embed the integrator's notes as a section, under a numbered table of
// contents, and the integrator's place its circuit, timing, beats, plot,
// and tables, with mentions, math, and a citation. Pure: the editor saves
// them (onboarding.js `openReportExample`).

import { REPORT_INTEGRATOR } from './report-integrator.js';
import { REPORT_MODULATOR } from './report-modulator.js';

export const REPORT_EXAMPLE_NAMES = Object.freeze({ modulator: 'report-example-modulator', integrator: 'report-example-integrator' });

const MODULATOR_NOTES = `# First-order delta-sigma modulator

[TOC]

## The loop

The modulator in [[#circuit]] integrates the difference between its input @U and its fed-back output @V, and quantizes the result with @QZ1. With the gain @K1 at $a = 1$, the loop shapes the quantization error $E$ away from low frequencies [^Richard Schreier and Gabor C. Temes, Understanding Delta-Sigma Data Converters, Wiley-IEEE Press, 2005]:

$$V(z) = z^{-1} U(z) + \\left(1 - z^{-1}\\right) E(z)$$

![[circuit|The modulator; the integrator is drawn in its own design.]]

The integrator @H1 is the switched-capacitor circuit [[${REPORT_EXAMPLE_NAMES.integrator}]], described in its own section. The quantizer samples it at the end of $\\varphi_2$ and its decision is fed back in the next period, which is the one-period delay in $H(z)$.

## Analysis

[[#F1]] lists the transfer functions to the output from the input and from the quantization error, for any $a$, as the signal-flow analysis derives them.

![[F1|The signal and noise transfer functions.]]

At $a = 1$ the signal passes with a delay, and the noise rises 20 dB a decade from zero at DC: first-order noise shaping ([[#F2]]).

![[F2|Their magnitudes at $a = 1$.]]

The loop's pole sits at $z = 1 - a$ ([[#F3]]): inside the unit circle, and the loop stable, for $0 < a < 2$.

![[F3|The pole as $a$ moves.]]

## Blocks

The integrator, from its own design.

![[${REPORT_EXAMPLE_NAMES.integrator}]]
`;

/** The example's designs, `[{ name, state }]`, the one to open first. */
export function reportExampleDesigns() {
  return [
    { name: REPORT_EXAMPLE_NAMES.modulator, state: { ...structuredClone(REPORT_MODULATOR), notes: MODULATOR_NOTES } },
    { name: REPORT_EXAMPLE_NAMES.integrator, state: structuredClone(REPORT_INTEGRATOR) },
  ];
}
