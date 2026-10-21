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

A new figure is packed among what is drawn (`figureSpot`, given its size):
it keeps clear of the circuit (`coreBounds`: everything in no figure) by
three cells and of every figure by two. The spots tried are the kind's own
place -- a table, equation or noise table right of the circuit at its top;
the timing diagram centered under it; a model or plot under it at its left
edge -- and every edge of what is there, never left of or above the
circuit. The spot that grows the whole drawing least wins, and of those the
one nearest the kind's place. So a table taller than the circuit pushes a
wide model under it, while a narrow plot still fits under the circuit
beside the table.

A table is placed from its estimated size; once the browser has measured
it, a new one that no longer fits where it was put is packed again.

Nothing moves a figure once placed, except **More → Arrange annotations**
(`figures --arrange`, `arrangeFigures`): every figure packed again, in order
(parts tables, equation tables, noise tables, timing, models, plots), each
clear of those before it, one undo step. `figures` lists them.

## Tables

A table is one math label whose lines are TeX rows: `&` between columns,
`\hline` a rule, a line without `&` across every column
(`mathTableHtml` in `render.js`). `columns` (`l`, `c`, `r` each) aligns
them, an em apart; without it they align as TeX's `align` does (right, then
left, touching). It measures and saves its size as any math label does.
