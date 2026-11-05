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
  rows, and the columns to plot; under them is the plot editor that
  **Plot settings…** (right-click, or double-click) shows too: the plot to
  pan and zoom, each axis's name and scale, and each trace's name, color
  (a palette swatch), place in the list, or removal: a trace lower in the
  list draws on top. The plot keeps the zoom shown. Place
  packs the new plot; Apply is one undo step. A double-click on the plot
  opens its settings.
- **Add file…** adds another file's traces to the plot, up to 8 in all,
  their legend entries under the others; the dialog shows the plot's own
  traces with them, to edit too. **Replace file…** replaces the traces,
  keeping the plot's place, axes, and zoom. The plot names every file its
  traces came from.
- An analysis plot (a response, step, waveform, swing, or root locus)
  takes traces from files too (`plot.extra`, `[x, y]` in its own units),
  drawn over its own curves and dashed on after them in black, their
  legend entries after its curves' (and after a simulated spectrum's,
  which has its own entry, gray in black). The plot's range holds them. Its **Plot settings…** (right-click,
  or a double-click anywhere on it) edits those traces and its zoom, and
  on a response plot shows or hides each of its own curves and spectra
  (`hidden`: kept in its data, drawn again once shown, with no legend
  entry while hidden; an update keeps it hidden, `setPlotTracesShown`); its
  axes are the analysis's. Adding to a response reads x in rad/s or Hz
  (×2π) and a magnitude in dB or as a ratio (20 log10). Updating the plot
  from its analysis keeps them. A Bode sketch takes none, and a
  double-click on it opens nothing.
- **Markers** in the plot editor (`plot.cursors`, `src/core/plot-cursors.js`),
  up to 8: **Point** (`m`) sits on the trace nearest the pointer and reads
  its x and y; **Vertical** (`v`) and **Horizontal** (`h`) lines read each
  trace's y, or x, where they cross it. Each is placed where the pointer
  is, drags on the plot (a point to the trace nearest the pointer), and
  takes a typed x or y (a point its trace too). The numbers go small
  beside what they read, clear of one another; **Values** off leaves them
  out (`cursorValues: false`). The drawing's plot shows them as the
  editor does. A point names its trace by id (the plot's own traces from
  0, then those from files), followed when traces move or go; an update
  from the analysis keeps the markers.
- A renamed trace's legend entry keeps its left edge beside the plot, and
  a legend entry renamed on the drawing renames its trace.
- `annotation dataplot FILE` places a plot from the CLI, which reads the
  file and sends it with the command (`--into PLOT` adds it to a plot,
  `--hz` and `--ratio` for a response's units);
  `annotation plotaxis`, `plotview`, and `plottrace` (`--color` a palette
  name, `--position M` a place in the list) edit it.
- Annotating and Update plots never touch a data plot.


## Exporting a plot's data

**Export data…** (any plot's right-click menu, `src/web/plot-export-ui.js`)
saves the numbers a plot keeps as CSV (`src/core/plot-export.js`; tests
`test/plot-export.test.js`, `test/browser/plot-export.test.js`): an
analysis plot's samples as rounded when annotated, a data plot's points as
thinned. The traces to include, the separator (comma, semicolon, tab),
and the decimal sign are chosen over a preview; a decimal comma takes a
semicolon. Traces on the same x values share one x column; otherwise each
brings its own; traces added from files come after the plot's own. Save
asks where or downloads; Copy puts the text on the
clipboard. `annotation plotcsv PLOT` gives the same text.
