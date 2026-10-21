# Figures

What the tools put on the drawing is a **figure**: an analysis's plot, its
equations as a table, the kT/C noise table, the small-signal model, the
timing diagram, a parts table. Code: `src/core/figures.js` (identity,
listing, placement), `src/web/figure-annotate.js` (the tables); tests:
`test/figures.test.js`.

## Identity

Every member of a figure -- the labels and parts that draw it -- carries
the same `figure: { id, kind, source, key }`, saved with the design
(`LabelInstance#figure`, `ComponentInstance#figure`):

| kind | source | drawn as |
| --- | --- | --- |
| `plot` | `small-signal`, `signal-flow`, `switched-cap` | a box with `plot` and its legend labels (`parent`); `key` its plot kind, quantity and role |
| `equations` | `small-signal`, `signal-flow`, `switched-cap` | one math table label, one per tool |
| `noise` | `switched-cap` | one math table label: the kT/C calculator's numbers |
| `model` | `small-signal` | drawing-only parts, their wires and labels |
| `timing` | `timing` | the timing diagram's labels (`timing`) |
| `table` | `sizing` | a parts table box; `key` the parts it lists |

`listFigures(circuit)` gathers them. A plot, parts table, or timing diagram
drawn before figures had an identity is known by what it carries; a plot of
that kind is any tool's. A pasted copy is no figure (plots and tables stay
known by their data).

## Annotating again

Snapshot figures -- plots, equation and noise tables, the model -- are
updated when the tool's Annotate (or Place) is pressed again: the figure of
that identity that is selected, else the only one, else a new one
(`chooseFigure`). An update keeps the figure's place, size and style and
replaces what it shows: a plot its data and legend, a table its text (its
top-left corner kept once the browser has measured it), a model its parts
from the same top-left corner. Live figures follow the design themselves:
a parts table is drawn from the parts, the timing diagram from the design's
timing once annotated.

## Placement

A new figure goes by its kind (`figureSpot`), measured from the circuit
itself (`coreBounds`: everything in no figure):

- **Right:** parts tables, equation tables, noise tables -- a column right
  of the circuit, from its top, each under the one before.
- **Below:** the timing diagram (centered, `timing-diagram.js`), the model
  and plots -- under the circuit and whatever is under it already, at its
  left edge.

Nothing moves a figure once placed, except **More → Arrange annotations**
(`figures --arrange`, `arrangeFigures`): every figure where a new one would
go, in order (tables, equations, noise; timing, model, plots), one undo
step. `figures` lists them.

## Tables

A table is one math label whose lines are TeX rows: `&` between columns,
`\hline` a rule, a line without `&` across every column
(`mathTableHtml` in `render.js`). `columns` (`l`, `c`, `r` each) aligns
them, an em apart; without it they align as TeX's `align` does (right, then
left, touching). It measures and saves its size as any math label does.
