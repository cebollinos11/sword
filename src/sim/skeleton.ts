/**
 * The Skeleton: a fixed hierarchy of joints built from primitives, solved
 * from Pose Key targets by analytic two-bone IK (arms and legs) plus a
 * twisting/leaning spine. Pure math, run inside the Tick (ADR 0001).
 */
import type { OffHandGrip, SkeletonTuning, WeaponTuning } from '../tuning';
import type { PoseTargets } from './motion';
import type { Vec2 } from './state';
import { add, cross, length, scale, sub, vec3, type Vec3 } from './vec';

const DEG = Math.PI / 180;

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

/**
 * Two-bone IK. Returns [middle joint, end joint]. The end reaches `target`
 * when it is within reach; otherwise the chain points straight at it. The
 * middle joint bends toward `pole`.
 */
export function twoBoneIk(root: Vec3, target: Vec3, l1: number, l2: number, pole: Vec3): [Vec3, Vec3] {
  ik(root.x, root.y, root.z, target.x, target.y, target.z, l1, l2, pole.x, pole.y, pole.z);
  return [vec3(midX, midY, midZ), vec3(endX, endY, endZ)];
}

// The solve below runs for every Fighter every Tick, so it works on plain numbers: each helper leaves its result in these
// (always written before they are read; nothing is carried from one solve to the next) instead of making a vector. Every
// operation is the one the vector form did, in the same order, so the pose is the same to the last bit.
/** `ik`'s middle and end joints. */
let midX = 0;
let midY = 0;
let midZ = 0;
let endX = 0;
let endY = 0;
let endZ = 0;
/** The last vector `spine`, `handTurned` or `spot` worked out. */
let outX = 0;
let outY = 0;
let outZ = 0;

/** `twoBoneIk` on plain numbers: the middle joint is left in `mid*`, the end joint in `end*`. */
function ik(rx: number, ry: number, rz: number, tx: number, ty: number, tz: number, l1: number, l2: number, px: number, py: number, pz: number): void {
  // toTarget = target - root; dir = normalize(toTarget, down)
  const ax = tx - rx;
  const ay = ty - ry;
  const az = tz - rz;
  const reach = Math.sqrt(ax * ax + ay * ay + az * az);
  let dx = 0;
  let dy = -1;
  let dz = 0;
  if (reach > 1e-9) {
    const inv = 1 / reach;
    dx = ax * inv;
    dy = ay * inv;
    dz = az * inv;
  }
  const minD = Math.abs(l1 - l2) + 1e-6;
  const maxD = l1 + l2;
  const d = Math.min(Math.max(reach, minD), maxD);
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  // Bend direction: the pole with its component along the chain removed.
  const along = px * dx + py * dy + pz * dz;
  let bx = px - dx * along;
  let by = py - dy * along;
  let bz = pz - dz * along;
  if (Math.sqrt(bx * bx + by * by + bz * bz) < 1e-9) {
    if (Math.abs(dy) < 0.9) {
      bx = 0;
      by = 1;
      bz = 0;
    } else {
      bx = 0;
      by = 0;
      bz = 1;
    }
  }
  const bendLength = Math.sqrt(bx * bx + by * by + bz * bz);
  if (bendLength > 1e-9) {
    const inv = 1 / bendLength;
    bx = bx * inv;
    by = by * inv;
    bz = bz * inv;
  } else {
    bx = 0;
    by = 1;
    bz = 0;
  }
  const k1 = l1 * cosA;
  const k2 = l1 * Math.sqrt(1 - cosA * cosA);
  midX = rx + (dx * k1 + bx * k2);
  midY = ry + (dy * k1 + by * k2);
  midZ = rz + (dz * k1 + bz * k2);
  endX = rx + dx * d;
  endY = ry + dy * d;
  endZ = rz + dz * d;
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

/** Which way the sword arm's elbow bends with a one-handed Weapon (Fighter-local, before the spine turns it); the off arm's is its mirror. */
const ONE_HANDED_POLE: Vec3 = { x: 0.6, y: -1, z: -0.4 };

/** `v` leaned (about x, cosine `cl` and sine `sl`) and then twisted (about y, `ct` and `st`), as the spine turns it: left in `out*`. */
function spine(x: number, y: number, z: number, cl: number, sl: number, ct: number, st: number): void {
  const y1 = y * cl - z * sl;
  const z1 = y * sl + z * cl;
  outX = x * ct + z1 * st;
  outY = y1;
  outZ = -x * st + z1 * ct;
}

/** `v` turned as the sword hand's rotation turns it (`rotateEuler`: roll about z, then pitch about x, then yaw about y): left in `out*`. */
function handTurned(x: number, y: number, z: number, cr: number, sr: number, cp: number, sp: number, cy: number, sy: number): void {
  const x1 = x * cr - y * sr;
  const y1 = x * sr + y * cr;
  const y2 = y1 * cp - z * sp;
  const z2 = y1 * sp + z * cp;
  outX = x1 * cy + z2 * sy;
  outY = y2;
  outZ = -x1 * sy + z2 * cy;
}

/** `offHandSpot` on plain numbers: left in `out*`. */
function spot(hx: number, hy: number, hz: number, ax: number, ay: number, az: number, ex: number, ey: number, ez: number, grip: OffHandGrip): void {
  const a = (grip.around * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const sideX = ex * ca + (ay * ez - az * ey) * sa;
  const sideY = ey * ca + (az * ex - ax * ez) * sa;
  const sideZ = ez * ca + (ax * ey - ay * ex) * sa;
  outX = hx - ax * grip.along + sideX * grip.radial;
  outY = hy - ay * grip.along + sideY * grip.radial;
  outZ = hz - az * grip.along + sideZ * grip.radial;
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
  // The spine leans (about x), then twists (about y): each angle's cosine and sine are worked out once for every vector it turns.
  const cl = Math.cos(targets.torso.lean * DEG);
  const sl = Math.sin(targets.torso.lean * DEG);
  const ct = Math.cos((targets.torso.twist + 0) * DEG);
  const st = Math.sin((targets.torso.twist + 0) * DEG);
  const halfShoulder = s.shoulderWidth / 2;
  const hip = targets.hip;
  // Elbows bend down and back, out of the way of a one-handed sword; both hands on a two-handed grip in front of the body
  // bend them down and out instead, so the forearms reach round the body to the grip rather than through it.
  const twoHanded = weapon.grip === 'twoHanded';
  const pole = twoHanded ? TWO_HANDED_POLE : ONE_HANDED_POLE;
  spine(pole.x, pole.y, pole.z, cl, sl, ct, st);
  const rightPoleX = outX;
  const rightPoleY = outY;
  const rightPoleZ = outZ;
  // The off arm's pole is the sword arm's mirrored in x.
  spine(-pole.x, pole.y, pole.z, cl, sl, ct, st);
  const leftPoleX = outX;
  const leftPoleY = outY;
  const leftPoleZ = outZ;
  // Aiming up/down swings hands and Weapon about the chest (rotateX is positive downward).
  const aimDeg = -((gait.aim ?? 0) * 180) / Math.PI;
  const aiming = aimDeg !== 0;
  const pivotX = hip.x + 0;
  const pivotY = hip.y + s.spine;
  const pivotZ = hip.z + 0;
  const ca = Math.cos(aimDeg * DEG);
  const sa = Math.sin(aimDeg * DEG);
  // The Weapon's axis and edge: the sword hand's rotation, then the aim.
  const rotation = targets.rightHand.rotation;
  const cr = Math.cos(rotation.z * DEG);
  const sr = Math.sin(rotation.z * DEG);
  const cp = Math.cos(rotation.x * DEG);
  const sp = Math.sin(rotation.x * DEG);
  const cy = Math.cos(rotation.y * DEG);
  const sy = Math.sin(rotation.y * DEG);
  handTurned(0, 0, 1, cr, sr, cp, sp, cy, sy);
  const bladeX = outX;
  const bladeY = aiming ? outY * ca - outZ * sa : outY;
  const bladeZ = aiming ? outY * sa + outZ * ca : outZ;
  handTurned(0, -1, 0, cr, sr, cp, sp, cy, sy);
  const edgeX = outX;
  const edgeY = aiming ? outY * ca - outZ * sa : outY;
  const edgeZ = aiming ? outY * sa + outZ * ca : outZ;
  // The hands are where the Motion puts them, reached from the Motion's own hip target: the chest, head and shoulders on that pelvis...
  spine(0, s.spine, 0, cl, sl, ct, st);
  let chestX = hip.x + outX;
  let chestY = hip.y + outY;
  let chestZ = hip.z + outZ;
  spine(0, s.neck + s.headRadius, 0, cl, sl, ct, st);
  let headX = chestX + outX;
  let headY = chestY + outY;
  let headZ = chestZ + outZ;
  spine(halfShoulder, 0, 0, cl, sl, ct, st);
  let rightShoulderX = chestX + outX;
  let rightShoulderY = chestY + outY;
  let rightShoulderZ = chestZ + outZ;
  spine(-halfShoulder, 0, 0, cl, sl, ct, st);
  let leftShoulderX = chestX + outX;
  let leftShoulderY = chestY + outY;
  let leftShoulderZ = chestZ + outZ;
  const grip = twoHanded ? weapon.offHandGrip : undefined;
  const free = gait.offHandFree ?? 0;
  // The sword hand's target, aimed (swung about the chest).
  const right = targets.rightHand.position;
  let rightTargetX = right.x;
  let rightTargetY = right.y;
  let rightTargetZ = right.z;
  if (aiming) {
    const dy = right.y - pivotY;
    const dz = right.z - pivotZ;
    rightTargetX = pivotX + (right.x - pivotX);
    rightTargetY = pivotY + (dy * ca - dz * sa);
    rightTargetZ = pivotZ + (dy * sa + dz * ca);
  }
  if (grip) {
    // ...except that a two-handed Weapon yields to the off hand's reach (`offHandPull`: straight toward the off shoulder, by however far the spot is out of reach).
    spot(rightTargetX, rightTargetY, rightTargetZ, bladeX, bladeY, bladeZ, edgeX, edgeY, edgeZ, grip);
    const toX = leftShoulderX - outX;
    const toY = leftShoulderY - outY;
    const toZ = leftShoulderZ - outZ;
    const d = Math.sqrt(toX * toX + toY * toY + toZ * toZ);
    const reach = s.upperArm + s.forearm;
    const out = d <= reach;
    const pull = (d - reach) / d;
    rightTargetX = rightTargetX + (out ? 0 : toX * pull) * (1 - free);
    rightTargetY = rightTargetY + (out ? 0 : toY * pull) * (1 - free);
    rightTargetZ = rightTargetZ + (out ? 0 : toZ * pull) * (1 - free);
  }
  ik(rightShoulderX, rightShoulderY, rightShoulderZ, rightTargetX, rightTargetY, rightTargetZ, s.upperArm, s.forearm, rightPoleX, rightPoleY, rightPoleZ);
  let rightElbowX = midX;
  let rightElbowY = midY;
  let rightElbowZ = midZ;
  const rightHandX = endX;
  const rightHandY = endY;
  const rightHandZ = endZ;
  // The off hand's target: its Pose Key's, aimed; or the Off-hand Grip on the Weapon where the sword hand got to; or, letting go, between the two.
  let leftTargetX = 0;
  let leftTargetY = 0;
  let leftTargetZ = 0;
  if (!grip || free !== 0) {
    const left = targets.leftHand.position;
    leftTargetX = left.x;
    leftTargetY = left.y;
    leftTargetZ = left.z;
    if (aiming) {
      const dy = left.y - pivotY;
      const dz = left.z - pivotZ;
      leftTargetX = pivotX + (left.x - pivotX);
      leftTargetY = pivotY + (dy * ca - dz * sa);
      leftTargetZ = pivotZ + (dy * sa + dz * ca);
    }
  }
  if (grip) {
    spot(rightHandX, rightHandY, rightHandZ, bladeX, bladeY, bladeZ, edgeX, edgeY, edgeZ, grip);
    if (free === 0) {
      leftTargetX = outX;
      leftTargetY = outY;
      leftTargetZ = outZ;
    } else {
      leftTargetX = outX + (leftTargetX - outX) * free;
      leftTargetY = outY + (leftTargetY - outY) * free;
      leftTargetZ = outZ + (leftTargetZ - outZ) * free;
    }
  }
  ik(leftShoulderX, leftShoulderY, leftShoulderZ, leftTargetX, leftTargetY, leftTargetZ, s.upperArm, s.forearm, leftPoleX, leftPoleY, leftPoleZ);
  let leftElbowX = midX;
  let leftElbowY = midY;
  let leftElbowZ = midZ;
  const leftHandX = endX;
  const leftHandY = endY;
  const leftHandZ = endZ;
  // ...and when the Gait shifts or turns the pelvis, the arms re-bend from the moved shoulders to those same hands.
  const { sideways, drop, twist = 0 } = gait.hipShift;
  const shifted = sideways !== 0 || drop !== 0 || twist !== 0;
  let pelvisX = hip.x;
  let pelvisY = hip.y;
  let pelvisZ = hip.z;
  if (shifted) {
    pelvisX = hip.x + sideways;
    pelvisY = hip.y + -drop;
    pelvisZ = hip.z + 0;
    // The spine turned a further half of the pelvis's twist.
    const ct2 = Math.cos((targets.torso.twist + twist / 2) * DEG);
    const st2 = Math.sin((targets.torso.twist + twist / 2) * DEG);
    spine(0, s.spine, 0, cl, sl, ct2, st2);
    chestX = pelvisX + outX;
    chestY = pelvisY + outY;
    chestZ = pelvisZ + outZ;
    spine(0, s.neck + s.headRadius, 0, cl, sl, ct2, st2);
    headX = chestX + outX;
    headY = chestY + outY;
    headZ = chestZ + outZ;
    spine(halfShoulder, 0, 0, cl, sl, ct2, st2);
    rightShoulderX = chestX + outX;
    rightShoulderY = chestY + outY;
    rightShoulderZ = chestZ + outZ;
    spine(-halfShoulder, 0, 0, cl, sl, ct2, st2);
    leftShoulderX = chestX + outX;
    leftShoulderY = chestY + outY;
    leftShoulderZ = chestZ + outZ;
    ik(rightShoulderX, rightShoulderY, rightShoulderZ, rightHandX, rightHandY, rightHandZ, s.upperArm, s.forearm, rightPoleX, rightPoleY, rightPoleZ);
    rightElbowX = midX;
    rightElbowY = midY;
    rightElbowZ = midZ;
    ik(leftShoulderX, leftShoulderY, leftShoulderZ, leftHandX, leftHandY, leftHandZ, s.upperArm, s.forearm, leftPoleX, leftPoleY, leftPoleZ);
    leftElbowX = midX;
    leftElbowY = midY;
    leftElbowZ = midZ;
  }
  const { lift } = gait;
  const groundLeft = gait.ground ? gait.ground.left : 0;
  const groundRight = gait.ground ? gait.ground.right : 0;

  // A pelvis turned by `twist` brings the right hip forward (rotateY turns +x toward -z, so it turns the other way).
  const halfWidth = s.hipWidth / 2;
  const ch = Math.cos(-twist * DEG);
  const sh = Math.sin(-twist * DEG);
  const halfHipX = halfWidth * ch + 0 * sh;
  const halfHipY = 0;
  const halfHipZ = -halfWidth * sh + 0 * ch;
  const rightHipX = pelvisX + halfHipX;
  const rightHipY = pelvisY + halfHipY;
  const rightHipZ = pelvisZ + halfHipZ;
  const leftHipX = pelvisX - halfHipX;
  const leftHipY = pelvisY - halfHipY;
  const leftHipZ = pelvisZ - halfHipZ;
  // A Motion that owns the right foot (a Kick) sets the ankle itself; otherwise it stands on the ground under the foot. The knees bend forward.
  const kick = targets.kickFoot;
  if (kick) ik(rightHipX, rightHipY, rightHipZ, kick.x, kick.y, kick.z, s.thigh, s.shin, 0, 0, 1);
  else ik(rightHipX, rightHipY, rightHipZ, targets.rightFoot.x, groundRight + s.ankleHeight + lift.right, targets.rightFoot.z, s.thigh, s.shin, 0, 0, 1);
  const rightKneeX = midX;
  const rightKneeY = midY;
  const rightKneeZ = midZ;
  const rightAnkleX = endX;
  const rightAnkleY = endY;
  const rightAnkleZ = endZ;
  ik(leftHipX, leftHipY, leftHipZ, targets.leftFoot.x, groundLeft + s.ankleHeight + lift.left, targets.leftFoot.z, s.thigh, s.shin, 0, 0, 1);
  const leftKneeX = midX;
  const leftKneeY = midY;
  const leftKneeZ = midZ;
  const leftAnkleX = endX;
  const leftAnkleY = endY;
  const leftAnkleZ = endZ;
  // The toe rises with the foot's lift: on the floor when planted (even if the leg falls short of it), raised mid-step,
  // and pitched about the ankle as the foot rolls (never below the floor).
  const pitchLeft = gait.pitch ? gait.pitch.left : 0;
  const pitchRight = gait.pitch ? gait.pitch.right : 0;
  let leftToeX = leftAnkleX;
  let leftToeY = groundLeft + lift.left;
  let leftToeZ = leftAnkleZ + TOE_LENGTH;
  if (pitchLeft !== 0) {
    const c = Math.cos(-pitchLeft * DEG);
    const sn = Math.sin(-pitchLeft * DEG);
    const dy = leftToeY - leftAnkleY;
    const dz = leftToeZ - leftAnkleZ;
    leftToeX = leftAnkleX + (leftToeX - leftAnkleX);
    leftToeY = Math.max(leftAnkleY + (dy * c - dz * sn), groundLeft);
    leftToeZ = leftAnkleZ + (dy * sn + dz * c);
  }
  let rightToeX = rightAnkleX;
  let rightToeY = groundRight + lift.right;
  let rightToeZ = rightAnkleZ + TOE_LENGTH;
  if (kick) {
    // A foot the Motion owns points along the shin instead.
    const ax = rightAnkleX - rightKneeX;
    const ay = rightAnkleY - rightKneeY;
    const az = rightAnkleZ - rightKneeZ;
    const shin = Math.sqrt(ax * ax + ay * ay + az * az);
    let dx = 0;
    let dy = 0;
    let dz = 1;
    if (shin > 1e-9) {
      const inv = 1 / shin;
      dx = ax * inv;
      dy = ay * inv;
      dz = az * inv;
    }
    rightToeX = rightAnkleX + dx * TOE_LENGTH;
    rightToeY = rightAnkleY + dy * TOE_LENGTH;
    rightToeZ = rightAnkleZ + dz * TOE_LENGTH;
  } else if (pitchRight !== 0) {
    const c = Math.cos(-pitchRight * DEG);
    const sn = Math.sin(-pitchRight * DEG);
    const dy = rightToeY - rightAnkleY;
    const dz = rightToeZ - rightAnkleZ;
    rightToeX = rightAnkleX + (rightToeX - rightAnkleX);
    rightToeY = Math.max(rightAnkleY + (dy * c - dz * sn), groundRight);
    rightToeZ = rightAnkleZ + (dy * sn + dz * c);
  }

  // The whole body laid back: every joint (and the Weapon) swings about the pivot under the pelvis (on the ground unless raised), then drops.
  const body = targets.body;
  const tilt = body ? body.tilt : 0;
  const bodyDrop = body ? body.drop : 0;
  // Fighter-local → world. Facing f: forward = (sin f, 0, cos f), right = (-cos f, 0, sin f).
  const c = Math.cos(at.facing);
  const sn = Math.sin(at.facing);
  placeLaid = tilt !== 0 || bodyDrop !== 0;
  placePivotX = pelvisX;
  placePivotY = body ? (body.pivot ?? 0) : 0;
  placePivotZ = pelvisZ;
  placeTiltCos = Math.cos(-tilt * DEG);
  placeTiltSin = Math.sin(-tilt * DEG);
  placeDrop = bodyDrop;
  placeCos = c;
  placeSin = sn;
  placeX = at.position.x;
  placeY = at.y ?? 0;
  placeZ = at.position.z;

  const joints: Record<JointName, Vec3> = {
    pelvis: place(pelvisX, pelvisY, pelvisZ),
    chest: place(chestX, chestY, chestZ),
    head: place(headX, headY, headZ),
    leftShoulder: place(leftShoulderX, leftShoulderY, leftShoulderZ),
    leftElbow: place(leftElbowX, leftElbowY, leftElbowZ),
    leftHand: place(leftHandX, leftHandY, leftHandZ),
    rightShoulder: place(rightShoulderX, rightShoulderY, rightShoulderZ),
    rightElbow: place(rightElbowX, rightElbowY, rightElbowZ),
    rightHand: place(rightHandX, rightHandY, rightHandZ),
    leftHip: place(leftHipX, leftHipY, leftHipZ),
    leftKnee: place(leftKneeX, leftKneeY, leftKneeZ),
    leftAnkle: place(leftAnkleX, leftAnkleY, leftAnkleZ),
    leftToe: place(leftToeX, leftToeY, leftToeZ),
    rightHip: place(rightHipX, rightHipY, rightHipZ),
    rightKnee: place(rightKneeX, rightKneeY, rightKneeZ),
    rightAnkle: place(rightAnkleX, rightAnkleY, rightAnkleZ),
    rightToe: place(rightToeX, rightToeY, rightToeZ),
  };
  // The blade runs from the sword hand (laid with the body) along the Weapon's axis, which a tilted body turns with it; so does its edge.
  const turned = tilt !== 0;
  const axisY = turned ? bladeY * placeTiltCos - bladeZ * placeTiltSin : bladeY;
  const axisZ = turned ? bladeY * placeTiltSin + bladeZ * placeTiltCos : bladeZ;
  let tipX = rightHandX + bladeX * weapon.length;
  let tipY = rightHandY + bladeY * weapon.length;
  let tipZ = rightHandZ + bladeZ * weapon.length;
  if (placeLaid) {
    lay(rightHandX, rightHandY, rightHandZ);
    tipX = outX + bladeX * weapon.length;
    tipY = outY + axisY * weapon.length;
    tipZ = outZ + axisZ * weapon.length;
  }
  const laidEdgeY = turned ? edgeY * placeTiltCos - edgeZ * placeTiltSin : edgeY;
  const laidEdgeZ = turned ? edgeY * placeTiltSin + edgeZ * placeTiltCos : edgeZ;
  return {
    joints,
    blade: {
      hilt: joints.rightHand,
      tip: { x: -tipX * c + tipZ * sn + placeX, y: tipY + placeY, z: tipX * sn + tipZ * c + placeZ },
      edge: { x: -edgeX * c + laidEdgeZ * sn, y: laidEdgeY, z: edgeX * sn + laidEdgeZ * c },
    },
  };
}

// How `place` puts a Fighter-local point in the world: set by each solve before it places its joints.
let placeLaid = false;
let placePivotX = 0;
let placePivotY = 0;
let placePivotZ = 0;
let placeTiltCos = 1;
let placeTiltSin = 0;
let placeDrop = 0;
let placeCos = 1;
let placeSin = 0;
let placeX = 0;
let placeY = 0;
let placeZ = 0;

/** A point of a body laid back: swung about the pivot by the tilt, then dropped. Left in `out*`. */
function lay(x: number, y: number, z: number): void {
  const dy = y - placePivotY;
  const dz = z - placePivotZ;
  outX = placePivotX + (x - placePivotX);
  outY = placePivotY + (dy * placeTiltCos - dz * placeTiltSin) - placeDrop;
  outZ = placePivotZ + (dy * placeTiltSin + dz * placeTiltCos);
}

/** A Fighter-local joint in the world: laid back with the body if it is, then turned to the facing and moved to the placement. */
function place(x: number, y: number, z: number): Vec3 {
  if (placeLaid) {
    lay(x, y, z);
    x = outX;
    y = outY;
    z = outZ;
  }
  return { x: -x * placeCos + z * placeSin + placeX, y: y + placeY, z: x * placeSin + z * placeCos + placeZ };
}
