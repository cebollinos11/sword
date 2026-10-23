/**
 * The Skeleton: a fixed hierarchy of joints built from primitives, solved
 * from Pose Key targets by analytic two-bone IK (arms and legs) plus a
 * twisting/leaning spine. Pure math, run inside the Tick (ADR 0001).
 */
import type { OffHandGrip, SkeletonTuning, WeaponTuning } from '../tuning';
import type { PoseTargets } from './motion';
import type { Vec2 } from './state';
import { add, cross, dot, length, lerp, normalize, rotateEuler, rotateX, rotateY, scale, sub, vec3, type Vec3 } from './vec';

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

/** The right leg's segment in world space (knee to toe): what a Kick sweeps against Hit Zones. */
export interface KickLeg {
  readonly knee: Vec3;
  readonly toe: Vec3;
}

/** A solved Skeleton in world space. */
export interface SkeletonPose {
  readonly joints: Readonly<Record<JointName, Vec3>>;
  readonly blade: BladeTransform;
}

/** The kicking leg of a solved Skeleton. */
export const kickLegOf = (pose: SkeletonPose): KickLeg => ({ knee: pose.joints.rightKnee, toe: pose.joints.rightToe });

/** Where a Fighter stands: the frame its Pose Keys are authored in. */
export interface Placement {
  readonly position: Vec2;
  /** Height (m) of the feet; 0 when absent. */
  readonly y?: number;
  /** Yaw in radians; 0 faces +z. */
  readonly facing: number;
}

const TOE_LENGTH = 0.14;

/** Which way the sword arm's elbow bends with a two-handed Weapon (Fighter-local, before the spine turns it); the off arm's is its mirror. */
export const TWO_HANDED_POLE: Vec3 = { x: 1, y: -0.5, z: 0.3 };
const mirrorX = (v: Vec3): Vec3 => ({ x: -v.x, y: v.y, z: v.z });

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

/**
 * How far the Gait moves the pelvis from the Motion's hip target: sideways (m, Fighter-local +x is right) and down (m), and how far
 * (degrees) it turns, + bringing the right hip forward (the shoulders turn back half as far); no turn when absent.
 */
export interface HipShift {
  readonly sideways: number;
  readonly drop: number;
  readonly twist?: number;
}

/**
 * What the Gait adds on top of the Motion's targets: each ankle's lift, and the
 * hip bob and sway (hipShift). The torso and head move with the pelvis; the
 * hands stay where the Motion puts them and the arms absorb the shift.
 */
export interface GaitOffsets {
  readonly lift: FootLift;
  readonly hipShift: HipShift;
  /** How high (m) the ground under each foot is above the Fighter's own height (feet on a ramp or a step); 0 when absent. */
  readonly ground?: FootLift;
  /** How far (degrees, + toe up) each foot is pitched about its ankle (rolling off the toes, landing on the heel); flat when absent. */
  readonly pitch?: FootLift;
  /**
   * Where the Fighter aims, radians up (+) or down (-) from level: the hands swing about the chest by it and the Weapon points along it,
   * so a Thrust reaches an opponent above or below; 0 when absent.
   */
  readonly aim?: number;
  /**
   * 0..1: how far the off hand has let go of a two-handed Weapon's Off-hand Grip to follow its own Pose Key (a Throw, ADR 0004). 0 (or absent)
   * holds the grip and pulls the Weapon in to reach it; 1 follows the Pose Key and leaves the Weapon where the sword hand's target puts it.
   */
  readonly offHandFree?: number;
}

export const NO_GAIT: GaitOffsets = { lift: { left: 0, right: 0 }, hipShift: { sideways: 0, drop: 0 } };

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
  const spine = (v: Vec3, twist = 0) => rotateY(rotateX(v, targets.torso.lean), targets.torso.twist + twist);
  const halfShoulder = s.shoulderWidth / 2;
  /** The chest, head and shoulders on a pelvis, the spine turned a further `twist` degrees. */
  const upperBody = (pelvis: Vec3, twist = 0) => {
    const chest = add(pelvis, spine(vec3(0, s.spine, 0), twist));
    return {
      chest,
      head: add(chest, spine(vec3(0, s.neck + s.headRadius, 0), twist)),
      rightShoulder: add(chest, spine(vec3(halfShoulder, 0, 0), twist)),
      leftShoulder: add(chest, spine(vec3(-halfShoulder, 0, 0), twist)),
    };
  };
  // Elbows bend down and back, out of the way of a one-handed sword; both hands on a two-handed grip in front of the body
  // bend them down and out instead, so the forearms reach round the body to the grip rather than through it.
  const twoHanded = weapon.grip === 'twoHanded';
  const rightPole = spine(twoHanded ? TWO_HANDED_POLE : vec3(0.6, -1, -0.4));
  const leftPole = spine(twoHanded ? mirrorX(TWO_HANDED_POLE) : vec3(-0.6, -1, -0.4));
  // Aiming up/down swings hands and Weapon about the chest (rotateX is positive downward).
  const aimDeg = -((gait.aim ?? 0) * 180) / Math.PI;
  const aimPivot = add(targets.hip, vec3(0, s.spine, 0));
  const aimed = (v: Vec3) => (aimDeg === 0 ? v : add(aimPivot, rotateX(sub(v, aimPivot), aimDeg)));
  const aimedDir = (v: Vec3) => (aimDeg === 0 ? v : rotateX(v, aimDeg));
  const bladeDir = aimedDir(rotateEuler(vec3(0, 0, 1), targets.rightHand.rotation));
  const edge = aimedDir(rotateEuler(vec3(0, -1, 0), targets.rightHand.rotation));
  // The hands are where the Motion puts them, reached from the Motion's own hip target...
  const motionBody = upperBody(targets.hip);
  const grip = weapon.grip === 'twoHanded' ? weapon.offHandGrip : undefined;
  const free = gait.offHandFree ?? 0;
  let rightTarget = aimed(targets.rightHand.position);
  if (grip) {
    // ...except that a two-handed Weapon yields to the off hand's reach.
    const spot = offHandSpot(rightTarget, bladeDir, edge, grip);
    rightTarget = add(rightTarget, scale(offHandPull(motionBody.leftShoulder, spot, s.upperArm + s.forearm), 1 - free));
  }
  const [motionRightElbow, rightHand] = twoBoneIk(motionBody.rightShoulder, rightTarget, s.upperArm, s.forearm, rightPole);
  const leftTarget = grip ? (free === 0 ? offHandSpot(rightHand, bladeDir, edge, grip) : lerp(offHandSpot(rightHand, bladeDir, edge, grip), aimed(targets.leftHand.position), free)) : aimed(targets.leftHand.position);
  const [motionLeftElbow, leftHand] = twoBoneIk(motionBody.leftShoulder, leftTarget, s.upperArm, s.forearm, leftPole);
  // ...and when the Gait shifts or turns the pelvis, the arms re-bend from the moved shoulders to those same hands.
  const { sideways, drop, twist = 0 } = gait.hipShift;
  const shifted = sideways !== 0 || drop !== 0 || twist !== 0;
  const pelvis = shifted ? add(targets.hip, vec3(sideways, -drop, 0)) : targets.hip;
  const { chest, head, rightShoulder, leftShoulder } = shifted ? upperBody(pelvis, twist / 2) : motionBody;
  const rightElbow = shifted ? twoBoneIk(rightShoulder, rightHand, s.upperArm, s.forearm, rightPole)[0] : motionRightElbow;
  const leftElbow = shifted ? twoBoneIk(leftShoulder, leftHand, s.upperArm, s.forearm, leftPole)[0] : motionLeftElbow;
  const { lift } = gait;
  const ground = gait.ground ?? { left: 0, right: 0 };

  // A pelvis turned by `twist` brings the right hip forward (rotateY turns +x toward -z, so it turns the other way).
  const halfHip = rotateY(vec3(s.hipWidth / 2, 0, 0), -twist);
  const rightHip = add(pelvis, halfHip);
  const leftHip = sub(pelvis, halfHip);
  const knee = vec3(0, 0, 1);
  // A Motion that owns the right foot (a Kick) sets the ankle itself; otherwise it stands on the ground under the foot.
  const rAnkleTarget = targets.kickFoot ?? vec3(targets.rightFoot.x, ground.right + s.ankleHeight + lift.right, targets.rightFoot.z);
  const lAnkleTarget = vec3(targets.leftFoot.x, ground.left + s.ankleHeight + lift.left, targets.leftFoot.z);
  const [rightKnee, rightAnkle] = twoBoneIk(rightHip, rAnkleTarget, s.thigh, s.shin, knee);
  const [leftKnee, leftAnkle] = twoBoneIk(leftHip, lAnkleTarget, s.thigh, s.shin, knee);
  // The toe rises with the foot's lift: on the floor when planted (even if the leg falls short of it), raised mid-step,
  // and pitched about the ankle as the foot rolls (never below the floor).
  const pitch = gait.pitch ?? { left: 0, right: 0 };
  const toe = (ankle: Vec3, floor: number, footLift: number, footPitch: number) => {
    const flat = vec3(ankle.x, floor + footLift, ankle.z + TOE_LENGTH);
    if (footPitch === 0) return flat;
    const rolled = add(ankle, rotateX(sub(flat, ankle), -footPitch));
    return { ...rolled, y: Math.max(rolled.y, floor) };
  };
  // A foot the Motion owns points along the shin instead.
  const kickToe = add(rightAnkle, scale(normalize(sub(rightAnkle, rightKnee), vec3(0, 0, 1)), TOE_LENGTH));

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
    leftToe: toe(leftAnkle, ground.left, lift.left, pitch.left),
    rightHip,
    rightKnee,
    rightAnkle,
    rightToe: targets.kickFoot ? kickToe : toe(rightAnkle, ground.right, lift.right, pitch.right),
  };

  // The whole body laid back: every joint (and the Weapon) swings about the pivot under the pelvis (on the ground unless raised), then drops.
  const { tilt, drop: bodyDrop, pivot: pivotHeight = 0 } = targets.body ?? { tilt: 0, drop: 0 };
  const laid = tilt !== 0 || bodyDrop !== 0;
  const pivot = vec3(pelvis.x, pivotHeight, pelvis.z);
  const lay = (v: Vec3): Vec3 => {
    const r = add(pivot, rotateX(sub(v, pivot), -tilt));
    return { x: r.x, y: r.y - bodyDrop, z: r.z };
  };
  const layDir = (v: Vec3): Vec3 => (tilt === 0 ? v : rotateX(v, -tilt));
  if (laid) for (const name of JOINT_NAMES) local[name] = lay(local[name]);
  const bladeTip = laid ? add(local.rightHand, scale(layDir(bladeDir), weapon.length)) : add(rightHand, scale(bladeDir, weapon.length));

  // Fighter-local → world. Facing f: forward = (sin f, 0, cos f), right = (-cos f, 0, sin f).
  const c = Math.cos(at.facing);
  const sn = Math.sin(at.facing);
  const dirToWorld = (v: Vec3): Vec3 => ({ x: -v.x * c + v.z * sn, y: v.y, z: v.x * sn + v.z * c });
  const y0 = at.y ?? 0;
  const toWorld = (v: Vec3): Vec3 => {
    const d = dirToWorld(v);
    return { x: d.x + at.position.x, y: d.y + y0, z: d.z + at.position.z };
  };

  const joints = {} as Record<JointName, Vec3>;
  for (const name of JOINT_NAMES) joints[name] = toWorld(local[name]);
  return {
    joints,
    blade: {
      hilt: joints.rightHand,
      tip: toWorld(bladeTip),
      edge: dirToWorld(layDir(edge)),
    },
  };
}
