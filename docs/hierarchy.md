# Linked designs

A part can link to another design of the workspace to show what it is -- an
op-amp in a system drawing linked to the amplifier's transistor schematic.
The link is loose: it names the design (`ComponentInstance#link`, saved as the
part's `link`), carries no connectivity, and is never netlisted. A link to a
design that is not in the workspace (renamed or removed) is simply broken:
the part's badge and bubble say so, and its menu offers another design.

Code: `src/web/hierarchy.js` (editor), `src/core/link-bubble.js` (bubble
placement); tests: `test/link-bubble.test.js`, the `link` tests in
`test/model.test.js` and `test/commands.test.js`.

## Linking

Right-click a part → **Link to design** lists the workspace's designs (all
selected parts link at once); **None (unlink)** removes it. Scripted:
`link OA1 amp`, `unlink OA1`. A linked part wears a small link badge in the
editor, never in an export. Copy, paste, and changing the part's type keep
the link. In the Atlas a link counts as kinship, so linked designs sit
together.

## Peeking

`o` (or the menu's **Show linked design**) shows the selected parts' linked
designs beside the drawing, each in a bubble: the design drawn as a picture at
its real size, framed by a dashed box with its name, on the side of the
drawing nearest its part, and joined to the part by a connector. Bubbles on
one side slide apart. `o` again (or **Hide linked design**, or the bubble's
own right-click menu) closes it. A click on a bubble picks its part. Bubbles
are view state: not saved, not exported, and gone when another document
opens.

## Entering

`Alt+↓` (the menu's **Open …**, or a double-click on the bubble) opens the
linked design in the editor, zooming into its bubble first when one is open.
The toolbar then shows the trail of designs it was opened from before its
name, the canvas wears an accent frame, and a **↑ parent** chip sits at its
top. `Alt+↑`, the chip, or a step of the trail goes back up, to the view the
parent was left in, its linked part selected. Opening another design any
other way leaves the trail. The usual unsaved-changes check applies, and the
parent must be saved so there is a way back.
