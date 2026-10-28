/**
 * Where an AI-driven Fighter of a cleared Hall stands in an exit Door's zone, shared by the Ally AI and the dev autopilot so both walk the
 * same way. A zone is a little over two Fighters wide, so four Fighters cannot stand in a row at its near edge: one who stops as soon as it
 * is inside boxes the last one out. So each Fighter walks on to a spot of its own (its rank among its team's Fighters), the four spots two
 * columns along the zone's sides with a lane between them, so the others pass the entrance and the lane.
 */
import { exitDoor, inDuel, inExitZone, type SimState } from '../sim';
import type { ArenaGeometry } from '../tuning';

/** A spot on the ground. */
export interface DoorSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** How near (m, across the ground) to its spot in a Door's zone a Fighter stops, once inside the zone. */
export const SPOT_ARRIVED = 0.3;
/** How many spots a zone holds: a Team's size, the most a Run's party is. */
const SPOTS = 4;
/** How much (m) clear a spot's body leaves the zone's sides. */
const EDGE_GAP = 0.02;
/** How much (m) clear a spot's body leaves the zone's near and far edges. */
const ROW_GAP = 0.2;
/** How near (m) to its spot a Fighter shoves on past the others, rather than stepping round each (`AiController.walkTo`). */
const SHOVE_RANGE = 5;

/**
 * The four spots of exit `exit` (0-based, as `Hall.exits`) of `arena`, for Fighters of body radius `radius`, by slot: two by two, a
 * column along each side of its zone and a lane between them up the middle that a fifth body can pass along, the nearer pair (to the
 * Hall, left then right) first. Each is inside the zone.
 */
export function exitDoorSpots(arena: ArenaGeometry, exit: number, radius: number): readonly DoorSpot[] {
  const { zone, facing } = arena.doors[exitDoor(exit)]!;
  const centre = { x: zone.reduce((s, p) => s + p.x, 0) / zone.length, z: zone.reduce((s, p) => s + p.z, 0) / zone.length };
  // Out of the doorway into the Hall, and to the right of that.
  const out = { x: Math.sin(facing), z: Math.cos(facing) };
  const right = { x: out.z, z: -out.x };
  const reach = (axis: { x: number; z: number }) => Math.max(...zone.map((p) => Math.abs((p.x - centre.x) * axis.x + (p.z - centre.z) * axis.z)));
  const across = reach(right) - radius - EDGE_GAP;
  const ahead = reach(out) - radius - ROW_GAP;
  const at = (across: number, ahead: number): DoorSpot => ({ x: centre.x + right.x * across + out.x * ahead, y: zone[0]?.y ?? 0, z: centre.z + right.z * across + out.z * ahead });
  return [at(-across, ahead), at(across, ahead), at(-across, -ahead), at(across, -ahead)];
}

/**
 * The spot `fighter` stands at in exit `exit`'s zone: the one for its rank among the Fighters of its team (those before it in the
 * line-up, past the fourth the first again), unless another Fighter in the Duel stands on it, then the free one nearest it. `crowded` if
 * the spot it comes to is taken as well (every spot is), so it may stand anywhere in the zone.
 */
export function exitDoorSpot(arena: ArenaGeometry, exit: number, state: Pick<SimState, 'fighters'>, fighter: number, radius: number): { readonly at: DoorSpot; readonly crowded: boolean } {
  const spots = exitDoorSpots(arena, exit, radius);
  const team = state.fighters[fighter]!.team;
  const own = spots[state.fighters.slice(0, fighter).filter((f) => f.team === team).length % SPOTS]!;
  const taken = (p: DoorSpot) => state.fighters.some((f, i) => i !== fighter && inDuel(f) && Math.hypot(f.position.x - p.x, f.position.z - p.z) < 2 * radius);
  if (!taken(own)) return { at: own, crowded: false };
  const self = state.fighters[fighter]!.position;
  const free = spots.filter((p) => !taken(p)).sort((a, b) => Math.hypot(a.x - self.x, a.z - self.z) - Math.hypot(b.x - self.x, b.z - self.z) || spots.indexOf(a) - spots.indexOf(b));
  return free[0] ? { at: free[0], crowded: false } : { at: own, crowded: true };
}

/**
 * How `fighter` walks to gather at exit `exit` (the arguments of `AiController.walkTo`): to its spot, which it stops at (SPOT_ARRIVED)
 * once in the zone, or anywhere in the zone once that is crowded. Near the zone it shoves on past the others: two Fighters stepping
 * round each other at a Door's entrance can dither there for good.
 */
export function exitDoorWalk(arena: ArenaGeometry, exit: number, state: Pick<SimState, 'fighters'>, fighter: number, radius: number): { readonly to: DoorSpot; readonly stop: number; readonly shove: boolean } {
  const self = state.fighters[fighter]!;
  const { at, crowded } = exitDoorSpot(arena, exit, state, fighter, radius);
  const stop = !inExitZone(arena, exit, self) ? 0 : crowded ? Infinity : SPOT_ARRIVED;
  return { to: at, stop, shove: Math.hypot(at.x - self.position.x, at.z - self.position.z) < SHOVE_RANGE };
}
