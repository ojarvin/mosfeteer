/** Generation facades. Topology compilation and Phase 2 placement stay pure;
 * routing remains a later seam. */
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
import { PLACEMENT_VERSION, MAX_PLACEMENT_CANDIDATES, placeCircuit, tryPlaceCircuit } from './placement.js';

export { PLACEMENT_VERSION, MAX_PLACEMENT_CANDIDATES, placeCircuit, tryPlaceCircuit };

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
