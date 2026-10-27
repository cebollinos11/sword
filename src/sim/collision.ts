import { sizedTuning, type ArenaGeometry, type Size, type TuningData } from '../tuning';
import { pushOutOfWalls } from './arena';
import type { Vec2 } from './state';

/**
 * Fighter body collision. Each Fighter is an upright capsule of
 * `fighter.radius` and `fighter.height` standing at its height `y`, so seen
 * from above two Fighters whose heights overlap are circles that may touch
 * but never overlap. Capsules stay out of the Arena's Walls (where their
 * heights overlap) and inside its circular boundary, if it has one. Nothing
 * holds a Fighter on a ledge: being pushed off one is how knock-offs happen.
 */

/** Separation passes per Tick; plenty for a few Fighters, and keeps the cost bounded. */
const PASSES = 4;
/** Tolerance for "touching the Arena edge". */
const EPS = 1e-9;

/** A Fighter body as collision sees it: where it stands and how high its feet are. */
export interface Body {
  readonly position: Vec2;
  readonly y: number;
  /** Its Size, when it is not the standard body: its capsule is that much wider and taller. */
  readonly size?: Size;
}

/** Pull a position back inside a circular boundary of `radius` so the whole capsule stays inside it. */
export function clampToArena(p: Vec2, radius: number, tuning: Pick<TuningData, 'fighter'>): Vec2 {
  const maxR = radius - tuning.fighter.radius;
  const r = Math.hypot(p.x, p.z);
  if (r <= maxR) return p;
  return { x: (p.x / r) * maxR, z: (p.z / r) * maxR };
}

/**
 * Resolve overlaps between Fighter capsules and keep everyone off the Walls and
 * inside the boundary. Overlapping Fighters are pushed apart along the line
 * between them, half each, so the result does not depend on Fighter order. A
 * Fighter pinned against the circular boundary does not move outward; the
 * other one takes the whole push. Pure and deterministic: same input, same output.
 */
export function resolveBodies(bodies: readonly Body[], arena: ArenaGeometry, tuning: TuningData): Vec2[] {
  const own = bodies.map((b) => sizedTuning(tuning, b.size));
  const bound = arena.radius;
  const maxRs = own.map((t) => (bound === undefined ? Infinity : bound - t.fighter.radius));
  const contain = (p: Vec2, y: number, i: number): Vec2 => {
    const walled = arena.walls.length > 0 ? pushOutOfWalls(p, y, arena, own[i]!) : p;
    return bound === undefined ? walled : clampToArena(walled, bound, own[i]!);
  };
  const out = bodies.map((b, i) => contain(b.position, b.y, i));
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        // Bodies at different heights (one on a gallery above the other) pass over each other.
        // Two bodies pass over each other unless the lower one reaches the higher one's feet.
        if (Math.abs(bodies[i]!.y - bodies[j]!.y) >= (bodies[i]!.y < bodies[j]!.y ? own[i]! : own[j]!).fighter.height) continue;
        const a = out[i]!;
        const b = out[j]!;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        const minGap = own[i]!.fighter.radius + own[j]!.fighter.radius;
        if (d >= minGap) continue;
        if (d === 0) {
          // Exactly on top of each other: split along x, lower index to -x.
          dx = 1;
          dz = 0;
        } else {
          dx /= d;
          dz /= d;
        }
        const overlap = minGap - d;
        // Pinned: at the edge and the push for it points outward.
        const pinnedA = Math.hypot(a.x, a.z) >= maxRs[i]! - EPS && -dx * a.x - dz * a.z > 0;
        const pinnedB = Math.hypot(b.x, b.z) >= maxRs[j]! - EPS && dx * b.x + dz * b.z > 0;
        const shareA = pinnedA === pinnedB ? 0.5 : pinnedA ? 0 : 1;
        const shareB = 1 - shareA;
        out[i] = contain({ x: a.x - dx * overlap * shareA, z: a.z - dz * overlap * shareA }, bodies[i]!.y, i);
        out[j] = contain({ x: b.x + dx * overlap * shareB, z: b.z + dz * overlap * shareB }, bodies[j]!.y, j);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}
