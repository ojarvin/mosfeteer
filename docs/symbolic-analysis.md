# Symbolic circuit analysis

The first analysis command derives textbook-style output-impedance equations
without evaluating numeric values:

```text
analyze output-impedance VOUT
analyze output-impedance VOUT --reference N1
analyze output-impedance VOUT --model M1=current-source
analyze transfer-function VOUT --input VIN --ac-ground VBN,VCASCN
analyze transfer-function VOUT --input VIN --mode differential --differential-side VINB
analyze transfer-function VOUT --input VIN --ignore-channel-length-modulation --ignore-body-effect --gmro-large
```

The operation is available from the dedicated **Analysis** group at the end of
the top toolbar. Its **Analyze** form starts with input and output node
selectors; one derivation produces input impedance, output impedance, and
voltage-transfer results together. The form stays populated across
close/reopen and browser reloads. Right-click a device
or net in the right-hand lists to persist optional small-signal attributes:
transistors can be marked as triode resistors, while resistors can be marked
**R = ∞** when they are large enough to be negligible
relative to the other resistive paths on the same nets. Ports/nets can be
marked as DC-bias (AC-ground), input, or output. Those
attributes pre-fill the form and are also consumed automatically by analysis.
When the context row is part of a multi-selection, choosing an attribute applies
one undoable update to every selected compatible component or physical net;
right-clicking an unselected row leaves the action scoped to that row.
Transistors also expose an **Output resistance (`r_o`)** submenu. **Ignore
channel-length modulation** omits `r_o` for that device; **Retain finite `r_o`**
keeps it even when the form-wide approximation is enabled; and **Clear override**
returns to the form setting. This makes a cascode/bias-device approximation
explicit instead of silently idealizing every MOS device in the schematic.
The same menu can assume `g_m r_o \\gg 1` or retain finite intrinsic gain for
one device, and can ignore or retain that device's body effect (`V_{BS}=0` when
ignored). The command/API `current-source` override remains distinct:
`r_o \\to \\infty` removes only the output conductance, while an ideal
current-source model also removes the transistor's controlled `g_m`/`g_{mb}`
sources and leaves an open small-signal branch.

New analysis forms default to the practical symbolic approximations (body
effect ignored, `g_m r_o \\gg 1`, cascode reduction enabled, and Miller enabled).
The global MOS `r_o \\to \\infty` control remains off by default, as does the
topology-changing DC-only mode.

The analysis pipeline is deliberately nodal rather than a growing collection
of topology cases:

For single-stage presentation, the permitted compact recognizers are the three
textbook forms—common-source, common-gate, and common-drain. They consume the same
stamped model and solved equations as every other request; they only replace a
large equivalent expression with a familiar form when the topology and
assumptions prove that rewrite valid. Feedback loops and other multi-device
arrangements stay in the generic graph/KCL path. A folded output with an
explicitly AC-grounded internal load uses the dedicated branch reduction;
the dominant-term form still requires its separate approximation control.

1. The selected output/input nets and AC references are resolved to physical
   nodes. A differential request is represented as a single-ended equivalent;
   the complementary side is recorded as an AC-ground assumption.
2. Components are replaced by small-signal primitives (for example `1/R`,
   `1/r_o`, and controlled `g_m`/`g_{mb}` sources). DC bias ports such as
   `VBN` and `VCASCN` can be listed as additional AC grounds.
3. Kirchhoff current equations are stamped for every remaining node voltage.
   The report exposes those equations and the symbolic solution, so the
   derivation can be inspected instead of hidden in a case-specific formula.
4. The requested quantity is formed from the solved node voltage: a test
   current gives `Z_{out} = V_{out}/I_{test}`, while an ideal input-node drive
   gives a voltage transfer `A_v = V_{out}/V_{in}`.

Voltage-transfer reports also expose the equivalent two-port shortcut
`A_v = G_{m,eff} R_{out}`. `G_{m,eff}` is stamped by shorting the output and
measuring the resulting input-controlled current, so cascodes and internal
feedback are included rather than guessed from one transistor's `g_m`.

The current compact resistor reducer remains as a compatibility display for
simple output-impedance networks, while the generic node-equation result is
attached to every successful report and is the foundation for future transfer
functions. Singular or unsupported models are reported explicitly rather than
silently guessed.

The form exposes six explicit textbook controls: analyze the DC topology only
(capacitors open and inductors short), ignore channel-length modulation for MOS
devices (`r_o \to \infty`), ignore body effect (`g_{mb}=0`), assume
`g_m r_o \gg 1`, apply the cascode dominant-term reduction, and apply the
Miller approximation to eligible feedback impedances. The cascode reduction is
opt-in and is applied only to recognized branches whose cascode device also has
the explicit `g_m r_o \gg 1` assumption; selecting the generic intrinsic-gain
condition alone never silently discards the additive `r_o` terms. Miller is enabled by default, but splitting is used
only when the specific MOS forward-gain device has an explicit `g_m r_o \gg 1`
assumption and the stage is a conservative inverting, AC-grounded-source
topology with a visible DC load. For an impedance `Z` between input and output,
the equivalent shunts are `Z/(1-A_v)` and `Z/(1-1/A_v)`, where `A_v` is written
out as the derived DC stage estimate (for example
`-g_{m1}(r_{o1} \|\| R_D)`). Otherwise the original two-terminal impedance
remains in the model. The displayed Miller shunts retain a shared stage-gain
token such as `A_{v1}` in both forms, while the assumption log defines it with
the expanded DC approximation. Approximate equations are shown with
`\approx`; the unapproximated symbolic result remains in the report details
and every selected assumption is listed. For example, with body effect enabled
a cascoded output resistance reduces from
`r_{o2}+r_{o1}+(g_{m2}+g_{mb2})r_{o2}r_{o1}` to
`(g_{m2}+g_{mb2})r_{o2}r_{o1}` under the large-`g_m r_o` assumption.
When the cascode control and both form-wide `g_m r_o \gg 1`/finite-`r_o`
conditions are checked, the recognized cascode reduction retains finite
symbolic `r_o` for its branch devices so the `g_m r_o` factor does not collapse
to `\infty`; an explicit per-device `r_o` omission still produces an open
branch. DC-only mode is structural: the inductor union-find aliases its
terminals before KCL stamping, while capacitor branches are omitted entirely.
The same assumption simplifies loaded cascoded common-source gains through
the recurring loaded-common-gate identity, so a deep stack with a resistive
load is displayed as `A_v \approx -g_{m1}R_D` when the load limits the gain,
instead of exposing repeated nested parallel groups. The exact nodal result
remains available in the details. Likewise, an unambiguous source-degenerated
common source and a two-device cascode with a direct drain load use compact
finite-`r_o` output-resistance forms while retaining the complete nodal
derivation in the details. Feedback-loop devices are handled by the same
graph-based model: if a finite `r_o` lies on a controlled-source feedback edge,
it is retained until the symbolic approximation pass, even when the global
`r_o → ∞` option is selected. With `g_m r_o \gg 1`, the resulting loop-gain
terms reduce algebraically (for example to
`Z_{out} \approx 1/(g_{m,out} g_{m,fb} r_{o,out})`) without naming a particular
topology.
Multiplicative factors are rendered in a stable textbook order:
frequency, transconductance, resistance, inductance, then capacitance.
The cascode dominant-term step is explicit: it drops ro1 + ro2 only when
(gm,c + gmb,c)(ro1 || ro2) >> 1, equivalently when
(gm,c + gmb,c)ro1ro2 >> ro1 + ro2. The usual gm ro >> 1 assumption is
sufficient when the two output resistances are of comparable scale, but one
device-level condition alone is not sufficient if the other resistance is
much smaller.
Per-device `r_o` overrides participate in the same nodal model and are listed
in the assumptions. If an algebraic singularity would otherwise render as a
reciprocal zero, the display uses the explicit limiting symbol `\infty` rather
than the misleading literal `1/0`.

For output impedance, the analysis form exposes the input/source net and
sets it to zero (AC ground) before forming the small-signal model. An
explicit input role or a uniquely named `VIN`/`IN` net is inferred when
available; ambiguous circuits should select the source explicitly.

The Analysis result includes a read-only SPICE-like small-signal netlist beside
the equations and log. Each controlled-source entry also states its current
explicitly using the actual control-node names, for example
`g_{m3}(V_{IN}-N1)`.

The same nodal engine can derive input impedance by applying a symbolic
`I_{test}` at the selected input and reporting `Z_{in}=V_{test}/I_{test}`.
Resistors and capacitors are retained symbolically; a capacitor contributes
the frequency-domain impedance `1/(s C)` without evaluating a frequency.
When the selected input is a MOS source and its gate is an AC reference, the
input report recognizes the common-gate half-circuit and presents the compact
form `(r_o + R_L)/(1 + g_m r_o)` when a finite drain load is available. The
voltage-transfer result retains the finite-`r_o` term, giving the corresponding
positive common-gate gain.

For a folded-cascode output, the two sides are derived separately and placed in
parallel. A cascode side uses
`Z_side = r_{o,c} + R_x + (g_{m,c}+g_{mb,c})r_{o,c}R_x`, where `R_x` is the
parallel output resistance seen at the cascode internal node. On the folded
side, the input transistor at that node is included with the current-source
transistor, for example `R_x = r_{o11} || r_{o3}`. The final output resistance
is `Z_n || Z_p`; the exact finite-`r_o` expression remains in the Log tab when
the dominant-term approximation is selected.

After a successful derivation, **Annotate schematic** places each successful
symbolic equation as a free diagram label below the circuit, aligned to its
left edge with a two-cell clearance. After the browser has measured the
rendered equation boxes, their horizontal centerlines use one shared pitch
based on the largest adjacent half-sum of bbox heights; at least one
neighboring pair can therefore touch while narrower pairs have more
whitespace. A separate multiline
MathML-backed **Assumptions:** label is added only when a `g_m r_o \gg 1`,
`r_o = \infty`, body-effect omission, or additional cascode-reduction
approximation was actually used. Global `r_o` omission is qualified with any
finite device overrides; same-direction per-device omissions are suppressed.
When only per-device omissions are selected, they are listed individually,
unless every device in a multi-device analyzed model has that override, in
which case the equivalent global statement is used. A single-device override
remains visibly device-specific. It is excluded from the equation-column
pitch. Basic LaTeX-style subscripts are preserved
using the editor's existing `_{...}` label markup. Parallel resistor groups
use the TeX-safe `\|\|` source spelling in symbolic reports; diagram
annotations normalize it to the LaTeX `\Vert` double-bar operator in textbook
form, `(R_{1} || R_{2})`, with small side spacing. The renderer uses the
larger `\Big\Vert` sizing when a parallel term contains a fraction; adjacent
fraction products receive an explicit `\cdot`, and only a complete top-level
`A \, 1/B` product is written as `A/B`; nested nodal factors stay multiplied
so the equation does not turn into a stack of fractions. Reciprocal admittance
groups retain their `\Vert` form when they are reused by the gain equation.
Fractions reserve extra vertical space so their
denominators are not clipped. The renderer prefers the Latin Modern/Computer
Modern math font stack used by LaTeX, with local serif fallbacks when those
fonts are unavailable, and uses a medium weight so equations remain legible on
light and dark canvases.

For handwritten formulas, press `e` in a schematic. The equation-label tool
creates an ordinary free label with `$` delimiters and opens the inline editor
between them; committing the text renders it with the same live MathML-backed
math label renderer.

The View toolbar's **Label boxes** toggle overlays both rectangles for every
label: the blue dashed interaction box rounded to an even number of grid cells,
and the green tight bounds measured from the actual rendered SVG text/MathML.
Each label is resized once from the live browser measurement for its current
text; editing the text clears that runtime metric for one fresh measurement.
The measurements remain runtime-only and do not alter the saved file.

The result is organized into **Equations**, **Log**, and **Small-signal
netlist** tabs. The latter contains a read-only, SPICE-like
description of the same symbolic model: both combined and standalone views
show the reusable full small-signal model, so `V_{in}` remains visible. The
output-impedance KCL details separately record the zero-input test condition.
Resistors appear
as `R_<refdes>`, MOS output resistance as `R_<refdes> ... r_{oN}`, and each
controlled transistor current as `G_<refdes> drain source gate source g_{mN}`
(with `g_{mbN}` when bulk is active). Ideal current-source overrides are shown
as `OPEN` comments. Miller-split feedback impedances appear as
separate input and output shunts with `Z/(1-A_v)` and `Z/(1-1/A_v)` symbolic
values; capacitors are one common instance, but feedback resistors and other
modeled passive impedances use the same theorem.
This is a visualization aid, not a numerical simulator.

The target can be a physical net id, a unique net name, or a terminal
reference such as `R1.b`. If `--reference` is omitted, a single connected
ground, supply, or VCM marker is used as the AC reference. Unnamed markers of
those three types are treated as one global AC-reference group; owned marker
labels (for example `AVDD`) stay local. Ambiguous names and missing references
are reported rather than guessed.

Connecting an unnamed marker automatically names an otherwise unnamed net
`VSS`, `VDD`, or `VCM`. An existing net name is preserved. Double-clicking a
ground, supply, or VCM marker creates an editable owned label; entering a name
turns that marker into a local rail and keeps the label synchronized with later
net renames. A component value such as `5V` remains display text unless it is
committed as an owned marker label.

Every report includes assumptions and approximations. The compact reducer
keeps familiar series/parallel equations for simple networks, while the
generic nodal solver handles modelable feedback and source degeneration.
When a MOS source is not at AC ground, the compact reducer hands the request to
the nodal solver; the source node, `g_m` feedback, and source impedance remain
explicit in the KCL equations instead of producing an unsupported error.
Command/API `current-source` and `triode` overrides explicitly select the
corresponding small-signal primitive. Independent DC current sources are open circuits and
independent DC voltage sources are shorts; the latter force the report through
the aliased nodal model so their zero-impedance connection is preserved.
Unmodelled devices or singular systems return an
explanation rather than silently changing the meaning of an equation.

No numerical calculation is performed. An unused MOS bulk is assumed tied to
GND for NMOS or VDD for PMOS; that assumption is included in the report. The
implicit bulk is still stamped as an AC-ground control for `g_{mb}`, so a
moving source (for example, in a common-drain stage) includes the body-effect
term automatically. Select **ignore body effect** when that contribution is
intentionally omitted.
