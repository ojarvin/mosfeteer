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
included).

**The clock** is one input: the flip-flops' clock net nothing drives, else
the one input that reaches them only through gates (a gated clock), else
the one chosen -- `analyze logic --clock NET`, or **Clock** in the window
(saved with the design as `analysisValues.logic.clock`), offered when
several inputs could be it. It takes no column, and may reach nothing but
clock pins (through gates). The other flip-flops may be clocked from it
through logic: a ripple counter's stages each clocked by the stage before.

**A row is one period of the clock**: it rises, then falls, and after each
edge every flip-flop whose clock just had its edge (rising, or falling for
`CLKB`) takes its D, all together, until no more edges ripple through.
Delays are zero, so a clock through logic has clean edges: the table says
so (glitch-free) whenever a flip-flop is clocked through logic. With every
flip-flop on the clock itself and one edge, the table says "On each rising
(falling) edge"; otherwise "After each period", rippling when stages clock
others. A ripple counter's passing states are not rows: the table shows
where each period settles.

A latch's next state is what it holds once its enable has been and gone
(Q⁺ = EN·L + EN̄·Q). A reset (`RST`, active-low `RSTB`) forces the state,
and Q, to 0.

## What it refuses

It says why rather than guessing:

- a loop through gates with no flip-flop or latch in it (a latch drawn
  from gates: draw a latch part);
- two drivers on one signal, unless all are tri-state; a signal tied to
  both rails, or to a rail and driven;
- a part that is not logic (or a port, rail, or junction) on a logic signal;
- more than one clock input wired to the flip-flops; a clock left open with
  none chosen (it names the choices); no flip-flop clocked from an input;
  a clock that reaches anything but clock pins (an output, a data pin, a
  latch); flip-flops that clock themselves or each other (they would race);
- more than 12 inputs and states together (4096 rows).

## Expressions and annotations

Each output, and each next state, is a sum of products minimized by
Quine–McCluskey (the prime implicants, the essential ones, then the fewest
more, the larger first), written with `\overline` for a complement and
`\cdot` between literals; names follow `logicNameTex` (`Q0` → Q₀, `SEL`
upright, `U1.a` as text, a bus bit `\mathrm{D}[3]`). **Annotate… → Table** puts the table on the drawing
(names over a rule, a blank column between what goes in and what comes out;
up to 64 rows and 16 columns), **Annotate… → Equations** the equations, each whole
in one column, each one figure (`figure` kind `table` and `equations`, source `logic`) updated in
place when annotated again.

## Synthesis

The analysis window's **Synthesis** mode (`src/web/logic-synthesis-ui.js`)
and `synthesize logic` go the other way (`src/core/analysis/logic-synthesis.js`):
named inputs and outputs, and each output's value in every row of the truth
table, as minimized gates drawn with their ports.

- **The table**: up to 8 inputs (the first the most significant, the rows
  counting up in binary) and 8 outputs, named separated by spaces (or
  commas). A bus range, `D[3:0]` or `D<3:0>`, is its bits, first to last,
  each a port and a column of its own; the field shows a run of bits as
  the range again (`signalNames`, `compactNames`). A value is 0 (the default), 1, Z
  (not driven), or – (either; `x` reads as –). A cell steps through them on
  a click, or takes a typed 0, 1, Z, -, or X and moves down. Inputs added or
  removed keep the table: a row takes the row with the same inputs, an input
  new to it counted 0. The table, the style, and the gates are saved with
  the design (`analysisValues.synthesis`).
- **Equations**: each output minimized by the same Quine–McCluskey, the –
  rows free. An output that is Z in some rows is a tri-state buffer: its
  enable is 1 in the rows that are not Z, its data free in those that are.
- **Style**: AND–OR (sum of products), NAND–NAND, OR–AND (product of sums,
  the complement's sum of products), or NOR–NOR. NAND–NAND and NOR–NOR use
  that gate alone, inverters if allowed.
- **Gates**: the allowed gates (inverter, AND, NAND, OR, NOR) and the most
  inputs a gate has (2 or 3). A gate not allowed is made from the others
  (AND as NOT NAND, as NOR of the complements, ...); a complement with no
  inverter is a NAND or NOR with its inputs tied; more inputs than a gate
  has fold into the fewest gates. Products shared by outputs are built once.
  An output that is an input, its complement, a constant (a ground or a
  supply on the pin), or another output's signal is a buffer, so each
  output port has a net of its own.
- **Check**: the gates are simulated over every row against the table
  before anything is drawn; the logic mode reads a drawing back as the
  table that drew it.
- **Draw** puts the checked equations' gates on the drawing, right of what is
  there, as one undo step, in columns by depth and rows shared by every
  column. A gate of the first column starts a row; a later gate stands in
  the row of what it reads from the nearest column, level with it by any of
  its pins, so that wire runs straight (of equal sources, one leaving it
  clear of the gates already in its column, nearest the others). Back the
  other way, a gate fed by rails alone moves level with a pin of a gate
  that reads it, one no other gate feeds straight. A gate's pins are given
  out in the order that turns the fewest wires, then crosses the fewest,
  then rails first. A gap between rows that a
  wire runs along is two cells taller in every column. Between columns, a
  track for each wire that turns on its way in, each turn from the middle
  of its channel out (or on a turn its net already makes); gates in a
  column six cells apart at least (a whole row when joined by name, their
  inputs' names above and below them). The output ports are a column of their
  own just past the gates, level with their gates where three cells apart
  (the gates furthest right first); the rest take the nearest level, above
  or below, that passes the gates right of theirs a cell from each and
  from its name.
  - Up to 4 inputs, each input and its complement is a rail that the first
    column taps. With no complement gates, the input ports stand beside the
    rails, two cells apart from the highest tapped row down, each on a row no rail left of
    its own is tapped on; with them, the ports and complement gates are a
    header above the gates. Past 4 inputs, a stub named for the input on
    each gate input.
  - The wires are drawn, not routed: from a rail along a free row; from a
    gate's output straight when level, else turning once in a free channel
    before the pin's column, else down a channel after the gate to a free
    row and along it. A row and a channel are free when the wire keeps a
    cell from every part, clear of the labels, and neither runs along
    another net's wire nor ends on one. A tri-state's enable, and a wire
    with no free way, goes to the router; one the router cannot make is
    joined by name (a stub each end, `n1`, `n2`, ... or the output's name);
    where even that finds no room, the inputs are joined by name, then every
    connection.
  - A part or net already named as an input or output is refused, the
    drawing left as it was.
- **Names** in the table and equations: a bus bit upright with its bit in
  square brackets (`\mathrm{D}[3]`), any other as the logic mode writes it.
- **The command**: `synthesize logic D[1:0] T[2:0]=0001,0011,0111`: the
  inputs by name, each output `NAME=VALUES`, a bus output a value string
  per bit separated by commas.
- **Annotate… → Table** puts the truth table on the drawing as the logic
  mode does (Z as Z, – as a dash; up to 64 rows and 16 columns), **Annotate…
  → Equations** the checked equations, each whole in one column as the
  other tools' equations are (`figure` kind `table` and `equations`, source
  `synthesis`).
