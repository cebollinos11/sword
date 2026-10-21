/**
 * The Gait: procedural stepping of a Fighter's legs whenever its body moves
 * over the floor (walking, turning, being pushed). It runs inside the Tick
 * (ADR 0003), after bodies are settled, so the solved legs (and their Hit
 * Zones) always match what is drawn, and its state is snapshotted and hashed.
 *
 * Rules, per Tick, for each foot:
 *   - Its home is the current Motion's foot target at the Fighter's position
 *     and facing. Walking forward or back draws the feet's front-to-back
 *     stagger in under the hips (by the square-up, in full at full walk
 *     speed), so a fencing stance does not limp.
 *   - The walk is paced like a person's: footfalls land a stride apart that
 *     grows with the square root of the speed (the stride length at full walk
 *     speed), each swing takes the step duration, and a foot stays planted for
 *     the rest (its stance), so a slow walk steps less often and has both feet
 *     down between steps, while at full speed one foot lifts as the other lands.
 *   - The place a foot belongs is its home led along the body's motion this
 *     Tick: where the home will be half a stance from now if the body keeps
 *     moving (half a step for a turn), at most the max lead ahead (above full
 *     walk speed, as a Sheathed Fighter walks, the max lead grows with the
 *     square root of the speed, so the stride lengthens and the cadence rises
 *     a little, keeping the hips from sinking into a lunge). A standing
 *     body has no lead. So a walking foot lands as far ahead of its home as
 *     the body then carries it behind before it next lifts.
 *   - A stepping foot moves from where it lifted to where it will belong when
 *     it lands (re-evaluated each Tick, so it holds still in the world while
 *     the body keeps a steady pace) over the step duration (or quicker, down to
 *     a third of it, when the body would otherwise carry the other foot further
 *     than a stance before it lands: the first step off a standstill), along an arc up to
 *     the step height, then lands: it is planted again and a `Step` event is emitted.
 *     Stepping forward it rolls off its toes and lands heel first (back, the
 *     reverse), up to the toe roll.
 *   - A planted foot stays fixed while the body moves. Once it is further from
 *     where it belongs than the stride threshold, or than the body carries it
 *     over a stance if that is further, it starts a step, but only while
 *     the other foot is planted; the further-off foot also steps as soon as
 *     waiting would let a full step carry the other foot past a stance. When both qualify, the one further off goes
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
 * planted foot actually is (so Motions with crossed feet sway the right way), sink as
 * far as a long stride needs to keep both feet within the legs' reach, and turn toward
 * the forward foot (the shoulders turn back half as far); the hands and blade still
 * come from the Motion, so walking never changes a Blade Sweep.
 */
import type { ArenaGeometry, TuningData } from '../tuning';
import { groundBelow } from './arena';
import { secondsToTicks, TICK_SECONDS } from './constants';
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
  /** The step in progress, or null while planted. `tick` counts Ticks since lift-off, of the `ticks` it lasts; `y` is the target's ground height. */
  readonly step: { readonly tick: number; readonly ticks: number; readonly target: Vec2; readonly y: number } | null;
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

/** The quickest a step may be (a third of a full one): the first step from a standstill, or catching up with a body moving off. */
const minStepTicks = (ticks: number): number => Math.max(1, Math.round(ticks / 3));

/** How far through a step (0 at lift-off, 1 at landing). */
const stepProgress = (step: NonNullable<FootState['step']>): number => Math.min(1, step.tick / step.ticks);

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

/**
 * Each foot's home: the Motion's foot target (or kicking ankle's ground point) (as `weapon` plays it) placed at `at`, in world space,
 * with the feet's front-to-back stagger drawn in under the hips by `squareUp` (0 keeps the Motion's stance, 1 puts both level with the hips).
 */
export function footHome(tuning: TuningData, weapon: string, motion: MotionPlayback, at: Placement, squareUp = 0): Record<Foot, Vec2> {
  const targets = playbackTargets(tuning, weapon, motion);
  const square = (p: Vec2): Vec2 => (squareUp === 0 ? p : { x: p.x, z: p.z + (targets.hip.z - p.z) * squareUp });
  // A foot the Motion owns (kickFoot) is where its ankle is, on the floor under it.
  return { left: toWorld(square(targets.leftFoot), at), right: toWorld(targets.kickFoot ?? square(targets.rightFoot), at) };
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
  const u = stepProgress(foot.step);
  const k = smooth(u);
  return { ground: lerp2(foot.planted, foot.step.target, k), y: foot.y + (foot.step.y - foot.y) * k, lift: tuning.gait.stepHeight * arc(u) };
}

/**
 * How far (degrees, + toe up) a foot is pitched this Tick, for a Fighter at `at`: flat while planted; mid-step it rolls off its
 * toes and then raises them to land heel first, by the toe roll, as far as the step goes forward (the reverse stepping back, none sideways).
 */
export function footPitch(foot: FootState, at: Placement, tuning: TuningData): number {
  if (!foot.step) return 0;
  const [from, to] = [toLocal(foot.planted, at), toLocal(foot.step.target, at)];
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  if (length < TIE) return 0;
  const forward = (to.z - from.z) / length;
  return -tuning.gait.toeRoll * forward * Math.sin(2 * Math.PI * stepProgress(foot.step));
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
 * Motion's own feet out of reach are left as authored). And the pelvis turns
 * toward whichever foot the Gait has further forward of its home, by the hip
 * twist when they are a full-speed stride apart (no more beyond that).
 */
export function hipShift(gait: GaitState, at: Placement, hip: Vec3, home: Record<Foot, Vec2>, tuning: TuningData): HipShift {
  const stepping = FEET.find((foot) => gait[foot].step);
  const h = stepping ? arc(stepProgress(gait[stepping].step!)) : 0;
  const planted = stepping && toLocal(gait[stepping === 'left' ? 'right' : 'left'].planted, at);
  const sideways = planted ? Math.sign(planted.x - hip.x) * tuning.gait.hipSway * h : 0;
  const bob = tuning.gait.hipBob * h;
  const forward = (foot: Foot) => toLocal(footPose(gait[foot], tuning).ground, at).z - home[foot].z;
  const twist = tuning.gait.hipTwist * Math.max(-1, Math.min(1, (forward('right') - forward('left')) / tuning.gait.strideLength));
  const { thigh, shin, hipWidth, ankleHeight } = tuning.skeleton;
  const leg = REACH * (thigh + shin);
  /** How far the pelvis must sink for a leg to reach a foot `across` (m) away on the floor whose ankle is `rise` (m) above the Fighter's level. */
  const sink = (across: number, rise: number) => Math.max(0, hip.y - bob - ankleHeight - rise - Math.sqrt(Math.max(0, leg * leg - across * across)));
  // Each hip joint off the pelvis, turned as the twist turns it (the right hip forward for a + twist).
  const t = (twist * Math.PI) / 180;
  const half = hipWidth / 2;
  let reach = 0;
  for (const foot of FEET) {
    const side = foot === 'left' ? -1 : 1;
    const pose = footPose(gait[foot], tuning);
    const p = toLocal(pose.ground, at);
    const gaitSink = sink(Math.hypot(p.x - (hip.x + sideways + side * half * Math.cos(t)), p.z - (hip.z + side * half * Math.sin(t))), pose.y - (at.y ?? 0) + pose.lift);
    const motionSink = sink(Math.hypot(home[foot].x - (hip.x + side * half), home[foot].z - hip.z), 0);
    reach = Math.max(reach, gaitSink - motionSink);
  }
  return { sideways, drop: bob + reach, twist };
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
  const { stanceTravel, squareUp } = pace(body, after, ticks, tuning);
  /** Where each foot will belong `inTicks` from now (the body's lead added), or its home while the body stands. */
  const belongs = (inTicks: number) => (still ? here : ledFootHome(after, body, inTicks, stanceTravel / 2, ticks / 2, squareUp, tuning));
  const ahead = belongs(0);

  const next: Record<Foot, FootState> = { ...before.gait };
  // 1. Stepping feet advance; a foot that reaches the end of its step lands.
  for (const foot of FEET) {
    const f = next[foot];
    if (!f.step || owned[foot]) continue;
    const t = f.step.tick + 1;
    if (t >= f.step.ticks) {
      next[foot] = { planted: ahead[foot], y: ground(ahead[foot]), step: null };
      emit({ type: 'Step', fighter, foot, position: ahead[foot] });
    } else {
      // Aim where the foot will belong when it lands, so it holds still in the world while the body keeps a steady pace.
      const target = belongs(f.step.ticks - t)[foot];
      next[foot] = { planted: f.planted, y: f.y, step: { tick: t, ticks: f.step.ticks, target, y: ground(target) } };
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
    const other = (foot: Foot): Foot => (foot === 'left' ? 'right' : 'left');
    const threshold = Math.max(tuning.gait.strideThreshold, stanceTravel);
    const speed = Math.hypot(body.x, body.z);
    // The foot further off also steps early, once waiting would carry the other foot past a stance before a full step could land.
    const early = (foot: Foot) => !owned[other(foot)] && off(foot) >= off(other(foot)) && off(other(foot)) + speed * ticks > threshold;
    const qualifies = FEET.filter((foot) => !owned[foot] && (off(foot) > threshold || early(foot)));
    if (qualifies.length > 0) {
      const hip = hips(tuning, after.weapon, after.motion, after);
      const reach = (foot: Foot) => dist(next[foot].planted, hip[foot]);
      const first = (a: Foot, b: Foot): Foot => {
        const d = off(b) - off(a);
        if (Math.abs(d) > TIE) return d > 0 ? b : a;
        return reach(b) > reach(a) ? b : a;
      };
      const foot = qualifies.reduce(first);
      // A full step, or a quicker one if the body would otherwise carry the other foot past a stance before it lands.
      const quick = speed === 0 || owned[other(foot)] ? ticks : Math.round((threshold - off(other(foot))) / speed);
      const length = Math.max(minStepTicks(ticks), Math.min(ticks, quick));
      const target = belongs(length)[foot];
      next[foot] = { planted: next[foot].planted, y: next[foot].y, step: { tick: 0, ticks: length, target, y: ground(target) } };
    }
  }
  // 4. A foot the Motion owns is planted where the Motion puts it (a stepping one stops where it is).
  for (const foot of FEET) {
    if (owned[foot]) next[foot] = { planted: here[foot], y: ground(here[foot]), step: null };
  }
  return next;
}

/**
 * How far (m) a foot may lead its home at this speed (m per Tick): the max lead, grown with the square root of the speed above
 * full walk speed (a Sheathed walk), so a faster walk lengthens its stride and steps a little more often, rather than only taking
 * strides so long the hips sink into a lunge.
 */
const maxLead = (speed: number, tuning: TuningData): number => tuning.gait.maxLead * Math.sqrt(Math.max(1, speed / (tuning.fighter.walkSpeed * TICK_SECONDS)));

/**
 * How a steady walk at this Tick's speed is paced: how far the body carries a
 * planted foot over its stance (at most twice the max lead), and how far its
 * home squares up. Footfalls land the stride length × √(speed / walk speed)
 * apart, no sooner than one step duration apart; each foot is planted for
 * two of those intervals less its own swing.
 */
function pace(body: BodyMotion, at: Placement, ticks: number, tuning: TuningData): { readonly stanceTravel: number; readonly squareUp: number } {
  const speed = Math.hypot(body.x, body.z); // m per Tick
  if (speed === 0) return { stanceTravel: 0, squareUp: 0 };
  const full = tuning.fighter.walkSpeed * TICK_SECONDS;
  const stride = tuning.gait.strideLength * Math.sqrt(Math.min(1, speed / full));
  const stance = 2 * Math.max(ticks, stride / speed) - ticks;
  const forward = Math.abs(toLocal({ x: at.position.x + body.x, z: at.position.z + body.z }, at).z);
  return { stanceTravel: Math.min(speed * stance, 2 * maxLead(speed, tuning)), squareUp: tuning.gait.squareUp * Math.min(1, forward / full) };
}

/**
 * Each foot's home where the body will be `inTicks` from now if it keeps
 * moving as it did this Tick, led a further `lead` (m) along its path and
 * `turnTicks` along its turn, at most the max lead ahead of where it will be.
 */
function ledFootHome(after: FighterState, body: BodyMotion, inTicks: number, lead: number, turnTicks: number, squareUp: number, tuning: TuningData): Record<Foot, Vec2> {
  const speed = Math.hypot(body.x, body.z);
  const ahead = inTicks + (speed === 0 ? 0 : lead / speed);
  const at = (move: number, turn: number) =>
    footHome(tuning, after.weapon, after.motion, { position: { x: after.position.x + body.x * move, z: after.position.z + body.z * move }, facing: after.facing + body.yaw * turn }, squareUp);
  const [then, future] = [at(inTicks, inTicks), at(ahead, inTicks + turnTicks)];
  const most = maxLead(speed, tuning);
  const led = (foot: Foot): Vec2 => {
    const d = dist(future[foot], then[foot]);
    return d <= most ? future[foot] : lerp2(then[foot], future[foot], most / d);
  };
  return { left: led('left'), right: led('right') };
}
