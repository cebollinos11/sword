/**
 * Where a Hall Arena's Door stands, for drawing it and labelling it (docs/plans/dungeon.md, Stage 1's placeholder
 * presentation). Pure: no three.js.
 */
import type { ArenaDoor, ArenaPoint } from '../tuning';

/**
 * The two ends of a Door's doorway: the corners of its zone furthest back against its `facing` (the Wall the zone stands
 * before), on the zone's ground, in zone order.
 */
export function doorway(door: ArenaDoor): readonly [ArenaPoint, ArenaPoint] {
  const [dx, dz] = [Math.sin(door.facing), Math.cos(door.facing)];
  const along = door.zone.map((p) => p.x * dx + p.z * dz);
  const back = Math.min(...along);
  // Every corner within a centimetre of the furthest back: the two of a rectangle's back edge.
  const ends = door.zone.filter((_, i) => along[i]! - back < 0.01);
  return [ends[0]!, ends[ends.length - 1]!];
}

/** The middle of a Door's doorway, on the zone's ground. */
export function doorwayMiddle(door: ArenaDoor): ArenaPoint {
  const [a, b] = doorway(door);
  return { x: (a.x + b.x) / 2, y: a.y, z: (a.z + b.z) / 2 };
}
