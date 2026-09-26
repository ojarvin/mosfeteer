# Workspace collage

`Shift+Backspace` (or `:collage`; `Shift+Esc` where the browser passes it
on, which Chromium does not) steps back from the drawing to the whole
workspace: every design at its real size on one continuous sheet of the
editor's paper and grid, to look around, compare, and open. It is a viewing mode with no tools; pan and zoom
work as in the editor (wheel or trackpad scheme, drag, pinch), and the open
design zooms out of, and back into, exactly where the editor shows it.

| Keys | |
| --- | --- |
| drag, wheel, pinch | pan and zoom |
| right-drag | zoom to the box |
| click / arrows / Tab | pick a design |
| double-click / Enter | open it (after the unsaved-changes check) |
| `z` or Space | zoom to the picked design |
| `f` | fit the whole workspace |
| `+` / `-` | zoom about the middle |
| `Shift+D` | theme |
| Esc / Backspace | back to the editor |

## How it stays fast

- **Layout** (`src/web/collage-layout.js`): the designs packed into one
  loose, screen-shaped ball, largest in the middle, each next in the free
  spot nearest the centre. Real size means one drawing unit is one world
  unit, and every design is shifted by whole grid cells, so its grid lines
  continue the desk's and entering or leaving the editor does not move a
  line.
- **Levels of detail**: one canvas paints every design from a baked image, small (256 px longest
  side) or large (1280 px), and once even the large one would blur, the live
  SVG is laid over it (at most six at a time).
- **Cache** (`src/web/collage-cache.js`): each design's export SVG and its
  baked images are kept in IndexedDB keyed by document path and file
  revision (the workspace listing carries `revision`), so a second visit
  reads nothing but the listing and changed files. The open design is always
  drawn from the editor, unsaved edits included. Without IndexedDB the cache
  is per session.
