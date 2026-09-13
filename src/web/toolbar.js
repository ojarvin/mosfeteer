/** Keep generated junction markers out of the user-facing component list. */
export function componentPaletteItems(components) {
  return [...components].filter((component) => component.type !== 'solder');
}

// Human ordering: S1, S2, S10 rather than lexicographic S1, S10, S2.
export const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

// The editor's keyboard reference is data, not a second hand-written list in
// the dialog. Keep this registry alongside the keyboard-facing toolbar.
export const EDITOR_KEYMAP = Object.freeze([
  ['normal', [
    ['L', 'persistent electrical net-label placement'],
    ['u / Ctrl/Cmd+Z', 'undo; insert search keeps u as text'],
    ['U / Ctrl/Cmd+Y', 'redo'],
    ['Shift+N', 'place one free annotation, then return to selection'],
    ['e', 'place a LaTeX equation label; starts with $$ and opens the inline editor'],
    ['a', 'place a multi-point arrow; click vertices and press Enter'],
    ['b', 'place one two-point box, then return to selection'],
    ['l', 'persistent multi-point line annotation placement'],
    ['t', 'edit the primary selected label (no-op otherwise)'],
    ['Arrow keys', 'nudge selected objects or move the cursor (counts apply)'],
    ['r', 'rotate selected objects 90° clockwise'],
    ['Shift+r', 'mirror selected horizontally'],
    ['Ctrl/Cmd+r', 'mirror selected vertically'],
    ['Ctrl/Cmd+i', 'toggle italic on selected labels'],
    ['Ctrl/Cmd+b', 'toggle bold on selected labels'],
    ['C', 'toggle crosshair visibility'],
    ['x / Shift+x', 'check / save without checking'],
    ['Ctrl/Cmd+S', 'save'],
    ['m', 'move selected objects with connectivity; stays armed'],
    ['Shift+m', 'move selected objects without connected nets; stays armed'],
    ['c', 'copy a selected object or set; stays armed'],
    ['y / Ctrl/Cmd+C', 'copy the selected objects'],
    ['Delete', 'persistent delete; click objects while armed'],
    ['dd', 'delete the selected object set'],
    ['Shift+Up / Shift+Down', 'bring selected objects to front / send to back'],
    ['p / Ctrl/Cmd+V', 'paste the copied set at the cursor'],
    ['Ctrl/Cmd+Shift+V', 'paste style from one copied object'],
    ['D', 'toggle dark mode'],
    ['w', 'wire mode: click terminals or points; Enter commits'],
    ['F3', 'toggle the wire route choice (orthogonal / diagonal)'],
    ['terminal letters', 'pick or complete a terminal connection while wiring'],
    ['Backspace (wire)', 'remove the latest uncommitted wire vertex'],
    ['Tab / Shift+Tab (selection)', 'cycle a selected component or label forward / backward'],
    ['Ctrl/Cmd+A', 'select all components, labels, and non-empty nets'],
    ['Enter', 'select the label or component under the cursor'],
    ['Tab / Shift+Tab (focus)', 'focus semantic canvas objects; Enter/Space selects one'],
    ['touch / pen', 'blank touch pans; object gestures use pointer capture and cancel safely'],
    ['F / f', 'fit view to contents'],
    ['F5', 'reload the application'],
    ['#', 'toggle the placement grid'],
    ['v', 'visual mode: arrow keys grow a box; Enter selects; Esc cancels'],
    ['i / I / A', 'insert mode (fuzzy-search component and label placement)'],
    [':', 'command line (for example, :connect R1.a R2.a)'],
    ['explain eval', 'group design-check issues with repair hints'],
    ['explain connect A.t B.t', 'dry-run a route and report path/bends/pin escapes'],
    ['?', 'show this help'],
    ['Esc', 'cancel the active interaction'],
  ]],
  ['insert', [
    ['type', 'fuzzy-search names and aliases'],
    ['Enter / Tab', 'pick the best match as a placement ghost'],
    ['Enter / click', 'place the ghost at the cursor'],
    ['Arrow keys', 'move the cursor or placement ghost'],
    ['r / Shift+r', 'rotate / mirror the component ghost'],
    ['Ctrl/Cmd+r', 'mirror the component ghost vertically'],
    ['Backspace', 'edit the search string or drop the ghost'],
    ['Esc', 'drop the ghost or exit insert mode'],
  ]],
  ['labels', [
    ['L', 'click an unambiguous wire to place a net label; Esc exits'],
    ['Shift+N', 'click anywhere to place one annotation; returns to selection'],
    ['t', 'edit the primary selected label'],
    ['Shift+Left / Shift+Right', 'align left / right (centre default)'],
    ['dd / Delete', 'delete the selected label'],
    ['double-click', 'edit the label text inline'],
    ['Tab / S-Tab', 'commit label edit, then select next / previous label'],
    ['Ctrl/Cmd+, / Ctrl/Cmd+.', 'in the label editor, subscript / superscript the selection'],
    ['Enter / blur', 'commit label edits; Esc cancels'],
  ]],
  ['mouse', [
    ['left', 'click to select; drag empty space for a marquee; drag an object to move'],
    ['wire', 'w, then click a terminal or point; Enter commits'],
    ['wire join', 'click an existing wire to branch; Enter on it joins the net'],
    ['wire select', 'click a run; Shift-click toggles runs; drag reroutes selected runs'],
    ['wire delete', 'dd removes selected runs'],
    ['shift-click / shift-drag', 'add or toggle selection'],
    ['middle', 'drag to pan'],
    ['right', 'drag to zoom box; click without dragging does nothing'],
    ['wheel', 'zoom about the pointer'],
    ['console separator', 'focus, then ArrowUp/Down resize; Home/End use min/max'],
  ]],
]);

const BLOCK_EDITOR_KEYMAP = Object.freeze([
  ['block', [
    ['i', 'place a block'],
    ['w', 'draw a Connector between block terminals; arrowheads show direction'],
    ['Shift+L', 'attach a label to a connector; it follows connector moves'],
    ['m', 'click a block or use the selection, then click/Enter to move it; connectors follow'],
    ['c / y', 'copy a block or selected set; click/Enter to place repeated copies'],
    ['Shift+m', 'detached move for selected blocks or connectors; internal connectors stay attached'],
    ['Shift+N / a / b / l', 'place text, arrow, box, or line annotations'],
    ['Delete / dd', 'delete selected blocks, connectors, or annotations'],
    ['Enter / F2 / double-click', 'edit the selected block or annotation text'],
    ['r', 'rotate selected blocks 90°'],
    ['Shift+r / Ctrl+r', 'mirror block rectangles (no visual change)'],
    ['Shift+Up / Shift+Down', 'restack selected objects'],
    ['v', 'visual selection'],
    ['F / # / C', 'fit / grid / crosshair'],
    ['F5', 'reload the application'],
    ['u / U / Ctrl/Cmd+Z / Ctrl/Cmd+Y', 'undo / redo'],
    ['Ctrl/Cmd+A', 'select all blocks, connectors, and annotations'],
    ['Ctrl/Cmd+C', 'copy one selected object\'s style'],
    ['Ctrl/Cmd+Shift+V', 'paste the copied style'],
    ['Ctrl/Cmd+S', 'save'],
    ['D', 'toggle dark mode'],
    ['Esc', 'cancel the active block tool'],
    ['resize handles', 'drag a selected block handle; minimum two grid cells'],
    ['style buttons', 'color, line style, and width apply to selected objects'],
  ]],
  ['mouse', [
    ['left', 'click/select; Move and Copy use a source click, then a destination click'],
    ['double-click', 'edit a block name on canvas or in the Blocks toolbar'],
    ['connector label', 'Shift+L, click a connector; labels are visual and non-electrical'],
    ['connector', 'w, click a terminal, click guide points, click a target terminal'],
    ['middle / wheel', 'pan / zoom'],
  ]],
]);

export function editorKeymapText(kind = 'all') {
  const keymap = kind === 'block' ? BLOCK_EDITOR_KEYMAP : EDITOR_KEYMAP;
  return keymap.flatMap(([section, entries]) => [
    `-- ${section} --`,
    ...entries.map(([key, description]) => `${key.padEnd(24)}${description}`),
  ]).join('\n');
}

/** Return a layer command for an unmodified normal-mode arrow shortcut. */
export function layerActionForKey({
  key,
  shiftKey = false,
  ctrlKey = false,
  metaKey = false,
  altKey = false,
  mode = 'normal',
  wire = false,
  directWire = false,
  visual = false,
  drag = false,
  moveMode = null,
  copyMode = false,
  deleteMode = false,
  labelMode = null,
  textEntry = false,
} = {}) {
  if (textEntry || !shiftKey || ctrlKey || metaKey || altKey || mode !== 'normal'
      || wire || directWire || visual || drag || moveMode || copyMode || deleteMode || labelMode) return null;
  if (key === 'ArrowUp') return 'bring-front';
  if (key === 'ArrowDown') return 'send-back';
  return null;
}
