/**
 * The Skeleton: a fixed hierarchy of joints built from primitives, solved
 * from Pose Key targets by analytic two-bone IK (arms and legs) plus a
 * twisting/leaning spine. Pure math, run inside the Tick (ADR 0001).
 */
import type { OffHandGrip, SkeletonTuning, WeaponTuning } from '../tuning';
import type { PoseTargets } from './motion';
import type { Vec2 } from './state';
import { add, cross, dot, length, normalize, rotateEuler, rotateX, rotateY, scale, sub, vec3, type Vec3 } from './vec';

export const JOINT_NAMES = [
  'pelvis',
  'chest',
  'head',
  'leftShoulder',
  'leftElbow',
  'leftHand',
  'rightShoulder',
  'rightElbow',
  'rightHand',
  'leftHip',
  'leftKnee',
  'leftAnkle',
  'leftToe',
  'rightHip',
  'rightKnee',
  'rightAnkle',
  'rightToe',
] as const;
export type JointName = (typeof JOINT_NAMES)[number];

/** Bones as joint pairs (parent → child). Renderers draw these; Hit Zones will be built on them. */
export const BONES: readonly (readonly [JointName, JointName])[] = [
  ['pelvis', 'chest'],
  ['chest', 'head'],
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftHand'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightHand'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['leftAnkle', 'leftToe'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
  ['rightAnkle', 'rightToe'],
];

/** The Weapon at one Tick, in world space. Consecutive transforms bound the Blade Sweep. */
export interface BladeTransform {
  /** Where the main (sword) hand grips the Weapon. The grip or shaft runs on behind it, `gripLength` to the pommel or butt. */
  readonly hilt: Vec3;
  readonly tip: Vec3;
  /** Unit vector of the leading (cutting) edge, perpendicular to the blade. */
  readonly edge: Vec3;
}

/** A solved Skeleton in world space. */
export interface SkeletonPose {
  readonly joints: Readonly<Record<JointName, Vec3>>;
  readonly blade: BladeTransform;
}

/** Where a Fighter stands: the frame its Pose Keys are authored in. */
export interface Placement {
  readonly position: Vec2;
  /** Yaw in radians; 0 faces +z. */
  readonly facing: number;
}

const TOE_LENGTH = 0.14;

/**
 * Two-bone IK. Returns [middle joint, end joint]. The end reaches `target`
 * when it is within reach; otherwise the chain points straight at it. The
 * middle joint bends toward `pole`.
 */
export function twoBoneIk(root: Vec3, target: Vec3, l1: number, l2: number, pole: Vec3): [Vec3, Vec3] {
  const toTarget = sub(target, root);
  const dir = normalize(toTarget, { x: 0, y: -1, z: 0 });
  const minD = Math.abs(l1 - l2) + 1e-6;
  const maxD = l1 + l2;
  const d = Math.min(Math.max(length(toTarget), minD), maxD);
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  // Bend direction: the pole with its component along the chain removed.
  let bend = sub(pole, scale(dir, dot(pole, dir)));
  if (length(bend) < 1e-9) bend = Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  bend = normalize(bend);
  const mid = add(root, add(scale(dir, l1 * cosA), scale(bend, l1 * Math.sqrt(1 - cosA * cosA))));
  const end = add(root, scale(dir, d));
  return [mid, end];
}

/** How far (m) each ankle is lifted above ankle height, e.g. mid-step. */
export interface FootLift {
  readonly left: number;
  readonly right: number;
}

/** How far (m) the Gait moves the pelvis from the Motion's hip target: sideways (Fighter-local +x is right) and down. */
export interface HipShift {
  readonly sideways: number;
  readonly drop: number;
}

/**
 * What the Gait adds on top of the Motion's targets: each ankle's lift, and the
 * hip bob and sway (hipShift). The torso and head move with the pelvis; the
 * hands stay where the Motion puts them and the arms absorb the shift.
 */
export interface GaitOffsets {
  readonly lift: FootLift;
  readonly hipShift: HipShift;
}

const NO_GAIT: GaitOffsets = { lift: { left: 0, right: 0 }, hipShift: { sideways: 0, drop: 0 } };

/**
 * The Off-hand Grip's spot for a Weapon held at `hand`, with its axis (hand →
 * tip) and edge: `along` back from the hand toward the pommel or butt, then
 * `radial` off the axis at `around` degrees from the edge.
 */
export function offHandSpot(hand: Vec3, axis: Vec3, edge: Vec3, grip: OffHandGrip): Vec3 {
  const a = (grip.around * Math.PI) / 180;
  const side = add(scale(edge, Math.cos(a)), scale(cross(axis, edge), Math.sin(a)));
  return add(sub(hand, scale(axis, grip.along)), scale(side, grip.radial));
}

/**
 * The smallest move of a two-handed Weapon that puts its Off-hand Grip `spot`
 * within `reach` of the off shoulder: straight toward the shoulder, by however
 * far the spot is out of reach (zero when it is in reach). Analytic, so the
 * same inputs always give the same pull (ADR 0004).
 */
export function offHandPull(shoulder: Vec3, spot: Vec3, reach: number): Vec3 {
  const toShoulder = sub(shoulder, spot);
  const d = length(toShoulder);
  if (d <= reach) return vec3(0, 0, 0);
  return scale(toShoulder, (d - reach) / d);
}

/**
 * Solve the Skeleton for some Pose targets and place it in the world.
 *
 * With a two-handed Weapon the off hand ignores its Pose Key target and holds
 * the Off-hand Grip: when that spot is out of the off arm's reach, the whole
 * Weapon (both hands, same orientation) moves toward the off shoulder until it
 * is in reach (ADR 0004). If the sword hand then falls short of its own target,
 * the Weapon is built on where it got to, and the off hand falls short as a last resort.
 */
export function solveSkeleton(targets: PoseTargets, s: SkeletonTuning, weapon: WeaponTuning, at: Placement, gait: GaitOffsets = NO_GAIT): SkeletonPose {
  // Everything is solved in the Fighter-local frame (x right, y up, z forward), then placed.
  const spine = (v: Vec3) => rotateY(rotateX(v, targets.torso.lean), targets.torso.twist);
  const halfShoulder = s.shoulderWidth / 2;
  const upperBody = (pelvis: Vec3) => {
    const chest = add(pelvis, spine(vec3(0, s.spine, 0)));
    return {
      chest,
      head: add(chest, spine(vec3(0, s.neck + s.headRadius, 0))),
      rightShoulder: add(chest, spine(vec3(halfShoulder, 0, 0))),
      leftShoulder: add(chest, spine(vec3(-halfShoulder, 0, 0))),
    };
  };
  const rightPole = spine(vec3(0.6, -1, -0.4));
  const leftPole = spine(vec3(-0.6, -1, -0.4));
  const bladeDir = rotateEuler(vec3(0, 0, 1), targets.rightHand.rotation);
  const edge = rotateEuler(vec3(0, -1, 0), targets.rightHand.rotation);
  // The hands are where the Motion puts them, reached from the Motion's own hip target...
  const motionBody = upperBody(targets.hip);
  const grip = weapon.grip === 'twoHanded' ? weapon.offHandGrip : undefined;
  let rightTarget = targets.rightHand.position;
  if (grip) {
    // ...except that a two-handed Weapon yields to the off hand's reach.
    const spot = offHandSpot(rightTarget, bladeDir, edge, grip);
    rightTarget = add(rightTarget, offHandPull(motionBody.leftShoulder, spot, s.upperArm + s.forearm));
  }
  const [motionRightElbow, rightHand] = twoBoneIk(motionBody.rightShoulder, rightTarget, s.upperArm, s.forearm, rightPole);
  const leftTarget = grip ? offHandSpot(rightHand, bladeDir, edge, grip) : targets.leftHand.position;
  const [motionLeftElbow, leftHand] = twoBoneIk(motionBody.leftShoulder, leftTarget, s.upperArm, s.forearm, leftPole);
  // ...and when the Gait shifts the pelvis, the arms re-bend from the shifted shoulders to those same hands.
  const { sideways, drop } = gait.hipShift;
  const shifted = sideways !== 0 || drop !== 0;
  const pelvis = shifted ? add(targets.hip, vec3(sideways, -drop, 0)) : targets.hip;
  const { chest, head, rightShoulder, leftShoulder } = shifted ? upperBody(pelvis) : motionBody;
  const rightElbow = shifted ? twoBoneIk(rightShoulder, rightHand, s.upperArm, s.forearm, rightPole)[0] : motionRightElbow;
  const leftElbow = shifted ? twoBoneIk(leftShoulder, leftHand, s.upperArm, s.forearm, leftPole)[0] : motionLeftElbow;
  const { lift } = gait;

  const halfHip = s.hipWidth / 2;
  const rightHip = add(pelvis, vec3(halfHip, 0, 0));
  const leftHip = add(pelvis, vec3(-halfHip, 0, 0));
  const knee = vec3(0, 0, 1);
  const rAnkleTarget = vec3(targets.rightFoot.x, s.ankleHeight + lift.right, targets.rightFoot.z);
  const lAnkleTarget = vec3(targets.leftFoot.x, s.ankleHeight + lift.left, targets.leftFoot.z);
  const [rightKnee, rightAnkle] = twoBoneIk(rightHip, rAnkleTarget, s.thigh, s.shin, knee);
  const [leftKnee, leftAnkle] = twoBoneIk(leftHip, lAnkleTarget, s.thigh, s.shin, knee);
  // The toe rises with the foot's lift: on the floor when planted (even if the leg falls short of it), raised mid-step.
  const toe = (ankle: Vec3, footLift: number) => vec3(ankle.x, footLift, ankle.z + TOE_LENGTH);

  const local: Record<JointName, Vec3> = {
    pelvis,
    chest,
    head,
    leftShoulder,
    leftElbow,
    leftHand,
    rightShoulder,
    rightElbow,
    rightHand,
    leftHip,
    leftKnee,
    leftAnkle,
    leftToe: toe(leftAnkle, lift.left),
    rightHip,
    rightKnee,
    rightAnkle,
    rightToe: toe(rightAnkle, lift.right),
  };

  // Fighter-local → world. Facing f: forward = (sin f, 0, cos f), right = (-cos f, 0, sin f).
  const c = Math.cos(at.facing);
  const sn = Math.sin(at.facing);
  const dirToWorld = (v: Vec3): Vec3 => ({ x: -v.x * c + v.z * sn, y: v.y, z: v.x * sn + v.z * c });
  const toWorld = (v: Vec3): Vec3 => {
    const d = dirToWorld(v);
    return { x: d.x + at.position.x, y: d.y, z: d.z + at.position.z };
  };

  const joints = {} as Record<JointName, Vec3>;
  for (const name of JOINT_NAMES) joints[name] = toWorld(local[name]);
  return {
    joints,
    blade: {
      hilt: joints.rightHand,
      tip: toWorld(add(rightHand, scale(bladeDir, weapon.length))),
      edge: dirToWorld(edge),
    },
  };
}
