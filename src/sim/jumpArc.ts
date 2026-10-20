/**
 * `jumpArc`: where a Jump comes down. From a takeoff point, a heading and how many Ticks Jump is held, it runs the
 * Jump through the same steps the Simulation's Tick runs a Fighter through (`air.ts`: take-off, flight, head bump,
 * landing, and the Wall push-out of body collision), so the prediction is exact for a Fighter alone. The navmesh
 * uses it to find jump Links, the AI to check its Jumps and to predict where an airborne opponent lands.
 * Pure functions of Tuning Data and their arguments.
 */
import type { ArenaGeometry, TuningData } from '../tuning';
import { deadlyGround, groundBelow } from './arena';
import { flyBody, landingDamage, landingDrop, settleGround, takeOff, type AirBody } from './air';
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
  /** Where it lands; null when still airborne after MAX_AIR_TICKS, or falling with nothing left below. */
  readonly lands: ArcPoint | null;
  /** The Walk Surface it lands on (index into `arena.walk`), -1 if none. */
  readonly surface: number;
  /** Ticks from takeoff to landing (or to giving up). */
  readonly ticks: number;
  /** The height the Landing counts as dropped (m), as the Simulation's Landing does. */
  readonly drop: number;
  /** The fall damage of that drop. */
  readonly damage: number;
  /** It lands on Lava or Water, or drops far enough to fell a Fighter at full HP, or never lands. */
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
function fly(arena: ArenaGeometry, tuning: TuningData, start: AirBody, air0: Airborne, move: Vec2, holdTicks: number, topSpeed: number): JumpResult {
  const path: ArcPoint[] = [];
  const floor = lowestGround(arena);
  let body = start;
  let air = air0;
  for (let tick = 1; tick <= MAX_AIR_TICKS; tick++) {
    const flown = flyBody(body, air, move, tick <= holdTicks, topSpeed, tuning);
    const position = resolveBodies([{ position: flown.position, y: flown.y }], arena, tuning)[0]!;
    const next = settleGround(body, { ...flown, position }, arena, tuning);
    path.push({ x: next.position.x, z: next.position.z, y: next.y });
    if (!next.air) {
      const drop = body.air ? landingDrop(body.air, next.y, tuning) : 0;
      const damage = landingDamage(drop, tuning);
      const surface = groundBelow(arena, next.position.x, next.position.z, next.y + 1e-6)?.surface ?? -1;
      const deadly = deadlyGround(arena, next.position.x, next.position.z, next.y) !== null || damage >= tuning.fighter.maxHp;
      return { lands: { x: next.position.x, z: next.position.z, y: next.y }, surface, ticks: tick, drop, damage, deadly, path };
    }
    if (next.y < floor - 1e-6) return { lands: null, surface: -1, ticks: tick, drop: 0, damage: 0, deadly: true, path };
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
  return fly(arena, tuning, start, takeOff(plan.at, to, plan.y, tuning), plan.heading, plan.holdTicks, speed);
}

/** Predict the rest of a flight already under way (an opponent seen in the air: give it no boost, as nothing seen says it holds any). */
export function jumpArcFrom(arena: ArenaGeometry, tuning: TuningData, plan: FlightPlan): JumpResult {
  const speed = plan.speed ?? tuning.fighter.walkSpeed;
  return fly(arena, tuning, { position: plan.at, y: plan.y, air: plan.air }, plan.air, plan.move, plan.holdTicks ?? 0, speed);
}
