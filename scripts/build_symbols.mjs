import { Circuit } from "../src/core/model.js";
import { svgString } from "../src/core/render.js";
import { writeFileSync } from "node:fs";

// --- layout ---------------------------------------------------------------
// Each row: list of component types. Origin on the 40-grid. No rotation and no
// explicit mirror flags, so symbol defaults (pmos mirrorY, output mirrorX) apply.
const rows = [
  ["resistor", "capacitor", "inductor", "diode",
   "variable_resistor", "variable_capacitor", "variable_inductor",
   "switch_open", "switch_closed"],
  ["current_source", "current_sink", "voltage_source"],
  ["nmos", "pmos", "npn", "pnp"],
  ["inverter", "buffer", "and_gate", "nand_gate", "or_gate", "nor_gate", "xor_gate", "xnor_gate"],
  ["opamp", "opamp_diff"],
  ["ground", "supply", "port", "port_filled"],
  ["input", "output", "inputoutput"],
];

const X_PITCH = { 0: 240, 1: 240, 2: 240, 3: 360, 4: 400, 5: 220, 6: 240 };

// extra horizontal clearance for the ports row: input/inputoutput label LEFT,
// output (mirrored) label RIGHT.
const PORTS_X = [0, 260, 640];

function build() {
  const c = new Circuit();
  let y = 0;
  for (let r = 0; r < rows.length; r++) {
    const types = rows[r];
    let maxBottom = 0;
    let x = 0;
    types.forEach((type, i) => {
      const px = r === 6 ? PORTS_X[i] : x;
      const comp = c.addComponent(type, { x: px, y });
      const b = comp.bboxWorld();
      const bottom = b.y + b.h;
      const label = c.labelOf(comp.refdes);
      if (label) {
        const lb = label.bbox();
        if (lb.y + lb.h > bottom) maxBottom = Math.max(maxBottom, lb.y + lb.h);
      }
      if (bottom > maxBottom) maxBottom = bottom;
      x = px + X_PITCH[r];
    });
    // Next row starts below this row's lowest drawn element with at least 2-3
    // grid cells of clearance from the tallest component's top offset (-120).
    y = maxBottom + 240;
  }
  return c;
}

// --- verification ----------------------------------------------------------
function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function check(c, name) {
  const comps = [...c.components.values()];
  const bboxRect = (comp) => comp.bboxWorld();
  const labelRect = (label) => label.bbox();
  const issues = [];
  // component bbox vs component bbox
  for (let i = 0; i < comps.length; i++)
    for (let j = i + 1; j < comps.length; j++) {
      const a = bboxRect(comps[i]), b = bboxRect(comps[j]);
      if (overlaps(a, b)) issues.push(`bbox ${comps[i].refdes}(${comps[i].type}) x ${comps[j].refdes}(${comps[j].type})`);
    }
  // label vs other labels and label vs OTHER components (an owned label sits by
  // design near its own body, so only cross-component overlaps are problems)
  const labels = [...c.labels.values()];
  for (const l of labels) {
    const lb = labelRect(l);
    for (const comp of comps) {
      if (comp.refdes === l.owner) continue;
      if (overlaps(lb, bboxRect(comp))) issues.push(`label ${l.text} x ${comp.refdes}(${comp.type})`);
    }
    for (const m of labels) {
      if (l === m) continue;
      if (overlaps(lb, labelRect(m))) issues.push(`label ${l.text} x label ${m.text}`);
    }
  }
  console.log(`[${name}] components=${comps.length} labels=${labels.length} issues=${issues.length}`);
  for (const s of issues) console.log("   ", s);
  // coincident terminals (touching pins auto-connect on load — must not happen)
  const seen = new Map();
  for (const comp of comps) {
    for (const w of comp.worldTerminals()) {
      const key = `${w.x},${w.y}`;
      if (seen.has(key)) issues.push(`coincident terminals: ${seen.get(key)} & ${comp.refdes}.${w.name} at ${key}`);
      else seen.set(key, `${comp.refdes}.${w.name}`);
    }
  }
  if (issues.some((s) => s.startsWith("coincident"))) console.log("   !!! coincident terminals found");
  return issues;
}

const c = build();
const issues = check(c, "layout");
const state = c.toJSON();
writeFileSync("/tmp/opencode/symbols_layout.json", JSON.stringify(state, null, 2));
writeFileSync("/tmp/opencode/symbols_layout.svg", svgString(c, { grid: true, terminals: false, junctions: false, netNames: false }));
console.log("bounds:", JSON.stringify(c.bounds()));
if (!issues.length) {
  // default-orientation sanity: pmos source up, output port mirrored
  for (const [ref, comp] of c.components) {
    if (comp.type === "pmos") console.log("pmos", ref, "mirrorY=", comp.transform.mirrorY, "s@", JSON.stringify(comp.terminalWorld("s")));
  }
  for (const [ref, comp] of c.components) {
    if (comp.type === "output") console.log("output", ref, "mirrorX=", comp.transform.mirrorX);
  }
}