# schematic-spawner — working context

Programmatic/agent-assisted schematic editor. Connectivity-based model rendered to SVG.
Git repo (root commit `e868342`, label commit `dd750f6`) → private `ojarvin/schematic-spawner`.
**Push only over HTTPS** (SSH permanently unavailable headless, "Permission denied (publickey)");
`origin` = HTTPS URL, `gh` is the credential helper.

## Agent generation instructions

For agent-driven circuit generation, read these guides first:

- `guidelines/agent-operations.md` — live server, browser/API operations, JSON connectivity, iteration, and saving.
- `guidelines/diagram-quality.md` — electrical, geometric, routing, labeling, and review requirements.
- `guidelines/agent-workflow.md` — inspecting prior circuits and maintaining circuit-specific `learnings.md`.

## Do NOT modify (user-owned style guide)
- `src/core/components/resistor.js` geometry (terminals/bbox/graphics) or `src/core/style.js` values.
  Only `refPos`/`textPos` ("the label in resistor") may be tweaked. Treat current working-tree versions as canonical.

## Current symbol geometry (affects tests/wire tests)
- resistor: terminals `a`(0,0)/`b`(160,0), bbox `{0,-40,160,80}`, 5-segment zigzag.
- `style.js`: `LINE {stroke:'#111', width:6, cap:'round', join:'round'}`, `THICK` = 8, cap flat. (working tree: `INSTANCE_FONT`/`LABEL_FONT` both `size:36`, bold+italic instance.)
- **ALL components carry their id as a dedicated `LabelInstance`** (`refPos:null` + `labelOffset`), so every id renders in the same instance font (bold+italic, via `fontAttrs('instance')`). No refdes is drawn as plain font-12 `refPos` text anymore. labelOffsets: nmos/pmos `{x:160,y:0}` (bulk side = right of gate, gate height; M1 at (160,0) when placed at (0,0), PMOS M2 at (200,0) when at (40,0)); npn/pnp `{x:40,y:80}`; resistor/switch_open/switch_closed (160 wide) `{x:80,y:80}` (below body); capacitor/inductor/diode (120 wide) `{x:60,y:80}` (below body). Transistors confirmed world anchors: NMOS `M1` at (160,0), PMOS `M2` at (200,0).
- nmos: terminals `g`(0,0), `d`(120,-80), `s`(120,80), bbox `{0,-80,120,160}`; source arrow `M 53 38 L 60 30 L 53 22 Z` points OUT of the channel (down-right).
- pmos: BODY = exact NMOS copy (no gate balloon), only the source arrow differs — `M 67 38 L 60 30 L 67 22 Z` points INTO the channel (reverse of NMOS). `defaultMirrorY:true` → when placed, source points UP (source at top-right world, drain bottom-right); confirmed terminal `s` world y=-80, `d` world y=+80.
- `ComponentInstance` applies `def.defaultMirrorY`/`def.defaultMirrorX` when `opts.mirror*` is undefined (only used by pmos for now).

## Label model (implemented)
- Labels are NOT a component/symbol type: separate `circuit.labels: Map<id,LabelInstance>` (like solder — no terminals, don't block routing in netEnv).
- `LabelInstance`: `id, text, align(center|left|right), owner(refdes|null), offset(local grid-snapped when owned), anchor(world grid-snapped)`.
- **Bbox model (revised):** tight text bbox computed from per-glyph widths (`LABEL_FONT_SIZE=40`, `LABEL_CHAR_W=7` at font 12; narrow/default/wide buckets) and `LABEL_CAP_H=round(40*0.7)=28` height. The rendered box expands the tight box to **even multiples of a grid cell in BOTH dimensions** (`colWidth()`/`rowHeight()`, min 2 cells) and is **centered on the anchor**, so the box center is always on a grid point. The box always updates on `setText`. `bbox()` = centered box; `textPos()` returns the `<text>` `{x,y,anchor}` so the text is horizontally aligned inside the box (left/right/center) and **vertically centered** (baseline `y=anchor.y + LABEL_CAP_H/2`).
- **All components** auto-create an owned instance label in `addComponent` (text=refdes, align center) — every symbol sets `refPos:null` + `labelOffset`, so no id is drawn as plain font-12 `refPos` text.
- `fromJSON` uses `noLabel:true` then loads `data.labels`, drops orphaned owned labels.
- `nextRefdes(prefix)` returns smallest unused positive index (reuse after deletion).
- Group transform (about grid-snapped bbox-union centroid P; order mirror→rotate→translate): 90 `nx=P.x-(ty-P.y),ny=P.y+(tx-P.x)`; 180 `nx=2P.x-tx,ny=2P.y-ty`; 270 `nx=P.x+(ty-P.y),ny=P.y-(tx-P.x)`; mirror x `nx=2P.x-tx` toggle mirrorX; mirror y `ny=2P.y-ty` toggle mirrorY. Increments `rotation`.
- Editor UX (main.js): labels are inserted through **insert mode** (`t` picks a label ghost, Enter/click commits at cursor; no normal-mode `t`). Shift+ArrowLeft/Right cycle align; nudge h/j/k/l; dd/Delete removes; double-click inline `<input>` (Enter/blur commit, Esc cancel); palette "label" button. **Multi-label selection** supported: `selLabels:Set` (plus `selLabel` = primary id), extends/deselects component `multi`. `setLabelSelection(ids, primary)` sets both; `setSelection`/Escape clears both. Selection overlay highlights all `selLabels` (editorOverlay `opts.selLabels`).

**Completed this session (uncommitted):**

1. **Double-click label edit fixed (robust).** Root cause: calling `inlineEditLabel` (which focuses an `<input>`) in the middle of the second `mousedown` let the following `mouseup` blur the document, which immediately closed the input (`DOC_BLUR` → `done(true)`). Fix: in `canvasMouseDown`, when picking a label with `ev.detail >= 2` (verified via CDP that `detail` does reach 2), select it and **defer** the editor via `setTimeout(() => inlineEditLabel(labelHit), 0)` so focus is set AFTER the mousedown→mouseup sequence completes. Also added a **manual double-click fallback** (`lastLabelClick` timing+position <500ms & within 1 cell) for drivers that never set `ev.detail`; `lastLabelClick` is cleared on non-label clicks and whenever the editor actually opens. `inlineEditLabel` keeps the `inlineInput` guard so the `dblclick` listener can't open a second input. (`<input>` selector for tests: `input[style*="position: absolute"]`.)
1b. **Labels are insert-only (normal-mode `t` removed).** The old normal-mode `t` "edit selected label / place new label at cursor" handler was **removed** — labels are placed exclusively through insert mode (`t` picks a label ghost, Enter/click commits). Normal-mode `t` now does nothing for labels.
2. **Ctrl+A / box-select now selects labels.** `selLabels` participates in Ctrl+A (selects all components + all labels), drag-marquee (`rectOverlap` on label bbox, with shift=add via `startLabelSelection`), and shift-click toggle. Moving/dragging/nudging acts on all `selectedLabels()`; dd/Delete removes all `selLabels`.
3. **Wires stay connected on move/flip/rotate.** `commands.js` `move`/`rotate`/`mirror` now call `rerouteNetsFor(circuit, [refdes])` (re-runs `smartRoute` over the nets touching the component); the editor drag-move already re-routes via `rerouteAffected` on mouseup (and live during drag). Verified: net endpoints track the moved/rotated/mirrored terminal.
4. **NMOS source arrowhead** added: `M 53 38 L 60 30 L 53 22 Z` (points out of channel).
5. **PMOS** is now an NMOS copy (no gate balloon) with reversed arrow (`M 67 38 L 60 30 L 67 22 Z`, INTO channel) and `defaultMirrorY:true` so source points up at placement.
6. **MOS identifier label sat the bulk side at gate height:** `labelOffset {x:120,y:0}` for both nmos & pmos — then this session bumped it **one square further out to `{x:160,y:0}`** (NMOS `M1` world anchor at (160,0) when placed at (0,0); PMOS at (200,0) when at (40,0)). (Earlier `{-40,0}` put it on the GATE side — wrong.)
7. **Hotkeys:** insert mode `n`=nmos, `p`=pmos, `N`=npn, `P`=pnp (was `n P b p`).
8. **Label bbox revise:** tight per-glyph text box expanded to even-cell multiples in both dims, box centered on anchor (grid point), text aligned inside (left/center/right) + vertically centered; box updates on `setText`.
9. **Switch component** added: `src/core/components/switch.js` factory exports `switch_open` + `switch_closed` (SPST, 160 wide = 4 squares, like resistor; bbox `{0,-40,160,80}`; refPrefix `S`; contact dot `circle` at (100,0)). Registered in components `index.js` (so `addComponent`/palette/insert-menu pick them up via `symbolTypeNames`). Insert-mode hotkeys `x`=`switch_open`, `X`=`switch_closed` (mirror is normal-mode only, so no clash).
10. **Insert-mode dropdown menu** next to the cursor: `updateInsertMenu()` (called from `render()`), builds once and repositions a `#insert-menu` DOM dropdown listing every placable component + label with hotkey-highlighted (`<span>.insert-menu-key`), highlighting the active ghost (`.active`). It is **read-only** (`pointer-events:none` — never intercepts clicks/drags) and **hidden whenever a placement ghost is pending** (it would only be in the way). Uses `worldToClient(wx,wy)`. CSS in style.css.
11. **Undo/redo rebinds:** `u`=undo (unchanged), **`U`=redo**, **Ctrl+Z=undo**, **Ctrl+Y=redo** (Ctrl+Z/Y handled before Ctrl+R in the global ctrl handler; Ctrl+R stays redo). Keymap help + header updated.
12. **Mixed component+label selection moves together.** Fixed both paths: (a) nudge handler (`onNormalKey` h/j/k/l) moves `selectedComps()` AND `selectedLabels()` together (was comps-only else labels-only); (b) component drag-move captures `labelOrigins` (free selected labels) in the `move` drag and moves them with the component on mousemove — owned labels already track their component's transform. Verified: drag a component with Ctrl+A-mixed selection moves the free label and owned label by the same delta.

**This session (current, above+below):**

13. **Ghost placement flow (insert mode).** Pressing a placement key (`n p N P r c L d g s x X i o O a`) or `t` no longer places immediately — it selects a **ghost** (`pendingPlace` state) that follows the cursor (gray preview via `editorOverlay` `opts.ghost`). Click a grid point or press **Enter** to commit `placePending()`; the ghost **stays selected for multi-place**. Before committing: `r`/`R` rotate the ghost (±90) and `x`/`X` mirror it — BUT with a ghost pending those keys rotate/mirror instead of selecting switches, so to pick switch_open/closed after another ghost you must first **Escape to cancel the ghost** back to the picker. `Escape`/`Backspace` cancels the ghost (back to the component-selection menu); a second `Escape` exits insert. **Insert-mode `t` picks a label ghost (was `T`); normal-mode `t` for labels removed.** `placePending` leaves `mirrorX/mirrorY` as `null` (undefined) unless toggled, so component defaults (e.g. PMOS `defaultMirrorY`) still apply.
14. **Insert menu now read-only + hidden during ghost.** `#insert-menu` is `pointer-events:none` (never blocks clicks/drags), highlights the active ghost via `.active`, and `updateInsertMenu()` removes it whenever `pendingPlace` is set — it only shows in insert mode with no ghost (it would just be in the way).
15. **Unified component-id label for ALL components.** resistor/capacitor/inductor/diode/switch* migrated from plain font-12 `refPos` text to dedicated owned `LabelInstance`s (`refPos:null` + `labelOffset`), so **every** component renders its id as the same instance label object + style (bold+italic `INSTANCE_FONT`, like nmos). Test `non-transistor symbols do not auto-create instance labels` replaced by `all component types auto-create an owned instance label for their id`.

**Still pending:** none of the label/double-click to-dos remain. The old "`astar()` dead-code cleanup in `src/core/router.js`" note is **stale — do not act on it**: `astar()` is live, wired in as `smartRoute`'s fallback (router.js:344) and covered by the passing test `smartRoute falls back to A* ...`. Nothing to clean up in router.js.

**Font styles (this session, working-tree):** `src/core/style.js` working tree has `INSTANCE_FONT`/`LABEL_FONT` (both `size:36`; instance = bold+italic for refdes), render.js applies them via `fontAttrs(kind)`. Not modified this session.

## Working-context notes
- `npm test` = **126/126 green** (model/commands/router/render/wireedit).
- CDP browser suites (headless chromium) green this session on the **debug** server (`debug_serve.sh` port **8090**) + **debug chrome** (`debug_chrome.sh` port **9227**) — isolated from the user's production 8080/9226:
  - `/tmp/opencode/mos_label_test.mjs` — NMOS/PMOS `n`/`p` hotkeys, PMOS defaultMirrorY (source up), MOS id label on bulk side/gate height, double-click inline edit, Ctrl+A + marquee label selection, wire follows moved/rotated/mirrored terminal.
  - `/tmp/opencode/feature_test.mjs` — THIS session: insert-mode `#insert-menu` shows switches, is read-only (`pointer-events:none`); `switch_open`/`switch_closed` placed via ghost `x`/`X`+Enter (cancel ghost before picking a different switch); normal-mode `t` does nothing for labels; owned-label moves when its component is nudged + `u`/`U` undo/redo; **mixed component+free-label Ctrl+A drag** moves component, free label, and owned label together.
  - `/tmp/opencode/ghost_test.mjs` — THIS session: insert menu reads `t` as label, is `pointer-events:none`, and **hides when a ghost is pending**; `n` selects a ghost (no place yet, menu hidden) → click/Enter commits, multi-place; `r` rotates the ghost (+90); Escape cancels ghost (menu returns), second Escape exits insert; `t` label ghost + Enter; **all parts (resistor etc.) get an owned instance label and render their id in bold-italic `INSTANCE_FONT`.**
  - `/tmp/opencode/wiredrag_test.mjs` — THIS session: `__circuit().nets[i].route` is the **live array** — a wire mousedown materializes it (null→array), then we author a staircase in place and drive real drags. Dragging an **interior** run down to a neighbour **collapses** the corner (staircase → straight, terminals preserved); dragging a run touching a terminal keeps the **pin fixed** and **extends** the wire with a connector. Note: `add resistor R2 160 160` does NOT place at (160,160) — use `add` + `move R2 160 160` for precise placement; grab interior lead points clear of any body (a point on R1's bbox boundary grabs the component, not the wire).
- CDP notes: headless **never fires native `dblclick`** — dispatch clickCount 1 then 2 (real CDP `Input.dispatchMouseEvent` with `clickCount:2`); the inline `<input>` selector is `input[style*="position: absolute"]`; Ctrl+A = `keyDown('a',{modifiers:MOD,code:'KeyA',keyCode:65})`; `__circuit().comps` returns **serialized** (flat `{refdes,type,x,y,rot,mx,my}`, no `transform`) so assert on `c.x`. Inline-editor Escape closes the editor first; a second Escape exits insert mode.
- `demo circuit` evaluate: bounds `{x:360,y:-120,w:480,h:360}`; nets `vcc n2,160` / `out n3,320` / `gnd n2,40`; no overlapping/bounds through-bbox/grid violations.
- Router: scoring `[bboxCrossings, wireCross, overlap, conform, turns, length]` with diagonal filtering; `segThroughInterior` (wires leaving a boundary pin straight through own body are violations; boundary-hugging legal); `evaluate().wireThroughBBoxes` uses it. `astar()` is the live `smartRoute` fallback (NOT dead code).
- `window.__circuit()` debug hook returns `{comps, nets, labels}` where labels include a `world` anchor.

## Test-env facts
- pkill patterns must be bracket-escaped (`remote-debugging-port=922[6]`, `src/web/serve\.js`).
- serve.js sends no-store; `index.html` `main.js?v=7`; `data/` and `node_modules/` gitignored.
