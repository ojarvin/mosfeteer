/** Display names and extra search words for the insert menu, keyed by symbol type. */
/** A part's name short enough for a radial tile: the parenthetical and the
 *  words every sibling shares go (the full name stays in the tooltip). */
export function shortPlacementLabel(type) {
  const label = PLACEMENT_LABELS[type] || String(type).replace(/_/g, ' ');
  const sequential = label.match(/^(D flip-flop|L latch) \((.*)\)$/);
  if (sequential) return `${sequential[1] === 'L latch' ? 'Latch' : 'DFF'} ${sequential[2].replace(/, /g, ' ')}`;
  return label
    .replace(/ \(.*\)$/, '')
    .replace(/^Operational amplifier$/, 'Op-amp')
    .replace(/ transistor/, '')
    .replace(/ with bulk$/, ' bulk')
    .replace(/^Differential /, 'Diff. ')
    .replace(/^Variable /, 'Var. ')
    .replace(/^Input\/output port$/, 'In/out port')
    .replace(/^(\d)-input (\w+) gate$/, '$2$1');
}

export const PLACEMENT_LABELS = {
  resistor: 'Resistor', capacitor: 'Capacitor', inductor: 'Inductor', impedance: 'Impedance', diode: 'Diode',
  nmos: 'NMOS transistor', pmos: 'PMOS transistor',
  nmosb: 'NMOS transistor with bulk', pmosb: 'PMOS transistor with bulk',
  npn: 'NPN transistor', pnp: 'PNP transistor',
  ground: 'Ground', vcm: 'VCM (Common potential)', supply: 'Supply (VDD/VCC)',
  input: 'Input port', output: 'Output port', inputoutput: 'Input/output port',
  port: 'Port',
  current_source: 'Current source', voltage_source: 'Voltage source',
  vccs: 'VCCS (voltage-controlled current source)',
  vcvs: 'VCVS (voltage-controlled voltage source)',
  opamp: 'Operational amplifier', opamp_diff: 'Differential op-amp', gm: 'Gm cell (transconductor)', inverter: 'Inverter', buffer: 'Buffer',
  tristate_inverter: 'Tri-state inverter', tristate_buffer: 'Tri-state buffer',
  mux2: '2:1 multiplexer',
  adc: 'ADC', dac: 'DAC', adc_diff: 'Differential ADC', dac_diff: 'Differential DAC',
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
  comparator: 'Comparator', comparator_clocked: 'Clocked comparator',
  filter_lpf: 'Low-pass filter', filter_hpf: 'High-pass filter', filter_bpf: 'Band-pass filter', filter_notch: 'Notch filter',
  tf_s: 'Transfer function H(s)', tf_z: 'Transfer function H(z)', tf_dac: 'DAC, z to s (NRZ pulse: zero-order hold)', tf_dac_rz: 'DAC, z to s (RZ pulse: half-period hold)', tf_delay: 'Delay e^-sT', tf_zdelay: 'Delay z^-1', gain: 'Gain', sampler: 'Sampler, s to z (ideal: no hold)', quantizer: 'Quantizer (N levels)',
};

export const PLACEMENT_ALIASES = {
  resistor: ['res', 'resistance'], capacitor: ['cap'], inductor: ['coil'], impedance: ['load', 'network'],
  nmos: ['mos', 'n-channel', 'fet'], pmos: ['mos', 'p-channel', 'fet'],
  nmosb: ['mos', 'body', 'bulk', 'n-channel', 'fet'], pmosb: ['mos', 'body', 'bulk', 'p-channel', 'fet'],
  npn: ['bjt'], pnp: ['bjt'],
  supply: ['vdd', 'vcc', 'power'], vcm: ['common', 'potential', 'vcm'], input: ['in'], output: ['out'], inputoutput: ['io'],
  ground: ['gnd', 'vss'],
  current_source: ['idc', 'current'], voltage_source: ['vdc', 'voltage'],
  vccs: ['transconductance', 'controlled current', 'gm'],
  vcvs: ['controlled voltage', 'voltage gain'],
  opamp: ['op amp'], opamp_diff: ['fully differential', 'diff'],
  gm: ['transconductor', 'ota', 'gm cell', 'transconductance', 'differential'],
  adc_diff: ['converter', 'differential', 'diff'], dac_diff: ['converter', 'differential', 'diff'],
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
  filter_lpf: ['lpf', 'lowpass', 'low pass', 'filter', 'signal flow'],
  filter_hpf: ['hpf', 'highpass', 'high pass', 'filter', 'signal flow'],
  filter_bpf: ['bpf', 'bandpass', 'band pass', 'filter', 'signal flow'],
  filter_notch: ['notch', 'band stop', 'bandstop', 'band reject', 'filter', 'signal flow'],
  gain: ['gain', 'amplifier', 'coefficient', 'scale', 'triangle', 'signal flow'],
  dither: ['dither', 'noise', 'random', 'source', 'tpdf', 'rpdf', 'sigma delta', 'signal flow'],
  quantizer: ['quantizer', 'adc', 'comparator', 'levels', 'single-bit', 'multibit', 'sigma delta', 'signal flow'],
  sampler: ['sampler', 'sample', 'switch', 'ideal sampler', 'adc', 's to z', 'continuous-time', 'sigma delta', 'signal flow'],
  tf_s: ['tf', 'transfer function', 'laplace', 's-domain', 'gain', 'integrator', 'block', 'signal flow'],
  tf_z: ['tf', 'transfer function', 'z-domain', 'discrete', 'delay', 'accumulator', 'gain', 'signal flow'],
  tf_dac: ['dac', 'nrz', 'zero-order hold', 'zoh', 'hold', 'sample and hold', 'z to s', 'pulse', 'feedback', 'sigma delta', 'signal flow'],
  tf_dac_rz: ['dac', 'rz', 'return to zero', 'z to s', 'pulse', 'feedback', 'sigma delta', 'signal flow'],
  tf_delay: ['delay', 'excess loop delay', 'eld', 'exp', 'signal flow'],
  tf_zdelay: ['delay', 'z^-1', 'unit delay', 'register', 'signal flow'],
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
    ['i', 'insert mode (fuzzy-search component and label placement)'],
    ['w', 'wire mode: click terminals or points; hold Alt to snap the cursor to the nearest terminal or free wire end; a click on a free wire end joins it; Enter commits'],
    ['F3', 'toggle the wire route choice (orthogonal / diagonal)'],
    ['/ (wire)', 'flip which way the corner under the cursor turns'],
    ['drag from a pin', 'draw a wire without Wire mode; drop on a pin or wire, or in space to add a part'],
    ['terminal letters', 'pick or complete a terminal connection while wiring'],
    ['Backspace (wire)', 'remove the latest uncommitted wire vertex'],
    ['Shift+L', 'type net label names (a bus DOUT[3:0] spells out its bits), then click wires to place each'],
    ['Shift+N', 'type free text, then click to place it once'],
    ['e', 'place a LaTeX equation label; starts with $$ and opens the inline editor'],
    ['a', 'place a multi-point arrow; click vertices and press Enter'],
    ['b', 'place one two-point box, then return to selection; with a selection, box it (in the box tool, click objects to pick them, Enter boxes them)'],
    ['l', 'persistent multi-point line annotation placement'],
  ]],
  ['edit', [
    ['Ctrl/Cmd+Z / u', 'undo; insert search keeps u as text'],
    ['Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y / Shift+U', 'redo'],
    ['Arrow keys', 'nudge selected objects or move the cursor'],
    ['r', 'rotate selected objects 90° clockwise'],
    ['Shift+R', 'mirror selected horizontally'],
    ['Ctrl/Cmd+R', 'mirror selected vertically'],
    ['r / Shift+R / Ctrl+R (dragging)', 'rotate or mirror a part while it is being dragged'],
    ['m', 'move selected objects with connectivity; stays armed'],
    ['Shift+M', 'move selected objects without connected nets; stays armed'],
    ['c', 'copy a selected object or set; stays armed'],
    ['Ctrl/Cmd+C', 'copy the selected objects, also for another editor'],
    ['copy a net label', 'copied alone it carries its name: paste (or Ctrl-drag) it onto a wire to give that net the name'],
    ['Ctrl/Cmd+Shift+C', 'copy selection (or whole drawing) as an image for other apps'],
    ['Ctrl/Cmd+V', 'paste objects copied here or in another editor at the cursor'],
    ['Ctrl/Cmd+Shift+V', 'paste style from one copied object'],
    ['Delete', 'persistent delete; click objects while armed'],
    ['dd', 'delete the selected object set'],
    ['q', 'change the type of the selected (or pointed-at) parts: nmos to pmos, R to C, ...; wiring stays where the pins carry over'],
    ['g / v (on a pin)', 'wire a ground / supply one cell out from the unconnected pin under the cursor, pointing the way the pin leads'],
    ['Shift+T', 'tidy the selection: re-lay its nets fresh and move its crowded labels clear, as one undo'],
    ['o', 'show or hide the selected (or pointed-at) part\'s linked design beside the drawing; link a part from its right-click menu'],
    ['Shift+O', 'show or hide every linked part\'s design beside the drawing'],
    ['Alt+↓ / Alt+↑', 'open the selected part\'s linked design (or double-click its bubble) / back up to the design it was opened from, else to one it is used in'],
    ['Shift+J', 'join the selected line annotations into one continuous line (they meet end to end or share a stretch)'],
    ['Shift+K', 'timing diagram of the switch phases and signals you add: edit its slots in a grid beside the drawing; Make beats writes the timing into the beats'],
    ['Box over vertices', 'a box catching only some vertices of lines or arrows picks them, on any number of lines; Shift+box or Shift/Ctrl-click a vertex adds more; drag one to move them together, Delete removes them, Escape lets go'],
    ['.', 'repeat the last rotate, mirror, swap, rail, or stubs on the current selection'],
    ['Shift+Up / Shift+Down', 'bring selected objects to front / send to back'],
    ['Ctrl/Cmd+Shift+Arrows', 'align selected edges; repeat to centre that axis'],
    ['Shift+A', 'align to: click an edge or point of the selection, then a matching one of another object; the set moves as one'],
    ['Space', 'wire stubs: a labelled stub (net1, net2, ...) on every unconnected terminal of the selected parts; any that would short are skipped'],
    ['9', 'highlight nets: each click cycles a net group\'s color'],
    ['8', 'remove every net highlight'],
    ['t / = / F2', 'edit the text of the selection (a label, a part\'s name, a net\'s label) or of what the cursor points at; with several switches or rails selected, the phase or rail name goes to all'],
    ['Ctrl/Cmd+I', 'toggle italic on selected labels'],
    ['Ctrl/Cmd+B', 'toggle bold on selected labels'],
    ['Shift+Enter / Tab', 'while editing text: a new line (blank lines too); in free text Tab indents and Shift+Tab unindents (the style panel\'s M sets a monospace face, for tables)'],
  ]],
  ['select', [
    ['Enter', 'select the label or component under the cursor'],
    ['click a selected object', 'select the next object stacked at that point (pins, wires, dots, part boxes); a press there drags the selected one'],
    ['Ctrl/Cmd+A', 'select all components, labels, and non-empty nets'],
    ['Tab / Shift+Tab (selection)', 'cycle a selected component or label forward / backward'],
    ['Tab / Shift+Tab (focus)', 'focus semantic canvas objects; Enter/Space selects one'],
    ['Esc', 'cancel the active interaction'],
  ]],
  ['view', [
    ['f', 'fit view to contents'],
    ['#', 'toggle the placement grid'],
    ['Shift+C', 'toggle crosshair visibility'],
    ['Shift+G', 'toggle the spacing and alignment guides'],
    ['Shift+D', 'toggle dark mode'],
    ['Shift+P', 'show or hide the components, nets, and selection panel'],
    ['Shift+S', 'show or hide the small-signal analysis window'],
    ['Shift+V', 'show or hide reference windows: another design beside this one, zoomed and panned on its own; its title picks the design'],
    ['Shift+W', 'show or hide the oscilloscope: a signal-flow diagram\'s nets in time; drag pans, right-drag zooms (a flat stroke time only), the wheel zooms'],
    ['Shift+E', 'show or hide the calculator: 20*log(123), 4.7k, R = 10k, ans; Enter works a line out, Up/Down recall'],
    ['Shift+Backspace', 'Atlas view: every design at its real size; Enter or double-click opens one, Esc clears the pick, Shift+Backspace (or Enter with nothing picked) returns'],
    ['Space+drag', 'pan the view'],
    ['touch / pen', 'blank touch pans; object gestures use pointer capture and cancel safely'],
  ]],
  ['atlas', [
    ['drag / scroll', 'move over the desk; right-drag zooms to a box'],
    ['click', 'pick a design (Ctrl/Shift+click several); copy as an image then copies the picked ones'],
    ['double-click / Enter', 'open the picked design'],
    ['/ / Ctrl/Cmd+F', 'search every design: parts, nets, text, #tags'],
    ['#', 'edit the picked design\'s tags'],
    ['z', 'zoom to the picked design'],
    ['f', 'fit every design'],
    ['l', 'show or hide the links between designs'],
    ['Shift+T', 'repack the desk by kinship'],
    ['Esc', 'clear the search, then the pick'],
    ['Enter (nothing picked) / Shift+Backspace', 'back to the drawing'],
  ]],
  ['beats', [
    ['Shift+B', 'show or hide the beats window (closing it shows the whole drawing)'],
    ['+', 'add a beat after the one on screen; it starts out looking the same'],
    ['Alt+→ / Alt+←', 'next / previous beat (also PageDown / PageUp); before the first is the whole drawing'],
    ['h (on a beat)', 'hide the selection from this beat on, or show it when hidden'],
    ['Shift+H (on a beat)', 'dim the selection from this beat on, or show it when dimmed'],
    ['s', 'open or close the selected switches with their whole phase (on a beat: from that beat on)'],
    ['9 / 8 (on a beat)', 'highlights belong to the beat on screen and the ones after it'],
    ['Ctrl/Shift+click a beat', 'pick several beats in the strip; Delete then removes them (undoable)'],
    ['Shift+F5', 'present the beats full screen; arrows or Space step, . blanks, Esc ends'],
  ]],
  ['file and console', [
    ['Ctrl/Cmd+S', 'save'],
    ['Ctrl/Cmd+Shift+S', 'save as: choose a folder and name'],
    ['Ctrl/Cmd+O', 'open a document file from any folder'],
    ['Ctrl/Cmd+E', 'open the export dialog'],
    ['drop a file', 'drop a .json file on the window to open a copy'],
    ['x / Shift+X', 'check / save without checking'],
    ['/ / Ctrl/Cmd+F', 'find parts, nets, and any label text (in the Atlas: search every design); Esc clears, then returns to the canvas'],
    ['Ctrl/Cmd+H', 'replace text in every matching label: net names (labelled or not), part names, switch phases, annotations; M1 finds M_{1}; Aa matches case, .* takes a regular expression ($1 in the replacement); Enter replaces all; Esc clears both fields and returns to the canvas'],
    [':', 'find and run anything: type words to search every action, toggle, and menu item, Up/Down pick, Enter runs; or type a command (:connect R1.a R2.a); Up/Down on an empty line recall history'],
    [': Tab / Shift+Tab', 'complete the command word, synonyms included (sett → settings); editor commands work panels, toggles, and menus (:grid off, :panel, :analysis, :export)'],
    ['status message', 'click (or hover) the last message to open the log; the pin keeps it open'],
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
    ['r / Shift+R', 'rotate / mirror the component ghost'],
    ['Ctrl/Cmd+R', 'mirror the component ghost vertically'],
    ['hold Alt', 'symmetric placement/copy: pin a mirror axis, move off it, and place both halves'],
    ['hold Alt (wire)', 'snap the cursor to the nearest terminal or free wire end while wiring'],
    ['Backspace', 'edit the search string or drop the ghost'],
    ['Esc', 'drop the ghost or exit insert mode'],
  ]],
  ['labels', [
    ['Shift+L', 'type the names, then click a wire for each; Esc exits'],
    ['Shift+N', 'type the text, then click to place it; returns to selection'],
    ['t / = / F2', 'edit the selected (or pointed-at) label or part name'],
    ['Shift+Left / Shift+Right', 'align left / right (centre default)'],
    ['dd / Delete', 'delete the selected label'],
    ['double-click', 'edit the label text inline'],
    ['Tab / Shift+Tab', 'commit label edit, then select next / previous label'],
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
    ['Ctrl/Cmd+drag a part', 'drag a copy; a Ctrl/Cmd-click still toggles selection'],
    ['Ctrl/Cmd+drag a wire', 'grow a new branch from that point'],
    ['drop a part on a wire', 'a free two-pin part lying along one straight wire is spliced in'],
    ['Shift+drag (Delete)', 'knife: cut every wire segment the stroke crosses'],
    ['double-click paper', 'open the insert menu at that point'],
    ['middle', 'drag to pan'],
    ['right-hold paper', 'part palette: flick toward a part to drop it there; rest on a sector for its variants'],
    ['right-hold a pin', 'connect it: ground, supply, VCM, a port, a labelled stub, or a wire'],
    ['right-hold a part', 'swap it for a related type'],
    ['right-hold a wire', 'its net: name, label, highlight color, tidy, delete the run'],
    ['right tap / drag', 'tap for the context menu; a drag zooms to the box, from paper or a part'],
    ['wheel', 'zoom about the pointer (with Trackpad scrolling: scroll pans, pinch zooms)'],
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
  drag = false,
  moveMode = null,
  copyMode = false,
  deleteMode = false,
  labelMode = null,
  textEntry = false,
} = {}) {
  if (textEntry || !shiftKey || ctrlKey || metaKey || altKey || mode !== 'normal'
      || wire || directWire || drag || moveMode || copyMode || deleteMode || labelMode) return null;
  if (key === 'ArrowUp') return 'bring-front';
  if (key === 'ArrowDown') return 'send-back';
  return null;
}

const LAYOUT_ALIGN_KEYS = {
  ArrowLeft: { align: 'left', repeat: 'center-x' },
  ArrowRight: { align: 'right', repeat: 'center-x' },
  ArrowUp: { align: 'top', repeat: 'center-y' },
  ArrowDown: { align: 'bottom', repeat: 'center-y' },
};

/** Ctrl/Cmd+Shift+arrow aligns the selected set's edges, like the Align
 * buttons. Like Shift+Left/Right for text, repeating the key on an already
 * aligned set centres that axis (`repeat`). Idle normal editor only. */
export function layoutAlignKey({
  key, shiftKey = false, ctrlKey = false, metaKey = false, altKey = false,
  mode = 'normal', wire = false, directWire = false, drag = false,
  moveMode = null, copyMode = false, deleteMode = false, labelMode = null, textEntry = false,
} = {}) {
  if (textEntry || !shiftKey || !(ctrlKey || metaKey) || altKey || mode !== 'normal'
      || wire || directWire || drag || moveMode || copyMode || deleteMode || labelMode) return null;
  return LAYOUT_ALIGN_KEYS[key] || null;
}
