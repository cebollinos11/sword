/**
 * The Gait: procedural stepping of a Fighter's legs whenever its body moves
 * over the floor (walking, turning, being pushed). It runs inside the Tick
 * (ADR 0003), after bodies are settled, so the solved legs (and their Hit
 * Zones) always match what is drawn, and its state is snapshotted and hashed.
 *
 * Rules, per Tick, for each foot:
 *   - Its home is the current Motion's foot target at the Fighter's position
 *     and facing. The place it belongs is that home led along the body's
 *     motion this Tick: where the home will be one step from now if the body
 *     keeps moving, at most 80% of the stride threshold ahead. A standing body
 *     has no lead. The lead lands a walking foot ahead of the body, so a foot
 *     stays within the leg's reach until its next step.
 *   - A stepping foot moves from where it lifted to that place (re-evaluated each Tick)
 *     over the step duration, along an arc up to the step height, then lands:
 *     it is planted again and a `Step` event is emitted.
 *   - A planted foot stays fixed while the body moves. Once it is more than the
 *     stride threshold from where it belongs it starts a step, but only while
 *     the other foot is planted. When both qualify, the one further off goes
 *     first; on a tie (a straight walk from a standstill), the one further from
 *     its hip goes first, since it runs out of reach first.
 *   - While the body stands still, a planted foot within the stride threshold
 *     glides along the floor toward its home (so authored foot keys and the
 *     settle after a walk stay smooth); further off, it steps.
 *
 * The hips bob and sway with each step (hipShift), swaying toward wherever the
 * planted foot actually is (so Motions with crossed feet sway the right way); the hands and blade still
 * come from the Motion, so walking never changes a Blade Sweep.
 */
import type { TuningData } from '../tuning';
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
  /** The step in progress, or null while planted. `tick` counts Ticks since lift-off. */
  readonly step: { readonly tick: number; readonly target: Vec2 } | null;
}

export type GaitState = Readonly<Record<Foot, FootState>>;

/** Where a foot is this Tick: its world ground position and how high its ankle is lifted above ankle height. */
export interface FootPose {
  readonly ground: Vec2;
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

/** Each foot's home: the Motion's foot target (as `weapon` plays it) placed at `at`, in world space. */
export function footHome(tuning: TuningData, weapon: string, motion: MotionPlayback, at: Placement): Record<Foot, Vec2> {
  const targets = playbackTargets(tuning, weapon, motion);
  return { left: toWorld(targets.leftFoot, at), right: toWorld(targets.rightFoot, at) };
}

/** Each leg's hip joint projected onto the floor, in world space. */
function hips(tuning: TuningData, weapon: string, motion: MotionPlayback, at: Placement): Record<Foot, Vec2> {
  const { hip } = playbackTargets(tuning, weapon, motion);
  const half = tuning.skeleton.hipWidth / 2;
  return { left: toWorld({ x: hip.x - half, z: hip.z }, at), right: toWorld({ x: hip.x + half, z: hip.z }, at) };
}

/** Both feet planted at the home of `motion` (as `weapon` plays it) at `at` (the start of a Duel). */
export function initialGait(tuning: TuningData, weapon: string, motion: MotionPlayback, at: Placement): GaitState {
  const home = footHome(tuning, weapon, motion, at);
  return { left: { planted: home.left, step: null }, right: { planted: home.right, step: null } };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const smooth = (u: number) => u * u * (3 - 2 * u);

/** Where a foot is drawn and solved this Tick. */
export function footPose(foot: FootState, tuning: TuningData): FootPose {
  if (!foot.step) return { ground: foot.planted, lift: 0 };
  const u = stepProgress(foot.step, tuning);
  return { ground: lerp2(foot.planted, foot.step.target, smooth(u)), lift: tuning.gait.stepHeight * arc(u) };
}

/**
 * How far the hips are shifted this Tick, for a Fighter at `at` whose Motion
 * puts its hips at `hip` (Fighter-local). While a foot steps, the pelvis dips
 * by the hip bob and shifts sideways toward the planted foot (wherever it is
 * relative to the hips) by the hip sway, both peaking mid-step and zero at
 * lift-off and landing. With both feet planted it is zero.
 */
export function hipShift(gait: GaitState, at: Placement, hip: Vec3, tuning: TuningData): HipShift {
  const stepping = FEET.find((foot) => gait[foot].step);
  if (!stepping) return { sideways: 0, drop: 0 };
  const h = arc(stepProgress(gait[stepping].step!, tuning));
  const planted = toLocal(gait[stepping === 'left' ? 'right' : 'left'].planted, at);
  return { sideways: Math.sign(planted.x - hip.x) * tuning.gait.hipSway * h, drop: tuning.gait.hipBob * h };
}

/** Wrap a yaw difference into (-π, π]. */
function wrapYaw(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}

/**
 * Advance the Gait one Tick. `before` is the Fighter at the end of last Tick,
 * `after` the same Fighter with this Tick's settled position, facing and Motion.
 */
export function updateGait(before: FighterState, after: FighterState, fighter: number, tuning: TuningData, emit: Emit): GaitState {
  const ticks = stepTicks(tuning);
  const body: BodyMotion = { x: after.position.x - before.position.x, z: after.position.z - before.position.z, yaw: wrapYaw(after.facing - before.facing) };
  const still = body.x === 0 && body.z === 0 && body.yaw === 0;
  const here = footHome(tuning, after.weapon, after.motion, after);
  const ahead = still ? here : ledFootHome(here, after, body, ticks, tuning);

  const next: Record<Foot, FootState> = { ...before.gait };
  // 1. Stepping feet advance; a foot that reaches the end of its step lands.
  for (const foot of FEET) {
    const f = next[foot];
    if (!f.step) continue;
    const t = f.step.tick + 1;
    if (t >= ticks) {
      next[foot] = { planted: ahead[foot], step: null };
      emit({ type: 'Step', fighter, foot, position: ahead[foot] });
    } else next[foot] = { planted: f.planted, step: { tick: t, target: ahead[foot] } };
  }
  // 2. A standing body lets planted feet glide toward their home (at most a stride per step duration).
  if (still) {
    const glide = tuning.gait.strideThreshold / ticks;
    for (const foot of FEET) {
      const f = next[foot];
      if (f.step) continue;
      const d = dist(f.planted, here[foot]);
      if (d > 0 && d <= tuning.gait.strideThreshold) {
        next[foot] = { planted: d <= glide ? here[foot] : lerp2(f.planted, here[foot], glide / d), step: null };
      }
    }
  }
  // 3. One planted foot too far from where it belongs starts a step, if the other foot is planted.
  if (!next.left.step && !next.right.step) {
    const off = (foot: Foot) => dist(next[foot].planted, ahead[foot]);
    const qualifies = FEET.filter((foot) => off(foot) > tuning.gait.strideThreshold);
    if (qualifies.length > 0) {
      const hip = hips(tuning, after.weapon, after.motion, after);
      const reach = (foot: Foot) => dist(next[foot].planted, hip[foot]);
      const first = (a: Foot, b: Foot): Foot => {
        const d = off(b) - off(a);
        if (Math.abs(d) > TIE) return d > 0 ? b : a;
        return reach(b) > reach(a) ? b : a;
      };
      const foot = qualifies.reduce(first);
      next[foot] = { planted: next[foot].planted, step: { tick: 0, target: ahead[foot] } };
    }
  }
  return next;
}

/**
 * Each foot's home where the body will be one step from now if it keeps
 * moving as it did this Tick, led at most 80% of the stride threshold ahead of
 * the current home (so a foot that just landed never qualifies straight away).
 */
function ledFootHome(here: Record<Foot, Vec2>, after: FighterState, body: BodyMotion, ticks: number, tuning: TuningData): Record<Foot, Vec2> {
  const future = footHome(tuning, after.weapon, after.motion, {
    position: { x: after.position.x + body.x * ticks, z: after.position.z + body.z * ticks },
    facing: after.facing + body.yaw * ticks,
  });
  const maxLead = 0.8 * tuning.gait.strideThreshold;
  const led = (foot: Foot): Vec2 => {
    const d = dist(future[foot], here[foot]);
    return d <= maxLead ? future[foot] : lerp2(here[foot], future[foot], maxLead / d);
  };
  return { left: led('left'), right: led('right') };
}
