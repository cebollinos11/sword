import { defaultWeaponName, weaponByName, type TuningData } from '../tuning';
import { applyBlockImpact } from './actions';
import { footPose, hipShift, toLocal } from './gait';
import { motionTargets, playbackTargets, type PoseTargets } from './motion';
import { solveSkeleton, type Placement, type SkeletonPose } from './skeleton';
import type { FighterState, MotionPlayback } from './state';

/**
 * The solved Skeleton of a Fighter wielding `weapon` (default: the default Weapon) at `placement`,
 * `tick` Ticks into the named Motion as that Weapon plays it. Pure and deterministic: the same inputs always give the same pose.
 */
export function motionPose(tuning: TuningData, motionName: string, tick: number, placement: Placement, weapon = defaultWeaponName(tuning)): SkeletonPose {
  return solveSkeleton(motionTargets(tuning, weapon, motionName, tick), tuning.skeleton, weaponByName(tuning, weapon), placement);
}

/** The solved Skeleton of a playback (with any Motion Blend) at `placement`, Gait aside: a Fighter wielding `weapon` standing still. */
export function playbackPose(tuning: TuningData, playback: MotionPlayback, placement: Placement, weapon = defaultWeaponName(tuning)): SkeletonPose {
  return solveSkeleton(playbackTargets(tuning, weapon, playback), tuning.skeleton, weaponByName(tuning, weapon), placement);
}

/**
 * The Motion's targets with the torso leaned by where the Fighter looks: `fighter.lookLean`
 * of its pitch (back when looking up, forward when looking down), the hips moving the
 * other way (`fighter.lookHipShift`) to keep it balanced. The hands stay where the Motion puts them.
 */
export function applyLook(targets: PoseTargets, pitch: number, tuning: TuningData): PoseTargets {
  if (pitch === 0) return targets;
  const lean = -pitch * tuning.fighter.lookLean;
  const hip = { ...targets.hip, z: targets.hip.z - Math.sin(lean) * tuning.fighter.lookHipShift };
  return { ...targets, hip, torso: { ...targets.torso, lean: targets.torso.lean + (lean * 180) / Math.PI } };
}

/**
 * The full solved Skeleton of a Fighter (what the Renderer draws and Hit Zones are built on):
 * its Motion playback (crossfading out of the last Motion, if one just ended) at its position and facing, with the feet where the Gait has them
 * and the hips bobbing and swaying with each step, the torso leaning with where it looks, the sword hand shaken by any Block Impact, and its Weapon held as its grip says.
 */
export function fighterPose(f: FighterState, tuning: TuningData): SkeletonPose {
  const played = applyLook(playbackTargets(tuning, f.weapon, f.motion), f.pitch, tuning);
  const targets = f.blockImpact ? applyBlockImpact(played, f.blockImpact, tuning) : played;
  const left = footPose(f.gait.left, tuning);
  const right = footPose(f.gait.right, tuning);
  return solveSkeleton(
    { ...targets, leftFoot: toLocal(left.ground, f), rightFoot: toLocal(right.ground, f) },
    tuning.skeleton,
    weaponByName(tuning, f.weapon),
    f,
    { lift: { left: left.lift, right: right.lift }, hipShift: hipShift(f.gait, f, targets.hip, tuning), ground: { left: left.y - f.y, right: right.y - f.y } },
  );
}
