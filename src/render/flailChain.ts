/**
 * The Flail's loose chain, as drawn (docs/plans/flail.md, Stage 3). The Simulation keeps the Flail rigid (ADR 0026): hand to tip, its
 * ball's centre where the Head's is. Only drawing lets it go:
 *
 * - **Wind-up**: the ball whirls on a cone round the shaft's end, at the angle `whirlTurns` gives for the state Tick and the Spin-up's
 *   charge, so it turns faster as the charge builds and keeps turning at the top rate while held at full. It turns the way its Direction swings (about the Release's own axis), so the whirl is also the read of the
 *   Direction. It starts hanging and is carried into the whirl over its first Ticks.
 * - **Release**: it blends from the whirl onto the simulated ball over the first `RELEASE_BLEND` Ticks (at once on a Hit), then is
 *   exactly on it to the end of Release, so the ball that is seen is the ball that hits; a lodged Weapon holds it in the victim.
 * - **Recovery, and a blocked attacker's recoil**: it falls from where the swing left it to hanging, over `HANG_BLEND` Ticks.
 * - **Everything else**: it hangs straight down from the shaft's end.
 *
 * Wherever it is not on the simulated ball it is kept out of the floor and the Fighter's own head and torso. Pure, with no DOM: a
 * function of the two states drawn between, alpha and Tuning Data, holding nothing between frames, so scrubbing, Rollback and the
 * Final Blow Shot always draw the same chain for the same Tick.
 *
 * Each chain also says how `free` its ball is: how far a swinging ball (`FlailSwing`, src/render/flailSwing.ts, which does keep
 * state) may take over from the one drawn here, so the hanging ball swings with the Fighter's inertia. Without one it hangs as here.
 */
import {
  attackTimings,
  fighterPose,
  type Action,
  type BladeTransform,
  type Direction,
  type SimState,
  type SkeletonPose,
  type Vec3,
} from '../sim';
import { sizedTuning, weaponByName, whirlTurns, type Size, type TuningData, type WeaponTuning } from '../tuning';

/** Links drawn along a flail's chain. */
export const FLAIL_LINKS = 7;
/** A link (a torus of tube 0.28) is 2.56 × its scale long, and the next hangs 1.44 × its scale on (its inside length). */
const LINK_LENGTH = 2.56;
const LINK_PITCH = 1.44;

/** The cone's half-angle (radians): how far out from its axis the whirling chain leans. */
export const WHIRL_CONE = (62 * Math.PI) / 180;
/** How far the cone's axis leans from the shaft toward the swing's axis (0: along the shaft, 1: halfway). */
const WHIRL_TILT = 1;
/** Whirled Ticks over which the ball is carried from hanging into the whirl. */
export const WHIRL_BLEND = 12;
/**
 * How high the shaft must point for the ball to whirl (the shaft's direction's height, -1 straight down to 1 straight up): it hangs
 * below `WHIRL_LOW` and whirls fully from `WHIRL_HIGH`, so a Wind-up that starts with the shaft low (a Chain out of a Recovery) lifts
 * the ball into the whirl as the shaft rises instead of sweeping it through the body.
 */
const WHIRL_LOW = 0;
const WHIRL_HIGH = 0.35;
/** Ticks of Release over which the ball moves off the whirl onto the simulated ball. */
export const RELEASE_BLEND = 2;
/** Ticks over which the ball falls from where a swing left it to hanging. */
export const HANG_BLEND = 20;
/** Ticks after a swing ends (Recovery, a stopped swing, a Death) over which the swinging ball takes over, carrying the swing on. */
export const FREE_BLEND = 4;

/** The head's and torso's radii (m, at standard Size) the ball is kept out of. */
const HEAD_RADIUS = 0.12;
const TORSO_RADIUS = 0.17;

/** What a swinging ball needs to hang from the chain: how far it may take over, and what it hangs from and is kept out of. */
export interface FreeHang {
  /** 0: the ball is where this chain draws it (whirling, on the tip); 1: hanging, wholly the swinging ball's. */
  readonly weight: number;
  /** The shaft's end the chain hangs from, and the chain's reach from there to the ball's centre. */
  readonly end: Vec3;
  readonly reach: number;
  readonly floor: number;
  readonly body?: FlailInput['body'];
  readonly size?: Size;
}

/** The chain as drawn: the ball's centre and each link's centre, from the shaft's end to the ball. */
export interface FlailChain {
  readonly ball: Vec3;
  readonly links: readonly Vec3[];
  /** How a swinging ball may hang from it (absent: it may not; the ball stays where this chain has it). */
  readonly free?: FreeHang;
}

/** What the chain is drawn from: one Fighter between two Ticks. */
export interface FlailInput {
  /** The drawn (interpolated) rigid blade, hand to tip. */
  readonly blade: BladeTransform;
  /** Its Weapon, sized. */
  readonly weapon: WeaponTuning;
  /** Its Action this Tick. */
  readonly action: Action;
  /** The state Tick and its Attack's Spin-up charge as drawn (between last Tick's and this one's; no charge: no Spin-up). */
  readonly tick: number;
  readonly charge?: number;
  /** Its Motion playhead this Tick, and the length of the Motion Blend it is in, when not the usual one (`MotionBlend.ticks`). */
  readonly motionTick: number;
  readonly blendTicks?: number;
  /** The Attack's phase boundaries (for an Attack). */
  readonly timings?: { readonly windUpEnd: number; readonly releaseEnd: number };
  /** How far from last Tick to this one it is drawn (0..1). */
  readonly alpha: number;
  /** Its drawn facing (radians; 0 faces +z). */
  readonly facing: number;
  /** The height of its feet (the floor it stands on). */
  readonly floor: number;
  /** Its drawn head, chest and pelvis, to keep the ball out of (absent: not kept out). */
  readonly body?: Pick<SkeletonPose['joints'], 'head' | 'chest' | 'pelvis'>;
  readonly size?: Size;
}

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const unit = (a: Vec3, fallback: Vec3 = { x: 0, y: 1, z: 0 }): Vec3 => {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : fallback;
};
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => (t <= 0 ? a : t >= 1 ? b : add(a, scale(sub(b, a), t)));
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
/** Eased 0..1 (smoothstep), so a blend starts and lands softly. */
const ease = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const DOWN: Vec3 = { x: 0, y: -1, z: 0 };

/** The Weapon's axis (hand → tip, unit) and length. */
function axis(b: BladeTransform): { readonly s: Vec3; readonly len: number } {
  const d = sub(b.tip, b.hilt);
  const len = length(d);
  return { s: unit(d), len };
}

/** How far along the Weapon from the hand its shaft ends (where the chain hangs from), as Stage 1 draws it. */
export const shaftLength = (w: Pick<WeaponTuning, 'chain' | 'head'>, len: number): number => Math.max(len - (w.chain ?? 0) - w.head, 0.05);

/** The shaft's end, which the chain hangs from. */
export function shaftEnd(b: BladeTransform, w: Pick<WeaponTuning, 'chain' | 'head'>): Vec3 {
  const { s, len } = axis(b);
  return add(b.hilt, scale(s, shaftLength(w, len)));
}

/** The ball's centre where the Simulation has it: the Head's centre, half the Head back from the tip. */
export function rigidBall(b: BladeTransform, w: Pick<WeaponTuning, 'head'>): Vec3 {
  const { s, len } = axis(b);
  return add(b.hilt, scale(s, len - w.head / 2));
}

/** A flail ball's radius without its spikes (its Head is its diameter with them). */
export const flailBallRadius = (w: Pick<WeaponTuning, 'head'>): number => (w.head / 2) * 0.6;

/** The chain's reach: shaft's end to the ball's centre, as the rigid Weapon has it. */
export const reachOf = (b: BladeTransform, w: Pick<WeaponTuning, 'chain' | 'head'>): number => {
  const { len } = axis(b);
  return len - w.head / 2 - shaftLength(w, len);
};

/** The links' spacing along a chain of `reach` (shaft's end to the ball's centre) and each link's scale (a torus of radius 1). */
export function linkSpacing(reach: number, w: Pick<WeaponTuning, 'head'>): { readonly step: number; readonly size: number } {
  const span = Math.max(reach - flailBallRadius(w), 1e-4);
  const step = span / (FLAIL_LINKS - 1 + LINK_LENGTH / LINK_PITCH);
  return { step, size: step / LINK_PITCH };
}

/** The axis a swing in `direction` turns about (the Release's), from the Fighter's facing: an Overhead about its left, a Left down, a Right up. */
function swingAxis(direction: Direction, facing: number): Vec3 {
  // Facing 0 faces +z; the Fighter's right is then world -x (src/sim/skeleton.ts).
  const right = { x: -Math.cos(facing), y: 0, z: Math.sin(facing) };
  switch (direction) {
    case 'Left':
      return DOWN;
    case 'Right':
      return { x: 0, y: 1, z: 0 };
    default:
      return scale(right, -1);
  }
}

/**
 * The ball whirling round the shaft's end at `turns` (whole turns from its start): on a cone opening beyond the end, its axis between
 * the shaft and the swing's axis, turning about the swing's axis the way the swing does. A turn of 0 is the circle's lowest point.
 */
export function whirlBall(b: BladeTransform, w: Pick<WeaponTuning, 'chain' | 'head'>, direction: Direction, facing: number, turns: number): Vec3 {
  const { s } = axis(b);
  const spin = swingAxis(direction, facing);
  // The cone's axis leans from the shaft toward the swing's axis, always the same way (so it never flips sides as the shaft passes
  // square to that axis), and the ball turns about it the swing's way: dot(spin, axis) >= 0 whenever the shaft is not pointing
  // straight back along the swing's axis (then the cone falls back to the shaft).
  const a = unit(add(s, scale(spin, WHIRL_TILT)), s);
  // Turn 0 at the circle's lowest point (where a hanging ball is nearest), so the whirl starts from the hang.
  const lowest = sub(DOWN, scale(a, dot(DOWN, a)));
  const p = unit(lowest, unit(cross(a, { x: 1, y: 0, z: 0 }), { x: 0, y: 0, z: 1 }));
  const q = cross(a, p);
  const angle = 2 * Math.PI * turns;
  const r = reachOf(b, w);
  const out = add(scale(a, Math.cos(WHIRL_CONE)), scale(add(scale(p, Math.cos(angle)), scale(q, Math.sin(angle))), Math.sin(WHIRL_CONE)));
  return add(shaftEnd(b, w), scale(out, r));
}

/** The ball hanging straight down from the shaft's end. */
export function hangingBall(b: BladeTransform, w: Pick<WeaponTuning, 'chain' | 'head'>): Vec3 {
  return add(shaftEnd(b, w), scale(DOWN, reachOf(b, w)));
}

/** `ball` kept out of the floor and, when given, the Fighter's head (a sphere) and torso (a capsule, pelvis to chest). */
export function keepOut(ball: Vec3, w: Pick<WeaponTuning, 'head'>, floor: number, body: FlailInput['body'], size: Size | undefined): Vec3 {
  const r = w.head / 2;
  let p = ball;
  if (body) {
    const h = size?.height ?? 1;
    const head = HEAD_RADIUS * h + r;
    const fromHead = sub(p, body.head);
    const d = length(fromHead);
    if (d < head) p = add(body.head, scale(unit(fromHead, { x: 0, y: 1, z: 0 }), head));
    // The torso: pushed out level from the spine, from the pelvis up to the chest.
    const torso = TORSO_RADIUS * (size?.thick ?? 1) + r;
    const spine = sub(body.chest, body.pelvis);
    const along = clamp01(dot(sub(p, body.pelvis), spine) / Math.max(dot(spine, spine), 1e-9));
    const onSpine = add(body.pelvis, scale(spine, along));
    const off = { x: p.x - onSpine.x, y: 0, z: p.z - onSpine.z };
    const o = Math.hypot(off.x, off.z);
    // Full width between the pelvis and the chest, narrowing to nothing over `r` beyond either, so a ball crossing the ends is
    // pushed out smoothly rather than all at once.
    const beyond = Math.max(body.pelvis.y - p.y, p.y - body.chest.y, 0);
    const width = torso * Math.sqrt(Math.max(0, 1 - (beyond / r) ** 2));
    if (o < width) {
      const out = o > 1e-9 ? scale(off, 1 / o) : { x: 0, y: 0, z: -1 };
      p = { x: onSpine.x + out.x * width, y: p.y, z: onSpine.z + out.z * width };
    }
  }
  return p.y < floor + r ? { ...p, y: floor + r } : p;
}

/**
 * The links' centres from the shaft's end to the ball: evenly along the chain as Stage 1 spaces them, on a straight line when it is
 * taut and sagging under gravity (a parabola, as deep as the slack needs) when the ball is nearer the end than the chain is long.
 */
export function chainLinks(end: Vec3, ball: Vec3, w: Pick<WeaponTuning, 'chain' | 'head'>, reach: number): Vec3[] {
  const r = flailBallRadius(w);
  const toBall = sub(ball, end);
  const d = length(toBall);
  const dir = unit(toBall, DOWN);
  // The chain runs from the end to the ball's surface.
  const span = Math.max(reach - r, 1e-4);
  const to = add(end, scale(dir, Math.max(d - r, 0)));
  const chord = Math.max(d - r, 0);
  const slack = Math.max(0, span * span - chord * chord);
  const sagDir = unit(sub(DOWN, scale(dir, dot(DOWN, dir))), { x: 0, y: 0, z: 0 });
  const sag = 0.5 * Math.sqrt(slack);
  const { step, size } = linkSpacing(reach, w);
  return Array.from({ length: FLAIL_LINKS }, (_, k) => {
    const u = (0.5 * LINK_LENGTH * size + step * k) / span;
    const onChord = lerp(end, to, u);
    return add(onChord, scale(sagDir, sag * 4 * u * (1 - u)));
  });
}

function freeHang(weight: number, end: Vec3, reach: number, floor: number, body: FlailInput['body'], size: Size | undefined): FreeHang {
  return { weight, end, reach, floor, ...(body ? { body } : {}), ...(size ? { size } : {}) };
}

/** The drawn chain for one Fighter (see the module comment). */
export function flailBall(input: FlailInput): FlailChain {
  const { blade, weapon: w, action, tick, charge, motionTick, blendTicks, timings, alpha, facing, floor, body, size } = input;
  const end = shaftEnd(blade, w);
  const reach = reachOf(blade, w);
  const rigid = rigidBall(blade, w);
  const hang = (): Vec3 => keepOut(hangingBall(blade, w), w, floor, body, size);
  /**
   * The whirl, carried over its first `WHIRL_BLEND` Ticks (of charge; of the Motion without a Spin-up) out of the hang, or, for a Whiff
   * Chain (whose pose blends from the end of the swing over the Wind-up, `windUpEnd + 1` Ticks), out of the simulated ball where the
   * swing left it; and only as far as the shaft is raised.
   */
  let free = 0;
  const whirl = (direction: Direction): Vec3 => {
    const spun = keepOut(whirlBall(blade, w, direction, facing, whirlTurns(w, tick, charge ?? 0)), w, floor, body, size);
    const whiffChained = timings !== undefined && blendTicks === timings.windUpEnd + 1;
    const raised = ease((axis(blade).s.y - WHIRL_LOW) / (WHIRL_HIGH - WHIRL_LOW));
    const into = ease((charge ?? motionTick) / WHIRL_BLEND) * raised;
    // Hanging, the swinging ball is carried into the whirl as it builds; out of a swing's end it is the whirl's from the start.
    free = whiffChained ? 0 : 1 - into;
    return lerp(whiffChained ? rigid : hang(), spun, into);
  };
  let ball: Vec3;
  if (action.kind === 'Attack') {
    const t = timings ?? { windUpEnd: 0, releaseEnd: 0 };
    switch (action.phase) {
      case 'Wind-up':
        ball = whirl(action.direction);
        break;
      case 'Release': {
        // Off the whirl (still turning) onto the simulated ball.
        const into = motionTick - t.windUpEnd - 1 + alpha;
        const onTip = action.landed || action.lodge !== undefined ? 1 : ease(into / RELEASE_BLEND);
        ball = onTip >= 1 ? rigid : lerp(whirl(action.direction), rigid, onTip);
        free = 0;
        break;
      }
      case 'Recovery': {
        // Recovery's first Tick plays the Motion at releaseEnd, the end-of-Release pose: the ball is still on the tip there (through
        // releaseEnd), and falls from the Tick after.
        const into = (action.chain?.tick ?? motionTick) - t.releaseEnd + alpha - 1;
        ball = lerp(rigid, hang(), ease(into / HANG_BLEND));
        free = ease(into / FREE_BLEND);
        break;
      }
    }
  } else if (action.kind === 'Stagger' && (action.cause === 'Blocked' || action.cause === 'Chambered')) {
    // A stopped swing: the ball falls from where the blade was stopped.
    ball = lerp(rigid, hang(), ease((motionTick - 1 + alpha) / HANG_BLEND));
    free = ease((motionTick - 1 + alpha) / FREE_BLEND);
  } else {
    ball = hang();
    free = 1;
  }
  return { ball, links: chainLinks(end, ball, w, reach), free: freeHang(free, end, reach, floor, body, size) };
}

/**
 * The chain of Fighter `i` drawn a share `alpha` of the way from Tick `from` to Tick `to`, or undefined when its Weapon is not drawn as
 * a flail. `drawn` is its pose as drawn (default: its solved Skeletons interpolated, as `drawnPose` draws them): the Weapon at its
 * blade, the ball kept out of its head and torso. A fallen Fighter's ball falls from where it was as it fell (whirling, on the tip,
 * hanging) to hanging from the falling Weapon, onto the floor.
 */
export function flailChainOf(from: SimState, to: SimState, i: number, alpha: number, tuning: TuningData, drawn?: Pick<SkeletonPose, 'blade' | 'joints'>): FlailChain | undefined {
  const f = to.fighters[i];
  if (!f) return undefined;
  const w = weaponByName(sizedTuning(tuning, f.size), f.weapon);
  if (w.look !== 'flail') return undefined;
  const p = from.fighters[i] ?? f;
  const pose = drawn ?? lerpJoints(fighterPose(p, tuning), fighterPose(f, tuning), alpha);
  const floor = p.y + (f.y - p.y) * alpha;
  const timings = f.action.kind === 'Attack' ? attackTimings(tuning, f.weapon, f.action.direction) : undefined;
  if (f.death) {
    // Its state stays as it fell: where the ball was then, on the falling Weapon, then down to hanging.
    const charge = f.action.kind === 'Attack' ? f.action.charge : undefined;
    const fell = flailBall({ blade: pose.blade, weapon: w, action: f.action, tick: f.death.tick, charge, motionTick: f.motion.tick, timings, alpha: 1, facing: f.facing, floor });
    const hanging = flailBall({ blade: pose.blade, weapon: w, action: { kind: 'Idle' }, tick: 0, motionTick: 0, alpha, facing: f.facing, floor });
    const since = from.tick + (to.tick - from.tick) * alpha - f.death.tick;
    const ball = lerp(fell.ball, hanging.ball, ease(since / HANG_BLEND));
    const end = shaftEnd(pose.blade, w);
    const reach = reachOf(pose.blade, w);
    // The swinging ball takes over as it falls, so it swings and drops onto the floor with the falling Weapon.
    const free = Math.max(fell.free?.weight ?? 0, ease(since / FREE_BLEND));
    return { ball, links: chainLinks(end, ball, w, reach), free: freeHang(free, end, reach, floor, undefined, undefined) };
  }
  const turn = Math.atan2(Math.sin(f.facing - p.facing), Math.cos(f.facing - p.facing));
  const j = pose.joints;
  // The charge between Ticks: from last Tick's, when that was this Attack's Wind-up (an Attack Feint carries it on) or its last Wind-up Tick.
  const now = f.action.kind === 'Attack' ? f.action.charge : undefined;
  const before = p.action.kind === 'Attack' && p.action.phase === 'Wind-up' ? p.action.charge : undefined;
  const charge = now === undefined ? undefined : before !== undefined && before <= now ? before + (now - before) * alpha : now;
  return flailBall({
    blade: pose.blade,
    weapon: w,
    action: f.action,
    tick: from.tick + (to.tick - from.tick) * alpha,
    charge,
    motionTick: f.motion.tick,
    blendTicks: f.motion.blend?.ticks,
    timings,
    alpha,
    facing: p.facing + turn * alpha,
    floor,
    body: { head: j.head, chest: j.chest, pelvis: j.pelvis },
    size: f.size,
  });
}

/**
 * A Sheathed flail's chain on the back: static, the ball hung down the outside of the shaft from its end (the end that stands up
 * over the shoulder), against the back rather than in it. `chest` is the Fighter's chest joint.
 */
export function sheathedFlail(blade: BladeTransform, w: Pick<WeaponTuning, 'chain' | 'head'>, chest: Vec3): FlailChain {
  const { s } = axis(blade);
  const end = shaftEnd(blade, w);
  const reach = reachOf(blade, w);
  const fromChest = sub(end, chest);
  const out = unit(sub(fromChest, scale(s, dot(fromChest, s))), { x: 0, y: 0, z: -1 });
  const ball = add(add(end, scale(s, -reach * 0.82)), scale(out, 0.03 + flailBallRadius(w) * 0.9));
  return { ball, links: chainLinks(end, ball, w, reach) };
}

/** The blade and the joints the chain needs (head, chest, pelvis) of two solved poses, interpolated. */
function lerpJoints(a: SkeletonPose, b: SkeletonPose, t: number): Pick<SkeletonPose, 'blade' | 'joints'> {
  const blade = { hilt: lerp(a.blade.hilt, b.blade.hilt, t), tip: lerp(a.blade.tip, b.blade.tip, t), edge: lerp(a.blade.edge, b.blade.edge, t) };
  const joints = { ...b.joints, head: lerp(a.joints.head, b.joints.head, t), chest: lerp(a.joints.chest, b.joints.chest, t), pelvis: lerp(a.joints.pelvis, b.joints.pelvis, t) };
  return { blade, joints };
}
