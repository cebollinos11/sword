/**
 * The Gait: procedural stepping of a Fighter's legs whenever its body moves
 * over the floor (walking, turning, being pushed). It runs inside the Tick
 * (ADR 0003), after bodies are settled, so the solved legs (and their Hit
 * Zones) always match what is drawn, and its state is snapshotted and hashed.
 *
 * Rules, per Tick, for each foot:
 *   - Its home is the current Motion's foot target at the Fighter's position
 *     and facing. The place it belongs is that home led along the body's
 *     motion this Tick: where the home will be half a step from now if the
 *     body keeps moving, at most the max lead ahead. A standing body has no
 *     lead. So a walking foot lands as far ahead of its home as the body then
 *     carries it behind before it next lifts: the faster the walk, the longer
 *     the stride, while the cadence stays near one step per step duration.
 *   - A stepping foot moves from where it lifted to where it will belong when
 *     it lands (re-evaluated each Tick, so it holds still in the world while
 *     the body keeps a steady pace) over the step duration, along an arc up to
 *     the step height, then lands: it is planted again and a `Step` event is emitted.
 *   - A planted foot stays fixed while the body moves. Once it is more than the
 *     stride threshold from where it belongs it starts a step, but only while
 *     the other foot is planted. When both qualify, the one further off goes
 *     first; on a tie (a straight walk from a standstill), the one further from
 *     its hip goes first, since it runs out of reach first.
 *   - While the body stands still, a planted foot within the stride threshold
 *     glides along the floor toward its home (so authored foot keys and the
 *     settle after a walk stay smooth); further off, it steps.
 *
 * A foot the Motion owns is not stepped: the right foot while the Motion sets `kickFoot`, and
 * both feet while the Motion tilts the body (`body.tilt`, lying down). An owned foot stays planted
 * under the Motion's target, and once released it is where it was left, so it glides or steps home from there.
 *
 * Feet stand on the Walk Surface under them (a foot on a ramp or a step sits at
 * that height). While the body is airborne the feet take no steps: they follow
 * their home under the body, and plant there again on landing.
 *
 * The hips bob and sway with each step (hipShift), swaying toward wherever the
 * planted foot actually is (so Motions with crossed feet sway the right way), and sink as
 * far as a long stride needs to keep both feet within the legs' reach; the hands and blade still
 * come from the Motion, so walking never changes a Blade Sweep.
 */
import type { ArenaGeometry, TuningData } from '../tuning';
import { groundBelow } from './arena';
import { secondsToTicks } from './constants';
import type { Emit } from './events';
import { playbackTargets } from './motion';
import type { HipShift, Placement } from './skeleton';
import type { FighterState, MotionPlayback, Vec2 } from './state';
import type { Vec3 } from './vec';

export const FEET = ['left', 'right'] as const;
export type Foot = (typeof FEET)[number];

/** One foot: where it is planted on the floor and, while stepping, its progress and target. */
export interface FootState {
  /** World ground position of the planted foot (while stepping: where it lifted from). */
  readonly planted: Vec2;
  /** Height (m) of the ground the planted foot stands on. */
  readonly y: number;
  /** The step in progress, or null while planted. `tick` counts Ticks since lift-off; `y` is the target's ground height. */
  readonly step: { readonly tick: number; readonly target: Vec2; readonly y: number } | null;
}

export type GaitState = Readonly<Record<Foot, FootState>>;

/** Where a foot is this Tick: its world ground position, that ground's height, and how high its ankle is lifted above ankle height. */
export interface FootPose {
  readonly ground: Vec2;
  readonly y: number;
  readonly lift: number;
}

/** How far the body moved over the floor this Tick: its ground displacement (m) and turn (radians). */
interface BodyMotion {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** Distances (m) closer than this count as a tie when choosing which foot steps first. */
const TIE = 1e-6;

const stepTicks = (tuning: TuningData): number => Math.max(1, secondsToTicks(tuning.gait.stepDuration));

/** How far through a step (0 at lift-off, 1 at landing). */
const stepProgress = (step: NonNullable<FootState['step']>, tuning: TuningData): number => Math.min(1, step.tick / stepTicks(tuning));

/** The step's arc at progress u: 0 at lift-off and landing, 1 mid-step. */
const arc = (u: number): number => 4 * u * (1 - u);

/** Fighter-local ground point → world, matching solveSkeleton's frame. */
function toWorld(local: Vec2, at: Placement): Vec2 {
  const c = Math.cos(at.facing);
  const s = Math.sin(at.facing);
  return { x: -local.x * c + local.z * s + at.position.x, z: local.x * s + local.z * c + at.position.z };
}

/** World ground point → Fighter-local (the frame rotation is its own inverse). */
export function toLocal(world: Vec2, at: Placement): Vec2 {
  const c = Math.cos(at.facing);
  const s = Math.sin(at.facing);
  const dx = world.x - at.position.x;
  const dz = world.z - at.position.z;
  return { x: -dx * c + dz * s, z: dx * s + dz * c };
}

/** Each foot's home: the Motion's foot target (or kicking ankle's ground point) (as `weapon` plays it) placed at `at`, in world space. */
export function footHome(tuning: TuningData, weapon: string, motion: MotionPlayback, at: Placement): Record<Foot, Vec2> {
  const targets = playbackTargets(tuning, weapon, motion);
  // A foot the Motion owns (kickFoot) is where its ankle is, on the floor under it.
  return { left: toWorld(targets.leftFoot, at), right: toWorld(targets.kickFoot ?? targets.rightFoot, at) };
}

/** The feet the Motion owns this Tick, so the Gait leaves them to it: the right one for a Kick, both for a body laid down. */
export function ownedFeet(tuning: TuningData, weapon: string, motion: MotionPlayback): Record<Foot, boolean> {
  const targets = playbackTargets(tuning, weapon, motion);
  const lying = (targets.body?.tilt ?? 0) !== 0;
  return { left: lying, right: lying || targets.kickFoot !== undefined };
}

/** Each leg's hip joint projected onto the floor, in world space. */
function hips(tuning: TuningData, weapon: string, motion: MotionPlayback, at: Placement): Record<Foot, Vec2> {
  const { hip } = playbackTargets(tuning, weapon, motion);
  const half = tuning.skeleton.hipWidth / 2;
  return { left: toWorld({ x: hip.x - half, z: hip.z }, at), right: toWorld({ x: hip.x + half, z: hip.z }, at) };
}

/** Both feet planted at the home of `motion` (as `weapon` plays it) at `at` (the start of a Duel), on the body's own level. */
export function initialGait(tuning: TuningData, weapon: string, motion: MotionPlayback, at: Placement): GaitState {
  const home = footHome(tuning, weapon, motion, at);
  const y = at.y ?? 0;
  return { left: { planted: home.left, y, step: null }, right: { planted: home.right, y, step: null } };
}

/** The height of the ground a foot at `p` stands on, for a body standing at `bodyY`: the Walk Surface there within a step, else the body's own level. */
export function footGround(arena: ArenaGeometry, p: Vec2, bodyY: number, tuning: TuningData): number {
  const g = groundBelow(arena, p.x, p.z, bodyY + tuning.fall.stepUp);
  return g && g.y >= bodyY - tuning.fall.snapDown ? g.y : bodyY;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const smooth = (u: number) => u * u * (3 - 2 * u);

/** Where a foot is drawn and solved this Tick. */
export function footPose(foot: FootState, tuning: TuningData): FootPose {
  if (!foot.step) return { ground: foot.planted, y: foot.y, lift: 0 };
  const u = stepProgress(foot.step, tuning);
  const k = smooth(u);
  return { ground: lerp2(foot.planted, foot.step.target, k), y: foot.y + (foot.step.y - foot.y) * k, lift: tuning.gait.stepHeight * arc(u) };
}

/** How much of the leg's full length (thigh + shin) the Gait lets a stride use, so a straddling knee keeps a little bend. */
const REACH = 0.97;

/**
 * How far the hips are shifted this Tick, for a Fighter at `at` whose Motion
 * puts its hips at `hip` and its feet at `home` (Fighter-local). While a foot
 * steps, the pelvis dips by the hip bob and shifts sideways toward the planted
 * foot (wherever it is relative to the hips) by the hip sway, both peaking
 * mid-step and zero at lift-off and landing. On top of that, whenever the Gait
 * has a foot further from its hip than the leg reaches from the Motion's hip
 * height, the pelvis sinks until it reaches (only by what the Gait adds: a
 * Motion's own feet out of reach are left as authored).
 */
export function hipShift(gait: GaitState, at: Placement, hip: Vec3, home: Record<Foot, Vec2>, tuning: TuningData): HipShift {
  const stepping = FEET.find((foot) => gait[foot].step);
  const h = stepping ? arc(stepProgress(gait[stepping].step!, tuning)) : 0;
  const planted = stepping && toLocal(gait[stepping === 'left' ? 'right' : 'left'].planted, at);
  const sideways = planted ? Math.sign(planted.x - hip.x) * tuning.gait.hipSway * h : 0;
  const bob = tuning.gait.hipBob * h;
  const { thigh, shin, hipWidth, ankleHeight } = tuning.skeleton;
  const leg = REACH * (thigh + shin);
  /** How far the pelvis must sink for a leg to reach a foot `across` (m) away on the floor whose ankle is `rise` (m) above the Fighter's level. */
  const sink = (across: number, rise: number) => Math.max(0, hip.y - bob - ankleHeight - rise - Math.sqrt(Math.max(0, leg * leg - across * across)));
  let reach = 0;
  for (const foot of FEET) {
    const side = foot === 'left' ? -hipWidth / 2 : hipWidth / 2;
    const pose = footPose(gait[foot], tuning);
    const p = toLocal(pose.ground, at);
    const gaitSink = sink(Math.hypot(p.x - (hip.x + sideways + side), p.z - hip.z), pose.y - (at.y ?? 0) + pose.lift);
    const motionSink = sink(Math.hypot(home[foot].x - (hip.x + side), home[foot].z - hip.z), 0);
    reach = Math.max(reach, gaitSink - motionSink);
  }
  return { sideways, drop: bob + reach };
}

/** Wrap a yaw difference into (-π, π]. */
function wrapYaw(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}

/**
 * Advance the Gait one Tick. `before` is the Fighter at the end of last Tick,
 * `after` the same Fighter with this Tick's settled position, facing and Motion.
 */
export function updateGait(before: FighterState, after: FighterState, fighter: number, tuning: TuningData, arena: ArenaGeometry, emit: Emit): GaitState {
  const ticks = stepTicks(tuning);
  const ground = (p: Vec2) => footGround(arena, p, after.y, tuning);
  if (after.air || before.air) {
    // In the air the feet hang under the body; on the Tick it lands they plant at their home.
    const home = footHome(tuning, after.weapon, after.motion, after);
    const plant = (p: Vec2): FootState => ({ planted: p, y: after.air ? after.y : ground(p), step: null });
    return { left: plant(home.left), right: plant(home.right) };
  }
  const owned = ownedFeet(tuning, after.weapon, after.motion);
  const body: BodyMotion = { x: after.position.x - before.position.x, z: after.position.z - before.position.z, yaw: wrapYaw(after.facing - before.facing) };
  const still = body.x === 0 && body.z === 0 && body.yaw === 0;
  const here = footHome(tuning, after.weapon, after.motion, after);
  /** Where each foot belongs `inTicks` from now (the body's lead added), or its home while the body stands. */
  const belongs = (inTicks: number) => (still ? here : ledFootHome(here, after, body, inTicks, tuning));
  const ahead = belongs(ticks / 2);

  const next: Record<Foot, FootState> = { ...before.gait };
  // 1. Stepping feet advance; a foot that reaches the end of its step lands.
  for (const foot of FEET) {
    const f = next[foot];
    if (!f.step || owned[foot]) continue;
    const t = f.step.tick + 1;
    if (t >= ticks) {
      next[foot] = { planted: ahead[foot], y: ground(ahead[foot]), step: null };
      emit({ type: 'Step', fighter, foot, position: ahead[foot] });
    } else {
      // Aim where the foot will belong when it lands, so it holds still in the world while the body keeps a steady pace.
      const target = belongs(ticks - t + ticks / 2)[foot];
      next[foot] = { planted: f.planted, y: f.y, step: { tick: t, target, y: ground(target) } };
    }
  }
  // 2. A standing body lets planted feet glide toward their home (at most a stride per step duration).
  if (still) {
    const glide = tuning.gait.strideThreshold / ticks;
    for (const foot of FEET) {
      const f = next[foot];
      if (f.step || owned[foot]) continue;
      const d = dist(f.planted, here[foot]);
      if (d > 0 && d <= tuning.gait.strideThreshold) {
        const planted = d <= glide ? here[foot] : lerp2(f.planted, here[foot], glide / d);
        next[foot] = { planted, y: ground(planted), step: null };
      }
    }
  }
  // 3. One planted foot too far from where it belongs starts a step, if the other foot is planted.
  if (!next.left.step && !next.right.step) {
    const off = (foot: Foot) => dist(next[foot].planted, ahead[foot]);
    const qualifies = FEET.filter((foot) => !owned[foot] && off(foot) > tuning.gait.strideThreshold);
    if (qualifies.length > 0) {
      const hip = hips(tuning, after.weapon, after.motion, after);
      const reach = (foot: Foot) => dist(next[foot].planted, hip[foot]);
      const first = (a: Foot, b: Foot): Foot => {
        const d = off(b) - off(a);
        if (Math.abs(d) > TIE) return d > 0 ? b : a;
        return reach(b) > reach(a) ? b : a;
      };
      const foot = qualifies.reduce(first);
      const target = belongs(ticks + ticks / 2)[foot];
      next[foot] = { planted: next[foot].planted, y: next[foot].y, step: { tick: 0, target, y: ground(target) } };
    }
  }
  // 4. A foot the Motion owns is planted where the Motion puts it (a stepping one stops where it is).
  for (const foot of FEET) {
    if (owned[foot]) next[foot] = { planted: here[foot], y: ground(here[foot]), step: null };
  }
  return next;
}

/**
 * Each foot's home where the body will be `inTicks` from now if it keeps
 * moving as it did this Tick, led at most the max lead ahead of the current home.
 */
function ledFootHome(here: Record<Foot, Vec2>, after: FighterState, body: BodyMotion, inTicks: number, tuning: TuningData): Record<Foot, Vec2> {
  const future = footHome(tuning, after.weapon, after.motion, {
    position: { x: after.position.x + body.x * inTicks, z: after.position.z + body.z * inTicks },
    facing: after.facing + body.yaw * inTicks,
  });
  const { maxLead } = tuning.gait;
  const led = (foot: Foot): Vec2 => {
    const d = dist(future[foot], here[foot]);
    return d <= maxLead ? future[foot] : lerp2(here[foot], future[foot], maxLead / d);
  };
  return { left: led('left'), right: led('right') };
}
