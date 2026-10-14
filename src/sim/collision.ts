import type { TuningData } from '../tuning';
import type { Vec2 } from './state';

/**
 * Fighter body collision on the ground plane. Each Fighter is an upright
 * capsule of `fighter.radius`, so seen from above two Fighters are circles
 * that may touch but never overlap, and every Fighter stays fully inside the
 * circular Arena.
 */

/** Separation passes per Tick; plenty for two Fighters, and keeps the cost bounded. */
const PASSES = 4;
/** Tolerance for "touching the Arena edge". */
const EPS = 1e-9;

/** Pull a position back inside the Arena so the whole capsule stays on it. */
export function clampToArena(p: Vec2, tuning: TuningData): Vec2 {
  const maxR = tuning.arena.radius - tuning.fighter.radius;
  const r = Math.hypot(p.x, p.z);
  if (r <= maxR) return p;
  return { x: (p.x / r) * maxR, z: (p.z / r) * maxR };
}

/**
 * Resolve overlaps between Fighter capsules and keep everyone in the Arena.
 * Overlapping Fighters are pushed apart along the line between them, half each,
 * so the result does not depend on Fighter order. A Fighter pinned against the
 * Arena edge does not move outward; the other one takes the whole push.
 * Pure and deterministic: same input, same output.
 */
export function resolveBodies(positions: readonly Vec2[], tuning: TuningData): Vec2[] {
  const minGap = 2 * tuning.fighter.radius;
  const maxR = tuning.arena.radius - tuning.fighter.radius;
  const out = positions.map((p) => clampToArena(p, tuning));
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
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
        const pinnedA = Math.hypot(a.x, a.z) >= maxR - EPS && -dx * a.x - dz * a.z > 0;
        const pinnedB = Math.hypot(b.x, b.z) >= maxR - EPS && dx * b.x + dz * b.z > 0;
        const shareA = pinnedA === pinnedB ? 0.5 : pinnedA ? 0 : 1;
        const shareB = 1 - shareA;
        out[i] = clampToArena({ x: a.x - dx * overlap * shareA, z: a.z - dz * overlap * shareA }, tuning);
        out[j] = clampToArena({ x: b.x + dx * overlap * shareB, z: b.z + dz * overlap * shareB }, tuning);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}
