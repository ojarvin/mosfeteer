# Atlas view

The app starts in the Atlas when the workspace (or browser-only document
cache) contains more than one circuit. With zero or one circuit it starts in
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

**New circuit** in the top bar opens a blank schematic in the editor, with
the name field focused. Unsaved changes in the current drawing trigger the
usual discard prompt; canceling keeps the Atlas open. Name and save the new
circuit to add it to the workspace. This button is hidden in the Symbols view.

| Keys | |
| --- | --- |
| drag, wheel, pinch | pan and zoom |
| right-drag | zoom to the box |
| click / arrows / Tab | pick a design |
| double-click / Enter | open it (after the unsaved-changes check) |
| `/` or Ctrl/Cmd+F | search the designs |
| `#` | edit the picked design's tags |
| `z` or Space | zoom to the picked design |
| `f` | fit the whole workspace |
| `+` / `-` | zoom about the middle |
| `Shift+D` | theme |
| Esc | clear the search, else back to the editor |
| Backspace | back to the editor |

## Search and tags

The search field finds designs by what is in them: part names, part types
(`pmos`, `current source`), net names, and any text, looking through markup
(`vcm`, `V_CM`, and `V_{CM}` are the same word). Every word must be found;
`#word` looks only at the document's tags. Designs it does not find fade,
and what it finds is marked in each design. Enter (Shift+Enter) steps
through the designs found, and when one is left it is picked. Esc leaves
the field with the search still on and a found design picked, so Enter opens
it; the arrows and Tab move among the found designs, and Esc on the desk
clears the search (the next one returns to the editor). Opening a design
selects what was found in it. The search stays for the session, so the
next match is one Shift+Backspace away.

Tags are the document's own (`tags` in its JSON) and show after the
design's name. Set them in the side panel's Tags field for the open design,
with `#` on a picked design in the Atlas (Enter saves; another design's file
is rewritten with only its tags changed), or with `:tag add NAME`, `tag rm`,
and `tag set`. The index behind
the search (`src/core/design-index.js`) is cached beside each design's
drawing, by file revision.

## Symbols

Settings → Symbols (or `:symbols`) opens the same viewer on the symbol
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
