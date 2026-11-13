/**
 * p: ports by name, as l places net labels. The names first -- several,
 * separated by spaces or commas -- then each click places the next port,
 * named. While placing, p steps the port's kind: input, output, inout.
 * Once the names are used, it asks for the next; Esc leaves the tool.
 */

import { componentNameIdentity } from '../core/model.js';
import { promptText } from './annotation-tools.js';
import { renameLabelThroughModel } from './net-names.js';
import { logLine, hintLine } from './status-bar-ui.js';
import { editor } from './editor-state.js';
import { activateSelect, onPartsPlaced, render } from './main.js';
import { beginPlacing } from './insert-menu.js';

export const PORT_KINDS = ['input', 'output', 'inputoutput'];
const KIND_NAMES = { input: 'input', output: 'output', inputoutput: 'inout' };

// The names still to place, `{ names, index }`, or null: placed ports keep
// their own names. The kind placed last is the next one's too.
let sequence = null;
let kind = 'input';

const placingPort = () => editor.mode === 'insert' && PORT_KINDS.includes(editor.pendingPlace?.type);

function sequenceHint() {
  const what = KIND_NAMES[editor.pendingPlace?.type || kind];
  if (!sequence) {
    hintLine(`PORT (${what}): click to place; p: input, output, inout; Esc ends`);
    return;
  }
  const { names, index } = sequence;
  const rest = names.length - index - 1;
  hintLine(`PORT (${what}): click to place ${names[index]}${rest ? ` (then ${names[index + 1]}${rest > 1 ? ` and ${rest - 1} more` : ''})` : ''}; p: input, output, inout; Esc ends`);
}

/** p: ask for the names, then place them. Esc in the field leaves the tool;
 *  Enter on an empty one places ports with names of their own. */
export function beginPorts() {
  promptText({ title: 'Ports', placeholder: 'name(s): VIN VOUT CLK … Enter alone: their own names' }).then((text) => {
    if (text === null) {
      sequence = null;
      activateSelect();
      return;
    }
    const names = text.split(/[\s,]+/).filter(Boolean);
    sequence = names.length ? { names, index: 0 } : null;
    beginPlacing(kind);
    sequenceHint();
  });
}

/** p while placing a port: the next kind, keeping its turn and mirror. */
export function cyclePortKind() {
  if (!placingPort()) return false;
  kind = PORT_KINDS[(PORT_KINDS.indexOf(editor.pendingPlace.type) + 1) % PORT_KINDS.length];
  editor.pendingPlace.type = kind;
  sequenceHint();
  render();
  return true;
}

/** Esc out of placing ports drops the names left. */
export function endPortSequence() {
  sequence = null;
}

/** Name each port placed from the names typed, in the placement's commit. */
function namePlacedPorts(placed) {
  const ports = placed.filter((part) => PORT_KINDS.includes(part.type));
  if (!ports.length) return;
  kind = ports[0].type;
  if (!sequence) return;
  for (const part of ports) {
    const name = sequence.names[sequence.index];
    if (!name) break;
    const canonical = componentNameIdentity(name);
    const label = editor.circuit.labelOf(part.refdes);
    if (canonical !== part.refdes && editor.circuit.components.has(canonical)) {
      logLine(`the name ${name} is already in use: ${part.refdes} keeps its own`, 'error');
    } else if (label) {
      renameLabelThroughModel(label, name);
    }
    sequence.index += 1;
  }
  if (sequence.index < sequence.names.length) {
    sequenceHint();
    return;
  }
  // The names used: ask for the next ones, still placing ports.
  logLine(`placed ${sequence.names.length} port${sequence.names.length === 1 ? '' : 's'}`);
  sequence = null;
  setTimeout(() => { if (placingPort()) beginPorts(); }, 0);
}

export function installPortTool() {
  onPartsPlaced(namePlacedPorts);
}
