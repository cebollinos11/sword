import { hashValue } from '../hash';
import type { SimState } from './state';

export { hashValue } from '../hash';

/**
 * Hash of the full Simulation state (FNV-1a 32-bit over the canonical form),
 * as 8 hex chars. Used for determinism checks and peer checksums.
 */
export function hashState(state: SimState): string {
  return hashValue(state);
}
