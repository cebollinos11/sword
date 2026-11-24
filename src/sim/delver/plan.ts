/**
 * A Delver Floor's plan (docs/plans/delver.md, Stage 1): Halls on a lattice, joined by Passages (a spanning tree and a few
 * loops), each Hall given a kind, patrol loops drawn along the loops' cycles and the Delver markers placed. Plain data, pure
 * and seeded: every pick is `runPick` of the attempt's seed, the Floor, a slot and a salt, so every peer builds the same
 * Floor with nothing sent, and nothing here is stored in the Simulation. The Map Source and the fields come later
 * (`floorSource`, `delverBattle`); this file knows only metres.
 *
 * Only whole metres are used, but for a Passage's half-width (`passage / 2`, a half metre): no Map iteration, no
 * floating-point trig, every tie broken by the lower index.
 */
import type { TuningData } from '../../tuning';
import type { DelverFloorTuning, GalleryPiece } from '../../tuning/delver';
import type { Brush, Doors, Rect, Side } from '../../mapEditor/source';
import { runPick } from '../dungeon';
import { framedRoom, frameHalf, ROOM_FRAMES, type DrawnRoom } from '../../tuning/delverRooms';

/** A point on a Floor with its height (m). */
export interface LevelPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A Hall's shape (docs/plans/delver.md, Stage 7b): its rect, or its rect cut by solid Blocks in its corners (L, T, cross) or its middle (ring). */
export type HallShape = 'rect' | 'L' | 'T' | 'cross' | 'ring';

/** How a Hall's pillars stand: two rows along its long axis, or a grid. */
export type PillarLayout = 'colonnade' | 'grid';

export type DelverHallKind = 'Entrance' | 'Stairs' | 'Boss' | 'Rest' | 'Treasure' | 'Fight' | 'Empty';

/** One Hall: a rectangle on a lattice cell (a great hall: on two), with a doorway on each side a Passage leaves from at its centre. */
export interface DelverHall {
  /** `hall<k>`, k its order of placement. */
  readonly id: string;
  /** Its lattice cell (a great hall's lowest). */
  readonly i: number;
  readonly j: number;
  /** The lattice cells it covers, ascending: one, or two for a great hall. */
  readonly cells: readonly number[];
  /** A great hall: one Hall over two neighbouring lattice cells. */
  readonly great: boolean;
  /** The Hall's centre: a floor point every marker, patrol point and field uses. The rect's centre, but for a ring: the centre of its south band. */
  readonly cx: number;
  readonly cz: number;
  /** The Enclosure's rect: the bounding rect of `rects`. */
  readonly rect: Rect;
  readonly shape: HallShape;
  /** Its floor seen from above: the rect less its solids, in band order (`floorRects`); [rect] for a rect. */
  readonly rects: readonly Rect[];
  /** The notches (corner order NE, SE, SW, NW) or the ring's core: Blocks from the floor to the roof; [] for a rect. */
  readonly solids: readonly Rect[];
  /** 2 x 2 m Blocks standing on its floor, ascending z then x; [] for none. */
  readonly pillars: readonly Rect[];
  /** How the pillars stand; absent: no pillars. */
  readonly layout?: PillarLayout;
  readonly doors: Doors;
  readonly kind: DelverHallKind;
  /** Metres from the Entrance by the Passage graph. */
  readonly depth: number;
  /** Its floor's level (0 to `levels.max`): its floor stands at `y` = `level * LEVEL_RISE`. */
  readonly level: number;
  readonly y: number;
  /** Its roof (m): `y + HALL_STOREY`, or `y + GALLERY_STOREY` with a gallery. */
  readonly top: number;
  /** A raised walkway along one wall; absent: none. */
  readonly gallery?: DelverGallery;
  /** A split, a pit or a dais (Stage 7c); absent: none. A Hall has at most one of a gallery and a feature. */
  readonly feature?: DelverFeature;
  /** Lava (Stage 7d): a pit, a river or troughs; absent: none. A Hall with lava has no gallery, feature, shape or pillars. */
  readonly lava?: DelverLava;
}

/**
 * What a Hall's lava is (docs/plans/delver.md, Stage 7d): one rect in its middle ringed by floor, a band from wall to wall cut by bridges, or strips along
 * one or two walls; or (Stage 7f) a Lava Bridge's: all lava but a dry plaza round the centre and an arm from each held doorway to it; or (Stage 7g) a
 * drawn room's lava pools, as the room drew them.
 */
export type LavaKind = 'pit' | 'river' | 'trough' | 'cross' | 'room';

/**
 * A Hall's lava (Stage 7d): the kit's `lava` Hazard `LAVA_DEPTH` under the Hall's floor, a Death by Lava for anyone who walks, falls or is knocked
 * over its edge. Each rect is a Hole in the floor with the Hazard under it; the Hall's `rects` (its floor less solids) still hold them.
 */
export interface DelverLava {
  readonly kind: LavaKind;
  /** A pit: [the side of the band holding the Hall's centre]; a river: [its bank wall]; troughs: their walls, one or two, in pick order. */
  readonly walls: readonly Side[];
  /** The lava seen from above, ascending z then x: each a Hole in the Hall's floor and a lava Hazard `LAVA_DEPTH` under it. */
  readonly rects: readonly Rect[];
  /** Its height (m): the Hall's `y` - `LAVA_DEPTH`. */
  readonly y: number;
  /** A river's bridges (the floor between its rects, across the whole band), ascending along the river; a cross's arms, ascending z then x; [] for a pit or troughs. */
  readonly bridges: readonly Rect[];
  /** A cross's dry plaza round the Hall's centre (Stage 7f); absent for every other kind. */
  readonly plaza?: Rect;
}

/** A feature's Ramp (Stage 7c): on the lower floor, its high end against the higher floor's edge, rising toward `up`. A step is walled to the roof on its open sides; `rails` are its long sides. */
export interface DelverStep {
  readonly rect: Rect;
  /** The lower floor's height (m) and the higher's. */
  readonly lo: number;
  readonly hi: number;
  /** The side its high end faces. */
  readonly up: Side;
  readonly rails: readonly Side[];
}

/** One tier of a split: a floor part at its own level, `y` its height (m). */
export interface DelverTier {
  readonly rect: Rect;
  readonly level: number;
  readonly y: number;
}

/**
 * A split (Stage 7c): the Hall's floor in two or three tiers a level apart, one after another along `axis`, joined by step Ramps. The main tier
 * holds the Hall's centre and its side walls' doorways, at the Hall's level; each outer tier is a level under it, its edge open (a 2 m drop down and
 * a Jump shortcut up).
 */
export interface DelverSplit {
  readonly kind: 'split';
  /** The tiers follow one another along it (x: west to east; z: south to north). */
  readonly axis: 'x' | 'z';
  /** Two or three, ascending along `axis`; the main tier at the Hall's level. */
  readonly tiers: readonly DelverTier[];
  /** One per outer tier, in tier order. */
  readonly steps: readonly DelverStep[];
}

/**
 * A pit (Stage 7c): the Hall's middle sunk `depth` m under a rim that holds every doorway, two step Ramps down. The Hall's `level` and `y` are the
 * pit floor's.
 */
export interface DelverPit {
  readonly kind: 'pit';
  readonly depth: 2 | 4;
  /** The pit's floor, at the Hall's `y`: the rect less `PIT_RIM` on every side. */
  readonly pit: Rect;
  /** The rim's height (m): `y + depth`. */
  readonly rim: number;
  /** The rim's four rects (`floorRects(rect, [pit])`: south, west, east, north). */
  readonly rims: readonly Rect[];
  /** Two, on the pit floor. */
  readonly steps: readonly DelverStep[];
}

/**
 * A dais (Stage 7c): a Platform `DAIS_RISE` (1 m) over the Hall's floor against one wall of a Boss Hall (its throne: the Boss's post on it) or a Treasure
 * Hall (its altar: the three pedestals on it), reached by one step Ramp. The Hall's `level` and `y` stay the floor's.
 */
export interface DelverDais {
  readonly kind: 'dais';
  /** The wall it stands against; no Passage leaves by that wall. */
  readonly side: Side;
  /** Its top's footprint: `DAIS_HALF` each side of the Hall's centre along the wall (on an even metre), `DAIS_DEPTH` in from it. */
  readonly rect: Rect;
  /** Its top (m): the Hall's `y` + `DAIS_RISE`. */
  readonly y: number;
  /** One: on the floor, `DAIS_STEP` long against the dais's inner edge, rising toward the wall. */
  readonly steps: readonly DelverStep[];
}

/**
 * An Uphill Room (Stage 7f): the whole Hall one Ramp the full width, from a low landing at one end wall to a high landing at the other. The Hall's
 * `level` and `y` are the high landing's; its Enclosure stands `rise` levels under it, on the low landing. Doors only on the two end walls.
 */
export interface DelverUphill {
  readonly kind: 'uphill';
  /** The axis the Ramp runs along. */
  readonly axis: 'x' | 'z';
  /** The high end's wall. */
  readonly up: Side;
  /** The levels from the low landing up to the high one. */
  readonly rise: 1 | 2;
  /** The low landing (`UPHILL_FOOT` deep, the Enclosure's floor) and the high landing (`UPHILL_TOP` deep, a Platform at the Hall's `y`). */
  readonly low: Rect;
  readonly high: Rect;
  /** One: the Ramp between them, the full width with no rails. */
  readonly steps: readonly DelverStep[];
}

/**
 * A Spiral Stair (Stage 7f): a `LEDGE_WIDE` ledge that climbs round three walls over an open floor (the well), from the base wall's corner to a door
 * landing on each of the other walls, each a level higher than the last, with a corner landing half a level between. The Hall's `level` and `y` are the
 * well's. Its inner edge is open: no rail.
 */
export interface DelverSpiral {
  readonly kind: 'spiral';
  /** The wall of the well's door. */
  readonly base: Side;
  /** 0: counter-clockwise seen from above (s, e, n, w for base s); 1: clockwise. */
  readonly turn: 0 | 1;
  /** Five, in climbing order: wall 2's door landing, a corner, wall 3's door landing, a corner, wall 4's door landing. `level` is `y / LEVEL_RISE` (a half for a corner). */
  readonly landings: readonly DelverTier[];
  /** Five Ramps, in climbing order, each before its landing; the first on the well, the others on the landing before them. */
  readonly steps: readonly DelverStep[];
  /** The well: the Hall's floor the ledge does not cover (`floorRects(rect, the ledge's footprints)`). */
  readonly well: readonly Rect[];
}

/**
 * A drawn room (docs/plans/delver.md, Stage 7g): a room the user drew 1:1 in the Map Editor (`data/delver/rooms/<name>.json`), placed whole in a Hall
 * that takes its size, in one of its 8 frames (`framedRoom`). The Hall's `level` and `y` are the room's floor; its doors stand at the room's doorway
 * levels. The room's pieces (`framedRoom(room, frame).brushes`, moved to the Hall's centre) are written by the source.
 */
export interface DelverRoom {
  readonly kind: 'room';
  /** The room's name (its file's). */
  readonly name: string;
  /** Its frame, 0 to 7 (`ROOM_FRAMES`). */
  readonly frame: number;
  /** [half-width, half-depth] in its frame: the Hall's rect's. */
  readonly half: readonly [number, number];
  /** The walls (in the world) that may hold a doorway, each with its floor's level over the Hall's; a wall left out is always solid. */
  readonly doorways: Readonly<Partial<Record<Side, number>>>;
  /** Its Ramps as steps, in Brush order (world metres and heights), so the clutter and the judge read them. */
  readonly steps: readonly DelverStep[];
  /** Its lava pools' rects (world), in Brush order; [] for none. The Hall's `lava` (kind `room`) holds them too. */
  readonly lava: readonly Rect[];
  /** Its ceiling over the Hall's floor (m): the room's `top`. */
  readonly top: number;
  /** Its centre point (world metres): where the Hall's centre and every centre marker stand. */
  readonly centre: readonly [number, number];
  /**
   * How far (m) the room stands off its cell's lattice point, on x and z: 0, or 1 m either way where its wall would land on an even metre. A doorway on a wall
   * along a shifted axis is then 1 m off the room's wall centre, at the Passage's line, and cut by the Passage (as a raised door is).
   */
  readonly shift: readonly [number, number];
  /** Its pieces as the source writes them: the room's Brushes in its frame, moved to the Hall's centre (world metres) and up to its `y`, ids `<hall>-<brush id>`, each Block to the Hall's ceiling. */
  readonly brushes: readonly Brush[];
}

/** A Hall's vertical feature besides a gallery. */
export type DelverFeature = DelverSplit | DelverPit | DelverDais | DelverUphill | DelverSpiral | DelverRoom;

/** A set piece (Stage 7f): a Lava Bridge (lava kind `cross`), an Uphill Room or a Spiral Stair; or (Stage 7g) a drawn room. */
export type SetPieceKind = 'cross' | 'uphill' | 'spiral' | 'room';
export const SET_PIECE_KINDS: readonly SetPieceKind[] = ['cross', 'uphill', 'spiral', 'room'];

/** Hall `h`'s set piece, if any. */
export function setPieceOf(h: DelverHall): SetPieceKind | undefined {
  if (h.lava?.kind === 'cross') return 'cross';
  return h.feature?.kind === 'uphill' || h.feature?.kind === 'spiral' || h.feature?.kind === 'room' ? h.feature.kind : undefined;
}

/**
 * `tuning` with every Hall rolled for set piece `kind` and only that kind weighted (`setPieces.percent` [100]): the Map Editor's look at one set piece
 * (docs/plans/delver.md, Stage 7f, §9), and the tests'. Never a Run's. With `room` (Stage 7g), only the drawn room of that name is in the pool.
 */
export function onlySetPiece(tuning: TuningData, kind: SetPieceKind, room?: string): TuningData {
  const f = tuning.delver.floor;
  const weights = { cross: 0, uphill: 0, spiral: 0, room: 0, [kind]: 1 };
  const drawnRooms = room === undefined ? f.drawnRooms : f.drawnRooms.filter((r) => r.name === room);
  return { ...tuning, delver: { ...tuning.delver, floor: { ...f, setPieces: { percent: [100], weights }, drawnRooms } } };
}

/** The Set Piece Gallery's lattice is at most this many columns wide, snaking back and forth over as many rows as it needs. */
const GALLERY_COLS = 5;
const galleryCache = new WeakMap<DelverFloorTuning, DelverFloorTuning>();

/**
 * The Set Piece Gallery (dev only): `f` made into a Floor that holds every set piece, one after another: a Lava Bridge, an Uphill, a Spiral, then each
 * drawn room in file order. The Halls snake over the lattice (left to right, then back), from the Entrance to the Stairs, each joined to the one before
 * by a straight Passage; the Hall after the Entrance and those where the snake turns are plain, so each set piece has its doorways on opposite walls.
 * Each set piece Hall is a Fight (a drawn room that may not be one, Empty) and each plain Hall Empty. No loops, Rests, Treasure, great halls or other features. `planFloor` follows `gallery` instead of rolling; `delverFloor` refuses an
 * attempt where a piece did not fit. The same object for the same `f`.
 */
export function galleryFloorTuning(f: DelverFloorTuning): DelverFloorTuning {
  const cached = galleryCache.get(f);
  if (cached) return cached;
  const wanted: GalleryPiece[] = [{ kind: 'cross' }, { kind: 'uphill' }, { kind: 'spiral' }, ...f.drawnRooms.map((r) => ({ kind: 'room' as const, room: r.name }))];
  const cols = Math.min(GALLERY_COLS, wanted.length + 2);
  // The Entrance alone on row 0; the snake from the cell north of it, over rows 1 on, one cell at a time: first a plain Hall (the Passage into it turns,
  // so no Warband is in sight of the spawns), then the pieces in order, but where the snake turns: a row's end cell (where it turns north) and the next
  // row's first are plain. Then the Stairs.
  const path: number[] = [0];
  const pieces: (GalleryPiece | null)[] = [null];
  let next = 0;
  for (let k = 0; next < wanted.length || pieces[pieces.length - 1] !== null; k++) {
    const j = 1 + Math.floor(k / cols);
    const along = k % cols;
    const i = j % 2 === 1 ? along : cols - 1 - along;
    path.push(j * cols + i);
    const turn = along === 0 || (along === cols - 1 && next < wanted.length);
    pieces.push(turn || next >= wanted.length ? null : wanted[next++]!);
  }
  const rows = Math.floor(path[path.length - 1]! / cols) + 1;
  const big = f.halfSize[1];
  const out: DelverFloorTuning = {
    ...f,
    cols,
    rows,
    rooms: path.length,
    // Gaps wide enough for the biggest Halls with a Passage of a few metres between, and Halls as big as they come (a set piece wants the room).
    gaps: [2 * big + f.minPassage + 4],
    halfSize: [Math.max(f.halfSize[0], big - 2), big],
    farPercent: 0,
    turnPercent: 0,
    loops: [0, 0],
    rests: [0, 0],
    treasures: 0,
    emptyPercent: 0,
    patrols: 0,
    maxAttempts: Math.max(f.maxAttempts, 100),
    levels: { ...f.levels, galleryPercent: 0, min: 1 },
    galleries: { ...f.galleries, wrapPercent: 0, stairPercent: 0 },
    features: { ...f.features, percent: 0, daisPercent: 0 },
    great: { ...f.great, count: [0, 0] },
    shapes: { ...f.shapes, percent: 0 },
    pillars: { ...f.pillars, percent: 0 },
    lava: { ...f.lava, percent: [0] },
    setPieces: { ...f.setPieces, percent: [100] },
    gallery: { path, pieces },
  };
  galleryCache.set(f, out);
  return out;
}

/** The reasons a Set Piece Gallery plan is refused: each Hall whose set piece is not the one `t.gallery` wants (it did not fit). [] for a plan that is not a gallery's. */
export function galleryReasons(t: DelverFloorTuning, plan: FloorPlan): string[] {
  if (!t.gallery) return [];
  return t.gallery.pieces.flatMap((want, h) => {
    const hall = plan.halls[h];
    if (!hall) return [`gallery: Hall ${h} missing`];
    const got = setPieceOf(hall);
    const gotRoom = hall.feature?.kind === 'room' ? hall.feature.name : undefined;
    if ((want?.kind ?? undefined) === got && want?.room === gotRoom) return [];
    return [`gallery: ${hall.id} wants ${want ? (want.room ?? want.kind) : 'no set piece'}, got ${gotRoom ?? got ?? 'none'}`];
  });
}

/** Why a set-piece roll left its Hall plain or was undone (Stage 7f): a plan-only count, never part of the plan. */
export interface SetPieceDrops {
  great: number;
  size: number;
  doorWalls: number;
  kind: number;
  range: number;
  /** An Uphill or Spiral that the Entrance, a Rest or the Treasure pick took because its pool held nothing else (§4: expected 0). */
  fallback: number;
  /** Stage 7g: a room roll with no (room, frame) that fits the Hall (its cell, its Walls' metres, its Passages, its door walls). Absent: none yet. */
  fit?: number;
}

/** A fresh `SetPieceDrops`, every count 0. */
export const noDrops = (): SetPieceDrops => ({ great: 0, size: 0, doorWalls: 0, kind: 0, range: 0, fallback: 0, fit: 0 });

/** The Enclosure's floor of a Hall (m): a split's lowest tier, an Uphill's low landing, else the Hall's `y` (a pit's floor, a dais Hall's floor, a Spiral's well). */
export function hallBase(h: DelverHall): number {
  if (h.feature?.kind === 'split') return Math.min(...h.feature.tiers.map((t) => t.y));
  if (h.feature?.kind === 'uphill') return h.y - h.feature.rise * LEVEL_RISE;
  return h.y;
}

/**
 * A gallery: a Deck one level over its Hall's floor along one wall, reached by a Ramp inside the Hall. It is a stairwell (`high`) when a
 * Passage leaves through that wall at the Deck's height, else a balcony. Its front edge is open: the Floor's only Jump shortcut.
 */
export interface DelverGallery {
  /** The wall it runs along. */
  readonly side: Side;
  /** 0: the Deck at the low-coordinate end of the wall (west for n and s, south for e and w), 1: the other. */
  readonly end: 0 | 1;
  /** The Deck's height: the Hall's `y` + `LEVEL_RISE`. */
  readonly y: number;
  readonly deck: Rect;
  readonly ramp: Rect;
  /** The Ramp's high end, toward the Deck. */
  readonly up: Side;
  /** A stairwell: a Passage leaves through `side` (or a wall of `wrap`) at the Deck's height. */
  readonly high: boolean;
  /**
   * The Deck turned a corner (Stage 7c): onto the next wall (an L: `walls` is [the wall at the Deck's end]) or on to the one after (a U: that
   * wall, then `side`'s opposite). `decks` is the Deck along each wall, in that order. Absent: the gallery runs along `side` only.
   */
  readonly wrap?: { readonly walls: readonly Side[]; readonly decks: readonly Rect[] };
}

/** The shape of a Passage: straight (one leg), or turning at right angles: an L (one corner), an S or a Z (two corners, its two ends parallel and offset). */
export type PassageShape = 'straight' | 'L' | 'S' | 'Z';

/** One piece of a Passage: a leg (a stretch `passage` m wide) or a corner (the `passage` x `passage` square two legs meet in). Each is its own Enclosure. */
export interface PassagePiece {
  readonly rect: Rect;
  readonly corner: boolean;
  /** The axis it runs along (a corner's is that of the leg before it). */
  readonly axis: 'x' | 'z';
  /** The side it is entered by, walking from `a`'s end, and the side it is left by toward `b`'s. A leg's are opposite; a corner's are not. */
  readonly from: Side;
  readonly to: Side;
  /** Its floor's height (m) at its `from` and at its `to` side: equal, but on the Passage's one sloped leg. */
  readonly y0: number;
  readonly y1: number;
}

/** A Passage between two Halls' slots: straight between facing slots, or turning by corners. */
export interface DelverPassage {
  /** `pass<n>`: the tree's Passages first (in growth order), then the loops. */
  readonly id: string;
  /** Hall indices: a straight Passage's `a` is west of `b` (axis 'x') or south of it (axis 'z'); a turning one's is the Hall it was grown or found from. */
  readonly a: number;
  readonly b: number;
  /** The axis of its first leg. */
  readonly axis: 'x' | 'z';
  /** The bounding rect of its pieces (a straight Passage's one piece). It is never a place test: use `pieces`. */
  readonly rect: Rect;
  /** Centre to centre (m): |dx| + |dz|. */
  readonly length: number;
  /** Whether it is one of the extra Passages after the spanning tree. */
  readonly loop: boolean;
  /** Its door heights (m) at `a`'s and `b`'s end: the Hall's floor, or the Deck's through a gallery's wall. A sloped Passage has them one level apart. */
  readonly ya: number;
  readonly yb: number;
  readonly shape: PassageShape;
  /** The sides of `a` and `b` it leaves by. */
  readonly sideA: Side;
  readonly sideB: Side;
  /** From `a`'s end to `b`'s. */
  readonly pieces: readonly PassagePiece[];
}

export interface MarkerPoint {
  readonly hall: number;
  readonly x: number;
  /** The floor it stands on (m): its Hall's, or its Deck's. */
  readonly y: number;
  readonly z: number;
}

/** A patrol loop: a cycle of Halls (consecutive ones joined, the last to the first) and their centres. */
export interface DelverPatrol {
  readonly halls: readonly number[];
  readonly points: readonly LevelPoint[];
}

export interface DelverMarkers {
  /** The four Entrance spawns. */
  readonly spawns: readonly MarkerPoint[];
  readonly stairs: { readonly hall: number; readonly zone: Rect; readonly y: number };
  readonly fires: readonly MarkerPoint[];
  readonly pedestals: readonly MarkerPoint[];
  /** The Warband posts: one at each Fight Hall's centre. */
  readonly posts: readonly MarkerPoint[];
  readonly patrols: readonly DelverPatrol[];
  /** A Boss Floor only: the Boss Hall's centre, where the Boss Warband stands (Stage 4). Absent on any other Floor. */
  readonly boss?: MarkerPoint;
}

export interface FloorPlan {
  readonly seed: number;
  readonly floor: number;
  readonly attempt: number;
  readonly halls: readonly DelverHall[];
  readonly passages: readonly DelverPassage[];
  readonly entrance: number;
  readonly stairs: number;
  /** Hall indices from the Entrance to the Stairs by the shortest walk. */
  readonly mainPath: readonly number[];
  /** The Halls in line with the Entrance (never posts or patrol Halls), in the order followed. */
  readonly inLine: readonly number[];
  readonly markers: DelverMarkers;
  /** The Set Piece Gallery's Floor (dev only, `galleryFloorTuning`); absent on every Run's Floor. */
  readonly gallery?: true;
}

/** `runPick` salts, so each choice made for one slot is independent of the others. */
export const SALT = {
  gapX: 1, gapZ: 2, start: 3, grow: 4, far: 5, hw: 6, hd: 7, loopCount: 8, loop: 9, entrance: 10, rests: 11, treasure: 12, order: 13, reroll: 14,
  galleryOrder: 30, gallerySide: 31, galleryEnd: 32, levelBase: 33, levelChange: 34, levelUp: 35,
  galleryStair: 60, galleryWrap: 61, galleryU: 62,
  feature: 63, featureKind: 64, splitAxis: 65, splitTiers: 66, splitSide: 67, splitStep: 68, pitDeep: 69, pitTurn: 70, dais: 71, daisSide: 72,
  lava: 73, lavaKind: 74, lavaSide: 75, lavaWide: 76, lavaTwo: 77,
  setPiece: 78, setPieceKind: 79, uphillAxis: 80, uphillEnd: 81, spiralBase: 82, spiralTurn: 83, roomPick: 84, roomFrame: 85,
  greatCount: 40, greatAxis: 41, greatLong: 42, great: 43, turn: 44, turnPick: 45,
  shape: 50, shapeKind: 51, shapeTurn: 52, notchX: 53, notchZ: 54, ringX: 55, ringZ: 56, pillars: 57, pillarLayout: 58, colonnadeRow: 59,
} as const;
/** A notch's least extent on each axis (m). */
export const NOTCH_MIN = 4;
/** The least distance (m) from a Hall's centre to a notch's inner edge on each axis. */
export const CENTRE_KEEP = 4;
/** A ring's least band (m). */
export const RING_BAND = 6;
/** The least gap (m) from a pillar to a Wall or a solid. */
export const WALL_GAP = 3;
/** The half side (m) of the square round a Hall's centre that no pillar enters. */
export const MARKER_KEEP = 5;
/** A doorway's lane goes this many metres inward and is `DOOR_SIDE` m wider than the doorway on each side. */
export const DOOR_LANE = 6;
export const DOOR_SIDE = 1;
/** A pillar's half side (m); a colonnade's row distance from the centre line and its step along; a grid's step (m); the fewest pillars a Hall keeps. */
export const PILLAR_HALF = 1;
export const COLONNADE_ROW = 6;
export const COLONNADE_STEP = 6;
export const GRID_STEP = 8;
export const PILLARS_MIN = 2;
/** The least gap (m) between a turning Passage's piece and any Hall or other Passage it does not join, and between a great hall and a Passage (Walls are drawn 0.6 m thick). */
export const PASSAGE_CLEAR = 1;
/** An S or Z's shortest end leg (m). */
export const MIN_LEG = 2;
/** A level's rise (m): a Hall's floor is a whole number of levels, a Passage rises or falls one at most, a gallery's Deck stands one over its Hall's floor. */
export const LEVEL_RISE = 2;
/** A plain Hall's roof over its floor (m): tall enough that a standard Fighter's full Jump (its feet about 4 m up) never bumps its head. */
export const HALL_STOREY = 6;
/** A gallery Hall's roof over its floor (m): the Deck stands `GALLERY_STOREY - LEVEL_RISE` = `HALL_STOREY` under it, as much headroom as a plain Hall's floor. */
export const GALLERY_STOREY = 8;
/** A Passage's roof over its higher door (m): lower than a Hall's, more than a doorway (`DOOR_HEIGHT`, 3 m). */
export const PASSAGE_STOREY = 4;
/** A gallery's strip: its depth across (m), the Ramp's length and as deep as the strip, and the Hall's floor between the Ramp's foot and the side wall. */
export const GALLERY_DEPTH = 4;
export const GALLERY_RAMP = 4;
export const GALLERY_APPROACH = 2;
/** The clear space (m) a gallery leaves between its strip's inner edge and the Hall's centre. */
export const CENTRE_CLEAR = 4;
/** The shortest Deck (m) a gallery has, and the shortest that holds a guard's post. */
export const DECK_MIN = 4;
export const DECK_POST = 6;
/** The steepest Ramp: 1 in 2 (`LEVEL_RISE / GALLERY_RAMP`; a Passage is at least twice `LEVEL_RISE` long). */
export const MAX_SLOPE = 0.5;
/** The highest ledge (m) a Jump shortcut may be: the real Jump reaches about 4.3 m and lands on a 2 m ledge from 3.8 m (docs/jump-reach.md). */
export const JUMP_SHORTCUT_CAP = 2.5;
/** A split's cuts lie at least this far (m) from the Hall's centre, on odd metres: the main tier keeps the centre and the side walls' doorways. */
export const SPLIT_CUT = 4;
/** An outer tier's least depth (m): its step's 4 and 2 m of approach. */
export const TIER_MIN = 6;
/** A step's width (m) across its run: a split's step is a square of it, a pit's step is as wide and `2 * depth` long. */
export const STEP_WIDTH = 4;
/** A pit's rim (m): its width on every side. */
export const PIT_RIM = 4;
/** The larger half (m) a Hall needs for a pit (the rim's 4, the step's 4 and the centre's 4), and the smaller (the rim's 4 and the centre's 4; it holds a 4 m pit's 8 m step). */
export const PIT_WIDE = 12;
export const PIT_LONG = 8;
/** The pit floor (m) a pit's step leaves before its foot, along the step: a 4 m pit's 8 m step needs a pit 10 m long. */
export const PIT_APPROACH = 2;
/** A dais's height (m) over the Hall's floor: more than a Soldier steps up, so only its step gets one on. */
export const DAIS_RISE = 1;
/** A dais's half length (m) along its wall, from the Hall's centre line on an even metre (edges on odd metres). */
export const DAIS_HALF = 5;
/** A dais's depth (m) from its wall. The throne and the altar stand half of it in. */
export const DAIS_DEPTH = 6;
/** A dais's step's length (m) from the dais's inner edge, and its half width along the wall. */
export const DAIS_STEP = 2;
export const DAIS_STEP_HALF = 3;
/** Lava lies this far (m) under its Hall's floor, as the Cavern's river lies under its ledges: more than a Soldier steps down (`levels.drop`, 3), so the Crowd never walks in. */
export const LAVA_DEPTH = 4;
/** No marker, drop spot or revive spot comes nearer lava than this (m): a Knockdown's longest Slide (1.5) and 1 m more. */
export const LAVA_KEEP = 2.5;
/** No lava lies inside the square Hall centre +- this (m): every marker at the centre (at most 3 m off it) then keeps 3 m, more than `LAVA_KEEP`. */
export const LAVA_CENTRE = 6;
/** Lava keeps this far (m) from every held slot's lane (the lane of `DOOR_LANE` and `DOOR_SIDE`), but a river's lanes on its bank wall, which cross a bridge. */
export const LAVA_LANE = 1;
/** A lava rect's least extent (m). */
export const LAVA_MIN = 2;
/** A river's bridge's least width (m): two Fighters abreast, as a Formation files through. */
export const BRIDGE_MIN = 4;
/** The floor (m) between a river and its bank wall: wide enough to walk off any bridge and along the wall. */
export const RIVER_BANK = 4;
/** A pit's band (m) of floor on each side but its centre side (which is `2 * LAVA_CENTRE`: the Hall's centre moves into it). */
export const LAVA_BAND = 8;
/** A lava pit's least extent (m) on each axis. */
export const PIT_MIN = 4;
/** A trough segment's least length (m) along its wall. */
export const TROUGH_MIN = 4;
/** The odd metre at most / at least `v`: every lava edge lies on one (a Hall's walls do), off the fields' 2 m dots. */
export const oddDown = (v: number): number => 2 * Math.floor((v - 1) / 2) + 1;
export const oddUp = (v: number): number => 2 * Math.ceil((v - 1) / 2) + 1;
/** An Uphill's low landing's depth (m): a doorway's lane; and its high landing's (the centre stands in its middle). */
export const UPHILL_FOOT = 6;
export const UPHILL_TOP = 10;
/** A Spiral's ledge's width (m): at least a Formation's file (`BRIDGE_MIN`). */
export const LEDGE_WIDE = 4;
/** The well floor (m) between a Spiral's base wall and its first Ramp's foot. */
export const SPIRAL_FOOT = 4;
/** A Spiral's least half (m) on each axis: its centre then keeps 5 m from the ledge. */
export const SPIRAL_HALF = 9;
/** A Lava Bridge's least half (m) on each axis: the plaza's 6 and at least 4 m of lava past it, odd-snapped. */
export const CROSS_HALF = 11;
/** The span (m) along its wall of a door landing or a Lava Bridge's arm: the doorway and half a metre each side, on odd metres (4 or 6 m). */
export const doorSpan = (m: number): [number, number] => [oddDown(m - 2), oddUp(m + 2)];
/** The Stairs zone's half side (m). */
export const STAIRS_HALF = 2;
/** The metres between a Treasure Hall's three pedestals. */
export const PEDESTAL_GAP = 3;
/** The Entrance spawns' offset from its centre on each axis (m). */
export const SPAWN_OFFSET = 1.5;

/** The seed of one layout attempt of (Run seed, Floor): attempt 0 the Run seed, a reroll a salted pick. */
export function attemptSeed(seed: number, floor: number, attempt: number): number {
  return attempt === 0 ? seed >>> 0 : runPick(seed, floor, attempt, SALT.reroll, 0x1_0000_0000);
}

/** Directions in fixed order n, e, s, w (also the sides of a Hall); a lattice step is (di, dj). */
const DIRS: readonly { readonly side: Side; readonly di: number; readonly dj: number }[] = [
  { side: 'n', di: 0, dj: 1 },
  { side: 'e', di: 1, dj: 0 },
  { side: 's', di: 0, dj: -1 },
  { side: 'w', di: -1, dj: 0 },
];
const opposite = (d: number) => (d + 2) % 4;
const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];

/**
 * A set piece's frame (Stage 7f): its geometry is written for base wall s with the turn counter-clockwise (the walls in turn s, e, n, w), in a frame
 * whose rects are the world's mirrored (x negated, for `turn` 1) and then turned a quarter counter-clockwise `k` times (base e 1, n 2, w 3). Negating and
 * swapping keep whole and odd metres, so a rect cut in the frame is the rect the world would cut.
 */
interface Frame {
  /** The Hall's rect in the frame. */
  readonly r: Rect;
  /** A frame rect, and a frame side, in the world. */
  rect(q: Rect): Rect;
  side(d: Side): Side;
}
function frameOf(world: Rect, base: number, turn: 0 | 1): Frame {
  // The quarter turns from s to `base` counter-clockwise: s 0, e 1, n 2, w 3.
  const k = [2, 1, 0, 3][base]!;
  const ccw = (q: Rect): Rect => ({ x0: -q.z1, z0: q.x0, x1: -q.z0, z1: q.x1 });
  const cw = (q: Rect): Rect => ({ x0: q.z0, z0: -q.x1, x1: q.z1, z1: -q.x0 });
  const mirror = (q: Rect): Rect => ({ x0: -q.x1, z0: q.z0, x1: -q.x0, z1: q.z1 });
  let r = world;
  for (let i = 0; i < k; i++) r = cw(r);
  if (turn === 1) r = mirror(r);
  // Sides as indices n 0, e 1, s 2, w 3: a counter-clockwise quarter turn takes n to w (d + 3), a mirror swaps e and w.
  return {
    r,
    rect: (q) => {
      let o = turn === 1 ? mirror(q) : q;
      for (let i = 0; i < k; i++) o = ccw(o);
      return o;
    },
    side: (d) => {
      let i = SIDES.indexOf(d);
      if (turn === 1 && i % 2 === 1) i = opposite(i);
      return SIDES[(i + 3 * k) % 4]!;
    },
  };
}

/** The wall (0 to 3) in a Spiral's climbing order of side index `d`: its base 0, then the walls in its turn. */
const spiralWall = (base: number, turn: 0 | 1, d: number): number => (turn === 0 ? base - d + 4 : d - base + 4) % 4;

/** A Spiral's four walls in climbing order (Stage 7f): its base wall (the well's door), then each wall in its turn (counter-clockwise seen from above for turn 0). */
export function spiralOrder(base: Side, turn: 0 | 1): Side[] {
  const b = SIDES.indexOf(base);
  return [0, 1, 2, 3].map((j) => SIDES[(b + j * (turn === 0 ? 3 : 1)) % 4]!);
}

/**
 * An Uphill's geometry in Hall rect `world` (Stage 7f) with its high end on side `up` (an index), `rise` levels, its high landing at `y`: the low landing, the
 * Ramp and the high landing, and the high landing's middle (the Hall's centre); null when the Ramp would be steeper than `MAX_SLOPE`.
 */
export function uphillGeometry(world: Rect, up: number, rise: 1 | 2, y: number): { low: Rect; high: Rect; step: DelverStep; cx: number; cz: number } | null {
  const fr = frameOf(world, opposite(up), 0);
  const { x0, z0, x1, z1 } = fr.r;
  if (z1 - UPHILL_TOP - (z0 + UPHILL_FOOT) < (rise * LEVEL_RISE) / MAX_SLOPE) return null;
  const centre = fr.rect({ x0: (x0 + x1) / 2, z0: z1 - UPHILL_TOP / 2, x1: (x0 + x1) / 2, z1: z1 - UPHILL_TOP / 2 });
  return {
    low: fr.rect({ x0, z0, x1, z1: z0 + UPHILL_FOOT }),
    high: fr.rect({ x0, z0: z1 - UPHILL_TOP, x1, z1 }),
    step: { rect: fr.rect({ x0, z0: z0 + UPHILL_FOOT, x1, z1: z1 - UPHILL_TOP }), lo: y - rise * LEVEL_RISE, hi: y, up: SIDES[up]!, rails: [] },
    cx: centre.x0,
    cz: centre.z0,
  };
}

/**
 * A Spiral's ledge in Hall rect `world` (Stage 7f) from base wall `base` (an index) in turn `turn`, its well at `y`: the five landings and the five Ramps in
 * climbing order; null when a half is under `SPIRAL_HALF` or a Ramp would be steeper than `MAX_SLOPE`. Written for base s, turn 0 (the ledge up the east
 * wall, along the north and down the west), then put in the world by `frameOf`.
 */
export function spiralGeometry(world: Rect, base: number, turn: 0 | 1, y: number): { landings: DelverTier[]; steps: DelverStep[] } | null {
  const fr = frameOf(world, base, turn);
  const { x0, z0, x1, z1 } = fr.r;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  if ((x1 - x0) / 2 < SPIRAL_HALF || (z1 - z0) / 2 < SPIRAL_HALF) return null;
  const L = LEDGE_WIDE;
  const [a1, b1] = doorSpan(cz);
  const [a3, b3] = doorSpan(cx);
  const full = LEVEL_RISE / MAX_SLOPE;
  const halfRun = LEVEL_RISE / 2 / MAX_SLOPE;
  if (a1 - (z0 + SPIRAL_FOOT) < full || z1 - L - b1 < halfRun || x1 - L - b3 < halfRun || a3 - (x0 + L) < halfRun) return null;
  const R = LEVEL_RISE;
  const H = LEVEL_RISE / 2;
  const tier = (q: Rect, dy: number): DelverTier => ({ rect: fr.rect(q), level: (y + dy) / LEVEL_RISE, y: y + dy });
  const ramp = (q: Rect, lo: number, hi: number, up: Side, rail: Side): DelverStep => ({ rect: fr.rect(q), lo: y + lo, hi: y + hi, up: fr.side(up), rails: [fr.side(rail)] });
  const landings = [
    tier({ x0: x1 - L, z0: a1, x1, z1: b1 }, R),
    tier({ x0: x1 - L, z0: z1 - L, x1, z1 }, R + H),
    tier({ x0: a3, z0: z1 - L, x1: b3, z1 }, 2 * R),
    tier({ x0, z0: z1 - L, x1: x0 + L, z1 }, 2 * R + H),
    tier({ x0, z0: a1, x1: x0 + L, z1: b1 }, 3 * R),
  ];
  const steps = [
    ramp({ x0: x1 - L, z0: z0 + SPIRAL_FOOT, x1, z1: a1 }, 0, R, 'n', 'e'),
    ramp({ x0: x1 - L, z0: b1, x1, z1: z1 - L }, R, R + H, 'n', 'e'),
    ramp({ x0: b3, z0: z1 - L, x1: x1 - L, z1 }, R + H, 2 * R, 'w', 'n'),
    ramp({ x0: x0 + L, z0: z1 - L, x1: a3, z1 }, 2 * R, 2 * R + H, 'w', 'n'),
    ramp({ x0, z0: b1, x1: x0 + L, z1: z1 - L }, 2 * R + H, 3 * R, 's', 'w'),
  ];
  return { landings, steps };
}

/**
 * A drawn room placed in Hall `id` (Stage 7g): `room` in frame `frame`, moved to `rect`'s centre (the frame's half is the rect's) and up to floor height `y`.
 * Its Brushes keep their order, their ids become `<hall>-<brush id>`, every height is raised by `y` and every Block stands to the Hall's ceiling.
 */
export function roomFeature(id: string, room: DrawnRoom, frame: number, rect: Rect, y: number): DelverRoom {
  const fr = framedRoom(room, frame);
  const ox = (rect.x0 + rect.x1) / 2;
  const oz = (rect.z0 + rect.z1) / 2;
  const top = y + room.top;
  const mv = (q: Rect): Rect => ({ x0: q.x0 + ox, z0: q.z0 + oz, x1: q.x1 + ox, z1: q.z1 + oz });
  const pt = (p: { x: number; z: number }) => ({ x: p.x + ox, z: p.z + oz });
  const brushes: Brush[] = fr.brushes.map((b): Brush => {
    const bid = `${id}-${b.id}`;
    switch (b.kind) {
      case 'platform':
        return { ...b, id: bid, rect: mv(b.rect), top: b.top + y };
      case 'block':
        return { ...b, id: bid, rect: mv(b.rect), top };
      case 'ramp':
        return { ...b, id: bid, rect: mv(b.rect), lo: b.lo + y, hi: b.hi + y };
      case 'rail':
        return { ...b, id: bid, a: pt(b.a), b: pt(b.b), y: b.y + y };
      case 'wall':
        return { ...b, id: bid, a: pt(b.a), b: pt(b.b), bottom: b.bottom + y, top: b.top + y };
      case 'hole':
      case 'hazard':
      case 'floor':
      case 'deck':
        return { ...b, id: bid, rect: mv(b.rect), y: b.y + y };
      case 'enclosure':
        return { ...b, id: bid, rect: mv(b.rect), y: b.y + y };
    }
  });
  const steps: DelverStep[] = brushes.flatMap((b) => (b.kind === 'ramp' ? [{ rect: b.rect, lo: b.lo, hi: b.hi, up: b.up, rails: b.rails }] : []));
  const lava = brushes.flatMap((b) => (b.kind === 'hazard' && b.hazard === 'lava' ? [b.rect] : []));
  return { kind: 'room', name: room.name, frame, half: fr.half, doorways: fr.doorways, steps, lava, brushes, top: room.top, centre: [ox + fr.centre[0], oz + fr.centre[1]], shift: [0, 0] };
}

interface Edge {
  readonly to: number;
  readonly w: number;
}

/**
 * Walking distances from `sources` over `adj` by an O(n^2) Dijkstra: the unvisited node of least distance is taken next,
 * ties by the lower index, and a node's predecessor is the first one that reached its final distance.
 */
function dijkstra(adj: readonly (readonly Edge[])[], sources: readonly number[]): { dist: number[]; pred: number[] } {
  const n = adj.length;
  const dist = new Array<number>(n).fill(Infinity);
  const pred = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  for (const s of sources) dist[s] = 0;
  for (;;) {
    let u = -1;
    for (let v = 0; v < n; v++) if (!done[v] && dist[v]! < Infinity && (u < 0 || dist[v]! < dist[u]!)) u = v;
    if (u < 0) break;
    done[u] = true;
    for (const e of adj[u]!) {
      if (!done[e.to] && dist[u]! + e.w < dist[e.to]!) {
        dist[e.to] = dist[u]! + e.w;
        pred[e.to] = u;
      }
    }
  }
  return { dist, pred };
}

/** A point on a Floor (m). */
interface Pt {
  readonly x: number;
  readonly z: number;
}

/**
 * The route a Passage takes: the side of `a` it leaves by and the centre line it runs on there (an x for n or s, a z for e or w), the same at
 * `b`, and its corners' centres from `a`'s end to `b`'s (none: straight).
 */
export interface PassageRoute {
  readonly sideA: Side;
  readonly lineA: number;
  readonly sideB: Side;
  readonly lineB: number;
  readonly corners: readonly Pt[];
}

const sidePoint = (r: Rect, side: Side, line: number): Pt =>
  side === 'e' ? { x: r.x1, z: line } : side === 'w' ? { x: r.x0, z: line } : side === 'n' ? { x: line, z: r.z1 } : { x: line, z: r.z0 };
/** The direction (0 n, 1 e, 2 s, 3 w) from `p` to `q`, which differ on one axis only; `fallback` when they are the same point. */
const dirOf = (p: Pt, q: Pt, fallback: number): number => (q.z === p.z ? (q.x > p.x ? 1 : q.x < p.x ? 3 : fallback) : q.z > p.z ? 0 : 2);
const stepBy = (p: Pt, d: number, m: number): Pt => ({ x: p.x + DIRS[d]!.di * m, z: p.z + DIRS[d]!.dj * m });

/**
 * A Passage's pieces, from `a`'s end to `b`'s (docs/plans/delver.md, Stage 7a): the legs run between consecutive route points (a's side, the
 * corners, b's side), a leg stopping at a Hall's side or at a corner square's edge, and a corner is a `w` x `w` square on its point. A flat
 * Passage (`ya` = `yb`) is flat throughout; a sloped one has exactly one sloped leg (the only leg of a straight one, the leg at the lower end of an
 * L, the middle leg of an S or Z): the pieces before it stand at `ya`, those after at `yb`, and every corner is level.
 */
export function passagePieces(a: Rect, b: Rect, route: PassageRoute, w: number, ya: number, yb: number): PassagePiece[] {
  const half = w / 2;
  const pts: Pt[] = [sidePoint(a, route.sideA, route.lineA), ...route.corners, sidePoint(b, route.sideB, route.lineB)];
  const dirs: number[] = [];
  for (let k = 0; k + 1 < pts.length; k++) dirs.push(dirOf(pts[k]!, pts[k + 1]!, SIDES.indexOf(route.sideA)));
  const legs = dirs.length;
  const sloped = ya === yb ? -1 : legs === 1 ? 0 : legs === 2 ? (ya < yb ? 0 : 1) : 1;
  const level = (l: number) => (sloped < 0 || l < sloped ? ya : yb);
  const out: PassagePiece[] = [];
  for (let l = 0; l < legs; l++) {
    const d = dirs[l]!;
    const start = l === 0 ? pts[0]! : stepBy(pts[l]!, d, half);
    const end = l === legs - 1 ? pts[legs]! : stepBy(pts[l + 1]!, d, -half);
    const rect: Rect =
      d % 2 === 1
        ? { x0: Math.min(start.x, end.x), z0: start.z - half, x1: Math.max(start.x, end.x), z1: start.z + half }
        : { x0: start.x - half, z0: Math.min(start.z, end.z), x1: start.x + half, z1: Math.max(start.z, end.z) };
    out.push({ rect, corner: false, axis: d % 2 === 1 ? 'x' : 'z', from: SIDES[opposite(d)]!, to: SIDES[d]!, y0: l === sloped ? ya : level(l), y1: level(l) });
    if (l < legs - 1) {
      const c = pts[l + 1]!;
      const y = level(l);
      out.push({ rect: { x0: c.x - half, z0: c.z - half, x1: c.x + half, z1: c.z + half }, corner: true, axis: d % 2 === 1 ? 'x' : 'z', from: SIDES[opposite(d)]!, to: SIDES[dirs[l + 1]!]!, y0: y, y1: y });
    }
  }
  return out;
}

/** The shape of a route's pieces: the corners' count, and for two a Z when the first turn, walking from `a`, is clockwise, else an S. */
function shapeOf(pieces: readonly PassagePiece[]): PassageShape {
  const legs = pieces.filter((q) => !q.corner);
  if (legs.length === 1) return 'straight';
  if (legs.length === 2) return 'L';
  const d0 = SIDES.indexOf(legs[0]!.to);
  const d1 = SIDES.indexOf(legs[1]!.to);
  return d1 === (d0 + 1) % 4 ? 'Z' : 'S';
}

const boundsOf = (pieces: readonly PassagePiece[]): Rect => ({
  x0: Math.min(...pieces.map((q) => q.rect.x0)),
  z0: Math.min(...pieces.map((q) => q.rect.z0)),
  x1: Math.max(...pieces.map((q) => q.rect.x1)),
  z1: Math.max(...pieces.map((q) => q.rect.z1)),
});

/** Whether `p` and `q` are at least `c` apart on an axis (x-gap or z-gap at least `c`); c 0: they touch or are apart, but do not overlap. */
const apartBy = (p: Rect, q: Rect, c: number): boolean => Math.max(p.x0 - q.x1, q.x0 - p.x1) >= c || Math.max(p.z0 - q.z1, q.z0 - p.z1) >= c;

/** The even metre nearest `v`, the lower on a tie: a pillar is centred on one, so its edges are on odd metres, off the fields' 2 m dots. */
const ev = (v: number): number => 2 * Math.ceil((v - 1) / 2);

/**
 * A Hall's floor seen from above (docs/plans/delver.md, Stage 7b): `rect` cut into z-bands at every solid's z-edges, ascending; in each band the x-runs a
 * solid does not cover, ascending; a band merges into the one before when their runs are the same. So a rect gives [rect], an L, T or cross its bands
 * south first, and a ring its south, west, east and north rects.
 */
export function floorRects(rect: Rect, solids: readonly Rect[]): Rect[] {
  const edges = [rect.z0, rect.z1];
  for (const q of solids) for (const z of [q.z0, q.z1]) if (z > rect.z0 && z < rect.z1) edges.push(z);
  edges.sort((a, b) => a - b);
  const cuts = edges.filter((z, k) => k === 0 || z !== edges[k - 1]);
  const bands: { z0: number; z1: number; runs: [number, number][] }[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const z0 = cuts[k]!;
    const z1 = cuts[k + 1]!;
    const covering = solids.filter((q) => q.z0 <= z0 && q.z1 >= z1).sort((a, b) => a.x0 - b.x0);
    const runs: [number, number][] = [];
    let at = rect.x0;
    for (const q of covering) {
      if (q.x0 > at) runs.push([at, Math.min(q.x0, rect.x1)]);
      at = Math.max(at, q.x1);
    }
    if (at < rect.x1) runs.push([at, rect.x1]);
    const prev = bands[bands.length - 1];
    if (prev && prev.runs.length === runs.length && prev.runs.every((r, m) => r[0] === runs[m]![0] && r[1] === runs[m]![1])) prev.z1 = z1;
    else bands.push({ z0, z1, runs });
  }
  return bands.flatMap((b) => b.runs.map(([x0, x1]) => ({ x0, z0: b.z0, x1, z1: b.z1 })));
}

/**
 * A Hall's floor at least `keep` m from its lava (Stage 7d), in band order: `floorRects` of the rect less its solids and each lava rect grown by `keep`
 * on every side and clipped to the rect. Callers test `hall.lava` first (with none it is the Hall's `rects`).
 */
export function lavaDry(hall: DelverHall, keep: number): Rect[] {
  const r = hall.rect;
  const grown = (hall.lava?.rects ?? []).map((q): Rect => ({ x0: Math.max(r.x0, q.x0 - keep), z0: Math.max(r.z0, q.z0 - keep), x1: Math.min(r.x1, q.x1 + keep), z1: Math.min(r.z1, q.z1 + keep) }));
  return floorRects(r, [...hall.solids, ...grown]);
}

/** Where a Passage may leave a Hall: a side, the lattice cell it is on, and the centre line it runs on (an x for n or s, a z for e or w). */
interface Slot {
  readonly d: number;
  readonly cell: number;
  readonly line: number;
  /** A great hall's long-side slot (off the side's centre): its Passage is flat and its doorway is cut by the Passage's own. */
  readonly long: boolean;
  /** The Passage in it, or -1. */
  p: number;
}

interface WorkHall {
  i: number;
  j: number;
  cx: number;
  cz: number;
  rect: Rect;
  /** The lattice cells it covers, ascending. */
  cells: number[];
  great: boolean;
  /** Its slots: by side n, e, s, w and on a side by ascending cell (a one-cell Hall's index is its side). */
  slots: Slot[];
}

interface WorkPassage {
  a: number;
  b: number;
  /** The slots (indices into the Halls') it leaves `a` and `b` by. */
  sa: number;
  sb: number;
  loop: boolean;
  far: boolean;
  /** The Hall it was grown or found from and its slot there (a tree Passage's parent end), and the other end's Hall and slot. */
  from: number;
  fs: number;
  to: number;
  ts: number;
  route: PassageRoute;
  /** Its pieces against the Halls' rects as they stand. */
  pieces: PassagePiece[];
}

/** A turning candidate: a Hall's free slot and a perpendicular direction `p`, an L (corner cell `c1`) or an S or Z, to the cell `t`. */
interface Turn {
  h: number;
  s: number;
  d: number;
  p: number;
  kind: 'L' | 'SZ';
  c1: number;
  t: number;
  sideB: number;
  corners: Pt[];
}

/**
 * Floor `floor`'s layout for one attempt, with its levels (docs/plans/delver.md, Stage 6) and its great halls and turning Passages (Stage 7a): galleries
 * picked on the Halls with room (3b; with `galleries.stairPercent` a stairwell's side is preferred, and with `galleries.wrapPercent` a gallery's Deck
 * may turn one corner (an L) or two (a U) onto the next walls), the Halls' levels walked down the tree (3c; a wrapped gallery's Hall keeps a level
 * under `levels.max`, and every gallery wall is a raised door, flat), loops that keep the doors at most a level apart (4), pieces and door
 * heights on the Passages (5), each gallery cut from its Hall's final rect (7) and the markers at their floors' heights (9). With `levels.max` and
 * `galleryPercent` 0 nothing of that is picked and the plan is Stage 5's plus the new fields (every `y` 0); with `turnPercent` 0 and `great.count` [0, 0] every
 * decision, candidate and rect is Stage 6's and every Passage is straight; with `galleries.wrapPercent` and `stairPercent` 0 no gallery wraps and none
 * is picked as a stairwell, and no pick is made for either. With `features.percent` above 0 a one-cell Hall with no gallery may take a split (its floor in two
 * or three tiers a level apart, joined by steps) or a pit (its middle sunk 2 or 4 m under a rim that holds every doorway): 3b' picks them, 3c keeps their
 * levels in range (a split's main tier at 1 to `levels.max`, a pit's rim within it; a feature that cannot is dropped), their raised doors are flat Passages
 * the Hall does not list, and step 7 cuts them from the final rect; `tier` (the Run tier) is read only by `features.deepPercent`, and with `percent` 0 no pick
 * is made and the plan is 7b's. With `features.daisPercent` above 0 a Boss or Treasure Hall with no feature may take a dais (7c'): a 1 m Platform against a wall
 * no Passage leaves by, clear of every doorway's lane and the centre square, with a step Ramp; the Boss Hall's throne and the Treasure Hall's altar (its three pedestals) stand on it,
 * and with `daisPercent` 0 no pick is made. With `lava.percent` (per Run `tier`) above 0 a Fight, Empty, Boss or Stairs Hall with no gallery and no feature may hold lava (7d'): a pit, a river with bridges or troughs along its walls, and with it 0 no pick is made (7c's plan, with no `lava` field). If growth stalls before `t.rooms` Halls it returns the fewer Halls it has, kinds
 * assigned as far as possible; the judge refuses such a plan. `boss` (a Boss Floor, Stage 4) makes the Stairs Hall a Boss Hall (grown to the
 * most the gaps allow, unless great halls are wanted: then Hall 0 is a great hall and the Boss Hall), and adds `markers.boss`; with it false the plan has no Boss key anywhere.
 */
export function planFloor(t: DelverFloorTuning, seed: number, floor: number, attempt: number, boss = false, tier = 1, drops: SetPieceDrops = noDrops()): FloorPlan {
  const s = attemptSeed(seed, floor, attempt);
  const pick = (slot: number, salt: number, count: number) => runPick(s, floor, slot, salt, count);
  /** A pick of the index of `weights` by cumulative weight, in list order. */
  const byWeight = (h: number, salt: number, weights: readonly number[]): number => {
    let r = pick(h, salt, weights.reduce((a, b) => a + b, 0));
    for (let k = 0; k < weights.length; k++) {
      if (r < weights[k]!) return k;
      r -= weights[k]!;
    }
    return weights.length - 1;
  };
  const { cols, rows } = t;
  const w = t.passage;
  const half = w / 2;

  // 1. The lattice: a gap picked for each step along a column and a row, centred on the field's middle.
  const gx = Array.from({ length: cols - 1 }, (_, k) => t.gaps[pick(k, SALT.gapX, t.gaps.length)]!);
  const gz = Array.from({ length: rows - 1 }, (_, k) => t.gaps[pick(k, SALT.gapZ, t.gaps.length)]!);
  const lattice = (gaps: readonly number[]) => {
    const at = [-gaps.reduce((a, g) => a + g, 0) / 2];
    for (const g of gaps) at.push(at[at.length - 1]! + g);
    return at;
  };
  const X = lattice(gx);
  const Z = lattice(gz);

  const cells = cols * rows;
  const occupied = new Array<number>(cells).fill(-1);
  const reserved = new Array<boolean>(cells).fill(false);
  const halls: WorkHall[] = [];
  const passages: WorkPassage[] = [];
  const cellAt = (i: number, j: number) => j * cols + i;
  const inside = (i: number, j: number) => i >= 0 && i < cols && j >= 0 && j < rows;
  /** The cell one step `d` from `c`, or -1 off the lattice. */
  const stepCell = (c: number, d: number): number => {
    const i = (c % cols) + DIRS[d]!.di;
    const j = Math.floor(c / cols) + DIRS[d]!.dj;
    return inside(i, j) ? cellAt(i, j) : -1;
  };

  // 2. A Hall's size when placed in cell (i, j): its half sizes, kept small enough that neighbours leave `minPassage`. Then its Walls
  // are kept off the destination fields' dots: where a Wall (cx + hw, cz + hd and the other three) lies on an even metre it would run
  // through the 2 m cell centres, so that half size moves one metre (down if it stays within `lo`, else up within the limit `hi`).
  const offDots = (half: number, centre: number, lo: number, hi: number): number => {
    if ((((centre + half) % 2) + 2) % 2 !== 0) return half;
    return half - 1 >= lo ? half - 1 : half + 1 <= hi ? half + 1 : half;
  };
  const limX = (c: number): number => {
    const i = c % cols;
    return Math.floor((Math.min(...(i > 0 ? [gx[i - 1]!] : []), ...(i < cols - 1 ? [gx[i]!] : [])) - t.minPassage) / 2);
  };
  const limZ = (c: number): number => {
    const j = Math.floor(c / cols);
    return Math.floor((Math.min(...(j > 0 ? [gz[j - 1]!] : []), ...(j < rows - 1 ? [gz[j]!] : [])) - t.minPassage) / 2);
  };
  const rectCache = new Array<Rect | undefined>(cells).fill(undefined);
  /** What `place(c)` gives a one-cell Hall in cell `c`, from its own picks. */
  const cellRect = (c: number): Rect => {
    const cached = rectCache[c];
    if (cached) return cached;
    const cx = X[c % cols]!;
    const cz = Z[Math.floor(c / cols)]!;
    const span = t.halfSize[1] - t.halfSize[0] + 1;
    const lx = limX(c);
    const lz = limZ(c);
    const hw = offDots(Math.min(t.halfSize[0] + pick(c, SALT.hw, span), lx), cx, t.halfSize[0], lx);
    const hd = offDots(Math.min(t.halfSize[0] + pick(c, SALT.hd, span), lz), cz, t.halfSize[0], lz);
    return (rectCache[c] = { x0: cx - hw, z0: cz - hd, x1: cx + hw, z1: cz + hd });
  };
  /** A cell's Hall grown to the most its gaps allow (Stage 4's Boss Hall). */
  const grownRect = (c: number): Rect => {
    const cx = X[c % cols]!;
    const cz = Z[Math.floor(c / cols)]!;
    const lx = limX(c);
    const lz = limZ(c);
    const hw = offDots(Math.min(t.halfSize[1], lx), cx, t.halfSize[0], lx);
    const hd = offDots(Math.min(t.halfSize[1], lz), cz, t.halfSize[0], lz);
    return { x0: cx - hw, z0: cz - hd, x1: cx + hw, z1: cz + hd };
  };
  // The reach rect of a cell: its `cellRect`, but on a Boss Floor that wants no great halls (where Stage 4 may grow the Stairs Hall) the grown rect.
  // The clearance checks test against reach rects, so no later Hall can land on a Passage.
  const grows = boss && t.great.count[1] === 0;
  const reachCell = (c: number): Rect => (grows ? grownRect(c) : cellRect(c));
  // A Hall holding a drawn room (Stage 7g) has taken the room's size: its rect is its reach.
  const roomAt: (number[] | null)[] = [];
  const reachHall = (h: number): Rect => (halls[h]!.great || roomAt[h] ? halls[h]!.rect : reachCell(halls[h]!.cells[0]!));
  const reachOf = (c: number): Rect => (occupied[c]! >= 0 ? reachHall(occupied[c]!) : reachCell(c));

  const place = (c: number): number => {
    const i = c % cols;
    const j = Math.floor(c / cols);
    const rect = cellRect(c);
    const slots: Slot[] = [0, 1, 2, 3].map((d) => ({ d, cell: c, line: d % 2 === 0 ? X[i]! : Z[j]!, long: false, p: -1 }));
    halls.push({ i, j, cx: X[i]!, cz: Z[j]!, rect, cells: [c], great: false, slots });
    occupied[c] = halls.length - 1;
    return halls.length - 1;
  };

  // A great hall over cells `lo` and `lo + 1` (k 'x') or `lo + cols` (k 'z'): centred between them along k, its half along k from `great.half` (the cells'
  // gaps keep `minPassage` from every cell beyond it, as a Hall does), and across it is a Hall's on the shared cell line.
  const greatRect = (lo: number, k: 'x' | 'z'): Rect => {
    const hi = k === 'x' ? lo + 1 : lo + cols;
    const i = lo % cols;
    const j = Math.floor(lo / cols);
    const span = t.great.half[1] - t.great.half[0] + 1;
    const [g, mid, line, lk, lk2, across] = k === 'x' ? [gx[i]!, (X[i]! + X[i + 1]!) / 2, Z[j]!, limX(lo), limX(hi), limZ(lo)] : [gz[j]!, (Z[j]! + Z[j + 1]!) / 2, X[i]!, limZ(lo), limZ(hi), limX(lo)];
    const cap = g / 2 + Math.min(lk, lk2, t.halfSize[1]);
    const hl = offDots(Math.min(t.great.half[0] + pick(lo, SALT.greatLong, span), cap), mid, t.great.half[0], cap);
    const ha = offDots(Math.min(t.halfSize[1], across), line, t.halfSize[0], across);
    return k === 'x' ? { x0: mid - hl, z0: line - ha, x1: mid + hl, z1: line + ha } : { x0: line - ha, z0: mid - hl, x1: line + ha, z1: mid + hl };
  };
  const placeGreat = (lo: number, k: 'x' | 'z'): number => {
    const hi = k === 'x' ? lo + 1 : lo + cols;
    const i = lo % cols;
    const j = Math.floor(lo / cols);
    const rect = greatRect(lo, k);
    const sl = (d: number, cell: number, line: number, long: boolean): Slot => ({ d, cell, line, long, p: -1 });
    // One slot on each short end (at the side's centre) and two on each long side, one on each cell's centre line, ordered n, e, s, w and by ascending cell.
    const slots =
      k === 'x'
        ? [sl(0, lo, X[i]!, true), sl(0, hi, X[i + 1]!, true), sl(1, hi, Z[j]!, false), sl(2, lo, X[i]!, true), sl(2, hi, X[i + 1]!, true), sl(3, lo, Z[j]!, false)]
        : [sl(0, hi, X[i]!, false), sl(1, lo, Z[j]!, true), sl(1, hi, Z[j + 1]!, true), sl(2, lo, X[i]!, false), sl(3, lo, Z[j]!, true), sl(3, hi, Z[j + 1]!, true)];
    const cx = (rect.x0 + rect.x1) / 2;
    const cz = (rect.z0 + rect.z1) / 2;
    halls.push({ i, j, cx, cz, rect, cells: [lo, hi], great: true, slots });
    occupied[lo] = halls.length - 1;
    occupied[hi] = halls.length - 1;
    return halls.length - 1;
  };
  const slotAt = (h: number, d: number, cell: number): number => halls[h]!.slots.findIndex((sl) => sl.d === d && sl.cell === cell);

  /**
   * Joins Hall `h`'s slot `hs` and Hall `o`'s slot `os` by a Passage: straight (`h` west or south of `o` along the slot's direction `d` = e or n, else the
   * other way round), or, with `corners`, turning, `a` being `h`.
   */
  const join = (h: number, hs: number, o: number, os: number, loop: boolean, far: boolean, corners: readonly Pt[] = []) => {
    const d = halls[h]!.slots[hs]!.d;
    const flip = corners.length === 0 && d !== 0 && d !== 1;
    const [a, sa, b, sb] = flip ? [o, os, h, hs] : [h, hs, o, os];
    const slotA = halls[a]!.slots[sa]!;
    const slotB = halls[b]!.slots[sb]!;
    const route: PassageRoute = { sideA: SIDES[slotA.d]!, lineA: slotA.line, sideB: SIDES[slotB.d]!, lineB: slotB.line, corners };
    const p = passages.length;
    passages.push({ a, b, sa, sb, loop, far, from: h, fs: hs, to: o, ts: os, route, pieces: passagePieces(halls[a]!.rect, halls[b]!.rect, route, w, 0, 0) });
    slotA.p = p;
    slotB.p = p;
  };

  /** The turning candidates from Hall `h`'s slot `s`, L first then S or Z, for each perpendicular direction: the cells and the route's corners, before any check. */
  const turnsFrom = (h: number, s: number): Turn[] => {
    const slot = halls[h]!.slots[s]!;
    const d = slot.d;
    const c = slot.cell;
    const c1 = stepCell(c, d);
    const out: Turn[] = [];
    if (c1 < 0) return out;
    const lFree = !reserved[c1] && occupied[c1]! < 0;
    for (const p of [0, 1, 2, 3]) {
      if (p % 2 === d % 2) continue;
      // One step beside c1: an L's cell t, entered by its side opposite(p); an S or Z's cell t = c + d + p.
      const tp = stepCell(c1, p);
      // An L: the corner at c1's centre, then to the cell t beside it.
      const tl = tp;
      if (tl >= 0 && lFree) {
        out.push({ h, s, d, p, kind: 'L', c1, t: tl, sideB: opposite(p), corners: [{ x: X[c1 % cols]!, z: Z[Math.floor(c1 / cols)]! }] });
      }
      // An S or Z: across to t = c + d + p, entered by its side opposite(d), its middle leg at the whole-metre line m between the Halls beside it.
      const ts = tp;
      if (ts >= 0) {
        const cp = stepCell(c, p);
        const fwd = d === 0 || d === 1;
        const xAxis = d % 2 === 1;
        // The frame (u along d's axis, v across): swap x and z when d runs along z.
        const fr = (r: Rect) => (xAxis ? { u0: r.x0, u1: r.x1, v0: r.z0, v1: r.z1 } : { u0: r.z0, u1: r.z1, v0: r.x0, v1: r.x1 });
        const A = fr(reachHall(h));
        const B = fr(reachOf(ts));
        const H1 = reserved[cp] ? null : fr(reachOf(cp));
        const H2 = reserved[c1] ? null : fr(reachOf(c1));
        const lo = (fwd ? Math.max(A.u1 + MIN_LEG, H1 ? H1.u1 + PASSAGE_CLEAR : -Infinity) : Math.max(B.u1 + MIN_LEG, H2 ? H2.u1 + PASSAGE_CLEAR : -Infinity)) + half;
        const hi = (fwd ? Math.min(B.u0 - MIN_LEG, H2 ? H2.u0 - PASSAGE_CLEAR : Infinity) : Math.min(A.u0 - MIN_LEG, H1 ? H1.u0 - PASSAGE_CLEAR : Infinity)) - half;
        const m = Math.max(Math.ceil(lo), Math.floor((lo + hi) / 2));
        if (m <= hi) {
          const va = slot.line;
          const vb = xAxis ? Z[Math.floor(ts / cols)]! : X[ts % cols]!;
          const corners: Pt[] = xAxis ? [{ x: m, z: va }, { x: m, z: vb }] : [{ x: va, z: m }, { x: vb, z: m }];
          out.push({ h, s, d, p, kind: 'SZ', c1, t: ts, sideB: opposite(d), corners });
        }
      }
    }
    return out;
  };
  /** A turning candidate's route to the Hall at `t`, entered by `sideB` on the centre line `lineB`. */
  const routeOf = (tn: Turn, lineB: number): PassageRoute => ({ sideA: SIDES[tn.d]!, lineA: halls[tn.h]!.slots[tn.s]!.line, sideB: SIDES[tn.sideB]!, lineB, corners: tn.corners });
  const lineOfCell = (cell: number, side: number): number => (side % 2 === 0 ? X[cell % cols]! : Z[Math.floor(cell / cols)]!);
  /**
   * The clearance check: a turning Passage's pieces keep `PASSAGE_CLEAR` from every other Passage's pieces and every Hall rect (a placed Hall's, or the reach
   * rect of each empty, unreserved cell), but its first piece touches `a` and its last touches Hall `b` (`bRect`, `b` -1 for a Hall not placed yet at cell
   * `tc`) without overlapping. An L's corner cell is the Passage's own, so it is left out.
   */
  const clear = (pieces: readonly PassagePiece[], a: number, b: number, bRect: Rect, tc: number, skipCell: number): boolean => {
    const last = pieces.length - 1;
    for (let q = 0; q < pieces.length; q++) {
      const r = pieces[q]!.rect;
      for (const o of passages) for (const op of o.pieces) if (!apartBy(r, op.rect, PASSAGE_CLEAR)) return false;
      for (let h = 0; h < halls.length; h++) {
        const need = (h === a && q === 0) || (h === b && q === last) ? 0 : PASSAGE_CLEAR;
        if (!apartBy(r, reachHall(h), need)) return false;
      }
      if (b < 0 && !apartBy(r, bRect, q === last ? 0 : PASSAGE_CLEAR)) return false;
      for (let c = 0; c < cells; c++) {
        if (occupied[c]! >= 0 || reserved[c] || c === tc || c === skipCell) continue;
        if (!apartBy(r, reachCell(c), PASSAGE_CLEAR)) return false;
      }
    }
    return true;
  };
  /** Whether a turning candidate whose far Hall is `b` (placed, or -1 for the empty cell `tn.t`) passes the clearance check. */
  const turnClear = (tn: Turn, b: number): boolean => {
    const tr = b >= 0 ? reachHall(b) : reachCell(tn.t);
    const pieces = passagePieces(reachHall(tn.h), tr, routeOf(tn, lineOfCell(tn.t, tn.sideB)), w, 0, 0);
    return clear(pieces, tn.h, b, tr, tn.t, tn.kind === 'L' ? tn.c1 : -1);
  };

  // 3. Growth: the spanning tree. A Boss Floor with great halls wanted starts with one (Hall 0, the Boss Hall).
  const G = t.great.count[1] > 0 ? t.great.count[0] + pick(0, SALT.greatCount, t.great.count[1] - t.great.count[0] + 1) : 0;
  // The Set Piece Gallery (dev only) grows along its path: from its first cell, each Hall joined to the one before.
  const gallery = t.gallery;
  const start = gallery ? gallery.path[0]! : pick(0, SALT.start, cells);
  const startGreat = boss && G >= 1;
  if (startGreat) {
    const k: 'x' | 'z' = pick(0, SALT.greatAxis, 2) === 0 ? 'x' : 'z';
    const next = k === 'x' ? ((start % cols) + 1 < cols ? start + 1 : start - 1) : Math.floor(start / cols) + 1 < rows ? start + cols : start - cols;
    placeGreat(Math.min(start, next), k);
  } else {
    place(start);
  }
  const wanted = startGreat ? G - 1 : G;
  let greatPlaced = 0;
  for (let step = 1; halls.length < t.rooms; step++) {
    const near: { h: number; s: number; d: number; c1: number }[] = [];
    const far: { h: number; s: number; d: number; c1: number; c2: number }[] = [];
    const great: { h: number; s: number; d: number; c1: number; lo: number; k: 'x' | 'z' }[] = [];
    const turns: Turn[] = [];
    const greatDue = greatPlaced < wanted && step >= Math.floor(((greatPlaced + 1) * t.rooms) / (wanted + 1));
    for (let h = 0; h < halls.length; h++) {
      const hall = halls[h]!;
      for (let sIdx = 0; sIdx < hall.slots.length; sIdx++) {
        const slot = hall.slots[sIdx]!;
        if (slot.p !== -1) continue;
        const d = slot.d;
        const c1 = stepCell(slot.cell, d);
        if (c1 < 0) continue;
        if (reserved[c1] || occupied[c1]! >= 0) continue;
        if (gallery && (h !== halls.length - 1 || c1 !== gallery.path[halls.length])) continue;
        near.push({ h, s: sIdx, d, c1 });
        const c2 = stepCell(c1, d);
        if (c2 >= 0 && !reserved[c2] && occupied[c2]! < 0) far.push({ h, s: sIdx, d, c1, c2 });
        if (greatDue) {
          // The great hall's second cell: along d first, then each perpendicular direction, inside, empty and unreserved, and its rect clear of every Passage's pieces.
          for (const dd of [d, ...[0, 1, 2, 3].filter((q) => q % 2 !== d % 2)]) {
            const c2g = stepCell(c1, dd);
            if (c2g < 0 || reserved[c2g] || occupied[c2g]! >= 0) continue;
            const lo = Math.min(c1, c2g);
            const k: 'x' | 'z' = Math.abs(c2g - c1) === 1 ? 'x' : 'z';
            const rect = greatRect(lo, k);
            if (passages.every((o) => o.pieces.every((q) => apartBy(rect, q.rect, PASSAGE_CLEAR)))) {
              great.push({ h, s: sIdx, d, c1, lo, k });
              break;
            }
          }
        }
      }
    }
    const greatNow = greatDue && great.length > 0;
    // The turning list is built only when it will be used: a turn is taken (its pick passed) or there is no near candidate, and no great hall comes first.
    const turnNow = t.turnPercent > 0 && !greatNow && (near.length === 0 || pick(step, SALT.turn, 100) < t.turnPercent);
    if (turnNow) {
      for (let h = 0; h < halls.length; h++) {
        const hall = halls[h]!;
        for (let sIdx = 0; sIdx < hall.slots.length; sIdx++) {
          if (hall.slots[sIdx]!.p !== -1 || stepCell(hall.slots[sIdx]!.cell, hall.slots[sIdx]!.d) < 0) continue;
          for (const tn of turnsFrom(h, sIdx)) {
            if (!reserved[tn.t] && occupied[tn.t]! < 0 && turnClear(tn, -1)) turns.push(tn);
          }
        }
      }
    }
    // Only turning candidates left: take a turn whatever the pick; nothing at all: the lattice is full.
    if (near.length === 0 && turns.length === 0 && !greatNow) break;
    if (greatNow) {
      const g = great[pick(step, SALT.great, great.length)]!;
      const o = placeGreat(g.lo, g.k);
      join(g.h, g.s, o, slotAt(o, opposite(g.d), g.c1), false, false);
      greatPlaced++;
      continue;
    }
    if (turns.length > 0) {
      const tn = turns[pick(step, SALT.turnPick, turns.length)]!;
      const o = place(tn.t);
      join(tn.h, tn.s, o, tn.sideB, false, false, tn.corners);
      if (tn.kind === 'L') reserved[tn.c1] = true;
      continue;
    }
    const useFar = far.length > 0 && pick(step, SALT.far, 100) < t.farPercent;
    const list = useFar ? far : near;
    const chosen = list[pick(step, SALT.grow, list.length)]!;
    const target = useFar ? (chosen as (typeof far)[number]).c2 : chosen.c1;
    const o = place(target);
    if (useFar) reserved[chosen.c1] = true;
    join(chosen.h, chosen.s, o, opposite(chosen.d), false, useFar);
  }

  // 3a'. Set pieces (docs/plans/delver.md, Stage 7f), before every other feature: each Hall, in index order, is rolled with the tier's `setPieces.percent`
  // (with 0, no pick at all), its kind a weighted pick. A Lava Bridge only reserves its Hall here (its fit is tested at 7d'', once the kinds and final rects
  // are known); an Uphill or a Spiral is set in `feat` when it fits the rect as it stands (a Boss Hall's growth only enlarges it), never on a great hall. A kind
  // that does not fit leaves the Hall plain; no other kind is tried. A reserved Hall, or one with an Uphill or a Spiral, takes no gallery, split, pit, dais,
  // other lava, shape or pillar.
  /**
   * A feature as picked: a split's axis, whether it has three tiers, the end of its one outer tier (0 low, 1 high) and the side wall its first step stands
   * against (0 low, 1 high); a pit's; an Uphill's axis, high end (a side index) and rise; a Spiral's base wall (a side index) and turn.
   */
  type Feat =
    | { kind: 'split'; axis: 'x' | 'z'; three: boolean; side: 0 | 1; s: 0 | 1 }
    | { kind: 'pit'; depth: 2 | 4; turn: 0 | 1; v: 'x' | 'z' }
    | { kind: 'uphill'; axis: 'x' | 'z'; up: number; rise: 1 | 2 }
    | { kind: 'spiral'; base: number; turn: 0 | 1 }
    | { kind: 'room'; room: DrawnRoom; frame: number; lifts: Partial<Record<Side, number>>; high: number; shift: [number, number] };
  const feat: (Feat | null)[] = halls.map(() => null);
  /**
   * Stage 7g: Hall `h`'s rect if it took drawn room `room` in frame `f`, and the room's shift off the cell's lattice point, or null when it does not fit: its
   * Walls on odd metres (a half whose wall would land on an even metre moves the room 1 m along that axis, west or south first), within the cell's limits (so it
   * keeps `minPassage` from every neighbour), a doorway on every wall a Passage leaves by, its highest door within `levels.max`, and each Passage re-cut against it
   * clear of it (`PASSAGE_CLEAR`, but the piece that meets it) with every leg of positive length (the one meeting it `MIN_LEG`).
   */
  const roomFits = (h: number, room: DrawnRoom, f: number): { rect: Rect; shift: [number, number] } | null => {
    const hall = halls[h]!;
    const [hw, hd] = frameHalf(room, f);
    const c = hall.cells[0]!;
    const cx = X[c % cols]!;
    const cz = Z[Math.floor(c / cols)]!;
    const ways = framedRoom(room, f).doorways;
    if (hall.slots.some((sl) => sl.p !== -1 && ways[SIDES[sl.d]!] === undefined)) return null;
    if (Math.max(...Object.values(ways)) > t.levels.max) return null;
    const shifts = (centre: number, half: number): number[] => ((((centre + half) % 2) + 2) % 2 === 1 ? [0] : [-1, 1]);
    for (const sx of shifts(cx, hw))
      for (const sz of shifts(cz, hd)) {
        const rect: Rect = { x0: cx + sx - hw, z0: cz + sz - hd, x1: cx + sx + hw, z1: cz + sz + hd };
        if (hw + Math.abs(sx) <= limX(c) && hd + Math.abs(sz) <= limZ(c) && roomClear(h, rect)) return { rect, shift: [sx, sz] };
      }
    return null;
  };
  /** Whether every Passage re-cut against Hall `h`'s rect `rect` keeps clear of it (`roomFits`). */
  const roomClear = (h: number, rect: Rect): boolean => {
    for (const p of passages) {
      const at = p.a === h ? 0 : p.b === h ? 1 : -1;
      const pieces = passagePieces(p.a === h ? rect : halls[p.a]!.rect, p.b === h ? rect : halls[p.b]!.rect, p.route, w, 0, 0);
      const meets = at === 0 ? 0 : pieces.length - 1;
      for (let q = 0; q < pieces.length; q++) {
        const pr = pieces[q]!.rect;
        if (at >= 0 && (pr.x1 - pr.x0 <= 0 || pr.z1 - pr.z0 <= 0)) return false;
        if (at >= 0 && q === meets) {
          if ((pieces[q]!.axis === 'x' ? pr.x1 - pr.x0 : pr.z1 - pr.z0) < MIN_LEG || !apartBy(pr, rect, 0)) return false;
        } else if (!apartBy(pr, rect, PASSAGE_CLEAR)) return false;
      }
    }
    return true;
  };
  const crossRes = new Array<boolean>(halls.length).fill(false);
  const setP = t.setPieces.percent[Math.min(tier, t.setPieces.percent.length) - 1]!;
  if (setP > 0) {
    const sw = t.setPieces.weights;
    halls.forEach((hall, h) => {
      const forced = gallery ? gallery.pieces[h] ?? null : undefined;
      if (forced === null) return;
      if (forced === undefined && pick(h, SALT.setPiece, 100) >= setP) return;
      const want = forced ? forced.kind : SET_PIECE_KINDS[byWeight(h, SALT.setPieceKind, [sw.cross, sw.uphill, sw.spiral, sw.room])]!;
      if (want === 'cross') {
        crossRes[h] = true;
        return;
      }
      if (hall.great) {
        drops.great++;
        return;
      }
      const r = hall.rect;
      const held = (d: number) => hall.slots.some((sl) => sl.d === d && sl.p !== -1);
      if (want === 'room') {
        // Stage 7g: each (room, frame) that fits, then a room picked evenly among those with a fitting frame, then one of its frames. The Hall takes the frame's size.
        const fits = t.drawnRooms.map((room) => (forced && room.name !== forced.room ? [] : ROOM_FRAMES.filter((f) => roomFits(h, room, f) !== null)));
        const rooms = t.drawnRooms.flatMap((_, k) => (fits[k]!.length > 0 ? [k] : []));
        if (rooms.length === 0) {
          drops.fit = (drops.fit ?? 0) + 1;
          return;
        }
        const k = rooms[pick(h, SALT.roomPick, rooms.length)]!;
        const frame = fits[k]![pick(h, SALT.roomFrame, fits[k]!.length)]!;
        const room = t.drawnRooms[k]!;
        const framed = framedRoom(room, frame);
        const fit = roomFits(h, room, frame)!;
        const high = Math.max(0, ...Object.values(framed.doorways), ...framed.brushes.map((b) => (b.kind === 'platform' ? Math.ceil(b.top / LEVEL_RISE) : b.kind === 'ramp' ? Math.ceil(b.hi / LEVEL_RISE) : 0)));
        hall.rect = fit.rect;
        roomAt[h] = [k, frame];
        feat[h] = { kind: 'room', room, frame, lifts: framed.doorways, high, shift: fit.shift };
        return;
      }
      if (want === 'uphill') {
        // On axis k the Ramp is the half along k twice, less both landings; it rises 2 levels when that is long enough, else 1. No tree Passage leaves by a side wall.
        const riseOn = (k: 'x' | 'z'): 0 | 1 | 2 => {
          const run = k === 'x' ? r.x1 - r.x0 - UPHILL_FOOT - UPHILL_TOP : r.z1 - r.z0 - UPHILL_FOOT - UPHILL_TOP;
          return run >= (2 * LEVEL_RISE) / MAX_SLOPE ? 2 : run >= LEVEL_RISE / MAX_SLOPE ? 1 : 0;
        };
        const sized = (['x', 'z'] as const).filter((k) => riseOn(k) > 0);
        const fits = sized.filter((k) => !(k === 'x' ? [0, 2] : [1, 3]).some(held));
        if (fits.length === 0) {
          if (sized.length === 0) drops.size++;
          else drops.doorWalls++;
          return;
        }
        const axis = fits.length === 1 ? fits[0]! : (['x', 'z'] as const)[pick(h, SALT.uphillAxis, 2)]!;
        const high = pick(h, SALT.uphillEnd, 2);
        feat[h] = { kind: 'uphill', axis, up: axis === 'z' ? (high === 1 ? 0 : 2) : high === 1 ? 1 : 3, rise: riseOn(axis) as 1 | 2 };
      } else {
        const turn = pick(h, SALT.spiralTurn, 2) as 0 | 1;
        const b0 = pick(h, SALT.spiralBase, 4);
        for (let i = 0; i < 4 && !feat[h]; i++) if (spiralGeometry(r, (b0 + i) % 4, turn, 0)) feat[h] = { kind: 'spiral', base: (b0 + i) % 4, turn };
        if (!feat[h]) drops.size++;
      }
    });
  }
  /** Whether Hall `h` holds or is reserved for a set piece (Stage 7f): no other feature is picked for it. */
  const setPieceHall = (h: number): boolean => crossRes[h]! || feat[h]?.kind === 'uphill' || feat[h]?.kind === 'spiral' || feat[h]?.kind === 'room';
  /** Whether side `d` of Hall `h` is a wall its drawn room holds no doorway on (Stage 7g): no Passage leaves by it. */
  const roomSolid = (h: number, d: number): boolean => feat[h]?.kind === 'room' && (feat[h] as { lifts: Partial<Record<Side, number>> }).lifts[SIDES[d]!] === undefined;
  /** Whether side `d` of Hall `h` is a side wall of its Uphill (along the Ramp): no Passage leaves by it. */
  const uphillSide = (h: number, d: number): boolean => feat[h]?.kind === 'uphill' && d % 2 !== (feat[h] as { up: number }).up % 2;

  // 3b. Galleries: a Hall's side has room for one when the wall is deep enough across (`GALLERY_DEPTH` and the clear centre) and long enough
  // along (the Ramp, its approach and the shortest Deck); a side already holding a tree Passage needs the stairwell's room too (its Deck covers
  // the Passage's door with a metre each side). A seeded share of the Halls with room for one get one (side n, e, s, w order). Never a great hall.
  const spanOf = (h: number, d: number) => {
    const r = halls[h]!.rect;
    return d % 2 === 0 ? { across: (r.z1 - r.z0) / 2, par: (r.x1 - r.x0) / 2 } : { across: (r.x1 - r.x0) / 2, par: (r.z1 - r.z0) / 2 };
  };
  const roomFor = (h: number, d: number, stairwell: boolean): boolean => {
    const { across, par } = spanOf(h, d);
    if (across < GALLERY_DEPTH + CENTRE_CLEAR || par < (GALLERY_RAMP + GALLERY_APPROACH + DECK_MIN) / 2) return false;
    return !stairwell || par - GALLERY_RAMP - GALLERY_APPROACH >= w / 2 + 1;
  };
  /** Whether Hall `h` has a Passage leaving by its side `d`. */
  const hasOn = (h: number, d: number): boolean => halls[h]!.slots.some((sl) => sl.d === d && sl.p !== -1);
  /** A gallery as picked: its first wall's side index, its Deck's end, and the side indices of the walls it wraps onto (none, or an L's, or a U's two). */
  type Gal = { d: number; end: 0 | 1; wraps: number[] };
  const gal: (Gal | null)[] = halls.map(() => null);
  /** The wall at a Deck's end on side `d`: along x (n, s) end 0 is w and end 1 is e; along z (e, w) end 0 is s and end 1 is n. */
  const endWall = (d: number, end: 0 | 1): number => (d % 2 === 0 ? (end === 0 ? 3 : 1) : end === 0 ? 2 : 0);
  /** Hall `h`'s gallery walls: its first wall, then its wrap walls. */
  const galWalls = (h: number): number[] => (gal[h] ? [gal[h]!.d, ...gal[h]!.wraps] : []);
  /** Whether a door of Hall `h` on side `d` opens on its gallery's Deck (a raised door, a metre over its floor's level). */
  const isGalWall = (h: number, d: number): boolean => galWalls(h).includes(d);
  /**
   * Whether the Deck along wall `d` of Hall `h` covers the wall's centre line with the Passage's width and a metre each side, the strip's
   * `GALLERY_DEPTH` squares at its low and high ends left out when `trimLo` and `trimHi` (they belong to the walls across).
   */
  const wrapCovers = (h: number, d: number, trimLo: boolean, trimHi: boolean): boolean => {
    const r = halls[h]!.rect;
    const alongX = d % 2 === 0;
    const lo = (alongX ? r.x0 : r.z0) + (trimLo ? GALLERY_DEPTH : 0);
    const hi = (alongX ? r.x1 : r.z1) - (trimHi ? GALLERY_DEPTH : 0);
    const centre = alongX ? halls[h]!.cx : halls[h]!.cz;
    return lo <= centre - (w / 2 + 1) && centre + (w / 2 + 1) <= hi;
  };
  if (t.levels.galleryPercent > 0) {
    const fitting = halls.map((hall, h) => (hall.great || setPieceHall(h) ? [] : [0, 1, 2, 3].filter((d) => roomFor(h, d, hasOn(h, d)))));
    const withRoom = halls
      .map((_, h) => ({ h, key: pick(h, SALT.galleryOrder, 0x1_0000_0000) }))
      .filter((c) => fitting[c.h]!.length > 0)
      .sort((a, b) => a.key - b.key || a.h - b.h);
    const wantedGal = Math.floor((withRoom.length * t.levels.galleryPercent + 99) / 100);
    for (const { h } of withRoom.slice(0, wantedGal)) {
      const sides = fitting[h]!;
      // A stairwell's side (one that holds a tree Passage) is taken with `stairPercent`'s chance when there is one.
      const high = sides.filter((d) => hasOn(h, d));
      const d = t.galleries.stairPercent > 0 && high.length > 0 && pick(h, SALT.galleryStair, 100) < t.galleries.stairPercent ? high[pick(h, SALT.gallerySide, high.length)]! : sides[pick(h, SALT.gallerySide, sides.length)]!;
      const end = pick(h, SALT.galleryEnd, 2) as 0 | 1;
      const wraps: number[] = [];
      if (t.galleries.wrapPercent > 0 && pick(h, SALT.galleryWrap, 100) < t.galleries.wrapPercent) {
        const w1 = endWall(d, end);
        // An L fits when the Hall is deep enough across `w1` and its Deck covers `w1`'s centre line; a U when the opposite wall's Deck covers its own.
        if (spanOf(h, w1).across >= GALLERY_DEPTH + CENTRE_CLEAR && wrapCovers(h, w1, d > 1, d <= 1)) {
          wraps.push(w1);
          const w2 = opposite(d);
          if (pick(h, SALT.galleryU, 100) < t.galleries.uPercent && wrapCovers(h, w1, true, true) && wrapCovers(h, w2, false, false)) wraps.push(w2);
        }
      }
      gal[h] = { d, end, wraps };
    }
  }

  // 3b'. Splits and pits (Stage 7c): each Hall that is not great and has no gallery, in index order, is picked for one with `features.percent`'s chance;
  // its kind is a weighted pick, and a kind that does not fit leaves the Hall plain. The fit is tested on the rect as it stands (a Boss Hall's growth
  // only enlarges it); the geometry is cut in step 7 from the final rect.
  /** The smallest odd metre at least `v`, and the largest at most it. */
  const oddUp = (v: number): number => 2 * Math.ceil((v - 1) / 2) + 1;
  const oddDown = (v: number): number => 2 * Math.floor((v - 1) / 2) + 1;
  /** A split's cuts along `axis` for a Hall centred at `c`: the low cut and the high cut, 4 or 5 m from it each side. */
  const cutsAt = (c: number): [number, number] => [oddDown(c - SPLIT_CUT), oddUp(c + SPLIT_CUT)];
  if (t.features.percent > 0) {
    halls.forEach((hall, h) => {
      if (hall.great || gal[h] !== null || setPieceHall(h) || pick(h, SALT.feature, 100) >= t.features.percent) return;
      const kindOf = (['split', 'pit'] as const)[byWeight(h, SALT.featureKind, [t.features.weights.split, t.features.weights.pit])]!;
      const r = hall.rect;
      const halfX = (r.x1 - r.x0) / 2;
      const halfZ = (r.z1 - r.z0) / 2;
      if (kindOf === 'split') {
        const fits = (['x', 'z'] as const).filter((k) => {
          const [c, hf] = k === 'x' ? [hall.cx, halfX] : [hall.cz, halfZ];
          return hf - (cutsAt(c)[1] - c) >= TIER_MIN;
        });
        if (fits.length === 0) return;
        const axis = fits.length === 1 ? fits[0]! : (['x', 'z'] as const)[pick(h, SALT.splitAxis, 2)]!;
        const three = pick(h, SALT.splitTiers, 100) < t.features.threePercent;
        const side = three ? 0 : (pick(h, SALT.splitSide, 2) as 0 | 1);
        feat[h] = { kind: 'split', axis, three, side, s: pick(h, SALT.splitStep, 2) as 0 | 1 };
      } else {
        const v: 'x' | 'z' = halfX > halfZ ? 'x' : 'z';
        const [hv, hu] = v === 'x' ? [halfX, halfZ] : [halfZ, halfX];
        if (hv < PIT_WIDE || hu < PIT_LONG) return;
        // A 4 m pit's 8 m step leaves PIT_APPROACH of pit floor before its foot: along u the pit must be at least 10 m (a half of 9), else it is 2 m deep.
        const deep = pick(h, SALT.pitDeep, 100) < t.features.deepPercent[Math.min(tier, t.features.deepPercent.length) - 1]! && 2 * (hu - PIT_RIM) >= 2 * 4 + PIT_APPROACH;
        feat[h] = { kind: 'pit', depth: deep ? 4 : 2, turn: pick(h, SALT.pitTurn, 2) as 0 | 1, v };
      }
    });
  }
  /** The side indices of a split's low-end and high-end walls (s and n along z, w and e along x), -1 for an end with no outer tier. */
  const outerEnds = (f: Feat & { kind: 'split' }): [number, number] => {
    const [lo, hi] = f.axis === 'z' ? [2, 0] : [3, 1];
    return [f.three || f.side === 0 ? lo : -1, f.three || f.side === 1 ? hi : -1];
  };
  /** Whether side `d` of Hall `h` is the end wall of one of its split's outer tiers. */
  const isOuterEnd = (h: number, d: number): boolean => {
    const f = feat[h];
    return f?.kind === 'split' && outerEnds(f).includes(d);
  };

  // 3c. Levels, on the tree in growth order: the first Hall's level is picked; each tree Passage then keeps its child's door at its parent's
  // door height, or (by `changePercent`) one level up or down. A gallery's wall (each wall of a wrap) is a raised door, flat, and so is a great hall's
  // long side. The child's level is its door's, less one through its own gallery's wall. A wrapped gallery's Hall needs its level a level under
  // `levels.max` (its Deck's door level is in range): a wrap that breaks it is dropped (back to its first wall). When no option keeps the child's level
  // in range, a wrap of the child's is dropped and the options tried again; failing that, the gallery on this Passage's wall is dropped and the
  // Passage is flat.
  const lmax = t.levels.max;
  const level = new Array<number>(halls.length).fill(0);
  if (lmax > 0) level[0] = pick(0, SALT.levelBase, lmax + 1);
  /** How many levels a door of Hall `h` on side `d` stands over the Hall's level: a gallery wall +1, an outer tier's end wall -1, a pit's every wall half its depth. */
  const lift = (h: number, d: number): number => {
    if (isGalWall(h, d)) return 1;
    const f = feat[h];
    if (f?.kind === 'pit') return f.depth / 2;
    // An Uphill's high end is the Hall's level and its low end `rise` under it; a Spiral's walls climb a level each from its base.
    if (f?.kind === 'uphill') return d === opposite(f.up) ? -f.rise : 0;
    if (f?.kind === 'spiral') return spiralWall(f.base, f.turn, d);
    // A drawn room's doorway stands at its level (Stage 7g).
    if (f?.kind === 'room') return f.lifts[SIDES[d]!] ?? 0;
    return isOuterEnd(h, d) ? -1 : 0;
  };
  /** Whether a door of Hall `h` on side `d` opens above the Hall's Enclosure floor (a gallery wall, a split's wall but an outer tier's end, every wall of a pit): its Passage is flat and cuts the door itself. */
  const raised = (h: number, d: number): boolean => {
    const f = feat[h];
    if (f?.kind === 'uphill') return d === f.up;
    if (f?.kind === 'spiral') return spiralWall(f.base, f.turn, d) > 0;
    // A raised doorway, or one on a wall the room was shifted along (its centre 1 m off the Passage's line): the Passage cuts it.
    if (f?.kind === 'room') return (f.lifts[SIDES[d]!] ?? 0) > 0 || (d % 2 === 0 ? f.shift[0] : f.shift[1]) !== 0;
    return isGalWall(h, d) || f?.kind === 'pit' || (f?.kind === 'split' && !isOuterEnd(h, d));
  };
  /** Whether Hall `h` at level `lv` keeps its wrap's, split's or pit's floors and door levels within 0 to `levels.max`. */
  const inRange = (h: number, lv: number): boolean => {
    const f = feat[h];
    if (gal[h]?.wraps.length && lv + 1 > lmax) return false;
    if (f?.kind === 'split') return lv >= 1 && lv <= lmax;
    if (f?.kind === 'pit') return lv + f.depth / 2 <= lmax;
    if (f?.kind === 'uphill') return lv >= f.rise && lv <= lmax;
    if (f?.kind === 'spiral') return lv + 3 <= lmax;
    if (f?.kind === 'room') return lv + f.high <= lmax;
    return true;
  };
  const doorLevel = (h: number, d: number): number => level[h]! + lift(h, d);
  /** Drops Hall `h`'s wrap (its gallery back to its first wall) or its feature (a Hall has not both); whether it had one. */
  const unwrap = (h: number): boolean => {
    if (feat[h]) {
      if (feat[h]!.kind === 'uphill' || feat[h]!.kind === 'spiral' || feat[h]!.kind === 'room') drops.range++;
      // A drawn room dropped gives its Hall back its own cell's rect (its Passages grew against it), centred on its lattice point.
      if (feat[h]!.kind === 'room') {
        halls[h]!.rect = cellRect(halls[h]!.cells[0]!);
        roomAt[h] = null;
      }
      feat[h] = null;
      return true;
    }
    const g = gal[h];
    if (!g || g.wraps.length === 0) return false;
    g.wraps = [];
    return true;
  };
  if (!inRange(0, level[0]!)) unwrap(0);
  passages.forEach((p, n) => {
    const parent = p.from;
    const child = p.to;
    const dp = halls[parent]!.slots[p.fs]!.d;
    const dc = halls[child]!.slots[p.ts]!.d;
    const settle = (options: readonly number[]): boolean => {
      for (const delta of options) {
        const lc = doorLevel(parent, dp) + delta - lift(child, dc);
        if (lc >= 0 && lc <= lmax && inRange(child, lc)) {
          level[child] = lc;
          return true;
        }
      }
      return false;
    };
    let options = [0];
    const longSide = halls[parent]!.slots[p.fs]!.long || halls[child]!.slots[p.ts]!.long;
    if (lmax > 0 && !longSide && !raised(parent, dp) && !raised(child, dc) && pick(n, SALT.levelChange, 100) < t.levels.changePercent) {
      const up = pick(n, SALT.levelUp, 2) === 1 ? 1 : -1;
      options = [up, -up, 0];
    }
    if (!settle(options) && !(unwrap(child) && settle(options))) {
      if (isGalWall(parent, dp)) gal[parent] = null;
      else gal[child] = null;
      settle([0]);
    }
  });

  // 4. Loops: extra Passages between Halls at least 3 Passages apart in the tree, to the nearest Hall that way: straight first (from the slots, on the
  // sides n and e), then turning (an L, S or Z to a Hall with a free slot on the side entered, a Hall of a higher index).
  const treeAdj: number[][] = halls.map(() => []);
  for (const p of passages) {
    treeAdj[p.a]!.push(p.b);
    treeAdj[p.b]!.push(p.a);
  }
  const treeDist = (from: number): number[] => {
    const dist = new Array<number>(halls.length).fill(-1);
    dist[from] = 0;
    const queue = [from];
    for (let q = 0; q < queue.length; q++) {
      for (const v of treeAdj[queue[q]!]!) {
        if (dist[v] === -1) {
          dist[v] = dist[queue[q]!]! + 1;
          queue.push(v);
        }
      }
    }
    return dist;
  };
  const apart = halls.map((_, h) => treeDist(h));
  /** Whether a loop from Hall `h`'s slot `s` to Hall `b`'s slot `bs` is allowed: not joined, apart in the tree, and its doors' levels (flat when forced). */
  const loopOk = (h: number, s: number, b: number, bs: number): boolean => {
    if (b === h || halls[b]!.slots[bs]!.p !== -1) return false;
    if (passages.some((p) => (p.a === h && p.b === b) || (p.a === b && p.b === h))) return false;
    if (apart[h]![b]! < 3) return false;
    if (uphillSide(h, halls[h]!.slots[s]!.d) || uphillSide(b, halls[b]!.slots[bs]!.d)) return false;
    if (roomSolid(h, halls[h]!.slots[s]!.d) || roomSolid(b, halls[b]!.slots[bs]!.d)) return false;
    // Levels: the doors at most one level apart, equal through a gallery's wall or a great hall's long side, a wall then needing the stairwell's room.
    const d = halls[h]!.slots[s]!.d;
    const db = halls[b]!.slots[bs]!.d;
    const lh = doorLevel(h, d);
    const lb = doorLevel(b, db);
    const wallH = isGalWall(h, d);
    const wallB = isGalWall(b, db);
    const forced = raised(h, d) || raised(b, db) || halls[h]!.slots[s]!.long || halls[b]!.slots[bs]!.long;
    if (Math.abs(lh - lb) > 1 || (forced && lh !== lb)) return false;
    // A first wall's Deck needs the stairwell's room; a wrap wall's whole strip is Deck, which covered its centre when the wrap was picked.
    if ((wallH && gal[h]!.d === d && !roomFor(h, d, true)) || (wallB && gal[b]!.d === db && !roomFor(b, db, true))) return false;
    return true;
  };
  interface LoopCand {
    h: number;
    s: number;
    b: number;
    bs: number;
    far: boolean;
    c1: number;
    /** A turning loop: its candidate. */
    turn?: Turn;
  }
  const loopCandidates = () => {
    const out: LoopCand[] = [];
    for (let h = 0; h < halls.length; h++) {
      const hall = halls[h]!;
      for (let s = 0; s < hall.slots.length; s++) {
        const slot = hall.slots[s]!;
        if (slot.p !== -1 || slot.d >= 2) continue;
        const d = slot.d;
        const c1 = stepCell(slot.cell, d);
        if (c1 < 0 || reserved[c1]) continue;
        let b = occupied[c1]!;
        let cb = c1;
        let far = false;
        if (b < 0) {
          const c2 = stepCell(c1, d);
          if (c2 < 0 || reserved[c2]) continue;
          b = occupied[c2]!;
          cb = c2;
          far = true;
        }
        if (b < 0) continue;
        const bs = slotAt(b, opposite(d), cb);
        if (bs < 0 || !loopOk(h, s, b, bs)) continue;
        out.push({ h, s, b, bs, far, c1 });
      }
    }
    if (t.turnPercent > 0) {
      for (let h = 0; h < halls.length; h++) {
        for (let s = 0; s < halls[h]!.slots.length; s++) {
          if (halls[h]!.slots[s]!.p !== -1) continue;
          for (const tn of turnsFrom(h, s)) {
            const b = occupied[tn.t]!;
            if (reserved[tn.t] || b <= h) continue;
            const bs = slotAt(b, tn.sideB, tn.t);
            if (bs < 0 || !loopOk(h, s, b, bs) || !turnClear(tn, b)) continue;
            out.push({ h, s, b, bs, far: false, c1: tn.c1, turn: tn });
          }
        }
      }
    }
    return out;
  };
  const loopCount = t.loops[0] + pick(0, SALT.loopCount, t.loops[1] - t.loops[0] + 1);
  for (let n = 0; n < loopCount; n++) {
    const valid = loopCandidates();
    if (valid.length === 0) break;
    const chosen = valid[pick(n, SALT.loop, valid.length)]!;
    if (chosen.far || chosen.turn?.kind === 'L') reserved[chosen.c1] = true;
    join(chosen.h, chosen.s, chosen.b, chosen.bs, true, chosen.far, chosen.turn?.corners);
  }

  // 5. A Passage's geometry: its pieces from the route and the Halls' final rects, with the heights of its doors. A Hall's doors list only the Passages
  // attached at its floor at a side's centre: a gallery's wall is cut by the Passage's own doorway, and so is a great hall's long side.
  const doors: Record<Side, number>[] = halls.map(() => ({}) as Record<Side, number>);
  const heights = passages.map((p) => {
    const da = halls[p.a]!.slots[p.sa]!.d;
    const db = halls[p.b]!.slots[p.sb]!.d;
    if (!halls[p.a]!.slots[p.sa]!.long && !raised(p.a, da)) doors[p.a]![SIDES[da]!] = w;
    if (!halls[p.b]!.slots[p.sb]!.long && !raised(p.b, db)) doors[p.b]![SIDES[db]!] = w;
    return { ya: doorLevel(p.a, da) * LEVEL_RISE, yb: doorLevel(p.b, db) * LEVEL_RISE };
  });
  const planOf = (n: number): DelverPassage => {
    const p = passages[n]!;
    const ha = halls[p.a]!;
    const hb = halls[p.b]!;
    const { ya, yb } = heights[n]!;
    const pieces = passagePieces(ha.rect, hb.rect, p.route, w, ya, yb);
    return {
      id: `pass${n}`, a: p.a, b: p.b, axis: pieces[0]!.axis, rect: boundsOf(pieces), length: Math.abs(ha.cx - hb.cx) + Math.abs(ha.cz - hb.cz), loop: p.loop, ya, yb,
      shape: shapeOf(pieces), sideA: p.route.sideA, sideB: p.route.sideB, pieces,
    };
  };
  const plannedPassages: DelverPassage[] = passages.map((_, n) => planOf(n));

  const n = halls.length;
  const adj: Edge[][] = halls.map(() => []);
  for (const p of plannedPassages) {
    adj[p.a]!.push({ to: p.b, w: p.length });
    adj[p.b]!.push({ to: p.a, w: p.length });
  }
  const joined = (a: number, b: number) => plannedPassages.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));

  // 7. Kinds. The Entrance is a leaf (a Hall with one Passage) that is not a great hall when there is one, else any Hall that is not great. A Boss Floor with
  // great halls has Hall 0, a great hall, for its Boss Hall: the Entrance is then the leaf (not great) furthest from it by walking.
  const passageCount = halls.map((hall) => hall.slots.filter((sl) => sl.p !== -1).length);
  const leaves = halls.flatMap((_, h) => (passageCount[h] === 1 ? [h] : []));
  const flats = leaves.filter((h) => !halls[h]!.great);
  const notGreat = halls.flatMap((hall, h) => (hall.great ? [] : [h]));
  /** Stage 7f: `pool` without its Uphill, Spiral and (Stage 7g) drawn-room Halls (the Entrance, a Rest and the Treasure never take one), unless that leaves it empty. With none, `pool`. */
  const plainOf = (pool: readonly number[]): number[] => {
    const plain = pool.filter((h) => feat[h]?.kind !== 'uphill' && feat[h]?.kind !== 'spiral' && feat[h]?.kind !== 'room');
    return plain.length > 0 ? plain : [...pool];
  };
  let entrance: number;
  let stairs: number;
  if (startGreat) {
    const from0 = dijkstra(adj, [0]).dist;
    const pool = plainOf(flats.length > 0 ? flats : notGreat);
    entrance = 0;
    for (const h of pool) if (entrance === 0 || from0[h]! > from0[entrance]!) entrance = h;
    stairs = 0;
  } else {
    const pool = plainOf(flats.length > 0 ? flats : notGreat.length > 0 ? notGreat : leaves.length > 0 ? leaves : halls.map((_, h) => h));
    entrance = gallery ? 0 : pool[pick(0, SALT.entrance, pool.length)]!;
    stairs = entrance;
  }

  // 6. Depth: the walk from the Entrance.
  const { dist: depth, pred } = dijkstra(adj, [entrance]);
  // Stage 7g: the Stairs (a Boss Floor's Boss Hall) is never a drawn room that may not serve as one, while another Hall can.
  const roomKinds = (h: number): readonly string[] | null => (feat[h]?.kind === 'room' ? (feat[h] as { room: DrawnRoom }).room.kinds : null);
  const stairsKind: DelverHallKind = boss ? 'Boss' : 'Stairs';
  const mayStairs = (h: number): boolean => !(roomKinds(h)?.includes(stairsKind) === false);
  if (!startGreat) {
    for (let h = 0; h < n; h++) if (depth[h]! > depth[stairs]!) stairs = h;
    if (!mayStairs(stairs)) {
      let alt = -1;
      for (let h = 0; h < n; h++) if (h !== entrance && mayStairs(h) && (alt < 0 || depth[h]! > depth[alt]!)) alt = h;
      if (alt >= 0) stairs = alt;
    }
  }
  const mainPath: number[] = [];
  for (let h = stairs; h !== -1; h = pred[h]!) mainPath.push(h);
  mainPath.reverse();
  const onMain = new Array<boolean>(n).fill(false);
  for (const h of mainPath) onMain[h] = true;

  const kind = new Array<DelverHallKind | null>(n).fill(null);
  kind[entrance] = 'Entrance';
  // A Boss Floor's Stairs Hall is the Boss Hall, grown to the most its gaps allow when no great halls are wanted (the Passages touching it re-pieced
  // from the same corners, which were placed against the grown reach rect).
  const bossHall = boss && stairs !== entrance;
  if (stairs !== entrance) kind[stairs] = bossHall ? 'Boss' : 'Stairs';
  if (bossHall && grows && feat[stairs]?.kind !== 'room') {
    halls[stairs]!.rect = grownRect(halls[stairs]!.cells[0]!);
    passages.forEach((p, k) => {
      if (p.a === stairs || p.b === stairs) plannedPassages[k] = planOf(k);
    });
  }

  /** Hall `h`'s floor height (m). */
  const hy = (h: number): number => level[h]! * LEVEL_RISE;

  // 7b. Each gallery's geometry from its Hall's final rect (the Boss Hall's grown): a strip `GALLERY_DEPTH` in from its wall, cut along the
  // wall into the Deck (from one corner), the Ramp (rising toward the Deck) and an approach of the Hall's own floor.
  const galleryOf = new Array<DelverGallery | undefined>(n).fill(undefined);
  halls.forEach((hall, h) => {
    const g = gal[h];
    if (!g) return;
    const r = hall.rect;
    const side = SIDES[g.d]!;
    const alongX = g.d % 2 === 0;
    const u0 = alongX ? r.x0 : r.z0;
    const u1 = alongX ? r.x1 : r.z1;
    const [d0, d1, r0, r1] = g.end === 0 ? [u0, u1 - GALLERY_APPROACH - GALLERY_RAMP, u1 - GALLERY_APPROACH - GALLERY_RAMP, u1 - GALLERY_APPROACH] : [u0 + GALLERY_APPROACH + GALLERY_RAMP, u1, u0 + GALLERY_APPROACH, u0 + GALLERY_APPROACH + GALLERY_RAMP];
    // Across the wall the strip is `GALLERY_DEPTH` deep: n and e walls are at the high coordinate, s and w at the low one.
    const across = (): [number, number] => (g.d <= 1 ? [(alongX ? r.z1 : r.x1) - GALLERY_DEPTH, alongX ? r.z1 : r.x1] : [alongX ? r.z0 : r.x0, (alongX ? r.z0 : r.x0) + GALLERY_DEPTH]);
    const [c0, c1] = across();
    const rect = (a: number, b: number): Rect => (alongX ? { x0: a, z0: c0, x1: b, z1: c1 } : { x0: c0, z0: a, x1: c1, z1: b });
    const up: Side = alongX ? (g.end === 0 ? 'w' : 'e') : g.end === 0 ? 's' : 'n';
    // A wrap's Decks: the strip along each wrap wall, cut along the wall (`from`, `to`) clear of the strips of the walls across it, the first wall's
    // and (for a U) the opposite one's. The strip is `GALLERY_DEPTH` in from its wall: n and e at the high coordinate, s and w at the low one.
    const strip = (wd: number, from: number, to: number): Rect => {
      const ax = wd % 2 === 0;
      const lo = ax ? r.x0 : r.z0;
      const hi = ax ? r.x1 : r.z1;
      const [a0, a1] = [lo + from, hi - to];
      const [lo2, hi2] = wd <= 1 ? [(ax ? r.z1 : r.x1) - GALLERY_DEPTH, ax ? r.z1 : r.x1] : [ax ? r.z0 : r.x0, (ax ? r.z0 : r.x0) + GALLERY_DEPTH];
      return ax ? { x0: a0, z0: lo2, x1: a1, z1: hi2 } : { x0: lo2, z0: a0, x1: hi2, z1: a1 };
    };
    const [w1, w2] = g.wraps;
    const decks: Rect[] = [];
    if (w1 !== undefined) {
      const u = w2 !== undefined;
      decks.push(strip(w1, g.d > 1 || u ? GALLERY_DEPTH : 0, g.d <= 1 || u ? GALLERY_DEPTH : 0));
      if (w2 !== undefined) decks.push(strip(w2, 0, 0));
    }
    const wrap = w1 !== undefined ? { walls: g.wraps.map((x) => SIDES[x]!), decks } : undefined;
    galleryOf[h] = { side, end: g.end, y: level[h]! * LEVEL_RISE + LEVEL_RISE, deck: rect(d0, d1), ramp: rect(r0, r1), up, high: galWalls(h).some((x) => hasOn(h, x)), ...(wrap ? { wrap } : {}) };
  });

  // 7b'. Each split's and pit's geometry from its Hall's final rect (the Boss Hall's grown), the cuts recomputed from the Hall's centre.
  const featureOf = new Array<DelverFeature | undefined>(n).fill(undefined);
  halls.forEach((hall, h) => {
    const f = feat[h];
    if (!f) return;
    const r = hall.rect;
    const y = hy(h);
    const L = level[h]!;
    if (f.kind === 'room') {
      // Stage 7g: the room in its frame, moved to the Hall's centre and up to its floor; the centre markers stand at its centre point.
      const placed = { ...roomFeature(`hall${h}`, f.room, f.frame, r, y), shift: f.shift };
      featureOf[h] = placed;
      [hall.cx, hall.cz] = placed.centre;
      return;
    }
    if (f.kind === 'uphill') {
      // Stage 7f: the Hall's centre moves to the high landing's middle, as a ring's moves, so every centre marker stands on the high ground.
      const g = uphillGeometry(r, f.up, f.rise, y)!;
      hall.cx = g.cx;
      hall.cz = g.cz;
      featureOf[h] = { kind: 'uphill', axis: f.axis, up: SIDES[f.up]!, rise: f.rise, low: g.low, high: g.high, steps: [g.step] };
      return;
    }
    if (f.kind === 'spiral') {
      const g = spiralGeometry(r, f.base, f.turn, y)!;
      const well = floorRects(r, [...g.landings.map((l) => l.rect), ...g.steps.map((st) => st.rect)]);
      featureOf[h] = { kind: 'spiral', base: SIDES[f.base]!, turn: f.turn, landings: g.landings, steps: g.steps, well };
      return;
    }
    if (f.kind === 'split') {
      // Along z (tiers south to north); along x the same with x and z swapped. `R` is a rect from its extent along the axis and its extent across.
      const alongX = f.axis === 'x';
      const [lo, hi, a0, a1, c] = alongX ? [r.x0, r.x1, r.z0, r.z1, hall.cx] : [r.z0, r.z1, r.x0, r.x1, hall.cz];
      const R = (p0: number, p1: number, q0 = a0, q1 = a1): Rect => (alongX ? { x0: p0, z0: q0, x1: p1, z1: q1 } : { x0: q0, z0: p0, x1: q1, z1: p1 });
      const [cutLo, cutHi] = cutsAt(c);
      const [dLo, dHi] = outerEnds(f);
      const tiers: DelverTier[] = [];
      if (dLo >= 0) tiers.push({ rect: R(lo, cutLo), level: L - 1, y: (L - 1) * LEVEL_RISE });
      tiers.push({ rect: R(dLo >= 0 ? cutLo : lo, dHi >= 0 ? cutHi : hi), level: L, y });
      if (dHi >= 0) tiers.push({ rect: R(cutHi, hi), level: L - 1, y: (L - 1) * LEVEL_RISE });
      // The low-end outer tier's step stands against the low side wall when `s` is 0, else the high one; the high-end outer tier's against the other.
      const lowWall = f.s === 0;
      const across = (atLow: boolean): [number, number] => (atLow ? [a0, a0 + STEP_WIDTH] : [a1 - STEP_WIDTH, a1]);
      const rails: Side[] = alongX ? ['n', 's'] : ['e', 'w'];
      const lowY = (L - 1) * LEVEL_RISE;
      const steps: DelverStep[] = [];
      if (dLo >= 0) steps.push({ rect: R(cutLo - STEP_WIDTH, cutLo, ...across(lowWall)), lo: lowY, hi: y, up: alongX ? 'e' : 'n', rails });
      if (dHi >= 0) steps.push({ rect: R(cutHi, cutHi + STEP_WIDTH, ...across(!lowWall)), lo: lowY, hi: y, up: alongX ? 'w' : 's', rails });
      featureOf[h] = { kind: 'split', axis: f.axis, tiers, steps };
    } else {
      const pit: Rect = { x0: r.x0 + PIT_RIM, z0: r.z0 + PIT_RIM, x1: r.x1 - PIT_RIM, z1: r.z1 - PIT_RIM };
      const rim = y + f.depth;
      // v is the longer axis (the steps stand along its two edges), u the other (the steps run along it, `2 * depth` long, from a corner).
      const vz = f.v === 'z';
      const [pv0, pv1, pu0, pu1] = vz ? [pit.z0, pit.z1, pit.x0, pit.x1] : [pit.x0, pit.x1, pit.z0, pit.z1];
      const run = 2 * f.depth;
      const R = (u0: number, u1: number, v0: number, v1: number): Rect => (vz ? { x0: u0, z0: v0, x1: u1, z1: v1 } : { x0: v0, z0: u0, x1: v1, z1: u1 });
      const [uLow, uHigh]: [Side, Side] = vz ? ['w', 'e'] : ['s', 'n'];
      const rails: Side[] = vz ? ['n', 's'] : ['e', 'w'];
      const lowCorner = (v0: number, v1: number) => R(pu0, pu0 + run, v0, v1);
      const highCorner = (v0: number, v1: number) => R(pu1 - run, pu1, v0, v1);
      const steps: DelverStep[] =
        f.turn === 0
          ? [
              { rect: lowCorner(pv0, pv0 + STEP_WIDTH), lo: y, hi: rim, up: uLow, rails },
              { rect: highCorner(pv1 - STEP_WIDTH, pv1), lo: y, hi: rim, up: uHigh, rails },
            ]
          : [
              { rect: highCorner(pv0, pv0 + STEP_WIDTH), lo: y, hi: rim, up: uHigh, rails },
              { rect: lowCorner(pv1 - STEP_WIDTH, pv1), lo: y, hi: rim, up: uLow, rails },
            ];
      featureOf[h] = { kind: 'pit', depth: f.depth, pit, rim, rims: floorRects(r, [pit]), steps };
    }
  });

  // In line: straight on from the Entrance, through each Hall by its slot on the side opposite the one entered, on the same lattice line, and only
  // through straight Passages.
  const inLine: number[] = [];
  const seen = new Array<boolean>(n).fill(false);
  seen[entrance] = true;
  for (let d = 0; d < 4; d++) {
    for (let s0 = 0; s0 < halls[entrance]!.slots.length; s0++) {
      if (halls[entrance]!.slots[s0]!.d !== d) continue;
      let from = entrance;
      let at = s0;
      for (;;) {
        const slot = halls[from]!.slots[at]!;
        if (slot.p === -1) break;
        const pass = plannedPassages[slot.p]!;
        if (pass.shape !== 'straight') break;
        const next = pass.a === from ? pass.b : pass.a;
        if (seen[next]) break;
        seen[next] = true;
        inLine.push(next);
        from = next;
        at = halls[next]!.slots.findIndex((sl) => sl.d === d && sl.line === slot.line);
        if (at < 0) break;
      }
    }
  }
  const isInLine = new Array<boolean>(n).fill(false);
  for (const h of inLine) isInLine[h] = true;

  // Rest: one about halfway along the main path, a second about three quarters of the way.
  const D = depth[stairs]!;
  const restCount = t.rests[0] + pick(0, SALT.rests, t.rests[1] - t.rests[0] + 1);
  const rests: number[] = [];
  const best = (from: readonly number[], score: (h: number) => number): number => {
    let at = -1;
    for (const h of from) if (at < 0 || score(h) < score(at)) at = h;
    return at;
  };
  if (restCount >= 1) {
    const other = (h: number) => h !== entrance && h !== stairs;
    const onPath = mainPath.filter(other);
    const all = halls.map((_, h) => h).filter(other);
    const first = best(plainOf(onPath.length > 0 ? [...onPath].sort((a, b) => a - b) : all), (h) => Math.abs(2 * depth[h]! - D));
    if (first >= 0) {
      kind[first] = 'Rest';
      rests.push(first);
      if (restCount >= 2) {
        const pool = halls.map((_, h) => h).filter((h) => kind[h] === null && !joined(h, first));
        const second = best(plainOf(pool), (h) => Math.abs(4 * depth[h]! - 3 * D));
        if (second >= 0) {
          kind[second] = 'Rest';
          rests.push(second);
        }
      }
    }
  }

  // Treasure: off the main path, furthest by walking from it; in a great hall when it has one to choose.
  const fromMain = dijkstra(adj, mainPath).dist;
  for (let k = 0; k < t.treasures; k++) {
    const open = plainOf(halls.map((_, h) => h).filter((h) => !onMain[h] && kind[h] === null));
    const pool = open.some((h) => halls[h]!.great) ? open.filter((h) => halls[h]!.great) : open;
    if (pool.length === 0) break;
    const far = Math.max(...pool.map((h) => fromMain[h]!));
    const tied = pool.filter((h) => fromMain[h] === far);
    kind[tied[pick(k, SALT.treasure, tied.length)]!] = 'Treasure';
  }

  // Fight / Empty: the Halls left. Those in line are Empty; of the others, a share by a seeded order, a great hall never one of them (it is a Fight).
  const left = halls.map((_, h) => h).filter((h) => kind[h] === null);
  // The Set Piece Gallery's Halls are all in line: there its plain Halls are Empty and its set pieces the others (a set piece is tried with its Warband).
  const leftInLine = left.filter((h) => (gallery ? !gallery.pieces[h] : isInLine[h]));
  const free = left
    .filter((h) => (gallery ? !!gallery.pieces[h] : !isInLine[h]))
    .map((h) => ({ h, key: pick(h, SALT.order, 0x1_0000_0000) }))
    .sort((a, b) => a.key - b.key || a.h - b.h);
  const empties = Math.max(0, Math.floor((left.length * t.emptyPercent) / 100) - leftInLine.length);
  for (const h of leftInLine) kind[h] = 'Empty';
  let emptied = 0;
  for (const f of free) {
    // Stage 7g: a drawn room that may not be Empty is a Fight, and one that may not be a Fight is Empty.
    const rk = roomKinds(f.h);
    if (rk && !rk.includes('Empty')) kind[f.h] = 'Fight';
    else if (rk && !rk.includes('Fight')) kind[f.h] = 'Empty';
    else if (!halls[f.h]!.great && emptied < empties) {
      kind[f.h] = 'Empty';
      emptied++;
    } else {
      kind[f.h] = 'Fight';
    }
  }

  // 7c'. Daises (docs/plans/delver.md, Stage 7c), after the kinds and the Boss Hall's growth, so the rects are final. A Boss or Treasure Hall with no gallery
  // and no split or pit is picked with `daisPercent`'s chance; sides are tried in turn from a picked one (n, e, s, w, wrapping) and the first that fits takes the dais
  // (the throne or the altar): no Passage leaves by the side, the Hall is deep enough across it, and the dais and its step keep clear of every doorway's lane
  // and of the centre square. None fits: no dais.
  if (t.features.daisPercent > 0) {
    halls.forEach((hall, h) => {
      if ((kind[h] !== 'Boss' && kind[h] !== 'Treasure') || galleryOf[h] || featureOf[h] || crossRes[h] || pick(h, SALT.dais, 100) >= t.features.daisPercent) return;
      const r = hall.rect;
      const y0 = hy(h);
      const spans = hall.slots.filter((sl) => sl.p !== -1).map((sl) => ({ d: sl.d, lo: sl.line - half - DOOR_SIDE, hi: sl.line + half + DOOR_SIDE }));
      const lanes: Rect[] = spans.map((sp) =>
        sp.d === 0 ? { x0: sp.lo, z0: r.z1 - DOOR_LANE, x1: sp.hi, z1: r.z1 }
        : sp.d === 2 ? { x0: sp.lo, z0: r.z0, x1: sp.hi, z1: r.z0 + DOOR_LANE }
        : sp.d === 1 ? { x0: r.x1 - DOOR_LANE, z0: sp.lo, x1: r.x1, z1: sp.hi }
        : { x0: r.x0, z0: sp.lo, x1: r.x0 + DOOR_LANE, z1: sp.hi });
      const centre: Rect = { x0: hall.cx - CENTRE_CLEAR, z0: hall.cz - CENTRE_CLEAR, x1: hall.cx + CENTRE_CLEAR, z1: hall.cz + CENTRE_CLEAR };
      const k0 = pick(h, SALT.daisSide, 4);
      for (let i = 0; i < 4; i++) {
        const d = (k0 + i) % 4;
        if (spans.some((sp) => sp.d === d)) continue;
        const alongX = d === 0 || d === 2;
        if ((alongX ? r.z1 - r.z0 : r.x1 - r.x0) / 2 < DAIS_DEPTH + DAIS_STEP + CENTRE_CLEAR) continue;
        const m = ev(alongX ? hall.cx : hall.cz);
        // `R` is a rect from its extent along the wall and its extent across it (the dais's inner edge, then the step's further in).
        const R = (a0: number, a1: number, c0: number, c1: number): Rect => (alongX ? { x0: a0, z0: c0, x1: a1, z1: c1 } : { x0: c0, z0: a0, x1: c1, z1: a1 });
        const [w0, w1] = d === 0 ? [r.z1 - DAIS_DEPTH, r.z1] : d === 2 ? [r.z0, r.z0 + DAIS_DEPTH] : d === 1 ? [r.x1 - DAIS_DEPTH, r.x1] : [r.x0, r.x0 + DAIS_DEPTH];
        const rect = R(m - DAIS_HALF, m + DAIS_HALF, w0, w1);
        const [s0, s1] = d === 0 || d === 1 ? [w0 - DAIS_STEP, w0] : [w1, w1 + DAIS_STEP];
        const step = R(m - DAIS_STEP_HALF, m + DAIS_STEP_HALF, s0, s1);
        const inside = (q: Rect) => q.x0 >= r.x0 && q.x1 <= r.x1 && q.z0 >= r.z0 && q.z1 <= r.z1;
        if (![rect, step].every((q) => inside(q) && lanes.every((ln) => apartBy(q, ln, 0)) && apartBy(q, centre, 0))) continue;
        const side = SIDES[d]!;
        featureOf[h] = {
          kind: 'dais', side, rect, y: y0 + DAIS_RISE,
          steps: [{ rect: step, lo: y0, hi: y0 + DAIS_RISE, up: side, rails: alongX ? ['e', 'w'] : ['n', 's'] }],
        };
        break;
      }
    });
  }

  // 7d'. Lava (docs/plans/delver.md, Stage 7d), after the kinds, the Boss Hall's growth and the daises, so the rects are final, and before 7c: a lava Hall is
  // neither shaped nor pillared. A Fight, Empty, Boss or Stairs Hall with no gallery and no feature (a dais included) may hold lava; it is picked with the
  // tier's `lava.percent` (with 0, no pick at all is made). The kind is a weighted pick; a kind that does not fit leaves the Hall plain (no other is tried).
  // Sides (the pit's centre band, the river's bank wall, the trough's wall) are tried in turn from a picked one (n, e, s, w, wrapping), the first that fits
  // taken. Written for wall d, with `toRect` mapping a span along the wall and a span across it (metres in from the wall) to a rect. Every lava edge is on an
  // odd metre. The walk is never cut: a trough lies beyond the centre square and leaves each lane (`LAVA_LANE`) clear; a river lies beyond it too, so the
  // centre and every wall across it are on the centre's side, every lane off the bank wall keeps clear of the band and every lane on the bank wall crosses
  // its door bridge, the bank behind it being at least `RIVER_BANK` and reached by every bridge; a pit's bands are wider than a lane, and the centre moves
  // into the centre band, as a ring's does.
  const lavaOf = new Array<DelverLava | undefined>(n).fill(undefined);
  // Stage 7g: a drawn room's lava pools are its Hall's lava (kind `room`), so drops, revives, the render and the AI read them as 7d's.
  featureOf.forEach((f, h) => {
    if (f?.kind === 'room' && f.lava.length > 0) lavaOf[h] = { kind: 'room', walls: [], rects: [...f.lava].sort((p, q) => p.z0 - q.z0 || p.x0 - q.x0), y: hy(h) - LAVA_DEPTH, bridges: [] };
  });

  // 7d''. Lava Bridges (Stage 7f): each reserved Hall, in index order, takes one when it fits; else it stays plain (no lava is tried for it, but shapes and
  // pillars may be). It fits a Fight, Empty, Boss or Stairs Hall with no gallery and no feature, both halves at least `CROSS_HALF`, when every held slot's door
  // span lies within the plaza's span along its wall. The plaza is 7d's dry centre square, odd-snapped; an arm runs from each held doorway (its door span
  // across) to the plaza; the rest is lava, but a piece thinner than `LAVA_MIN` on either axis, which stays floor.
  crossRes.forEach((res, h) => {
    if (!res) return;
    const hall = halls[h]!;
    const hk = kind[h];
    if ((hk !== 'Fight' && hk !== 'Empty' && hk !== 'Boss' && hk !== 'Stairs') || galleryOf[h] || featureOf[h]) {
      drops.kind++;
      return;
    }
    const r = hall.rect;
    if (r.x1 - r.x0 < 2 * CROSS_HALF || r.z1 - r.z0 < 2 * CROSS_HALF) {
      drops.size++;
      return;
    }
    const plaza: Rect = { x0: oddDown(hall.cx - LAVA_CENTRE), z0: oddDown(hall.cz - LAVA_CENTRE), x1: oddUp(hall.cx + LAVA_CENTRE), z1: oddUp(hall.cz + LAVA_CENTRE) };
    const arms: { d: number; rect: Rect }[] = [];
    for (const sl of hall.slots) {
      if (sl.p === -1) continue;
      const [a, b] = doorSpan(sl.line);
      const [p0, p1] = sl.d % 2 === 0 ? [plaza.x0, plaza.x1] : [plaza.z0, plaza.z1];
      if (a < p0 || b > p1) {
        drops.doorWalls++;
        return;
      }
      const rect: Rect =
        sl.d === 0 ? { x0: a, z0: plaza.z1, x1: b, z1: r.z1 }
        : sl.d === 2 ? { x0: a, z0: r.z0, x1: b, z1: plaza.z0 }
        : sl.d === 1 ? { x0: plaza.x1, z0: a, x1: r.x1, z1: b }
        : { x0: r.x0, z0: a, x1: plaza.x0, z1: b };
      arms.push({ d: sl.d, rect });
    }
    const rects = floorRects(r, [plaza, ...arms.map((a) => a.rect)])
      .filter((q) => q.x1 - q.x0 >= LAVA_MIN && q.z1 - q.z0 >= LAVA_MIN)
      .sort((p, q) => p.z0 - q.z0 || p.x0 - q.x0);
    if (rects.length === 0) {
      drops.size++;
      return;
    }
    const walls = [0, 1, 2, 3].filter((d) => arms.some((a) => a.d === d)).map((d) => SIDES[d]!);
    const bridges = arms.map((a) => a.rect).sort((p, q) => p.z0 - q.z0 || p.x0 - q.x0);
    lavaOf[h] = { kind: 'cross', walls, rects, y: hy(h) - LAVA_DEPTH, bridges, plaza };
  });

  const lavaP = t.lava.percent[Math.min(tier, t.lava.percent.length) - 1]!;
  if (lavaP > 0) {
    halls.forEach((hall, h) => {
      const hk = kind[h];
      if ((hk !== 'Fight' && hk !== 'Empty' && hk !== 'Boss' && hk !== 'Stairs') || galleryOf[h] || featureOf[h] || crossRes[h] || pick(h, SALT.lava, 100) >= lavaP) return;
      const want = (['pit', 'river', 'trough'] as const)[byWeight(h, SALT.lavaKind, [t.lava.weights.pit, t.lava.weights.river, t.lava.weights.trough])]!;
      const r = hall.rect;
      const wide = [2, 4][pick(h, SALT.lavaWide, 2)]!;
      const two = pick(h, SALT.lavaTwo, 100) < t.lava.twoPercent;
      const y = hy(h) - LAVA_DEPTH;
      const lanes = hall.slots
        .filter((sl) => sl.p !== -1)
        .map((sl) => {
          const lo = sl.line - half - DOOR_SIDE;
          const hi = sl.line + half + DOOR_SIDE;
          const rect: Rect =
            sl.d === 0 ? { x0: lo, z0: r.z1 - DOOR_LANE, x1: hi, z1: r.z1 }
            : sl.d === 2 ? { x0: lo, z0: r.z0, x1: hi, z1: r.z0 + DOOR_LANE }
            : sl.d === 1 ? { x0: r.x1 - DOOR_LANE, z0: lo, x1: r.x1, z1: hi }
            : { x0: r.x0, z0: lo, x1: r.x0 + DOOR_LANE, z1: hi };
          return { d: sl.d, line: sl.line, rect };
        });
      const toRect = (d: number, a0: number, a1: number, c0: number, c1: number): Rect =>
        d === 0 ? { x0: a0, z0: r.z1 - c1, x1: a1, z1: r.z1 - c0 }
        : d === 2 ? { x0: a0, z0: r.z0 + c0, x1: a1, z1: r.z0 + c1 }
        : d === 1 ? { x0: r.x1 - c1, z0: a0, x1: r.x1 - c0, z1: a1 }
        : { x0: r.x0 + c0, z0: a0, x1: r.x0 + c1, z1: a1 };
      /** The wall's extent along it, and how far (m) the Hall's centre stands in from it. */
      const along = (d: number): [number, number] => (d % 2 === 0 ? [r.x0, r.x1] : [r.z0, r.z1]);
      const centreIn = (d: number): number => (d === 0 ? r.z1 - hall.cz : d === 2 ? hall.cz - r.z0 : d === 1 ? r.x1 - hall.cx : hall.cx - r.x0);
      const overlaps = (p: Rect, q: Rect): boolean => p.x0 < q.x1 && q.x0 < p.x1 && p.z0 < q.z1 && q.z0 < p.z1;
      const grow1 = (q: Rect): Rect => ({ x0: q.x0 - LAVA_LANE, z0: q.z0 - LAVA_LANE, x1: q.x1 + LAVA_LANE, z1: q.z1 + LAVA_LANE });
      /** Sorted, merged spans `[a, b]` (touching ones join). */
      const merged = (spans: readonly (readonly [number, number])[]): [number, number][] => {
        const out: [number, number][] = [];
        for (const sp of [...spans].sort((p, q) => p[0] - q[0] || p[1] - q[1])) {
          const last = out[out.length - 1];
          if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
          else out.push([sp[0], sp[1]]);
        }
        return out;
      };
      /** What `lo` to `hi` has left after taking `spans` (merged) away: the runs, ascending, of positive length. */
      const gaps = (spans: readonly (readonly [number, number])[], lo: number, hi: number): [number, number][] => {
        const out: [number, number][] = [];
        let at = lo;
        for (const sp of spans) {
          if (sp[0] > at) out.push([at, Math.min(sp[0], hi)]);
          at = Math.max(at, sp[1]);
        }
        if (at < hi) out.push([at, hi]);
        return out;
      };
      const byZX = (p: Rect, q: Rect): number => p.z0 - q.z0 || p.x0 - q.x0;

      /** The troughs along wall `d`, depth `tt`: the strip cut round every lane that comes within `LAVA_LANE` of it, the runs of at least `TROUGH_MIN`. */
      const troughs = (d: number, tt: number): Rect[] => {
        if (centreIn(d) - tt < LAVA_CENTRE) return [];
        const [lo, hi] = along(d);
        const strip = toRect(d, lo, hi, 0, tt);
        const cuts = lanes
          .filter((ln) => overlaps(grow1(ln.rect), strip))
          .map((ln): [number, number] => (d % 2 === 0 ? [oddDown(ln.rect.x0 - 1), oddUp(ln.rect.x1 + 1)] : [oddDown(ln.rect.z0 - 1), oddUp(ln.rect.z1 + 1)]));
        return gaps(merged(cuts), lo, hi)
          .filter(([a, b]) => b - a >= TROUGH_MIN)
          .map(([a, b]) => toRect(d, a, b, 0, tt));
      };
      /** A river with bank wall `d`: its lava rects and bridges, or null when it does not fit. */
      const river = (d: number): { rects: Rect[]; bridges: Rect[] } | null => {
        const [lo, hi] = along(d);
        const wallAt = d === 0 ? r.z1 : d === 2 ? r.z0 : d === 1 ? r.x1 : r.x0;
        const c = d % 2 === 0 ? hall.cz : hall.cx;
        let b0: number;
        let b1: number;
        if (d === 0 || d === 1) {
          b0 = oddUp(c + LAVA_CENTRE);
          b1 = b0 + wide;
          if (wallAt - b1 < RIVER_BANK) return null;
        } else {
          b1 = oddDown(c - LAVA_CENTRE);
          b0 = b1 - wide;
          if (b0 - wallAt < RIVER_BANK) return null;
        }
        const band: Rect = d % 2 === 0 ? { x0: r.x0, z0: b0, x1: r.x1, z1: b1 } : { x0: b0, z0: r.z0, x1: b1, z1: r.z1 };
        if (lanes.some((ln) => ln.d !== d && overlaps(grow1(ln.rect), band))) return null;
        // The bridges along the river: a door bridge for each held slot on the bank wall, then free ones up to the wanted count.
        let floor = merged(lanes.filter((ln) => ln.d === d).map((ln): [number, number] => [Math.max(lo, oddDown(ln.line - 2)), Math.min(hi, oddUp(ln.line + 2))]));
        // A floor gap against a wall's end is a bridge only when it holds a bank-wall doorway (a wall-end door bridge); else it is floor.
        const doorways = lanes.filter((ln) => ln.d === d).map((ln): [number, number] => [ln.line - half, ln.line + half]);
        const wanted = two ? 2 : 1;
        while (floor.length < wanted) {
          const runs = gaps(floor, lo, hi);
          let best = -1;
          for (let k = 0; k < runs.length; k++) if (best < 0 || runs[k]![1] - runs[k]![0] > runs[best]![1] - runs[best]![0]) best = k;
          if (best < 0) break;
          const [r0, r1] = runs[best]!;
          const m = oddDown((r0 + r1) / 2);
          if (m - 2 - r0 < LAVA_MIN || r1 - (m + 2) < LAVA_MIN) break;
          floor = merged([...floor, [m - 2, m + 2]]);
        }
        // A lava run shorter than `LAVA_MIN` becomes floor.
        floor = merged([...floor, ...gaps(floor, lo, hi).filter(([a, b]) => b - a < LAVA_MIN)]);
        const runs = gaps(floor, lo, hi);
        if (runs.length === 0) return null;
        const across = (a: number, b: number): Rect => (d % 2 === 0 ? { x0: a, z0: b0, x1: b, z1: b1 } : { x0: b0, z0: a, x1: b1, z1: b });
        const bridges = floor.filter(([a, b]) => (a > lo && b < hi) || doorways.some(([d0, d1]) => a <= d0 && b >= d1)).map(([a, b]) => across(a, b)).sort(byZX);
        // Every river has a crossing: with none the Hall stays plain.
        if (bridges.length === 0) return null;
        return { rects: runs.map(([a, b]) => across(a, b)).sort(byZX), bridges };
      };
      /** A pit with its centre band on side `d`: one rect, the bands `LAVA_BAND` but the centre side's `2 * LAVA_CENTRE`; null when an extent is under `PIT_MIN`. */
      const pit = (d: number): Rect | null => {
        const p: Rect = {
          x0: r.x0 + (d === 3 ? 2 * LAVA_CENTRE : LAVA_BAND),
          z0: r.z0 + (d === 2 ? 2 * LAVA_CENTRE : LAVA_BAND),
          x1: r.x1 - (d === 1 ? 2 * LAVA_CENTRE : LAVA_BAND),
          z1: r.z1 - (d === 0 ? 2 * LAVA_CENTRE : LAVA_BAND),
        };
        return p.x1 - p.x0 >= PIT_MIN && p.z1 - p.z0 >= PIT_MIN ? p : null;
      };

      const k0 = pick(h, SALT.lavaSide, 4);
      for (let i = 0; i < 4; i++) {
        const d = (k0 + i) % 4;
        if (want === 'trough') {
          const first = troughs(d, wide);
          if (first.length === 0) continue;
          const second = two ? troughs(opposite(d), wide) : [];
          const walls = second.length > 0 ? [SIDES[d]!, SIDES[opposite(d)]!] : [SIDES[d]!];
          lavaOf[h] = { kind: 'trough', walls, rects: [...first, ...second].sort(byZX), y, bridges: [] };
        } else if (want === 'river') {
          const rv = river(d);
          if (!rv) continue;
          lavaOf[h] = { kind: 'river', walls: [SIDES[d]!], rects: rv.rects, y, bridges: rv.bridges };
        } else {
          const p = pit(d);
          if (!p) continue;
          lavaOf[h] = { kind: 'pit', walls: [SIDES[d]!], rects: [p], y, bridges: [] };
          // The centre moves into the centre band's middle, as a ring's does.
          if (d === 0) hall.cz = r.z1 - LAVA_CENTRE;
          else if (d === 2) hall.cz = r.z0 + LAVA_CENTRE;
          else if (d === 1) hall.cx = r.x1 - LAVA_CENTRE;
          else hall.cx = r.x0 + LAVA_CENTRE;
        }
        break;
      }
    });
  }

  // 7c. Shapes and pillars (docs/plans/delver.md, Stage 7b), after the kinds so the patrol points and markers read the final centres. A Hall with a
  // gallery, a feature (a split, a pit or a dais) or lava is neither shaped nor pillared. A shape is cut out of the Hall's rect by solids: notches in its corners (L, T, cross) or a core (ring).
  const hallShape = new Array<HallShape>(n).fill('rect');
  const hallSolids: Rect[][] = halls.map(() => []);
  const hallPillars: Rect[][] = halls.map(() => []);
  const hallLayout = new Array<PillarLayout | undefined>(n).fill(undefined);
  // A corner's two sides (n 0, e 1, s 2, w 3) in corner order NE, SE, SW, NW; a T's side (n, e, s, w) notches the two corners that share it.
  const CORNER_SIDES = [[0, 1], [2, 1], [2, 3], [0, 3]] as const;
  const T_CORNERS = [[0, 3], [0, 1], [1, 2], [2, 3]] as const;
  const evenDown = (v: number): number => 2 * Math.floor(v / 2);
  const evenUp = (v: number): number => 2 * Math.ceil(v / 2);
  halls.forEach((hall, h) => {
    if (galleryOf[h] || featureOf[h] || lavaOf[h]) return;
    const r = hall.rect;
    const hw = (r.x1 - r.x0) / 2;
    const hd = (r.z1 - r.z0) / 2;
    // The doorway of a slot holding a Passage, with DOOR_SIDE m to each side: where a notch may not stand and a pillar may not enter.
    const spans = hall.slots.filter((sl) => sl.p !== -1).map((sl) => ({ d: sl.d, lo: sl.line - half - DOOR_SIDE, hi: sl.line + half + DOOR_SIDE }));
    let shape: HallShape = 'rect';
    let solids: Rect[] = [];
    if (pick(h, SALT.shape, 100) < t.shapes.percent) {
      const kinds: HallShape[] = ['L', 'T', 'cross', 'ring'];
      const want = kinds[byWeight(h, SALT.shapeKind, [t.shapes.weights.L, t.shapes.weights.T, t.shapes.weights.cross, t.shapes.weights.ring])]!;
      if (want === 'ring') {
        if (hw >= RING_BAND + 2 && hd >= RING_BAND + 2) {
          const bandX = RING_BAND + 2 * pick(h, SALT.ringX, Math.floor((hw - 2 - RING_BAND) / 2) + 1);
          const bandZ = RING_BAND + 2 * pick(h, SALT.ringZ, Math.floor((hd - 2 - RING_BAND) / 2) + 1);
          shape = 'ring';
          solids = [{ x0: hall.cx - (hw - bandX), z0: hall.cz - (hd - bandZ), x1: hall.cx + (hw - bandX), z1: hall.cz + (hd - bandZ) }];
          hall.cz = r.z0 + bandZ / 2;
        }
      } else {
        const capX = evenDown(hw - CENTRE_KEEP);
        const capZ = evenDown(hd - CENTRE_KEEP);
        if (capX >= NOTCH_MIN && capZ >= NOTCH_MIN) {
          const nx = NOTCH_MIN + 2 * pick(h, SALT.notchX, (capX - NOTCH_MIN) / 2 + 1);
          const nz = NOTCH_MIN + 2 * pick(h, SALT.notchZ, (capZ - NOTCH_MIN) / 2 + 1);
          const corners: Rect[] = [
            { x0: r.x1 - nx, z0: r.z1 - nz, x1: r.x1, z1: r.z1 },
            { x0: r.x1 - nx, z0: r.z0, x1: r.x1, z1: r.z0 + nz },
            { x0: r.x0, z0: r.z0, x1: r.x0 + nx, z1: r.z0 + nz },
            { x0: r.x0, z0: r.z1 - nz, x1: r.x0 + nx, z1: r.z1 },
          ];
          // A notch passes the door check when, on each side its rect lies along, it covers no doorway's span (touching allowed).
          const passes = (k: number): boolean =>
            CORNER_SIDES[k]!.every((d) => {
              const c = corners[k]!;
              const [a, b] = d % 2 === 0 ? [c.x0, c.x1] : [c.z0, c.z1];
              return spans.every((sp) => sp.d !== d || !(a < sp.hi && sp.lo < b));
            });
          const first = pick(h, SALT.shapeTurn, 4);
          if (want === 'cross') {
            if ([0, 1, 2, 3].every(passes)) {
              shape = 'cross';
              solids = corners;
            }
          } else if (want === 'L') {
            for (let m = 0; m < 4; m++) {
              const k = (first + m) % 4;
              if (passes(k)) {
                shape = 'L';
                solids = [corners[k]!];
                break;
              }
            }
          } else {
            for (let m = 0; m < 4; m++) {
              const [c0, c1] = T_CORNERS[(first + m) % 4]!;
              if (passes(c0) && passes(c1)) {
                shape = 'T';
                solids = [corners[c0]!, corners[c1]!];
                break;
              }
            }
          }
        }
      }
    }
    hallShape[h] = shape;
    hallSolids[h] = solids;

    // Pillars: a Hall of shape rect, L, T or cross.
    if (shape === 'ring' || pick(h, SALT.pillars, 100) >= t.pillars.percent) return;
    const layout: PillarLayout = (['colonnade', 'grid'] as const)[byWeight(h, SALT.pillarLayout, [t.pillars.weights.colonnade, t.pillars.weights.grid])]!;
    const cx = hall.cx;
    const cz = hall.cz;
    const centres: Pt[] = [];
    if (layout === 'colonnade') {
      const alongX = hw >= hd;
      const [u0, u1, v0, v1, cu, cv] = alongX ? [r.x0, r.x1, r.z0, r.z1, cx, cz] : [r.z0, r.z1, r.x0, r.x1, cz, cx];
      const vS = evenDown(cv - COLONNADE_ROW);
      const vN = evenUp(cv + COLONNADE_ROW);
      let rows = 0;
      while (vS - 2 * rows - PILLAR_HALF >= v0 + WALL_GAP && vN + 2 * rows + PILLAR_HALF <= v1 - WALL_GAP) rows++;
      if (rows === 0) return;
      const o = 2 * pick(h, SALT.colonnadeRow, rows);
      const along: number[] = [];
      for (let c = ev(cu); c + PILLAR_HALF <= u1 - WALL_GAP; c += COLONNADE_STEP) if (c - PILLAR_HALF >= u0 + WALL_GAP) along.push(c);
      for (let c = ev(cu) - COLONNADE_STEP; c - PILLAR_HALF >= u0 + WALL_GAP; c -= COLONNADE_STEP) if (c + PILLAR_HALF <= u1 - WALL_GAP) along.push(c);
      for (const c of along) for (const v of [vS - o, vN + o]) centres.push(alongX ? { x: c, z: v } : { x: v, z: c });
    } else {
      const xs: number[] = [];
      const zs: number[] = [];
      for (let c = ev(cx) - GRID_STEP * Math.ceil((hw + GRID_STEP) / GRID_STEP); c <= r.x1; c += GRID_STEP) if (c - PILLAR_HALF >= r.x0 + WALL_GAP && c + PILLAR_HALF <= r.x1 - WALL_GAP) xs.push(c);
      for (let c = ev(cz) - GRID_STEP * Math.ceil((hd + GRID_STEP) / GRID_STEP); c <= r.z1; c += GRID_STEP) if (c - PILLAR_HALF >= r.z0 + WALL_GAP && c + PILLAR_HALF <= r.z1 - WALL_GAP) zs.push(c);
      for (const z of zs) for (const x of xs) centres.push({ x, z });
    }
    const keep: Rect = { x0: cx - MARKER_KEEP, z0: cz - MARKER_KEEP, x1: cx + MARKER_KEEP, z1: cz + MARKER_KEEP };
    const lanes: Rect[] = spans.map((sp) =>
      sp.d === 0 ? { x0: sp.lo, z0: r.z1 - DOOR_LANE, x1: sp.hi, z1: r.z1 }
      : sp.d === 2 ? { x0: sp.lo, z0: r.z0, x1: sp.hi, z1: r.z0 + DOOR_LANE }
      : sp.d === 1 ? { x0: r.x1 - DOOR_LANE, z0: sp.lo, x1: r.x1, z1: sp.hi }
      : { x0: r.x0, z0: sp.lo, x1: r.x0 + DOOR_LANE, z1: sp.hi });
    const kept = centres
      .map((c): Rect => ({ x0: c.x - PILLAR_HALF, z0: c.z - PILLAR_HALF, x1: c.x + PILLAR_HALF, z1: c.z + PILLAR_HALF }))
      .filter((q) => solids.every((so) => apartBy(q, so, WALL_GAP)) && apartBy(q, keep, 0) && lanes.every((ln) => apartBy(q, ln, 0)))
      .sort((a, b) => a.z0 - b.z0 || a.x0 - b.x0);
    if (kept.length >= PILLARS_MIN) {
      hallPillars[h] = kept;
      hallLayout[h] = layout;
    }
  });

  // 8. Patrol loops: each loop Passage closes the tree path between its Halls into a cycle.
  const treeEdges: Edge[][] = halls.map(() => []);
  plannedPassages.forEach((p) => {
    if (p.loop) return;
    treeEdges[p.a]!.push({ to: p.b, w: 1 });
    treeEdges[p.b]!.push({ to: p.a, w: 1 });
  });
  const cycles: { halls: number[]; order: number }[] = [];
  plannedPassages.forEach((p, order) => {
    if (!p.loop) return;
    const { pred: up } = dijkstra(treeEdges, [p.a]);
    const path: number[] = [];
    for (let h = p.b; h !== -1; h = up[h]!) path.push(h);
    path.reverse();
    if (path.some((h) => h === entrance || isInLine[h])) return;
    cycles.push({ halls: path, order });
  });
  cycles.sort((a, b) => b.halls.length - a.halls.length || a.order - b.order);
  const patrols: DelverPatrol[] = cycles.slice(0, t.patrols).map((c) => ({
    halls: c.halls,
    points: c.halls.map((h) => ({ x: halls[h]!.cx, y: hy(h), z: halls[h]!.cz })),
  }));

  // Stage 7f: an Uphill or a Spiral the Entrance, a Rest or the Treasure took for want of any other Hall (`plainOf`).
  for (let h = 0; h < n; h++) if ((kind[h] === 'Entrance' || kind[h] === 'Rest' || kind[h] === 'Treasure') && (featureOf[h]?.kind === 'uphill' || featureOf[h]?.kind === 'spiral' || featureOf[h]?.kind === 'room')) drops.fallback++;
  // Stage 7g: a drawn room whose Hall's kind it may not serve (the Stairs or the in-line Empty had no other Hall). It keeps the room: its doors already stand at the room's heights.
  for (let h = 0; h < n; h++) if (feat[h]?.kind === 'room' && featureOf[h]?.kind === 'room' && kind[h] !== 'Entrance' && kind[h] !== 'Rest' && kind[h] !== 'Treasure' && !roomKinds(h)!.includes(kind[h]!)) drops.kind++;

  // 9. Markers.
  const at = (h: number, dx = 0): MarkerPoint => ({ hall: h, x: halls[h]!.cx + dx, y: hy(h), z: halls[h]!.cz });
  // A Fight Hall whose gallery's Deck is long enough has its post on the Deck: at its centre along the wall, 2 m in from the wall.
  const postOf = (h: number): MarkerPoint => {
    const g = galleryOf[h];
    if (!g) return at(h);
    const alongX = g.side === 'n' || g.side === 's';
    if ((alongX ? g.deck.x1 - g.deck.x0 : g.deck.z1 - g.deck.z0) < DECK_POST) return at(h);
    const r = halls[h]!.rect;
    const mid = alongX ? (g.deck.x0 + g.deck.x1) / 2 : (g.deck.z0 + g.deck.z1) / 2;
    const x = alongX ? mid : g.side === 'e' ? r.x1 - 2 : r.x0 + 2;
    const z = alongX ? (g.side === 'n' ? r.z1 - 2 : r.z0 + 2) : mid;
    return { hall: h, x, y: g.y, z };
  };
  const ent = halls[entrance]!;
  const spawns: MarkerPoint[] = [
    { hall: entrance, x: ent.cx - SPAWN_OFFSET, y: hy(entrance), z: ent.cz - SPAWN_OFFSET },
    { hall: entrance, x: ent.cx + SPAWN_OFFSET, y: hy(entrance), z: ent.cz - SPAWN_OFFSET },
    { hall: entrance, x: ent.cx - SPAWN_OFFSET, y: hy(entrance), z: ent.cz + SPAWN_OFFSET },
    { hall: entrance, x: ent.cx + SPAWN_OFFSET, y: hy(entrance), z: ent.cz + SPAWN_OFFSET },
  ];
  const st = halls[stairs]!;
  /** A dais Hall's throne or altar point: `along` on its wall's line (even metre), `DAIS_DEPTH / 2` in from the wall, at the dais's `y`. */
  const onDais = (h: number, dm = 0): MarkerPoint | null => {
    const f = featureOf[h];
    if (f?.kind !== 'dais') return null;
    const r = halls[h]!.rect;
    const m = ((f.side === 'n' || f.side === 's' ? f.rect.x0 + f.rect.x1 : f.rect.z0 + f.rect.z1) / 2) + dm;
    return f.side === 'n' ? { hall: h, x: m, y: f.y, z: r.z1 - DAIS_DEPTH / 2 }
      : f.side === 's' ? { hall: h, x: m, y: f.y, z: r.z0 + DAIS_DEPTH / 2 }
      : f.side === 'e' ? { hall: h, x: r.x1 - DAIS_DEPTH / 2, y: f.y, z: m }
      : { hall: h, x: r.x0 + DAIS_DEPTH / 2, y: f.y, z: m };
  };
  const hallsOfKind = (k: DelverHallKind) => halls.flatMap((_, h) => (kind[h] === k ? [h] : []));
  const markers: DelverMarkers = {
    spawns,
    stairs: { hall: stairs, zone: { x0: st.cx - STAIRS_HALF, z0: st.cz - STAIRS_HALF, x1: st.cx + STAIRS_HALF, z1: st.cz + STAIRS_HALF }, y: hy(stairs) },
    fires: hallsOfKind('Rest').map((h) => at(h)),
    pedestals: hallsOfKind('Treasure').flatMap((h) => (onDais(h) ? [onDais(h, -PEDESTAL_GAP)!, onDais(h)!, onDais(h, PEDESTAL_GAP)!] : [at(h, -PEDESTAL_GAP), at(h), at(h, PEDESTAL_GAP)])),
    posts: hallsOfKind('Fight').map(postOf),
    patrols,
    ...(bossHall ? { boss: onDais(stairs) ?? at(stairs) } : {}),
  };

  const outHalls: DelverHall[] = halls.map((h, k) => {
    const d = doors[k]!;
    const ordered: Record<string, number> = {};
    for (const side of ['n', 'e', 's', 'w'] as const) if (d[side] !== undefined) ordered[side] = d[side];
    const gallery = galleryOf[k];
    const feature = featureOf[k];
    const lava = lavaOf[k];
    return {
      id: `hall${k}`, i: h.i, j: h.j, cells: h.cells, great: h.great, cx: h.cx, cz: h.cz, rect: h.rect, shape: hallShape[k]!, rects: floorRects(h.rect, hallSolids[k]!),
      solids: hallSolids[k]!, pillars: hallPillars[k]!, ...(hallLayout[k] ? { layout: hallLayout[k] } : {}), doors: ordered, kind: kind[k]!, depth: depth[k]!,
      level: level[k]!, y: hy(k), top: hy(k) + (gallery ? GALLERY_STOREY : feature?.kind === 'pit' ? feature.depth + HALL_STOREY : feature?.kind === 'spiral' ? 3 * LEVEL_RISE + HALL_STOREY : feature?.kind === 'room' ? feature.top : HALL_STOREY), ...(gallery ? { gallery } : {}),
      ...(feature ? { feature } : {}),
      ...(lava ? { lava } : {}),
    };
  });
  return { seed, floor, attempt, halls: outHalls, passages: plannedPassages, entrance, stairs, mainPath, inLine, markers, ...(gallery ? { gallery: true as const } : {}) };
}
