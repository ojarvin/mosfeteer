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

Figures are packed as one (`placeFigure`, given a new figure's size). The
circuit (`coreBounds`: everything in no figure) and the figures moved by
hand stay; the figures packing placed -- each remembers where
(`figure.placed`), and one still there is packing's to move -- and the new
one are packed again around them. Figures are measured by their ink (what
they draw, `inkRect`), not their labels' boxes. Each keeps three cells from
the circuit and two from every figure, never left of or above the circuit.
Several orders are tried (every one for up to five figures), each figure
taking the spot, among its kind's own place and the edges of what is there,
that leaves the drawing smallest; the layout whose drawing is smallest
wins, a little more costly for each figure away from its kind's place
(`anchorFor`): a table goes in the column right of the circuit, under the
tables there; a model or plot continues that column while it still reaches
beside the circuit (the space under the equations, beside a taller
circuit), else goes under the circuit at its left edge; the timing diagram
is centered under it. Moves are whole cells, so parts stay on the grid. So
the order things are annotated in makes no difference, and a figure dragged
somewhere stays there.

A table is placed from its estimated size; once the browser has measured
it, it and the packed figures are packed again.

**More → Arrange annotations** (`figures --arrange`, `arrangeFigures`)
packs every figure, those moved by hand too, one undo step. `figures`
lists them.

## Annotating

The analysis window's **Annotate…** (`src/web/annotate-menu.js`) lists
what the mode on screen can put on the drawing -- its equations, the
small-signal model, its graph, the kT/C noise table -- each marked ✓ when
it is there already, choosing it updates it; **Everything** puts every one
there. Each mode registers its items (`registerAnnotations`). The Plots
window's and the noise calculator's own Annotate buttons do the same for
what they show.

## Tables

A table is one math label whose lines are TeX rows: `&` between columns,
`\hline` a rule, a line without `&` across every column
(`mathTableHtml` in `render.js`). `columns` (`l`, `c`, `r` each) aligns
them, an em apart; without it they align as TeX's `align` does (right, then
left, touching). It measures and saves its size as any math label does.
