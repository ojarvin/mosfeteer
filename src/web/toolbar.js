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
    ['u / C-z', 'undo; insert search keeps u as text'],
    ['U / C-y', 'redo'],
    ['Shift+N', 'place one free annotation, then return to selection'],
    ['e', 'place a LaTeX equation label; starts with $$ and opens the inline editor'],
    ['a', 'place a multi-point arrow; click vertices and press Enter'],
    ['b', 'place one two-point box, then return to selection'],
    ['l', 'persistent multi-point line annotation placement'],
    ['t', 'edit the primary selected label (no-op otherwise)'],
    ['Arrow keys', 'move selected components / labels or cursor (counts apply)'],
    ['r', 'rotate selected 90 cw'],
    ['Shift+r', 'mirror selected horizontally'],
    ['Ctrl+r', 'mirror selected vertically'],
    ['Ctrl+i', 'toggle italic on selected labels'],
    ['Ctrl+b', 'toggle bold on selected labels'],
    ['C', 'toggle crosshair visibility'],
    ['x / Shift+x', 'check / save'],
    ['C-s', 'save'],
    ['m', 'connected move; stays armed'],
    ['Shift+m', 'detached move; stays armed'],
    ['c', 'repeated copy ghost'],
    ['y / C-c', 'copy the selected objects'],
    ['Delete', 'persistent delete; click objects while armed'],
    ['dd', 'delete the selected object set'],
    ['Shift+Up / Shift+Down', 'bring selected objects to front / send to back'],
    ['p / C-v', 'paste the copied set at the cursor'],
    ['C-S-v', 'paste style from one copied object'],
    ['D', 'toggle dark mode'],
    ['w', 'wire mode: click terminals or points; Enter commits'],
    ['F3', 'toggle the wire route choice (orthogonal / diagonal)'],
    ['terminal letters', 'pick or complete a terminal connection while wiring'],
    ['Backspace (wire)', 'remove the latest uncommitted wire vertex'],
    ['Tab / S-Tab', 'cycle singleton component / label forward / backward'],
    ['Ctrl-A', 'select all components, labels, and non-empty nets'],
    ['Enter', 'select the component under the cursor'],
    ['Tab / Shift+Tab', 'focus semantic canvas objects; Enter/Space selects one'],
    ['touch / pen', 'blank touch pans; object gestures use pointer capture and cancel safely'],
    ['F / f', 'fit view to contents'],
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
    ['Ctrl+r', 'mirror the component ghost vertically'],
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
    ['C-, / C-.', 'in the label editor, subscript / superscript the selection'],
    ['Enter / blur', 'commit label edits; Esc cancels'],
  ]],
  ['mouse', [
    ['left', 'click select; drag marquee-select; drag a component to move'],
    ['wire', 'w, then click a terminal or point; Enter commits'],
    ['wire join', 'click an existing wire to branch; Enter on it joins'],
    ['wire select', 'click selects a run; Shift-click adds/removes runs; drag re-routes'],
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
    ['w', 'draw a Connector between block terminals; connectors use arrowheads'],
    ['Shift+L', 'attach a label to a connector; it follows connector moves'],
    ['m', 'click a block to arm, then click/Enter to commit the move; connectors follow'],
    ['c / y', 'click a source, then click/Enter to commit a repeated copy; selected block sets include internal connectors and their labels'],
    ['Shift+m', 'detached move for selected blocks or connectors; internal connectors stay attached'],
    ['Shift+N / a / b / l', 'place text, arrow, box, or line annotations'],
    ['Delete / dd', 'delete selected blocks, connectors, or annotations'],
    ['Enter / F2 / double-click', 'edit the selected block or annotation text'],
    ['r / Shift+r / Ctrl+r', 'rotate / mirror selected objects'],
    ['Shift+Up / Shift+Down', 'restack selected objects'],
    ['v', 'visual selection'],
    ['F / # / C', 'fit / grid / crosshair'],
    ['u / U', 'undo / redo'],
    ['Esc', 'cancel the active block tool'],
    ['resize handles', 'drag a selected block handle; minimum two grid cells'],
    ['style buttons', 'color, line style, and width apply to selected objects'],
  ]],
  ['mouse', [
    ['left', 'click/select; Move/Copy use source click then destination click'],
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
