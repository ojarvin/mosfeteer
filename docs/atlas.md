# Atlas view

The app starts in the Atlas when the workspace (in browser-only mode, the
open folder, or else the opened files) contains more than one circuit. With zero or one circuit it starts in
the editor. Launching a specific file opens that file in the editor instead.
The restored drawing and any unsaved draft remain available behind the Atlas.
At startup, a dark cover stays up while the drawings load, then fades as the
Atlas zooms in from afar to fit the workspace. Later visits keep the usual
editor-to-Atlas zoom. Reduced-motion preferences skip the startup animation.

`Shift+Backspace` (or `:atlas`; `Shift+Esc` where the browser passes it
on, which Chromium does not) steps back from the drawing to the whole
workspace: every design at its real size on one continuous sheet of the
editor's paper and grid, to look around, compare, and open. It is a viewing mode with no tools; pan and zoom
work as in the editor (wheel or trackpad scheme, drag, pinch), and the open
design zooms out of, and back into, exactly where the editor shows it.
Each such move runs in three steps (`src/web/chrome-slide.js`): the
toolbars on screen slide off toward their edges, the camera moves, and the
next view's toolbars slide in. Leaving the editor, its focus hairline and
selection go first and the desk takes the drawing's place unseen, so the
toolbars and panels (side panel included) slide off over paper and grid;
the desk's names and picks show only once the camera has landed, and go
first when it leaves. The desk takes no input until it has left.

The desk stays put between visits: this browser remembers where each design
of a workspace sat, and a design keeps its spot while it still fits there. A
design that grew or shrank yields to the others (it keeps its corner, else its
centre, else moves to the nearest free spot), and a new design is placed near
its kin. `Shift+T` forgets the places and packs the desk afresh in
neighbourhoods of related designs.

A picked design shows its links (`src/core/design-links.js`): accent arrows
from it to the designs its parts link to, and to it from the designs that
use it. With nothing picked, and while the desk is in a transition, no
arrows show. **Links** in the top bar, or `L`, turns them off or on; the
choice is kept in this browser.

Kinship (`src/core/design-related.js`) adds up weak hints: a shared tag or a
hierarchy link says so outright; shared words in the names (`ota-folded`,
`ota_5t`) or a shared stem count strongly; the same subfolder, a similar mix
of part types, and shared net names count a little. A search packs what it finds tight, and
clearing it puts every design back in its place.

The top bar mirrors the editor's: the Mosfeteer mark, the workspace name,
the search, **New**, and the light/dark theme toggle. **New** opens a blank
schematic in the editor, with the name field focused. Unsaved changes in the
current drawing trigger the usual discard prompt; canceling keeps the Atlas
open. Name and save the new circuit to add it to the workspace. This button
is hidden in the Symbols view.

The design open in the editor -- where Esc and the header's **Back to …**
button return -- carries an **OPEN** badge before its caption, and the
button names it ("Back to amp", or "(not in this workspace)" for a new or
unsaved drawing). The picked design, which Enter opens, has a bracket at each
corner; a hover draws a faint frame. Both take in the caption.

Opening a design flies the camera straight into it -- one zoom about the
point that stays put, timed by how far it zooms -- to exactly where the
editor will fit it. The file is read during the flight and let in when it
lands, so loading never costs the zoom a frame; then the desk fades into the
editor. With reduced motion nothing zooms: the Atlas and the editor
cross-fade, and the desk is laid out unseen before it fades in.

**Folder…** switches the workspace to another folder, and the desk lays out
its designs in place. In browser-only mode, **Open…** also adds document
files from any folder to the desk without opening one. Dropping files or a
folder on the Atlas does the same. Symbols view hides both buttons.

| Keys | |
| --- | --- |
| drag, wheel, pinch | pan and zoom |
| right-drag | zoom to the box |
| click / arrows / Tab | pick a design |
| Ctrl- or Shift-click | add a design to the pick, or take it out (Esc clears) |
| Ctrl+Shift+C | copy the picked designs as one image, packed together with their captions |
| double-click / Enter | open it (after the unsaved-changes check) |
| `/` or Ctrl/Cmd+F | search the designs |
| `#` | edit the picked design's tags |
| Ctrl/Cmd+E | export the desk as one sheet |
| Ctrl/Cmd+O | another workspace folder (browser-only: add files) |
| `z` or Space | zoom to the picked design |
| `f` | fit the whole workspace |
| `Shift+T` | pack the desk afresh, related designs together |
| `+` / `-` | zoom about the middle |
| `Shift+D` | theme |
| Esc | clear the search, else back to the editor |
| Backspace | back to the editor |

## Search and tags

The search field finds designs by what is in them: part names, part types
(`pmos`, `current source`), net names, and any text, looking through markup
(`vcm`, `V_CM`, and `V_{CM}` are the same word). Every word must be found;
`#word` looks only at the document's tags. Designs it does not find fade,
and what it finds is marked in each design while the field has focus (the
marks step aside when it loses it, and return with it). When typing pauses (400 ms), the
desk packs the designs found together on their own and fits them; a search
that finds nothing leaves the desk as it was, faded. Enter, Esc, and
clearing the search pack at once. Enter (Shift+Enter) steps through the
designs found, and when one is left it is picked. Esc leaves the field with
the search still on and a found design picked, so Enter opens it; the arrows
and Tab move among the found designs, and Esc on the desk clears the search
(the next one returns to the editor). Opening a design selects what was
found in it. The search stays for the session, so the next match is one
Shift+Backspace away.

Tags are the document's own (`tags` in its JSON) and show after the
design's name. Set them from the **#** by the open design's name in the
toolbar (it shows how many there are),
with `#` on a picked design in the Atlas (Enter saves; another design's file
is rewritten with only its tags changed), or with `:tag add NAME`, `tag rm`,
and `tag set`. The index behind
the search (`src/core/design-index.js`) is cached beside each design's
drawing, by file revision.

## Export

**Export** (Ctrl/Cmd+E, also from the search field) writes the designs on
the desk as one sheet: each at its real size and place, under its name and
tags, as an SVG or a vector PDF that zooms like the Atlas. A search exports
only what it found; one that finds nothing exports nothing. It is the
document export dialog without PNG (one image of a workspace would outgrow a
canvas) and without the selection and beat choices; the grid and dark-mode
choices are shared, the formats and folder remembered on their own. Each
design is its own export SVG nested whole (`src/web/atlas-sheet.js`), so the
sheet draws exactly what the designs' own exports do. A sheet longer than
200 inches (the PDF page limit) shrinks its page to fit. The Symbols view
exports the symbol sheet the same way.

## Symbols

Learn (`?`) → Symbols → *Open the full symbol sheet* (or `:symbols`) opens the same viewer on the symbol
reference sheet (`src/core/symbol-sheet.js`): every placeable symbol, one
row per category and family, built from the registry each time it opens, so
it is never out of date and never a document. `GET /api/symbols.svg` serves
the same sheet for scripted visual checks.

## How it stays fast

- **Layout** (`src/web/atlas-layout.js`): the designs packed into one
  loose, screen-shaped ball, largest in the middle, each next in the free
  spot nearest the centre. Real size means one drawing unit is one world
  unit, and every design is shifted by whole grid cells, so its grid lines
  continue the desk's and entering or leaving the editor does not move a
  line.
- **Levels of detail**: one canvas paints every design from a baked image, small (256 px longest
  side) or large (1280 px), and once even the large one would blur, the live
  SVG is laid over it (at most six at a time).
- **Cache** (`src/web/atlas-cache.js`): each design's export SVG and its
  baked images are kept in IndexedDB keyed by document path and file
  revision (the workspace listing carries `revision`), so a second visit
  reads nothing but the listing and changed files. The open design is always
  drawn from the editor, unsaved edits included. Without IndexedDB the cache
  is per session.
