# Editor contracts

How the browser editor, its persistence, and its entry points behave:
the command language, documents and sync, the key vocabulary, the windows,
and what of them is saved with a design.

`runCommand(circuit, line, io)` in `src/core/commands.js` is the single command
language used by the prompt, `window.__run`, the CLI, and
`POST /api/circuits/<name>/cmd`. Add commands to both `dispatch()` and
`commandHelp()` and test success plus an error case.

The server serializes load/run/save per document and writes atomically. The
browser synchronizes the active document by revision/ETag and pauses polling
while hidden. Save invalidates stale sync responses. `src/server/documents.js`
and `src/web/persistence.js` are the persistence boundary; `data/` is not a
fixture directory. Each browser window keeps its own local draft
(`src/web/window-session.js`); when the CLI switches the active document, only
the most recently focused window follows, and none does while another window
already shows it.

A new design is named before its first save: its name field has focus, and
Enter there saves it. Ctrl+S with no name asks for one at the field (a ring
and a hint), except in browser-only mode with no writable folder, where the
save picker asks instead (suggesting `untitled.json`). Browser-only, the
first save to a file of its own (not into a folder) adds a one-time tip to
open a folder for the designs.

Core keyboard vocabulary:

| Context | Keys |
| --- | --- |
| normal | `i` insert, `w` wire, `m` move, `Shift+M` detached move, `c` copy, `Shift+A` align to (selection outline edge/point, then another object's), `r` rotate, `Shift+R`/`Ctrl+R` mirrors, `x` check, `u`/`Shift+U` undo/redo |
| view | `f` fit, `#` grid, `Shift+C` crosshair, `Shift+G` guides, `Shift+D` theme, `Shift+P` side panel, `Shift+S` analysis window, `Shift+V` reference windows (another design beside this one, `src/web/reference-window.js`), `Shift+E` calculator (`src/core/calculator.js`, `src/web/calculator-window.js`), `Shift+N` notes (Markdown about the design, with mentions of its parts and nets: [`docs/notes-and-history.md`](notes-and-history.md)), `Shift+Z` sizing (below), `Shift+W` plots (a signal-flow diagram's responses, locus, swing, loop gain, and nets in time, `src/web/plots-window.js`), `Shift+Backspace` Atlas view ([`docs/atlas.md`](atlas.md)), `?` Learn (keys, tutorials, symbols, tips; `src/web/help.js`; the tutorials -- a 5T OTA drawn from scratch, a switched-cap integrator's clock, beats and H(z), a delta-sigma modulator's signal flow -- are `src/web/tutorial.js`, each step checked from the drawing or what the windows show; `tutorial sc` / `tutorial sdm` on the command line), `:` command line (log drawer), which also searches and runs every editor action by description (`src/web/command-line.js`) |
| editing | `dd`/Delete delete, `Ctrl/Cmd+C`/`Ctrl/Cmd+V` copy/paste, `Ctrl/Cmd+S` save, `Ctrl/Cmd+O` open, `/` or `Ctrl/Cmd+F` find (in the Atlas: search every design) / `Ctrl/Cmd+H` replace in label text (`src/core/label-search.js`), `9` net highlight tool, `8` remove all highlights, `Space` tap labeled wire stubs on the selected parts' unconnected terminals (`src/core/stubs.js`; a stub that would short is skipped), `q` swap the selected or pointed-at parts' type in place (`src/core/swap.js`), `g`/`v` over an unconnected pin wire a ground/supply to it (`src/core/pin-rails.js`), `.` repeat the last rotate, mirror, swap, rail, stubs, or tidy, `Shift+T` tidy the selection, `t`/`=`/`F2` edit the selected or pointed-at text (several selected switches or rails take one phase or rail name, `src/core/shared-labels.js`) |
| beats | `Shift+B` beats window, `Shift+K` timing diagram editor, `+` add a beat, `Alt+→`/`Alt+←` (or PageDown/PageUp) step, `h` hide / `Shift+H` dim the selection from this beat on, `s` flip switches, `Shift+F5` present |
| wire/insert | Enter commits, Escape cancels; `F3` toggles new-wire routing mode; `/` flips the draft corner; hold `Alt` for symmetric placement/copy or cursor snapping to the nearest terminal or free wire end while wiring; a click on a free wire end (`Circuit#openWireEnds`) finishes a draft there like a terminal; a placed, moved, or copied part's pin that will join a pin, a free wire end, or (unconnected) a wire's middle on commit is ringed first (`pinJoinPoints`) |
| pointer | drag from a multi-terminal pin wires (drop in space opens quick-add); Ctrl/Cmd-drag copies a part, label, or annotation, or branches a wire; right-hold on paper, a pin, a part, or a wire for its radial menu (`src/web/radial-menu.js`: part palette, connect, swap, net), applied once on release, while a right-drag before the hold zooms to a box; Shift-drag in Delete is a knife that deletes every wire, part, and annotation it cuts; Space-drag pans; double-click paper inserts |

The side panel docks beside the drawing; the beats, timing diagram,
analysis, and reference windows are floating windows over it
(`src/web/floating-window.js`): one title bar to drag, a dock button and a
close × at its right, toggled from the toolbar's window group, the More
menu, or their keys. Docked (the button, or a drag to the pane's right
edge), a window becomes a section of the side panel that its title bar
folds and its top edge resizes; dragging the title bar out floats it
again. No window covers the tool rail itself (the paper below it is free).
Each window has a default place (its `place` option, `PLACE` in
`floating-window.js`): beats bottom center, the optimizer's run top center,
history and reference windows top left (each further reference window a
step lower and to the right), the calculator bottom left, the rest top
right. A window stays where it
is dragged (per window, in this browser); double-clicking its title bar
puts it back in its default place, keeping its size. The window with the
keyboard focus in it has its border and title bar in the accent. Pressing
a window gives it the focus (the control pressed, else the window itself),
and keys go to it rather than the drawing until the drawing is pressed;
Escape on a window holding the focus itself closes it, and so does the
window's own key (`toggleKey`: Shift+S, Shift+N, ...) pressed in it, unless
in a field being typed in. Shift+S opens the analysis with the keyboard in
it.
A reference window's × (or Escape) hides the last one shown, keeping its
design for Shift+V, and closes any other; with the keyboard in it, `f`
fits it, Ctrl+C copies its picture, and Shift+V hides the windows. Its
Clear, as the calculator's, empties it to pick a design or paste a picture.
Escape on the drawing lets go of one thing a press: a tool's draft or a
pending key, then the selection, and with nothing left the window at the
front (the one last opened or pressed; `closeFrontWindow` in
`floating-window.js`), so pressing it again and again closes every window,
the beats that open themselves with Alt+→ included. Inside a window,
Escape is the window's own first (a field being typed, a pick).

View toggles are handled before mode-specific keys, except printable insert
query text before a ghost exists. Any tool can be picked straight from another
(key or toolbar), dropping the old tool's uncommitted work as Escape would;
re-picking Wire keeps a half-drawn wire, and in Wire mode a letter naming a
terminal of the part being pointed at still picks that terminal.
`Ctrl+Shift+R` is intentionally unbound.
Selection is role-aware across components, labels, nets, annotations, and wire
runs; clicking a selected object again selects the next object stacked at that
point (`nextStackedSelection`), and a press there drags the selected one.
Component/managed-wire transactions are one undo entry.

`src/web/main.js` owns the editor's state and its core interaction; feature
modules split out of it reach that state through the `editor` accessor
(`editor-state.js`) and import `main.js` only as `./main.js`, the URL the page
loads. A module's `installX()` runs its load-time wiring where `main.js` calls
it, so the call's position keeps the original load order.

Settings → Display → Accent color picks the interface's accent (selection,
the active tool, focus) from the drawing's palette, or the default teal
(`src/web/accent.js`): a browser preference like the theme, shaded for
each theme, never part of a design or its exports.

Settings → Display holds the view toggles: Grid (`#`), Placement guides
(`Shift+G`), Crosshair (`Shift+C`), Dark theme, and Net beams
(`net-beams` on the command line). Every Settings choice is a browser
preference, kept between visits (`localStorage`). With net
beams on, while the pointer is over a net, or a port, supply, ground, or
VCM on it, a beam arched over the top runs from the cursor (snapped to the
grid; a supply, ground, or VCM's own terminal) to each other physical net
its name virtually connects it to, landing on the terminal of a supply,
ground, or VCM there, else on that net's nearest wire (`src/core/net-beams.js`,
`src/web/net-beams.js`). The beams show nothing during a drag or a
side-panel hover.

The sizing window (`Shift+Z`, `src/web/sizing-window.js`) is a grid of
every transistor's W, L, m and size-label placement and every passive's or
source's value (`tableParts`, `src/core/parts-table.js`), filled like a
spreadsheet: a range of cells (drag, Shift+click, Shift+arrows) selects its
parts on the canvas; typed text goes to every cell of the range whose column
accepts it, Delete clears, Ctrl/Cmd+C copies the range as tab-separated
text (Ctrl/Cmd+X cuts), and Ctrl/Cmd+V pastes it repeated over the range as
a spreadsheet does: one cell fills it, one row fills every row of it, a
larger block goes from its top-left cell. These keys stay the grid's: the
canvas copies and pastes no parts while it has focus. Each edit or paste is
one undo step; a cell that cannot take its text is skipped and counted. A
size made in the window draws no label (`hidden`): the parts table is where
it is read; the Label cell's menu (Hidden, Below the name, Instead of the
name), for a size or a passive's value alike, as the canvas menu's Sizing
and Value offer, changes the cell's row, or every row of the range when the range
holds it. A W or L typed without the other is held in the window (marked)
until both make a size; nothing else is kept there, so the grid redraws
from the design on every change. Annotate adds a
parts table to the drawing ([`model.md`](model.md)).

More → History (`:history`) lists the design's save points and checkpoints,
kept in its file ([`docs/notes-and-history.md`](notes-and-history.md)).

What the editor's windows show for a design is saved with it
(`Circuit#windows`, `src/core/window-state.js`): the reference windows
(pasted pictures included), the calculator's results, the time-domain plot's
nets and stimulus, and the small-signal form. It is not drawing: undo and redo keep it
(`applyJson` replaces it only with `{ document: true }`), and it never makes
the design unsaved -- it is written with the next save, or on its own
(`saveWindowState`) when the design is left or the editor hidden with
nothing else unsaved. Every window resets to the shown document's own state
through `onDocumentShown` (main.js, counted by document loads, not by
circuit objects), so nothing of one design is left
showing in another.

Two more things a file carries never make a design unsaved, and are only
written with a real save: the names it was saved under (`names`,
[`hierarchy.md`](hierarchy.md)), and the size this browser measured a math
label, or an aligned plain annotation, at (`mathBox`; reopened, the label
is measured against it rather than the estimate, so it never steps
sideways). Nor does its save history (`history`), which the
history window writes to the file as it changes. Opening a design, measuring its math, and leaving it
changes nothing on disk (`drawingText`, `windowsChanged` in
`src/web/document-session.js`).

The browser exposes `window.__circuit()`, `window.__run(command)`, and
`window.__load(state)` for isolated verification. Headless browser tests must
use one persistent CDP connection, temporary ports/directories, real mouse
events for double-click (`clickCount: 2`), and only terminate processes they
started. Never use a broad `pkill`.
