// Learn's report example: two designs that show the notes as a report. A
// first-order delta-sigma modulator, whose integrator links to a
// switched-capacitor integrator with correlated level shifting; the
// modulator's notes place its drawing, its annotated equations and plots,
// and embed the integrator's notes as a section, under a numbered table of
// contents, and the integrator's place its circuit, timing, beats, plot,
// and tables, with mentions, math, tables, and citations. Pure: the editor saves
// them (onboarding.js `openReportExample`).

import { REPORT_INTEGRATOR } from './report-integrator.js';
import { REPORT_MODULATOR } from './report-modulator.js';

export const REPORT_EXAMPLE_NAMES = Object.freeze({ modulator: 'report-example-modulator', integrator: 'report-example-integrator' });

// The notes are a sample: the authors and the references are placeholders,
// and the notes say so at the top, so that the PDF made from them (the
// README's, docs/report-example.pdf) is never taken for a real design
// record. The numbers in them are the textbook ones and add up.
const PLACEHOLDER_BOOK = 'Placeholder, A. Sample Book on Oversampling Converters. Example Press, 0000. (A dummy reference.)';
const PLACEHOLDER_PAPER = 'Placeholder, B. and Example, C. “A sample paper on settling.” Journal of Examples, vol. 0, no. 0, 0000. (A dummy reference.)';
const PLACEHOLDER_NOTE = 'Placeholder, D. Sample Lecture Notes on Switched-Capacitor Noise. Example University, 0000. (A dummy reference.)';

const MODULATOR_NOTES = String.raw`# First-order delta-sigma modulator

Author: Claude

> **Sample document.** This is Mosfeteer's report example, made to show what a report can hold. Its authors and references are placeholders: it is no design record, and nothing in it should be cited.

[TOC]

## Introduction

A delta-sigma modulator trades amplitude resolution for speed. It samples far faster than the signal band needs, quantizes coarsely, and uses feedback to push the quantization error out of the band, where a digital filter removes it [^${PLACEHOLDER_BOOK}]. This report follows the simplest such loop, a first-order modulator with a one-bit quantizer, from its block diagram to the switched-capacitor integrator that implements its loop filter.

It covers:

- the loop and its signal and noise transfer functions,
- its stability as the loop gain $a$ varies,
- the resolution to expect for a given oversampling ratio, and
- the integrator, included from its own design as a section.

## The loop

The modulator in [[#circuit]] integrates the difference between its input @U and its fed-back output @V, and quantizes the result with @QZ1. The integrator @H1 accumulates that difference, so any error the quantizer makes is subtracted again in the next period.

![[circuit|The modulator. The integrator is drawn in its own design.]]

The integrator @H1 is the switched-capacitor circuit [[${REPORT_EXAMPLE_NAMES.integrator}]], described in its own section. The quantizer samples it at the end of $\varphi_2$, and its decision is fed back in the next period, which is the one-period delay in $H(z)$.

### Model

Taking the quantizer as a gain of one plus an additive error $E$, the output is the sum of two filtered inputs:

$$V(z) = \mathrm{STF}(z)\, U(z) + \mathrm{NTF}(z)\, E(z)$$

With the gain @K1 at $a = 1$, the two transfer functions are a pure delay and a first difference:

$$\mathrm{STF}(z) = z^{-1}, \qquad \mathrm{NTF}(z) = 1 - z^{-1}$$

The model rests on three assumptions:

1. The quantization error $E$ is white, uniform over one step $\Delta$, and independent of the input.
2. The integrator is ideal: no gain error and no settling error. The integrator's section returns to this.
3. The input stays inside the range over which the loop is stable.

## Analysis

[[#F1]] lists the transfer functions to the output from the input and from the quantization error, for any $a$, as the signal-flow analysis derives them.

![[F1|The signal and noise transfer functions.]]

At $a = 1$ the signal passes with a delay, and the noise rises 20 dB a decade from zero at DC: first-order noise shaping ([[#F2]]). On the unit circle the noise transfer function's magnitude is

$$\left|\mathrm{NTF}\left(e^{j\omega}\right)\right| = 2 \left|\sin \frac{\omega}{2}\right|$$

which is small wherever $\omega$ is small, that is, in a narrow band around DC.

![[F2|Their magnitudes at $a = 1$.]]

### Stability

The loop's pole sits at $z = 1 - a$ ([[#F3]]). It stays inside the unit circle, and the loop stable, for $0 < a < 2$. At $a = 1$ the pole is at the origin, so the loop settles in a single period.

![[F3|The pole as $a$ moves from 0.1 to 10.]]

### Resolution

With an oversampling ratio $\mathrm{OSR} = f_s / (2 f_B)$, the quantization noise left in the signal band is

$$P_Q = \frac{\Delta^2}{12} \cdot \frac{\pi^2}{3\,\mathrm{OSR}^3}$$

so each doubling of the OSR lowers it by 9 dB, a gain of 1.5 bits. For an $N$-bit quantizer and a full-scale sine, the peak signal-to-quantization-noise ratio is

$$\mathrm{SQNR}_{\max} \approx 6.02\,N + 1.76 - 5.17 + 30 \log_{10} \mathrm{OSR} \ \text{dB}$$

which for the one-bit quantizer here gives:

| OSR | $\mathrm{SQNR}_{\max}$ | Effective bits |
|---|---|---|
| 32 | 47.8 dB | 7.6 |
| 64 | 56.8 dB | 9.1 |
| 128 | 65.8 dB | 10.6 |
| 256 | 74.9 dB | 12.1 |

A first-order loop needs a high OSR for high resolution. Its noise is also not truly white for slow inputs, where it forms idle tones; higher-order loops and dither address both.

## Status

- [x] Signal-flow model and transfer functions
- [x] Switched-capacitor integrator with correlated level shifting
- [ ] Transistor-level OTA
- [ ] Decimation filter

## Blocks

The integrator, from its own design, with its own author.

![[${REPORT_EXAMPLE_NAMES.integrator}]]
`;

const INTEGRATOR_NOTES = String.raw`# SC integrator with correlated level shifting

Author: Example Author

A non-inverting switched-capacitor integrator. @C_{S} samples @V_{IN} and passes its charge to @C_{F} once every clock period. Correlated level shifting (CLS) [^${PLACEHOLDER_PAPER}] adds @C_{CLS} at the output of the @OTA, so the OTA settles twice: once to estimate the output, and once more to correct its own error.

![[circuit|The integrator: $C_{S} = 250\,\text{fF}$, $C_{F} = 2\,\text{pF}$, $C_{CLS} = 150\,\text{fF}$.]]

## Clocking

The clock has three states; [[#timing]] shows the phases. The bottom-plate switch @S3 opens just before @S1, so the sampled charge does not depend on the input.

![[timing|The clock phases.]]

| State | Phases high | What happens |
|---|---|---|
| Sampling | $\varphi_1$ | $C_S$ tracks the input. |
| Estimate | $\varphi_2$, $\overline{\varphi_{CLS}}$ | The charge moves to $C_F$; $C_{CLS}$ follows the output. |
| Level shift | $\varphi_2$, $\varphi_{CLS}$ | $C_{CLS}$ lifts the output; the OTA corrects its error. |

1. **Sampling** ($\varphi_1$, [[#beat 1]]). @S1 and @S3 connect @C_{S} between @V_{IN} and ground.
2. **Estimate** ($\varphi_2$, $\overline{\varphi_{CLS}}$, [[#beat 2]]). @S2 and @S4 move the charge of @C_{S} onto @C_{F}. @S5 connects the OTA output straight to @V_{OUT}, and @S6 grounds @C_{CLS}, which charges to the estimated output.
3. **Level shift** ($\varphi_2$, $\varphi_{CLS}$, [[#beat 3]]). @S5 and @S6 open, and @S7 puts @C_{CLS} in series with the OTA output. The OTA output returns close to ground, so its finite gain matters much less.

![[beat 1|Sampling.]]

![[beat 2|Estimate.]]

![[beat 3|Level shift.]]

## Transfer function

With an ideal OTA, read out at the end of $\varphi_{CLS}$:

$$H(z) = \frac{V_{OUT}}{V_{IN}} = \frac{C_{S}}{C_{F}} \frac{1}{1 - z^{-1}}$$

With a finite gain $A_{OTA}$, the gain error falls roughly as $1/A_{OTA}^2$ instead of $1/A_{OTA}$: at $A_{OTA} = 36$, on the order of 0.08 % rather than 3 %. [[#F3]] shows the response with $A_{OTA} = 36$.

![[F3|The response of $V_{OUT}/V_{IN}$.]]

## Noise and sizing

Each switch leaves a sampled noise charge on the capacitor it opens across [^${PLACEHOLDER_NOTE}]. For the sampling capacitor alone, at 85 °C,

$$\sqrt{\overline{v_n^2}} = \sqrt{\frac{kT}{C_S}} \approx 141\,\mu\text{V}$$

[[#F2]] lists the kT/C noise of each phase at 85 °C and $f_s = 2.24\,\text{MHz}$, and [[#F4]] the capacitors.

![[F2|kT/C noise per phase.]]

![[F4|The capacitors.]]
`;

/** The example's designs, `[{ name, state }]`, the one to open first. */
export function reportExampleDesigns() {
  return [
    { name: REPORT_EXAMPLE_NAMES.modulator, state: { ...structuredClone(REPORT_MODULATOR), notes: MODULATOR_NOTES } },
    { name: REPORT_EXAMPLE_NAMES.integrator, state: { ...structuredClone(REPORT_INTEGRATOR), notes: INTEGRATOR_NOTES } },
  ];
}
