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
import type { DelverFloorTuning } from '../../tuning/delver';
import type { Doors, Rect, Side } from '../../mapEditor/source';
import { runPick } from '../dungeon';

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
  /** A stairwell: a Passage leaves through `side` at the Deck's height. */
  readonly high: boolean;
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
}

/** `runPick` salts, so each choice made for one slot is independent of the others. */
export const SALT = {
  gapX: 1, gapZ: 2, start: 3, grow: 4, far: 5, hw: 6, hd: 7, loopCount: 8, loop: 9, entrance: 10, rests: 11, treasure: 12, order: 13, reroll: 14,
  galleryOrder: 30, gallerySide: 31, galleryEnd: 32, levelBase: 33, levelChange: 34, levelUp: 35,
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
/** A plain Hall's roof over its floor (m). */
export const HALL_STOREY = 4;
/** A gallery Hall's roof over its floor (m): the Deck stands `GALLERY_STOREY - LEVEL_RISE` = 4 m under it, more than the tallest Fighter. */
export const GALLERY_STOREY = 6;
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

/** Whether `p` and `q` share interior (touching edges do not). */
const overlaps = (p: Rect, q: Rect): boolean => p.x0 < q.x1 && q.x0 < p.x1 && p.z0 < q.z1 && q.z0 < p.z1;

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
 * picked on the Halls with room (3b), the Halls' levels walked down the tree (3c), loops that keep the doors at most a level apart (4), pieces and door
 * heights on the Passages (5), each gallery cut from its Hall's final rect (7) and the markers at their floors' heights (9). With `levels.max` and
 * `galleryPercent` 0 nothing of that is picked and the plan is Stage 5's plus the new fields (every `y` 0); with `turnPercent` 0 and `great.count` [0, 0] every
 * decision, candidate and rect is Stage 6's and every Passage is straight. If growth stalls before `t.rooms` Halls it returns the fewer Halls it has, kinds
 * assigned as far as possible; the judge refuses such a plan. `boss` (a Boss Floor, Stage 4) makes the Stairs Hall a Boss Hall (grown to the
 * most the gaps allow, unless great halls are wanted: then Hall 0 is a great hall and the Boss Hall), and adds `markers.boss`; with it false the plan has no Boss key anywhere.
 */
export function planFloor(t: DelverFloorTuning, seed: number, floor: number, attempt: number, boss = false): FloorPlan {
  const s = attemptSeed(seed, floor, attempt);
  const pick = (slot: number, salt: number, count: number) => runPick(s, floor, slot, salt, count);
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
  const reachHall = (h: number): Rect => (halls[h]!.great ? halls[h]!.rect : reachCell(halls[h]!.cells[0]!));
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
  const start = pick(0, SALT.start, cells);
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
  const gal: ({ d: number; end: 0 | 1 } | null)[] = halls.map(() => null);
  if (t.levels.galleryPercent > 0) {
    const fitting = halls.map((hall, h) => (hall.great ? [] : [0, 1, 2, 3].filter((d) => roomFor(h, d, hasOn(h, d)))));
    const withRoom = halls
      .map((_, h) => ({ h, key: pick(h, SALT.galleryOrder, 0x1_0000_0000) }))
      .filter((c) => fitting[c.h]!.length > 0)
      .sort((a, b) => a.key - b.key || a.h - b.h);
    const wantedGal = Math.floor((withRoom.length * t.levels.galleryPercent + 99) / 100);
    for (const { h } of withRoom.slice(0, wantedGal)) {
      const sides = fitting[h]!;
      gal[h] = { d: sides[pick(h, SALT.gallerySide, sides.length)]!, end: pick(h, SALT.galleryEnd, 2) as 0 | 1 };
    }
  }

  // 3c. Levels, on the tree in growth order: the first Hall's level is picked; each tree Passage then keeps its child's door at its parent's
  // door height, or (by `changePercent`) one level up or down. A gallery's wall is flat, and so is a great hall's long side. The child's level is its
  // door's, less one through its own gallery's wall; when no option keeps it within 0 to `levels.max`, the gallery on this Passage's wall is dropped
  // and the Passage is flat.
  const lmax = t.levels.max;
  const level = new Array<number>(halls.length).fill(0);
  if (lmax > 0) level[0] = pick(0, SALT.levelBase, lmax + 1);
  const doorLevel = (h: number, d: number): number => level[h]! + (gal[h]?.d === d ? 1 : 0);
  passages.forEach((p, n) => {
    const parent = p.from;
    const child = p.to;
    const dp = halls[parent]!.slots[p.fs]!.d;
    const dc = halls[child]!.slots[p.ts]!.d;
    const settle = (options: readonly number[]): boolean => {
      for (const delta of options) {
        const lc = doorLevel(parent, dp) + delta - (gal[child]?.d === dc ? 1 : 0);
        if (lc >= 0 && lc <= lmax) {
          level[child] = lc;
          return true;
        }
      }
      return false;
    };
    let options = [0];
    const longSide = halls[parent]!.slots[p.fs]!.long || halls[child]!.slots[p.ts]!.long;
    if (lmax > 0 && !longSide && gal[parent]?.d !== dp && gal[child]?.d !== dc && pick(n, SALT.levelChange, 100) < t.levels.changePercent) {
      const up = pick(n, SALT.levelUp, 2) === 1 ? 1 : -1;
      options = [up, -up, 0];
    }
    if (!settle(options)) {
      if (gal[parent]?.d === dp) gal[parent] = null;
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
    // Levels: the doors at most one level apart, equal through a gallery's wall or a great hall's long side, a wall then needing the stairwell's room.
    const d = halls[h]!.slots[s]!.d;
    const db = halls[b]!.slots[bs]!.d;
    const lh = doorLevel(h, d);
    const lb = doorLevel(b, db);
    const wallH = gal[h]?.d === d;
    const wallB = gal[b]?.d === db;
    const forced = wallH || wallB || halls[h]!.slots[s]!.long || halls[b]!.slots[bs]!.long;
    if (Math.abs(lh - lb) > 1 || (forced && lh !== lb)) return false;
    if ((wallH && !roomFor(h, d, true)) || (wallB && !roomFor(b, db, true))) return false;
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
    if (!halls[p.a]!.slots[p.sa]!.long && gal[p.a]?.d !== da) doors[p.a]![SIDES[da]!] = w;
    if (!halls[p.b]!.slots[p.sb]!.long && gal[p.b]?.d !== db) doors[p.b]![SIDES[db]!] = w;
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
  let entrance: number;
  let stairs: number;
  if (startGreat) {
    const from0 = dijkstra(adj, [0]).dist;
    const pool = flats.length > 0 ? flats : notGreat;
    entrance = 0;
    for (const h of pool) if (entrance === 0 || from0[h]! > from0[entrance]!) entrance = h;
    stairs = 0;
  } else {
    const pool = flats.length > 0 ? flats : notGreat.length > 0 ? notGreat : leaves.length > 0 ? leaves : halls.map((_, h) => h);
    entrance = pool[pick(0, SALT.entrance, pool.length)]!;
    stairs = entrance;
  }

  // 6. Depth: the walk from the Entrance.
  const { dist: depth, pred } = dijkstra(adj, [entrance]);
  if (!startGreat) for (let h = 0; h < n; h++) if (depth[h]! > depth[stairs]!) stairs = h;
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
  if (bossHall && grows) {
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
    galleryOf[h] = { side, end: g.end, y: level[h]! * LEVEL_RISE + LEVEL_RISE, deck: rect(d0, d1), ramp: rect(r0, r1), up, high: hasOn(h, g.d) };
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
    const first = best(onPath.length > 0 ? [...onPath].sort((a, b) => a - b) : all, (h) => Math.abs(2 * depth[h]! - D));
    if (first >= 0) {
      kind[first] = 'Rest';
      rests.push(first);
      if (restCount >= 2) {
        const pool = halls.map((_, h) => h).filter((h) => kind[h] === null && !joined(h, first));
        const second = best(pool, (h) => Math.abs(4 * depth[h]! - 3 * D));
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
    const open = halls.map((_, h) => h).filter((h) => !onMain[h] && kind[h] === null);
    const pool = open.some((h) => halls[h]!.great) ? open.filter((h) => halls[h]!.great) : open;
    if (pool.length === 0) break;
    const far = Math.max(...pool.map((h) => fromMain[h]!));
    const tied = pool.filter((h) => fromMain[h] === far);
    kind[tied[pick(k, SALT.treasure, tied.length)]!] = 'Treasure';
  }

  // Fight / Empty: the Halls left. Those in line are Empty; of the others, a share by a seeded order, a great hall never one of them (it is a Fight).
  const left = halls.map((_, h) => h).filter((h) => kind[h] === null);
  const leftInLine = left.filter((h) => isInLine[h]);
  const free = left
    .filter((h) => !isInLine[h])
    .map((h) => ({ h, key: pick(h, SALT.order, 0x1_0000_0000) }))
    .sort((a, b) => a.key - b.key || a.h - b.h);
  const empties = Math.max(0, Math.floor((left.length * t.emptyPercent) / 100) - leftInLine.length);
  for (const h of leftInLine) kind[h] = 'Empty';
  let emptied = 0;
  for (const f of free) {
    if (!halls[f.h]!.great && emptied < empties) {
      kind[f.h] = 'Empty';
      emptied++;
    } else {
      kind[f.h] = 'Fight';
    }
  }

  // 7c. Shapes and pillars (docs/plans/delver.md, Stage 7b), after the kinds so the patrol points and markers read the final centres. A Hall with a
  // gallery is neither shaped nor pillared. A shape is cut out of the Hall's rect by solids: notches in its corners (L, T, cross) or a core (ring).
  const hallShape = new Array<HallShape>(n).fill('rect');
  const hallSolids: Rect[][] = halls.map(() => []);
  const hallPillars: Rect[][] = halls.map(() => []);
  const hallLayout = new Array<PillarLayout | undefined>(n).fill(undefined);
  /** A pick of the index of `weights` by cumulative weight, in list order. */
  const byWeight = (h: number, salt: number, weights: readonly number[]): number => {
    let r = pick(h, salt, weights.reduce((a, b) => a + b, 0));
    for (let k = 0; k < weights.length; k++) {
      if (r < weights[k]!) return k;
      r -= weights[k]!;
    }
    return weights.length - 1;
  };
  // A corner's two sides (n 0, e 1, s 2, w 3) in corner order NE, SE, SW, NW; a T's side (n, e, s, w) notches the two corners that share it.
  const CORNER_SIDES = [[0, 1], [2, 1], [2, 3], [0, 3]] as const;
  const T_CORNERS = [[0, 3], [0, 1], [1, 2], [2, 3]] as const;
  const evenDown = (v: number): number => 2 * Math.floor(v / 2);
  const evenUp = (v: number): number => 2 * Math.ceil(v / 2);
  halls.forEach((hall, h) => {
    if (galleryOf[h]) return;
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
      .filter((q) => solids.every((so) => apartBy(q, so, WALL_GAP)) && !overlaps(q, keep) && lanes.every((ln) => !overlaps(q, ln)))
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
  const hallsOfKind = (k: DelverHallKind) => halls.flatMap((_, h) => (kind[h] === k ? [h] : []));
  const markers: DelverMarkers = {
    spawns,
    stairs: { hall: stairs, zone: { x0: st.cx - STAIRS_HALF, z0: st.cz - STAIRS_HALF, x1: st.cx + STAIRS_HALF, z1: st.cz + STAIRS_HALF }, y: hy(stairs) },
    fires: hallsOfKind('Rest').map((h) => at(h)),
    pedestals: hallsOfKind('Treasure').flatMap((h) => [at(h, -PEDESTAL_GAP), at(h), at(h, PEDESTAL_GAP)]),
    posts: hallsOfKind('Fight').map(postOf),
    patrols,
    ...(bossHall ? { boss: at(stairs) } : {}),
  };

  const outHalls: DelverHall[] = halls.map((h, k) => {
    const d = doors[k]!;
    const ordered: Record<string, number> = {};
    for (const side of ['n', 'e', 's', 'w'] as const) if (d[side] !== undefined) ordered[side] = d[side];
    const gallery = galleryOf[k];
    return {
      id: `hall${k}`, i: h.i, j: h.j, cells: h.cells, great: h.great, cx: h.cx, cz: h.cz, rect: h.rect, shape: hallShape[k]!, rects: floorRects(h.rect, hallSolids[k]!),
      solids: hallSolids[k]!, pillars: hallPillars[k]!, ...(hallLayout[k] ? { layout: hallLayout[k] } : {}), doors: ordered, kind: kind[k]!, depth: depth[k]!,
      level: level[k]!, y: hy(k), top: hy(k) + (gallery ? GALLERY_STOREY : HALL_STOREY), ...(gallery ? { gallery } : {}),
    };
  });
  return { seed, floor, attempt, halls: outHalls, passages: plannedPassages, entrance, stairs, mainPath, inLine, markers };
}
