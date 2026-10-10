/**
 * Topology-independent modified nodal analysis (MNA).
 *
 * The algebra interface is intentionally small. `ops` must provide values
 * `zero` and `one`, plus the functions `add`, `sub`, `mul`, `div`, `neg`, and
 * `isZero`. Values may be numbers, exact rationals, or symbolic expressions;
 * this module never inspects or evaluates them.
 *
 * Element terminal convention:
 * - every branch carries current from `terminals.a` to `terminals.b`;
 * - VCCS controls use `control.a` and `control.b`;
 * - voltage sources impose `V(a) - V(b) = value`;
 * - current sources inject `value` from `a` to `b`;
 * - capacitor `admittance` and inductor `impedance` are supplied by the
 *   caller, so a symbolic caller can pass `s*C` and `s*L` directly.
 */

const REQUIRED_OPS = Object.freeze([
  'add', 'sub', 'mul', 'div', 'neg', 'isZero',
]);

const MNA_OPS = Object.freeze([
  'zero', 'one', ...REQUIRED_OPS,
]);

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

/** Return a ring implementation for ordinary JavaScript numbers. */
export function numberOps() {
  return {
    zero: 0,
    one: 1,
    add: (a, b) => a + b,
    sub: (a, b) => a - b,
    mul: (a, b) => a * b,
    div: (a, b) => a / b,
    neg: (a) => -a,
    isZero: (value) => value === 0,
  };
}

/** Validate the deliberately minimal algebra contract used by MNA/solve. */
export function validateMnaOps(ops) {
  if (!ops || typeof ops !== 'object') throw new TypeError('MNA ops are required');
  for (const name of MNA_OPS) {
    const valid = ['zero', 'one'].includes(name)
      ? Object.prototype.hasOwnProperty.call(ops, name)
      : typeof ops[name] === 'function';
    if (!valid) throw new TypeError(`MNA ops.${name} is required`);
  }
  return ops;
}

function asNode(value, role) {
  if (value === undefined || value === null || value === '') {
    throw new TypeError(`${role} terminal is required`);
  }
  return String(value);
}

function isVector(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

function sourceVector(value, columnCount, ops, role) {
  if (!isVector(value)) return Array(columnCount).fill(value ?? ops.zero);
  if (value.length !== columnCount) {
    throw new RangeError(`${role} has ${value.length} RHS values; expected ${columnCount}`);
  }
  return [...value];
}

function branchName(element, index) {
  return String(element.id || `${element.kind}${index + 1}`);
}

function nodeList(elements, requested, groundSet) {
  const seen = new Set();
  const nodes = [];
  const add = (value, role) => {
    const node = asNode(value, role);
    if (groundSet.has(node) || seen.has(node)) return;
    seen.add(node);
    nodes.push(node);
  };
  for (const node of requested || []) add(node, 'node');
  for (const element of elements) {
    for (const [key, value] of Object.entries(element.terminals)) add(value, `${element.kind}.terminals.${key}`);
    for (const [key, value] of Object.entries(element.control || {})) add(value, `${element.kind}.control.${key}`);
  }
  return nodes;
}

function addMatrixEntry(matrix, row, column, value, ops) {
  if (row === undefined || column === undefined || ops.isZero(value)) return;
  matrix[row][column] = ops.add(matrix[row][column], value);
}

function stampAdmittance(matrix, a, b, admittance, ops) {
  addMatrixEntry(matrix, a, a, admittance, ops);
  addMatrixEntry(matrix, b, b, admittance, ops);
  addMatrixEntry(matrix, a, b, ops.neg(admittance), ops);
  addMatrixEntry(matrix, b, a, ops.neg(admittance), ops);
}

function stampVccs(matrix, element, nodeIndex, ops) {
  const outPlus = nodeIndex.get(asNode(element.terminals.a, 'VCCS terminals.a'));
  const outMinus = nodeIndex.get(asNode(element.terminals.b, 'VCCS terminals.b'));
  const controlPlus = nodeIndex.get(asNode(element.control.a, 'VCCS control.a'));
  const controlMinus = nodeIndex.get(asNode(element.control.b, 'VCCS control.b'));
  const gm = element.value;
  if (gm === undefined) throw new TypeError('VCCS transconductance is required');

  // I(outPlus -> outMinus) = gm * (V(controlPlus) - V(controlMinus)).
  addMatrixEntry(matrix, outPlus, controlPlus, gm, ops);
  addMatrixEntry(matrix, outPlus, controlMinus, ops.neg(gm), ops);
  addMatrixEntry(matrix, outMinus, controlPlus, ops.neg(gm), ops);
  addMatrixEntry(matrix, outMinus, controlMinus, gm, ops);
}

function branchElement(kind) {
  return kind === 'voltage-source' || kind === 'inductor' || kind === 'opamp' || kind === 'opamp-cm';
}

function normalizedKind(element) {
  return String(element.kind || '').toLowerCase().replaceAll('_', '-');
}

// Legacy MNA descriptors are normalized here, before the strict stamping path.
function normalizeElement(element) {
  if (!element || typeof element !== 'object') throw new TypeError('MNA elements must be objects');
  const kind = normalizedKind(element);
  if (!kind) throw new TypeError('MNA element kind is required');
  const id = element.id ?? element.name;
  if (!id) throw new TypeError('MNA element id is required');
  const terminals = element.terminals || {
    a: element.a ?? element.outPlus ?? element.positive ?? element.p,
    b: element.b ?? element.outMinus ?? element.negative ?? element.n,
  };
  const control = element.control || (kind === 'vccs' || kind === 'opamp' ? {
    a: element.controlPlus ?? element.cp,
    b: element.controlMinus ?? element.cn,
  } : undefined);
  const value = firstDefined(
    element.value,
    kind === 'resistor' ? element.resistance : undefined,
    kind === 'capacitor' ? element.admittance : undefined,
    kind === 'inductor' ? element.impedance : undefined,
    kind === 'vccs' ? element.gm : undefined,
    kind === 'voltage-source' ? element.voltage : undefined,
    kind === 'current-source' ? element.current : undefined,
  );
  if (!terminals || terminals.a === undefined || terminals.b === undefined) {
    throw new TypeError(`MNA ${kind} terminals.a and terminals.b are required`);
  }
  if (value === undefined) throw new TypeError(`MNA ${kind} value is required`);
  if ((kind === 'vccs' || kind === 'opamp') && (!control || control.a === undefined || control.b === undefined)) {
    throw new TypeError(`MNA ${kind} control.a and control.b are required`);
  }
  return {
    kind,
    id: String(id),
    terminals: { a: terminals.a, b: terminals.b },
    value,
    ...(control ? { control: { a: control.a, b: control.b } } : {}),
  };
}

function matrixShape(value, name, rows, columns) {
  if (!Array.isArray(value) || value.length !== rows || value.some((row) => !isVector(row) || row.length !== columns)) {
    throw new RangeError(`${name} must be a ${rows}x${columns} matrix`);
  }
}

/**
 * Build one MNA matrix and any number of RHS columns.
 *
 * `options.rhsCount` fixes the number of excitations. Otherwise it is inferred
 * from vector-valued source values and defaults to one. `options.rhs` may add
 * an already prepared row-major RHS matrix after source stamps.
 */
export function buildMNA(inputElements = [], options = {}) {
  const ops = validateMnaOps(options.ops || numberOps());
  const elements = inputElements.map(normalizeElement);
  const ground = String(options.ground ?? '0');
  const groundSet = new Set([ground, ...(options.grounds || [])].map(String));
  const explicitRhs = options.rhs;
  const sourceWidths = elements
    .filter((element) => ['voltage-source', 'current-source'].includes(element.kind))
    .map((element) => {
      const value = element.value ?? ops.zero;
      return isVector(value) ? value.length : 1;
    });
  if (explicitRhs !== undefined && Array.isArray(explicitRhs) && explicitRhs.length) {
    sourceWidths.push(isVector(explicitRhs[0]) ? explicitRhs[0].length : 0);
  }
  const inferredWidth = Math.max(1, ...sourceWidths);
  const columnCount = options.rhsCount ?? inferredWidth;
  if (!Number.isInteger(columnCount) || columnCount < 1) throw new RangeError('rhsCount must be a positive integer');
  if (sourceWidths.some((width) => width > 1 && width !== columnCount)) {
    throw new RangeError(`RHS source width does not match rhsCount ${columnCount}`);
  }

  const nodes = nodeList(elements, options.nodes, groundSet);
  const nodeIndex = new Map(nodes.map((node, index) => [node, index]));
  const branchElements = elements.filter((element) => branchElement(element.kind));
  const branches = branchElements.map((element, index) => ({
    element,
    name: branchName(element, index),
    kind: ['inductor', 'opamp', 'opamp-cm'].includes(element.kind) ? element.kind : 'voltage-source',
  }));
  if (new Set(branches.map((branch) => branch.name)).size !== branches.length) {
    throw new RangeError('MNA branch names must be unique');
  }
  const branchIndex = new Map(branches.map((branch, index) => [branch.name, nodes.length + index]));
  const branchColumn = new Map(branches.map((branch, index) => [branch.element, nodes.length + index]));
  const unknowns = [
    ...nodes.map((node) => `V(${node})`),
    ...branches.map((branch) => `I(${branch.name})`),
  ];
  const size = unknowns.length;
  const matrix = Array.from({ length: size }, () => Array(size).fill(ops.zero));
  const rhs = Array.from({ length: size }, () => Array(columnCount).fill(ops.zero));
  const indexOf = (value) => value === undefined || value === null || groundSet.has(String(value))
    ? undefined
    : nodeIndex.get(String(value));
  const stampBranchKcl = (a, b, branchColumn) => {
    addMatrixEntry(matrix, a, branchColumn, ops.one, ops);
    addMatrixEntry(matrix, b, branchColumn, ops.neg(ops.one), ops);
    addMatrixEntry(matrix, branchColumn, a, ops.one, ops);
    addMatrixEntry(matrix, branchColumn, b, ops.neg(ops.one), ops);
  };

  for (const element of elements) {
    const a = indexOf(element.terminals.a);
    const b = indexOf(element.terminals.b);
    switch (element.kind) {
      case 'resistor': {
        if (ops.isZero(element.value)) throw new RangeError('resistor resistance must be nonzero');
        stampAdmittance(matrix, a, b, ops.div(ops.one, element.value), ops);
        break;
      }
      case 'admittance':
      case 'conductance':
      case 'capacitor': {
        stampAdmittance(matrix, a, b, element.value, ops);
        break;
      }
      case 'vccs':
        stampVccs(matrix, element, nodeIndex, ops);
        break;
      case 'current-source': {
        const current = element.value ?? ops.zero;
        const values = sourceVector(current, columnCount, ops, `${element.kind} source`);
        for (let column = 0; column < columnCount; column++) {
          if (a !== undefined && !ops.isZero(values[column])) rhs[a][column] = ops.sub(rhs[a][column], values[column]);
          if (b !== undefined && !ops.isZero(values[column])) rhs[b][column] = ops.add(rhs[b][column], values[column]);
        }
        break;
      }
      case 'voltage-source': {
        const branch = branchColumn.get(element);
        stampBranchKcl(a, b, branch);
        const voltage = element.value ?? ops.zero;
        const values = sourceVector(voltage, columnCount, ops, `${element.kind} source`);
        for (let column = 0; column < columnCount; column++) {
          if (!ops.isZero(values[column])) rhs[branch][column] = ops.add(rhs[branch][column], values[column]);
        }
        break;
      }
      case 'inductor': {
        const branch = branchColumn.get(element);
        stampBranchKcl(a, b, branch);
        addMatrixEntry(matrix, branch, branch, ops.neg(element.value), ops);
        break;
      }
      case 'opamp': {
        // An opamp: its output current enters at a (leaves b), and its row
        // is beta (V(a) - V(b)) = V(control.a) - V(control.b), beta its
        // inverse gain -- 0 for an ideal opamp, whose inputs are then held
        // equal (a nullor), 1/A for finite gain, s/omega_t for one pole.
        const branch = branchColumn.get(element);
        const plus = indexOf(element.control.a);
        const minus = indexOf(element.control.b);
        addMatrixEntry(matrix, a, branch, ops.one, ops);
        addMatrixEntry(matrix, b, branch, ops.neg(ops.one), ops);
        addMatrixEntry(matrix, branch, a, element.value, ops);
        addMatrixEntry(matrix, branch, b, ops.neg(element.value), ops);
        addMatrixEntry(matrix, branch, plus, ops.neg(ops.one), ops);
        addMatrixEntry(matrix, branch, minus, ops.one, ops);
        break;
      }
      case 'opamp-cm': {
        // A fully differential opamp's common mode: its current enters both
        // outputs alike, and holds V(a) + V(b) at AC ground.
        const branch = branchColumn.get(element);
        addMatrixEntry(matrix, a, branch, ops.one, ops);
        addMatrixEntry(matrix, b, branch, ops.one, ops);
        addMatrixEntry(matrix, branch, a, ops.one, ops);
        addMatrixEntry(matrix, branch, b, ops.one, ops);
        break;
      }
      default:
        throw new TypeError(`unsupported MNA element kind "${element.kind}"`);
    }
  }

  if (explicitRhs !== undefined) {
    matrixShape(explicitRhs, 'rhs', size, columnCount);
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < columnCount; column++) {
        rhs[row][column] = ops.add(rhs[row][column], explicitRhs[row][column]);
      }
    }
  }
  const opamps = elements.filter((element) => element.kind === 'opamp');
  if (opamps.length) {
    return reduceNullors({ ops, ground, nodes, branches, columnCount, unknowns, matrix, rhs }, opamps.map((element) => ({
      out: indexOf(element.terminals.a),
      ref: indexOf(element.terminals.b),
      plus: indexOf(element.control.a),
      minus: indexOf(element.control.b),
      branch: branchColumn.get(element),
      ideal: ops.isZero(element.value),
      id: element.id,
    })));
  }
  return {
    ok: true,
    ops,
    ground,
    nodes,
    branches,
    rhsCount: columnCount,
    unknowns,
    nodeVoltageUnknowns: nodes.map((node) => `V(${node})`),
    branchCurrentUnknowns: branches.map((branch) => `I(${branch.name})`),
    nodeIndex,
    branchIndex,
    A: matrix,
    B: rhs,
    matrix,
    rhs,
  };
}

/**
 * Fold ideal opamps out of a built system: each is a nullor. Its inputs, a
 * nullator, hold V(minus) = V(plus), so V(minus) stops being an unknown (its
 * column joins plus's, or goes when plus is AC ground) while its KCL row
 * stays; its output, a norator, carries whatever current it must, so the
 * output's KCL row goes (added into its reference's row) while V(out) stays.
 * With its branch row and current gone too, each opamp takes one row and one
 * column away instead of adding them -- an opamp-RC filter's summing nodes
 * become virtual grounds and its system shrinks to the opamp outputs. The
 * rows no longer pair with the unknowns of the same index, so the result is
 * flagged `nullorReduced` (structural solvers skip it); `aliases` maps each
 * folded voltage to the one it equals (null: AC ground). A finite opamp's
 * output current goes the same way, its own row (beta V_out = V_+ - V_-)
 * staying as the equation in the output's KCL row's place.
 */
function reduceNullors(system, opamps) {
  const { ops, matrix, rhs, unknowns, columnCount } = system;
  const size = unknowns.length;
  const rowInto = new Map(); // dropped row -> the row it was added into
  const columnInto = new Map(); // dropped column -> the column it joined (null: ground)
  const rowOf = (row) => { while (row !== undefined && rowInto.has(row)) row = rowInto.get(row); return row; };
  const columnOf = (column) => {
    while (column !== undefined && column !== null && columnInto.has(column)) column = columnInto.get(column);
    return column;
  };
  const dropRow = (row, into) => {
    if (into !== undefined) {
      for (let c = 0; c < size; c++) if (!ops.isZero(matrix[row][c])) matrix[into][c] = ops.add(matrix[into][c], matrix[row][c]);
      for (let c = 0; c < columnCount; c++) if (!ops.isZero(rhs[row][c])) rhs[into][c] = ops.add(rhs[into][c], rhs[row][c]);
    }
    rowInto.set(row, into);
  };
  const dropColumn = (column, into) => {
    if (into !== null && into !== undefined) {
      for (let r = 0; r < size; r++) if (!ops.isZero(matrix[r][column])) matrix[r][into] = ops.add(matrix[r][into], matrix[r][column]);
    }
    columnInto.set(column, into ?? null);
  };
  for (const opamp of opamps) {
    // The norator: the output's KCL row goes, into its reference's.
    const out = rowOf(opamp.out);
    const ref = rowOf(opamp.ref);
    if (out === undefined && ref === undefined) throw new RangeError(`${opamp.id} drives AC ground from AC ground`);
    if (out !== undefined) dropRow(out, ref);
    else dropRow(ref, undefined);
    // A finite opamp keeps its row; only its current goes.
    if (!opamp.ideal) {
      columnInto.set(opamp.branch, null);
      continue;
    }
    // The nullator: V(minus) = V(plus).
    const plus = columnOf(opamp.plus);
    const minus = columnOf(opamp.minus);
    if ((plus === undefined || plus === null) && (minus === undefined || minus === null)) {
      throw new RangeError(`${opamp.id} has both inputs on AC ground: its output is undetermined`);
    }
    if (plus === minus) throw new RangeError(`${opamp.id} has its inputs shorted together: its output is undetermined`);
    if (minus !== undefined && minus !== null) dropColumn(minus, plus ?? null);
    else dropColumn(plus, null);
    // Its branch row and current.
    rowInto.set(opamp.branch, undefined);
    columnInto.set(opamp.branch, null);
  }
  const keptRows = [...Array(size).keys()].filter((row) => !rowInto.has(row));
  const keptColumns = [...Array(size).keys()].filter((column) => !columnInto.has(column));
  if (keptRows.length !== keptColumns.length) throw new RangeError('the ideal opamps leave the circuit over- or under-determined');
  const A = keptRows.map((row) => keptColumns.map((column) => matrix[row][column]));
  const B = keptRows.map((row) => rhs[row].slice());
  const reducedUnknowns = keptColumns.map((column) => unknowns[column]);
  const aliases = new Map();
  for (const [column] of columnInto) {
    if (!unknowns[column].startsWith('V(')) continue;
    const target = columnOf(column);
    aliases.set(unknowns[column], target === null || target === undefined ? null : unknowns[target]);
  }
  const nodes = system.nodes.filter((node) => reducedUnknowns.includes(`V(${node})`));
  const branches = system.branches.filter((branch) => reducedUnknowns.includes(`I(${branch.name})`));
  return {
    ok: true,
    ops,
    ground: system.ground,
    nodes,
    branches,
    rhsCount: columnCount,
    unknowns: reducedUnknowns,
    nodeVoltageUnknowns: nodes.map((node) => `V(${node})`),
    branchCurrentUnknowns: branches.map((branch) => `I(${branch.name})`),
    nodeIndex: new Map(nodes.map((node) => [node, reducedUnknowns.indexOf(`V(${node})`)])),
    branchIndex: new Map(branches.map((branch) => [branch.name, reducedUnknowns.indexOf(`I(${branch.name})`)])),
    A,
    B,
    matrix: A,
    rhs: B,
    nullorReduced: true,
    aliases,
  };
}
