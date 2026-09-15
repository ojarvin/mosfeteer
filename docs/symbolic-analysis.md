# Symbolic circuit analysis

Symbolic analysis derives small-signal gain and impedances without evaluating
numerical values. Select the input and output nodes in the **Analyze** form;
optionally select a reference, additional AC-ground nets, and triode devices.
One analysis produces the complete report.

## Analysis model

The engine builds one exact full-RLC small-signal model and stamps it as a
modified nodal analysis (MNA) system. A single multi-excitation solve provides:

- input impedance `Z_{in}(s)`;
- output impedance `Z_{out}(s)` with the input set to AC ground;
- voltage transfer `A_v(s)`.

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

## Presentation options

These options are applied after the exact solve and affect only the displayed
result:

| Option | Default | Effect |
| --- | ---: | --- |
| Ignore body effect (`g_{mb}=0`) | On | Removes body transconductance. |
| Assume high intrinsic gain (`g_m r_o \gg 1`) | On | Keeps the dominant finite-`r_o` behavior. |
| Ignore channel-length modulation (`r_o \to \infty`) | Off | Sets output conductance to zero. |
| Use dominant-pole approximation | Off | Reduces a multi-pole AC denominator after cancellation. |

An assumption is listed only when it changes a displayed expression. If
`r_o \to \infty` applies to a device, its high-intrinsic-gain assumption is
redundant and is not reported separately. The exact result is always retained.

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
5. `A_v(s)`
6. `A_v(0)`
7. poles
8. zeros
9. assumptions

Rows that add no information are omitted.

## Schematic annotations

**Annotate schematic** places the displayed equations below the figure,
left-aligned with its edge and separated by two grid cells. AC equations,
poles, and zeros are added only when reactive terms remain in the final forms.
The assumptions block is omitted when no selected approximation changes the
displayed equations.

Math labels use the editor's MathML-backed renderer and `_{...}` / `^{...}`
markup. Parallel groups render with `||`, products follow textbook factor
order, and fraction spacing is measured before final label placement.
