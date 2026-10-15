/**
 * The Gait: procedural stepping of a Fighter's legs whenever its body moves
 * over the floor (walking, turning, being pushed). It runs inside the Tick
 * (ADR 0003), after bodies are settled, so the solved legs (and their Hit
 * Zones) always match what is drawn, and its state is snapshotted and hashed.
 *
 * Rules, per Tick, for each foot:
 *   - Its stance is the current Motion's foot target at the Fighter's position
 *     and facing. The place it belongs is that stance led along the body's
 *     motion this Tick: where the stance will be one step from now if the body
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
 *     glides along the floor toward its stance (so authored foot keys and the
 *     settle after a walk stay smooth); further off, it steps.
 *
 * The Gait owns the feet only: hands, torso and blade come from the Motion.
 */
import type { TuningData } from '../tuning';
import { secondsToTicks } from './constants';
import type { Emit } from './events';
import { motionTime, sampleMotion } from './motion';
import type { Placement } from './skeleton';
import type { FighterState, MotionPlayback, Vec2 } from './state';

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

const stepTicks = (tuning: TuningData): number => Math.max(1, secondsToTicks(tuning.gait.stepDuration));

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

function sampleTargets(tuning: TuningData, motion: MotionPlayback) {
  const m = tuning.motions[motion.name];
  if (!m) throw new Error(`Unknown Motion "${motion.name}"`);
  return sampleMotion(m, motionTime(m, motion.tick), tuning.skeleton);
}

/** Each foot's stance: the Motion's foot target placed at `at`, in world space. */
export function stance(tuning: TuningData, motion: MotionPlayback, at: Placement): Record<Foot, Vec2> {
  const targets = sampleTargets(tuning, motion);
  return { left: toWorld(targets.leftFoot, at), right: toWorld(targets.rightFoot, at) };
}

/** Each leg's hip joint projected onto the floor, in world space. */
function hips(tuning: TuningData, motion: MotionPlayback, at: Placement): Record<Foot, Vec2> {
  const { hip } = sampleTargets(tuning, motion);
  const half = tuning.skeleton.hipWidth / 2;
  return { left: toWorld({ x: hip.x - half, z: hip.z }, at), right: toWorld({ x: hip.x + half, z: hip.z }, at) };
}

/** Both feet planted in the stance of `motion` at `at` (the start of a Duel). */
export function initialGait(tuning: TuningData, motion: MotionPlayback, at: Placement): GaitState {
  const s = stance(tuning, motion, at);
  return { left: { planted: s.left, step: null }, right: { planted: s.right, step: null } };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const smooth = (u: number) => u * u * (3 - 2 * u);

/** Where a foot is drawn and solved this Tick. */
export function footPose(foot: FootState, tuning: TuningData): FootPose {
  if (!foot.step) return { ground: foot.planted, lift: 0 };
  const u = Math.min(1, foot.step.tick / stepTicks(tuning));
  return { ground: lerp2(foot.planted, foot.step.target, smooth(u)), lift: tuning.gait.stepHeight * 4 * u * (1 - u) };
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
  const dx = after.position.x - before.position.x;
  const dz = after.position.z - before.position.z;
  const dYaw = wrapYaw(after.facing - before.facing);
  const still = dx === 0 && dz === 0 && dYaw === 0;
  const here = stance(tuning, after.motion, after);
  const ahead = still ? here : ledStance(here, after, dx, dz, dYaw, ticks, tuning);

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
  // 2. A standing body lets planted feet glide toward the stance (at most a stride per step duration).
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
      const hip = hips(tuning, after.motion, after);
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

/** Distances (m) closer than this count as a tie when choosing which foot steps first. */
const TIE = 1e-6;

/**
 * Each foot's stance where the body will be one step from now if it keeps
 * moving as it did this Tick, led at most 80% of the stride threshold ahead of
 * the current stance (so a foot that just landed never qualifies straight away).
 */
function ledStance(here: Record<Foot, Vec2>, after: FighterState, dx: number, dz: number, dYaw: number, ticks: number, tuning: TuningData): Record<Foot, Vec2> {
  const future = stance(tuning, after.motion, {
    position: { x: after.position.x + dx * ticks, z: after.position.z + dz * ticks },
    facing: after.facing + dYaw * ticks,
  });
  const maxLead = 0.8 * tuning.gait.strideThreshold;
  const led = (foot: Foot): Vec2 => {
    const d = dist(future[foot], here[foot]);
    return d <= maxLead ? future[foot] : lerp2(here[foot], future[foot], maxLead / d);
  };
  return { left: led('left'), right: led('right') };
}
