/**
 * The `gait` Tuning Data section (data/gait.json): how a Fighter's feet step
 * whenever its body moves over the floor (see src/sim/gait.ts).
 */
import { finiteNumber, record, TuningDataError } from './validate';

export interface GaitTuning {
  /** How far (m) a planted foot may be from where the Motion puts it before it steps there; smaller differences glide. */
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
 * Every Gait field with its allowed range and the Editor slider's step. To add
 * a field, add it to GaitTuning, add a row here, read it in parseGait and add
 * it to data/gait.json.
 */
export const GAIT_FIELDS: Readonly<Record<keyof GaitTuning, { readonly min: number; readonly max: number; readonly minExclusive: boolean; readonly step: number }>> = {
  strideThreshold: { min: 0, max: 1, minExclusive: true, step: 0.005 },
  stepDuration: { min: 0, max: 2, minExclusive: true, step: 1 / 60 }, // one Tick: steps last whole Ticks
  stepHeight: { min: 0, max: 0.5, minExclusive: false, step: 0.005 },
  hipBob: { min: 0, max: 0.2, minExclusive: false, step: 0.001 },
  hipSway: { min: 0, max: 0.2, minExclusive: false, step: 0.001 },
};

export function parseGait(raw: unknown): GaitTuning {
  const g = record(raw, 'gait');
  const field = (key: keyof GaitTuning): number => {
    const { min, max, minExclusive } = GAIT_FIELDS[key];
    const v = finiteNumber(g, key, 'gait');
    if (minExclusive ? v <= min : v < min) throw new TuningDataError(`gait.${key} must be ${minExclusive ? '>' : '>='} ${min}, got ${v}`);
    if (v > max) throw new TuningDataError(`gait.${key} must be at most ${max}, got ${v}`);
    return v;
  };
  return {
    strideThreshold: field('strideThreshold'),
    stepDuration: field('stepDuration'),
    stepHeight: field('stepHeight'),
    hipBob: field('hipBob'),
    hipSway: field('hipSway'),
  };
}
