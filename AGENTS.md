# schematic-spawner — working context

Programmatic/agent-assisted schematic editor. Connectivity-based model rendered to SVG.
Git repo (root commit `e868342`, label commit `dd750f6`) → private `ojarvin/schematic-spawner`.
**Push only over HTTPS** (SSH permanently unavailable headless, "Permission denied (publickey)");
`origin` = HTTPS URL, `gh` is the credential helper.

## Do NOT modify (user-owned style guide)
- `src/core/components/resistor.js` geometry (terminals/bbox/graphics) or `src/core/style.js` values.
  Only `refPos`/`textPos` ("the label in resistor") may be tweaked. Treat current working-tree versions as canonical.

## Current symbol geometry (affects tests/wire tests)
- resistor: terminals `a`(0,0)/`b`(160,0), bbox `{0,-40,160,80}`, 5-segment zigzag.
- `style.js`: `LINE {stroke:'#111', width:6, cap:'round', join:'round'}`, `THICK` = 8, cap flat. (working tree: `INSTANCE_FONT`/`LABEL_FONT` both `size:40`, bold+italic instance.)
- nmos/pmos/npn/pnp: `refPos:null` + `labelOffset {x:120,y:0}` → the instance label sits on the **bulk side** (opposite the gate = to the RIGHT), vertically centered at gate height (source up is handled via transform, not label move). Confirmed world anchors: NMOS `M1` at (120,0), PMOS `M2` at (160,0) when placed at (0,0)/(40,0).
- nmos: terminals `g`(0,0), `d`(120,-80), `s`(120,80), bbox `{0,-80,120,160}`; source arrow `M 53 38 L 60 30 L 53 22 Z` points OUT of the channel (down-right).
- pmos: BODY = exact NMOS copy (no gate balloon), only the source arrow differs — `M 67 38 L 60 30 L 67 22 Z` points INTO the channel (reverse of NMOS). `defaultMirrorY:true` → when placed, source points UP (source at top-right world, drain bottom-right); confirmed terminal `s` world y=-80, `d` world y=+80.
- `ComponentInstance` applies `def.defaultMirrorY`/`def.defaultMirrorX` when `opts.mirror*` is undefined (only used by pmos for now).

## Label model (implemented)
- Labels are NOT a component/symbol type: separate `circuit.labels: Map<id,LabelInstance>` (like solder — no terminals, don't block routing in netEnv).
- `LabelInstance`: `id, text, align(center|left|right), owner(refdes|null), offset(local grid-snapped when owned), anchor(world grid-snapped)`.
- **Bbox model (revised):** tight text bbox computed from per-glyph widths (`LABEL_FONT_SIZE=40`, `LABEL_CHAR_W=7` at font 12; narrow/default/wide buckets) and `LABEL_CAP_H=round(40*0.7)=28` height. The rendered box expands the tight box to **even multiples of a grid cell in BOTH dimensions** (`colWidth()`/`rowHeight()`, min 2 cells) and is **centered on the anchor**, so the box center is always on a grid point. The box always updates on `setText`. `bbox()` = centered box; `textPos()` returns the `<text>` `{x,y,anchor}` so the text is horizontally aligned inside the box (left/right/center) and **vertically centered** (baseline `y=anchor.y + LABEL_CAP_H/2`).
- Auto-created in `addComponent` when `def.labelOffset && !opts.noLabel` (text=refdes, align center); `addComponent` for transistors sets `refPos:null`.
- `fromJSON` uses `noLabel:true` then loads `data.labels`, drops orphaned owned labels.
- `nextRefdes(prefix)` returns smallest unused positive index (reuse after deletion).
- Group transform (about grid-snapped bbox-union centroid P; order mirror→rotate→translate): 90 `nx=P.x-(ty-P.y),ny=P.y+(tx-P.x)`; 180 `nx=2P.x-tx,ny=2P.y-ty`; 270 `nx=P.x+(ty-P.y),ny=P.y-(tx-P.x)`; mirror x `nx=2P.x-tx` toggle mirrorX; mirror y `ny=2P.y-ty` toggle mirrorY. Increments `rotation`.
- Editor UX (main.js): `t`/`T` place label; Shift+ArrowLeft/Right cycle align; nudge h/j/k/l; dd/Delete removes; double-click inline `<input>` (Enter/blur commit, Esc cancel); palette "label" button. **Multi-label selection** now supported: `selLabels:Set` (plus `selLabel` = primary id), extends/deselects component `multi`. `setLabelSelection(ids, primary)` sets both; `setSelection`/Escape clears both. Selection overlay highlights all `selLabels` (editorOverlay `opts.selLabels`).

**Completed this session (uncommitted):**

1. **Double-click label edit fixed (robust).** Root cause: the second mousedown of a double-click started a `labelmove` drag, leaving drag state that fought the `dblclick` handler. Fix: in `canvasMouseDown`, when picking a label with `ev.detail >= 2`, select and call `inlineEditLabel(labelHit)` directly (rather than waiting for the native `dblclick`, which headless CDP never fires). `inlineEditLabel` has an `inlineInput` guard so the `dblclick` fallback listener can't open a second input. (Tests still dispatch a manual `dblclick` on `#canvas`; the `<input>` selector is `input[style*="position: absolute"]`.)
2. **Ctrl+A / box-select now selects labels.** `selLabels` participates in Ctrl+A (selects all components + all labels), drag-marquee (`rectOverlap` on label bbox, with shift=add via `startLabelSelection`), and shift-click toggle. Moving/dragging/nudging acts on all `selectedLabels()`; dd/Delete removes all `selLabels`.
3. **Wires stay connected on move/flip/rotate.** `commands.js` `move`/`rotate`/`mirror` now call `rerouteNetsFor(circuit, [refdes])` (re-runs `smartRoute` over the nets touching the component); the editor drag-move already re-routes via `rerouteAffected` on mouseup (and live during drag). Verified: net endpoints track the moved/rotated/mirrored terminal.
4. **NMOS source arrowhead** added: `M 53 38 L 60 30 L 53 22 Z` (points out of channel).
5. **PMOS** is now an NMOS copy (no gate balloon) with reversed arrow (`M 67 38 L 60 30 L 67 22 Z`, INTO channel) and `defaultMirrorY:true` so source points up at placement.
6. **MOS identifier label moved to the bulk side at gate height:** `labelOffset {x:120,y:0}` for both nmos & pmos. (Earlier `{-40,0}` put it on the GATE side — wrong.)
7. **Hotkeys:** insert mode `n`=nmos, `p`=pmos, `N`=npn, `P`=pnp (was `n P b p`).
8. **Label bbox revise:** tight per-glyph text box expanded to even-cell multiples in both dims, box centered on anchor (grid point), text aligned inside (left/center/right) + vertically centered; box updates on `setText`.

**Still pending (user-reported):** none of the two prior label to-dos remain. Remaining: `astar()` dead-code cleanup in `src/core/router.js`.

**Font styles (this session, working-tree):** `src/core/style.js` working tree has `INSTANCE_FONT`/`LABEL_FONT` (both `size:40`; instance = bold+italic for refdes), render.js applies them via `fontAttrs(kind)`. Not modified this session.

## Working-context notes
- `npm test` = **116/116 green** (model/commands/router/render).
- CDP browser suites (headless chromium, `--remote-debugging-port=9226`, `--window-size=1500,950`) all green:
  - `/tmp/opencode/label_test.mjs` — label place/drag/align/inline-edit/delete, owned-label transform follow, refdes reuse, group rotate about centroid. Note: headless CDP **never fires `dblclick`** — the test dispatches it manually on `#canvas`; and the inline `<input>` style selector must be `input[style*="position: absolute"]` (CSSOM serializes with a space).
  - `/tmp/opencode/mos_label_test.mjs` — THIS session: NMOS/PMOS `n`/`p` hotkeys, PMOS defaultMirrorY (source up), MOS id label on bulk side/gate height, double-click inline edit, Ctrl+A + marquee label selection, wire follows moved/rotated/mirrored terminal.
  - `/tmp/opencode/wire_test.mjs` — wiring/smart-router/preview/undo/segment-drag with wider-resistor coords (grab point (440,-40), R2.b at 800).
  - `/tmp/opencode/mouse_test.mjs` — cursor/select/drag-move/marquee/pan/zoom/fit.
- `demo circuit` evaluate: bounds `{x:360,y:-120,w:480,h:360}`; nets `vcc n2,160` / `out n3,320` / `gnd n2,40`; no overlapping/bounds through-bbox/grid violations.
- Router: scoring `[bboxCrossings, wireCross, overlap, turns, length]` with diagonal filtering; `segThroughInterior` (wires leaving a boundary pin straight through own body are violations; boundary-hugging legal); `evaluate().wireThroughBBoxes` uses it. `astar()` dead-code cleanup in `src/core/router.js` still pending.
- `window.__circuit()` debug hook returns `{comps, nets, labels}` where labels include a `world` anchor.

## Test-env facts
- pkill patterns must be bracket-escaped (`remote-debugging-port=922[6]`, `src/web/serve\.js`).
- serve.js sends no-store; `index.html` `main.js?v=7`; `data/` and `node_modules/` gitignored.
