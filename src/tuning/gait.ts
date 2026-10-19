/**
 * The `gait` Tuning Data section (data/gait.json): how a Fighter's feet step
 * whenever its body moves over the floor (see src/sim/gait.ts).
 */
import { finiteNumber, record, TuningDataError } from './validate';

export interface GaitTuning {
  /** How far (m) a planted foot may be from where the Motion puts it before it steps there; smaller differences glide. */
  readonly strideThreshold: number;
  /** How far apart (m) successive footfalls land at full walk speed; slower walks take shorter strides, by the square root of the speed. */
  readonly strideLength: number;
  /** How much (0..1) walking forward or back at full speed draws the feet's front-to-back stagger in under the hips; 0 keeps the Motion's stance. */
  readonly squareUp: number;
  /** How far ahead (m) of where the Motion puts it a walking foot may land; the faster the walk, the further ahead it lands, up to this. */
  readonly maxLead: number;
  /** How long (s) one step takes, lift-off to landing. */
  readonly stepDuration: number;
  /** How high (m) the ankle rises above ankle height at the middle of a step. */
  readonly stepHeight: number;
  /** How far (m) the pelvis dips at the middle of a step. 0 turns the bob off. */
  readonly hipBob: number;
  /** How far (m) the pelvis shifts sideways over the planted foot at the middle of a step. 0 turns the sway off. */
  readonly hipSway: number;
  /** How far (degrees) the pelvis turns toward the forward foot when the feet are a full stride apart; the shoulders turn back half as far. 0 turns it off. */
  readonly hipTwist: number;
  /** How far (degrees) a stepping foot rolls off its toes and then raises them to land heel first. 0 keeps feet flat. */
  readonly toeRoll: number;
}

/**
 * Every Gait field with its allowed range and the Editor slider's step. To add
 * a field, add it to GaitTuning, add a row here, read it in parseGait and add
 * it to data/gait.json.
 */
export const GAIT_FIELDS: Readonly<Record<keyof GaitTuning, { readonly min: number; readonly max: number; readonly minExclusive: boolean; readonly step: number }>> = {
  strideThreshold: { min: 0, max: 1, minExclusive: true, step: 0.005 },
  strideLength: { min: 0, max: 2, minExclusive: true, step: 0.01 },
  squareUp: { min: 0, max: 1, minExclusive: false, step: 0.05 },
  maxLead: { min: 0, max: 1, minExclusive: false, step: 0.005 },
  stepDuration: { min: 0, max: 2, minExclusive: true, step: 1 / 60 }, // one Tick: steps last whole Ticks
  stepHeight: { min: 0, max: 0.5, minExclusive: false, step: 0.005 },
  hipBob: { min: 0, max: 0.2, minExclusive: false, step: 0.001 },
  hipSway: { min: 0, max: 0.2, minExclusive: false, step: 0.001 },
  hipTwist: { min: 0, max: 45, minExclusive: false, step: 0.5 },
  toeRoll: { min: 0, max: 60, minExclusive: false, step: 1 },
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
    strideLength: field('strideLength'),
    squareUp: field('squareUp'),
    maxLead: field('maxLead'),
    stepDuration: field('stepDuration'),
    stepHeight: field('stepHeight'),
    hipBob: field('hipBob'),
    hipSway: field('hipSway'),
    hipTwist: field('hipTwist'),
    toeRoll: field('toeRoll'),
  };
}
