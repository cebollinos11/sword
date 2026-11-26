/**
 * Drawn rooms (docs/plans/delver.md, Stage 7g): special rooms the user draws 1:1 in the Map Editor's room mode and saves as
 * `data/delver/rooms/<name>.json`. A room file is Tuning Data: bundled by a glob as the Battle maps are, parsed here, and folded
 * into the Tuning Data hash through `delver.floor.drawnRooms`. The Floor generator places a room in a Hall that can take it
 * (`plan.ts`, the set-piece kind `room`), in one of 8 frames (4 quarter turns, each optionally mirrored), never scaled.
 *
 * The room frame: the room's centre at (0, 0), north +z, its floor (the doorway level 0) at y 0. Every rect edge and every Rail or
 * Wall end lies a whole even number of metres from the walls, so in every frame it lands on an odd world metre, as a Hall's walls
 * do, off the fields' 2 m dots.
 *
 * Pure: whole metres only, every list in file order.
 */
import { parseBrush, SIDES, type Brush, type GroundPoint, type Rect, type Side } from '../mapEditor/source';
import { CENTRE_CLEAR, DOOR_LANE, DOOR_SIDE, HALL_STOREY, LAVA_CENTRE, LAVA_DEPTH, LAVA_LANE, LEVEL_RISE, MAX_SLOPE } from '../sim/delver/plan';
import { array, record, TuningDataError } from './validate';

/** The Hall kinds a drawn room may serve: never the Entrance, a Rest or the Treasure (Stage 7f's rule). */
export const ROOM_KINDS = ['Fight', 'Empty', 'Stairs', 'Boss'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

/** The Brush kinds a room may hold: no Enclosure, Floor or Deck (the generator writes the Hall's Enclosure from `half` and the used doorways). */
export const ROOM_BRUSH_KINDS = ['platform', 'ramp', 'block', 'rail', 'wall', 'hole', 'hazard'] as const;

/** How far (m) the generator may shift a room off its Hall's lattice point along a wall, so its walls land on odd metres: its doorway on that wall is then that far off the wall's centre. */
export const DOOR_SHIFT = 1;

/** The highest doorway level (`LEVEL_RISE` each) a room may name. */
export const ROOM_DOOR_MAX = 3;

/** A drawn room as its file holds it, parsed (in the room frame), or turned into one of its frames (`framedRoom`). */
export interface DrawnRoom {
  /** Its file's name: letters, digits and `-`. */
  readonly name: string;
  /** [half-width (x), half-depth (z)] in whole metres, each within `delver.floor.halfSize`. */
  readonly half: readonly [number, number];
  /** The walls that may hold a doorway (at the wall's centre, `passage` wide), each with its floor's level over the room's floor, in n, e, s, w order. */
  readonly doorways: Readonly<Partial<Record<Side, number>>>;
  /** Where every centre marker stands (posts, the Warband home, the Boss, the Stairs zone, patrol points): on the room's floor (y 0). */
  readonly centre: readonly [number, number];
  /** The Hall kinds it may serve, in `ROOM_KINDS` order. */
  readonly kinds: readonly RoomKind[];
  /** Its pieces, in paint order. A Block stands from the floor to the room's ceiling, whatever `top` the file gives it. */
  readonly brushes: readonly Brush[];
  /** Its highest floor (a doorway's or a Platform's or a Ramp's top) plus `HALL_STOREY`: the ceiling over the room's floor (m). */
  readonly top: number;
  /** Offered as a Duel map too (`room:<name>`, `sim/roomArena.ts`), its doorways walled up. The Floor generator ignores it. */
  readonly duel?: true;
}

/** A room's 8 frames: frame f is mirrored (x negated) when f >= 4, then turned a quarter counter-clockwise (seen from above) f % 4 times. */
export const ROOM_FRAMES = [0, 1, 2, 3, 4, 5, 6, 7] as const;
export type RoomFrame = (typeof ROOM_FRAMES)[number];

/** A point of the room frame in frame `f` (still centred on (0, 0)). Negation and swaps only, so whole metres stay whole. */
export function framePoint(p: GroundPoint, f: number): GroundPoint {
  let x = f >= 4 ? -p.x : p.x;
  let z = p.z;
  for (let k = 0; k < f % 4; k++) [x, z] = [-z, x];
  return { x: x + 0, z: z + 0 };
}

/** A side of the room frame in frame `f`. */
export function frameSide(d: Side, f: number): Side {
  let i = SIDES.indexOf(d);
  if (f >= 4 && i % 2 === 1) i = (i + 2) % 4;
  return SIDES[(i + 3 * (f % 4)) % 4]!;
}

/** A rect of the room frame in frame `f`. */
export function frameRect(r: Rect, f: number): Rect {
  const a = framePoint({ x: r.x0, z: r.z0 }, f);
  const b = framePoint({ x: r.x1, z: r.z1 }, f);
  return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) };
}

/** A room's half in frame `f`: swapped on an odd quarter turn. */
export const frameHalf = (room: Pick<DrawnRoom, 'half'>, f: number): [number, number] => (f % 2 === 1 ? [room.half[1], room.half[0]] : [room.half[0], room.half[1]]);

/** `b` in frame `f`. */
function frameBrush(b: Brush, f: number): Brush {
  switch (b.kind) {
    case 'ramp':
      return { ...b, rect: frameRect(b.rect, f), up: frameSide(b.up, f), rails: SIDES.filter((s) => b.rails.some((r) => frameSide(r, f) === s)) };
    case 'rail':
    case 'wall':
      return { ...b, a: framePoint(b.a, f), b: framePoint(b.b, f) };
    default:
      return { ...b, rect: frameRect(b.rect, f) } as Brush;
  }
}

/** `room` turned into frame `f` (frame 0: the room as drawn). */
export function framedRoom(room: DrawnRoom, f: number): DrawnRoom {
  const doorways: Partial<Record<Side, number>> = {};
  for (const s of SIDES) {
    const from = SIDES.find((d) => frameSide(d, f) === s);
    if (from !== undefined && room.doorways[from] !== undefined) doorways[s] = room.doorways[from];
  }
  const c = framePoint({ x: room.centre[0], z: room.centre[1] }, f);
  return { ...room, half: frameHalf(room, f), doorways, centre: [c.x, c.z], brushes: room.brushes.map((b) => frameBrush(b, f)) };
}

/** The footprint of `b` seen from above: its rect, or a Rail's or Wall's segment's bounding rect. */
export function brushFootprint(b: Brush): Rect {
  if (b.kind === 'rail' || b.kind === 'wall') return { x0: Math.min(b.a.x, b.b.x), z0: Math.min(b.a.z, b.b.z), x1: Math.max(b.a.x, b.b.x), z1: Math.max(b.a.z, b.b.z) };
  return b.rect;
}

const within = (r: Rect, x: number, z: number): boolean => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;

/**
 * The floor's height (m, over the room's floor) at (x, z) of a room's frame, by its Brushes in paint order: 0 (the room's floor), a Platform's top, a
 * Ramp's surface; `null` where there is no floor (a Hole at the height it cuts, a lava pool) or inside a Block. Points on an edge are taken as outside it.
 */
export function roomFloorAt(room: Pick<DrawnRoom, 'brushes'>, x: number, z: number): number | null {
  let y: number | null = 0;
  let solid = false;
  for (const b of room.brushes) {
    if (b.kind === 'rail' || b.kind === 'wall' || b.kind === 'hazard') continue;
    if (!within(b.rect, x, z)) continue;
    if (b.kind === 'platform') y = b.top;
    else if (b.kind === 'ramp') {
      const r = b.rect;
      const t = b.up === 'n' ? (z - r.z0) / (r.z1 - r.z0) : b.up === 's' ? (r.z1 - z) / (r.z1 - r.z0) : b.up === 'e' ? (x - r.x0) / (r.x1 - r.x0) : (r.x1 - x) / (r.x1 - r.x0);
      y = b.lo + (b.hi - b.lo) * t;
    } else if (b.kind === 'hole') {
      if (y !== null && Math.abs(y - b.y) < 1e-9) y = null;
    } else if (b.kind === 'block') solid = true;
  }
  return solid ? null : y;
}

/** The point 1 m inside doorway `d` of a room of half `half` (across the doorway at `off` m from the wall's centre), and `inset` m in from the wall. */
export function doorwayPoint(half: readonly [number, number], d: Side, inset = 1, off = 0): GroundPoint {
  const [hw, hd] = half;
  return d === 'n' ? { x: off, z: hd - inset } : d === 's' ? { x: off, z: -hd + inset } : d === 'e' ? { x: hw - inset, z: off } : { x: -hw + inset, z: off };
}

const fail = (where: string, why: string): never => {
  throw new TuningDataError(`${where}: ${why}`);
};

/**
 * Validate a raw room file. `halfSize` is `delver.floor.halfSize` and `passage` the doorway width (`delver.floor.passage`). Throws TuningDataError with the
 * room's name (or `where`) and the reason. Accepts its own output (`serializeRoom`), so a parsed room parses again.
 */
export function parseRoom(raw: unknown, halfSize: readonly [number, number], passage: number, where = 'room'): DrawnRoom {
  const o = record(raw, where);
  const name = o.name;
  if (typeof name !== 'string' || !/^[A-Za-z0-9-]+$/.test(name)) fail(`${where}.name`, `letters, digits and - only, got ${JSON.stringify(name)}`);
  const at = `${where} (${name as string})`;
  const halfRaw = array(o.half, `${at}.half`);
  if (halfRaw.length !== 2) fail(`${at}.half`, '[half-width, half-depth]');
  const half = halfRaw.map((v, i) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < halfSize[0] || v > halfSize[1]) fail(`${at}.half[${i}]`, `a whole number of metres within halfSize (${halfSize[0]} to ${halfSize[1]}), got ${JSON.stringify(v)}`);
    return v as number;
  }) as [number, number];
  const [hw, hd] = half;

  // The doorways: at least one wall, each a whole level 0 to ROOM_DOOR_MAX.
  const dr = record(o.doorways, `${at}.doorways`);
  for (const k of Object.keys(dr)) if (!(SIDES as readonly string[]).includes(k)) fail(`${at}.doorways.${k}`, 'a wall is one of n, e, s, w');
  const doorways: Partial<Record<Side, number>> = {};
  for (const s of SIDES) {
    if (dr[s] === undefined) continue;
    const v = dr[s];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > ROOM_DOOR_MAX) fail(`${at}.doorways.${s}`, `a whole level 0 to ${ROOM_DOOR_MAX}, got ${JSON.stringify(v)}`);
    doorways[s] = v as number;
  }
  if (Object.keys(doorways).length === 0) fail(`${at}.doorways`, 'at least one wall must hold a doorway');

  // The kinds.
  let kinds: RoomKind[] = [...ROOM_KINDS];
  if (o.kinds !== undefined) {
    const ks = array(o.kinds, `${at}.kinds`);
    ks.forEach((k, i) => {
      if (typeof k !== 'string' || !(ROOM_KINDS as readonly string[]).includes(k)) fail(`${at}.kinds[${i}]`, `one of ${ROOM_KINDS.join(', ')} (never the Entrance, a Rest or the Treasure), got ${JSON.stringify(k)}`);
    });
    kinds = ROOM_KINDS.filter((k) => ks.includes(k));
    if (kinds.length === 0) fail(`${at}.kinds`, 'at least one kind (or leave it out for all four)');
    if (kinds.length !== ks.length) fail(`${at}.kinds`, 'each kind once');
  }

  // Offered as a Duel map: `true`, or left out.
  if (o.duel !== undefined && o.duel !== true) fail(`${at}.duel`, `true, or left out, got ${JSON.stringify(o.duel)}`);
  const duel = o.duel === true;

  // The Brushes, by the Map Source's own parser on a whole-metre grid; every height a whole metre (lava at -LAVA_DEPTH only).
  const level = (v: number, a: string): number => {
    if (!Number.isInteger(v) || v < -LAVA_DEPTH) fail(a, `a whole metre at or above ${-LAVA_DEPTH}, got ${v}`);
    return v;
  };
  const brushes = array(o.brushes, `${at}.brushes`).map((b, i) => {
    const w = `${at}.brushes[${i}]`;
    const kind = (b as Record<string, unknown> | null)?.kind;
    if (typeof kind !== 'string' || !(ROOM_BRUSH_KINDS as readonly string[]).includes(kind)) fail(`${w}.kind`, `one of ${ROOM_BRUSH_KINDS.join(', ')}, got ${JSON.stringify(kind)}`);
    if ((b as Record<string, unknown>).twin !== undefined) fail(`${w}.twin`, 'a room has no twins');
    return parseBrush(b, w, 1, 1000, level, []);
  });
  const ids = new Set<string>();
  const evenFrom = (v: number, h: number) => (((v - h) % 2) + 2) % 2 === 0;
  brushes.forEach((b, i) => {
    const w = `${at}.brushes[${i}] (${b.id})`;
    if (ids.has(b.id)) fail(w, `another Brush is already "${b.id}"`);
    ids.add(b.id);
    const f = brushFootprint(b);
    if (f.x0 < -hw || f.x1 > hw || f.z0 < -hd || f.z1 > hd) fail(w, `it must lie inside the room (x ${-hw} to ${hw}, z ${-hd} to ${hd})`);
    const xs = b.kind === 'rail' || b.kind === 'wall' ? [b.a.x, b.b.x] : [b.rect.x0, b.rect.x1];
    const zs = b.kind === 'rail' || b.kind === 'wall' ? [b.a.z, b.b.z] : [b.rect.z0, b.rect.z1];
    if (!xs.every((x) => evenFrom(x, hw)) || !zs.every((z) => evenFrom(z, hd))) fail(w, 'every edge (and every Rail or Wall end) must lie a whole even number of metres from the walls, so it lands on an odd world metre in every frame');
    if (b.kind === 'platform' && (!Number.isInteger(b.top) || b.top < 1)) fail(`${w}.top`, `a whole metre of at least 1, got ${b.top}`);
    if (b.kind === 'ramp') {
      if (b.lo < 0) fail(`${w}.lo`, `at or above the room's floor (0), got ${b.lo}`);
      const run = b.up === 'n' || b.up === 's' ? b.rect.z1 - b.rect.z0 : b.rect.x1 - b.rect.x0;
      if ((b.hi - b.lo) / run > MAX_SLOPE + 1e-9) fail(w, `a Ramp rises at most ${MAX_SLOPE} m a metre: ${b.hi - b.lo} m over ${run} m is steeper`);
    }
    if (b.kind === 'rail' && b.y < 0) fail(`${w}.y`, `at or above the room's floor (0), got ${b.y}`);
    if (b.kind === 'wall' && (b.bottom < 0 || !Number.isInteger(b.bottom) || !Number.isInteger(b.top))) fail(w, 'a Wall stands on whole metres at or above the room\'s floor');
    if (b.kind === 'hole') {
      if (b.y < 0) fail(`${w}.y`, `at or above the room's floor (0), got ${b.y}`);
      // A Hole in the room's floor is a lava pool's: the lava Hazard under it comes next, on the same rect.
      const next = brushes[i + 1];
      if (b.y === 0 && !(next?.kind === 'hazard' && sameRect(next.rect, b.rect))) fail(w, 'a Hole in the room\'s floor is a lava pool: the next Brush must be its lava Hazard, on the same rect');
    }
    if (b.kind === 'hazard') {
      if (b.hazard !== 'lava') fail(`${w}.hazard`, `lava only, got ${b.hazard}`);
      if (b.y !== -LAVA_DEPTH) fail(`${w}.y`, `${-LAVA_DEPTH} (LAVA_DEPTH under the room's floor), got ${b.y}`);
      const prev = brushes[i - 1];
      if (!(prev?.kind === 'hole' && prev.y === 0 && sameRect(prev.rect, b.rect))) fail(w, 'a lava Hazard lies under its Hole in the room\'s floor: the Brush before it must be that Hole, on the same rect');
    }
  });

  const floors = [...Object.values(doorways).map((v) => v * LEVEL_RISE), ...brushes.map((b) => (b.kind === 'platform' ? b.top : b.kind === 'ramp' ? b.hi : 0))];
  const top = Math.max(0, ...floors) + HALL_STOREY;
  brushes.forEach((b, i) => {
    if (b.kind === 'wall' && b.top > top) fail(`${at}.brushes[${i}] (${b.id}).top`, `at most the room's ceiling (${top})`);
    if (b.kind === 'rail' && b.y + b.height > top) fail(`${at}.brushes[${i}] (${b.id})`, `under the room's ceiling (${top})`);
  });
  const room0 = { brushes };

  // Each doorway's floor, from the wall to 1 m in and across its width, at its level.
  for (const s of SIDES) {
    const lv = doorways[s];
    if (lv === undefined) continue;
    for (const inset of [0.5, 1]) {
      // Across the doorway and a metre each side: a room the generator shifts 1 m along the wall (to keep its walls on odd metres) has its doorway there.
      for (const off of [-(passage / 2 + DOOR_SHIFT - 0.25), -(passage / 2 - 0.25), 0, passage / 2 - 0.25, passage / 2 + DOOR_SHIFT - 0.25]) {
        const p = doorwayPoint(half, s, inset, off);
        const y = roomFloorAt(room0, p.x, p.z);
        if (y === null || Math.abs(y - lv * LEVEL_RISE) > 1e-9) fail(`${at}.doorways.${s}`, `the floor 1 m inside the doorway (and a metre each side of it) must stand at its level (${lv * LEVEL_RISE} m): it is ${y === null ? 'not floor' : `${y} m`} at (${p.x}, ${p.z})`);
      }
    }
  }

  // The centre: on the room's floor, CENTRE_CLEAR from every Brush and every wall.
  const cRaw = array(o.centre, `${at}.centre`);
  if (cRaw.length !== 2 || !cRaw.every((v) => typeof v === 'number' && Number.isInteger(v))) fail(`${at}.centre`, '[x, z] in whole metres');
  const centre: [number, number] = [cRaw[0] as number, cRaw[1] as number];
  const keep: Rect = { x0: centre[0] - CENTRE_CLEAR, z0: centre[1] - CENTRE_CLEAR, x1: centre[0] + CENTRE_CLEAR, z1: centre[1] + CENTRE_CLEAR };
  if (keep.x0 < -hw || keep.x1 > hw || keep.z0 < -hd || keep.z1 > hd) fail(`${at}.centre`, `at least ${CENTRE_CLEAR} m from every wall`);
  brushes.forEach((b) => {
    const f = brushFootprint(b);
    if (f.x0 < keep.x1 && keep.x0 < f.x1 && f.z0 < keep.z1 && keep.z0 < f.z1) fail(`${at}.centre`, `at least ${CENTRE_CLEAR} m from every Brush, but ${b.id} is nearer`);
  });
  if (roomFloorAt(room0, centre[0], centre[1]) !== 0) fail(`${at}.centre`, 'on the room\'s floor (y 0)');

  // Lava (7d's rules, which the judge holds a Floor's lava to): no pool within LAVA_CENTRE of the centre (the Stairs zone, the pedestals and the Warband stand
  // round it), and every pool LAVA_LANE clear of each doorway's lane (the doorway, DOOR_SIDE and DOOR_SHIFT each side, DOOR_LANE deep).
  const square: Rect = { x0: centre[0] - LAVA_CENTRE, z0: centre[1] - LAVA_CENTRE, x1: centre[0] + LAVA_CENTRE, z1: centre[1] + LAVA_CENTRE };
  const lanes = SIDES.filter((s) => doorways[s] !== undefined).map((s) => {
    const w = passage / 2 + DOOR_SIDE + DOOR_SHIFT + LAVA_LANE;
    const deep = DOOR_LANE + LAVA_LANE;
    const r: Rect = s === 'n' ? { x0: -w, z0: hd - deep, x1: w, z1: hd } : s === 's' ? { x0: -w, z0: -hd, x1: w, z1: -hd + deep } : s === 'e' ? { x0: hw - deep, z0: -w, x1: hw, z1: w } : { x0: -hw, z0: -w, x1: -hw + deep, z1: w };
    return { s, r };
  });
  const cross = (p: Rect, q: Rect) => p.x0 < q.x1 && q.x0 < p.x1 && p.z0 < q.z1 && q.z0 < p.z1;
  // A Block or a Wall stands in no doorway's lane (the doorway, DOOR_SIDE and DOOR_SHIFT each side, DOOR_LANE deep), as a Hall's pillars never do: the
  // AI and a Formation snag on one there.
  for (const b of brushes) {
    if (b.kind !== 'block' && b.kind !== 'wall') continue;
    const fp = brushFootprint(b);
    for (const s of SIDES) {
      if (doorways[s] === undefined) continue;
      const w = passage / 2 + DOOR_SIDE + DOOR_SHIFT;
      const r: Rect = s === 'n' ? { x0: -w, z0: hd - DOOR_LANE, x1: w, z1: hd } : s === 's' ? { x0: -w, z0: -hd, x1: w, z1: -hd + DOOR_LANE } : s === 'e' ? { x0: hw - DOOR_LANE, z0: -w, x1: hw, z1: w } : { x0: -hw, z0: -w, x1: -hw + DOOR_LANE, z1: w };
      const across = fp.x0 < r.x1 && r.x0 < fp.x1 && fp.z0 < r.z1 && r.z0 < fp.z1;
      // A Wall along a lane's edge (zero width) crosses it only where it enters it.
      const touches = (fp.x0 === fp.x1 && fp.x0 > r.x0 && fp.x0 < r.x1 && fp.z0 < r.z1 && r.z0 < fp.z1) || (fp.z0 === fp.z1 && fp.z0 > r.z0 && fp.z0 < r.z1 && fp.x0 < r.x1 && r.x0 < fp.x1);
      if (across || touches) fail(`${at}.brushes (${b.id})`, `a ${b.kind === 'block' ? 'Block' : 'Wall'} keeps out of the ${s} doorway's lane (${DOOR_LANE} m deep, the doorway and ${DOOR_SIDE + DOOR_SHIFT} m each side): the AI and Formations snag on it there`);
    }
  }
  for (const b of brushes) {
    if (b.kind !== 'hazard') continue;
    if (cross(b.rect, square)) fail(`${at}.brushes (${b.id})`, `a lava pool keeps ${LAVA_CENTRE} m from the centre (the Stairs zone, the pedestals and the Warband stand round it)`);
    for (const l of lanes) if (cross(b.rect, l.r)) fail(`${at}.brushes (${b.id})`, `a lava pool keeps ${LAVA_LANE} m from the ${l.s} doorway's lane (${DOOR_LANE} m deep, the doorway and ${DOOR_SIDE + DOOR_SHIFT} m each side)`);
  }

  // A Block stands from the floor to the room's ceiling, whatever `top` the file gives it.
  return { name: name as string, half, doorways, centre, kinds, brushes: brushes.map((b) => (b.kind === 'block' ? { ...b, top } : b)), top, ...(duel ? { duel: true as const } : {}) };
}

const sameRect = (a: Rect, b: Rect): boolean => a.x0 === b.x0 && a.z0 === b.z0 && a.x1 === b.x1 && a.z1 === b.z1;

/** A room as its file holds it (`parseRoom` reads it back): `kinds` left out when it is all four, `duel` when it is not one, `top` left out (it is derived). */
export function serializeRoom(room: DrawnRoom): Record<string, unknown> {
  const all = room.kinds.length === ROOM_KINDS.length;
  return { name: room.name, half: [...room.half], doorways: { ...room.doorways }, centre: [...room.centre], ...(all ? {} : { kinds: [...room.kinds] }), ...(room.duel ? { duel: true } : {}), brushes: room.brushes };
}

/** Each raw room (`delver.drawnRooms`, the bundled files in file order) by `parseRoom`, each name once. */
export function parseRooms(raws: readonly unknown[], halfSize: readonly [number, number], passage: number): DrawnRoom[] {
  const out: DrawnRoom[] = [];
  raws.forEach((raw, i) => {
    const room = parseRoom(raw, halfSize, passage, `delver.drawnRooms[${i}]`);
    if (out.some((r) => r.name === room.name)) throw new TuningDataError(`delver.drawnRooms[${i}]: another room is already "${room.name}"`);
    out.push(room);
  });
  return out;
}
