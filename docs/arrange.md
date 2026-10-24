# Arrange like

Selected parts drawn as another drawing of the same topology draws them.
Code: `src/core/topology-match.js` (the recognizer), `src/core/arrange.js`
(candidates, applying one), `src/core/arrange-builtins.js` (the built-in
cells), `src/web/arrange-ui.js` (the picker); tests: `test/arrange.test.js`,
`test/browser/arrange.test.js`.

## Entry points

- Editor: `Shift+Q` with two or more parts selected, the context menu's
  Arrange like…, or `:arrange-like`. A picker in the drawing's top right
  lists the ways; the highlighted one is drawn on the canvas. Arrows (or the
  pointer) move the highlight, Enter or a click keeps it as one undo step,
  `1`-`9` pick directly, Escape (or a press outside) leaves the parts as
  they were.
- Command: `arrange <refdes> ... [--list] [--pick N]`. Over HTTP the server
  passes the workspace's other designs (`io.designs`); the editor's `:` and
  `window.__run` search the open design and the built-in cells.

## Recognizing a topology

- A topology is the parts' shapes (type and pin places, so a block's or a
  transfer function's size counts) and which of their pins share a net.
  Nets are electrical (`Circuit#netGroupKey`): two symbols of one rail, or
  two wires with one name, are one net. Solder dots are not parts.
- A drawing of it is a one-to-one map onto parts of the same shapes under
  which two pins share a net exactly when their images do. The parts there
  may connect to more (a mirror inside an amplifier is still a mirror).
- An unconnected pin may map onto a pin of any net there that no connected
  pin maps onto (several unconnected pins may share one).
- A drawing with another part's body within the outline of the parts it
  maps is passed over (two legs of a mirror with a third drawn between).
- A resistor or capacitor maps its pins either way round (its symbol draws
  the same turned half round). A MOS never swaps source and drain.
- Of the maps onto one set of parts (a pair maps either way round), the one
  that moves the selected parts least is kept.

## Candidates

- Sources, in order: the open design (outside the selection), the
  workspace's other designs by when they were last saved, newest first, then
  the built-in cells (current mirrors, differential pairs, a cascode, a
  five-transistor OTA). Learn → Symbols → Built-in drawings (`:built-in-drawings`)
  shows them in the Atlas viewer, as the symbol sheet is shown.
- Two drawings that place the parts, turn them, place their labels, and wire
  them alike are one candidate, listed where it first appears, with the
  number of drawings (`×N`).
- A way the parts are drawn already is left out. With nothing else, the
  status bar says the parts are drawn like the others already.
- Nothing is stored apart from the designs: a drawing changed by hand is the
  newest drawing of its topology, so it is offered first next time.

## Cells

A selection larger than any drawing of it is arranged cell by cell: one
more candidate, last, "By cells" (`by cells:` on the command line).

- The cells are the built-in drawings' cells (`cell` in
  `arrange-builtins.js`, `cellPatterns`): the five-transistor OTA, current
  mirrors, differential pairs, the cascode, larger cells first, a mirror
  before a pair. Found among the selected parts as drawn (`cellsIn`; parts
  drawn among them do not matter here), a part in one cell at most; a
  selected rail symbol goes with the cell it is wired to.
- A cell is drawn like a drawing of its kind: the cell found there, so
  only the connections that make the cell must agree (a pair whose output
  feeds back is drawn like a pair). Of those, the one whose other
  connections among the cell's pins agree best (the same pins joined, the
  same pins on rails) goes first, then the newer source, then the one that
  moves the parts least. Its rail symbols go to the rail symbols on the
  same pins there.
- A cell drawn in that drawing's shape already (the parts in the same order
  along each axis, turned the same way; spacing aside) is left as it is.
  With every cell so, the parts count as drawn like the others.
- The cells are arranged one after another, each where it is, the parts in
  no cell staying put; all or nothing. The picker's card shows the parts as
  it draws them.

## Applying one

- The parts take the places, turns, and mirrors they have there, shifted
  together to where they are now; within four cells the shift that lines up
  the most pins with the rest of their nets wins, so those legs run straight.
- The shift keeps clear of the rest of the drawing: no body on another, no
  pin on another part's pin, no copied wire through another body, within 16
  cells. With no such place it is refused and nothing changes.
- The parts' own labels (name, size, value) take their offsets and
  alignment there.
- A net among the parts only takes the wires drawn there, pruned back to its
  pins (`wiresJoining`). A net that also reaches other parts keeps its wires
  there and joins the copied ones by one routed leg; with no wires there
  among its pins, each pin joins by a leg of its own. A net with no leg that
  routes follows the parts as a move would, and is laid out afresh when that
  leaves a pin off its wires; a net that still does not reach its pins
  refuses the arrangement.
