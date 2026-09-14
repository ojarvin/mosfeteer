const GROUND_ALIASES = new Set(['0', 'gnd', 'GND']);
const DEFAULT_PIVOT_TOLERANCE = 1e-12;
const DEFAULT_CONDITION_LIMIT = 1e-12;

export function complex(re = 0, im = 0) {
  return { re, im };
}

function toComplex(value) {
  if (typeof value === 'number') return complex(value, 0);
  if (value && Number.isFinite(value.re) && Number.isFinite(value.im)) return complex(value.re, value.im);
  throw new TypeError(`expected a finite number or complex value, got ${String(value)}`);
}

function add(a, b) {
  return complex(a.re + b.re, a.im + b.im);
}

function subtract(a, b) {
  return complex(a.re - b.re, a.im - b.im);
}

function multiply(a, b) {
  return complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

function divide(a, b) {
  const scale = Math.max(Math.abs(b.re), Math.abs(b.im));
  if (scale === 0) throw new RangeError('division by zero in complex arithmetic');
  const br = b.re / scale;
  const bi = b.im / scale;
  const denominator = br * br + bi * bi;
  return complex((a.re * br + a.im * bi) / denominator / scale,
    (a.im * br - a.re * bi) / denominator / scale);
}

function negate(value) {
  return complex(-value.re, -value.im);
}

export function complexMagnitude(value) {
  return Math.hypot(value.re, value.im);
}

function setMatrix(matrix, row, column, value) {
  matrix[row][column] = add(matrix[row][column], value);
}

function normalizeType(type) {
  return String(type || '').toLowerCase().replace(/[_-]/g, '');
}

function descriptorType(element) {
  const type = normalizeType(element.type || element.kind);
  const aliases = {
    r: 'resistor',
    resistor: 'resistor',
    c: 'capacitor',
    capacitor: 'capacitor',
    l: 'inductor',
    inductor: 'inductor',
    i: 'currentsource',
    currentsource: 'currentsource',
    v: 'voltagesource',
    voltagesource: 'voltagesource',
    vccs: 'vccs',
  };
  const result = aliases[type];
  if (!result) throw new TypeError(`unsupported numeric MNA primitive type: ${String(element.type || element.kind)}`);
  return result;
}

function nodeOf(element, positive) {
  const key = positive ? ['positive', 'p', 'from', 'nPlus', 'plus'] : ['negative', 'n', 'to', 'nMinus', 'minus'];
  for (const name of key) {
    if (element[name] !== undefined) return String(element[name]);
  }
  throw new TypeError(`${descriptorType(element)} is missing its ${positive ? 'positive' : 'negative'} node`);
}

function controlNodeOf(element, positive) {
  const key = positive ? ['controlPositive', 'controlPlus', 'cp'] : ['controlNegative', 'controlMinus', 'cn'];
  for (const name of key) {
    if (element[name] !== undefined) return String(element[name]);
  }
  throw new TypeError(`VCCS is missing its ${positive ? 'positive' : 'negative'} control node`);
}

function valueOf(element, names) {
  for (const name of names) {
    if (element[name] !== undefined) return element[name];
  }
  throw new TypeError(`${descriptorType(element)} is missing its value`);
}

function sourceValues(value, columns, name) {
  if (Array.isArray(value)) {
    if (value.length !== columns) throw new RangeError(`${name} has ${value.length} values for ${columns} RHS columns`);
    return value.map(toComplex);
  }
  return Array.from({ length: columns }, () => toComplex(value));
}

function sourceId(element, index) {
  return String(element.id || element.name || `${descriptorType(element)}${index + 1}`);
}

function excitationBranchId(element, excitationIndex, sourceIndex) {
  return String(element.id || element.name || `excitationV${excitationIndex + 1}_${sourceIndex + 1}`);
}

function validatePositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  return value;
}

function isGround(node, ground) {
  return node === ground || (ground === '0' && GROUND_ALIASES.has(node));
}

function normalizeExcitation(excitation) {
  if (Array.isArray(excitation)) return excitation;
  if (!excitation || typeof excitation !== 'object') throw new TypeError('each excitation must be an array or object');
  return [
    ...(excitation.currentSources || excitation.currents || []),
    ...(excitation.voltageSources || excitation.voltages || []),
  ];
}

function allNodes(elements, excitations, ground) {
  const nodes = new Set();
  const add = (node) => { if (!isGround(node, ground)) nodes.add(node); };
  for (const element of elements) {
    const type = descriptorType(element);
    if (type === 'vccs') {
      add(nodeOf(element, true));
      add(nodeOf(element, false));
      add(controlNodeOf(element, true));
      add(controlNodeOf(element, false));
    } else {
      add(nodeOf(element, true));
      add(nodeOf(element, false));
    }
  }
  for (const excitation of excitations) {
    for (const source of normalizeExcitation(excitation)) {
      add(nodeOf(source, true));
      add(nodeOf(source, false));
    }
  }
  return [...nodes].sort();
}

function branchDescriptors(elements, excitations) {
  const branches = [];
  const ids = new Set();
  const add = (element, index, type) => {
    const id = sourceId(element, index);
    if (ids.has(id)) throw new Error(`duplicate numeric MNA branch id: ${id}`);
    ids.add(id);
    branches.push({ element, id, type });
  };
  elements.forEach((element, index) => {
    const type = descriptorType(element);
    if (type === 'voltagesource' || type === 'inductor') add(element, index, type);
  });
  excitations.forEach((excitation, excitationIndex) => {
    normalizeExcitation(excitation).forEach((source, sourceIndex) => {
      if (descriptorType(source) !== 'voltagesource') return;
      const id = excitationBranchId(source, excitationIndex, sourceIndex);
      if (ids.has(id)) return;
      add({ ...source, id }, id, 'voltagesource');
    });
  });
  return branches;
}

function nodeIndex(nodes, ground) {
  const indices = new Map(nodes.map((node, index) => [node, index]));
  return (node) => isGround(node, ground) ? -1 : indices.get(node);
}

function stampAdmittance(matrix, p, n, admittance) {
  if (p >= 0) setMatrix(matrix, p, p, admittance);
  if (n >= 0) setMatrix(matrix, n, n, admittance);
  if (p >= 0 && n >= 0) {
    setMatrix(matrix, p, n, negate(admittance));
    setMatrix(matrix, n, p, negate(admittance));
  }
}

function stampBranch(matrix, p, n, branchIndex, impedance) {
  if (p >= 0) {
    setMatrix(matrix, p, branchIndex, complex(1));
    setMatrix(matrix, branchIndex, p, complex(1));
  }
  if (n >= 0) {
    setMatrix(matrix, n, branchIndex, complex(-1));
    setMatrix(matrix, branchIndex, n, complex(-1));
  }
  setMatrix(matrix, branchIndex, branchIndex, negate(impedance));
}

function stampCurrentRhs(rhs, p, n, value) {
  if (p >= 0) rhs[p] = subtract(rhs[p], value);
  if (n >= 0) rhs[n] = add(rhs[n], value);
}

function sourceValue(element) {
  return valueOf(element, ['value', 'current', 'voltage']);
}

function sourceWidth(element) {
  const type = descriptorType(element);
  if (type !== 'currentsource' && type !== 'voltagesource') return 1;
  const value = sourceValue(element);
  return Array.isArray(value) ? value.length : 1;
}

function solveDense(matrix, rhs, { pivotTolerance = DEFAULT_PIVOT_TOLERANCE, conditionLimit = DEFAULT_CONDITION_LIMIT } = {}) {
  const size = matrix.length;
  const columns = rhs.length;
  const augmented = matrix.map((row, rowIndex) => [
    ...row.map(toComplex),
    ...rhs.map((column) => toComplex(column[rowIndex])),
  ]);
  const rowScales = augmented.map((row) => Math.max(...row.slice(0, size).map(complexMagnitude)));
  const pivots = [];
  let minPivot = Infinity;
  let maxPivot = 0;
  let zeroPivot = null;

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    let pivotMagnitude = 0;
    for (let row = column; row < size; row += 1) {
      const magnitude = complexMagnitude(augmented[row][column]);
      if (magnitude > pivotMagnitude) {
        pivotMagnitude = magnitude;
        pivotRow = row;
      }
    }
    const threshold = pivotTolerance * Math.max(rowScales[pivotRow] || 0, Number.MIN_VALUE);
    if (pivotMagnitude <= threshold) {
      zeroPivot = { row: column, magnitude: pivotMagnitude, threshold };
      break;
    }
    if (pivotRow !== column) [augmented[pivotRow], augmented[column]] = [augmented[column], augmented[pivotRow]];
    const pivot = augmented[column][column];
    pivots.push(pivotMagnitude);
    minPivot = Math.min(minPivot, pivotMagnitude);
    maxPivot = Math.max(maxPivot, pivotMagnitude);
    for (let row = column + 1; row < size; row += 1) {
      const factor = divide(augmented[row][column], pivot);
      if (complexMagnitude(factor) === 0) continue;
      augmented[row][column] = complex(0);
      for (let k = column + 1; k < size + columns; k += 1) {
        augmented[row][k] = subtract(augmented[row][k], multiply(factor, augmented[column][k]));
      }
    }
  }

  if (zeroPivot) {
    return {
      ok: false,
      status: 'singular',
      solutions: [],
      diagnostics: {
        rank: pivots.length,
        pivots,
        conditionEstimate: Infinity,
        zeroPivot,
        message: `singular MNA system: pivot ${zeroPivot.row} has magnitude ${zeroPivot.magnitude}`,
      },
    };
  }

  const solutions = Array.from({ length: columns }, () => Array(size).fill(null).map(() => complex()));
  for (let row = size - 1; row >= 0; row -= 1) {
    for (let column = 0; column < columns; column += 1) {
      let value = augmented[row][size + column];
      for (let k = row + 1; k < size; k += 1) value = subtract(value, multiply(augmented[row][k], solutions[column][k]));
      solutions[column][row] = divide(value, augmented[row][row]);
    }
  }
  const conditionEstimate = maxPivot / minPivot;
  const illConditioned = conditionEstimate > 1 / conditionLimit;
  return {
    ok: true,
    status: illConditioned ? 'ill-conditioned' : 'ok',
    solutions,
    diagnostics: {
      rank: size,
      pivots,
      conditionEstimate,
      message: illConditioned
        ? `ill-conditioned MNA system: pivot ratio is approximately ${conditionEstimate}`
        : null,
    },
  };
}

function stampSourceValues(rhs, source, p, n, columns) {
  const values = sourceValues(sourceValue(source), columns, sourceId(source, 0));
  for (let column = 0; column < columns; column += 1) {
    stampCurrentRhs(rhs[column], p, n, values[column]);
  }
}

/**
 * Solve plain numeric primitives. Nodes use `positive`/`negative` (or
 * `from`/`to`); sources may be repeated in `excitations` for shared RHS
 * columns. Values are SI units and omega is rad/s.
 */
export function solveNumericMna(elements, omega, options = {}) {
  if (!Array.isArray(elements)) throw new TypeError('numeric MNA elements must be an array');
  if (!Number.isFinite(omega) || omega < 0) throw new RangeError('angular frequency must be a finite nonnegative number');
  const ground = String(options.ground || '0');
  const excitations = options.excitations || options.rhs || [];
  if (!Array.isArray(excitations)) throw new TypeError('numeric MNA excitations must be an array');
  const columns = Math.max(
    1,
    ...elements.map(sourceWidth),
    excitations.length,
  );
  if (excitations.length && excitations.length !== columns) throw new RangeError('excitation count must match the source RHS width');
  const nodes = allNodes(elements, excitations, ground);
  const branches = branchDescriptors(elements, excitations);
  const size = nodes.length + branches.length;
  const matrix = Array.from({ length: size }, () => Array(size).fill(null).map(() => complex()));
  const rhs = Array.from({ length: columns }, () => Array(size).fill(null).map(() => complex()));
  const nodeAt = nodeIndex(nodes, ground);
  const branchIndices = new Map(branches.map((branch, index) => [branch.id, nodes.length + index]));
  const branchAt = (id) => {
    const index = branchIndices.get(id);
    if (index === undefined) throw new Error(`unknown numeric MNA branch ${id}`);
    return index;
  };

  elements.forEach((element, elementIndex) => {
    const type = descriptorType(element);
    const p = nodeAt(nodeOf(element, true));
    const n = nodeAt(nodeOf(element, false));
    if (type === 'resistor') stampAdmittance(matrix, p, n, complex(1 / validatePositive(valueOf(element, ['resistance', 'value']), 'resistance')));
    if (type === 'capacitor') stampAdmittance(matrix, p, n, complex(0, omega * validatePositive(valueOf(element, ['capacitance', 'value']), 'capacitance')));
    if (type === 'inductor') stampBranch(matrix, p, n, branchAt(sourceId(element, elementIndex)), complex(0, omega * validatePositive(valueOf(element, ['inductance', 'value']), 'inductance')));
    if (type === 'voltagesource') stampBranch(matrix, p, n, branchAt(sourceId(element, elementIndex)), complex());
    if (type === 'currentsource') stampSourceValues(rhs, element, p, n, columns);
    if (type === 'vccs') {
      const gm = toComplex(valueOf(element, ['transconductance', 'gm', 'value']));
      const cp = nodeAt(controlNodeOf(element, true));
      const cn = nodeAt(controlNodeOf(element, false));
      if (p >= 0 && cp >= 0) setMatrix(matrix, p, cp, gm);
      if (p >= 0 && cn >= 0) setMatrix(matrix, p, cn, negate(gm));
      if (n >= 0 && cp >= 0) setMatrix(matrix, n, cp, negate(gm));
      if (n >= 0 && cn >= 0) setMatrix(matrix, n, cn, gm);
    }
    if (type === 'voltagesource') {
      const values = sourceValues(sourceValue(element), columns, sourceId(element, elementIndex));
      const row = branchAt(sourceId(element, elementIndex));
      values.forEach((value, column) => { rhs[column][row] = add(rhs[column][row], value); });
    }
  });
  const baseBranchIds = new Set(elements.flatMap((element, index) => {
    const type = descriptorType(element);
    return type === 'voltagesource' || type === 'inductor' ? [sourceId(element, index)] : [];
  }));
  const stampedExcitationBranches = new Set();
  excitations.forEach((excitation, column) => {
    normalizeExcitation(excitation).forEach((source, sourceIndex) => {
      if (descriptorType(source) !== 'voltagesource') return;
      const id = excitationBranchId(source, column, sourceIndex);
      if (baseBranchIds.has(id) || stampedExcitationBranches.has(id)) return;
      stampBranch(matrix, nodeAt(nodeOf(source, true)), nodeAt(nodeOf(source, false)), branchAt(id), complex());
      stampedExcitationBranches.add(id);
    });
  });
  excitations.forEach((excitation, column) => {
    normalizeExcitation(excitation).forEach((source, sourceIndex) => {
      const type = descriptorType(source);
      const p = nodeAt(nodeOf(source, true));
      const n = nodeAt(nodeOf(source, false));
      if (type === 'currentsource') stampCurrentRhs(rhs[column], p, n, toComplex(sourceValue(source)));
      if (type === 'voltagesource') {
        const id = excitationBranchId(source, column, sourceIndex);
        const row = branchAt(id);
        rhs[column][row] = add(rhs[column][row], toComplex(sourceValue(source)));
      }
    });
  });
  const solved = solveDense(matrix, rhs, options);
  const variableNames = [...nodes, ...branches.map((branch) => `I(${branch.id})`),];
  const maps = solved.solutions.map((solution) => new Map(variableNames.map((name, index) => [name, solution[index]])));
  return {
    ...solved,
    omega,
    nodes,
    branches: branches.map(({ id, type }) => ({ id, type })),
    variables: variableNames,
    solutions: maps,
    solution: maps[0] || null,
    matrix,
    rhs,
  };
}

export function nodeVoltage(result, node, column = 0) {
  if (isGround(String(node), '0')) return complex();
  const solution = result.solutions?.[column];
  if (!solution || !solution.has(String(node))) throw new Error(`numeric MNA node is unavailable: ${String(node)}`);
  return solution.get(String(node));
}

export function branchCurrent(result, id, column = 0) {
  const solution = result.solutions?.[column];
  const key = `I(${id})`;
  if (!solution || !solution.has(key)) throw new Error(`numeric MNA branch is unavailable: ${id}`);
  return solution.get(key);
}

export function createSeededRandom(seed = 0x9e3779b9) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function samplePositive(seed, min = 1e-3, max = 1e3) {
  validatePositive(min, 'minimum sample');
  validatePositive(max, 'maximum sample');
  if (max < min) throw new RangeError('maximum sample must not be below minimum sample');
  const random = createSeededRandom(seed);
  return min * (max / min) ** random();
}

/** Return deterministic positive samples for the symbolic model parameters. */
export function samplePositiveParameters(seed = 0x9e3779b9, count = 1) {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('sample count must be a positive integer');
  const random = createSeededRandom(seed);
  const logSample = (min, max) => min * (max / min) ** random();
  return Array.from({ length: count }, () => ({
    gm: logSample(1e-4, 1),
    gmb: logSample(1e-5, 1e-1),
    go: logSample(1e-8, 1e-2),
    R: logSample(1, 1e6),
    C: logSample(1e-12, 1e-3),
    L: logSample(1e-9, 1),
  }));
}
