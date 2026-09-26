# Symbolic circuit analysis

Symbolic analysis derives small-signal transfer functions and impedances
without evaluating numerical values. Choose the input and output nodes in the
**Analyze** panel (its toggle sits in the canvas corner; `Shift+S`). Pick them
from the dropdowns or with the crosshair button, then click a wire or pin;
optionally select a reference, additional AC-ground nets, and triode devices. One analysis produces the complete report.

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

## Exact and displayed results

The exact solve is canonicalized before presentation:

- proven common factors are canceled;
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
The netlist identifies each transformed feedback network and both `Y`
admittance shunts; applied Miller assumptions are included in annotations.

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
ratio has the circuit's poles cancelled.

Each row is the DC limit of every transfer, so the result is the density
below the first pole. Rows are power spectral densities in V²/Hz, labelled
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

## Bode sketch

The **Bode** tab plots the exact transfer function (or `Z_out`, `Z_in`) in
relative units, so it sketches shapes, not a design's numbers. Every `g_m`
starts at one unit `g`, every capacitor at one unit `C` (capacitors on the
output node at 10, as loads usually are), every `r_o` and resistor at
`g_m r_o` units, MOS `C_gs`/`C_gd` at one shared fraction of `C`, and a body
`g_mb` at 0.2 `g`. Frequency is then in units of `g/C` and impedance in `1/g`;
absolute values would only slide the plot along its axes. Sliders scale
`g_m r_o`, the parasitic fraction, and each symbol by 1-2-5 steps; the plot,
its straight-line asymptote, its poles and zeros, and the unity-gain
frequency follow at once, because only the derived coefficients are
re-evaluated (`src/core/analysis/bode.js`), never solved again. A corner
whose factor is first order is listed with its exact expression.

**Place on drawing** puts a textbook sketch of the plot on the canvas: a box
annotation carrying the sampled curve, asymptote, and named corners
(`plot` in the document), drawn without numbers by `src/core/bode-figure.js`,
the same layout the tab uses. With a sketch selected the button updates it
in place.

## Schematic annotations

**Annotate schematic** places the displayed equations below the figure,
left-aligned with its edge and separated by two grid cells. Each row, and
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
