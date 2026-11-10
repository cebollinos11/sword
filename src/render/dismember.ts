/**
 * Dismemberment: which bones the cut recorded in a Death severs, and which piece of the body each joint then belongs to.
 * Like the Death Ragdoll it lives outside the Simulation (ADR 0024) and never changes an outcome: a pure function of the
 * blow and the pose the Fighter fell in, so scrubbing, replays and Rollback all sever the same bones.
 *
 * The cut is a plane: the one the blade was moving in when it struck. Of that plane only the part the blade passes
 * through cuts: the blade as it struck, carried on along its travel (Tuning Data `fighter.dismember`). A bone whose
 * axis crosses the plane there is severed.
 */
import { JOINT_NAMES, type DeathBlow, type JointName, type SkeletonPose, type Vec3 } from '../sim';
import type { HitZone, TuningData } from '../tuning';

/** A severed bone: where its axis is cut, and the cut plane's normal (the blade's axis crossed with its travel; the same for every bone of one cut). */
export interface Severed {
  readonly bone: readonly [JointName, JointName];
  readonly at: Vec3;
  readonly normal: Vec3;
}

/** The bones a cut can sever (as in `BONES`, parent to child), each with the Hit Zone whose radius is its thickness. */
const SEVERABLE: readonly (readonly [JointName, JointName, HitZone])[] = [
  ['pelvis', 'chest', 'torso'],
  ['chest', 'head', 'head'],
  ['leftShoulder', 'leftElbow', 'limbs'],
  ['leftElbow', 'leftHand', 'limbs'],
  ['rightShoulder', 'rightElbow', 'limbs'],
  ['rightElbow', 'rightHand', 'limbs'],
  ['leftHip', 'leftKnee', 'legs'],
  ['leftKnee', 'leftAnkle', 'legs'],
  ['rightHip', 'rightKnee', 'legs'],
  ['rightKnee', 'rightAnkle', 'legs'],
];
/** A cut stays this share of the bone's length off each joint, so it never lands exactly on an elbow or knee. */
const OFF_JOINT = 0.1;
/** A bone lying closer to the cut plane than this (the sine of the angle between them) is not severed: the blade ran along it. */
const MIN_CROSSING = 0.3;

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const along = (a: Vec3, d: Vec3, k: number): Vec3 => ({ x: a.x + d.x * k, y: a.y + d.y * k, z: a.z + d.z * k });
const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);

/** Distance from `p` to the segment a→b. */
function toSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-12 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
  return length(sub(p, along(a, ab, t)));
}

/** Distance from `p` (in the parallelogram's plane) to the parallelogram at `o` spanned by `u` and `v`: 0 inside it. */
function toParallelogram(p: Vec3, o: Vec3, u: Vec3, v: Vec3): number {
  const d = sub(p, o);
  const uu = dot(u, u);
  const uv = dot(u, v);
  const vv = dot(v, v);
  const det = uu * vv - uv * uv;
  if (det > 1e-12) {
    const s = (dot(d, u) * vv - dot(d, v) * uv) / det;
    const t = (dot(d, v) * uu - dot(d, u) * uv) / det;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) return 0;
  }
  const ou = along(o, u, 1);
  const ov = along(o, v, 1);
  const far = along(ou, v, 1);
  return Math.min(toSegment(p, o, ou), toSegment(p, o, ov), toSegment(p, ou, far), toSegment(p, ov, far));
}

/**
 * The bones the felling `blow` severs on a Fighter that fell in `pose`, nearest to the contact first and at most
 * `fighter.dismember.maxCuts`; none when the blow did not cut, or its cut crossed no bone (the body then falls whole).
 * `tuning` is the Fighter's own (`sizedTuning`): its Hit Zone radii are how thick its bones are.
 */
export function severing(pose: SkeletonPose, blow: DeathBlow | null, tuning: TuningData): Severed[] {
  const cut = blow?.cut;
  if (!cut) return [];
  const blade = sub(cut.tip, cut.hilt);
  const across = cross(blade, cut.travel);
  const size = length(across);
  if (size < 1e-9) return [];
  const normal = { x: across.x / size, y: across.y / size, z: across.z / size };
  const { carry, speed, maxCuts } = tuning.fighter.dismember;
  const reach = along({ x: 0, y: 0, z: 0 }, cut.travel, carry * (blow.bladeSpeed / speed));
  const { neck, headRadius } = tuning.skeleton;

  const found: { severed: Severed; far: number }[] = [];
  for (const [a, b, zone] of SEVERABLE) {
    const from = pose.joints[a];
    const bone = sub(pose.joints[b], from);
    const before = dot(sub(from, cut.hilt), normal);
    const rise = dot(bone, normal);
    // The head joint is the middle of the head: the neck's bone is cut as far up as the top of the head, and a cut
    // through the head takes it off at the neck.
    const end = a === 'chest' ? (neck + 2 * headRadius) / (neck + headRadius) : 1;
    const last = a === 'chest' ? Math.min(1 - OFF_JOINT, neck / (neck + headRadius)) : 1 - OFF_JOINT;
    // The plane must pass between the bone's ends, and not nearly along it.
    if (before * (before + rise * end) >= 0 || Math.abs(rise) < MIN_CROSSING * length(bone)) continue;
    const t = -before / rise;
    const crossing = along(from, bone, t);
    if (toParallelogram(crossing, cut.hilt, blade, reach) > tuning.hitZones[zone].radius) continue;
    found.push({ severed: { bone: [a, b], at: along(from, bone, Math.min(last, Math.max(OFF_JOINT, t))), normal }, far: length(sub(crossing, blow.point)) });
  }
  return found
    .sort((p, q) => p.far - q.far)
    .slice(0, maxCuts)
    .map((f) => f.severed);
}

/**
 * How the Skeleton holds together besides its severable bones: the shoulders ride on the chest, the hips on the pelvis
 * and the feet on the ankles.
 */
const WHOLE: readonly (readonly [JointName, JointName])[] = [
  ['chest', 'leftShoulder'],
  ['chest', 'rightShoulder'],
  ['pelvis', 'leftHip'],
  ['pelvis', 'rightHip'],
  ['leftAnkle', 'leftToe'],
  ['rightAnkle', 'rightToe'],
];

/**
 * Which piece of the body each joint belongs to once `severed` are cut: piece 0 is the one with the pelvis, the others
 * are numbered in joint order (`JOINT_NAMES`). Nothing severed: one piece, 0.
 */
export function pieceOf(severed: readonly Severed[]): Record<JointName, number> {
  const cutBone = (a: JointName, b: JointName) => severed.some((s) => s.bone[0] === a && s.bone[1] === b);
  const links = [...SEVERABLE.filter(([a, b]) => !cutBone(a, b)), ...WHOLE];
  const piece = {} as Record<JointName, number>;
  let next = 0;
  for (const root of JOINT_NAMES) {
    if (piece[root] !== undefined) continue;
    const n = next++;
    const open: JointName[] = [root];
    piece[root] = n;
    while (open.length > 0) {
      const j = open.pop()!;
      for (const [a, b] of links) {
        const other = a === j ? b : b === j ? a : undefined;
        if (other !== undefined && piece[other] === undefined) {
          piece[other] = n;
          open.push(other);
        }
      }
    }
  }
  return piece;
}

/**
 * The body in pieces as the Death Ragdoll's particles: `piece` as `pieceOf`, and each piece's particles. A joint's
 * particle is its place in `JOINT_NAMES`; the two cut ends of `severed[k]` are `stumpsFrom + 2 * k` (on the side of its
 * bone's first joint) and the one after (on the side of its second).
 */
export function piecesOf(severed: readonly Severed[], stumpsFrom: number): { piece: Record<JointName, number>; pieces: number[][] } {
  const piece = pieceOf(severed);
  const pieces: number[][] = [];
  JOINT_NAMES.forEach((n, i) => (pieces[piece[n]] ??= []).push(i));
  severed.forEach(({ bone }, k) => bone.forEach((n, side) => pieces[piece[n]]!.push(stumpsFrom + 2 * k + side)));
  return { piece, pieces };
}
