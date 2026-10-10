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
- **Presets**: `tf_dac` (a DAC's NRZ pulse, `(1 - exp(-s*T))/s`),
  `tf_dac_rz` (its RZ pulse, held half a period: `(1 - exp(-s*T/2))/s`),
  `tf_delay` (`exp(-s*T_d)`), and `tf_zdelay` (`z^-1`) are transfer-function
  blocks that start with that definition, editable like any other.
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
  `t = nT`, its value the period `T`. Ideal: it passes on the numbers, with
  no hold -- it is not a ZOH; the hold is a DAC's pulse on the way back.
  See *Sampled loops*.
- **Quantizers** `quantizer`: round to `N` levels (the value, default 2),
  by Schreier's convention as the delta-sigma toolbox does: the odd
  integers `±1, ±3, ... ±(N-1)` for even `N`, `0, ±2, ...` for odd `N`,
  saturating beyond; full scale is `N - 1`. In the transfer functions a
  quantizer is a gain of 1 plus its own error source, listed with the
  sources as `E_{QZ1}`, so a modulator's NTF needs no separate `q` port; in
  the swing simulation it rounds.

A signal has at most one driver: a block's `out`, a junction's `e`, or a
sampler's `out`. Two drivers, a part on a signal wire that is none of the
above, or `s` and `z` meeting anywhere but a sampler return a diagnostic,
never a guessed answer. Where `s` and `z` meet, the diagnostic names a
signal of each and what made it so (`H2.out is continuous (H2, an H(s)
block, drives it), but SMP1.out is sampled (SMP1, a sampler, drives it)`).

## Sources and results

Pick the output and set each source to **input**, **zero**, or a
**constant**; every source starts as an input. The output list puts the
likeliest first (`outputChoices`): with a sampler, sampled signals before
continuous ones; then an output port's signal, another port's, a
quantizer's output; an unnamed wire is shown with the pin driving it
(`N1 (K1.out)`). Each input gets its transfer
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

A wire ending on a sum's, a multiplier's, a transfer function's, or a
quantizer's input draws an arrowhead into it without being asked (render.js
`withSignalArrows`), merged with any it has; a gain's triangle already
shows the way, so its input takes none. In the editor, a signal-flow part
hovered, selected, carried, or held as a placement ghost shows arrows out
of its outputs and into its inputs (`signalDirectionSvg`, overlay only).
A two-pin part (a gain, a block, a sampler, a quantizer) dropped unturned on
a wire is spliced into it lying along the wire, its input toward what
drives the signal (gestures.js `signalSpliceRotation`).

Symbols in the results (`a_1`, `k`) each get a row under **Coefficients**: a
slider through the E24 values from 0.001 to 1000 and a field for any value
(negative too), starting at 1 -- and a symbol never set is 1 in the
simulations and the optimizer too, as its slider shows. The graph and the poles and zeros use these
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
document (it shows as unsaved) without marking the derived equations stale
(main.js `markSettingsChanged`), and each finished adjustment -- a slider
let go, a value typed, the optimizer's Apply -- is one undo step; undoing
it shows the numbers again and keeps the equations current.

Every plot in the window -- the graph, the step, swing, locus, and loop
views, the optimizer's run, the Bode tab -- is one interactive plot
(`src/web/plot-view.js`, its specs in `src/core/plot-spec.js`): drag pans,
right-drag zooms to a box (a flat stroke along x only, a tall one along y
only), a right-click steps back out, Ctrl+wheel or a pinch zooms, a
double-click (or **Fit**) shows it all, and hovering reads every curve at
the pointer. A frequency response is sampled densely across the signal
band, and again across whatever range a zoom shows (`responsePlot`'s
`detail`), so a narrow band's ripple is drawn from its own points. A plot
annotation keeps the whole-range figure the window had before zooming.

The **Oscilloscope** (beside the plot views, `Shift+W`, or More; its own
window, `src/web/scope-window.js`) shows the diagram's nets in time: a
sine of the amplitude (dBFS) and frequency (f/fs, blank for the band's
middle) set there drives one source, the diagram runs as the swing does
(simulate.js, dither included) for 256 to 16384 samples after up to 1024
to settle, and each checked net is a waveform -- a sampled one held
through each period, a continuous one traced between samples too
(`run(a, { waves })`). Full scale is marked. It runs again as the
coefficients or its settings change; its nets and stimulus are saved with
the design (`Circuit#windows.scope`). Its plot zooms with the plain wheel
as well.

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

Between s and z, at a glance (also in the window, under its intro):

| Way | Part | What it is |
| --- | --- | --- |
| s to z | `sampler` | ideal: `x[n] = x(nT^-)`, no hold, no anti-aliasing (filter with an H(s) block before it) |
| z to s | any H(s) block reading a sampled signal | a DAC: each sample an impulse `x[n] delta(t - nT)` into it, so its H(s) is the pulse |
| | `tf_dac` | NRZ, the zero-order hold: `(1 - exp(-s*T))/s` |
| | `tf_dac_rz` | RZ, held half a period: `(1 - exp(-s*T/2))/s` |
| | typed into an H(s) block | any other pulse: `exp(-s*T_d)*(1 - exp(-s*T))/s` (excess loop delay; or a delay block drawn before the DAC), `(1 - exp(-s*T))/s^2` (a hold into an integrator) |
| z to z | `tf_z`, `tf_zdelay` | H(z) blocks, `z^-1` |

A sample-and-hold feeding continuous circuits is a sampler then an NRZ
DAC. No transform (bilinear, matched-z) is ever applied: a continuous path
from a DAC to a sampler is sampled exactly, as below.

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

## Swing

**Swing** simulates the diagram in time (`simulate.js`): a sine into one
source, at an f/fs made a whole number of cycles in its 4096-sample window
(after a quarter as many to settle), every net's peak recorded, as the
amplitude sweeps from -60 dBFS past full scale. It plots each net's peak
against the input amplitude, both in dB of full scale (the largest
quantizer's `N - 1`, else 1), with the output's tone at the input frequency
-- how the loop is scaled, and where it overloads (a state past a thousand
times full scale, or still growing). The plot marks the amplitude not to
operate at (`swingLimit`): the first at which a net climbs through full
scale, or the swings run away (`swingRunaway`), whichever comes first. The
swings run away at the first amplitude at which a net's peak outgrows
the input by more than 3 dB over the preceding 3 dB of sweep, or the run
overloads -- a net tracking the input never trips it, and a quantizer's
output, stepping between levels, is left out. The integrators' outputs, the quantizer's input, the
output, and its tone are shown at first; any net can be checked. It runs at
the coefficients' numbers and again as they move, and **Annotate swing**
puts it on the drawing like the graph (`plot.kind: 'swing'`,
`swingFigure`).

The sampled side steps as state-space (H(z) blocks in controllable form,
junctions and gains one linear map a step, quantizers in the order their
inputs need them). The continuous side is integrated exactly between
samples, `x(t + h) = e^{Fh} x(t)` over the H(s) blocks, the DAC blocks'
pulse terms, a sine oscillator, and a constant; each DAC block takes each
sample as impulses into its pulse's terms at their delays, the sampler
reads just before each `t = nT`, and peaks are taken at eight sub-steps a
period and at every impulse. A DAC block that is no pulse by itself -- a
delay `e^{-sT_d}` reading the sampled signal, say -- is folded with the H(s)
block that alone reads it, so a delay drawn before the hold simulates as
the delayed hold `e^{-sT_d}(1 - e^{-sT})/s`; the wire between carries
impulses and keeps no swing. Refused: a continuous diagram with no sampler
(no clock), a quantizer in a loop with no delay, a delay on a continuous
signal outside a DAC block, a block with more zeros than poles.

The **signal band**, f0 and bw in f/fs (a number or a fraction, `1/256`,
kept as typed: `normalizeBand`), is one setting above the plot views: a dashed line on the response graph at bw for a baseband signal,
two at f0 +- bw/2 otherwise (`bandEdges`), the band the specs and the SQNR
read, and where each test's sine sits unless set. Each test keeps its own
frequency -- the swing's, the spectrum's, the optimizer's swing test --
blank meaning inside the band (its middle, `swingTestFrequency`; 1/256 with
no band), shown as the field's placeholder. Every response curve is
evaluated exactly at the band's edges and f0 too (`bandFrequencies`), so a
notch or a peak there reads its true value. With
a band, a quantizer's NTF shows its **peak SQNR** (`bandSqnr`): a
full-scale sine, amplitude N - 1, against the quantizer's error taken as
white with variance 1/3 (levels 2 apart) over f/fs in (-1/2, 1/2), shaped by
|NTF|^2 in band -- 30 log OSR - 3.4 dB for a single-bit first-order loop,
50 log OSR - 11.1 dB for a second-order one.

The plots share one area, its view picked at the top (saved with the
document): **Magnitude**, **Phase**, **Step**, **Locus**, **Swing**, **Loop**.
Each view annotates the same way -- a plot box with its legend beside it,
updated in place on the next annotate (a plot's identity is its kind, its
quantity, and its role, so a loop plot and the graph never replace each
other).

**Loop** (`loopGain`, `loopMargins`): the loop broken at a picked signal (a
quantizer's output first): 1 injected into what reads it, every source at
zero, and T = -(what its driver returns) -- the negative-feedback loop gain,
so a quantizer's NTF is 1/(1 + T). The injected copy keeps the signal's
domain, so a sampled loop's T(z) comes from the same sampled solve. Its
magnitude and phase are plotted with the crossover (|T| = 1) marked, the
phase margin there (180 degrees plus its phase) and the gain margin (where
the phase crosses -180 degrees) given.

The graph's frequency and step views: Phase is in degrees on the same frequency axis. The step
response comes from the same transfer function (`step.js`): a z result by its
difference equation, in samples, drawn as stairs; an s result exactly,
through a state-space realization and matrix exponentials, its time in the
coefficients' units or, on f/fs, in sample periods, so s and z results share
the axis; an s result's delays shift its delayed terms. A loop holding a
delay has no step response here; a continuous input through a sampler
steps in samples, its path's step response read before each t = nT and
run through the sampled loop.

**Simulated output spectrum** (magnitude view): one swing-simulation run at
an amplitude and frequency of its own (the swing's source; the frequency made a whole number of
cycles in each segment), Welch-averaged -- Hann-windowed 8192-sample
segments overlapping by half over a 32768-sample record, seven averages --
and drawn behind the analytic curves (`spectrum.js`). It runs again when
the coefficients settle (a slider let go, a value typed), not on every
tick. The graph is then one plot in the spectrum's units, dBFS per bin (a
full-scale sine reads 0 dBFS; white noise its power in the window's noise
bandwidth): each NTF (a quantizer's error) is moved to the noise level it
predicts, white error of variance 1/3 (Schreier's levels) shaped by |NTF|^2, so it lies on the simulated floor; each
STF (a real input) to where the tone would sit, the amplitude in dBFS plus
|STF| in dB, so it runs through the tone's peak. With a band, the simulated
SNDR and ENOB beside the predicted SQNR.

**Dither** is a part of the diagram: a **dither source** (`dither`, value
`rect 1` or `tri 0.5`: its shape and A, in full scale -- `rect 1` is
+-FS, the largest quantizer's N - 1) draws a number a sample, rectangular
over (-A, A) or triangular over (-A, A) peaking at 0, and a gain after it
sets how much reaches the loop where it is wired (into the quantizer's
sum, say): with the default +-FS the gain reads as the dither in full
scale. It is a coefficient like any other, so the fractions treat it as
the gains into that block (one n per block). Nothing the optimizer
measures rewards dither -- the transfer functions do not hold its gain and
the swing test only grows with it -- so fix that gain rather than leave it
free (a free one is driven down, or zeroed as one that barely matters).
The transfer functions take it as a source, an input of its own; the
simulations (swing, spectrum, oscilloscope, the optimizer's swing test)
draw its numbers, the same sequence every run so runs compare like for
like. It feeds the sampled side only. A loop with few levels and a small
input idles in limit cycles -- tones and a floor that strays from the
NTF's prediction -- which dither of about a level step breaks up. A dither
source starts as **Zero** among the sources (it is noise, not a signal);
set it to Input for its own transfer function. The dither setting of
designs from before dither sources (`flow.dither`) is no longer read.

**Root locus** (`locus.js`): a result's poles as one coefficient sweeps,
logarithmically from a decade below its number to a decade above by default,
the rest at their numbers (a coefficient linked to it follows it). Drawn in
the complex plane, light to dark as the coefficient grows, with the unit
circle (z, the view kept near it) or the jω axis (s) and the current poles
as crosses; it names where the loop becomes stable or unstable.

Selecting several plots on the drawing and dragging one's handle resizes
them all alike, each from its own corner; a plot below (or right of)
another selected one moves on by its growth, so a column of plots keeps its
spacing.

**Update plots** (beside the view switch) redraws every plot on the
drawing at the coefficients' numbers now, in one undo step: a graph or step
plot from the traces of the same names (one naming a trace no longer on the
graph is left as it is), a loop plot at the signal it was broken at, a root
locus over its coefficient and range (`plot.source`), a swing plot from a
fresh sweep of the nets it shows; each keeps its coefficients' numbers
under the legend if it had them.

Annotating a graph or a swing again updates the plot of that kind already
on the drawing -- the selected one, else the only one -- keeping its place,
size, and style and swapping its data and legend (labels of role
`plot-legend`) in place; with none, a new plot goes under the drawing. The
mode's settings (the output, the sources, the swing's source and
frequency) are saved with the document (`analysisValues.flow`), as are the
band and the coefficients.

**Paste coefficients** (under the sliders) takes the delta-sigma toolbox's
vectors as MATLAB prints them -- `a = [0.0444 0.2843 0.7894]`, or its
display with no brackets, scale lines and column headers -- and sets
`a_1`, `a_2`, ...; name the diagram's gains to match.

Scripted: `analyze signal-flow --output NET --input PORT,... [--zero PORT,...]
[--const PORT=VALUE,...]`.

## Optimize coefficients

**Optimize coefficients** (a section under the coefficients,
`optimize.js`) searches the free coefficients for the best goal that keeps
every limit -- for any diagram the analysis solves, so a modulator's loop
filter and a plain filter alike. Each coefficient is **Free** or **Fixed**,
with an optional range; a linked one follows its link, and the timing (a
sampler's period, a delay's T, `timingSymbols`) starts fixed. A free
coefficient moves on a log scale and keeps its sign (one at zero, or with
a range across zero, moves linearly).

The criteria:

- **Specs**: a transfer function's magnitude, from a source to the output
  picked above, over a band (the signal band set on the graph, outside it,
  every frequency, or f1 to f2 in f/fs, s read in units of 1/Ts), measured
  as its power average (noise in band), its peak, or its lowest point, in
  dB. Each spec is a goal (minimize, maximize) or a limit (keep below, keep
  above). Every transfer function a spec reads must stay stable. Lee's rule
  for a modulator is a limit: the NTF's peak below 3.5 dB over every
  frequency.
- **Pole specs**: a transfer function's poles (`poleMeasures`), as the
  highest **Q** of a complex pair or the largest **radius** |z|. A z pole is
  read as s = ln z, so Q = |s| / (2 |Re s|): how much it rings, whatever its
  frequency (0.5 for real poles, 0.707 a Butterworth pair), where the same
  radius rings more the higher its frequency. Searched for in-band noise
  alone, a loop's NTF tends to high-Q poles just past the band -- the
  steepest rise for its out-of-band gain, at the price of ringing, a peaking
  STF, and sensitivity to its coefficients; a limit on Q trades some
  in-band attenuation for damping. A loop's NTF and STF share their poles.
- **Constraints**: relations the coefficients must keep, typed as one list
  (`c_1 >= c_2, c_2 >= 2*c_3`; >=, <=, >, <; each side an expression of
  coefficients, as a link is; `parseConstraints`). Each is a limit: a
  candidate breaking one is infeasible by how far it falls short, relative
  to the sides (1% short counts as 1 dB).
- **Swing test**: the diagram simulated (the swing's simulator) with a sine
  of a given amplitude into one source, at a set f/fs or the band's middle.
  It must not run away, there and 1 dB above, and each net with a limit
  (dBFS) must stay under it. A limit compares with the net's **3-sigma
  level** (the default), its 4-sigma level, or its highest peak: the level
  its swing passes as rarely as a Gaussian passes +-3 sigma (0.27% of the
  samples), or +-4 sigma (0.0063%). The swings are not Gaussian -- sigma
  names how rare. The integrators' outputs and the quantizers' inputs are
  listed for limits, each with its level and, in brackets, its highest
  peak at the best numbers.

  Why not the highest peak: near overload a loop makes rare large
  excursions, so the highest peak over a finite run is heavy-tailed. Under a
  change of one part in 10^4 in the coefficients it moved by up to 6 dB
  (standard deviation about 1.4 dB) where the 3-sigma level moved by 0.2
  dB, and a search fits a noisy measure to the runs it happens to see. A
  loop near its stable amplitude also runs away rarely and slowly: a
  4096-sample run passed a design that ran away in every 16k-sample run 1
  dB above the target.

  So candidates are ranked by a quick test (four runs of 4096 samples: two
  in-band frequencies, `swingTestFrequencies`, each from two phases, the
  levels kept a quarter dB inside the limits, one run 1 dB above the
  amplitude), and each new best is verified with a long one before it can
  be the best: eight runs of 16384 samples (four phases at each frequency)
  and two more 1 dB above, which must all hold, against the limits
  themselves. The verified numbers are the ones reported ("8/8 held").
  With no limit on a quantizer's input, a search tends to drive the gains
  into it to extremes; a limit a few dB over full scale keeps them sane.

  A limit can be **aimed at** (its *aim* box, `swing.targets`): it is then
  a goal as well -- the net brought up to the limit, each dB its level stays
  under it counted against the result like a goal's dB -- so a search does
  not scale an integrator's swing down for nothing (its circuit's noise
  grows as its swing shrinks). A run with an aimed limit has a goal, so it
  spends its budget.

Candidates are ranked by feasibility first: one that meets every limit
beats any that misses one; among those that miss, the smaller total miss
wins (dB over each limit; a run-away at the target counts by how far below
it the loop holds; an unstable transfer function by its pole); only feasible
ones are ranked by their goals, summed in dB. The search is CMA-ES
(`cmaes.js`) from the coefficients' numbers now, restarted from the best
point with twice the population whenever a run settles, until the budget
of candidates is spent; with no goal it ends at the first candidate that
meets every limit. Run scores the candidates in worker threads
(`src/web/optimize-worker.js`; in this thread when the page is opened from a
file). A run opens its own small
window (`optimize-window.js`): the specs' transfer functions at the numbers
it started from (grey) and at its best so far (in colour, redrawn with
each new best), the progress bar, and Stop, which turns to Close when it
is done; closing the window leaves the run going, its progress back in
the analysis window. The best numbers come back beside the
coefficients with each spec and the swing test at the start and at the
best; **Apply** puts them into the coefficients (four digits), **Revert**
undoes that. The setup is saved with the document
(`analysisValues.flow.optimize`, `optimize-setup.js`).

After a run (`refine.js`), with **Zero coefficients that barely matter**
on (the default): a free coefficient under 5% of the largest into its block
(`coefficientGroups`; one alone, of the largest free one) is tried at zero,
smallest first, with the long test; it stays zero -- a part fewer -- if
every limit still holds and the goals lose at most 0.5 dB. Apply writes it
and fixes it at zero, so later runs leave it out; Revert frees it again.
Then each free coefficient's **sensitivity**: nudged by 1% of itself, the
others held, the specs measured again (the transfer functions alone: the
swing test's runs are too noisy to difference), the largest change listed
in dB per 1%. One of 1 dB per 1% or more, or a nudge that loses stability,
is marked; a nudge missing a limit the result just meets is noted ("on a
limit"), not marked -- a best on its limit misses it at any nudge.

**Fractions** (`rounding.js`, when *Make the free coefficients fractions
m/n* is on, `rounding.on`) keep each free coefficient a simple fraction
m/n -- m units over n, whatever realizes it (a ratio of unit elements, a
digital multiplier) -- during the search itself: every candidate the
search proposes is snapped to fractions (`fractionSnapper`, in
`pointValues`) before it is scored, so the specs, limits, constraints,
and swing test are only ever weighed on numbers that can be built, and the
best found is one. One setting sets how coarse: **n ≤** a largest n (any
whole number up to 1024; each candidate's block takes the n up to it that
fits its gains best, optionally powers of two only) or **n =** exactly
that n (`rounding.fixed`). The gains into one block -- followed through
sums to the part they feed, an integrator or the quantizer
(`coefficientGroups`), a dither source's gain among them -- share its n,
its one reference element, so they read m1/n, m2/n, ...; off, each
coefficient has its own n. A coefficient's own n in the table (≤ or =,
`denominator`, `denominatorFixed`) overrides the setting for its block:
the largest set among the block's gains, exactly if any of them is set
exactly. A coefficient that is not zero never snaps to zero (that would be
another diagram), nor across it. The search moves on in the continuous
coordinates underneath, so flat stretches between fractions only slow it.

After the search (and the zeroing), `polishSearch` moves each by one unit,
1/n, while that helps, the start and the result verified with the long
test. The result lists each block's n and each coefficient's fraction and
value, and names a single unit far smaller than a gain beside it (a larger
n would set it finer). **Apply** writes the fractions exactly; a
coefficient keeps its fraction in its field and in plot legends
(`analysisValues.fractions`) until it is changed, and a fraction can be
typed (3/16).

Not yet: other grids (CSD digits).
