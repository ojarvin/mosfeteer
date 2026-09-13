# Small-signal scope against Razavi's 2026 LLM test

Source: Behzad Razavi, [“Analog Design Experiments With AI—Part 2”](https://www.seas.ucla.edu/brweb/papers/Journals/BR_SSCM_2_2026.pdf), *IEEE Solid-State Circuits Magazine*, 2026.

This note defines the analyzer's boundary; it does not answer the paper's
design questions.

## Current contract

The analyzer derives symbolic linearized KCL around a declared bias context. It
models resistors, capacitors, inductors, MOS `g_m`, `g_mb`, and `r_o`, opens
independent DC current sources, shorts independent DC voltage sources, and
reports input impedance, output impedance, and voltage transfer. Optional
textbook approximations and eligible Miller reductions retain the exact nodal
result in the report.

The two-stage shunt-feedback TIA in Q17 is within this contract: its feedback
path can use the generalized Miller reduction when the required high-gain
assumption is explicit.

## Paper cases outside the contract

| Cases | Missing analysis domain |
|---|---|
| Q1, Q3, Q5, Q6, Q20 | Oscillator startup, phase, eigenmodes, frequency, and periodic supply behavior |
| Q2, Q4, Q16, Q18, Q19 | Device noise, noise conversion, noise factor, and periodic operating points |
| Q7, Q8 | Clock phase, initial conditions, regeneration, and transient gain |
| Q9–Q15 | Switched states, charge sharing, delay, sizing, and multi-cycle phase relationships |

Static `Z_in`, `Z_out`, or `A_v` results are not substitutes for those models.

## Scope boundary

The analyzer does not calculate operating points, stability, oscillator
frequency, transient timing, periodic behavior, noise, or device-sizing
trends. Those questions require separate analysis models.
