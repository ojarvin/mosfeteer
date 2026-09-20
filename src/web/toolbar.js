/** Display names and extra search words for the insert menu, keyed by symbol type. */
export const PLACEMENT_LABELS = {
  resistor: 'Resistor', capacitor: 'Capacitor', inductor: 'Inductor', diode: 'Diode',
  nmos: 'NMOS transistor', pmos: 'PMOS transistor',
  nmosb: 'NMOS transistor with bulk', pmosb: 'PMOS transistor with bulk',
  npn: 'NPN transistor', pnp: 'PNP transistor',
  ground: 'Ground', vcm: 'VCM (Common potential)', supply: 'Supply (VDD/VCC)',
  input: 'Input port', output: 'Output port', inputoutput: 'Input/output port',
  port: 'Port',
  current_source: 'Current source', voltage_source: 'Voltage source',
  vccs: 'VCCS (voltage-controlled current source)',
  opamp: 'Operational amplifier', opamp_diff: 'Differential op-amp', inverter: 'Inverter', buffer: 'Buffer',
  tristate_inverter: 'Tri-state inverter', tristate_buffer: 'Tri-state buffer',
  mux2: '2:1 multiplexer',
  adc: 'ADC', dac: 'DAC',
  dff: 'D flip-flop (CLK, Q)', dff_qb: 'D flip-flop (CLK, Q, QB)',
  dff_clkb: 'D flip-flop (CLKB, Q)', dff_clkb_qb: 'D flip-flop (CLKB, Q, QB)',
  dff_rst: 'D flip-flop (CLK, RST)', dff_rst_qb: 'D flip-flop (CLK, RST, Q, QB)',
  dff_clkb_rst: 'D flip-flop (CLKB, RST)', dff_clkb_rst_qb: 'D flip-flop (CLKB, RST, Q, QB)',
  dff_rstb: 'D flip-flop (CLK, RSTB)', dff_rstb_qb: 'D flip-flop (CLK, RSTB, Q, QB)',
  dff_clkb_rstb: 'D flip-flop (CLKB, RSTB)', dff_clkb_rstb_qb: 'D flip-flop (CLKB, RSTB, Q, QB)',
  latch: 'L latch (EN, Q)', latch_qb: 'L latch (EN, Q, QB)',
  latch_enb: 'L latch (ENB, Q)', latch_enb_qb: 'L latch (ENB, Q, QB)',
  latch_rst: 'L latch (EN, RST)', latch_rst_qb: 'L latch (EN, RST, Q, QB)',
  latch_enb_rst: 'L latch (ENB, RST)', latch_enb_rst_qb: 'L latch (ENB, RST, Q, QB)',
  latch_rstb: 'L latch (EN, RSTB)', latch_rstb_qb: 'L latch (EN, RSTB, Q, QB)',
  latch_enb_rstb: 'L latch (ENB, RSTB)', latch_enb_rstb_qb: 'L latch (ENB, RSTB, Q, QB)',
  and2_gate: '2-input AND gate', nand2_gate: '2-input NAND gate', or2_gate: '2-input OR gate', nor2_gate: '2-input NOR gate',
  xor2_gate: '2-input XOR gate', xnor2_gate: '2-input XNOR gate',
  and3_gate: '3-input AND gate', nand3_gate: '3-input NAND gate', or3_gate: '3-input OR gate', nor3_gate: '3-input NOR gate',
  xor3_gate: '3-input XOR gate', xnor3_gate: '3-input XNOR gate',
  variable_resistor: 'Variable resistor', variable_capacitor: 'Variable capacitor', variable_inductor: 'Variable inductor',
  solder: 'Solder dot', switch_open: 'Switch, open', switch_closed: 'Switch, closed', label: 'Annotation', block: 'Block',
  signal_sum: 'Sum junction', signal_multiply: 'Multiply junction',
};

export const PLACEMENT_ALIASES = {
  resistor: ['res', 'resistance'], capacitor: ['cap'], inductor: ['coil'],
  nmos: ['mos', 'n-channel', 'fet'], pmos: ['mos', 'p-channel', 'fet'],
  nmosb: ['mos', 'body', 'bulk', 'n-channel', 'fet'], pmosb: ['mos', 'body', 'bulk', 'p-channel', 'fet'],
  npn: ['bjt'], pnp: ['bjt'],
  supply: ['vdd', 'vcc', 'power'], vcm: ['common', 'potential', 'vcm'], input: ['in'], output: ['out'], inputoutput: ['io'],
  ground: ['gnd', 'vss'],
  current_source: ['idc', 'current'], voltage_source: ['vdc', 'voltage'],
  vccs: ['transconductance', 'controlled current', 'gm'],
  opamp: ['op amp'], opamp_diff: ['fully differential', 'diff'],
  tristate_inverter: ['tri-state', 'tristate', 'three-state', 'enable'],
  tristate_buffer: ['tri-state', 'tristate', 'three-state', 'enable'],
  mux2: ['mux', 'multiplexer', 'select', 'two input'],
  dff: ['flip flop', 'flip-flop', 'sequential', 'clocked'],
  dff_qb: ['flip flop', 'flip-flop', 'sequential', 'clocked', 'complementary'],
  dff_clkb: ['flip flop', 'flip-flop', 'sequential', 'clocked', 'active low clock'],
  dff_clkb_qb: ['flip flop', 'flip-flop', 'sequential', 'clocked', 'active low clock', 'complementary'],
  dff_rst: ['flip flop', 'flip-flop', 'sequential', 'clocked', 'reset'],
  dff_rst_qb: ['flip flop', 'flip-flop', 'sequential', 'clocked', 'reset', 'complementary'],
  dff_clkb_rst: ['flip flop', 'flip-flop', 'sequential', 'clocked', 'active low clock', 'reset'],
  dff_clkb_rst_qb: ['flip flop', 'flip-flop', 'sequential', 'clocked', 'active low clock', 'reset', 'complementary'],
  dff_rstb: ['flip flop', 'flip-flop', 'sequential', 'clocked', 'active low reset'],
  dff_rstb_qb: ['flip flop', 'flip-flop', 'sequential', 'clocked', 'active low reset', 'complementary'],
  dff_clkb_rstb: ['flip flop', 'flip-flop', 'sequential', 'clocked', 'active low'],
  dff_clkb_rstb_qb: ['flip flop', 'flip-flop', 'sequential', 'clocked', 'active low', 'complementary'],
  and2_gate: ['and', 'logic', 'two input', '2 input'],
  nand2_gate: ['nand', 'logic', 'two input', '2 input'],
  or2_gate: ['or', 'logic', 'two input', '2 input'],
  nor2_gate: ['nor', 'logic', 'two input', '2 input'],
  xor2_gate: ['xor', 'logic', 'two input', '2 input'],
  xnor2_gate: ['xnor', 'logic', 'two input', '2 input'],
  and3_gate: ['and', 'logic', 'three input', '3 input'],
  nand3_gate: ['nand', 'logic', 'three input', '3 input'],
  or3_gate: ['or', 'logic', 'three input', '3 input'],
  nor3_gate: ['nor', 'logic', 'three input', '3 input'],
  xor3_gate: ['xor', 'logic', 'three input', '3 input'],
  xnor3_gate: ['xnor', 'logic', 'three input', '3 input'],
  latch: ['latch', 'level sensitive', 'sequential', 'enable'],
  latch_qb: ['latch', 'level sensitive', 'sequential', 'enable', 'complementary'],
  latch_enb: ['latch', 'level sensitive', 'sequential', 'active low enable'],
  latch_enb_qb: ['latch', 'level sensitive', 'sequential', 'active low enable', 'complementary'],
  latch_rst: ['latch', 'level sensitive', 'sequential', 'enable', 'reset'],
  latch_rst_qb: ['latch', 'level sensitive', 'sequential', 'enable', 'reset', 'complementary'],
  latch_enb_rst: ['latch', 'level sensitive', 'sequential', 'active low enable', 'reset'],
  latch_enb_rst_qb: ['latch', 'level sensitive', 'sequential', 'active low enable', 'reset', 'complementary'],
  latch_rstb: ['latch', 'level sensitive', 'sequential', 'active low reset'],
  latch_rstb_qb: ['latch', 'level sensitive', 'sequential', 'active low reset', 'complementary'],
  latch_enb_rstb: ['latch', 'level sensitive', 'sequential', 'active low'],
  latch_enb_rstb_qb: ['latch', 'level sensitive', 'sequential', 'active low', 'complementary'],
  variable_resistor: ['potentiometer', 'pot', 'var res', 'tunable'], variable_capacitor: ['var cap', 'tunable'], variable_inductor: ['var coil', 'tunable'],
  switch_open: ['switch', 'open'], switch_closed: ['switch', 'closed'], solder: ['junction', 'dot'],
  label: ['annotation', 'text'], block: ['block', 'rectangle', 'node'],
  signal_sum: ['sum', 'summer', 'signal flow', 'junction'],
  signal_multiply: ['multiply', 'multiplier', 'signal flow', 'junction'],
};

/** Rank a name against a query: prefix beats substring beats subsequence, and
 *  a shorter match wins within a tier. -1 means no match. */
export function fuzzyScore(q, name) {
  const s = String(name).toLowerCase();
  const query = String(q).toLowerCase();
  if (!query) return 0;
  if (s.startsWith(query)) return 100 - s.length;
  if (s.includes(query)) return 80 - s.length;
  let i = 0;
  for (const ch of s) {
    if (ch === query[i]) i++;
    if (i === query.length) return 60 - s.length;
  }
  return -1;
}

/** Best rank of a symbol type across its id, display name, and aliases. */
export function placementSearchScore(query, type) {
  return Math.max(
    fuzzyScore(query, type),
    fuzzyScore(query, PLACEMENT_LABELS[type] || type),
    ...(PLACEMENT_ALIASES[type] || []).map((alias) => fuzzyScore(query, alias)),
  );
}

// How many placements the insert menu's Recent group offers.
export const INSERT_RECENT_LIMIT = 5;

/** Most-recently-used ordering: `type` moves to the front of `list`, appearing
 *  once, and the list is trimmed to `limit`. */
export function withRecentType(list, type, limit = INSERT_RECENT_LIMIT) {
  if (!type) return [...list];
  return [type, ...list.filter((entry) => entry !== type)].slice(0, limit);
}

/** Return the smallest clamped scroll offset that fully reveals a target. */
export function minimalRevealScroll(viewStart, viewEnd, targetStart, targetEnd, scroll = 0, maxScroll = 0) {
  const delta = targetStart < viewStart
    ? targetStart - viewStart
    : targetEnd > viewEnd
      ? targetEnd - viewEnd
      : 0;
  return Math.max(0, Math.min(maxScroll, scroll + delta));
}

/** Keep generated junction markers out of the user-facing component list. */
export function componentPaletteItems(components) {
  return [...components].filter((component) => component.type !== 'solder');
}

// Human ordering: S1, S2, S10 rather than lexicographic S1, S10, S2.
export const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

// The editor's keyboard reference is data, not a second hand-written list in
// the dialog. Keep this registry alongside the keyboard-facing toolbar.
export const EDITOR_KEYMAP = Object.freeze([
  ['draw', [
    ['i / I / A', 'insert mode (fuzzy-search component and label placement)'],
    ['w', 'wire mode: click terminals or points; Enter commits'],
    ['F3', 'toggle the wire route choice (orthogonal / diagonal)'],
    ['terminal letters', 'pick or complete a terminal connection while wiring'],
    ['Backspace (wire)', 'remove the latest uncommitted wire vertex'],
    ['L', 'persistent electrical net-label placement'],
    ['Shift+N', 'place one free annotation, then return to selection'],
    ['e', 'place a LaTeX equation label; starts with $$ and opens the inline editor'],
    ['a', 'place a multi-point arrow; click vertices and press Enter'],
    ['b', 'place one two-point box, then return to selection'],
    ['l', 'persistent multi-point line annotation placement'],
  ]],
  ['edit', [
    ['u / Ctrl/Cmd+Z', 'undo; insert search keeps u as text'],
    ['U / Ctrl/Cmd+Y', 'redo'],
    ['Arrow keys', 'nudge selected objects or move the cursor (counts apply)'],
    ['r', 'rotate selected objects 90° clockwise'],
    ['Shift+r', 'mirror selected horizontally'],
    ['Ctrl/Cmd+r', 'mirror selected vertically'],
    ['m', 'move selected objects with connectivity; stays armed'],
    ['Shift+m', 'move selected objects without connected nets; stays armed'],
    ['c', 'copy a selected object or set; stays armed'],
    ['y / Ctrl/Cmd+C', 'copy the selected objects'],
    ['Ctrl/Cmd+Shift+C', 'copy selection (or whole drawing) as an image for other apps'],
    ['p / Ctrl/Cmd+V', 'paste the copied set at the cursor'],
    ['Ctrl/Cmd+Shift+V', 'paste style from one copied object'],
    ['Delete', 'persistent delete; click objects while armed'],
    ['dd', 'delete the selected object set'],
    ['Shift+Up / Shift+Down', 'bring selected objects to front / send to back'],
    ['t', 'edit the primary selected label (no-op otherwise)'],
    ['Ctrl/Cmd+i', 'toggle italic on selected labels'],
    ['Ctrl/Cmd+b', 'toggle bold on selected labels'],
  ]],
  ['select', [
    ['Enter', 'select the label or component under the cursor'],
    ['Ctrl/Cmd+A', 'select all components, labels, and non-empty nets'],
    ['v', 'visual mode: arrow keys grow a box; Enter selects; Esc cancels'],
    ['Tab / Shift+Tab (selection)', 'cycle a selected component or label forward / backward'],
    ['Tab / Shift+Tab (focus)', 'focus semantic canvas objects; Enter/Space selects one'],
    ['Esc', 'cancel the active interaction'],
  ]],
  ['view', [
    ['F / f', 'fit view to contents'],
    ['#', 'toggle the placement grid'],
    ['C', 'toggle crosshair visibility'],
    ['G', 'toggle the spacing and alignment guides'],
    ['D', 'toggle dark mode'],
    ['touch / pen', 'blank touch pans; object gestures use pointer capture and cancel safely'],
  ]],
  ['file and console', [
    ['Ctrl/Cmd+S', 'save'],
    ['Ctrl/Cmd+Shift+S', 'save as: choose a folder and name'],
    ['Ctrl/Cmd+O', 'open a document file from any folder'],
    ['drop a file', 'drop a .json file on the window to open a copy'],
    ['x / Shift+x', 'check / save without checking'],
    ['Ctrl/Cmd+F', 'filter the component and net lists; Esc clears, then returns to the canvas'],
    [':', 'command line (for example, :connect R1.a R2.a)'],
    ['explain eval', 'group design-check issues with repair hints'],
    ['explain connect A.t B.t', 'dry-run a route and report path/bends/pin escapes'],
    ['F5', 'reload the application'],
    ['?', 'show this help'],
  ]],
  ['insert', [
    ['type', 'fuzzy-search names and aliases'],
    ['Enter / Tab', 'pick the highlighted match as a placement ghost'],
    ['Up / Down', 'browse matches; Left / Right jump between categories'],
    ['Enter / click', 'place the ghost at the cursor'],
    ['Arrow keys (ghost)', 'move the cursor and placement ghost'],
    ['Shift while moving', 'lock a drag or ghost to the dominant horizontal or vertical direction'],
    ['r / Shift+r', 'rotate / mirror the component ghost'],
    ['Ctrl/Cmd+r', 'mirror the component ghost vertically'],
    ['hold Ctrl/Cmd', 'symmetric placement: pin a mirror axis, move off it, place both halves'],
    ['hold Ctrl/Cmd (wire)', 'symmetric wiring: mirror the draft about the axis and commit both'],
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
    ['shift-click / shift-drag', 'add or toggle selection; Shift constrains an active drag'],
    ['middle', 'drag to pan'],
    ['right', 'drag to zoom box; click without dragging does nothing'],
    ['wheel', 'zoom about the pointer'],
    ['console separator', 'focus, then ArrowUp/Down resize; Home/End use min/max'],
  ]],
]);

export function editorKeymap() {
  return EDITOR_KEYMAP;
}

export function editorKeymapText() {
  const keymap = editorKeymap();
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
