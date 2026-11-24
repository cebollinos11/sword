/**
 * The Map Editor's room mode (docs/plans/delver.md, Stage 7g): a drawn room edited as an ordinary Map Source, a **stub map**: the abyss under the
 * field, the room's Enclosure (locked: never moved, resized or deleted), an 8 m stub Passage at each doorway at its level, and the room's own
 * Brushes. The room's name, size, doorways, kinds and centre live beside the source (`RoomMeta`), and Save writes them with the Brushes read back
 * from the source (`roomFromSource`) as `data/delver/rooms/<name>.json`.
 *
 * In the editing stub the room's centre stands at (hw mod 2, hd mod 2), so its walls lie on even metres and the editor's 2 m grid (`ROOM_SNAP`) is
 * 2 m steps from the walls, which every room edge must keep (`parseRoom`). The check stub (`roomStub`), which Check room compiles, places the
 * parsed room in a frame as a Floor does (`roomFeature`), its walls on odd metres.
 *
 * Pure: no DOM, no clock.
 */
import { LAVA_DEPTH, LEVEL_RISE, PASSAGE_STOREY, roomFeature } from '../sim/delver/plan';
import { framedRoom, frameHalf, parseRoom, ROOM_KINDS, type DrawnRoom, type RoomKind } from '../tuning/delverRooms';
import { array, record } from '../tuning/validate';
import { MAP_SOURCE_VERSION, parseBrush, SIDES, type Brush, type Doors, type MapSource, type Rect, type Side } from './source';

/** A room's own settings, edited in the Room folder; its Brushes are the stub map's. */
export interface RoomMeta {
  readonly name: string;
  readonly half: readonly [number, number];
  readonly doorways: Readonly<Partial<Record<Side, number>>>;
  readonly centre: readonly [number, number];
  readonly kinds: readonly RoomKind[];
}

/** The prefix of every Brush id the stub map writes for itself (the abyss, the room's Enclosure, the stub Passages): never a room's own. */
export const FIXED = 'fixed-';
/** The room's Enclosure's id in a stub map. */
export const ROOM_ENCLOSURE = `${FIXED}room`;
/** A stub Passage's length (m) out from its doorway. */
export const STUB_LENGTH = 8;
/** The room mode's snap (m): 2 m steps from the walls. */
export const ROOM_SNAP = 2;
/** The editing stub's ceiling (m over the room's floor): over any room's top, so Blocks drawn to it are always to the ceiling. */
export const EDIT_TOP = 16;
/** The stub map's name (a Map Source name is lower-case letters and digits). */
export const STUB_NAME = 'droom';

/** The ids of a stub map's own Brushes, which the editor locks. */
export const isFixed = (id: string): boolean => id.startsWith(FIXED);

/** The editing stub's room centre: (hw mod 2, hd mod 2), so its walls lie on even metres. */
export const editOrigin = (half: readonly [number, number]): [number, number] => [half[0] % 2, half[1] % 2];

/** A stub Passage's rect out from wall `d` of the room `rect`, `w` wide, at its centre less `shift` (the room's shift off the Passages' lines). */
function stubRect(rect: Rect, d: Side, w: number, shift: readonly [number, number]): Rect {
  const cx = (rect.x0 + rect.x1) / 2 - shift[0];
  const cz = (rect.z0 + rect.z1) / 2 - shift[1];
  const h = w / 2;
  return d === 'n' ? { x0: cx - h, z0: rect.z1, x1: cx + h, z1: rect.z1 + STUB_LENGTH }
    : d === 's' ? { x0: cx - h, z0: rect.z0 - STUB_LENGTH, x1: cx + h, z1: rect.z0 }
    : d === 'e' ? { x0: rect.x1, z0: cz - h, x1: rect.x1 + STUB_LENGTH, z1: cz + h }
    : { x0: rect.x0 - STUB_LENGTH, z0: cz - h, x1: rect.x0, z1: cz + h };
}

const OPP: Readonly<Record<Side, Side>> = { n: 's', s: 'n', e: 'w', w: 'e' };

/**
 * A stub map round a room's rect: the abyss, the room's Enclosure (its floor at 0, roofed at `top`, a doorway in each level-0 doorway's wall; a raised one
 * is cut by its stub), a stub Passage at each doorway, `brushes`, and markers at the centre. `extra` heights join the levels.
 */
function stubSource(rect: Rect, doorways: Readonly<Partial<Record<Side, number>>>, centre: [number, number], brushes: readonly Brush[], top: number, passage: number, fieldSize: number, extra: readonly number[], shift: readonly [number, number] = [0, 0]): MapSource {
  const half = fieldSize / 2;
  const heights = new Set<number>([-8, -LAVA_DEPTH, 0, top, ...extra]);
  const doors: Partial<Record<Side, number>> = {};
  const stubs: Brush[] = [];
  for (const d of SIDES) {
    const lv = doorways[d];
    if (lv === undefined) continue;
    const y = lv * LEVEL_RISE;
    // A raised doorway, or one on a wall along a shifted axis, is cut by its stub (as a Floor's Passage cuts it).
    if (lv === 0 && ((d === 'n' || d === 's') ? shift[0] : shift[1]) === 0) doors[d] = passage;
    heights.add(y);
    heights.add(y + PASSAGE_STOREY);
    stubs.push({ kind: 'enclosure', id: `${FIXED}stub-${d}`, rect: stubRect(rect, d, passage, shift), y, doors: { [OPP[d]]: passage } as Doors, top: y + PASSAGE_STOREY, material: 'stone' });
  }
  for (const b of brushes) {
    if (b.kind === 'platform' || b.kind === 'block') heights.add(b.top);
    else if (b.kind === 'ramp') (heights.add(b.lo), heights.add(b.hi));
    else if (b.kind === 'rail' || b.kind === 'hole' || b.kind === 'hazard') heights.add(b.y);
  }
  const levels = [...heights].sort((a, b) => a - b);
  const [cx, cz] = centre;
  return {
    version: MAP_SOURCE_VERSION,
    name: STUB_NAME,
    size: fieldSize,
    grid: { step: 0.5, cell: 2 },
    levels,
    brushes: [
      { kind: 'hazard', id: `${FIXED}abyss`, rect: { x0: -half, z0: -half, x1: half, z1: half }, y: -8, hazard: 'abyss' },
      { kind: 'enclosure', id: ROOM_ENCLOSURE, rect, y: 0, doors, top, material: 'dungeon' },
      ...stubs,
      ...brushes,
    ],
    objectives: [
      { id: 'D', x: cx, z: cz, weight: 1, owner: 0, spawn: true },
      { id: 'E', x: cx, z: cz, weight: 1, owner: 1, spawn: true },
    ],
    bases: [
      { x: cx, z: cz },
      { x: cx, z: cz },
    ],
    front: 52,
    armySize: { standard: 50, max: 50 },
    look: { sky: 'crypt' },
    shortcuts: true,
  };
}

/** The editing levels: whole metres from the lava's depth to the room's top, and the abyss. */
const editLevels = (): number[] => Array.from({ length: EDIT_TOP + LAVA_DEPTH + 1 }, (_, k) => k - LAVA_DEPTH);

/** The editing stub map of a room (its meta and its Brushes in the room frame), its centre at `editOrigin`. */
export function editSource(meta: RoomMeta, brushes: readonly Brush[], passage: number, fieldSize: number): MapSource {
  const [ox, oz] = editOrigin(meta.half);
  const [hw, hd] = meta.half;
  const rect: Rect = { x0: ox - hw, z0: oz - hd, x1: ox + hw, z1: oz + hd };
  // A Block stands to the editing stub's ceiling, as a Block in a Hall stands to the Hall's (`roomFeature`).
  const moved = brushes.map((b) => shiftBrush(b.kind === 'block' ? { ...b, top: EDIT_TOP } : b, ox, oz));
  return stubSource(rect, meta.doorways, [ox + meta.centre[0], oz + meta.centre[1]], moved, EDIT_TOP, passage, fieldSize, editLevels());
}

/** `b` moved by (dx, dz). */
export function shiftBrush(b: Brush, dx: number, dz: number): Brush {
  if (b.kind === 'rail' || b.kind === 'wall') return { ...b, a: { x: b.a.x + dx, z: b.a.z + dz }, b: { x: b.b.x + dx, z: b.b.z + dz } };
  return { ...b, rect: { x0: b.rect.x0 + dx, z0: b.rect.z0 + dz, x1: b.rect.x1 + dx, z1: b.rect.z1 + dz } } as Brush;
}

/** A new room's meta: `name`, `width` x `depth` m (even), a doorway on its n and s walls at the floor, every kind, its centre in the middle. */
export function newRoomMeta(name: string, width: number, depth: number): RoomMeta {
  return { name, half: [width / 2, depth / 2], doorways: { n: 0, s: 0 }, centre: [0, 0], kinds: [...ROOM_KINDS] };
}

/** A parsed room's meta and its Brushes. */
export function roomParts(room: DrawnRoom): { meta: RoomMeta; brushes: readonly Brush[] } {
  return { meta: { name: room.name, half: room.half, doorways: room.doorways, centre: room.centre, kinds: room.kinds }, brushes: room.brushes };
}

/**
 * A room file's meta and Brushes as they stand, for a file `parseRoom` refuses (a rule it breaks, so it can be opened and fixed): its shape only is checked
 * (a name, two whole halves within `halfSize` rounded to even sizes, the doorway levels, the centre, the kinds, and each Brush a Map Source Brush). Throws
 * TuningDataError when even that fails.
 */
export function looseRoomParts(raw: unknown, halfSize: readonly [number, number]): { meta: RoomMeta; brushes: readonly Brush[] } {
  const o = record(raw, 'room');
  const name = typeof o.name === 'string' && /^[A-Za-z0-9-]+$/.test(o.name) ? o.name : 'room';
  const hr = array(o.half, 'room.half');
  const clampHalf = (v: unknown) => Math.max(halfSize[0], Math.min(halfSize[1], Math.round(typeof v === 'number' ? v : halfSize[0])));
  const half: [number, number] = [clampHalf(hr[0]), clampHalf(hr[1])];
  const dr = o.doorways === undefined ? {} : record(o.doorways, 'room.doorways');
  const doorways: Partial<Record<Side, number>> = {};
  for (const s of SIDES) if (typeof dr[s] === 'number') doorways[s] = Math.max(0, Math.min(3, Math.round(dr[s] as number)));
  if (Object.keys(doorways).length === 0) doorways.s = 0;
  const cr = Array.isArray(o.centre) ? o.centre : [0, 0];
  const centre: [number, number] = [Math.round(Number(cr[0]) || 0), Math.round(Number(cr[1]) || 0)];
  const kinds = Array.isArray(o.kinds) ? ROOM_KINDS.filter((k) => (o.kinds as unknown[]).includes(k)) : [...ROOM_KINDS];
  const brushes = array(o.brushes ?? [], 'room.brushes').map((b, i) => parseBrush(b, `room.brushes[${i}]`, 0.5, 1000, (v) => v, []));
  return { meta: { name, half, doorways, centre, kinds: kinds.length ? kinds : [...ROOM_KINDS] }, brushes };
}

/**
 * The room file (raw, for `parseRoom` and Save) of `meta` and the editing stub `source`: the source's Brushes but its own (`isFixed`), moved back to the
 * room frame, in paint order. A Block's `top` is written as the room's ceiling over the floor (the generator stands it to the Hall's ceiling).
 */
export function roomFromSource(meta: RoomMeta, source: MapSource): Record<string, unknown> {
  const [ox, oz] = editOrigin(meta.half);
  const brushes = source.brushes.filter((b) => !isFixed(b.id)).map((b) => {
    const { twin: _t, ...plain } = shiftBrush(b, -ox, -oz) as Brush & { twin?: string };
    return plain;
  });
  const all = meta.kinds.length === ROOM_KINDS.length;
  return { name: meta.name, half: [...meta.half], doorways: { ...meta.doorways }, centre: [...meta.centre], ...(all ? {} : { kinds: [...meta.kinds] }), brushes };
}

/** The room file's text as Save writes it: two-space JSON, one Brush a line. */
export function roomFileText(raw: Record<string, unknown>): string {
  const { brushes, ...head } = raw as { brushes: unknown[] };
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const list = brushes.length === 0 ? '[]' : `[\n${brushes.map((b) => `    ${JSON.stringify(b)}`).join(',\n')}\n  ]`;
  return `{\n${[...lines, `  "brushes": ${list}`].join(',\n')}\n}\n`;
}

/**
 * The check stub of parsed `room` in frame `frame`: the room placed as a Floor places it (`roomFeature`) at a centre that puts its walls on odd metres,
 * its Enclosure roofed at its top, its stubs at its doorways, each `shift` off the wall's centre (a Floor's room shifted off its lattice point). Also its
 * centre point and its rect, for the AI walk.
 */
export function roomStub(room: DrawnRoom, frame: number, passage: number, fieldSize: number, shift: readonly [number, number] = [0, 0]): { source: MapSource; centre: [number, number]; rect: Rect; room: DrawnRoom; shift: readonly [number, number] } {
  const [hw, hd] = frameHalf(room, frame);
  const ox = (hw + 1) % 2;
  const oz = (hd + 1) % 2;
  const rect: Rect = { x0: ox - hw, z0: oz - hd, x1: ox + hw, z1: oz + hd };
  const f = roomFeature('r', room, frame, rect, 0);
  const fr = framedRoom(room, frame);
  const centre: [number, number] = [ox + fr.centre[0], oz + fr.centre[1]];
  return { source: stubSource(rect, f.doorways, centre, f.brushes, room.top, passage, fieldSize, [], shift), centre, rect, room: fr, shift };
}

/** Parse the room `raw` (refusing an id the stub map keeps for itself) against the Floor's half sizes and doorway width. Throws TuningDataError. */
export function parseEditedRoom(raw: unknown, halfSize: readonly [number, number], passage: number): DrawnRoom {
  const room = parseRoom(raw, halfSize, passage, 'room');
  const own = room.brushes.find((b) => isFixed(b.id));
  if (own) throw new Error(`room (${room.name}): the Brush id ${own.id} is kept for the stub map: rename it`);
  return room;
}
