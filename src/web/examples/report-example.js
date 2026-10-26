// Learn's report example: two designs that show the notes as a report. A
// first-order delta-sigma modulator, whose integrator links to a
// switched-capacitor integrator with correlated level shifting; the
// modulator's notes place its drawing and embed the integrator's notes as a
// section, and the integrator's place its circuit, timing, beats, plot,
// and tables, with mentions, math, and a citation. Pure: the editor saves
// them (onboarding.js `openReportExample`).

import { Circuit } from '../../core/model.js';
import { runCommand } from '../../core/commands.js';
import { REPORT_INTEGRATOR } from './report-integrator.js';

export const REPORT_EXAMPLE_NAMES = Object.freeze({ modulator: 'report-example-modulator', integrator: 'report-example-integrator' });

const MODULATOR_NOTES = `# First-order delta-sigma modulator

The modulator in [[#circuit]] integrates the difference between its input @U and its fed-back output @V, and quantizes the result with @QZ1. With the gain @K1 at $a = 1$, the loop shapes the quantization error $E$ away from low frequencies [^Richard Schreier and Gabor C. Temes, Understanding Delta-Sigma Data Converters, Wiley-IEEE Press, 2005]:

$$V(z) = z^{-1} U(z) + \\left(1 - z^{-1}\\right) E(z)$$

![[circuit|The modulator; the integrator is drawn in its own design.]]

The integrator @H1 is the switched-capacitor circuit [[${REPORT_EXAMPLE_NAMES.integrator}]], described below. The quantizer samples it at the end of $\\varphi_2$ and its decision is fed back in the next period, which is the one-period delay in $H(z)$.

![[${REPORT_EXAMPLE_NAMES.integrator}]]
`;

/** The modulator: the delta-sigma tutorial's drawing, wired, its feedback
 *  negative and its integrator linked to the integrator design. */
function modulator() {
  const circuit = new Circuit();
  for (const line of [
    'add input U --at -1200 0', 'add signal_sum S1 --at -800 0', 'add gain K1 --at -400 0 --value a',
    'add tf_z H1 --at 0 0 --value "tf([0 1], [1 -1])"', 'add quantizer QZ1 --at 400 0', 'add output V --at 800 0',
    'connect U.p S1.w', 'connect S1.e K1.in', 'connect K1.out H1.in', 'connect H1.out QZ1.in', 'connect QZ1.out V.p',
    'connect QZ1.out S1.s', `link H1 ${REPORT_EXAMPLE_NAMES.integrator}`,
  ]) runCommand(circuit, line);
  circuit.components.get('S1').negativeInputs = new Set(['s']);
  circuit.notes = MODULATOR_NOTES;
  return circuit.toJSON();
}

/** The example's designs, `[{ name, state }]`, the one to open first. */
export function reportExampleDesigns() {
  return [
    { name: REPORT_EXAMPLE_NAMES.modulator, state: modulator() },
    { name: REPORT_EXAMPLE_NAMES.integrator, state: structuredClone(REPORT_INTEGRATOR) },
  ];
}
