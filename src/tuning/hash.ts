import { hashValue } from '../hash';
import type { TuningData } from './index';

/**
 * Content hash of the full Tuning Data set (8 hex chars), used for the peer
 * compatibility check: both peers must hold identical Tuning Data (ADR 0001).
 * Hashes the validated data canonically (keys sorted), so it depends only on
 * the values, not on file layout or key order.
 */
export function tuningDataHash(tuning: TuningData): string {
  return hashValue(tuning);
}
