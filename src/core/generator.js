/** Generation facades for topology compilation, placement, and routing. */
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
import { ROUTING_VERSION, MAX_ROUTING_ATTEMPTS, routeCircuit, tryRouteCircuit, routePlacedCircuit, tryRoutePlacedCircuit } from './routing.js';

export { PLACEMENT_VERSION, MAX_PLACEMENT_CANDIDATES, placeCircuit, tryPlaceCircuit };
export { ROUTING_VERSION, MAX_ROUTING_ATTEMPTS, routeCircuit, tryRouteCircuit, routePlacedCircuit, tryRoutePlacedCircuit };

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
