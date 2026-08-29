# schematic-spawner — working context

Programmatic/agent-assisted schematic editor. Connectivity-based model rendered to SVG.
Git repo → private `ojarvin/schematic-spawner`.
**Push only over HTTPS** (SSH permanently unavailable headless, "Permission denied (publickey)");
`origin` = HTTPS URL, `gh` is the credential helper.

## Agent generation instructions

Two distinct roles work here. Pick yours from
[`guidelines/README.md`](./guidelines/README.md):

- **Developer agent** (improving the app): read
  [`guidelines/DEVELOPER.md`](./guidelines/DEVELOPER.md).
- **Circuit author agent** (drawing circuits): read
  [`guidelines/CIRCUIT-AUTHOR.md`](./guidelines/CIRCUIT-AUTHOR.md).

Both roles share the visual standard in
[`guidelines/style-guide.md`](./guidelines/style-guide.md). This file is the
**live spec** for current symbol geometry, the label model, routing behavior,
and editor UX — skim it whenever you need an exact number.

## Symbol style (Razavi look)

- All symbols use the classic textbook look: **filled gate bars /
  arrowheads / power slabs** via a `polygon` primitive with
  `fill:'foreground'`; symbol linework uses **butt caps / miter joins**.
- `style.js` stroke roles (select with `style:'…'` in a graphic):
  `symbol` (normal, butt), `emph` (9.6), `ground` (11.6), `supply` (7.2),
  plus the legacy `LINE` (round, wires) / `THICK`. `fontAttrs('instance'|'label')`
  unchanged.
- **Labels support subscripts:** `_{...}` markup (e.g. `C_{GS}`); owned
  instance labels auto-subscript a trailing numeral (M1 → M with subscript 1).
  Alignment/anchors/bbox model unchanged (`textWidth` scales sub/super runs
  ×0.62).

## Current symbol geometry (affects tests / wire tests)

- **resistor / capacitor / inductor / switch\* / variable\_\***: terminals
  `a` (left) / `b` (right) on the 40-grid; resistor / capacitor / inductor /
  switch all **160 wide**, bbox `{0,-40,160,80}` (cap plates at x
  67.06/92.94, inductor coil spans x 21.51..138.49 — both centered on the
  midpoint 80). Diode stays 120, bbox `{0,-40,120,80}`.
- **nmos / pmos**: terminals `g`(0,0), `d`(120,-80), `s`(120,80), bbox
  `{0,-80,120,160}`; gate = two filled bars (x 32.8..44.4, 53.7..65.4);
  NMOS source arrow (filled) points OUT, PMOS points INTO the channel.
  `defaultMirrorY:true` on pmos → placed source-up. `ComponentInstance`
  applies `defaultMirrorX/Y` only when `opts.mirror*` is `undefined`; the
  CLI `add` command omits the mirror flags unless `--mirrorX/--mirrorY` is
  given, so **symbol defaults apply everywhere** (output ports come out
  mirrorX, pmos source-up).
- **npn / pnp**: `b`(0,0), `c`(160,-120), `e`(160,120) [pnp: c bottom, e
  top]; filled emitter arrow; base bar `emph`. bbox `{0,-120,160,240}`.
  **Label on the right at `{200,0}`** (one square past the body).
- **ground**: `gnd`(0,0), stub to y40, three `ground`-width bars (y
  40/63.26/84.19), bbox `{0,0,80,120}`. **supply**: `p`(0,0), filled slab
  above, bbox `{-40,-80,80,80}`.
- **current_source / current_sink / voltage_source**: `a`(0,-80)/`b`(0,80),
  circle r43, filled arrow (or ± marks); bbox `{-80,-80,160,160}`.
  refPrefix `I` / `V`.
- **opamp**: `ip`(-200,40), `im`(-200,-40), `o`(160,0). **opamp_diff**
  (fully differential): same bbox `{0,-120,360,240}`-style
  `{-200,-120,360,240}`, same two inputs, plus `op`(160,-40) & `om`(160,40)
  — two output leads exit the triangle's slanted edges at the input rows
  (x≈12.8/12.81) and run to x=160. All four polarity marks are 28-unit
  (same size), centered on the input/output rows y=±40: input −/+ at x≈-76,
  output **flipped** +/− at x≈-38 (op top, om bottom), kept clear of the
  body's slanted edges. The plain opamp's input marks sit on the same rows
  y=±40. refPrefix `U` for both. **inverter/buffer**: `a`(-120,0), `y`(120
  or 80, 0). **gates** (and/or/nand/nor): `a`(-120,-40), `b`(-120,40),
  `y`(120,0); xor/xnor `y`(160,0). refPrefix `U`. **Gate bodies**: every
  body is ONE continuous closed path (`Z`). AND/NAND's top edge meets the
  curved front at the same point (no seam/kink). OR/NOR's concave back is
  shifted left (-8) so it overlaps the input lead tips (which end at
  x=-76.88). XOR/XNOR shift the body AND the extra input-side line left
  (-22) together (fixed spacing); the extra line lands ON the wire tips
  (x≈-77 at the input rows) and the wires stop there — they never extend
  into the gap between the two curves. The output lead and negation bubble
  shift with the body. Buffer/inverter triangle bodies are closed with `Z`
  so the apex is a sharp miter (the inverter's apex hides behind its
  bubble).
- **port / port_filled** (Razavi circle markers): `p`(0,0), circle left of
  the lead. **input/output/inputoutput** are Razavi-style boxed ports
  (refPrefix `I`/`O`/`IO` + owned id label to the LEFT at labelOffset
  `{-120,0}`); **output defaults to `defaultMirrorX:true`** (terminal on
  the circuit side, box+arrow outward) — the label offset mirrors with
  the symbol.
- **variable_\*** (adjustable): composed at load time from the plain
  resistor / capacitor / inductor definitions (`[...base.graphics,
  ...ADJUST]` in `variable.js`) so they track the base body geometry.
  The adjustment arrow is a 45° shaft + filled head shifted right so it
  sits OVER the 160-wide body (shaft `M 32 48 L 116 -36`, head tip at
  (128,-48)).
- **labelOffsets**: nmos/pmos `{160,0}`, npn/pnp `{200,0}` (right side);
  resistor / switch / variable / cap / inductor / diode `{80,80}`; sources
  `{80,0}`; ports `{-120,0}`; logic / opamp below body.

## Label model

- Labels are NOT a component / symbol type: separate
  `circuit.labels: Map<id, LabelInstance>` (like solder — no terminals,
  don't block routing in `netEnv`).
- `LabelInstance`: `id, text, align (center|left|right), owner
  (refdes|null), offset (local grid-snapped when owned), anchor (world
  grid-snapped)`.
- **Bbox model**: tight text bbox computed from per-glyph widths
  (`LABEL_FONT_SIZE=38` matches the rendered `INSTANCE_FONT` /
  `LABEL_FONT` size; `LABEL_CHAR_W=8` at font 12 for the bold + italic
  label face; narrow / default / wide buckets) and `LABEL_CAP_H =
  round(38*0.7) = 27` height. The rendered box expands the tight box to
  **even multiples of a grid cell in BOTH dimensions** (`colWidth()` /
  `rowHeight()`, min 2 cells) and is **centered on the anchor**, so the
  box center is always on a grid point. The box always updates on
  `setText`. `bbox()` = centered box; `textPos()` returns the `<text>`
  `{x, y, anchor}` so the text is horizontally aligned inside the box
  (left/right/center) and **vertically centered** (baseline `y = anchor.y
  + LABEL_CAP_H/2`).
- **Sub / superscript editing**: labels support `_{...}` / `^{...}`
  markup (rendered as tspans). The inline label editor wraps a text
  selection with **Ctrl+, / Ctrl+.** (subscript / superscript); pressing
  again on the selection unwraps it, and a mixed selection reverts every
  touched group to plain text. The pure toggle lives in `model.js` as
  `applyMarkup(text, s, e, mark)` (unit-tested).
- **All components** auto-create an owned instance label in `addComponent`
  (text=refdes, align center) — every symbol sets `refPos:null` +
  `labelOffset`, so no id is drawn as plain font-12 `refPos` text.
- `fromJSON` uses `noLabel:true` then loads `data.labels`, drops orphaned
  owned labels.
- `nextRefdes(prefix)` returns smallest unused positive index (reuse after
  deletion).
- **Rotate / mirror is origin-anchored (pure, stable).** The editor's
  `r`/`R`/`x`/`X` (and the CLI `rotate` / `mirror`) rotate or mirror each
  selected component about its OWN origin — the origin never moves, so
  repeated rotations / mirrors never translate the component and always
  stay on the 40-grid (matching the CLI). Free labels are not orbited by
  rotate / mirror.
- Editor UX (main.js): labels are inserted through **insert mode** (`t`
  picks a label ghost, Enter/click commits at cursor; no normal-mode `t`).
  Shift+ArrowLeft/Right cycle align; nudge h/j/k/l; dd/Delete removes;
  double-click inline `<input>` (Enter/blur commit, Esc cancel); palette
  "label" button. **Multi-label selection** supported: `selLabels:Set`
  (plus `selLabel` = primary id), extends/deselects component `multi`.
  `setLabelSelection(ids, primary)` sets both; `setSelection`/Escape
  clears both. Selection overlay highlights all `selLabels`
  (`editorOverlay` `opts.selLabels`).

## Routing & connectivity

- **Touching pins connect:** `Circuit#connectCoincident()` joins any
  terminal that lands exactly on another component's terminal into one
  net (runs in `addComponent`, `moveComponent`, `setTransform`,
  `fromJSON`). Dropping a ground onto a MOS source connects them;
  dragging either component apart keeps the net and routes a wire between
  them. `fromJSON` runs it after loading explicit nets (guarded by
  `_loading`).
- **Balanced routes keep terminal legs.** `normalizePath` (wiring.js)
  merges a collinear middle point ONLY when the run is monotonic; a point
  where the polyline reverses direction (e.g. the balanced route's
  terminal visit `(120,120)→(120,80)→(120,120)`) is a real vertex and is
  preserved. Without this, `clonePath` / `fromJSON` / render silently
  dropped a 3-way junction's terminal leg (the terminal stayed in the net
  but its wire vanished). Covered by `test/wireedit.test.js`.
- **Router pin escapes:** `smartRoute` generates "escaped" candidates that
  extend one grid cell OUTWARD from each pin (in its terminal `dir`, via
  `applyDir`) before bending, so a gate→drain wire leaves the gate west
  and approaches the drain from the north — a clean outside bend that
  never drills the body. Both `main.js` and `commands.js` `pinDir` honor
  `t.dir` first (bbox heuristic is the fallback).
- **Wire-mode click priority:** terminal clicks (within `max(GRID/2,
  12px/unit)` via `nearestTerminal`) always start / end a wire in wire
  mode, even when a wire passes through the pin.
- **Wire click = select, click-and-drag = re-route.** A plain click on a
  wire selects its net (`selectedNets`) and highlights it (blue glow in
  `editorOverlay` — halo stroke-width 12 @45% + 2.4 center line); it
  never mutates the net. Click-and-hold then drag re-routes the run
  (`wireseg` drag); the working route array is attached to `net.route`
  only on the first real move, so a plain click leaves the net untouched.
  A straight pin-to-pin run can't be dragged (`moveWireRun` keeps both
  pins fixed). **Escape cancels an in-progress drag** (`cancelDrag()`
  restores the pre-drag polyline) — the history entry is pushed once on
  mouseup, so undo/redo round-trip a committed drag. **`dragMoved()` =
  pointer moved BOTH >6px (client) AND >`GRID/2` (world)**, so jittery
  clicks never drag at any zoom, and a "drag" that never actually moves
  the run is still treated as a click (route restored, no history).
- **Highlighted net highlights its parts too.** `editorOverlay`
  `opts.netComps` (refdes of every component carrying a terminal on a
  highlighted net) gets the same blue halo, so ports / grounds / supplies
  / devices on the net stand out.
- **Nets are renamable from the left toolbar:** double-click a net name
  in the nets list opens an inline `<input>` (Enter/blur commits
  `net.name`, Esc cancels).
- **Segment wire building:** in wire mode click a terminal (source), then
  click points to build the wire in segments; clicking or pressing
  **Enter** on a target terminal connects them (the hand-drawn path
  becomes the route, made orthogonal / collinear-collapsed). Pressing
  **Enter** on another wire's interior merges the two nets: the junction
  becomes a mid-wire anchor (`net.junctions`), the route walks both
  halves of the target wire from the junction, and a **solder** marks
  it. `rerouteNet` / `routeNet` walk nets that carry junctions through
  all anchors (terminals + junctions).
- **Wiring starts from any point:** empty-space click in wire mode starts
  a free-point draft (`wire.source={x,y}`); clicking an existing wire
  starts a branch (`{x,y,netId}` — junction+solder materialize on
  commit). Committing a free/on-wire draft onto a terminal or wire
  **splices it into the target net preserving that net's existing wire**
  (never overwrites the route).
- **Drags re-route holistically:** moving / rotating / mirroring a
  component re-routes every touched net from its terminals + environment
  (`rerouteNet`), never hand-carrying wire bodies — a drag cannot leave
  wires dangling or collapse them. Touching pins connect only at the
  COMMITTED position (mouseup / `move` command), never mid-drag.
- **Clearance & consistency:** `smartRoute` keeps at least one grid cell
  of clearance from every component body (excluding the pin-escape legs),
  even if it means a longer way around. `Net.points()` uses the same
  escape-aware routing for route-null two-terminal nets, so committed and
  rendered wires always agree. Joined (multi-way) nets store explicit
  `net.branches` (list of polylines) and `net.junctions` (mid-wire
  anchor grid points); the renderer draws every branch and the model
  walks branches for bounds / length / eval.
- **Insert hotkeys → fuzzy search:** insert mode is type-driven — typing
  filters the component / label list (`fuzzyScore`: prefix > substring >
  subsequence, shorter wins), Enter picks the best match as a ghost,
  click/Enter places, Esc drops the ghost back to search, Esc again
  exits insert. Arrow keys move the cursor; all printable keys (incl.
  `h j k l`) go into the query. The `#insert-menu` dropdown shows the
  live query + filtered entries. (`PLACEMENT` map still labels the menu's
  hotkey column.)
- **Visual mode:** `v` (normal) anchors the cursor and draws a green box
  as `hjkl` / arrows move it; Enter commits the box selection
  (`applyBoxSelection` — components by bbox, labels by bbox, nets by
  route; shared with the mouse marquee) and exits; Esc cancels. Status
  bar shows VISUAL.

## Web UI

- **Zoom is clamped** so a grid cell never exceeds ~120px on screen
  (`minViewW()`) and the drawn grid never exceeds ~1000 lines
  (`maxViewW()`). `fitView`, drag-zoom, wheel zoom, right-click zoom-out
  and `resizeView` all clamp.
- **Dark mode**: `html.dark` class toggles CSS variables; the inline SVG
  ink is recolored via attribute-value CSS overrides
  (`html.dark .canvas svg [stroke="#111"] { stroke: #dde1e8 }`,
  `[fill="#fff"] → var(--paper)`, etc.) — presentation attributes are
  overridden by CSS, so no core renderer changes were needed and
  colored overlays (halos, wire source) are untouched. `#btn-theme`
  toggles, persisted in localStorage (`schematic-spawner:theme`),
  defaults to system `prefers-color-scheme`.
- **`#` toggles the grid** (`setGrid()`); `#btn-grid` mirrors it.
  Toolbar buttons carry `title` tooltips.
- **`D` toggles dark mode** (plus `#btn-theme`).
- **Copy / paste on selected sets:** `yy` / `Ctrl+C` (`copySelection`)
  captures the selected components + free labels + every net whose
  terminals all sit on selected components (route / branches / junctions
  kept); `p` / `Ctrl+V` (`pasteClipboard`) re-instantiates everything at
  the cursor with fresh refdes / label ids / net ids, preserving
  relative positions and connectivity.
- Side-panel lists are condensed (smaller row padding / fonts) so the
  components / nets / terminals lists stay short.

## Fast loop: CLI → server → browser

- **`POST /api/circuits/<name>/cmd`** — body `{ "cmd": "<line>" }` or
  `{ "cmd": "line1\nline2\n..." }`. Server loads the named circuit (or
  starts a new one), runs `runCommand` for each line, persists
  `circuits/<name>/circuit.json` + `circuit.svg` if any line mutated,
  and returns `{ name, mutated, results, state }`. The CLI is a thin
  HTTP client (`src/cli/index.js`) over this endpoint.
- **`GET /api/active`** → `{ active: "<name>" | "" }`. The server tracks
  the active circuit in memory and persists to `data/active.json`. Every
  `POST .../cmd` sets `active = <name>`; the browser's `syncActiveCircuit`
  polls this endpoint and **auto-loads** the active circuit on first open
  or whenever it changes. The user only has to keep the browser tab
  open — they never type a circuit name or click Load.
- **`PUT/POST /api/active`** → `{ active: "<name>" }` to set explicitly.
  **`DELETE /api/active`** → clears it.
- The browser poll is 500 ms (existing `syncActiveCircuit`). The same
  poll still syncs content updates for the loaded circuit. So one
  tick = "is the active different? switch if so" + "is the file
  different? merge if so".
- Old behavior (CLI writes `data/state.json`, GUI Save writes
  `circuits/<name>/circuit.json`, two unrelated paths) is gone.

## Editor behavior — hotkeys

- `i` insert mode (fuzzy search). `w` wire mode. `t` (insert mode)
  label ghost.
- `v` visual mode. `Esc` cancels ghost / box / drag.
- `r`/`R` rotate +90 / -90 (normal). `x`/`X` mirror along axis.
- `dd` delete selection (chord). `Delete` / `Backspace` same.
- `u` / `Ctrl+Z` undo; `U` / `Ctrl+Y` / `Ctrl+R` redo.
- `yy` / `Ctrl+C` copy; `p` / `Ctrl+V` paste at cursor.
- `hjkl` move cursor; in visual mode, grow box; in insert mode, part of
  the query.
- `F` fit view; `D` toggle dark mode; `#` toggle grid; `?` keymap.
- All printable keys (incl. `h j k l`) in insert mode append to the
  fuzzy query.

## Working-context notes

- `npm test` = **161/162** green (model / commands / router / render /
  wireedit). One pre-existing failure in
  `test/multinet.test.js:141` ("loading stale overlapping branches
  splits them so dragging never loops or adds dots": 6 dots vs expected
  2). The new HTTP endpoint reuses `runCommand()` and is covered by the
  existing tests; the CLI is a thin client over it and is exercised by
  `npm test` only for argument parsing (the server itself is verified by
  the smoke test below).
- CDP browser suites (headless chromium) live in `/tmp/opencode/`:
  - `mos_label_test.mjs` — NMOS / PMOS hotkeys, PMOS defaultMirrorY,
    MOS id label on bulk side / gate height, double-click inline edit,
    Ctrl+A + marquee label selection, wire follows moved / rotated /
    mirrored terminal.
  - `feature_test.mjs` — insert-mode `#insert-menu`, switch components,
    normal-mode `t` is no-op for labels, owned-label moves when its
    component is nudged, `u`/`U` undo / redo, mixed component+free-
    label Ctrl+A drag.
  - `ghost_test.mjs` — insert-menu is `pointer-events:none` and hides
    during ghost, `n` / `p` / `t` etc. select ghosts, Escape cancels,
    all parts get owned instance labels.
  - `wiredrag_test.mjs` — `__circuit().nets[i].route` is the live
    array; drag an interior run collapses a corner, drag a run
    touching a terminal extends with a connector.
- CDP notes: headless **never fires native `dblclick`** — dispatch
  clickCount 1 then 2 (real CDP `Input.dispatchMouseEvent` with
  `clickCount:2`); the inline `<input>` selector is
  `input[style*="position: absolute"]`; Ctrl+A =
  `keyDown('a',{modifiers:MOD,code:'KeyA',keyCode:65})`;
  `__circuit().comps` returns **serialized** (flat
  `{refdes,type,x,y,rot,mx,my}`, no `transform`) so assert on `c.x`.
  Inline-editor Escape closes the editor first; a second Escape exits
  insert mode.
- Router: scoring `[bboxCrossings, wireCross, overlap, conform, turns,
  length]` with diagonal filtering; `segThroughInterior` (wires
  leaving a boundary pin straight through own body are violations;
  boundary-hugging legal); `evaluate().wireThroughBBoxes` uses it.
  `astar()` is the live `smartRoute` fallback (NOT dead code).
- `window.__circuit()` debug hook returns `{ comps, nets, labels }`
  where labels include a `world` anchor.
- `window.__run(cmd)` runs a single command on the visible circuit.
- `window.__load(state)` overwrites the visible circuit from a JSON
  state object.
- Demo circuit is **gone** (`src/core/templates.js` deleted, `demo`
  command + `#btn-demo` toolbar button removed). `test/commands.test.js`
  uses a tiny inline `smallCircuit()` for report / svg tests.

## Test-env facts

- pkill patterns must be bracket-escaped (`remote-debugging-port=922[6]`,
  `src/web/serve\.js`).
- `serve.js` sends `Cache-Control: no-store`; `index.html` `main.js?v=7`.
- `circuits/`, `data/`, `node_modules/` are gitignored. `data/active.json`
  is the live record of which circuit the agent is editing.
- Browser open without an active circuit loads an empty editor (or the
  localStorage draft); as soon as the agent POSTs a command, the active
  circuit switches and the browser auto-loads it.
