/** Phase 1 topology compiler facade. Kept separate so future placement and
 * routing phases can grow without changing the CircuitSpec contract module. */
import {
  CIRCUIT_SPEC_VERSION,
  SUPPORTED_TEMPLATES,
  CircuitSpecError,
  candidateScore,
  compileCircuitSpec,
  expandCircuitSpec,
  generateCircuit,
  normalizeCircuitSpec,
  tryGenerateCircuit,
  validateCircuitSpec,
} from './circuitSpec.js';

export {
  CIRCUIT_SPEC_VERSION,
  SUPPORTED_TEMPLATES,
  CircuitSpecError,
  candidateScore,
  compileCircuitSpec,
  expandCircuitSpec,
  generateCircuit,
  normalizeCircuitSpec,
  tryGenerateCircuit,
  validateCircuitSpec,
};

export const normalizeSpec = normalizeCircuitSpec;
export const validateSpec = validateCircuitSpec;
