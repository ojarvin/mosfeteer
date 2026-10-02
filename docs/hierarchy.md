# Linked designs

A part can link to another design of the workspace to show what it is -- an
op-amp in a system drawing linked to the amplifier's transistor schematic.
The link is loose: it names the design (`ComponentInstance#link`, saved as the
part's `link`), carries no connectivity, and is never netlisted. Renaming a
design in the editor (More → Rename document…) relinks the workspace's other
documents to the new name, unless another design still has the old one
(`relinkDocumentState`). A link to a design that is not in the workspace
(removed, or renamed outside the editor) is simply broken:
the side panel marks the part with a red dot (a linked part's dot is otherwise
the accent color), its bubble says so, and its menu offers another design.

Code: `src/web/hierarchy.js` (editor), `src/core/link-bubble.js` (bubble
placement); tests: `test/link-bubble.test.js`, the `link` tests in
`test/model.test.js` and `test/commands.test.js`.

## Linking

Right-click a part → **Link to design** lists the workspace's designs, with a
field on top that narrows them as you type (Enter takes the first); all
selected parts link at once, and **None (unlink)** removes it. Scripted:
`link OA1 amp`, `unlink OA1`. A linked part has a dot after its name in the
side panel; nothing marks it on the canvas or in an export. Copy, paste, and changing the part's type keep
the link. In the Atlas a link counts as kinship, so linked designs sit
together.

## Peeking

`o` (or the menu's **Peek at …**) shows the selected parts' linked
designs beside the drawing, each in a bubble: the design drawn as a picture at
its real size, framed by a dashed box with its name, and joined to its part by
a connector (the design itself: its free equations, pasted pictures, and Bode sketches are left out, for clarity). A bubble appears once its picture is ready, growing out of its
part (the editor's pop-in motion); closing it shrinks it back. Parts linked
to the same design share one bubble, joined to each of them by its own
connector; its placement weighs every connector.

Bubbles sit on a ring around the drawing, never over it
(`src/core/link-bubble.js`). Each tries angles all round and takes the one
whose connector reads best: diagonal, so it stands apart from the orthogonal
wiring; short; crossing as few parts, labels, and wires as it can (running
along a wire is worst); and clear of other bubbles and their connectors. A
bubble keeps its angle while that spot stays about as good, so it does not
jump as the drawing is edited. Dragging a bubble puts it where it is
dropped, even over the drawing: it then keeps that place beside its part
(following the part when it moves) until its menu's **Put back beside the
drawing**. Fit (`f`) takes the open bubbles in; opening one out of view fits
the view to it, and hiding bubbles that were on screen fits the view back in,
unless it is zoomed in past the whole drawing.

`Shift+O` shows every linked part's design at once, or hides them all when
they all show. `o` again (or **Stop peeking at …**, or the bubble's own
right-click menu) closes one. A click on a bubble picks its parts. Which bubbles are open, and
where any was dragged, is remembered per document in this browser; they are
never saved in the document or undone.

A bubble is drawn in drawing units -- a dashed box annotation's stroke, with
corners rounded by one cell -- so it scales with the drawing. Exports (SVG, PNG,
PDF, every beat, a selection, Copy as image) include the open bubbles whose
design has drawn: the frame widens the export, and the design is nested whole
as vector drawing, exactly as its own export draws it (as the Atlas sheet
nests designs). A broken link's bubble is not exported.

## Entering

`Alt+↓` (the menu's **Open …**, or a double-click on the bubble) opens the
linked design in the editor (**Show … in the Atlas** instead finds it among the
others there, picked and zoomed to), zooming into its bubble first when one is open.
The toolbar then shows the trail of designs it was opened from before its
name, and the canvas wears an accent frame. `Alt+↑` or a step of the trail
goes back up, to the view the
parent was left in, its linked part selected: the design just left shrinks
into its bubble there as the view pulls back. Opening another design any
other way leaves the trail. The usual unsaved-changes check applies, and the
parent must be saved so there is a way back.
