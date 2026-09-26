# Workspace collage

`Shift+Esc` (or `:collage`) steps back from the drawing to the whole
workspace: every design laid out at its real size on one desk, to look
around, compare, and open. It is a viewing mode with no tools; pan and zoom
work as in the editor (wheel or trackpad scheme, drag, pinch), and the open
design zooms out of, and back into, exactly where the editor shows it.

| Keys | |
| --- | --- |
| drag, wheel, pinch | pan and zoom |
| click / arrows / Tab | pick a design |
| double-click / Enter | open it (after the unsaved-changes check) |
| `z` or Space | zoom to the picked design |
| `f` | fit the whole workspace |
| `+` / `-` | zoom about the middle |
| `Shift+D` | theme |
| Esc / Shift+Esc | back to the editor |

## How it stays fast

- **Layout** (`src/web/collage-layout.js`): designs in name order, in
  bottom-aligned rows whose width is chosen so the whole set fills a
  screen-shaped area. Real size means one drawing unit is one world unit.
- **Levels of detail**: one canvas paints every tile. A tile that is a speck
  is a blank sheet; otherwise it shows a baked image, small (256 px longest
  side) or large (1280 px), and once even the large one would blur, the live
  SVG is laid over it (at most six at a time).
- **Cache** (`src/web/collage-cache.js`): each design's export SVG and its
  baked images are kept in IndexedDB keyed by document path and file
  revision (the workspace listing carries `revision`), so a second visit
  reads nothing but the listing and changed files. The open design is always
  drawn from the editor, unsaved edits included. Without IndexedDB the cache
  is per session.
