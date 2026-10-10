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

Core keyboard vocabulary:

| Context | Keys |
| --- | --- |
| normal | `i` insert, `w` wire, `m` move, `Shift+M` detached move, `c` copy, `Shift+A` align to (selection outline edge/point, then another object's), `r` rotate, `Shift+R`/`Ctrl+R` mirrors, `x` check, `u`/`Shift+U` undo/redo |
| view | `f` fit, `#` grid, `Shift+C` crosshair, `Shift+G` guides, `Shift+D` theme, `Shift+P` side panel, `Shift+S` analysis window, `Shift+V` reference windows (another design beside this one, `src/web/reference-window.js`), `Shift+E` calculator (`src/core/calculator.js`, `src/web/calculator-window.js`), `Shift+W` oscilloscope (a signal-flow diagram's nets in time, `src/web/scope-window.js`), `Shift+Backspace` Atlas view ([`docs/atlas.md`](atlas.md)), `?` Learn (keys, tutorial, symbols, tips; `src/web/help.js`), `:` command line (log drawer), which also searches and runs every editor action by description (`src/web/command-line.js`) |
| editing | `dd`/Delete delete, `Ctrl/Cmd+C`/`Ctrl/Cmd+V` copy/paste, `Ctrl/Cmd+S` save, `Ctrl/Cmd+O` open, `/` or `Ctrl/Cmd+F` find (in the Atlas: search every design) / `Ctrl/Cmd+H` replace in label text (`src/core/label-search.js`), `9` net highlight tool, `8` remove all highlights, `Space` tap labelled wire stubs on the selected parts' unconnected terminals (`src/core/stubs.js`; a stub that would short is skipped), `q` swap the selected or pointed-at parts' type in place (`src/core/swap.js`), `g`/`v` over an unconnected pin wire a ground/supply to it (`src/core/pin-rails.js`), `.` repeat the last rotate, mirror, swap, rail, stubs, or tidy, `Shift+T` tidy the selection, `t`/`=`/`F2` edit the selected or pointed-at text (several selected switches or rails take one phase or rail name, `src/core/shared-labels.js`) |
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

What the editor's windows show for a design is saved with it
(`Circuit#windows`, `src/core/window-state.js`): the reference windows
(pasted pictures included), the calculator's results, the oscilloscope's
nets and stimulus, and the small-signal form. It is not drawing: undo and redo keep it
(`applyJson` replaces it only with `{ document: true }`), and it never makes
the design unsaved -- it is written with the next save, or on its own
(`saveWindowState`) when the design is left or the editor hidden with
nothing else unsaved. Every window resets to the shown document's own state
through `onDocumentShown` (main.js, counted by document loads, not by
circuit objects), so nothing of one design is left
showing in another.

The browser exposes `window.__circuit()`, `window.__run(command)`, and
`window.__load(state)` for isolated verification. Headless browser tests must
use one persistent CDP connection, temporary ports/directories, real mouse
events for double-click (`clickCount: 2`), and only terminate processes they
started. Never use a broad `pkill`.
