# Symbolic circuit analysis

Symbolic analysis derives small-signal transfer functions and impedances
without evaluating numerical values. Choose the input and output nodes in the
**Analyze** window (in the toolbar's window group or the More menu;
`Shift+S`). Pick them
from the dropdowns or with the crosshair button, then click a wire or pin;
optionally add AC-ground nets (typed, or picked the same way) and triode
devices. One analysis produces the complete report. There is no separate
reference: every AC ground is the same 0 V node, and supplies, grounds, and
other DC rails already are AC ground, so a schematic with a rail needs
nothing added. A drawing with no rail at all needs one AC ground named.

The window reads as the signal-flow analysis's does (`signal-flow-ui.js`):
**Signals** first; then **Options**, folded, its summary naming what is
chosen that is not the default (transfer functions, loop gain, model
simplifications, equation approximations, noise, triode devices); the
results; a **Plots** card that opens the Plots window; and **Values**, the
numbers the plots are drawn at. Its footer is **Plots**, **Annotate…** and
**Derive** (Enter). **Annotate…** is the one place to put the analysis on
the drawing, in every mode ([`figures.md`](figures.md)): here the equations,
the small-signal model, and the Bode magnitude and phase, each marked ✓ when it is there
already (choosing it updates it), and **Everything**.
Nets marked AC ground from their context menu (DC bias) are listed in the
field; the field is the one list, so taking a net out clears its mark when
the equations are next derived.

## Analysis model

The engine builds one exact full-RLC small-signal model and stamps it as a
modified nodal analysis (MNA) system. A single multi-excitation solve provides:

- input impedance `Z_{in}(s)`;
- output impedance `Z_{out}(s)` with the input set to AC ground;
- voltage transfer `A_v(s)`.

The two excitations are the port's hybrid parameters, so the other transfer
functions need no further solve. The **Transfer functions** checkboxes pick
any of them (`transferFunctions`, default `['Av']`; an empty list leaves only
the impedances):

| Choice | Quantity | Condition |
| --- | --- | --- |
| `v_out/v_in` | `A_v` | output open |
| `v_out/i_in` | `Z_m`, transimpedance | output open, current-driven input |
| `i_out/v_in` | `G_m`, transconductance | output shorted to AC ground |
| `i_out/i_in` | `A_i`, current gain | output shorted, current-driven input |

Both port currents flow into the circuit, so `i_out` is the current `Z_{out}`
is measured with, and `A_v = -G_m Z_{out}` (a common-source stage has
`G_m = g_m`). `A_i` includes the reverse transmission of a bilateral stage.
Each transfer function has its own poles and zeros, since a current input or
a shorted output terminates the circuit differently.
Disconnected circuitry is omitted only when it has no algebraic coupling to
the selected ports. Controlled-source output and control nodes remain coupled.
Singular, floating, ambiguous, or unsupported requests return a diagnostic
instead of a guessed equation.

Independent DC sources are killed in the small-signal model:

- current sources become open circuits;
- voltage sources become shorts;
- DC rails and reference markers share AC ground.

A capacitor contributes `sC`; an inductor receives its MNA branch-current
stamp. The same model is used for every circuit topology.

A diode is its small-signal resistance `r_d` (`r_{d1}` for `D1`, `n V_T /
I_D`) from anode to cathode, forward biased. Marked off (Small-signal
attributes > Diode bias > Off, `analysis.resistance: 'infinite'`), a
reverse-biased clamp say, it is open. It carries no noise generator yet.

A part with no small-signal model (a BJT, a switch, a logic gate) that
touches a node of the analyzed circuit is refused, naming it, rather than
left out as an open circuit; one on circuitry the ports never reach changes
nothing.

Any node can be the input, a supply rail included: supply rejection is the
rail as the input. The rail leaves the AC reference with every spelling of
its name (`VDD` is `V_{DD}`), and every other input port is held at AC
ground, so the signal inputs are quiet.

## MOS devices

A saturation-region MOS model includes `g_m`, finite `r_o`, and `g_{mb}`. A
triode device is the only region override and is modeled by `r_{ds}`.

For three-terminal symbols, an NMOS bulk is tied to VSS and a PMOS bulk to VDD.
Both are AC-ground references. Four-terminal symbols use their connected bulk
net. Consequently, a moving source can produce body-effect current even when
the bulk is not drawn.

Ignoring body effect means the substitution `g_{mb}=0`. It does not move or
reconnect the bulk. If bulk and source already share one AC node, the body
control voltage is zero naturally.

## Opamps and Gm cells

An `opamp` is a voltage-controlled voltage source from its inputs'
difference to its output (`devices.js`, `mna.js`): ideal by default --
infinite gain, its inputs held equal (a nullor) -- or, chosen per opamp
under Small-signal attributes > Opamp model (`analysis.model`), a finite
gain `A` (`A_{1}` for `U1`) or a single pole `A = omega_t / s`
(`\omega_{t1}`), ideal at DC. MNA stamps the inverse gain, `0`, `1/A`, or
`s/omega_t`, so one stamp serves all three. An `opamp_diff` adds its
outputs' common mode held at AC ground. A `gm` cell is a VCCS,
`G_{m1} (v_ip - v_im)` into `op` and out of `om`. Their `_cmfb` variants
(`opamp_diff_cmfb`, `gm_cmfb`) add a common-mode feedback input that is
drawn only: the outputs' common mode stays held, so the pin takes no part
and may be left open.

Ideal opamps are folded out of the system before it is solved
(`reduceNullors`): each input pair holds `V(-) = V(+)`, so `V(-)` stops
being an unknown, and each output's KCL row goes (its current is whatever
it must be), so the summing nodes of an opamp-RC filter become virtual
grounds and a three-opamp biquad solves in a moment; a finite opamp's
output current is folded the same way, its own row kept. The reduced
system's rows no longer pair with its unknowns, so the structural solve and
stage factoring step aside for it, and the folded voltages come back in the
solution as aliases. Several finite or single-pole opamps with every
component symbolic can still exceed the work limit; ideal ones scale. The
audit netlist lists an opamp as `E out ref in+ in- gain` and the model
drawing as a VCVS diamond.

## Loop gain

**Loop gain at** (the transfer-functions fieldset; `analyze loop-gain AT`)
says where the loop breaks (`resolveLoopBreak` in `loop-gain.js`):

| written | the loop | broken |
| --- | --- | --- |
| `U1` | through an opamp | at the opamp as a whole: T = A beta |
| `M2.g` | drawn closed (a wire or a name) | the terminal lifted off its net |
| `V_{out}` | drawn closed | the gates and amplifier inputs on that net (every net of its name) lifted off it |
| `V_{fb} to V_{inn}` (or `->`) | not drawn closed | between the two nets as drawn |

The field offers the opamps, the transistors' gates, and the named nets. A
transistor's name alone is refused with the terminal to write instead
(`M2.g`); so is a net that feeds no gate or amplifier input, a rail (AC
ground is no part of a loop), and a terminal that is the only connection
of its net.

A break by terminal or net is solved on a copy of the circuit with the
lifted terminals on a drive net of their own; the net they were on is the
return. A test voltage drives the drive net, every input at zero, and T =
-v(return)/v(drive), from the same pipeline as the port quantities. It is
exact when the lifted side draws no current: a MOS gate (without its gate
capacitances) or an amplifier input. Otherwise its loading of the return
side is not in T, and **Left out of T** names the terminals. With the loop
not drawn closed, the drive net is the loop's open input: when nothing
else drives it (gates and amplifier inputs only), the open-loop analysis
holds it at AC ground and says so among the assumptions.

An opamp's break is a return ratio (Bode, Rosenstark): the opamp's output
driven from a unit test source, every independent source at zero, and what
returns to its inputs read: its feedback factor beta = -v_d/v_t and T = A
beta -- A_1 beta for finite gain, omega_t1 beta / s for one pole, and beta
alone for an ideal opamp, whose T is infinite. (`returnRatio` also breaks
at a transistor's g_m, T = -g_m v_gs / i_t, for scripted use; the window
offers its terminals instead, since one transistor of a differential pair
is not where its loop breaks.)

Every break is solved without Miller splitting, which would remove the
feedback being measured. T and its DC value, and an opamp's beta, list
under Loop gain; the Bode plots sketch T (or beta) with its crossover
omega_c and the phase margin there, at the sliders' relative values -- a
phase margin needs no design values.

An opamp's closed loop is also split at the same element (`feedbackParts` in
`loop-gain.js`; Middlebrook's general feedback theorem, the asymptotic gain
model): A_v = A_{v\infty} T/(1 + T) + A_{v0}/(1 + T), exactly. The ideal
gain A_{v\infty} is A_v with the element's gain infinite -- its control held
at zero by a nullor in its place -- and the direct feedthrough A_{v0} is A_v
with its gain zero: a transistor's g_m gone, an opamp's output at zero. A
source-degenerated stage shows -R_D/R_S and A_{v0} = 0; a shunt-feedback
stage -R_F/R_I, with what R_F carries straight through as A_{v0}. They list
under Loop gain after T, solved in T's model and its budget after T is
done, so a split too large to solve is left out and never costs T. An ideal
opamp has none: its T is infinite and A_v is its ideal gain.

The loop has an operation budget of its own, so a loop too large to solve
never takes the port quantities down with it. Past that budget (a two-stage
Miller OTA, whose plain A_v is already too large), it is solved again with
the Bode sketch's relative values for every symbol (`sketchRatios`, the
sliders as they were), leaving only s: a numeric T(s), titled so, still with
its crossover and phase margin, and re-solved by the next Analyze after a
slider moves.

## Exact and displayed results

The exact solve is canonicalized before presentation:

- proven common factors are canceled, including a frequency-dependent factor
  that the block-wise solve leaves on both sides of a response (a two-stage
  Miller OTA's came out degree 4 over 5 with two capacitors); it is found by a
  modular screen, remainders down to its degree, and exact division, and a
  response too large for that within its work limit keeps its factor;
- repeated factors become powers, such as `g_{m1}^2`;
- signs and denominator content are normalized;
- powers of `s` are ordered from highest to lowest;
- common factors are retained when they shorten the result;
- redundant parentheses are removed.

The Equations tab shows a concise textbook form. Exact canonical equations,
the MNA system, and diagnostics remain in the Log tab. The Small-signal netlist
tab shows the read-only model, including each controlled current and its actual
control-voltage difference.

The symbolic solver partitions unilateral stages and recursively combines
independent branches at internal junctions before solving. Presentation keeps
each stage's effective transconductance and parallel loaded output impedance,
and combines stages as a product. Feedback remains coupled. See
[Topological small-signal analysis](topological-small-signal.md) for the rules,
examples, and textbook references.

## Presentation options

These options are applied after the exact solve and affect only the displayed
result:

| Option | Default | Effect |
| --- | ---: | --- |
| Ignore body effect (`g_{mb}=0`) | On | Removes body transconductance. |
| Assume high intrinsic gain (`g_m r_o \gg 1`) | On | Drops terms dominated by the selected devices' `g_m r_o` products, including cross-device interactions at comparable output-resistance scales; preserves independent load and degeneration dependencies. |
| Ignore channel-length modulation (`r_o \to \infty`) | Off | Sets output conductance to zero. |
| Use dominant-pole approximation | Off | Reduces a multi-pole AC denominator after cancellation. |

An assumption is listed only when it changes a displayed expression. If
`r_o \to \infty` applies to a device, its high-intrinsic-gain assumption is
redundant and is not reported separately. The exact result is always retained.
In particular, high intrinsic gain does not imply `g_m R_S \gg 1`, nor does it
let the analyzer discard a finite resistor paralleled with a cascode load.

Miller approximation is a separate pre-solve option, enabled by default
(`millerApproximation: false` disables it). Private series/parallel feedback
networks that open at DC, such as a capacitor or series RC bridge, are split
into input/output shunts using the bridge-open DC gain. Conducting feedback
networks remain in the solved model, preserving resistor loading and direct
feedthrough. Exact Miller identities can still simplify their presentation.
A shunt that is a capacitance enters the solve as its own symbol, named as
the model figure names it: `C_{M1,in}` at the gate, `C_{M1,out}` at the
drain. The equations then read in the figure's terms, and "Where" defines
each one as a textbook writes it, `C_{M1,in} = C_{GD} (1 + g_{m1} (r_{o1}
\parallel R_{D}))`, `C_{M1,out} = C_{GD} (1 + 1/(g_{m1} (r_{o1} \parallel
R_{D})))`, under the equations' own approximations. Substituting the
definitions back gives the exact result unchanged, since each shunt is linear
in its capacitance (`analysis.derivedSymbols`: the exact `value`, the shown
`selected`). A number for one is its definition's at the other values: the
Bode plots set the parameters it is made of, never the symbol itself
(`withDerivedValues`, `baseSymbols` in `bode.js`). A shunt that is not a
capacitance (a series RC bridge) keeps its admittance inline. The netlist
identifies each transformed feedback network, both `Y` admittance shunts, and
each Miller capacitance's value; applied Miller assumptions are included in
annotations.

## DC, poles, and zeros

DC values are limits of the full result:

```text
Z_in(0)  = lim s→0 Z_in(s)
Z_out(0) = lim s→0 Z_out(s)
A_v(0)   = lim s→0 A_v(s)
```

This makes capacitors open and inductors short without rebuilding a separate
DC circuit. AC rows are shown only when `s` remains after cancellation. Poles
and zeros are taken from the canceled denominator and numerator; indexing
starts at zero (`p_0`, `z_0`). First- and second-order roots are explicit, while
higher-order results may remain polynomial.

The report order is:

1. `Z_{in}(s)`
2. `Z_{in}(0)`
3. `Z_{out}(s)`
4. `Z_{out}(0)`
5. each selected transfer function's `(s)` and `(0)` rows, in the table's order
6. poles, then zeros, of each selected transfer function
7. noise densities, when requested (input-referred, then output if asked)
8. definitions of named sub-expressions ("Where")
9. assumptions

Rows that add no information are omitted. The Equations tab groups the rows
into collapsible sections (`EQUATION_GROUPS` in `report-adapter.js`): ports,
impedances, transfer functions, poles and zeros, noise, and definitions.

## Time constants

**List the poles' time constants** (with Loop gain; `timeConstants: true`)
writes the natural-frequency polynomial D(s) = 1 + b_1 s + b_2 s^2 + ...
capacitor by capacitor (`time-constants.js`; Middlebrook's extra element
theorem, Vorpérian's fast analytical techniques). Each capacitor's
\tau_{C} = C R, with R the resistance it sees with the input at zero and
every other capacitor open; b_1 is their sum, so the term that dominates it
names the capacitor that sets the dominant pole, p_0 \approx -1/b_1. With
two to six capacitors the pairs give b_2 = \sum \tau_i \tau_j^{(i)}, the
second time constant taken with the first capacitor shorted, and
p_1 \approx -b_1/b_2 when the two poles are well apart. For a common-source
stage driven through R_S, C_gd's time constant is the textbook
C_gd (R_S + R_O + g_m R_S R_O). The sums are exact: D is the denominator
of every response before any cancellation, normalized to D(0) = 1.

They are solved in the model without Miller splitting (which would hide the
bridging C_gd behind its two shunts) or series/parallel merging (which folds
capacitors into other branches), with an operation budget of their own, and
never fail the rest of the report. They refuse an inductor, a one-pole
opamp, or a capacitor with no resistance to discharge through (a coupling
capacitor alone holding a gate): each would leave the sum wrong rather
than short. The resistances are not yet written with parallel bars.

## Named sub-expressions

With **Name large or repeated sub-expressions** (on by default;
`adaptCombinedReport(report, { nameSubexpressions: true })`), a parameter-only
sum of at least five symbols is shown as one symbol. That happens when it
occurs more than once, or sits in a row too long to read at once. Its
definition is listed once under "Where" (`src/core/analysis/definitions.js`).
The symbol's letter follows the sum's dimension, inferred from parameter
names: `Z` for resistance, `Y` for conductance, `\tau` for time, `X`
otherwise. Numbers follow reading order and skip any spelling a displayed
symbol already has. Spellings with equal expansions, factored or not, share
one name, and the definition shows the shortest. Sums that carry `s` stay
inline, so a response's structure in frequency is never hidden, though its
coefficients may be named. Exact equations in the Log tab are never
abbreviated.

## Noise

The **Noise** checkboxes add low-frequency noise densities (`noise`:
`{thermal, flicker, output, sources}`, implemented in
`src/core/analysis/noise.js`). The input-referred densities are always
reported; the output ones only with **Output noise** checked (`output`, off by
default in the panel, on for an engine request that leaves it out).
Each selected device gets one noise generator, a current source between its
own terminals, and one more RHS column in the same MNA solve. That column holds
the input at AC ground and the output open, so its output voltage is the
generator's transimpedance `H_k(s)`. Generators are uncorrelated and add in
power:

```text
v²_n,out = Σ |H_k|² S_k        v²_n,in = Σ |H_k / A_v|² S_k
```

| Generator | Thermal `S_k` | Flicker `S_k` |
| --- | --- | --- |
| saturated MOS (drain–source) | `4kT γ g_m` | `g_m² K_{f,n/p} / (C_{ox} W L f)` |
| triode MOS (`r_{ds}`) | `4kT / r_{ds}` | none |
| resistor | `4kT / R` | none |

Capacitors, inductors, and ideal and controlled sources are noiseless. Both
MOS generators flow in the drain, so one column serves thermal and flicker
noise. `H_k` and `A_v` share the system determinant, so the input-referred
ratio has the circuit's poles canceled.

Each row is the DC limit of every transfer, so the result is the density
below the first pole. Rows are power spectral densities in V²/Hz, labeled
`S_{v,in,th}`, `S_{v,in,1/f}`, `S_{v,out,th}`, and `S_{v,out,1/f}`. A row shows
the `4kT` or `1/f` prefix times one term per generator, e.g.
`4kT(γ/g_{m1} + 1/(g_{m1}^2 R_D))`. A factor every term shares moves in front
of the sum when that helps: one carrying a sum (a shared load such as
`Z_1^2`), one with a numerator of its own, or any shared factor of a flicker
row, which absorbs the `1/f`. A bare reciprocal like `1/g_{m1}` stays in the
terms. The exact equation in the Log tab keeps the unfactored terms.

**Noise by device**, below the density rows, sets the same terms side by
side: one row per generator, one column per noise kind with its prefix
divided out (`S_{v,in,th}/4kT`, `f · S_{v,in,1/f}`), and, when output noise
is on, a switch between input-referred and output values. It is part of the panel only: the
schematic annotation takes the density rows. The selected equation
approximations act on each generator's transfer before it is squared. A
generator outside the coupled network, or one whose gain vanishes at DC, is
named in the Log tab instead. Unchecking a device drops its column; a device
whose share is negligible is best left out rather than approximated away.

## Bode plots

The Bode plots are in the **Plots** window (`Shift+W`), as a signal-flow
diagram's responses are, its view picked by the analysis window's mode (or,
that window shut, by what the drawing is; `plots-window.js`). Each Derive
adds the first transfer function the form asks for (`A_v`, `Z_m`, `G_m`,
or `A_i`; the voltage gain when none can be plotted, a current into a gate)
and its loop gain, if one is asked for, to the graph beside what is there --
a supply's way to the output beside the signal's, or one setting beside
another; the same quantity between the same nets replaces itself. The
transfer functions asked for, **Voltage gain** (always solved), **Output
impedance**, **Input impedance**, and **Loop gain** above the graph are
switches for the last Derive's quantities: pressed while one is on the
graph, pressed again to take it off. The transimpedance and the
transconductance are solved in numbers from the exact model, as the voltage
gain is (`numericQuantities`); the current gain from its equation. A root
of the numeric solve a billion times smaller than the rest is at the
origin (`atOrigin`), so a zero at s = 0 does not stretch the axis decades
down. Each trace can be hidden or removed;
the magnitude is drawn over the phase, the two on one frequency axis
(they pan and zoom along it together, and only the phase numbers it); one
trace shown is drawn as a
textbook sketch, its asymptote and corners marked, several as their curves
together over the range they span. **Annotate graph** puts the graph on the
drawing as a signal-flow graph is (`plot.kind: 'response'`, its traces
named beside it, against its box; one trace's corners marked, `ω_{p1}`, a
label close to the one before a line lower), and **with phase** checked its phase as
a plot of its own. Each shown trace's corners are listed under the graph.

The plots are drawn in relative units, so they sketch shapes, not a
design's numbers. Every `g_m`
starts at one unit `g`, every capacitor at one unit `C` (capacitors on the
output node at 10, as loads usually are), every `r_o` and resistor at
`g_m r_o` units, MOS `C_gs`/`C_gd` at one shared fraction of `C`, and a body
`g_mb` at 0.2 `g`. Frequency is then in units of `g/C` and impedance in `1/g`;
absolute values would only slide the plot along its axes. **Values**, in
the analysis window as signal flow's coefficients are, scale `g_m r_o`, the
parasitic fraction, and each parameter the graph's traces reach: a slider
through 1-2-5 steps and a field for any positive number, each. The plots,
their asymptotes, poles and zeros, and unity-gain frequencies follow at
once. A corner the equations also have, first order, is listed with its
exact expression.

The plot is the deliverable, so the port quantities are not drawn from the
equations but from the same model solved in numbers at the sliders' values
(`numericSmallSignal` in `engine.js`, `numeric-response.js`, `eigen.js`):
exact, with no Miller splitting or other approximation, and at any size --
a two-stage amplifier with every device capacitance, too large to derive,
plots in milliseconds. The model's MNA matrix is affine in s, `A0 + s A1`
(built at s = 1, 2, and checked at 3), so the curve is a complex solve at
each frequency, and each quantity, a ratio of two unknowns, is by Cramer's
rule a ratio of determinants affine in s whose roots, its zeros and poles,
are eigenvalues. Each Derive builds the model from the drawing as it is;
the values re-solve it. The Values hint says which way the curves are
found. The loop gain is still drawn from its derived coefficients.

A textbook sketch on the drawing (a box annotation carrying the sampled
curve, asymptote, and named corners, drawn without numbers by
`src/core/bode-figure.js`) is no longer placed; one in a design from before
is still drawn.

## Schematic annotations

**Annotate… → Equations** puts the displayed equations on the drawing as the
analysis's table ([`figures.md`](figures.md)), right of the circuit: a row
each, its name then its equation, the definitions under their heading, and
the assumptions under a rule. Annotating again rewrites that table where it
stands. Each row, and
each group, has a checkbox that keeps it out of the annotation; the choice is
remembered with the form. The definitions the annotated rows use, directly
or through another definition, are always added after them. AC equations,
poles, and zeros are added only when reactive terms remain in the final forms.
The assumptions block is omitted when no selected approximation changes the
displayed equations.

Math labels use the editor's MathML-backed renderer and `_{...}` / `^{...}`
markup. Parallel groups render with `||`, products follow textbook factor
order with adjacent transistor `g_m r_o` pairs, and small resistive branch sums
are flattened to avoid nested parentheses. Nested quotient and reciprocal
identities compose into one fraction; multiplying factors in poles and zeros
are collected in its numerator, while proven parallel branches remain visible. Fraction spacing is measured in
consistent units before final label placement and remains stable across zoom
and reload.

## The model figure

The Model tab draws the small-signal circuit the solve used
(`src/core/analysis/model-schematic.js`): the primitives after the pre-solve
transforms, so Miller shunts and omitted `r_o` show as the equations treat
them: a Miller capacitance carries the equations' symbol, and the legend
under the figure states its definition as "Where" does. It is an ordinary schematic on the grid, built from the editor's own
symbols. The AC ground is the bottom row, and each transconductance's drain
end stands a row above its source end, so a cascode stacks as it does in the
schematic; every other node stands on the first row. A device's branches
between the same two nodes (`g_m`, `g_mb`, `r_o`) stand side by side, sources
first. Columns follow the schematic's left-to-right order, and a unit that
hangs from the node a column's stack ends at continues that stack (M1 over
its source resistor). A branch whose ends share a row lies along it. One AC
ground sits a cell under the first branch that reaches it, and the input and
output ports sit on their node's row, outside the drawing; a node without a
port is named with a net label. Branch labels are math, in the equations'
font, right-aligned a cell left of their symbol; each saves its own
estimated footprint (`mathBox`), so the layout holds until a browser
measures it. A controlled source names the nodes it reads, a grounded side left out:
`g_{m1}\,\mathrm{VIN}`, `-g_{m2}\,\mathrm{N4}`. Nets a chopper shorts are
one node, named by the side with a port, else a named one.

The **Model** tab shows it; its **Open in window** shows it in a floating
window that pans and zooms like a reference window
(`src/web/reference-window.js`), redrawn on each Derive and not saved with
the design. **Annotate… → Small-signal model** (and the `analyze model`
command) adds it to the drawing as one undo step, packed with the other
figures; placed again, it replaces the model there from the same top-left
corner (a figure, [`figures.md`](figures.md)). It is drawn without
ports, and its parts are **drawing only**
(`ComponentInstance#drawingOnly`): drawn, moved, and checked like any other
part, but no analysis reads them (`analyzedCircuit`), so placing the model
changes no result and leaves the equations current. A part whose name the
design already uses gets the next free one (`RD` becomes `RD_2`). The node
names stay as they are, so each model node shares its name with the
schematic node it models. The context menu's **Drawing only** item (and the
`drawing-only` command) sets or clears the flag on any part.

## Pipeline invariants

The v2 pipeline builds one exact full-RLC MNA model for `Z_in(s)`, `Z_out(s)`,
and `A_v(s)`, then presents derived equations. The optional `Z_m`, `G_m`, and
`A_i` transfer functions (`transferFunctions`) come from the same two solve
columns, never from another solve. Noise (`noise`) adds one RHS column per
selected generator to that same solve. The main implementation is in
`src/core/analysis/`; the user-facing contract is above.

- Independent DC current sources open, voltage sources short, and DC
  power/reference rails share AC ground. Capacitors contribute `sC`; inductors
  use an MNA branch-current stamp.
- A selected input/output port is never silently made the AC reference. Whole
  virtual-name groups follow the selected node. Unused input ports are held at
  AC ground. Ambiguous, singular, floating, or unsupported selections return a
  diagnostic rather than a guessed equation.
- Opamps are VCVSs, ideal (a nullor, folded out of the system before the
  solve, `reduceNullors`) unless a part's model is finite gain `A` or a single
  pole `omega_t/s`; MNA stamps the inverse gain. A `gm` cell is a VCCS.
- Loop gain is broken where the user says (`loop-gain.js`): at an opamp
  (a return ratio, T = A beta), a terminal, a net, or between two nets;
  one more solve, every input at zero, never Miller-split.
- Three-terminal MOS bulk is implicitly tied to VSS/VDD; four-terminal MOS
  uses its actual bulk. Body effect may be omitted without reconnecting the
  bulk. `r_o → infinity` and infinite resistor attributes remove branches
  before solving when safe; triode uses its separate `r_{ds}` model.
- Model simplifications affect conversion/solving: body effect, channel-length
  modulation, Miller reduction, and MOS parasitics. Equation approximations
  affect presentation only: high intrinsic gain and dominant pole. The
  normalized option defaults and labels are in `src/web/analysis-options.js`.
- `reduceNetwork` pre-reduces parallel branches only. It records equivalence
  proofs used by presentation; do not add series pre-reduction to the solver.
  `report-adapter.js` re-renders every displayed AC/DC row, so pass its
  equivalence options, named sub-expressions (`definitions.js`), and
  provenance through every row, including poles/zeros and noise.
- The Bode plots solve the port quantities in numbers (`numericSmallSignal`),
  never from the equations, and evaluates the loop gain's exact
  coefficients (`src/core/analysis/bode.js`); both in relative units, never
  design values. A box annotation may carry its sketch (`plot`). Its slider
  ratios, like the signal-flow coefficients, are saved with the document
  (`Circuit#analysisValues`); a slider move is a settings change
  (`markSettingsChanged`): saved, never staleness, and one undo entry per
  finished adjustment (a slider let go, a field committed, Apply), not per
  tick -- the analysis window brackets each control's gesture
  (`beginSettingsEdit`/`endSettingsEdit`); undoing it keeps what was derived
  current.
- The GUI calls `adaptCombinedReport(analyzeSmallSignalV2(...))`, never the v2
  analyzer directly. Provenance is opt-in and only decorates live equation
  MathML; it must not leak into labels, documents, or exports.

Read the focused tests before changing this pipeline. In particular, the
analysis corpus, report-adapter, provenance, Miller, parasitics, reduction,
and topology tests encode behavior that prose cannot safely replace.
