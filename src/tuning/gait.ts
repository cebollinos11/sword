/**
 * The `gait` Tuning Data section (data/gait.json): how a Fighter's feet step
 * whenever its body moves over the floor (see src/sim/gait.ts).
 */
import { finiteNumber, record, TuningDataError } from './validate';

export interface GaitTuning {
  /** How far (m) a planted foot may be from its stance before it steps there; smaller differences glide. */
  readonly strideThreshold: number;
  /** How long (s) one step takes, lift-off to landing. */
  readonly stepDuration: number;
  /** How high (m) the ankle rises above ankle height at the middle of a step. */
  readonly stepHeight: number;
  /** How far (m) the pelvis dips at the middle of a step. 0 turns the bob off. */
  readonly hipBob: number;
  /** How far (m) the pelvis shifts sideways over the planted foot at the middle of a step. 0 turns the sway off. */
  readonly hipSway: number;
}

/**
 * Every Gait field with its allowed range. To add a field, add it to
 * GaitTuning, add a row here and add it to data/gait.json.
 */
export const GAIT_FIELDS: Readonly<Record<keyof GaitTuning, { readonly min: number; readonly max: number; readonly minExclusive: boolean }>> = {
  strideThreshold: { min: 0, max: 1, minExclusive: true },
  stepDuration: { min: 0, max: 2, minExclusive: true },
  stepHeight: { min: 0, max: 0.5, minExclusive: false },
  hipBob: { min: 0, max: 0.2, minExclusive: false },
  hipSway: { min: 0, max: 0.2, minExclusive: false },
};

export function parseGait(raw: unknown): GaitTuning {
  const g = record(raw, 'gait');
  const out: Record<string, number> = {};
  for (const [key, { min, max, minExclusive }] of Object.entries(GAIT_FIELDS)) {
    const v = finiteNumber(g, key, 'gait');
    if (minExclusive ? v <= min : v < min) throw new TuningDataError(`gait.${key} must be ${minExclusive ? '>' : '>='} ${min}, got ${v}`);
    if (v > max) throw new TuningDataError(`gait.${key} must be at most ${max}, got ${v}`);
    out[key] = v;
  }
  return out as unknown as GaitTuning;
}
