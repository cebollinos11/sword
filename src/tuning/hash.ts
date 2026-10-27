import { hashValue } from '../hash';
import { GENERATOR_VERSION } from '../sim/arenaGen/version';
import type { TuningData } from './index';

/**
 * Content hash of the full Tuning Data set (8 hex chars), used for the peer
 * compatibility check: both peers must hold identical Tuning Data (ADR 0001).
 * Hashes the validated data canonically (keys sorted), so it depends only on
 * the values, not on file layout or key order. The camera is presentation only
 * and left out, so peers may place their cameras differently. GENERATOR_VERSION is
 * in it, so peers whose generators could build different Generated Arenas from
 * the same name refuse each other (`generatorVersion` is for tests).
 */
export function tuningDataHash(tuning: TuningData, generatorVersion = GENERATOR_VERSION): string {
  const { camera: _camera, size: _size, ...simulated } = tuning;
  return hashValue({ ...simulated, generatorVersion });
}
