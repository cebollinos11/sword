import type { TuningData } from '../tuning';
import { motionTime, sampleMotion } from './motion';
import { solveSkeleton, type Placement, type SkeletonPose } from './skeleton';
import type { FighterState } from './state';

/**
 * The solved Skeleton of a Fighter at `placement`, `tick` Ticks into the named
 * Motion. Pure and deterministic: the same inputs always give the same pose.
 */
export function motionPose(tuning: TuningData, motionName: string, tick: number, placement: Placement): SkeletonPose {
  const motion = tuning.motions[motionName];
  if (!motion) throw new Error(`Unknown Motion "${motionName}"`);
  const targets = sampleMotion(motion, motionTime(motion, tick), tuning.skeleton);
  return solveSkeleton(targets, tuning.skeleton, tuning.weapon, placement);
}

/** The full solved Skeleton of a Fighter: its Motion playback at its position and facing (what the Renderer draws). */
export function fighterPose(f: FighterState, tuning: TuningData): SkeletonPose {
  return motionPose(tuning, f.motion.name, f.motion.tick, f);
}
