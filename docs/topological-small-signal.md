# Topological small-signal analysis

The displayed equation should explain how a circuit works: which stage
produces signal current, how degeneration changes it, and which branches load
the resulting voltage. A shorter expanded polynomial is not always more useful.

The approach follows [Razavi's single-stage amplifier notes](https://www.seas.ucla.edu/brweb/teaching/215A_F2014/SingAmps.pdf),
especially the separate derivations of stage transconductance and output
resistance on page 4, and the loaded cascodes on pages 9–10.
[COCOA's frequency-response chapter](https://bmurmann.github.io/COCOA/contents/partI/partI.3.html)
also illustrates staged modeling, loading, Miller approximations, and
dominant-pole analysis. These references motivate the decomposition; the
implementation proves identities from the actual model rather than matching
circuit names to a formula catalog.

## Exact solve

`topological-solve.js` first removes the known input-voltage constraint. The
remaining MNA coefficients form a directed dependency graph. Strongly coupled
blocks are solved in dependency order, carrying both port excitations together.
Input current is recovered from the original KCL equation. An eight-stage
unilateral common-source chain therefore uses eight scalar block solves rather
than a determinant of the entire circuit.

Inside an active coupled block, removing a voltage junction may reveal several
independent branches. Each branch is reduced recursively to its response to
the excitations and boundary voltage. Their Schur admittances and signal
currents combine at that junction, then its voltage is propagated back into
the branches. Controlled-source couplings across branches prevent a false
partition. Singular branch decompositions retain the coupled solve.

The full MNA system, exact responses, and unreduced device netlist remain
available for inspection. `topologicalSolve: false` retains the combined
reference solver. Numeric callers retain their existing solver.

## Displayed structure

`topology.js` locates internal voltage nodes through which every input-to-output
dependency passes, with no return path from the output. It computes each
stage's signed short-circuit transadmittance on its coupled block and combines
it with the stage's loaded driving-point impedance. Parallel branch identities
also include direct shunts and the input port's imposed AC short for `Zout`.

Examples, ignoring body effect:

```text
Common source:   Av = -gm (ro || RD)
CMOS inverter:  Av = -(gm1 + gm2) (ro1 || ro2)
Degeneration:   Av ≈ -[gm / (1 + gm RS)] [ro (1 + gm RS) || RD]
Cascade:        Av = A1 A2 ... An
Reactive stage: Ai = -gmi [roi || Ri || 1/(s Ci)]
```

The degeneration form uses the selected `gm ro >> 1` assumption, but retains
`1 + gm RS` even when `gm RS` is small. Likewise, a finite drain load remains
in parallel with an active cascode branch. An intrinsic-gain assumption only
licenses removing terms dominated by selected devices' `gm ro` products,
including cross-device products such as a cascode's `gm2 ro1`. This textbook
interpretation assumes comparable device output-resistance scales; disable
high intrinsic gain for exact results with arbitrary parameter ratios. It
does not declare `gm RS` or `gm RD` large.

Selected assumptions act on each stage and physical load branch before
recombination. The dominant-pole option continues to act on the complete
transfer function. Product and parallel proofs survive the GUI report adapter
and the `s -> 0` rows; capacitive parallel branches disappear at DC.

Local algebra cleanup expands at most 128 terms to cancel distributive
identities and keeps the result only when it is no larger. Small resistive branch sums are flattened for display (up to four terms),
with each transistor’s `gm ro` pair adjacent; frequency polynomials and proven
stage/load products retain their useful factors. Optional factoring has
separate bounded budgets. `topologicalPresentation: false` retains ordinary
algebraic presentation. A circuit with inseparable feedback retains a coupled
expression; no unilateral or matched-half approximation is invented.

## Conducting feedback

The Miller theorem uses the voltage gain across the actual bridge. Replacing
a DC-conducting feedback resistor using bridge-open gain silently neglects
loading. The pre-solve approximation therefore transforms only bridges that
open at DC; other bridges stay in MNA. Verified sum/quotient presentation
identities expose their compact input resistance without changing the model.

For a resistively fed-back CMOS inverter, define `G = gm1 + gm2` and
`Ro = ro1 || ro2`. The port equations are

```text
Zin  = (Rf + Ro)/(1 + G Ro) ≈ (Rf + Ro)/(G Ro)
Zout = ro1 || ro2 || Rf
Av   = (1/Rf - G) Zout
```

The high-intrinsic-gain assumption removes the denominator's `1`, including
when `G Ro` is hidden in factored sums. It does not imply `Rf >> Ro` or
`G Rf >> 1`: retain `Ro` in the input numerator and `1/Rf` in the gain.
Reactive Miller replacements remain supported admittance primitives; their
netlist notes retain the feedback component identities and modeling gain.

## Verification

`test/analysis-topology-v2.test.js` compares all nonsingular golden-corpus exact
port queries against combined numeric solves, checks an eight-stage cascade
under a budget that the combined solver exhausts, and verifies active cascode
branches, feedback rejection, reactive GUI/DC rows, weak degeneration, and
finite cascode loading. Miller regression coverage retains finite gain
corrections when `gm RD` has not been declared large, checks both reactive
Miller shunts, and verifies conducting feedback against direct port equations
across weak and strong feedback (including parallel RC bridges).
