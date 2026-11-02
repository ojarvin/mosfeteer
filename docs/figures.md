# Figures

What the tools put on the drawing is a **figure**: an analysis's plot, a data plot, its
equations as a table, the signal-flow coefficients table, the kT/C noise table, the small-signal model, the
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
| `plot` | `data` | a data plot: a box with `plot` (`kind: 'data'`) and its legend labels |
| `equations` | `small-signal`, `signal-flow`, `switched-cap` | one math table label, one per tool |
| `coefficients` | `signal-flow` | one math table label: headings, a rule, a row per coefficient (name, value) |
| `noise` | `switched-cap` | one math table label: the kT/C calculator's numbers |
| `model` | `small-signal` | drawing-only parts, their wires and labels |
| `timing` | `timing` | the timing diagram's labels (`timing`) |
| `table` | `sizing` | a parts table box; `key` the parts it lists |

`listFigures(circuit)` gathers them. A plot, parts table, or timing diagram
drawn before figures had an identity is known by what it carries; a plot of
that kind is any tool's. A pasted copy is no figure (plots and tables stay
known by their data).

## Annotating again

Snapshot figures -- plots, equation, coefficients and noise tables, the model -- are
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
wins. A drawing's size is its area, scaled by its aspect ratio past 3:1
(a 9:1 strip counts three times its area), so the figures of a wide, low
circuit make a block under it rather than a strip beside it; a layout is a little more
costly for each figure away from its kind's place
(`anchorFor`): a table goes in the column right of the circuit, under the
tables there; a model or plot continues that column while it still reaches
beside the circuit (the space under the equations, beside a taller
circuit), else goes under the circuit at its left edge; the timing diagram
is centered under it. Moves are whole cells, so parts stay on the grid. So
the order things are annotated in makes no difference, and a figure dragged
somewhere stays there.

A table is placed from its estimated size; once the browser has measured
it, it and the packed figures are packed again.

**More → Arrange figures** (`figures --arrange`, `arrangeFigures`)
packs every figure, those moved by hand too, one undo step. `figures`
lists them.

## Annotating

The analysis window's **Annotate…** (`src/web/annotate-menu.js`) lists
what the mode on screen can put on the drawing -- its equations, the
small-signal model, its graph, the coefficients table, the kT/C noise table -- each marked ✓ when
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

## Data plots

A data plot is columns of numbers read from a text file: CSV, TSV, or
columns separated by spaces (`src/core/csv-data.js`, `src/core/data-plot.js`,
`src/web/data-plot-ui.js`; tests `test/csv-data.test.js`,
`test/data-plot.test.js`, `test/browser/data-plot.test.js`).

- The file is read once and never kept. The plot keeps its traces as
  `[x, y]` points to six digits, up to 8 traces of 2000 points (a longer
  trace is thinned, keeping each stretch's lowest and highest point), each
  axis's name and scale (`linear`, `log`), its zoom (`view`), and the
  file's name.
- Reading guesses the separator (tab, semicolon, comma, spaces), the
  decimal sign (a comma when the separator is not one), and the rows
  before the data; the last of those names the columns when it has a
  name for each. Lines starting with `#`, `%`, or `//` are comments. A
  cell is a number or a value with an SI suffix (`2.2k`); anything else
  is a gap. The first column of numbers is x and the next ones are the
  traces; a positive column over more than three decades is suggested a
  log scale.
- **More → Data plot…** chooses the file and shows the guesses, the first
  rows, the columns, the scales, and the plot as it will be drawn; Place
  packs it as a plot. `annotation dataplot FILE` does the same from the
  CLI, which reads the file and sends it with the command.
- **Plot settings…** (right-click, or double-click) sets each axis's name
  and scale, each trace's name and color or its removal, and the zoom,
  panned and zoomed in the window's plot; Apply is one undo step. **Read
  file…** reads a file into the plot, keeping its place, axes, and zoom.
  Commands: `annotation plotaxis`, `plotview`, `plottrace`.
- Annotating and Update plots never touch a data plot.

