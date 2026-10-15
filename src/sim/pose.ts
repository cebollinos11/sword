import type { TuningData } from '../tuning';
import { footPose, toLocal } from './gait';
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

/**
 * The full solved Skeleton of a Fighter (what the Renderer draws and Hit Zones are built on):
 * its Motion playback at its position and facing, with the feet where the Gait has them.
 */
export function fighterPose(f: FighterState, tuning: TuningData): SkeletonPose {
  const motion = tuning.motions[f.motion.name];
  if (!motion) throw new Error(`Unknown Motion "${f.motion.name}"`);
  const targets = sampleMotion(motion, motionTime(motion, f.motion.tick), tuning.skeleton);
  const left = footPose(f.gait.left, tuning);
  const right = footPose(f.gait.right, tuning);
  return solveSkeleton(
    { ...targets, leftFoot: toLocal(left.ground, f), rightFoot: toLocal(right.ground, f) },
    tuning.skeleton,
    tuning.weapon,
    f,
    { left: left.lift, right: right.lift },
  );
}
