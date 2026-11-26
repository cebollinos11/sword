/**
 * Drawn rooms as Duel maps: a drawn room (`data/delver/rooms/<name>.json`, docs/plans/delver.md, Stage 7g) whose file says `"duel": true` is
 * also an Arena, `room:<name>`, built from its name and Tuning Data alone (`delver.floor.drawnRooms`, already hashed), so every peer builds the
 * same one with nothing sent, as a Random Map is. The room is placed as Check room places it in frame 0, closed: every doorway walled up, a
 * raised one too (`roomDuelSource`). Its Map Source is compiled as a Battle map's is (`compileMap`), then given every jump Link (as a hand-made
 * Arena has) and eight spawns, the two Teams at the ends of the room's long axis, facing each other.
 *
 * Pure: the build is a cache, never state, so it cannot change an outcome (ADR 0006).
 */
import { compileMap } from '../mapEditor/compile';
import { roomDuelSource } from '../mapEditor/room';
import type { MapSource } from '../mapEditor/source';
import type { ArenaGeometry, BattleTuning, SpawnPoint, TuningData } from '../tuning';
import type { DrawnRoom } from '../tuning/delverRooms';
import { deadly, groundBelow } from './arena';
import { blockWalls } from './battlefield';

const PREFIX = 'room:';

/** Fighters per Team a room spawns (MAX_TEAM_SIZE). */
const SPAWNS_PER_TEAM = 4;
/** A Team's spawns about slot 0: [to its right, behind] (m). */
const FORMATION: readonly (readonly [number, number])[] = [
  [0, 0],
  [1.2, 0.8],
  [-1.2, 0.8],
  [0, 1.6],
];
/** How far (m) slot 0 stands from the room's middle along its long axis, at most; and at least this far from the end wall. */
const SPAWN_REACH = 6;
const END_CLEAR = 2.5;
/** A spawn stands this far (m) from every Wall that crosses a Fighter's height, on flat, safe ground this far around it. */
const CLEAR = 0.8;
/** A Fighter's height (m), for which Walls are in its way. */
const BODY = 1.8;
/** Two spawns stand at least this far apart (m). */
const APART = 0.9;
/** A spawn is looked for this far (m) from where it would stand, at most, in steps of `SEARCH_STEP`. */
const SEARCH = 5;
const SEARCH_STEP = 0.5;

/** The Arena name of drawn room `room`: `room:<room>`. */
export const roomArenaName = (room: string): string => `${PREFIX}${room}`;

/** The room a `room:<room>` name names (whether Tuning Data has it or not), or null for any other name. */
export function parseRoomArena(name: string): string | null {
  if (!name.startsWith(PREFIX)) return null;
  const room = name.slice(PREFIX.length);
  return /^[A-Za-z0-9-]+$/.test(room) ? room : null;
}

/** The drawn rooms offered as Duel maps (`"duel": true`), in file order. */
export function duelRooms(tuning: Pick<TuningData, 'delver'>): readonly DrawnRoom[] {
  return tuning.delver.floor.drawnRooms.filter((r) => r.duel);
}

/** The Duel room `name` names, or null: not a `room:` name, no such room, or one not offered as a Duel map. */
export function duelRoomOf(tuning: Pick<TuningData, 'delver'>, name: string): DrawnRoom | null {
  const room = parseRoomArena(name);
  if (room === null) return null;
  return duelRooms(tuning).find((r) => r.name === room) ?? null;
}

/** Whether `name` is a Duel room's Arena that Tuning Data holds. */
export const isRoomArena = (tuning: Pick<TuningData, 'delver'>, name: string): boolean => duelRoomOf(tuning, name) !== null;

/** A Duel room, built: its Map Source (the renderer draws it) and its Arena. */
export interface BuiltRoomArena {
  readonly room: DrawnRoom;
  readonly source: MapSource;
  readonly arena: ArenaGeometry;
}

/** Built rooms per room and Battles' Tuning (a room's Arena depends on those two alone). */
const builds = new WeakMap<DrawnRoom, WeakMap<object, BuiltRoomArena>>();

/** Duel room `name` built (once per room and Battles' Tuning), or null for a name that is not a Duel room's. Throws when the room cannot be a Duel map. */
export function roomArenaOf(tuning: Pick<TuningData, 'delver' | 'battle'>, name: string): BuiltRoomArena | null {
  const room = duelRoomOf(tuning, name);
  if (!room) return null;
  let byBattle = builds.get(room);
  if (!byBattle) builds.set(room, (byBattle = new WeakMap()));
  let built = byBattle.get(tuning.battle);
  if (!built) byBattle.set(tuning.battle, (built = buildRoomArena(room, tuning.battle, tuning.delver.floor.passage, name)));
  return built;
}

function buildRoomArena(room: DrawnRoom, battle: BattleTuning, passage: number, name: string): BuiltRoomArena {
  const { source, rect } = roomDuelSource(room, passage, battle.field.size);
  const { map } = compileMap(source, battle);
  const walls = [...map.walls, ...map.blocks.flatMap(blockWalls)];
  const bare: ArenaGeometry = { name, walk: map.walk, walls, spawns: [] };
  return { room, source, arena: { ...bare, spawns: roomSpawns(bare, rect, room, name) } };
}

/** How far (m, from above) (x, z) is from segment a–b. */
function segmentDistance(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const [dx, dz] = [b.x - a.x, b.z - a.z];
  const len = dx * dx + dz * dz;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len));
  return Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz));
}

/** The flat, safe floor height a Fighter could start on at (x, z), or null: ground all round within CLEAR at one height, none of it deadly or a roof, no Wall in reach. */
function safeFloor(arena: ArenaGeometry, x: number, z: number, under: number): number | null {
  let y: number | null = null;
  for (const [ox, oz] of [[0, 0], [CLEAR, 0], [-CLEAR, 0], [0, CLEAR], [0, -CLEAR], [CLEAR, CLEAR], [CLEAR, -CLEAR], [-CLEAR, CLEAR], [-CLEAR, -CLEAR]] as const) {
    const g = groundBelow(arena, x + ox, z + oz, under);
    if (!g) return null;
    const s = arena.walk[g.surface]!;
    if (s.roof || deadly(s)) return null;
    if (y === null) y = g.y;
    else if (Math.abs(g.y - y) > 1e-6) return null;
  }
  const at = y!;
  for (const w of arena.walls) if (w.bottom < at + BODY && w.top > at + 0.05 && segmentDistance(x, z, w.a, w.b) < CLEAR) return null;
  return at;
}

/**
 * Eight spawns: each Team's slot 0 on the room's long axis (through its centre marker), SPAWN_REACH from the middle (less in a short room), slots 1 to 3
 * beside and behind it, the two Teams facing each other. A spawn whose spot is not safe floor (`safeFloor`) takes the nearest that is, toward the middle
 * first. Throws when one finds none: the room cannot be a Duel map as drawn.
 */
function roomSpawns(arena: ArenaGeometry, rect: { x0: number; z0: number; x1: number; z1: number }, room: DrawnRoom, name: string): SpawnPoint[] {
  const mx = (rect.x0 + rect.x1) / 2;
  const mz = (rect.z0 + rect.z1) / 2;
  const alongX = rect.x1 - rect.x0 >= rect.z1 - rect.z0;
  const half = (alongX ? rect.x1 - rect.x0 : rect.z1 - rect.z0) / 2;
  const reach = Math.min(SPAWN_REACH, half - END_CLEAR);
  // The axis runs through the room's centre marker (on its floor, clear of every Brush), across the other way.
  const cx = alongX ? mx : mx + room.centre[0];
  const cz = alongX ? mz + room.centre[1] : mz;
  const under = room.top - 1;
  const placed: SpawnPoint[] = [];
  for (const team of [0, 1]) {
    const sign = team === 0 ? -1 : 1;
    // Forward, toward the other Team; the Fighter's right is (-forward.z, forward.x).
    const [fx, fz] = alongX ? [-sign, 0] : [0, -sign];
    const [rx, rz] = [-fz, fx];
    const facing = Math.atan2(fx, fz);
    const base = { x: cx + (alongX ? sign * reach : 0), z: cz + (alongX ? 0 : sign * reach) };
    FORMATION.slice(0, SPAWNS_PER_TEAM).forEach(([side, back], slot) => {
      const want = { x: base.x + rx * side - fx * back, z: base.z + rz * side - fz * back };
      const spot = nearestSafe(arena, want, { x: cx, z: cz }, under, placed);
      if (!spot) throw new Error(`Duel room "${name}": no safe floor near team ${team}'s spawn ${slot} at (${want.x}, ${want.z})`);
      placed.push({ team, slot, position: spot, facing });
    });
  }
  return placed;
}

/** The safe floor point nearest `want` (ties: nearer `middle`), within SEARCH, at least APART from every spawn already placed; null if none. */
function nearestSafe(arena: ArenaGeometry, want: { x: number; z: number }, middle: { x: number; z: number }, under: number, placed: readonly SpawnPoint[]): { x: number; y: number; z: number } | null {
  const n = Math.round(SEARCH / SEARCH_STEP);
  const tries: { x: number; z: number; d: number; m: number }[] = [];
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const d = Math.hypot(i, j) * SEARCH_STEP;
      if (d > SEARCH + 1e-9) continue;
      const x = want.x + i * SEARCH_STEP;
      const z = want.z + j * SEARCH_STEP;
      tries.push({ x, z, d, m: Math.hypot(x - middle.x, z - middle.z) });
    }
  }
  tries.sort((a, b) => a.d - b.d || a.m - b.m || a.x - b.x || a.z - b.z);
  for (const t of tries) {
    if (placed.some((p) => Math.hypot(p.position.x - t.x, p.position.z - t.z) < APART)) continue;
    const y = safeFloor(arena, t.x, t.z, under);
    if (y !== null) return { x: t.x, y, z: t.z };
  }
  return null;
}
