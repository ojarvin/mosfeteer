#!/usr/bin/env node

/** Regenerate the symbols reference document through the editor API.
 *
 * Start Mosfeteer first (`npm run serve`), then run:
 *
 *   npm run symbols
 *
 * Mutations go through the same command endpoint as the editor and CLI, so the
 * server persists the result as `<workspace>/symbols.schematic.json`.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { symbolTypeNames } from '../src/core/components/index.js';

const SERVER = process.env.SP_SERVER || 'http://127.0.0.1:47280';
const CIRCUIT = process.env.SYMBOLS_CIRCUIT || 'symbols';
const CATEGORY_RIGHT_EDGE = -320;

const rows = [
  {
    label: 'Passive',
    y: -1600,
    items: [
      ['resistor', 'R1', 0], ['variable_resistor', 'R2', 480],
      ['capacitor', 'C1', 960], ['variable_capacitor', 'C2', 1440],
      ['inductor', 'L1', 1920], ['variable_inductor', 'L2', 2400],
      ['diode', 'D1', 2880],
    ],
  },
  {
    label: 'Transistors',
    y: -1200,
    items: [
      ['nmos', 'M1', 0], ['pmos', 'M2', 480], ['nmosb', 'M3', 960],
      ['pmosb', 'M4', 1440], ['npn', 'Q1', 1920], ['pnp', 'Q2', 2400],
    ],
  },
  {
    label: 'Switches',
    y: -800,
    items: [['switch_open', 'S1', 0], ['switch_closed', 'S2', 480]],
  },
  {
    label: 'Sources',
    y: -400,
    items: [['current_source', 'I1', 0], ['voltage_source', 'V1', 480], ['vccs', 'G1', 960]],
  },
  {
    label: 'Ports',
    y: 0,
    items: [['input', 'VI1', 0], ['output', 'VO1', 480], ['inputoutput', 'VIO1', 960], ['port', 'P1', 1440]],
  },
  {
    label: 'References',
    y: 400,
    items: [['ground', 'GROUND1', 0], ['supply', 'SUPPLY1', 480], ['vcm', 'VCM1', 960]],
  },
  {
    label: 'Macros',
    y: 800,
    items: [['opamp', 'U1', 0], ['opamp_diff', 'U2', 480], ['adc', 'U3', 960], ['dac', 'U4', 1440]],
  },
  {
    label: 'Logic',
    id: 'logic_base',
    y: 1200,
    items: [
      ['inverter', 'U5', 0], ['buffer', 'U6', 480], ['and2_gate', 'U7', 960],
      ['nand2_gate', 'U8', 1440], ['or2_gate', 'U9', 1920], ['nor2_gate', 'U10', 2400],
      ['xor2_gate', 'U11', 2880], ['xnor2_gate', 'U12', 3360],
    ],
  },
  {
    label: 'Logic',
    id: 'logic_three_input',
    annotate: false,
    y: 1600,
    items: [
      ['tristate_inverter', 'U13', 0], ['tristate_buffer', 'U14', 480],
      ['and3_gate', 'U15', 960], ['nand3_gate', 'U16', 1440], ['or3_gate', 'U17', 1920],
      ['nor3_gate', 'U18', 2400], ['xor3_gate', 'U19', 2880], ['xnor3_gate', 'U20', 3360],
    ],
  },
  {
    label: 'Logic',
    id: 'logic_mux',
    annotate: false,
    y: 2000,
    items: [['mux2', 'U21', 0]],
  },
  {
    label: 'Sequential',
    id: 'sequential_dff',
    y: 2400,
    items: [
      ['dff', 'U22', 0], ['dff_qb', 'U23', 480], ['dff_clkb', 'U24', 960],
      ['dff_clkb_qb', 'U25', 1440], ['dff_rstb', 'U26', 1920],
      ['dff_rstb_qb', 'U27', 2400], ['dff_clkb_rstb', 'U28', 2880],
      ['dff_clkb_rstb_qb', 'U29', 3360],
    ],
  },
  {
    label: 'Sequential',
    id: 'sequential_latch',
    annotate: false,
    y: 2800,
    items: [
      ['latch', 'U30', 0], ['latch_qb', 'U31', 480], ['latch_enb', 'U32', 960],
      ['latch_enb_qb', 'U33', 1440], ['latch_rstb', 'U34', 1920],
      ['latch_rstb_qb', 'U35', 2400], ['latch_enb_rstb', 'U36', 2880],
      ['latch_enb_rstb_qb', 'U37', 3360],
    ],
  },
  {
    label: 'Blocks',
    y: 3200,
    items: [['block', 'B1', 0]],
  },
];

export function buildCommands() {
  const oversizedRows = rows.filter((row) => row.items.length > 8);
  if (oversizedRows.length) throw new Error(`symbols layout rows may contain at most 8 components: ${oversizedRows.map((row) => row.label).join(', ')}`);
  const listedTypes = rows.flatMap((row) => row.items.map(([type]) => type));
  const expectedTypes = symbolTypeNames.filter((type) => type !== 'solder');
  const missingTypes = expectedTypes.filter((type) => !listedTypes.includes(type));
  const duplicateTypes = listedTypes.filter((type, index) => listedTypes.indexOf(type) !== index);
  if (missingTypes.length || duplicateTypes.length) {
    const details = [
      missingTypes.length ? `missing ${missingTypes.join(', ')}` : '',
      duplicateTypes.length ? `duplicated ${[...new Set(duplicateTypes)].join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`symbols layout is out of date: ${details}`);
  }
  const commands = ['clear'];
  for (const row of rows) {
    for (const [type, refdes, x, rotation = 0] of row.items) {
      const rotate = rotation ? ` --rot ${rotation}` : '';
      commands.push(`add ${type} ${refdes} --at ${x} ${row.y}${rotate}`);
    }
    const categoryId = row.id || row.label.toLowerCase();
    if (row.annotate !== false) commands.push(`annotation add category_${categoryId} ${row.label} 0 ${row.y} --align right --right-edge ${CATEGORY_RIGHT_EDGE}`);
  }
  return commands;
}

async function send(command) {
  const url = `${SERVER}/api/circuits/${encodeURIComponent(CIRCUIT)}/cmd`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: command }),
    });
  } catch (error) {
    throw new Error(`could not reach Mosfeteer at ${SERVER}: ${error.message}`);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `server returned ${response.status}`);
  const failed = (data?.results || []).find((result) => !result.ok);
  if (failed) throw new Error(`${command}: ${failed.error}`);
  return data;
}

export async function regenerate() {
  const commands = buildCommands();
  for (const command of commands) await send(command);
  console.log(`Regenerated ${CIRCUIT} with ${commands.length - 1} components/annotations.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  regenerate().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
