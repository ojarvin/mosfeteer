# Signal-flow analysis

The analysis window's second mode (`Shift+S`, then **Signal flow** at its
top): transfer functions of a block diagram rather than a circuit. A drawing
with signal-flow parts and no devices opens in it. Code:
`src/core/analysis/signal-flow.js` (the analysis), `src/web/signal-flow-ui.js`
(the mode); tests: `test/signal-flow-analysis.test.js`.

## The diagram

Each wire is one signal. The parts are:

- **Transfer-function blocks** `tf_s` and `tf_z` (`src/core/transfer-function.js`):
  `y = H x`, from the block's MATLAB-style definition. Symbolic coefficients
  stay symbols in the result. An `s` block also takes a delay: an
  expression in `s` (`(1 - exp(-s*T))/s` for a hold DAC, `k/s`,
  `exp(-s*T_d)*k/(s + p)`), or `tf(num, den, 'InputDelay', T)`. `exp()`
  takes only a delay, `-s` times something free of `s`, and powers are
  whole, so a block stays a ratio of polynomials in `s` and its delays.
- **Gains** `gain`: `y = k x`, the triangle pointing the way the signal
  goes (its tip on the output pin, its centroid on the part's origin), its
  one coefficient (`k`, `0.5`, `a_1`, `2*g_m`) placed by one rule: a short
  one -- a name of up to two letters with a short subscript, signed or not,
  a positive number of up to three characters, or a negative digit -- inside
  the triangle, a label size smaller; any other (a product, a quotient, a longer number) beside it, above a
  triangle the signal crosses horizontally and to the right of a vertical
  one, kept so through rotations (`gainFitsInside`).
- **Sum junctions** `signal_sum`: `e = ± n ± s ± w` over the connected
  inputs, the signs from the junction's negative inputs.
- **Multiply junctions** `signal_multiply`: a gain. All inputs but one must
  be constants (a source set to *zero* or *constant*, wired straight to the
  junction); two signals multiplied have no transfer function and are
  refused.
- **Sources** are the signals nothing in the diagram drives: an input
  port's, or any wire that is read (a named stub, say). Any signal can be
  the output. Names are shown as written (`OUT`, `V_{OUT}`).

- **Samplers** `sampler`: the switch that reads a continuous signal at
  `t = nT`, its value the period `T`. See *Sampled loops*.

A signal has at most one driver: a block's `out`, a junction's `e`, or a
sampler's `out`. Two drivers, a part on a signal wire that is none of the
above, or `s` and `z` meeting anywhere but a sampler return a diagnostic,
never a guessed answer.

## Sources and results

Pick the output and set each source to **input**, **zero**, or a
**constant**; every source starts as an input. Each input gets its transfer
function to the output from one exact solve (one right-hand side per input),
so an SDM's STF and NTF come out together. A constant matters only where it
multiplies a signal: elsewhere superposition removes it, as for zero.

The solve reduces the graph the way it is done by hand
(`eliminateSignals`): each signal is a weighted sum of others, so the
cheapest node (fewest inputs times readers) is removed next, a self-loop
folding into `1/(1 - L)`, with common factors cancelled as the coefficients
grow. A fourth-order modulator with a dozen symbolic coefficients solves in a
fraction of a second this way, where a generic matrix elimination runs out
of its work limit.

Results are exact rational functions with the common factors cancelled
(`polynomial-gcd.js`), shown in `s` as descending powers with a monic
denominator, and in `z` over the denominator's highest power: the
denominator runs `1, z^-1, z^-2 ...` and the numerator keeps the powers it
has (`1 - z`, not `(-1 + z^-1)/z^-1`). Numeric ones also list their zeros
and poles.

A delay `e^{-sT}` is one more symbol in the exact solve, named by its TeX
(`delaySymbol`), so a loop with excess delay comes out as
`k / (s + k e^{-s T_d})` and draws its delays after the other factors. Its
`T`'s symbols get coefficient sliders; the graph evaluates the result
directly at `s = jω` with `e^{-jωT}` (`delayedCurve`), on **ω** from a
decade under the longest delay to two over the shortest, and on **f/fs**
with `T` counted in sample periods (`T = 1` is one sample). A delay has
infinitely many poles and zeros, so none are listed.

A wire ending on a sum's, a multiplier's, or a transfer function's input
draws an arrowhead into it without being asked (render.js
`withSignalArrows`), merged with any it has; a gain's triangle already
shows the way, so its input takes none.

Symbols in the results (`a_1`, `k`) each get a row under **Coefficients**: a
slider through the E24 values from 0.001 to 1000 and a field for any value
(negative too), starting at 1. The graph and the poles and zeros use these
numbers -- symbolic results show their roots "at the coefficients below" --
while the equations stay symbolic; moving one redraws as it moves. Typing
`= b_1` (or any expression of other coefficients: `= 2*b_1`, `= T/2`) in a
coefficient's field links it: it follows those others through any chain,
its slider only showing the number, until a number is typed again
(`coefficient-links.js`; a link that would make a coefficient follow
itself is refused). Links are saved with the numbers
(`analysisValues.links`), and an annotated graph lists a linked
coefficient as `c_1 = b_1 = 0.05`. The
numbers are saved with the document (`analysisValues.coefficients`), as the
Bode sketch's ratios are (`analysisValues.bode`): a slider move edits the
document (it shows as unsaved) without making an undo entry or marking the
derived equations stale (main.js `markSettingsChanged`).

Responses go onto one **graph** of magnitudes, a colour per trace
named by its ratio (`OUT/IN`) in that colour, its dB axis fitted to the
curves in whole 20 dB steps. With an s result on it, the frequency axis
is a choice: **ω** in the coefficients' own units, or **f/fs**, which reads
s in units of 1/Ts (a continuous-time loop filter normalized to its sample
rate: f/fs = ω/2π, to 1/2). On f/fs, s and z results share one graph; a z
result puts the whole graph there. The choice is saved with the document
(`analysisValues.sAxis`); `z` always plots over `f/fs` from `10^-4` to
`1/2`. Traces stay across derives, so responses from different settings or
outputs can be compared; each can be hidden or removed, and **Add to graph**
brings a removed one back. **Annotate graph**
puts it under the drawing at its left edge, as a plot annotation
(`plot.kind: 'response'`, `responseFigure` in `bode-figure.js`) with the
traces' names as math labels in their colours beside it, children of its
box, lined up once the browser has measured them (main.js
`alignLabelColumn`), and the coefficients' numbers under them one a line; **Annotate equations** writes the equations under the drawing.

## Sampled loops

A sampler makes the diagram a continuous-time loop sampled into a discrete
one, a continuous-time sigma-delta modulator say. Each signal is
continuous or sampled: a sampler's and an `H(z)` block's outputs are
sampled, an `H(s)` block's continuous, a junction's its inputs', a source
whatever it meets. The way back needs no part: an `H(s)` block reading a
sampled signal is the DAC, each sample entering it as an impulse, so its
`H(s)` is the pulse -- `(1 - exp(-s*T))/s` for NRZ, `exp(-s*T_ELD)(1 -
exp(-s*T))/s` with excess loop delay, `(1 - exp(-s*T/2))/s` for RZ.

There is no transform to choose (bilinear, matched-z, and the rest are
ways to design a discrete filter like a continuous one; nothing here is
approximated). The continuous side is solved exactly, once, for each
sampler's input: a transfer function from each continuous source and from
each sampled signal a DAC block reads. At the coefficients' numbers, each
path from a sampled signal is then sampled exactly (`sampling.js`): its
pulse response, read just before each `t = nT`, so a pulse edge landing on
a sample counts from the next one (an NRZ DAC with no excess delay gives
its natural `z^-1`), as `C e^{A delta} (I - e^{AT} z^-1)^-1 B` in
controllable form -- repeated poles (integrators) need no special case, and
the pole and zero a DAC's `1/s` leaves at `z = 1` are cancelled. The
sampled side is then solved in z.

So a sampled loop's results are numbers, worked out again as the sliders
move: the equation shows "at the coefficients below", and Annotate
equations writes it at those numbers. A sampled source's result (the NTF
of a quantizer's `q` after the sampler) is a rational in `z` with its poles
and zeros; a pole outside the unit circle is flagged as an unstable loop,
which a magnitude plot alone does not show. A continuous source's result
is the sampled loop's part times its continuous path to the sampler, that
path still symbolic (`(1 - z^{-1}) \cdot \frac{1}{s}`), read at
`s = jω` with `z = e^{jωT}`: a tone in at `f` gives the same tone out, its
images aside. Both plot over `f/fs`. The output must be a sampled signal;
a delay inside a continuous loop that feeds a sampler, samplers at
different periods, or impulses reaching a sampler (a DAC block with no
pulse) are refused.

Scripted: `analyze signal-flow --output NET --input PORT,... [--zero PORT,...]
[--const PORT=VALUE,...]`.
