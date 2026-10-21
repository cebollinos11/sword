/**
 * What the Editor's preview of a Motion shows of Sheathing, as play would: the Weapon in its slot once a Sheathe passes its `swap` marker
 * (and before a Draw reaches it, and all through the Sheathed Idle), and the two-handed off hand letting go as `offHandFree` does in play.
 */
import { SHEATHED_IDLE_MOTION, sheatheMotionName, type SheatheKind } from '../sim';
import type { Motion, TuningData } from '../tuning';

export interface SheathePreview {
  /** The Weapon is drawn in its slot. */
  readonly sheathed: boolean;
  /** How far (0..1) the off hand has let go of a two-handed Weapon. */
  readonly offHandFree: number;
}

const kindOf = (name: string): SheatheKind | undefined =>
  (['Sheathe', 'Draw'] as const).find((kind) => name === sheatheMotionName(kind, 'hip') || name === sheatheMotionName(kind, 'back'));

/** The preview of `motion` at `seconds` (authored time). */
export function sheathePreview(motion: Motion, seconds: number, tuning: TuningData): SheathePreview {
  if (motion.name === SHEATHED_IDLE_MOTION) return { sheathed: true, offHandFree: 1 };
  const kind = kindOf(motion.name);
  if (!kind) return { sheathed: false, offHandFree: 0 };
  const swap = motion.markers.swap ?? 0;
  const ramp = (s: number) => Math.min(1, Math.max(0, s / tuning.fighter.motionBlend));
  return kind === 'Sheathe' ? { sheathed: seconds >= swap, offHandFree: ramp(seconds) } : { sheathed: seconds < swap, offHandFree: ramp(motion.duration - seconds) };
}
