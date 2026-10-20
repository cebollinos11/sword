/**
 * A body off the ground, Tick by Tick: taking off on a Jump, flying (gravity, a held Jump's boost, air steering),
 * bumping its head under a Walk Surface, settling on the ground and the drop a Landing counts. The Simulation's
 * Tick (`step.ts`) runs a Fighter through these, and `jumpArc` runs a predicted Jump through the very same ones,
 * so a prediction cannot drift from what the Simulation does. Pure functions of Tuning Data and their arguments.
 */
import type { ArenaGeometry, TuningData } from '../tuning';
import { blockedAt, ceilingAbove, groundBelow } from './arena';
import { secondsToTicks, TICK_SECONDS } from './constants';
import type { Airborne, Vec2 } from './state';

/** What these steps need of a body: where it stands, the height of its feet, and its flight while off the ground. */
export interface AirBody {
  readonly position: Vec2;
  readonly y: number;
  readonly air?: Airborne;
}

/**
 * The flight a Jump starts with, from feet at `y`: up at `fall.jumpSpeed`, carrying the walk it had this Tick
 * (from `from` to `to`), with the Jump's boost to come while Jump is held.
 */
export function takeOff(from: Vec2, to: Vec2, y: number, tuning: TuningData): Airborne {
  const air: Airborne = { vx: (to.x - from.x) / TICK_SECONDS, vz: (to.z - from.z) / TICK_SECONDS, vy: tuning.fall.jumpSpeed, peakY: y, ticks: 0, jumped: true, launchY: y };
  const boost = secondsToTicks(tuning.fall.jumpBoostTime);
  return boost > 0 && tuning.fall.jumpBoost > 0 ? { ...air, boost } : air;
}

/**
 * An airborne body's flight this Tick: gravity pulls it down (a held Jump's boost pushes back up), and it steers its
 * horizontal velocity toward `move` (its walk, at most unit length) at `topSpeed` (m/s), changing it by no more than `fall.airControl` (m/s²).
 */
export function flyBody(body: AirBody, air: Airborne, move: Vec2, jumpHeld: boolean, topSpeed: number, tuning: TuningData): { position: Vec2; y: number; air: Airborne } {
  let { x: mx, z: mz } = move;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  let dvx = mx * topSpeed - air.vx;
  let dvz = mz * topSpeed - air.vz;
  const dv = Math.hypot(dvx, dvz);
  const maxDv = tuning.fall.airControl * TICK_SECONDS;
  if (dv > maxDv) {
    dvx *= maxDv / dv;
    dvz *= maxDv / dv;
  }
  const vx = air.vx + dvx;
  const vz = air.vz + dvz;
  // A Jump held past `fall.jumpBoostDelay` keeps pushing up while its boost lasts (so a tap stays a hop); letting go ends it for good.
  const held = air.boost !== undefined && jumpHeld;
  const pushing = held && air.ticks >= secondsToTicks(tuning.fall.jumpBoostDelay);
  const vy = air.vy + ((pushing ? tuning.fall.jumpBoost : 0) - tuning.fall.gravity) * TICK_SECONDS;
  const y = body.y + vy * TICK_SECONDS;
  const boost = pushing ? air.boost! - 1 : held ? air.boost! : 0;
  // Built field by field (no spread: this runs every airborne Tick, and many times over in `jumpArc`), keeping `launchY` only if it has one.
  const next: { -readonly [K in keyof Airborne]: Airborne[K] } = { vx, vz, vy, peakY: Math.max(air.peakY, y), ticks: air.ticks + 1, jumped: air.jumped };
  if (air.launchY !== undefined) next.launchY = air.launchY;
  if (boost > 0) next.boost = boost;
  return { position: { x: body.position.x + vx * TICK_SECONDS, z: body.position.z + vz * TICK_SECONDS }, y, air: next };
}

/**
 * A rising body whose head reaches a Walk Surface overhead (`ceilingAbove`) stops under it: its feet are held
 * `fighter.height` below, it stops rising (keeping its drift) and any Jump boost left is lost.
 */
export function bumpHead<T extends AirBody>(prev: AirBody, f: T, arena: ArenaGeometry, tuning: TuningData): T {
  if (!f.air || f.y <= prev.y) return f;
  const h = ceilingAbove(arena, f.position.x, f.position.z, prev.y, f.y, tuning);
  if (h === null) return f;
  const { boost: _boost, ...air } = f.air;
  const y = h - tuning.fighter.height;
  return { ...f, y, air: { ...air, vy: 0, peakY: Math.max(prev.air?.peakY ?? prev.y, y) } };
}

/**
 * Put a body that has settled (`rising`; last Tick `prev`) on the ground, or in the air:
 *   - Standing, it follows the Walk Surface under it up a step (`fall.stepUp`) or down one
 *     (`fall.snapDown`), so ramps walk both ways. Where there is no ground within a step, or
 *     ground higher than a step blocks the body (`blockedAt`), or it is off the Arena, it slides along whichever axis has ground,
 *     or stays put. Deeper ground below is a ledge: it goes airborne at the speed it walked off at.
 *   - Airborne, it lands once its feet reach the ground under them; rising, its head stops under a Walk Surface overhead (`bumpHead`).
 */
export function settleGround<T extends AirBody>(prev: AirBody, rising: T, arena: ArenaGeometry, tuning: TuningData): T {
  const { stepUp, snapDown } = tuning.fall;
  const f = bumpHead(prev, rising, arena, tuning);
  const reach = Math.max(prev.y, f.y) + stepUp;
  const under = (p: Vec2) => (blockedAt(arena, p.x, p.z, f.y, tuning) ? null : groundBelow(arena, p.x, p.z, reach));
  let position = f.position;
  let g = under(position);
  if (!g) {
    // Nothing to stand on within a step: blocked, so slide along whichever axis still has ground.
    const tries: Vec2[] = [{ x: position.x, z: prev.position.z }, { x: prev.position.x, z: position.z }, prev.position];
    for (const p of tries) {
      g = under(p);
      if (g) {
        position = p;
        break;
      }
    }
    if (!g) return { ...f, position: prev.position };
  }
  const { air, ...rest } = f;
  if (air) {
    if (f.y > g.y) return position === f.position ? f : { ...f, position, air: { ...air, vx: 0, vz: 0 } };
    return { ...rest, position, y: g.y } as T;
  }
  if (g.y >= f.y - snapDown) return { ...rest, position, y: g.y } as T;
  const vx = (position.x - prev.position.x) / TICK_SECONDS;
  const vz = (position.z - prev.position.z) / TICK_SECONDS;
  return { ...rest, position, air: { vx, vz, vy: 0, peakY: f.y, ticks: 0, jumped: false } } as T;
}

/** The height a Landing at feet `y` counts as dropped, after the flight `air`: from the top of its arc, but for a Jump from no higher than a plain Jump's top above where it left, so a boosted Jump lands softly on level ground. */
export function landingDrop(air: Airborne, y: number, tuning: TuningData): number {
  const { peakY, launchY } = air;
  const { jumpSpeed, gravity } = tuning.fall;
  const top = launchY === undefined ? peakY : Math.min(peakY, launchY + (jumpSpeed * jumpSpeed) / (2 * gravity));
  return Math.max(0, top - y);
}

/** The fall damage of a Landing that dropped `height` (m): `fall.damagePerMetre` per metre beyond `fall.safeHeight`, while the Duel is being fought. */
export const landingDamage = (height: number, tuning: TuningData): number => (height > tuning.fall.safeHeight ? (height - tuning.fall.safeHeight) * tuning.fall.damagePerMetre : 0);
