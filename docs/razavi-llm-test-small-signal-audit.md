# Small-signal coverage audit against Razavi's 2026 LLM test

Source reviewed: Behzad Razavi, [“Analog Design Experiments With AI—Part 2”](https://www.seas.ucla.edu/brweb/papers/Journals/BR_SSCM_2_2026.pdf), *IEEE Solid-State Circuits Magazine*, 2026. Page references below give the PDF page first and the printed magazine page second.

This is a capability audit, not an attempt to answer the paper's questions. The circuits were reconstructed only far enough to exercise the editor's present symbolic-analysis boundary.

## Executive summary

The current analyzer is useful for linear, time-invariant small-signal circuits around an already-understood bias point. It stamps resistors, capacitors, inductors, MOS `g_m`, `g_mb`, and `r_o`, opens independent DC current sources, shorts independent DC voltage sources, and solves symbolic nodal equations.

Most of the paper deliberately tests reasoning outside that domain. Ring oscillators, StrongARM comparators, clocked dividers, and LC oscillators need periodic, switched, transient, or eigenmode models; noise is intentionally outside the current product scope. A MOS-level reconstruction can still produce a large, plausible-looking static expression that answers a different question, so these cases should be identified as outside the declared static small-signal contract.

One case is directly relevant to the current feature set. The two-stage shunt-feedback TIA in Q17 is a linear small-signal problem and exposed a real simplification gap: the original Miller recognizer only handled an impedance connected directly between one MOS gate and that same MOS drain. The implementation now recognizes a bounded multi-stage feedback path by removing the feedback impedance, solving the unloaded endpoint gain, and applying the same two-shunt reduction only when the required high-gain assumption is explicit.

## Reproduction method

Two independent Luna agents reconstructed representative circuits through the public `Circuit` and analysis APIs. The runs covered:

- a three-stage CMOS ring, with and without node capacitances;
- a three-stage `inverter`-symbol ring;
- a MOS width sweep on a common-source stage;
- a source follower sanity check;
- a representative StrongARM/clocked-circuit capability inspection;
- a two-stage TIA corresponding to Figure 14(a), including `R_F`, `R_D1`, `R_D2`, the second-stage differential pair, and its open small-signal tail source;
- a cross-coupled LC/quadrature oscillator.

No numerical values were introduced. Runs used the same symbolic APIs as the Analysis window: `deriveSmallSignalModel`, `analyzeInputImpedance`, `analyzeOutputImpedance`, and `analyzeTransferFunction`.

## Findings by paper case

| Case | Analysis actually required | What the app does today | Risk |
|---|---|---|---|
| Q1 and Q3, ring-oscillator loading (PDF p. 3; printed p. 10) | Closed-loop poles, phase accumulation, and an oscillation start-up criterion as capacitance changes | A transistor reconstruction is stamped as an ordinary static LTI network and returns a very large symbolic transfer. An `inverter`-symbol reconstruction is rejected because `inverter` has no small-signal model. Neither path evaluates loop start-up. | **High:** the MOS path can look authoritative while answering the wrong problem. |
| Q2 and Q4, ring phase noise and scaling (PDF p. 3; printed p. 10) | Device noise sources, periodic operating point, impulse-sensitivity/noise conversion, and width-dependent device parameters | No noise sources, phase-noise quantity, periodic operating point, or retained MOS width/length metadata exist. A width sweep produced the same symbolic equation, and the supplied `width` option was not retained by `ComponentInstance`. | **Explicitly unsupported, but insufficiently guarded.** |
| Q5 and Q6, supply resistance of an operating ring (PDF p. 3; printed p. 10) | A distinction between quiescent small-signal impedance and the periodically switched charge/discharge behavior of an oscillating ring | A three-stage MOS ring produced a static expression dominated by `g_m`, `g_mb`, and `r_o`. Approximation switches shortened or changed it but did not identify the periodic operating state. | **Wrong-domain result:** must not be presented as the operating oscillator's supply resistance. |
| Q7 and Q8, StrongARM initial gain (PDF pp. 3–4; printed pp. 10–11) | Linearization in a named clock phase, initial conditions, regenerative latch state, and capacitance-dependent transient behavior | Capacitors can be stamped as `1/(sC)`, but there is no clock phase, switch state, initial-condition, or regenerative transient model. | **Unsupported metric.** |
| Q9–Q15, comparator/divider speed, clock sizing, quadrature, and feedforward paths (PDF p. 4; printed p. 11) | Clocked MOS states, charge sharing, propagation delay, device sizing/parasitics, and phase relationships across cycles | Logic/inverter symbols have no symbolic device model. A MOS reconstruction would still lack clock sequencing, delays, charge storage, and width-derived capacitances. | **Unsupported topology and metric.** |
| Q16, feedback LNA noise optimization (PDF p. 5; printed p. 12) | MOS/resistor thermal noise, channel noise, noise transfer, source termination, and noise factor under an impedance constraint | The engine can keep finite `r_o`, but has no noise-source primitives, spectral densities, correlations, or NF query. | **Unsupported metric.** Finite `r_o` alone is not a noise model. |
| Q17, two-stage shunt-feedback TIA input impedance (PDF p. 5; printed p. 12) | Linear small-signal KCL plus a general feedback/Miller reduction using the unloaded gain of the whole forward amplifier | The exact nodal path succeeds. The generalized Miller pass now identifies `R_F` across the two-stage endpoint path, preserves the exact KCL result, and emits a shared `A_{v,RF}` alias with the expanded unloaded gain definition. | **In-scope improvement.** The alias keeps the textbook dependency visible while retaining the full symbolic derivation. |
| Q18 and Q19, LDO/VCO noise and tail-capacitor effects (PDF pp. 5–6; printed pp. 12–13) | Supply pushing, device noise, periodic noise conversion, class-C conduction, flicker upconversion, and possible low-frequency periodic instability | None of these quantities or operating regimes is represented. Static `sC` and `sL` elements are insufficient. | **Unsupported metric and operating regime.** |
| Q20, quadrature-oscillator frequency shift (PDF p. 6; printed p. 13) | Coupled-oscillator eigenmodes, resonator loss/Q, phase relation, and perturbation of the oscillation frequency | A cross-coupled LC test returns a large rational transfer/impedance expression but no eigenfrequency, mode, or coupling-induced shift. | **High:** a frequency-domain expression is not an oscillation-frequency result. |

## Additional implementation defects exposed by the audit

### Parameter identity is a naming edge case

Ordinary device names are globally unique and use the concise textbook form `M1`, `M2`, …, so their indexed symbols are unambiguous. Non-standard names such as `MN_1` retain their complete identity when rendered symbolically; the analyzer now emits `g_{m,MN_1}` and `r_{o,MN_1}` instead of reducing them to a trailing-number alias. This is a defensive naming rule, not a topology limitation.

The same rule applies to `r_o`, `g_{mb}`, and `r_{ds}` symbols.

### “Successful solve” does not establish semantic validity

The generic KCL engine can solve a closed transistor loop without knowing whether a DC operating point exists, whether that point is stable, or whether the intended circuit is periodically time-varying. Equation count versus unknown count is only an algebraic check. It is not an operating-point, stability, or applicability proof.

### Device sizing is intentionally outside this audit's static scope

`ComponentInstance` does not retain MOS width/length or bias-point metadata. Sizing-trend questions in the paper therefore remain outside the current symbolic contract; they should not be inferred from a static `g_m`/`r_o` equation.

## Recommended improvements

### 1. Make the static small-signal boundary explicit

Keep the current contract focused: single-ended, linearized, symbolic KCL around a user-declared bias context, with optional LTI `s` elements. Switched/transient, periodic/oscillator, and noise questions should be labeled outside scope rather than approximated by a static equation. A concise capability message is useful, but a new large-signal or noise engine is not a prerequisite for the current workflow.

### 2. Generalize feedback and Miller reduction

Treat Miller's theorem as a graph reduction, not a gate-drain pattern:

1. identify any feedback impedance between two selected nodes;
2. remove that impedance from a disposable model;
3. derive the unloaded forward ratio between its endpoints, including multi-stage paths and differential half-circuits;
4. validate polarity and that the ratio is defined under the chosen assumptions;
5. form the two equivalent shunts and simplify;
6. retain the exact original KCL result next to the reduced form.

This now addresses the representative Q17 path without adding a TIA special case. The bounded graph solve should continue to decline ambiguous or unsolved paths, while exposing which impedance was removed, which forward gain was used, and which assumptions enabled the reduction.

### 3. Strengthen canonical symbolic algebra

Before adding more topology recognizers, improve rational normalization:

- canonical numerator/denominator polynomials;
- exact cancellation of common factors;
- stable symbol ordering and identity;
- controlled factoring by physically meaningful groups;
- limit evaluation under explicit assumptions;
- expression-cost comparison so a rewrite is accepted only when it is simpler.

This will make the existing exact nodal engine a better foundation and prevent giant elimination-order-dependent expressions from being mistaken for insight.

### 4. Add loop/stability analysis before oscillator heuristics

A general user-selected loop break, test source, and return-ratio solve is a better next step than recognizing “ring oscillator” by shape. It supports amplifier stability and is also a prerequisite for responsible oscillator start-up reasoning. Pole/zero extraction then needs a normalized rational function of `s`.

### 5. Keep future dynamic domains separate

StrongARM timing, oscillator frequency, and periodic supply behavior require different models. If these become product goals later, add them as separate analysis domains; do not repurpose static `Z_in`, `Z_out`, or `A_v` as substitutes. Noise remains intentionally deferred.

## Suggested regression set

1. **Parameter identity:** ordinary `M<number>` names keep concise symbols; non-standard names such as `MN_1` retain their complete identity.
2. **General feedback:** Figure-14-like two-stage TIA must retain its exact KCL expression and reduce through an unloaded forward-gain alias without a topology-specific TIA formula.
3. **Static-scope guard:** switched/periodic/noise cases must not be presented as if a static impedance/transfer answered their dynamic question.

## Priority

The best near-term sequence is: generalized feedback/Miller reduction, canonical rational simplification, and then loop-gain/pole analysis. The parameter-identity rule is already a small defensive fix. Switched/transient, periodic-oscillator, and noise engines should remain separate later phases rather than being approximated by additional static topology cases.
