/**
 * Hit Zones: coarse capsules built on the Skeleton's bones. Each capsule
 * belongs to one Hit Zone (head, torso, limbs) whose radius and damage
 * multiplier come from Tuning Data.
 */
import type { HitZone, TuningData } from '../tuning';
import type { JointName, SkeletonPose } from './skeleton';
import type { Vec3 } from './vec';

/** Which bones (joint pairs) make up each Hit Zone. A pair of the same joint is a sphere. */
export const HIT_ZONE_BONES: Readonly<Record<HitZone, readonly (readonly [JointName, JointName])[]>> = {
  head: [['head', 'head']],
  torso: [
    ['pelvis', 'chest'],
    ['leftShoulder', 'rightShoulder'],
    ['leftHip', 'rightHip'],
  ],
  limbs: [
    ['leftShoulder', 'leftElbow'],
    ['leftElbow', 'leftHand'],
    ['rightShoulder', 'rightElbow'],
    ['rightElbow', 'rightHand'],
    ['leftHip', 'leftKnee'],
    ['leftKnee', 'leftAnkle'],
    ['rightHip', 'rightKnee'],
    ['rightKnee', 'rightAnkle'],
  ],
};

/** A capsule: all points within `radius` of the segment a→b. */
export interface HitCapsule {
  readonly zone: HitZone;
  readonly a: Vec3;
  readonly b: Vec3;
  readonly radius: number;
}

/** The Hit Zone capsules of a solved Skeleton, in world space. */
export function hitZoneCapsules(pose: SkeletonPose, tuning: TuningData): HitCapsule[] {
  const out: HitCapsule[] = [];
  for (const zone of Object.keys(HIT_ZONE_BONES) as HitZone[]) {
    const radius = tuning.hitZones[zone].radius;
    for (const [a, b] of HIT_ZONE_BONES[zone]) out.push({ zone, a: pose.joints[a], b: pose.joints[b], radius });
  }
  return out;
}
