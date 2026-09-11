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
transistors can be marked as ideal current sources or triode resistors, while
ports/nets can be marked as DC-bias (AC-ground), input, or output. Those
attributes pre-fill the form and are also consumed automatically by analysis.
When the context row is part of a multi-selection, choosing an attribute applies
one undoable update to every selected compatible component or physical net;
right-clicking an unselected row leaves the action scoped to that row.

The analysis pipeline is deliberately nodal rather than a growing collection
of topology cases:

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

The current compact resistor reducer remains as a compatibility display for
simple output-impedance networks, while the generic node-equation result is
attached to every successful report and is the foundation for future transfer
functions. Singular or unsupported models are reported explicitly rather than
silently guessed.

The form and command line expose three explicit textbook approximations:
ignore channel-length modulation (`r_o \to \infty`), ignore body effect
(`g_{mb}=0`), and assume `g_m r_o \gg 1`. Approximate equations are shown with
`\approx`; the unapproximated symbolic result remains in the report details
and every selected assumption is listed. For example, a cascoded output
resistance reduces from `r_{o2}+r_{o1}+g_{m2}r_{o2}r_{o1}` to
`g_{m2}r_{o2}r_{o1}` under the large-`g_m r_o` assumption.

For output impedance, the analysis form exposes the input/source net and
sets it to zero (AC ground) before forming the small-signal model. An
explicit input role or a uniquely named `VIN`/`IN` net is inferred when
available; ambiguous circuits should select the source explicitly.

The same nodal engine can derive input impedance by applying a symbolic
`I_{test}` at the selected input and reporting `Z_{in}=V_{test}/I_{test}`.
Resistors and capacitors are retained symbolically; a capacitor contributes
the frequency-domain impedance `1/(s C)` without evaluating a frequency.
When the selected input is a MOS source and its gate is an AC reference, the
input report recognizes the common-gate half-circuit and presents the compact
form `(r_o + R_L)/(1 + g_m r_o)` when a finite drain load is available. The
voltage-transfer result retains the finite-`r_o` term, giving the corresponding
positive common-gate gain.

After a successful derivation, **Annotate schematic** places each successful
symbolic equation as a free diagram label. Basic LaTeX-style subscripts are preserved
using the editor's existing `_{...}` label markup. Parallel resistor groups
are stored with the TeX-safe `\|\|` source spelling and rendered in textbook
form, `(R_{1} || R_{2})`, with compact scalable vertical bars; fractions reserve
extra vertical space so their
denominators are not clipped. The renderer prefers the Latin Modern/Computer
Modern math font stack used by LaTeX, with local serif fallbacks when those
fonts are unavailable.

For handwritten formulas, press `e` in a schematic. The equation-label tool
creates an ordinary free label with `$` delimiters and opens the inline editor
between them; committing the text renders it with the same live MathML-backed
math label renderer.

The result also contains a collapsible **Small-signal netlist**. It is a
read-only, SPICE-like description of the same symbolic model: resistors appear
as `R_<refdes>`, MOS output resistance as `R_<refdes> ... r_{oN}`, and each
controlled transistor current as `G_<refdes> drain source gate source g_{mN}`
(with `g_{mbN}` when bulk is active). Ideal current-source overrides are shown
as `OPEN` comments. This is a visualization aid, not a numerical simulator.

The target can be a physical net id, a unique net name, or a terminal
reference such as `R1.b`. If `--reference` is omitted, a single connected
ground, supply, or VCM marker is used as the AC reference. Unnamed markers of
those three types are treated as one global AC-reference group; owned marker
labels (for example `AVDD`) stay local. Ambiguous names and missing references
are reported rather than guessed.

Connecting an unnamed marker automatically names an otherwise unnamed net
`GND`, `VDD`, or `VCM`. An existing net name is preserved. Double-clicking a
ground, supply, or VCM marker creates an editable owned label; entering a name
turns that marker into a local rail and keeps the label synchronized with later
net renames. A component value such as `5V` remains display text unless it is
committed as an owned marker label.

Every report includes assumptions and approximations. The compact reducer
keeps familiar series/parallel equations for simple networks, while the
generic nodal solver handles modelable feedback and source degeneration.
`current-source` and `triode` attributes explicitly select the corresponding
small-signal primitive. Unmodelled devices or singular systems return an
explanation rather than silently changing the meaning of an equation.

No numerical calculation is performed. An unused MOS bulk is assumed tied to
GND for NMOS or VDD for PMOS; that assumption is included in the report.
