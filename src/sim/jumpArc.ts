/**
 * `jumpArc`: where a Jump comes down. From a takeoff point, a heading and how many Ticks Jump is held, it runs the
 * Jump through the same steps the Simulation's Tick runs a Fighter through (`air.ts`: take-off, flight, head bump,
 * landing, and the Wall push-out of body collision), so the prediction is exact for a Fighter alone. The navmesh
 * uses it to find jump Links, the AI to check its Jumps and to predict where an airborne opponent lands.
 * Pure functions of Tuning Data and their arguments.
 */
import type { ArenaGeometry, TuningData } from '../tuning';
import { deadlyGround, groundBelow } from './arena';
import { flyBody, landing, settleGround, takeOff, type AirBody } from './air';
import { resolveBodies } from './collision';
import { TICK_SECONDS } from './constants';
import type { Airborne, Vec2 } from './state';

/** A Jump to predict: from feet at `y` at `at`, walking along `heading` (a unit vector, or zero to jump on the spot) at `speed` (m/s, default `fighter.walkSpeed`), holding Jump for `holdTicks` (0 = a tap). */
export interface JumpPlan {
  readonly at: Vec2;
  readonly y: number;
  readonly heading: Vec2;
  readonly holdTicks: number;
  readonly speed?: number;
  /** Stop following it once it comes down below this height (m), as a Jump that must land higher up has failed by then: it reports no landing. */
  readonly giveUpBelow?: number;
}

/** The rest of a flight already under way: a body at `at` with feet at `y` flying `air`, steering along `move` (as `JumpPlan.heading`), Jump held for `holdTicks` more (default 0). */
export interface FlightPlan {
  readonly at: Vec2;
  readonly y: number;
  readonly air: Airborne;
  readonly move: Vec2;
  readonly holdTicks?: number;
  readonly speed?: number;
}

/** A point of a flight: where on the ground plane, and the height of the feet. */
export interface ArcPoint {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

/** Where and how a predicted Jump comes down. */
export interface JumpResult {
  /** Where it lands; null when still airborne after MAX_AIR_TICKS, falling with nothing left below, or below `giveUpBelow`. */
  readonly lands: ArcPoint | null;
  /** The Walk Surface it lands on (index into `arena.walk`), -1 if none. */
  readonly surface: number;
  /** Ticks from takeoff to landing (or to giving up). */
  readonly ticks: number;
  /** The height the Landing counts as dropped (m), as the Simulation's Landing does. */
  readonly drop: number;
  /** The fall damage of that drop. */
  readonly damage: number;
  /** It lands on Lava, Water or an Abyss, or drops far enough to fell a Fighter at full HP (never, after a Jump), or never lands. */
  readonly deadly: boolean;
  /** Where the body is after each Tick, takeoff excluded and the landing last. */
  readonly path: readonly ArcPoint[];
}

/** A predicted flight gives up after this many Ticks (4 s; the longest Jump lasts under 2). */
export const MAX_AIR_TICKS = 240;

const lowest = new WeakMap<ArenaGeometry, number>();

/** The height of the lowest point of any Walk Surface: a body falling below it will never land. */
function lowestGround(arena: ArenaGeometry): number {
  let y = lowest.get(arena);
  if (y === undefined) {
    y = Math.min(...arena.walk.flatMap((s) => s.points.map((p) => p.y)));
    lowest.set(arena, y);
  }
  return y;
}

/** Run a body Tick by Tick from `start` (on the ground about to fly `air`, or already flying it) until it lands. */
function fly(arena: ArenaGeometry, tuning: TuningData, start: AirBody, air0: Airborne, move: Vec2, holdTicks: number, topSpeed: number, giveUpBelow = -Infinity): JumpResult {
  const path: ArcPoint[] = [];
  const floor = Math.max(lowestGround(arena), giveUpBelow);
  let body = start;
  let air = air0;
  for (let tick = 1; tick <= MAX_AIR_TICKS; tick++) {
    const flown = flyBody(body, air, move, tick <= holdTicks, topSpeed, tuning);
    const position = resolveBodies([{ position: flown.position, y: flown.y }], arena, tuning)[0]!;
    const next = settleGround(body, { ...flown, position }, arena, tuning);
    path.push({ x: next.position.x, z: next.position.z, y: next.y });
    if (!next.air) {
      const { drop, damage } = body.air ? landing(body.air, next.y, false, tuning) : { drop: 0, damage: 0 };
      const surface = groundBelow(arena, next.position.x, next.position.z, next.y + 1e-6)?.surface ?? -1;
      const deadly = deadlyGround(arena, next.position.x, next.position.z, next.y) !== null || damage >= tuning.fighter.maxHp;
      return { lands: { x: next.position.x, z: next.position.z, y: next.y }, surface, ticks: tick, drop, damage, deadly, path };
    }
    if (next.y < floor - 1e-6 && next.air.vy < 0) return { lands: null, surface: -1, ticks: tick, drop: 0, damage: 0, deadly: true, path };
    body = next;
    air = next.air;
  }
  return { lands: null, surface: -1, ticks: MAX_AIR_TICKS, drop: 0, damage: 0, deadly: true, path };
}

/** Predict a Jump from the ground: it takes off with its walk (`heading` × speed), keeps walking along `heading` in the air and holds Jump for `holdTicks`. */
export function jumpArc(arena: ArenaGeometry, tuning: TuningData, plan: JumpPlan): JumpResult {
  const speed = plan.speed ?? tuning.fighter.walkSpeed;
  const d = speed * TICK_SECONDS;
  const to = { x: plan.at.x + plan.heading.x * d, z: plan.at.z + plan.heading.z * d };
  const start = { position: plan.at, y: plan.y };
  return fly(arena, tuning, start, takeOff(plan.at, to, plan.y, tuning), plan.heading, plan.holdTicks, speed, plan.giveUpBelow);
}

/** Predict the rest of a flight already under way (an opponent seen in the air: give it no boost, as nothing seen says it holds any). */
export function jumpArcFrom(arena: ArenaGeometry, tuning: TuningData, plan: FlightPlan): JumpResult {
  const speed = plan.speed ?? tuning.fighter.walkSpeed;
  return fly(arena, tuning, { position: plan.at, y: plan.y, air: plan.air }, plan.air, plan.move, plan.holdTicks ?? 0, speed);
}

/** How high and how far a Jump held `holdTicks` reaches on open level ground. */
export interface LevelJump {
  /** The top of its arc (m above takeoff). */
  readonly apex: number;
  /** The distance (m) to where it comes back down to its takeoff height, and the Ticks that takes. */
  readonly distance: number;
  readonly ticks: number;
  /** Where it is after each Tick (distance along, height), on down to `floor`. */
  readonly profile: readonly { readonly d: number; readonly y: number }[];
}

/** A Jump held `holdTicks` over open ground, walking at `fighter.walkSpeed`: the same flight steps with nothing in the way, followed down to `floor` (m, below takeoff at 0). */
export function levelJump(tuning: TuningData, holdTicks: number, floor = 0): LevelJump {
  const d = tuning.fighter.walkSpeed * TICK_SECONDS;
  let body: AirBody = { position: { x: 0, z: 0 }, y: 0 };
  let air = takeOff(body.position, { x: 0, z: d }, 0, tuning);
  let apex = 0;
  let level: { distance: number; ticks: number } | null = null;
  const profile: { d: number; y: number }[] = [];
  for (let tick = 1; tick <= MAX_AIR_TICKS; tick++) {
    const flown = flyBody(body, air, { x: 0, z: 1 }, tick <= holdTicks, tuning.fighter.walkSpeed, tuning);
    apex = Math.max(apex, flown.y);
    profile.push({ d: flown.position.z, y: flown.y });
    if (!level && flown.y <= 0) level = { distance: flown.position.z, ticks: tick };
    if (flown.y <= floor) break;
    body = flown;
    air = flown.air;
  }
  return { apex, ...(level ?? { distance: body.position.z, ticks: MAX_AIR_TICKS }), profile };
}

/**
 * The farthest (m) the near edge of ground `rise` above takeoff (below, if negative) can be for the Jump `level` to
 * get over it with its feet within a step (`fall.stepUp`) of its top; -1 if it never gets that high. An upper bound:
 * a Wall at the edge, or the body's radius, only shortens it.
 */
export function ledgeReach(level: LevelJump, rise: number, tuning: TuningData): number {
  let best = -1;
  for (const p of level.profile) if (p.y >= rise - tuning.fall.stepUp && p.d > best) best = p.d;
  return best;
}

/** The error check moves a Jump's takeoff this far (m) along and across its heading... */
export const JITTER_POS = 0.2;
/** ...holds Jump this many Ticks shorter and longer... */
export const JITTER_HOLD = 1;
/** ...and turns its heading this far (radians) either way. */
export const JITTER_HEADING = (5 * Math.PI) / 180;

/** `v` turned by `a` radians about the vertical (same sense as facing). */
const turned = (v: Vec2, a: number): Vec2 => ({ x: v.x * Math.cos(a) + v.z * Math.sin(a), z: -v.x * Math.sin(a) + v.z * Math.cos(a) });

/**
 * Whether a Jump is safe to make: it, and every variant of the error check (`jumpHolds`), comes down on ground that is
 * not deadly, without fall damage. No damage at all, as any is a hard Landing: its Stagger (`land`, 0.8 s) outlasts
 * the one a jumping Attack's Hit deals (0.5 s), so even a Jump that hits would leave its maker open.
 */
export const jumpIsSafe = (arena: ArenaGeometry, tuning: TuningData, plan: JumpPlan): boolean =>
  jumpHolds(arena, tuning, plan, (r) => r.lands !== null && !r.deadly && r.damage === 0);

/**
 * The error check: whether `plan` still comes down as `ok` wants when carried out a little off, as a Fighter
 * (or the AI) carries it out: every variant with its takeoff moved by JITTER_POS along or across its heading
 * (standing on the ground there), its hold JITTER_HOLD shorter or longer, or its heading turned by JITTER_HEADING,
 * and the plan itself. A variant whose takeoff has no ground within a step fails.
 */
export function jumpHolds(arena: ArenaGeometry, tuning: TuningData, plan: JumpPlan, ok: (r: JumpResult) => boolean): boolean {
  if (!ok(jumpArc(arena, tuning, plan))) return false;
  const { at, heading: h } = plan;
  const across = { x: -h.z, z: h.x };
  const moved = [h, { x: -h.x, z: -h.z }, across, { x: -across.x, z: -across.z }].map((v) => ({ x: at.x + v.x * JITTER_POS, z: at.z + v.z * JITTER_POS }));
  for (const p of moved) {
    const g = groundBelow(arena, p.x, p.z, plan.y + tuning.fall.stepUp);
    if (!g || !ok(jumpArc(arena, tuning, { ...plan, at: p, y: g.y }))) return false;
  }
  for (const hold of [plan.holdTicks - JITTER_HOLD, plan.holdTicks + JITTER_HOLD]) {
    if (hold >= 0 && !ok(jumpArc(arena, tuning, { ...plan, holdTicks: hold }))) return false;
  }
  if (h.x === 0 && h.z === 0) return true;
  return [JITTER_HEADING, -JITTER_HEADING].every((a) => ok(jumpArc(arena, tuning, { ...plan, heading: turned(h, a) })));
}
