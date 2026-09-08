/** Keep generated junction markers out of the user-facing component list. */
export function componentPaletteItems(components) {
  return [...components].filter((component) => component.type !== 'solder');
}

// The editor's keyboard reference is data, not a second hand-written list in
// the dialog. Keep this registry alongside the keyboard-facing toolbar.
export const EDITOR_KEYMAP = Object.freeze([
  ['normal', [
    ['L', 'persistent electrical net-label placement'],
    ['u / C-z', 'undo; insert search keeps u as text'],
    ['U / C-y', 'redo'],
    ['Shift+N', 'place one free annotation, then return to selection'],
    ['a', 'place one two-point arrow, then return to selection'],
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
    ['F / f', 'fit view to contents'],
    ['#', 'toggle the placement grid'],
    ['v', 'visual mode: arrow keys grow a box; Enter selects; Esc cancels'],
    ['i / I / A', 'insert mode (fuzzy-search component and label placement)'],
    [':', 'command line (for example, :connect R1.a R2.a)'],
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

export function editorKeymapText() {
  return EDITOR_KEYMAP.flatMap(([section, entries]) => [
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
