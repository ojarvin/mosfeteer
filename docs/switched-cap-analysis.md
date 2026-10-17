# Switched-capacitor analysis

The analysis window's third mode (`Shift+S`, then **Switched-cap** at its
top): the exact z-domain transfer function of a drawn switched-capacitor
circuit, by charge conservation from phase to phase. A drawing with switches
and capacitors and no transistors, resistors, or other devices opens in it.
Code: `src/core/analysis/switched-cap.js` (the analysis),
`src/core/analysis/switched-cap-noise.js` (its kT/C noise),
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

An op-amp is modeled as its small-signal parameters say (`opampModel`,
[`symbolic-analysis.md`](symbolic-analysis.md)). Ideal, an `opamp`'s inputs
are at one voltage and draw no current; with **finite gain** its output is
A times their difference (A1 for U1: v_ip - v_im - v_o/A = 0), so a virtual
ground sits at -v_o/A and an integrator leaks -- its pole moves inside the
unit circle, to the ideal one as A grows. An `opamp_diff` does the same with
its outputs' difference, its outputs averaging to ground (an ideal
common-mode feedback). A gain-bandwidth model is refused: it needs settling
in time within a phase, which charge from phase to phase does not see. The netlist is the small-signal analysis's
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

## kT/C noise

Asked for (`noise: true`; the window's **Noise** checkbox), each phase's
switch noise as it is frozen on the capacitors at the phase's end. Settled,
the phases' samples are independent of each other and from period to period:

- **Sampling**, by equipartition. With the op-amps' terminals held, every
  other node that touches a capacitor moves as its closed switches let it:
  switched to something held, freely; a group switched to nothing held,
  keeping its charge. Each independent way the capacitor voltages can move
  holds kT: their covariance is kT B (B^T D B)^-1 B^T, B a basis of the moves,
  D the capacitances. Nodes joined neither by a capacitor nor by a switch
  into an unheld group are separate contributors (both halves of a
  differential circuit grounding a plate are two rows, not one).
- **The op-amps** then move the sampled charge on as they move signal
  charge: a virtual ground's group keeps its charge, so what a switch drew
  from it is made up through the feedback capacitor.
- **To the output**, what phase j leaves reaches the output read at phase m
  by the signal's own phase maps: N_j(z) = y (M_(K-1) ... M_(j+1)) + [j < m]
  c (M_(m-1) ... M_(j+1)), with y = z^-1 c (M_(m-1) ... M_0) (I - z^-1 Phi)^-1
  solved once for every phase. Each path over H(z) first (they share H's
  denominator), the input-referred noise per sample is R G^-1 R(1/z)^T, over
  kT.

Each contributor is a row: the switches it samples through, its capacitors,
its phase, and its input-referred noise over kT in the same symbols as H(z)
(1/C_S for each phase of the integrator, 2/C_S in all; the same with a finite
gain, which moves noise and signal alike). The op-amps' own noise is not
modeled. A result past reading in symbols (unmatched differential halves,
each capacitance its own symbol) is refused within a second, and the
calculator still gives its numbers.

**The calculator** (`switchedCapNoiseFigures`) takes a number for every
symbol (farads, gains), the temperature in °C, and f_s; it solves the same
analysis with the numbers put in before solving, so it is quick for any
circuit. Per contributor and in total: the input-referred RMS over the band
to f_s/2 (kT times the mean of the noise ratio over the unit circle), and the
density of the white noise with that RMS, rms / sqrt(f_s / 2).

## The window

It works as the other modes do. **Signals** picks the input and output --
the drawing's ports of that role (input, output, in/out, or plain ports)
first, then every net, by name or, unnamed, by id; one of each is found when
the drawing has only one -- and the state to read at. **Phases** lists the
clock. **Derive** (or Enter) gives the equation, with its poles and zeros at
the capacitances' numbers, and adds it to the Plots window's graph (`Shift+W`)
as each Derive adds its gain to the Bode graph: magnitude over phase on one
f/f_s axis, a legend naming each trace by its ratio (V_OUT/V_IN, as the
signal-flow graph's) to show or take off, **Clear graph**, and
**Annotate graph** to put it on the drawing (`placeResponsePlot`).
**Values** are rows (`src/web/value-row.js`, shared with the small-signal
Values): a slider over E24 steps and a field -- each capacitance (1 unless
set, three decades either way) and each finite gain (60 dB unless set, from 1
to 10^6).
**Noise**, checked, works the kT/C noise out with each Derive: its table, as
the small-signal noise table, a row per contributor (pointing at one lights
its switches and capacitors on the drawing). The **Noise calculator** under
it takes each symbol's value (1p unless set), T (27 °C) and f_s (1M), and
gives each row's RMS and density and their total.
**Annotate equation** writes the equation under the drawing. The choices and
numbers -- the noise switch and the calculator's fields too, as typed -- are
the design's (`Circuit#analysisValues.sc`): saved with it, one undo step a
finished adjustment, never making it unsaved.

Not yet: parasitic capacitances (the integrators are stray-insensitive by
design, so these would show which ones are not), and the op-amps' own noise.
