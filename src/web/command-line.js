/**
 * The `:` command line's vocabulary. Document commands go to `runCommand`
 * (src/core/commands.js), the one command language every entry point shares.
 * Editor commands work the editor itself -- panels, view toggles, menus,
 * dialogs -- so they exist only here, and the editor binds each name to its
 * action. Both kinds complete with Tab, matching names and synonyms.
 */

/** Values a toggle command accepts, mapped to the state it asks for. */
const TOGGLE_VALUES = {
  on: true, show: true, open: true, yes: true, true: true, 1: true, dark: true,
  off: false, hide: false, close: false, no: false, false: false, 0: false, light: false,
  toggle: undefined,
};

/**
 * Editor commands. `toggle` commands take an optional on/off (show/hide, ...)
 * and flip without one; `choices` commands take one of the listed values.
 * The rest take no argument: a line with arguments falls through to the
 * document command of the same name (`save FILE`, `find TEXT`, `beats list`).
 */
export const EDITOR_COMMANDS = [
  { name: 'settings', aliases: ['preferences', 'prefs', 'options', 'config'], help: 'open the settings menu' },
  { name: 'panel', aliases: ['sidebar', 'side-panel', 'sidepanel', 'inspector'], toggle: true, help: 'show or hide the components, nets, and selection panel (Shift+P)' },
  { name: 'analysis', aliases: ['analyze', 'analyse', 'small-signal', 'smallsignal', 'equations'], toggle: true, help: 'show or hide the small-signal analysis panel (Shift+S)' },
  { name: 'grid', toggle: true, help: 'show or hide the placement grid (#)' },
  { name: 'guides', aliases: ['placement-guides', 'alignment-guides', 'spacing'], toggle: true, help: 'show or hide the spacing and alignment guides (Shift+G)' },
  { name: 'crosshair', aliases: ['cursor'], toggle: true, help: 'show or hide the crosshair (Shift+C)' },
  { name: 'dark', aliases: ['theme', 'dark-mode', 'darkmode', 'night', 'light'], toggle: true, help: 'switch the dark theme on or off (Shift+D)' },
  { name: 'beats', aliases: ['beat-strip', 'steps', 'slides'], toggle: true, help: 'show or hide the beat strip (Shift+B)' },
  { name: 'tips', aliases: ['hints'], toggle: true, help: 'turn the corner tips on or off' },
  { name: 'trackpad', aliases: ['scrolling', 'scroll', 'touchpad'], toggle: true, help: 'two-finger scroll pans and pinch zooms; off: the wheel zooms' },
  { name: 'page-guide', aliases: ['pageguide', 'column', 'ieee'], choices: ['none', 'ieee-1col', 'ieee-2col'], help: 'frame the drawing for a page: none, ieee-1col, or ieee-2col' },
  { name: 'atlas', aliases: ['atlas-view', 'collage', 'overview', 'gallery', 'all-designs'], help: 'every design in the workspace at its real size (Shift+Backspace)' },
  { name: 'symbols', aliases: ['symbol-sheet', 'symbol-reference', 'library', 'legend'], help: 'every symbol, drawn from the registry (Settings → Symbols)' },
  { name: 'fit', aliases: ['zoom-fit', 'zoom', 'fit-view'], help: 'fit the view to the drawing (f)' },
  { name: 'shortcuts', aliases: ['keys', 'keybindings', 'hotkeys', 'cheatsheet', 'keymap'], help: 'show every keyboard shortcut (?)' },
  { name: 'check', aliases: ['design-check', 'drc', 'lint', 'verify'], help: 'run Design Check (x)' },
  { name: 'find', aliases: ['search', 'filter'], help: 'find parts, nets, and text in the panel (Ctrl/Cmd+F)' },
  { name: 'replace', aliases: ['substitute'], help: 'replace text in labels (Ctrl/Cmd+H)' },
  { name: 'undo', help: 'undo the last edit (u)' },
  { name: 'redo', help: 'redo the last undone edit (Shift+U)' },
  { name: 'save', aliases: ['write'], help: 'save the document (Ctrl/Cmd+S)' },
  { name: 'save-as', aliases: ['saveas'], help: 'save a copy under any name (Ctrl/Cmd+Shift+S)' },
  { name: 'open', aliases: ['browse', 'files'], help: 'open a document file (Ctrl/Cmd+O)' },
  { name: 'new', aliases: ['new-document', 'blank'], help: 'start a new schematic' },
  { name: 'export', aliases: ['download', 'pdf', 'png'], help: 'export as SVG, PDF, or PNG (Ctrl/Cmd+E)' },
  { name: 'present', aliases: ['presentation', 'slideshow', 'play'], help: 'present the beats full screen (Shift+F5)' },
  { name: 'workspace', aliases: ['folder'], help: 'choose the workspace folder' },
  { name: 'more', aliases: ['menu', 'document-menu'], help: 'open the More menu of document actions' },
  { name: 'tutorial', aliases: ['learn', 'tour'], help: 'draw a 5T OTA step by step, in a new document' },
  { name: 'phase-beats', aliases: ['beats-from-phases'], help: 'add one beat per switch phase (More menu)' },
  { name: 'show-in-folder', aliases: ['reveal'], help: 'show the document file in the file manager' },
  { name: 'delete-document', help: 'permanently delete the current document file (asks first)' },
  // Canvas actions: what a key does to the selection or the tools. `canvas`
  // hands the keyboard back to the drawing once they run. A line with
  // arguments still goes to the document command of the same name
  // (`rotate R1 180`, `swap M1 pmos`).
  { name: 'insert', aliases: ['part', 'component', 'symbol'], canvas: true, help: 'insert a part, fuzzy-searching every symbol (i)' },
  { name: 'wire', aliases: ['draw-wire', 'route'], canvas: true, help: 'draw a wire (w)' },
  { name: 'rotate', aliases: ['turn'], canvas: true, help: 'rotate the selection 90° clockwise (r)' },
  { name: 'mirror-horizontal', aliases: ['mirror-h', 'flip-horizontal'], canvas: true, help: 'mirror the selection horizontally (Shift+R)' },
  { name: 'mirror-vertical', aliases: ['mirror-v', 'flip-vertical'], canvas: true, help: 'mirror the selection vertically (Ctrl/Cmd+R)' },
  { name: 'move', aliases: ['drag'], canvas: true, help: 'move the selection with its wiring (m)' },
  { name: 'move-detached', aliases: ['detach'], canvas: true, help: 'move the selection without its wires (Shift+M)' },
  { name: 'copy', aliases: ['duplicate', 'clone'], canvas: true, help: 'copy the selection and place the copy (c)' },
  { name: 'copy-image', aliases: ['screenshot', 'clipboard-image'], canvas: true, help: 'copy the selection (or drawing) as an image (Ctrl/Cmd+Shift+C)' },
  { name: 'paste', canvas: true, help: 'paste the copied objects at the cursor (p)' },
  { name: 'delete', aliases: ['erase', 'cut'], canvas: true, help: 'delete the selection (dd)' },
  { name: 'select-all', aliases: ['all'], canvas: true, help: 'select everything (Ctrl/Cmd+A)' },
  { name: 'box-select', aliases: ['visual', 'marquee'], canvas: true, help: 'grow a selection box with the arrow keys (v)' },
  { name: 'net-label', aliases: ['name-net', 'label-wire'], canvas: true, help: 'place net labels on wires (Shift+L)' },
  { name: 'free-text', aliases: ['annotation-tool', 'comment'], canvas: true, help: 'place a free annotation (Shift+N)' },
  { name: 'equation', aliases: ['latex', 'math', 'formula'], canvas: true, help: 'place a LaTeX equation (e)' },
  { name: 'arrow', canvas: true, help: 'draw an annotation arrow (a)' },
  { name: 'box', aliases: ['rectangle', 'frame'], canvas: true, help: 'draw an annotation box (b)' },
  { name: 'line', aliases: ['polyline'], canvas: true, help: 'draw an annotation line (l)' },
  { name: 'align-to', aliases: ['snap-to'], canvas: true, help: 'align the selection to another object\'s edge or point (Shift+A)' },
  { name: 'align', needsArg: true, choices: ['left', 'right', 'top', 'bottom', 'center-x', 'center-y'], canvas: true, help: 'align the selection: left, right, top, bottom, center-x, or center-y (Ctrl/Cmd+Shift+arrows)' },
  { name: 'distribute', aliases: ['spread', 'even'], needsArg: true, choices: ['x', 'y'], canvas: true, help: 'space the selection evenly: x (horizontal) or y (vertical)' },
  { name: 'front', aliases: ['bring-to-front', 'raise'], canvas: true, help: 'bring the selection to the front (Shift+Up)' },
  { name: 'back', aliases: ['send-to-back', 'lower'], canvas: true, help: 'send the selection to the back (Shift+Down)' },
  { name: 'highlight', aliases: ['color-net', 'net-color', 'colour'], canvas: true, help: 'color whole nets, click by click (9)' },
  { name: 'clear-highlights', aliases: ['uncolor', 'remove-highlights'], canvas: true, help: 'remove every net highlight (8)' },
  { name: 'stubs', aliases: ['wire-stubs'], canvas: true, help: 'labelled wire stubs on the selected parts\' unconnected pins (Space)' },
  { name: 'swap', aliases: ['change-type', 'replace-part'], canvas: true, help: 'change the selected parts\' type, keeping their wiring (q)' },
  { name: 'repeat', aliases: ['again'], canvas: true, help: 'repeat the last rotate, mirror, swap, rail, or stubs (.)' },
  { name: 'edit', aliases: ['edit-text', 'rename-selection'], canvas: true, help: 'edit the selected label or part name (t, =, F2)' },
  { name: 'add-beat', aliases: ['new-beat'], canvas: true, help: 'add a beat after the one on screen (+)' },
  { name: 'next-beat', canvas: true, help: 'step to the next beat (Alt+→)' },
  { name: 'previous-beat', aliases: ['prev-beat'], canvas: true, help: 'step to the previous beat (Alt+←)' },
  { name: 'hide', canvas: true, help: 'hide the selection from this beat on (h)' },
  { name: 'dim', canvas: true, help: 'dim the selection from this beat on (Shift+H)' },
  { name: 'flip-switches', aliases: ['toggle-switches', 'open-switches', 'close-switches'], canvas: true, help: 'open or close the selected switches with their phase (s)' },
];

/** Document commands (`runCommand`), for completion. Arguments are the
 *  command's own; `help` lists them. */
export const DOCUMENT_COMMANDS = [
  { name: 'add', aliases: ['place', 'insert'], help: 'add <type> [refdes] [--at X Y]' },
  { name: 'connect', aliases: ['wire'], help: 'connect REF.TERM REF.TERM ... [--name N]' },
  { name: 'disconnect', help: 'disconnect REF.TERM' },
  { name: 'move', help: 'move <refdes> <X> <Y>' },
  { name: 'rotate', help: 'rotate <refdes> [deg=90]' },
  { name: 'mirror', aliases: ['flip'], help: 'mirror <refdes> <x|y>' },
  { name: 'value', aliases: ['setvalue'], help: 'value <refdes> <V>' },
  { name: 'rename', help: 'rename <refdes> <new>' },
  { name: 'rm', aliases: ['remove', 'delete'], help: 'rm <refdes>' },
  { name: 'cross', help: 'cross A1 A2 B1 B2 (cross-coupled routes)' },
  { name: 'stubs', aliases: ['stub'], help: 'stubs <refdes> ... (labelled wire stubs)' },
  { name: 'swap', help: 'swap <refdes> [type] (change a part\'s type, keeping its wiring)' },
  { name: 'rail', help: 'rail REF.TERM ground|supply (a rail wired to a pin)' },
  { name: 'supplybar', help: 'supplybar on|off <refdes> ...' },
  { name: 'net', help: 'net <id> add|drop|name|label|rm ...' },
  { name: 'nets', help: 'list nets' },
  { name: 'netlabel', aliases: ['net-label', 'nlabel', 'wirelabel', 'wire-label'], help: 'netlabel add|rename|rm ...' },
  { name: 'annotation', aliases: ['annotate', 'label', 'note', 'text'], help: 'annotation add TEXT X Y ...' },
  { name: 'switch', help: 'switch REF|PHASE open|closed' },
  { name: 'beat', help: 'beat list|add|rm|show|dim|hide ...' },
  { name: 'timing', help: 'add a timing diagram template' },
  { name: 'list', aliases: ['ls', 'components', 'parts'], help: 'list components' },
  { name: 'eval', help: 'quality report' },
  { name: 'explain', aliases: ['diagnose'], help: 'explain eval | explain connect ...' },
  { name: 'state', help: 'full JSON state' },
  { name: 'bounds', help: 'drawing extents' },
  { name: 'svg', help: 'svg [file] [--grid] [--beat N]' },
  { name: 'load', help: 'load <file>' },
  { name: 'clear', help: 'start an empty circuit' },
  { name: 'help', help: 'list the document commands' },
  { name: 'version', help: 'show the version' },
];

/** Split a line into its command word and the rest. */
export function commandWord(line) {
  const text = String(line).replace(/^:+/, '').trimStart();
  const match = text.match(/^(\S*)(\s*)([\s\S]*)$/);
  return { word: match[1], spaced: !!match[2], rest: match[3].trim() };
}

function entryNamed(catalog, word) {
  const key = word.toLowerCase();
  return catalog.find((entry) => entry.name === key) ||
    catalog.find((entry) => (entry.aliases || []).includes(key)) || null;
}

/**
 * The editor command a line runs, or null for a document command. Returns
 * `{ name, state }`: `state` is true/false for an explicit toggle value,
 * undefined to flip, or the chosen value of a `choices` command.
 */
export function resolveEditorCommand(line, catalog = EDITOR_COMMANDS) {
  // A command that needs its argument (align left) only runs with it.
  const { word, rest } = commandWord(line);
  const entry = word && entryNamed(catalog, word);
  if (!entry) return null;
  if (!rest) {
    if (entry.needsArg) return null;
    // A bare `light` asks for the light theme, not a flip.
    return { name: entry.name, state: entry.toggle && word.toLowerCase() === 'light' ? false : undefined };
  }
  const args = rest.split(/\s+/);
  if (args.length !== 1) return null;
  const value = args[0].toLowerCase();
  if (entry.toggle && Object.hasOwn(TOGGLE_VALUES, value)) return { name: entry.name, state: TOGGLE_VALUES[value] };
  if (entry.choices?.includes(value)) return { name: entry.name, state: value };
  return null;
}

/**
 * Ranked completions for the command word being typed: exact names, then
 * exact synonyms, then name and synonym prefixes, then (from two letters)
 * words that merely contain it; failing all of those, near misses (typos).
 * Each entry appears once, as its canonical
 * name, with the synonym that matched when that is how it was found.
 * Editor commands sort before document commands of the same rank; a document
 * command whose name an editor command already answers to is left out.
 */
export function commandCompletions(word, { editor = EDITOR_COMMANDS, document = DOCUMENT_COMMANDS } = {}) {
  const query = String(word || '').toLowerCase().trim();
  if (!query) return [];
  // Several words search what the commands do: every word must appear in a
  // name, a synonym, or the description ("mirror hor", "beats phase").
  const tokens = query.split(/\s+/);
  const key = tokens.length > 1 ? '' : query;
  const editorWords = new Set(editor.flatMap((entry) => [entry.name, ...(entry.aliases || [])]));
  const entries = [
    ...editor.map((entry) => ({ ...entry, kind: 'editor' })),
    ...document.filter((entry) => !editorWords.has(entry.name)).map((entry) => ({ ...entry, kind: 'document' })),
  ];
  const ranked = [];
  const described1 = []; // one word found only in descriptions: a fallback
  for (const [order, entry] of entries.entries()) {
    const aliases = entry.aliases || [];
    let rank = null;
    let via = null;
    const described = () => {
      const text = [entry.name, ...aliases, entry.help].join(' ').toLowerCase();
      return tokens.every((token) => token.length >= 2 && text.includes(token));
    };
    if (!key) rank = described() ? 6 : null;
    else if (entry.name === key) rank = 0;
    else if (aliases.includes(key)) { rank = 1; via = key; }
    else if (entry.name.startsWith(key)) rank = 2;
    else if ((via = aliases.find((alias) => alias.startsWith(key)) || null)) rank = 3;
    else if (key.length >= 2 && entry.name.includes(key)) rank = 4;
    else if (key.length >= 2 && (via = aliases.find((alias) => alias.includes(key)) || null)) rank = 5;
    else if (key.length >= 3 && described()) described1.push({ name: entry.name, via: null, help: entry.help, kind: entry.kind, needsArg: !!entry.needsArg, rank: 6, order });
    if (rank !== null) ranked.push({ name: entry.name, via, help: entry.help, kind: entry.kind, needsArg: !!entry.needsArg, rank, order });
  }
  // No name contains the word: offer what it describes, then near misses, so
  // a typo still finds its command.
  if (!ranked.length) ranked.push(...described1);
  if (!ranked.length && key.length >= 3) {
    const reach = key.length >= 5 ? 2 : 1;
    for (const [order, entry] of entries.entries()) {
      const distances = [entry.name, ...(entry.aliases || [])].map((word) => [word, editDistance(key, word)]);
      const [via, distance] = distances.reduce((best, next) => (next[1] < best[1] ? next : best));
      if (distance <= reach) ranked.push({ name: entry.name, via: via === entry.name ? null : via, help: entry.help, kind: entry.kind, rank: 7 + distance, order });
    }
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(({ name, via, help, kind, needsArg }) => ({ name, via, help, kind, needsArg: !!needsArg }));
}

/** Levenshtein distance between two short words. */
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

/**
 * The line after one Tab (or Shift+Tab, `step` -1) press. `session` carries
 * the typed word and its completions across presses; pass the returned one
 * back while the user keeps tabbing, and null once they type. Completes only
 * the command word; returns null when nothing matches.
 */
export function tabComplete(line, session = null, step = 1) {
  const { word, spaced, rest } = commandWord(line);
  if (spaced && !session) return null;
  const base = session || { word, candidates: commandCompletions(word), index: -1 };
  if (!base.candidates.length) return null;
  const count = base.candidates.length;
  const index = base.index < 0 ? (step > 0 ? 0 : count - 1) : (base.index + step + count) % count;
  const next = base.candidates[index];
  // A document command takes arguments: leave the cursor ready for them.
  const tail = rest ? ` ${rest}` : (next.kind === 'document' && count === 1 ? ' ' : '');
  return { line: `${next.name}${tail}`, session: { ...base, index } };
}

/** The line with a document command's synonym (`delete R1`, `ls`) replaced
 *  by the command's own name, so the synonyms completion offers also run. */
export function canonicalDocumentLine(line) {
  const { word, rest } = commandWord(line);
  const entry = word && entryNamed(DOCUMENT_COMMANDS, word);
  if (!entry) return String(line).replace(/^:+/, '').trim();
  return rest ? `${entry.name} ${rest}` : entry.name;
}

/** "did you mean …" for an unknown command word, or ''. */
export function didYouMean(word) {
  const names = commandCompletions(word).slice(0, 3).map((entry) => entry.name);
  return names.length ? `did you mean ${names.join(', ')}?` : '';
}

/** Whether `word` is exactly a command's name or synonym. */
export function knownCommandWord(word) {
  return !!word && !!(entryNamed(EDITOR_COMMANDS, word) || entryNamed(DOCUMENT_COMMANDS, word));
}

/**
 * The suggestions for a whole line. Until its first word names a command,
 * every word searches. After that the rest are arguments, unless every word
 * describes a different editor action that runs bare ("mirror hor" is
 * mirror-horizontal, "move R1 40 40" stays a move).
 */
export function lineSuggestions(line) {
  const text = String(line).replace(/^:+/, '').trim();
  const { word, spaced } = commandWord(text);
  const candidates = commandCompletions(text);
  if (!spaced || !knownCommandWord(word)) return candidates;
  const own = (entryNamed(EDITOR_COMMANDS, word) || entryNamed(DOCUMENT_COMMANDS, word)).name;
  return candidates.filter((entry) => entry.kind === 'editor' && !entry.needsArg && entry.name !== own);
}

/**
 * What Enter does with a line when `index` is the highlighted suggestion:
 * `{ run }` runs a line as typed (an exact command with its arguments, or one
 * nothing matches, for its error), `{ run: name }` runs the highlighted
 * command, and `{ fill }` puts a command that needs arguments into the line
 * to finish.
 */
export function commandLineIntent(line, index = 0) {
  const text = String(line).replace(/^:+/, '').trim();
  if (resolveEditorCommand(text)) return { run: text };
  const { word, spaced } = commandWord(text);
  if (!spaced && knownCommandWord(word)) {
    const entry = entryNamed(EDITOR_COMMANDS, word);
    return entry?.needsArg ? { fill: `${entry.name} ` } : { run: text };
  }
  const candidates = lineSuggestions(text);
  if (!candidates.length) return { run: text };
  const pick = candidates[Math.max(0, Math.min(index, candidates.length - 1))];
  return pick.kind === 'document' || pick.needsArg ? { fill: `${pick.name} ` } : { run: pick.name };
}
