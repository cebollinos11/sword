/**
 * The Death Ragdoll: a fallen Fighter's Skeleton goes limp and drops under
 * gravity, knocked away by the blow that felled it, and its hand lets go of
 * the Weapon, which falls on its own. Like impact effects it lives outside the
 * Simulation (ADR 0001) and never changes an outcome; but it is a pure function
 * of the pose the Fighter fell in, its Death and the time since, so scrubbing,
 * replays and Rollback all draw the same fall.
 *
 * Verlet particles, one per joint plus three on the Weapon, held together by
 * distance constraints: the torso and head are rigid, the limbs hinge freely
 * (but cannot fold flat), and everything lands on the Arena's Walk Surfaces: each particle on
 * the highest one under it, so a body that falls off a ledge drops to the floor below.
 */
import { groundBelow, JOINT_NAMES, type Death, type JointName, type SkeletonPose, type Vec3 } from '../sim';
import type { ArenaGeometry, TuningData, WeaponTuning } from '../tuning';

/** Simulation step and how long the fall is simulated before it is left lying still (seconds). */
const STEP = 1 / 120;
const SETTLE_SECONDS = 4;
const ITERATIONS = 6;
const GRAVITY = 9.81;
/** Velocity kept per step in the air, and the share of sliding speed lost per step on the floor. */
const AIR_DRAG = 0.998;
const FLOOR_FRICTION = 0.25;
/** How hard the felling blow knocks the body: speed per m/s of Blade Speed, capped (m/s). */
const BLOW_PUSH = 0.22;
const MAX_PUSH = 3.2;
/** How far from the contact point the blow still pushes (m). */
const BLOW_REACH = 0.5;
/** Without a known blow, the body still tips backwards this fast (m/s). */
const SLUMP = 0.6;
/** The knees buckle forward this fast as the legs give way (m/s). */
const BUCKLE = 0.8;
/** How the hand flings the Weapon away as it lets go: along the blow, up, and spinning (m/s). */
const TOSS_ALONG = 0.6;
const TOSS_UP = 1.2;
const TOSS_SPIN = 2.5;

/** Weapon particles after the joints: butt (pommel end), tip, and one off the edge to keep it from rolling freely. */
const BUTT = JOINT_NAMES.length;
const TIP = BUTT + 1;
const EDGE = BUTT + 2;
const COUNT = EDGE + 1;
const EDGE_OFFSET = 0.08;

const J = Object.fromEntries(JOINT_NAMES.map((n, i) => [n, i])) as Record<JointName, number>;

/** Resting height of each particle's centre above the floor: how thick that part of the body is drawn (m). */
function radii(tuning: TuningData): Float64Array {
  const r = new Float64Array(COUNT).fill(0.05);
  r[J.pelvis] = r[J.chest] = 0.12;
  r[J.head] = tuning.skeleton.headRadius;
  r[J.leftToe] = r[J.rightToe] = 0.04;
  r[BUTT] = r[TIP] = r[EDGE] = 0.015;
  return r;
}

interface Constraint {
  readonly a: number;
  readonly b: number;
  /** Rest length, or the shortest it may get for a `min` constraint. */
  readonly length: number;
  /** Only pushes apart (stops a limb folding flat), never pulls together. */
  readonly min: boolean;
}

const TORSO: JointName[] = ['pelvis', 'chest', 'leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'];
const LIMBS: [JointName, JointName][] = [
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftHand'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightHand'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
  // The feet stay rigid.
  ['leftAnkle', 'leftToe'],
  ['leftKnee', 'leftToe'],
  ['rightAnkle', 'rightToe'],
  ['rightKnee', 'rightToe'],
  // The head sits rigidly on the shoulders.
  ['head', 'chest'],
  ['head', 'leftShoulder'],
  ['head', 'rightShoulder'],
];
/** Each limb's ends keep at least this share of their starting distance, so elbows and knees bend but never fold flat. */
const FOLDS: [JointName, JointName, number][] = [
  ['leftShoulder', 'leftHand', 0.35],
  ['rightShoulder', 'rightHand', 0.35],
  ['leftHip', 'leftAnkle', 0.45],
  ['rightHip', 'rightAnkle', 0.45],
];

function dist(p: Float64Array, a: number, b: number): number {
  return Math.hypot(p[3 * a]! - p[3 * b]!, p[3 * a + 1]! - p[3 * b + 1]!, p[3 * a + 2]! - p[3 * b + 2]!);
}

function constraints(p: Float64Array): Constraint[] {
  const out: Constraint[] = [];
  const rod = (a: number, b: number, min = false, share = 1) => out.push({ a, b, length: dist(p, a, b) * share, min });
  for (let i = 0; i < TORSO.length; i++) for (let k = i + 1; k < TORSO.length; k++) rod(J[TORSO[i]!], J[TORSO[k]!]);
  for (const [a, b] of LIMBS) rod(J[a], J[b]);
  for (const [a, b, share] of FOLDS) rod(J[a], J[b], true, share);
  rod(BUTT, TIP);
  rod(BUTT, EDGE);
  rod(TIP, EDGE);
  return out;
}

/** The fall's particles in their starting places (`pos`) and one step back (`prev`, so `pos - prev` is the starting velocity per step). */
function start(pose: SkeletonPose, death: Death, weapon: WeaponTuning): { pos: Float64Array; prev: Float64Array } {
  const pos = new Float64Array(3 * COUNT);
  const set = (i: number, v: Vec3) => pos.set([v.x, v.y, v.z], 3 * i);
  JOINT_NAMES.forEach((n, i) => set(i, pose.joints[n]));
  const { hilt, tip, edge } = pose.blade;
  const axis = norm({ x: tip.x - hilt.x, y: tip.y - hilt.y, z: tip.z - hilt.z });
  const butt = { x: hilt.x - axis.x * weapon.gripLength, y: hilt.y - axis.y * weapon.gripLength, z: hilt.z - axis.z * weapon.gripLength };
  set(BUTT, butt);
  set(TIP, tip);
  const mid = { x: (butt.x + tip.x) / 2, y: (butt.y + tip.y) / 2, z: (butt.z + tip.z) / 2 };
  set(EDGE, { x: mid.x + edge.x * EDGE_OFFSET, y: mid.y + edge.y * EDGE_OFFSET, z: mid.z + edge.z * EDGE_OFFSET });

  const pelvis = pose.joints.pelvis;
  // Forward is where the feet point; the blow drives the body away from the attacker (backwards if no blow is known).
  const forward = flat(
    pose.joints.leftToe.x - pose.joints.leftAnkle.x + pose.joints.rightToe.x - pose.joints.rightAnkle.x,
    pose.joints.leftToe.z - pose.joints.leftAnkle.z + pose.joints.rightToe.z - pose.joints.rightAnkle.z,
  );
  const blow = death.blow;
  const away = blow ? flat(pelvis.x - blow.from.x, pelvis.z - blow.from.z, { x: -forward.x, y: 0, z: -forward.z }) : { x: -forward.x, y: 0, z: -forward.z };
  // The blade sweeps across the body for a Left or Right swing (a Right swing travels toward the attacker's left) and down for an Overhead.
  const across = blow?.direction === 'Right' ? 1 : blow?.direction === 'Left' ? -1 : 0;
  const push = norm({ x: away.x - across * away.z * 0.6, y: blow?.direction === 'Overhead' ? -0.4 : 0.1, z: away.z + across * away.x * 0.6 });
  const strength = blow ? Math.min(MAX_PUSH, blow.bladeSpeed * BLOW_PUSH) : SLUMP;
  const at = blow?.point ?? pose.joints.chest;

  const vel = new Float64Array(3 * COUNT);
  for (let i = 0; i < JOINT_NAMES.length; i++) {
    const d = Math.hypot(pos[3 * i]! - at.x, pos[3 * i + 1]! - at.y, pos[3 * i + 2]! - at.z);
    // The blow carries the whole body a little and the struck part most.
    const k = strength * (0.25 + 0.75 * Math.exp(-d / BLOW_REACH));
    vel[3 * i] = push.x * k;
    vel[3 * i + 1] = push.y * k;
    vel[3 * i + 2] = push.z * k;
  }
  for (const knee of [J.leftKnee, J.rightKnee]) {
    vel[3 * knee] = vel[3 * knee]! + forward.x * BUCKLE;
    vel[3 * knee + 2] = vel[3 * knee + 2]! + forward.z * BUCKLE;
  }
  // The hand lets go: the Weapon flies off with the hand's push, up, and turning end over end.
  const hand = J.rightHand;
  for (const [i, spin] of [
    [BUTT, -1],
    [TIP, 1],
    [EDGE, 0],
  ] as const) {
    vel[3 * i] = vel[3 * hand]! + push.x * TOSS_ALONG + edge.x * spin * TOSS_SPIN;
    vel[3 * i + 1] = vel[3 * hand + 1]! + TOSS_UP + edge.y * spin * TOSS_SPIN;
    vel[3 * i + 2] = vel[3 * hand + 2]! + push.z * TOSS_ALONG + edge.z * spin * TOSS_SPIN;
  }
  const prev = pos.map((v, i) => v - vel[i]! * STEP);
  return { pos, prev };
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/** A horizontal unit vector, or `fallback` when (x, z) is too short to have a direction. */
function flat(x: number, z: number, fallback: Vec3 = { x: 0, y: 0, z: 1 }): Vec3 {
  const l = Math.hypot(x, z);
  return l < 1e-6 ? fallback : { x: x / l, y: 0, z: z / l };
}

/** How far above a particle's lowest point a Walk Surface still counts as under it (m): it may have sunk in a little. */
const FLOOR_REACH = 0.3;

/** Each particle's floor: the Walk Surface under it (or y 0 with no Arena, or off its Walk Surfaces). */
function floors(p: Float64Array, radius: Float64Array, arena: ArenaGeometry | undefined, out: Float64Array): void {
  for (let i = 0; i < COUNT; i++) {
    out[i] = arena ? (groundBelow(arena, p[3 * i]!, p[3 * i + 2]!, p[3 * i + 1]! - radius[i]! + FLOOR_REACH)?.y ?? 0) : 0;
  }
}

function satisfy(p: Float64Array, cs: readonly Constraint[], radius: Float64Array, floor: Float64Array): void {
  for (let it = 0; it < ITERATIONS; it++) {
    for (const { a, b, length, min } of cs) {
      const dx = p[3 * b]! - p[3 * a]!;
      const dy = p[3 * b + 1]! - p[3 * a + 1]!;
      const dz = p[3 * b + 2]! - p[3 * a + 2]!;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-9 || (min && d >= length)) continue;
      const f = (0.5 * (d - length)) / d;
      p[3 * a] = p[3 * a]! + dx * f;
      p[3 * a + 1] = p[3 * a + 1]! + dy * f;
      p[3 * a + 2] = p[3 * a + 2]! + dz * f;
      p[3 * b] = p[3 * b]! - dx * f;
      p[3 * b + 1] = p[3 * b + 1]! - dy * f;
      p[3 * b + 2] = p[3 * b + 2]! - dz * f;
    }
    for (let i = 0; i < COUNT; i++) if (p[3 * i + 1]! < floor[i]! + radius[i]!) p[3 * i + 1] = floor[i]! + radius[i]!;
  }
}

/**
 * The Skeleton (and Weapon) of a Fighter `seconds` after it fell in `pose` (its pose on the Tick of its Death),
 * wielding `weapon`, in `arena` (default: on a flat floor at y 0). Pure and deterministic; after a few seconds the body lies still.
 */
export function ragdollPose(pose: SkeletonPose, death: Death, seconds: number, weapon: WeaponTuning, tuning: TuningData, arena?: ArenaGeometry): SkeletonPose {
  const steps = Math.round(Math.min(Math.max(seconds, 0), SETTLE_SECONDS) / STEP);
  if (steps === 0) return pose;
  const { pos, prev } = start(pose, death, weapon);
  const cs = constraints(pos);
  const radius = radii(tuning);
  const fall = GRAVITY * STEP * STEP;
  const floor = new Float64Array(COUNT);
  for (let s = 0; s < steps; s++) {
    floors(pos, radius, arena, floor);
    for (let i = 0; i < COUNT; i++) {
      const o = 3 * i;
      const onFloor = pos[o + 1]! <= floor[i]! + radius[i]! + 1e-4;
      const keep = onFloor ? 1 - FLOOR_FRICTION : AIR_DRAG;
      for (let c = 0; c < 3; c++) {
        const v = (pos[o + c]! - prev[o + c]!) * (c === 1 ? AIR_DRAG : keep);
        prev[o + c] = pos[o + c]!;
        pos[o + c] = pos[o + c]! + v - (c === 1 ? fall : 0);
      }
    }
    satisfy(pos, cs, radius, floor);
  }

  const at = (i: number): Vec3 => ({ x: pos[3 * i]!, y: pos[3 * i + 1]!, z: pos[3 * i + 2]! });
  const joints = {} as Record<JointName, Vec3>;
  JOINT_NAMES.forEach((n, i) => (joints[n] = at(i)));
  const butt = at(BUTT);
  const tip = at(TIP);
  const axis = norm({ x: tip.x - butt.x, y: tip.y - butt.y, z: tip.z - butt.z });
  const hilt = { x: butt.x + axis.x * weapon.gripLength, y: butt.y + axis.y * weapon.gripLength, z: butt.z + axis.z * weapon.gripLength };
  // The edge: from the axis out to the edge particle, square to the axis.
  const e = at(EDGE);
  const out = { x: e.x - (butt.x + tip.x) / 2, y: e.y - (butt.y + tip.y) / 2, z: e.z - (butt.z + tip.z) / 2 };
  const along = out.x * axis.x + out.y * axis.y + out.z * axis.z;
  const edge = norm({ x: out.x - axis.x * along, y: out.y - axis.y * along, z: out.z - axis.z * along });
  return { joints, blade: { hilt, tip, edge } };
}
