import type { TuningData } from '../tuning';
import { applyBlockImpact } from './actions';
import { footPose, hipShift, toLocal } from './gait';
import { motionTargets, playbackTargets } from './motion';
import { solveSkeleton, type Placement, type SkeletonPose } from './skeleton';
import type { FighterState, MotionPlayback } from './state';

/**
 * The solved Skeleton of a Fighter at `placement`, `tick` Ticks into the named
 * Motion. Pure and deterministic: the same inputs always give the same pose.
 */
export function motionPose(tuning: TuningData, motionName: string, tick: number, placement: Placement): SkeletonPose {
  return solveSkeleton(motionTargets(tuning, motionName, tick), tuning.skeleton, tuning.weapon, placement);
}

/** The solved Skeleton of a playback (with any Motion Blend) at `placement`, Gait aside: a Fighter standing still. */
export function playbackPose(tuning: TuningData, playback: MotionPlayback, placement: Placement): SkeletonPose {
  return solveSkeleton(playbackTargets(tuning, playback), tuning.skeleton, tuning.weapon, placement);
}

/**
 * The full solved Skeleton of a Fighter (what the Renderer draws and Hit Zones are built on):
 * its Motion playback (crossfading out of the last Motion, if one just ended) at its position and facing, with the feet where the Gait has them
 * and the hips bobbing and swaying with each step, and the sword hand shaken by any Block Impact.
 */
export function fighterPose(f: FighterState, tuning: TuningData): SkeletonPose {
  const played = playbackTargets(tuning, f.motion);
  const targets = f.blockImpact ? applyBlockImpact(played, f.blockImpact, tuning) : played;
  const left = footPose(f.gait.left, tuning);
  const right = footPose(f.gait.right, tuning);
  return solveSkeleton(
    { ...targets, leftFoot: toLocal(left.ground, f), rightFoot: toLocal(right.ground, f) },
    tuning.skeleton,
    tuning.weapon,
    f,
    { lift: { left: left.lift, right: right.lift }, hipShift: hipShift(f.gait, f, targets.hip, tuning) },
  );
}
