# Switched-capacitor analysis

The analysis window's third mode (`Shift+S`, then **Switched-cap** at its
top): the exact z-domain transfer function of a drawn switched-capacitor
circuit, by charge conservation from phase to phase. A drawing with switches
and capacitors and no transistors, resistors, or other devices opens in it.
Code: `src/core/analysis/switched-cap.js` (the analysis),
`src/web/switched-cap-ui.js` (the mode, registered on the window's mode bar
by `registerAnalysisMode` in `src/web/signal-flow-ui.js`); tests:
`test/switched-cap.test.js`, `test/browser/switched-cap.test.js`.

## The clock

The clock is the timing diagram (`timing`, [`beats.md`](beats.md)): one
period steps through its states -- each run of slots in which the same
phases are high (`timingStates`) -- and in each a switch is closed while its
phase is high. Without a diagram the beats are the states, one a beat, each
switch as that beat sets it. A drawing with neither is refused ("Draw a
timing diagram (or beats) first"), as is a clock of one state (nothing
switches). The window lists the states with the switches closed in each.

## The model

Within a state, closed switches join nodes into one. Every joined node is:

- **held**: on the AC ground (ground, a rail, an input port not under test)
  at 0, or on the input under test at its sample;
- **driven**: an op-amp's output, at whatever its feedback asks;
- **floating**: its charge -- over the capacitor plates on it, C (v - v_other)
  -- is what those plates held at the end of the state before (a period
  earlier across the period's start, one z^-1).

Op-amps are ideal: an `opamp`'s inputs are at one voltage and draw no
current; an `opamp_diff`'s also, with its two outputs averaging to ground (an
ideal common-mode feedback). The netlist is the small-signal analysis's
(`resolveAnalysisContext`): same-named nets are one node, every DC reference
is the AC ground, and other input ports are held there.

The input is a sample held for a whole period, u[n], as a sample-and-hold
drives it, and the output is read at the end of one state of that period
(**Read at**, the last by default): H(z) = V_out(z) / U(z). For the
stray-insensitive integrator (φ1 samples V_IN onto C_S, φ2 dumps it into the
virtual ground) that is (C_S/C_F) z^-1 / (1 - z^-1) read at the end of φ1 and
(C_S/C_F) / (1 - z^-1) at the end of φ2; the inverting one gives
-(C_S/C_F) / (1 - z^-1).

## Solving

What a period carries from state to state is each capacitor's voltage. Each
state is solved alone, its nodes in terms of the input and the voltages the
state before left -- a small exact system in the capacitances only -- giving
vc_k = M_k vc_(k-1) + n_k u. Around the period the last state's voltages
satisfy s = z^-1 Phi s + gamma u, the only system solved in z, as large as
the number of capacitors. A capacitor reset every period is a state the
input never reaches: its pole and zero cancel (`cancelCommonPolynomialFactor`
in z), and so do factors in the capacitances alone, each capacitance taken in
turn as the variable. The equation is shown in the textbook form, the
denominator's constant term 1 (`transferTex` with `symbolicLead`).

A capacitor is its value when that is a coefficient (`C_S`, `2*C_u`, `0.5`),
else its refdes (`CS`), as the small-signal analysis names it. Giving the two
halves of a fully differential circuit the same values lets the result
reduce: matched halves give each output half the single-ended integrator,
(C_S / 2C_F) z^-1 / (1 - z^-1).

The analysis refuses rather than guesses: a part an SC circuit is not made of
(a resistor, a transistor), an input switched to ground, an op-amp output
switched onto ground or the input or onto another op-amp's output, and a
state whose equations have no single solution (an op-amp without feedback, a
node nothing sets) each say so, naming the part or the state.

## The window

**Signals** picks the input and output ports (one of each is found when the
drawing has only one) and the state to read at. **Phases** lists the clock.
**Derive** (or Enter) gives the equation, with its poles and zeros at the
capacitances' numbers; **Capacitances** sets those numbers (1 unless set),
which also draw the magnitude and phase over f/f_s in the Plots window
(`Shift+W`). **Annotate equation** writes it under the drawing. The choices
and numbers are the design's (`Circuit#analysisValues.sc`): saved with it,
one undo step each, never making it unsaved.

Not yet: kT/C noise per sampling capacitor, finite op-amp gain, and parasitic
capacitances (the integrators are stray-insensitive by design, so these
would show which ones are not).
