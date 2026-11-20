import { defaultWeaponName, sizedTuning, weaponByName, type TuningData } from '../tuning';
import { applyBlockImpact, applyGuard, offHandFree, whirlwindLastTick, whirlwindLowMotion } from './actions';
import { footPitch, footPose, hipShift, toLocal } from './gait';
import { lerpTargets, motionBlendTicks, motionTargets, playbackTargets, type PoseTargets } from './motion';
import { kickLegOf, NO_GAIT, solveSkeleton, type Placement, type SkeletonPose } from './skeleton';
import type { FighterState, MotionPlayback } from './state';

/** What a Fighter records of its solved Skeleton each Tick: the blade and the kicking leg, whose last-Tick values bound the next Tick's sweeps. */
export const bladeAndLeg = (pose: SkeletonPose): Pick<FighterState, 'blade' | 'kickLeg'> => ({ blade: pose.blade, kickLeg: kickLegOf(pose) });

/**
 * The solved Skeleton of a Fighter wielding `weapon` (default: the default Weapon) at `placement`,
 * `tick` Ticks into the named Motion as that Weapon plays it, a two-handed Weapon's off hand let go by `offHandFree` (0..1, as `offHandFree`
 * gives in play). Pure and deterministic: the same inputs always give the same pose.
 */
export function motionPose(tuning: TuningData, motionName: string, tick: number, placement: Placement, weapon = defaultWeaponName(tuning), offHandFree = 0): SkeletonPose {
  return solveSkeleton(motionTargets(tuning, weapon, motionName, tick), tuning.skeleton, weaponByName(tuning, weapon), placement, offHandFree === 0 ? NO_GAIT : { ...NO_GAIT, offHandFree });
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
export function fighterPose(f: FighterState, standard: TuningData): SkeletonPose {
  const known = solvedPoses.get(f);
  if (known && known.tuning === standard) return known.pose;
  const pose = solveFighter(f, standard);
  solvedPoses.set(f, { tuning: standard, pose });
  return pose;
}

/**
 * `f` with its blade and kicking leg set from its solved Skeleton (what each Tick records), the pose remembered for the
 * Fighter it returns, so a later `fighterPose` of it (the Blade Sweep's Hit Zones, the Renderer) does not solve it again.
 */
export function withPose(f: FighterState, tuning: TuningData): FighterState {
  // `f` is usually this Tick's Fighter on its way to the one returned: its pose is remembered for that one only.
  const known = solvedPoses.get(f);
  const pose = known && known.tuning === tuning ? known.pose : solveFighter(f, tuning);
  const posed = { ...f, ...bladeAndLeg(pose) };
  solvedPoses.set(posed, { tuning, pose });
  return posed;
}

/**
 * Each Fighter's solved Skeleton, by the very state object it was solved from (and the Tuning Data it was solved with).
 * A FighterState is never changed in place, so the pose stays its own; a cache, not state: a miss (a restored snapshot,
 * another Tick's Fighter) just solves again, to the same pose. Solved once a Tick instead of once for every Hit Zone
 * test of every Attack, dagger and Kick against it, and every rendered frame.
 */
const solvedPoses = new WeakMap<FighterState, { readonly tuning: TuningData; readonly pose: SkeletonPose }>();

/**
 * The Motion targets a Fighter plays: its playback, and for a Whirlwind Spin blended toward the low Spin Motion's pose (its last Tick) by
 * the Fighter's `crouch`, so the blade sweeps high standing and low crouched, and rises and falls as Crouch is let go or held. The low
 * pose fades in over one Motion Blend from the Spin's first Tick and back out over one from Recovery's first Tick (where the Idle blend
 * starts from the plain high pose), so a crouched spinner's hands never jump.
 */
function playedTargets(f: FighterState, tuning: TuningData): PoseTargets {
  const targets = playbackTargets(tuning, f.weapon, f.motion);
  const a = f.action;
  if (a.kind !== 'Whirlwind' || f.crouch === 0) return targets;
  const blend = motionBlendTicks(tuning);
  const ramp = a.phase === 'Spin' ? Math.min(1, (a.ticks + 1) / blend) : a.phase === 'Recovery' ? Math.max(0, 1 - (a.ticks + 1) / blend) : 0;
  if (ramp === 0) return targets;
  const low = whirlwindLowMotion(a.direction);
  return lerpTargets(targets, motionTargets(tuning, f.weapon, low, whirlwindLastTick(tuning, f.weapon, low)), f.crouch * ramp, tuning.skeleton.ankleHeight);
}

/**
 * The bearing the aim swings in: straight ahead (0), except in a Whirlwind, where it is the way the sword hand reaches from the hips, so the
 * pitch lifts or drops the blade's sweep (a Spin's blade points out to the side, where a swing about the body's own axis would do nothing).
 */
function aimAzimuth(f: FighterState, targets: PoseTargets): number {
  if (f.action.kind !== 'Whirlwind') return 0;
  const dx = targets.rightHand.position.x - targets.hip.x;
  const dz = targets.rightHand.position.z - targets.hip.z;
  return dx * dx + dz * dz < 1e-4 ? 0 : Math.atan2(dx, dz);
}

function solveFighter(f: FighterState, standard: TuningData): SkeletonPose {
  const tuning = sizedTuning(standard, f.size);
  const moving = applyLook(applyCrouch(playedTargets(f, tuning), f.crouch, tuning), f.pitch, tuning);
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
    { lift: { left: left.lift, right: targets.kickFoot ? 0 : right.lift }, hipShift: hipShift(f.gait, f, targets.hip, { left: targets.leftFoot, right: targets.kickFoot ?? targets.rightFoot }, tuning), aim: f.pitch, aimAzimuth: aimAzimuth(f, targets), offHandFree: offHandFree(f, tuning), ground: { left: left.y - f.y, right: right.y - f.y }, pitch: { left: footPitch(f.gait.left, f, tuning), right: targets.kickFoot ? 0 : footPitch(f.gait.right, f, tuning) } },
  );
}
