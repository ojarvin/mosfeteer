# Atlas view

The app starts in the Atlas when the workspace (in browser-only mode, the
open folder, or else the opened files) contains more than one circuit, and
in browser-only mode also when it contains none. With one circuit (or, with
a server, none) it starts in the editor. Launching a specific file opens that
file in the editor instead. The restored drawing and any unsaved draft remain
available behind the Atlas.

An empty desk asks what to do. Browser-only with no folder yet (the header
says "No folder yet"), it leads with **Open folder…**: one folder for every
design makes saving quiet and shows them all here next visit; a browser
that cannot write files (Firefox, Safari) is told up front that Save
downloads a copy. **New design** and **Open design…** (the file joins the
desk, and a single one opens) sit beside it. An open but empty folder (or,
with a server, the workspace folder) leads with **New design**, which
saves into it, then **Change folder…**. A folder the browser no longer may
read asks to **Allow access** again first, and **Back to** returns to the
drawing on screen when it has anything in it. While the desk is empty the
header's Export and way back and the hint bar step aside.
At startup, a dark cover stays up while the drawings load, then fades as the
Atlas zooms in from afar to fit the workspace. Later visits fly the open
design back to the desk, as below. Reduced-motion preferences skip the startup animation.

`Shift+Backspace` (or `:atlas`; `Shift+Esc` where the browser passes it
on, which Chromium does not) steps back from the drawing to the whole
workspace: every design at its real size on one continuous sheet of the
editor's paper and grid, to look around, compare, and open. It is a viewing mode with no tools; pan and zoom
work as in the editor (wheel or trackpad scheme, drag, pinch).

The screen is a pane of glass with the desk lying behind it (`drawFlight`).
The editor is a design brought right up to the glass. Leaving it, the
design flies back, away from the eye, on its page -- the editor's paper and
grid, narrowing into the design's card as it goes -- and lands on its place
on the desk picked, floating, with a small bounce and a ripple of light
across the desk. Opening a design carries its card on up to the glass,
exactly where the editor shows it. The path is a straight line in space
seen in perspective (`throughDepth` in `src/web/atlas-layout.js`), so a
design shrinks quickly as it leaves the glass and grows quickly as it
nears it. Meanwhile the desk stays where it is: it falls into shadow and
draws back a little while a design is near the glass, the page's shadow
spreads and softens with height, and its edge catches the light midway.
The other designs appear around the landing one, nearest first. The desk
rests as it was last left in this page (the whole desk the first time),
moved only as far as it takes to show the landing design.

Each move runs in three steps (`src/web/chrome-slide.js`): the toolbars on
screen slide off toward their edges, the design flies, and the next view's
toolbars slide in. Leaving the editor, its focus hairline and selection go
first and the desk takes the drawing's place unseen, so the toolbars and
panels (side panel included) slide off over paper and grid; the desk's
names and picks show only once the design has landed, and go first when it
leaves. Input never waits for any of it. Esc, a click, a scroll, or a key
that starts an animation of its own where the transition is going (on the
desk Enter, Backspace, F, Z, Space, the arrows, Tab, Shift+T; in the editor
F and Alt+arrows) finishes it at once (what is left of the flight, the
slides, and the image warm-up); any other key leaves it running, and a
modifier alone is no key at all. Every key typed on the way acts where it
arrives -- on
the desk once the design has landed, in the editor once one has opened (an
Enter there is dropped: it would only open what just opened). Handed back,
the desk lets the pointer through to the editor while it fades.
Shift+Backspace in a transition turns it around instead, from wherever it
is (`turnBack`): a design flying back to the desk returns to the editor, one
flying up to the editor lands on the desk again, and a design being opened
that way is never let in (the read file is dropped). Before the design has
set off it simply does not go. Pressed again, it turns once more. A design
already open behind the desk (after the unsaved-changes prompt) cannot be
turned back.

The desk stays put between visits: this browser remembers where each design
of a workspace sat, and a design keeps its spot while it still fits there. A
design that grew or shrank yields to the others (it keeps its corner, else its
center, else moves to the nearest free spot), and a new design is placed near
its kin. `Shift+T` forgets the places and packs the desk afresh in
neighborhoods of related designs.

With nothing picked every design lies flat at its true size, for
comparison. A picked design lifts off the desk: it eases up onto a card
larger than the flat drawing, on a deep soft shadow, its rim a hairline in
drawing units (the accent's); the designs it links to and those using it
lift only part way, on lower cards of their own. Below them the hierarchy
goes on downward only (`linkDepths`): their children lift lower still and
dim a little, and theirs lower again, three levels in all -- never back up
to a parent or across to a sibling -- and every other design dims. Grown
on their cards they would overlap the picked one (or each other), so each
lifted card floats out of the way, the shortest way clear (`floatClear`),
a level at a time down the hierarchy, and is picked where it floats. Letting go lays them flat
again (`drawCard`, each design easing on its own, stacked by where it is
heading so neighbors trade places smoothly).

A picked design shows its links (`src/core/design-links.js`) as beams of
light (`drawBeam`): a translucent curved band from each part that links,
which a soft spotlight lights (the beam starts at its edge, never over
it), widening -- in drawing units, so in proportion at any zoom -- and
fading as it reaches the design it
names and arriving square to the side facing the part (`linkCurve`),
ending exactly on the edge of that design's card --
its taper says which way it goes; the designs using the picked one send
theirs the same way. Each child lifted below them sends beams to its own
children, fainter a level at a time. On a dark desk the beams add up as light does. With nothing picked, and while the desk is in a transition, no
arrows show. **Links** in the top bar, or `L`, turns them off or on --
off, the pick lifts alone, its kin lying flat and dimmed with the rest; the
choice is kept in this browser.

Kinship (`src/core/design-related.js`) adds up weak hints: a shared tag or a
hierarchy link says so outright; shared words in the names (`ota-folded`,
`ota_5t`) or a shared stem count strongly; the same subfolder, a similar mix
of part types, and shared net names count a little. A search packs what it finds tight, and
clearing it puts every design back in its place.

The top bar mirrors the editor's: the Mosfeteer mark, the workspace name,
the search, the file actions (**Folder…**, **Open…**, **New**, **Export**)
together, then **Check** and **List** (below), then **Links**, then the editor's own **Settings** -- the theme,
animations, scrolling, tips -- lent to the Atlas while it is open, at the
same end of its top bar. **New** opens a blank
schematic in the editor, with the name field focused. Unsaved changes in the
current drawing trigger the usual discard prompt; canceling keeps the Atlas
open. Name and save the new circuit to add it to the workspace. This button
is hidden in the Symbols view.

**Check** checks the whole workspace; its button turns amber while
something needs a look (the count in its tooltip); its menu says what and acts on it. **Broken links**:
a part linking to a name no design has (`src/core/workspace-check.js`,
[`hierarchy.md`](hierarchy.md)) is relinked, in its file, to the one
design saved under that name, or, when none or several were, its design
opens with those parts selected to relink by hand; **Relink all** when
several can be. **Unsaved changes**: the editor's design, saved from here.
**Could not be read**: files the desk could not draw. It is checked afresh
each time the menu opens; it is hidden on an empty desk and in the Symbols
view.

A right click on a design (on the desk or in the list) opens its menu, the
editor's own (`openMenuAt`): **Edit** opens it, **Rename…** (F2) and
**Tags…** (`#`) open a field at its caption, and **Delete…** (Delete) asks
in the editor's delete dialog first (`deleteDocuments`; the open design
among them leaves the editor blank). A design right-clicked outside the
pick becomes the pick; with several picked the menu offers only adding
tags and deleting, for all of them.

**List** shows every design on the desk in one table, to keep a
workspace's names and tags in order: its name (the open one marked), when
it was last saved, its tags, and a check for each of beats, a timing
diagram, and links it holds (`designIndex`). **Name** sorts A to Z and
**Saved** newest first; clicking the same heading again reverses it (kept
in this browser). A click on a row picks that design and shows it on the
desk, a double-click elsewhere on the row opens it. A double-click on its
name (or F2) renames it there -- Enter renames, Esc or leaving the field
keeps it -- exactly as the editor's rename does (`renameDesign`: the file
renamed, its place on the desk kept, and the designs linking to it
relinked); a double-click on its tags (or `#`) edits them as `#` does on
the desk. `Shift+L` opens it holding the keys: ↑/↓ (Home/End) step through
the designs, picking each on the desk, Enter opens the picked one, and
`Shift+L` or Esc closes it. Several are picked as in any list --
Ctrl/Cmd+click adds or removes one, Shift+click or Shift+↑/↓ a range from
the last plain pick -- and the desk picks them too (the last one picked,
marked, is where the keys go on from). With several picked, `#` (here or on
the desk) adds the tags typed to each of them; a design that already has
one keeps it once.

The design open in the editor -- where Shift+Backspace and the header's **Back to …**
button return -- carries an **OPEN** badge before its caption, and the
button names it ("Back to amp", or "(not in this workspace)" for a new or
unsaved drawing). The picked design, which Enter opens, is named in the
hint bar at the bottom, with its tags and the keys that act on it (several
picked: their names); a hover draws a faint frame that takes in the
caption, and while the pointer is on a design other than the pick the bar
names that one the same way, with what a click does.

Opening a design flies it up to exactly where the editor will fit it,
timed by how far it travels. The file is read during the flight and let in
when it lands, so loading never costs the flight a frame; then the desk
fades into the editor. If the editor's fit differs (a page guide), the
design glides the last stretch at the glass; if the open is canceled, it
sinks back to the desk. With reduced motion nothing flies: the Atlas and the editor
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
| double-click / Enter | open it (after the unsaved-changes check); Enter with nothing picked goes back to the editor |
| `/` or Ctrl/Cmd+F | search the designs |
| `#` | edit the picked design's tags; with several picked, add tags to each |
| `l` | show or hide the links |
| `Shift+L` | the listing (below), opened holding the keys, or closed |
| Ctrl/Cmd+E | export the desk as one sheet |
| Ctrl/Cmd+O | another workspace folder (browser-only: add files) |
| `z` or Space | zoom to the picked design |
| `f` | fit the whole workspace |
| `Shift+T` | pack the desk afresh, related designs together |
| `+` / `-` | zoom about the middle |
| `Shift+D` | theme |
| Esc | clear the pick of several, then the search, then the pick; it never leaves the Atlas (the symbol sheet it closes) |
| Shift+Backspace (or Backspace) | back to the editor |

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
(the next one clears the pick). Opening a design selects what was
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

- **The same size open or not**: the design open in the editor is drawn
  on the desk from its file while it has no unsaved changes, exactly as
  when it is not open; only an edited one is drawn from the editor. The
  browser measures an open design's math tighter than a file's saved
  boxes, and a design that changes size gives up its place, so drawn live
  it would move the desk each time it was opened and left.
- **Layout** (`src/web/atlas-layout.js`): the designs packed into one
  loose ball shaped like the window's room for designs (between the top
  bar and the hint bar; its width over height, kept between 1:3 and 3:1),
  largest in the middle, each next in the free spot nearest the center.
  Kinship can pull a fresh packing taller or wider than that: when it
  misses by more than a little, a few nearby shapes are tried and the one
  that shows largest when fitted is kept: up to three tries, fewer for
  large workspaces, never depending on time, so `Shift+T` with nothing
  changed packs the same desk again (`layoutAtlasShaped`). Fit (`F`, `Z`) frames the designs in that same
  room, clear of both bars (`viewFittingIn`). Remembered places stay put while the window keeps their
  shape; opened in a window of another shape (more than 1.25 times
  narrower or wider), the desk is packed again to fill it, each design as
  near its remembered spot stretched to the new shape as it fits, so
  neighbors stay neighbors (`reshapedPlaces`). `Shift+T` packs afresh. Real size means one drawing unit is one world
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
