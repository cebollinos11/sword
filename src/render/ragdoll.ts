/**
 * The Death Ragdoll: a fallen Fighter's Skeleton goes limp and drops under
 * gravity, knocked away by the blow that felled it, and its hand lets go of
 * the Weapon, which falls on its own. Like impact effects it lives outside the
 * Simulation (ADR 0001) and never changes an outcome; but it is a pure function
 * of the pose the Fighter fell in, its Death and the time since, so scrubbing,
 * replays and Rollback all draw the same fall.
 *
 * Verlet particles, one per joint plus three on the Weapon, held together by
 * distance constraints: the torso and head are rigid, the knees and elbows bend
 * only the way they bend in life (never backwards, sideways or flat), and everything lands on the Arena's Walk Surfaces: each particle on
 * the highest one under it, so a body that falls off a ledge drops to the floor below. A Sheathed Weapon stays in its slot: its
 * particles are held rigidly to the torso and fall with it.
 *
 * A Death whose cut severed bones (Dismemberment, src/render/dismember.ts) falls in pieces: each severed bone gets two
 * more particles, one stump end per side, and nothing holds one piece to another. A piece with the pelvis or the chest
 * stays a limp body; any other (a head, an arm, a leg) is one rigid body.
 */
import { groundBelow, JOINT_NAMES, type Death, type JointName, type SkeletonPose, type Vec3 } from '../sim';
import type { ArenaGeometry, TuningData, WeaponTuning } from '../tuning';
import { piecesOf, type Severed } from './dismember';
import { sheathedBlade } from './sheathed';

/** Simulation step and how long the fall is simulated before it is left lying still (seconds). */
const STEP = 1 / 120;
const SETTLE_SECONDS = 3;
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
/** How a severed piece comes away from the body: carried along the blade's travel (m/s) and turning in the cut's plane (rad/s). */
const SEVER_FLING = 1.2;
const SEVER_SPIN = 3;

/** Weapon particles after the joints: butt (pommel end), tip, and one off the edge to keep it from rolling freely. */
const BUTT = JOINT_NAMES.length;
const TIP = BUTT + 1;
const EDGE = BUTT + 2;
/** After the Weapon, two stump particles per severed bone: the cut end on the side of the bone's first joint, then of its second. */
const STUMP = EDGE + 1;
const EDGE_OFFSET = 0.08;

const J = Object.fromEntries(JOINT_NAMES.map((n, i) => [n, i])) as Record<JointName, number>;

/** Resting height of each particle's centre above the floor: how thick that part of the body is drawn (m). */
function radii(tuning: TuningData, severed: readonly Severed[]): Float64Array {
  const r = new Float64Array(STUMP + 2 * severed.length).fill(0.05);
  r[J.pelvis] = r[J.chest] = 0.12;
  r[J.head] = tuning.skeleton.headRadius;
  r[J.leftToe] = r[J.rightToe] = 0.04;
  r[BUTT] = r[TIP] = r[EDGE] = 0.015;
  // A torso cut in two lies on its cut ends as it does on the pelvis and chest.
  severed.forEach((s, k) => s.bone[0] === 'pelvis' && r.fill(0.12, STUMP + 2 * k, STUMP + 2 * k + 2));
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
/** The joints that keep their places on the torso: a stump on one of them is held as rigidly. */
const RIGID: JointName[] = [...TORSO, 'head'];
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

/** Which way a hinge bends, given the torso as it lies now. */
type Bend = (body: Torso, chain: Vec3) => Vec3;
/**
 * The particles a torso's frame is read from: `left` from the first to the second (right hip to left hip), `up` from the
 * third to the fourth (pelvis to chest). A torso cut in two has one per half: the chest's lies across the shoulders, and
 * each half's cut end stands in for the half it lost.
 */
type Frame = readonly [number, number, number, number];
interface Torso {
  /** Right hip to left hip, pelvis to chest, and the chest's front, as unit vectors. */
  readonly left: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
}
/** Knees and feet bend in the leg's own plane: forward of the line from hip to ankle (or along the shin), as when standing. */
const LEG: Bend = (t, c) => cross(c, t.left);
/** Elbows bend toward the arm poles of src/sim/skeleton.ts: out, down and back. */
const arm =
  (out: number): Bend =>
  (t) => ({ x: t.left.x * 0.6 * out - t.up.x - t.forward.x * 0.4, y: t.left.y * 0.6 * out - t.up.y - t.forward.y * 0.4, z: t.left.z * 0.6 * out - t.up.z - t.forward.z * 0.4 });
/**
 * Hinges: each joint stays off the line between its two neighbours on the side
 * the living pose bends it, turned at most `swing` radians round that line from
 * it, and at least `least` metres off it. So knees and elbows never bend
 * backwards or sideways and the feet never spin round the shins; the Body
 * model rolls each limb by that same side (src/render/bodyRig.ts), so it never twists.
 */
const HINGES: [joint: JointName, from: JointName, to: JointName, bend: Bend, swing: number, least: number][] = [
  ['leftKnee', 'leftHip', 'leftAnkle', LEG, 0.35, 0.03],
  ['rightKnee', 'rightHip', 'rightAnkle', LEG, 0.35, 0.03],
  ['leftToe', 'leftKnee', 'leftAnkle', LEG, 0.5, 0],
  ['rightToe', 'rightKnee', 'rightAnkle', LEG, 0.5, 0],
  ['leftElbow', 'leftShoulder', 'leftHand', arm(1), 0.8, 0.02],
  ['rightElbow', 'rightShoulder', 'rightHand', arm(-1), 0.8, 0.02],
];
/** How far behind the hip (backwards) and across the body (inwards) a knee may swing, as a share of the thigh. */
const HIP_BACK = 0.45;
const HIP_IN = 0.3;
const HIP_LIMITS: [hip: JointName, knee: JointName, out: number][] = [
  ['leftHip', 'leftKnee', 1],
  ['rightHip', 'rightKnee', -1],
];

function dist(p: Float64Array, a: number, b: number): number {
  return Math.hypot(p[3 * a]! - p[3 * b]!, p[3 * a + 1]! - p[3 * b + 1]!, p[3 * a + 2]! - p[3 * b + 2]!);
}

/** What holds a falling body together: its rods, and the hinges and hip limits of each piece that still has a torso to bend by. */
interface Rig {
  readonly cs: Constraint[];
  readonly frames: Frame[];
  /** Each with the particles of its joint and the two it bends between, and the index of its piece's frame. */
  readonly hinges: [j: number, a: number, b: number, bend: Bend, swing: number, least: number, frame: number][];
  readonly limits: [hip: number, knee: number, out: number, frame: number][];
}

/**
 * The Rig of the particles at `p`. With `severed` bones the body is in pieces (`pieceOf`): a constraint between two
 * pieces is dropped, unless one end is just across a cut, where that side's stump stands in for it (so a bone's rod
 * becomes a rod to each stump, and an elbow whose forearm is cut still hinges, on what is left of it).
 */
function rig(p: Float64Array, sheathed: boolean, weapon: WeaponTuning, severed: readonly Severed[]): Rig {
  const cs: Constraint[] = [];
  const rodded = new Set<number>();
  const count = p.length / 3;
  const rod = (a: number, b: number, min = false, share = 1) => {
    const pair = Math.min(a, b) * count + Math.max(a, b);
    if (a === b || rodded.has(pair)) return;
    rodded.add(pair);
    cs.push({ a, b, length: dist(p, a, b) * share, min });
  };
  const { piece, pieces } = piecesOf(severed, STUMP);
  /** The particle that stands for joint `j` in piece `q`: itself there, the stump on `q`'s side when `j` is just across a cut, else none (-1). */
  const seen = (j: JointName, q: number): number => {
    if (piece[j] === q) return J[j];
    const k = severed.findIndex(({ bone }) => (bone[0] === j && piece[bone[1]] === q) || (bone[1] === j && piece[bone[0]] === q));
    return k < 0 ? -1 : STUMP + 2 * k + (severed[k]!.bone[0] === j ? 1 : 0);
  };
  /** A rod (or fold) between joints `a` and `b`, once in each piece either lies in. */
  const link = (a: JointName, b: JointName, min = false, share = 1) => {
    for (const q of piece[a] === piece[b] ? [piece[a]] : [piece[a], piece[b]]) {
      const x = seen(a, q);
      const y = seen(b, q);
      if (x >= 0 && y >= 0) rod(x, y, min, share);
    }
  };
  // The frame of each piece with a pelvis or a chest.
  const frames: Frame[] = [];
  const frameOf = pieces.map((_, q) => {
    const pelvis = piece.pelvis === q;
    const chest = piece.chest === q;
    if (!pelvis && !chest) return -1;
    return frames.push(pelvis ? [J.rightHip, J.leftHip, J.pelvis, seen('chest', q)] : [J.rightShoulder, J.leftShoulder, seen('pelvis', q), J.chest]) - 1;
  });
  /** The stump particles that ride on joint `j`. */
  const stumpsOn = (j: JointName): number[] => severed.flatMap(({ bone }, k) => (bone[0] === j ? [STUMP + 2 * k] : bone[1] === j ? [STUMP + 2 * k + 1] : []));

  for (let i = 0; i < TORSO.length; i++) for (let k = i + 1; k < TORSO.length; k++) link(TORSO[i]!, TORSO[k]!);
  // A Sheathed Weapon is part of the torso: of the half its slot is on, when that is cut in two.
  const slot = piece[weapon.sheathe.slot === 'hip' ? 'pelvis' : 'chest'];
  if (sheathed) for (const w of [BUTT, TIP, EDGE]) for (const t of TORSO) if (piece[t] === slot) rod(w, J[t]);
  for (const [a, b] of LIMBS) link(a, b);
  pieces.forEach((own, q) => {
    if (frameOf[q]! < 0) {
      // No torso to bend by: the piece keeps its shape.
      for (let i = 0; i < own.length; i++) for (let k = i + 1; k < own.length; k++) rod(own[i]!, own[k]!);
      return;
    }
    // A stump on the torso is as rigid as the torso.
    const held = RIGID.filter((n) => piece[n] === q);
    const stumps = held.flatMap(stumpsOn);
    for (const s of stumps) {
      for (const n of held) rod(s, J[n]);
      for (const other of stumps) rod(s, other);
      if (sheathed && q === slot) for (const w of [BUTT, TIP, EDGE]) rod(w, s);
    }
  });
  for (const [a, b, share] of FOLDS) link(a, b, true, share);
  rod(BUTT, TIP);
  rod(BUTT, EDGE);
  rod(TIP, EDGE);

  const hinges: Rig['hinges'] = [];
  for (const [joint, from, to, bend, swing, least] of HINGES) {
    const q = piece[joint];
    const a = seen(from, q);
    const b = seen(to, q);
    if (frameOf[q]! < 0 || a < 0 || b < 0) continue;
    // What is left of a cut bone is shorter, and need stay less far off the line in proportion.
    const left = Math.min(dist(p, J[joint], a) / dist(p, J[joint], J[from]), dist(p, J[joint], b) / dist(p, J[joint], J[to]));
    hinges.push([J[joint], a, b, bend, swing, least * left, frameOf[q]!]);
  }
  const limits: Rig['limits'] = [];
  // The hips' half of a torso cut in two has too little above the hips to hold a thigh against: its thighs swing freely.
  for (const [hip, knee, out] of HIP_LIMITS) if (piece[hip] === piece[knee] && piece[hip] === piece.chest) limits.push([J[hip], J[knee], out, frameOf[piece[hip]]!]);
  return { cs, frames, hinges, limits };
}

/** The fall's particles in their starting places (`pos`) and one step back (`prev`, so `pos - prev` is the starting velocity per step). */
function start(pose: SkeletonPose, death: Death, weapon: WeaponTuning, sheathed: boolean, severed: readonly Severed[]): { pos: Float64Array; prev: Float64Array } {
  const count = STUMP + 2 * severed.length;
  const pos = new Float64Array(3 * count);
  const set = (i: number, v: Vec3) => pos.set([v.x, v.y, v.z], 3 * i);
  JOINT_NAMES.forEach((n, i) => set(i, pose.joints[n]));
  // Both ends of a cut start where the bone is cut.
  severed.forEach((s, k) => [0, 1].forEach((side) => set(STUMP + 2 * k + side, s.at)));
  const { hilt, tip, edge } = sheathed ? sheathedBlade(pose, weapon) : pose.blade;
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

  const vel = new Float64Array(3 * count);
  for (let i = 0; i < count; i++) {
    if (i >= BUTT && i < STUMP) continue;
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
  const { piece, pieces } = piecesOf(severed, STUMP);
  comeAway(pos, vel, pieces, severed, death);
  if (sheathed) {
    // It falls with the chest it rides on (or the pelvis, for a hip slot on a torso cut in two).
    const rides = piece.pelvis !== piece.chest && weapon.sheathe.slot === 'hip' ? J.pelvis : J.chest;
    for (const i of [BUTT, TIP, EDGE]) for (let c = 0; c < 3; c++) vel[3 * i + c] = vel[3 * rides + c]!;
    const prev = pos.map((v, i) => v - vel[i]! * STEP);
    return { pos, prev };
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

/**
 * Every severed piece but the one with the pelvis comes away from the body: carried on along the blade's travel, and
 * turning about its own middle in the plane of the cut.
 */
function comeAway(pos: Float64Array, vel: Float64Array, pieces: readonly number[][], severed: readonly Severed[], death: Death): void {
  const travel = death.blow?.cut?.travel;
  if (!travel || severed.length === 0) return;
  const spin = scale(severed[0]!.normal, SEVER_SPIN);
  pieces.forEach((own, q) => {
    if (q === 0) return;
    const middle = [0, 1, 2].map((c) => own.reduce((sum, i) => sum + pos[3 * i + c]!, 0) / own.length);
    for (const i of own) {
      const turn = cross(spin, { x: pos[3 * i]! - middle[0]!, y: pos[3 * i + 1]! - middle[1]!, z: pos[3 * i + 2]! - middle[2]! });
      vel[3 * i] = vel[3 * i]! + travel.x * SEVER_FLING + turn.x;
      vel[3 * i + 1] = vel[3 * i + 1]! + travel.y * SEVER_FLING + turn.y;
      vel[3 * i + 2] = vel[3 * i + 2]! + travel.z * SEVER_FLING + turn.z;
    }
  });
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
  for (let i = 0; i < radius.length; i++) {
    out[i] = arena ? (groundBelow(arena, p[3 * i]!, p[3 * i + 2]!, p[3 * i + 1]! - radius[i]! + FLOOR_REACH)?.y ?? 0) : 0;
  }
}

function satisfy(p: Float64Array, { cs, frames, hinges, limits }: Rig, radius: Float64Array, floor: Float64Array): void {
  const bodies: Torso[] = [];
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
    for (let k = 0; k < frames.length; k++) bodies[k] = torso(p, frames[k]!);
    for (const [j, a, b, bend, swing, least, frame] of hinges) hinge(p, radius, floor, j, a, b, bend(bodies[frame]!, sub(p, a, b)), swing, least);
    for (const [hip, knee, out, frame] of limits) {
      const body = bodies[frame]!;
      const thigh = dist(p, hip, knee);
      limit(p, knee, hip, body.forward, -HIP_BACK * thigh);
      limit(p, knee, hip, scale(body.left, out), -HIP_IN * thigh);
    }
    for (let i = 0; i < radius.length; i++) if (p[3 * i + 1]! < floor[i]! + radius[i]!) p[3 * i + 1] = floor[i]! + radius[i]!;
  }
}

/** From particle `a` to particle `b`. */
const sub = (p: Float64Array, a: number, b: number): Vec3 => ({ x: p[3 * b]! - p[3 * a]!, y: p[3 * b + 1]! - p[3 * a + 1]!, z: p[3 * b + 2]! - p[3 * a + 2]! });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const scale = (v: Vec3, k: number): Vec3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });
const nudge = (p: Float64Array, i: number, v: Vec3, k: number) => {
  p[3 * i] = p[3 * i]! + v.x * k;
  p[3 * i + 1] = p[3 * i + 1]! + v.y * k;
  p[3 * i + 2] = p[3 * i + 2]! + v.z * k;
};

function torso(p: Float64Array, [right, leftmost, low, high]: Frame): Torso {
  const left = norm(sub(p, right, leftmost));
  const up = norm(sub(p, low, high));
  return { left, up, forward: norm(cross(left, up)) };
}

/** Keep joint `j` off the line from `a` to `b` toward `bend`, within `swing` radians of it and at least `least` off the line. */
function hinge(p: Float64Array, radius: Float64Array, floor: Float64Array, j: number, a: number, b: number, bend: Vec3, swing: number, least: number): void {
  const chain = sub(p, a, b);
  const length = Math.hypot(chain.x, chain.y, chain.z);
  if (length < 1e-9) return;
  const axis = scale(chain, 1 / length);
  const toJoint = sub(p, a, j);
  const off = { x: toJoint.x - axis.x * dot(toJoint, axis), y: toJoint.y - axis.y * dot(toJoint, axis), z: toJoint.z - axis.z * dot(toJoint, axis) };
  const along = dot(bend, axis);
  const f = { x: bend.x - axis.x * along, y: bend.y - axis.y * along, z: bend.z - axis.z * along };
  const fl = Math.hypot(f.x, f.y, f.z);
  if (fl < 1e-6) return;
  const front = scale(f, 1 / fl);
  const side = cross(axis, front);
  const r = Math.hypot(off.x, off.y, off.z);
  const angle = Math.atan2(dot(off, side), dot(off, front));
  if (r >= least && Math.abs(angle) <= swing) return;
  const turn = Math.max(-swing, Math.min(swing, angle));
  const reach = Math.max(r, least);
  const want = { x: (front.x * Math.cos(turn) + side.x * Math.sin(turn)) * reach, y: (front.y * Math.cos(turn) + side.y * Math.sin(turn)) * reach, z: (front.z * Math.cos(turn) + side.z * Math.sin(turn)) * reach };
  // The joint moves two thirds of the way and its neighbours the rest, so the limb as a whole keeps its momentum.
  const move = { x: want.x - off.x, y: want.y - off.y, z: want.z - off.z };
  const ids = [j, a, b];
  const share = [2 / 3, -1 / 3, -1 / 3];
  // Nothing is pushed down through its floor; and since the floor would push it straight back up, the rest give up
  // as much of their rise, so the limb never shoves itself off the ground (a knee bending toward the floor it lies on
  // would otherwise lever the hip and ankle up a little every step, and the body would float away).
  const dy = ids.map((i, n) => {
    const y = share[n]! * move.y;
    return y >= 0 ? y : Math.max(y, Math.min(0, floor[i]! + radius[i]! - p[3 * i + 1]!));
  });
  const net = dy.reduce((s, y) => s + y, 0);
  if (net > 0) {
    const rise = dy.reduce((s, y) => s + Math.max(0, y), 0);
    for (let n = 0; n < 3; n++) if (dy[n]! > 0) dy[n] = dy[n]! * (1 - net / rise);
  }
  ids.forEach((i, n) => {
    p[3 * i] = p[3 * i]! + move.x * share[n]!;
    p[3 * i + 1] = p[3 * i + 1]! + dy[n]!;
    p[3 * i + 2] = p[3 * i + 2]! + move.z * share[n]!;
  });
}

/** Keep joint `j` at least `least` from `root` along `dir` (a unit vector), splitting the correction between them. */
function limit(p: Float64Array, j: number, root: number, dir: Vec3, least: number): void {
  const short = least - dot(sub(p, root, j), dir);
  if (short <= 0) return;
  nudge(p, j, dir, short / 2);
  nudge(p, root, dir, -short / 2);
}

/**
 * The Skeleton (and Weapon) of a Fighter `seconds` after it fell in `pose` (its pose on the Tick of its Death),
 * wielding `weapon`, in `arena` (default: on a flat floor at y 0). Pure and deterministic; after a few seconds the body lies still.
 * `sheathed`: it fell Sheathed, so its Weapon starts (and stays) in its slot instead of leaving the hand.
 * `severed`: the bones its Death's cut severed (`severing`, of this `pose` and `death`), so it falls in pieces and the pose
 * has their `stumps`. With none it is the whole body's fall, with no `stumps`.
 */
export function ragdollPose(
  pose: SkeletonPose,
  death: Death,
  seconds: number,
  weapon: WeaponTuning,
  tuning: TuningData,
  arena?: ArenaGeometry,
  sheathed = false,
  severed: readonly Severed[] = [],
): RagdollPose {
  const steps = Math.round(Math.min(Math.max(seconds, 0), SETTLE_SECONDS) / STEP);
  if (steps === 0) {
    const whole = sheathed ? { ...pose, blade: sheathedBlade(pose, weapon) } : pose;
    return severed.length > 0 ? { ...whole, stumps: severed.map((s) => ({ bone: s.bone, ends: [s.at, s.at] })) } : whole;
  }
  const fall = fallFor(pose, death, weapon, tuning, arena, steps, sheathed, severed);
  if (fall.steps === steps && fall.drawn) return fall.drawn;
  advance(fall, steps, arena);
  fall.drawn = drawn(fall.pos, weapon, severed);
  return fall.drawn;
}

/** A severed bone's two cut ends as they lie: `ends[0]` rides with the piece of `bone[0]`, `ends[1]` with that of `bone[1]`. */
export interface Stump {
  readonly bone: readonly [JointName, JointName];
  readonly ends: readonly [Vec3, Vec3];
}

/**
 * A Death Ragdoll's pose. In pieces (Dismemberment) it has the `stumps` of its severed bones, in the order they were
 * given, and each joint lies with its own piece (`pieceOf`); a whole body has no `stumps`.
 */
export interface RagdollPose extends SkeletonPose {
  readonly stumps?: readonly Stump[];
}

/**
 * A fall in progress, so each frame only steps on from where the last one left off
 * (and a settled body costs nothing) instead of re-running the whole fall.
 */
interface Fall {
  readonly key: string;
  readonly weapon: WeaponTuning;
  readonly tuning: TuningData;
  readonly arena: ArenaGeometry | undefined;
  readonly pos: Float64Array;
  readonly prev: Float64Array;
  readonly rig: Rig;
  readonly radius: Float64Array;
  readonly floor: Float64Array;
  /** The least energy (kinetic and potential, per unit mass of each particle) the fall has had so far: it may never have more. */
  energy: number;
  steps: number;
  drawn: RagdollPose | null;
}

/** Falls in progress, by what they fell from; the oldest are dropped past MAX_FALLS. */
const falls = new Map<string, Fall>();
const MAX_FALLS = 64;

/** The cached fall for these inputs if it can step on to `steps`, else a fresh one from the start. */
function fallFor(pose: SkeletonPose, death: Death, weapon: WeaponTuning, tuning: TuningData, arena: ArenaGeometry | undefined, steps: number, sheathed: boolean, severed: readonly Severed[]): Fall {
  const { chest, rightHand } = pose.joints;
  const key = JSON.stringify([death, chest, rightHand, pose.blade.tip, sheathed, ...severed]);
  const cached = falls.get(key);
  if (cached && cached.weapon === weapon && cached.tuning === tuning && cached.arena === arena && cached.steps <= steps) return cached;
  const { pos, prev } = start(pose, death, weapon, sheathed, severed);
  const radius = radii(tuning, severed);
  const fall: Fall = { key, weapon, tuning, arena, pos, prev, rig: rig(pos, sheathed, weapon, severed), radius, floor: new Float64Array(radius.length), energy: Infinity, steps: 0, drawn: null };
  falls.delete(key);
  falls.set(key, fall);
  if (falls.size > MAX_FALLS) falls.delete(falls.keys().next().value!);
  return fall;
}

/** Step `f` on until it has run `steps` steps. */
function advance(f: Fall, steps: number, arena: ArenaGeometry | undefined): void {
  const { pos, prev, rig, radius, floor } = f;
  const fall = GRAVITY * STEP * STEP;
  for (; f.steps < steps; f.steps++) {
    floors(pos, radius, arena, floor);
    for (let i = 0; i < radius.length; i++) {
      const o = 3 * i;
      const onFloor = pos[o + 1]! <= floor[i]! + radius[i]! + 1e-4;
      const keep = onFloor ? 1 - FLOOR_FRICTION : AIR_DRAG;
      for (let c = 0; c < 3; c++) {
        const v = (pos[o + c]! - prev[o + c]!) * (c === 1 ? AIR_DRAG : keep);
        prev[o + c] = pos[o + c]!;
        pos[o + c] = pos[o + c]! + v - (c === 1 ? fall : 0);
      }
    }
    satisfy(pos, rig, radius, floor);
    f.energy = spend(pos, prev, f.energy);
  }
}

/**
 * Keep the fall from gaining energy. The constraints set the body right by moving its particles, and Verlet keeps
 * every such move as speed; when they fight each other (a knee flipped to the wrong side, a limb jammed against the
 * floor) the body would pick up speed from nowhere and tumble or rise off the ground. So whenever it has more energy
 * than it has had before, it is slowed down to that. Returns the new least energy.
 */
function spend(pos: Float64Array, prev: Float64Array, most: number): number {
  let kinetic = 0;
  let potential = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    const o = 3 * i;
    kinetic += 0.5 * ((pos[o]! - prev[o]!) ** 2 + (pos[o + 1]! - prev[o + 1]!) ** 2 + (pos[o + 2]! - prev[o + 2]!) ** 2) / (STEP * STEP);
    potential += GRAVITY * pos[o + 1]!;
  }
  if (kinetic + potential <= most) return kinetic + potential;
  const keep = kinetic > 0 ? Math.sqrt(Math.max(0, most - potential) / kinetic) : 0;
  for (let i = 0; i < pos.length; i++) prev[i] = pos[i]! - (pos[i]! - prev[i]!) * keep;
  return most;
}

/** The Skeleton and Weapon the particles at `pos` make up, with the stumps of its `severed` bones. */
function drawn(pos: Float64Array, weapon: WeaponTuning, severed: readonly Severed[]): RagdollPose {
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
  const blade = { hilt, tip, edge };
  return severed.length > 0 ? { joints, blade, stumps: severed.map((s, k) => ({ bone: s.bone, ends: [at(STUMP + 2 * k), at(STUMP + 2 * k + 1)] })) } : { joints, blade };
}
