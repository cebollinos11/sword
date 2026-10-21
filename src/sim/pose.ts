import { defaultWeaponName, weaponByName, type TuningData } from '../tuning';
import { applyBlockImpact, applyGuard, offHandFree } from './actions';
import { footPitch, footPose, hipShift, toLocal } from './gait';
import { motionTargets, playbackTargets, type PoseTargets } from './motion';
import { kickLegOf, solveSkeleton, type Placement, type SkeletonPose } from './skeleton';
import type { FighterState, MotionPlayback } from './state';

/** What a Fighter records of its solved Skeleton each Tick: the blade and the kicking leg, whose last-Tick values bound the next Tick's sweeps. */
export const bladeAndLeg = (pose: SkeletonPose): Pick<FighterState, 'blade' | 'kickLeg'> => ({ blade: pose.blade, kickLeg: kickLegOf(pose) });

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
 * other way (`fighter.lookHipShift`) to keep it balanced. The hands and Weapon swing up or down with it in the solve (`GaitOffsets.aim`).
 */
export function applyLook(targets: PoseTargets, pitch: number, tuning: TuningData): PoseTargets {
  if (pitch === 0) return targets;
  const lean = -pitch * tuning.fighter.lookLean;
  const hip = { ...targets.hip, z: targets.hip.z - Math.sin(lean) * tuning.fighter.lookHipShift };
  return { ...targets, hip, torso: { ...targets.torso, lean: targets.torso.lean + (lean * 180) / Math.PI } };
}

/**
 * The targets with the Fighter crouched by `crouch` (0 to 1): the hips and both hands drop by `fighter.crouchDepth` times it, so the
 * feet stay planted and the knees bend, and the Weapon, and so every blow, comes from lower down.
 */
export function applyCrouch(targets: PoseTargets, crouch: number, tuning: TuningData): PoseTargets {
  if (crouch === 0) return targets;
  const drop = crouch * tuning.fighter.crouchDepth;
  const lower = <T extends { readonly y: number }>(v: T): T => ({ ...v, y: v.y - drop });
  return {
    ...targets,
    hip: lower(targets.hip),
    rightHand: { ...targets.rightHand, position: lower(targets.rightHand.position) },
    leftHand: { ...targets.leftHand, position: lower(targets.leftHand.position) },
  };
}

/**
 * The full solved Skeleton of a Fighter (what the Renderer draws and Hit Zones are built on):
 * its Motion playback (crossfading out of the last Motion, if one just ended) at its position and facing, with the feet where the Gait has them
 * and the hips bobbing and swaying with each step, the torso leaning and the hands and Weapon aimed with where it looks, the sword hand shaken by any Block Impact, and its Weapon held as its grip says.
 */
export function fighterPose(f: FighterState, tuning: TuningData): SkeletonPose {
  const moving = applyLook(applyCrouch(playbackTargets(tuning, f.weapon, f.motion), f.crouch, tuning), f.pitch, tuning);
  // A Knockdown holding a guard holds its hands as that Block does, on top of the lying body.
  const guard = f.action.kind === 'Knockdown' ? f.action.guard : null;
  const played = guard ? applyGuard(moving, guard, tuning, f.weapon) : moving;
  const targets = f.blockImpact ? applyBlockImpact(played, f.blockImpact, tuning) : played;
  const left = footPose(f.gait.left, tuning);
  const right = footPose(f.gait.right, tuning);
  // A foot the Motion owns (a Kick's right foot) comes from the Motion, not the Gait: solveSkeleton takes `kickFoot` as the ankle.
  return solveSkeleton(
    { ...targets, leftFoot: toLocal(left.ground, f), rightFoot: toLocal(right.ground, f) },
    tuning.skeleton,
    weaponByName(tuning, f.weapon),
    f,
    { lift: { left: left.lift, right: targets.kickFoot ? 0 : right.lift }, hipShift: hipShift(f.gait, f, targets.hip, { left: targets.leftFoot, right: targets.kickFoot ?? targets.rightFoot }, tuning), aim: f.pitch, offHandFree: offHandFree(f, tuning), ground: { left: left.y - f.y, right: right.y - f.y }, pitch: { left: footPitch(f.gait.left, f, tuning), right: targets.kickFoot ? 0 : footPitch(f.gait.right, f, tuning) } },
  );
}
