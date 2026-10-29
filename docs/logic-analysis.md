# Logic analysis

The analysis window's **Logic** mode (`src/web/logic-ui.js`) and
`analyze logic` read a drawing of logic parts (`src/core/analysis/logic.js`):
the truth table, and each output as a minimized sum of products. With
flip-flops or latches it is a state transition table instead. The window
opens in this mode for a drawing of logic parts with nothing analog in it.

## Parts and signals

- **Logic parts**: inverter, buffer, AND, NAND, OR, NOR, XOR, XNOR (2 and
  3 inputs), `mux2` (`a` at `s` = 0, `b` at `s` = 1), tri-state inverter
  and buffer (driving while `en` is 1), D flip-flops and latches with their
  inverted-clock, reset, and `QB` variants.
- **Signals** are nets, joined by name as elsewhere; a logic pin wired to
  nothing is a signal of its own, named by the pin (`U1.a`). An unnamed net
  is named by the pin that drives it.
- **Inputs**: input (and in/out, plain) ports, and the signals nothing
  drives. **Outputs**: output (and in/out, plain) ports, and logic outputs
  that drive nothing. A flip-flop's or latch's Q is its state, not an
  output; its pins wired to nothing are not outputs either. Ground and a
  supply on a logic signal are 0 and 1.
- **Values** are 0 and 1, `Z` where every tri-state driver of a signal is
  off, and `X` where drivers disagree or an input is unknown (a `Z` read by
  a gate is `X`). An output that is `Z` or `X` anywhere has no sum of
  products.

Columns are sorted by name (`A`, `B`, `Q0`, `Q1`, ...), the first the most
significant, so the rows count up in binary.

## Sequential logic

The state transition table has the present state (each flip-flop's and
latch's Q) and the inputs on the left, the next state (Q⁺) and the outputs
on the right; the outputs are read in the present state (Mealy outputs
included). The flip-flops share one clock: an input that takes no column,
named under the table with its edge. A latch's next state is what it holds
once its enable has been and gone (Q⁺ = EN·L + EN̄·Q). A reset (`RST`,
active-low `RSTB`) forces the state, and Q, to 0.

## What it refuses

It says why rather than guessing:

- a loop through gates with no flip-flop or latch in it (a latch drawn
  from gates: draw a latch part);
- two drivers on one signal, unless all are tri-state; a signal tied to
  both rails, or to a rail and driven;
- a part that is not logic (or a port, rail, or junction) on a logic signal;
- flip-flops on more than one clock, or on both edges of one; a clock that
  comes from logic, or also feeds anything but clock pins;
- more than 12 inputs and states together (4096 rows).

## Expressions and annotations

Each output, and each next state, is a sum of products minimized by
Quine–McCluskey (the prime implicants, the essential ones, then the fewest
more, the larger first), written with `\overline` for a complement and
`\cdot` between literals; names follow `logicNameTex` (`Q0` → Q₀, `SEL`
upright, `U1.a` as text). **Annotate… → Table** puts the table on the drawing
(names over a rule, a blank column between what goes in and what comes out;
up to 64 rows and 16 columns), **Annotate… → Equations** the equations, each
one figure (`figure` kind `table` and `equations`, source `logic`) updated in
place when annotated again.
