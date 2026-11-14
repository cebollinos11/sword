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

export type DelverHallKind = 'Entrance' | 'Stairs' | 'Boss' | 'Rest' | 'Treasure' | 'Fight' | 'Empty';

/** One Hall: a rectangle on a lattice cell, with a doorway on each side a Passage leaves from. */
export interface DelverHall {
  /** `hall<k>`, k its order of placement. */
  readonly id: string;
  /** Its lattice cell. */
  readonly i: number;
  readonly j: number;
  readonly cx: number;
  readonly cz: number;
  readonly rect: Rect;
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

/** A straight Passage between two Halls' facing side centres. */
export interface DelverPassage {
  /** `pass<n>`: the tree's Passages first (in growth order), then the loops. */
  readonly id: string;
  /** Hall indices: `a` is west of `b` (axis 'x') or south of it (axis 'z'). */
  readonly a: number;
  readonly b: number;
  readonly axis: 'x' | 'z';
  readonly rect: Rect;
  /** Centre to centre (m). */
  readonly length: number;
  /** Whether it is one of the extra Passages after the spanning tree. */
  readonly loop: boolean;
  /** Its door heights (m) at `a`'s and `b`'s end: the Hall's floor, or the Deck's through a gallery's wall. A sloped Passage has them one level apart. */
  readonly ya: number;
  readonly yb: number;
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
} as const;
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

interface WorkHall {
  i: number;
  j: number;
  cx: number;
  cz: number;
  rect: Rect;
  /** The Passage on each side n, e, s, w, or -1. */
  side: number[];
  /** The half sizes the gaps leave (`limX`, `limZ` of step 2). */
  limX: number;
  limZ: number;
}

/**
 * Floor `floor`'s layout for one attempt, with its levels (docs/plans/delver.md, Stage 6): galleries picked on the Halls with room (3b), the
 * Halls' levels walked down the tree (3c), loops that keep the doors at most a level apart (4), door heights on the Passages (5), each gallery
 * cut from its Hall's final rect (7) and the markers at their floors' heights (9). With `levels.max` and `galleryPercent` 0 nothing
 * of that is picked and the plan is Stage 5's plus the new fields (every `y` 0). If growth stalls before `t.rooms` Halls it returns the fewer Halls it has, kinds
 * assigned as far as possible; the judge refuses such a plan. `boss` (a Boss Floor, Stage 4) makes the Stairs Hall a Boss Hall, grown to the
 * most the gaps allow, and adds `markers.boss`; it decides nothing by a pick, and with it false the plan has no Boss key anywhere.
 */
export function planFloor(t: DelverFloorTuning, seed: number, floor: number, attempt: number, boss = false): FloorPlan {
  const s = attemptSeed(seed, floor, attempt);
  const pick = (slot: number, salt: number, count: number) => runPick(s, floor, slot, salt, count);
  const { cols, rows } = t;
  const w = t.passage;

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
  /** `from` and `d`: a tree Passage's parent Hall and the direction it leaves it by (the loops' are the Hall `h` and direction they were found from). */
  const passages: { a: number; b: number; axis: 'x' | 'z'; loop: boolean; far: boolean; from: number; d: number }[] = [];

  // 2. A Hall's size when placed in cell (i, j): its half sizes, kept small enough that neighbours leave `minPassage`. Then its Walls
  // are kept off the destination fields' dots: where a Wall (cx + hw, cz + hd and the other three) lies on an even metre it would run
  // through the 2 m cell centres, so that half size moves one metre (down if it stays within `halfSize`, else up within the gap limit).
  const offDots = (half: number, centre: number, lim: number): number => {
    if ((((centre + half) % 2) + 2) % 2 !== 0) return half;
    return half - 1 >= t.halfSize[0] ? half - 1 : half + 1 <= lim ? half + 1 : half;
  };
  const place = (c: number): number => {
    const i = c % cols;
    const j = Math.floor(c / cols);
    const gapsX = [...(i > 0 ? [gx[i - 1]!] : []), ...(i < cols - 1 ? [gx[i]!] : [])];
    const gapsZ = [...(j > 0 ? [gz[j - 1]!] : []), ...(j < rows - 1 ? [gz[j]!] : [])];
    const limX = Math.floor((Math.min(...gapsX) - t.minPassage) / 2);
    const limZ = Math.floor((Math.min(...gapsZ) - t.minPassage) / 2);
    const span = t.halfSize[1] - t.halfSize[0] + 1;
    const cx = X[i]!;
    const cz = Z[j]!;
    const hw = offDots(Math.min(t.halfSize[0] + pick(c, SALT.hw, span), limX), cx, limX);
    const hd = offDots(Math.min(t.halfSize[0] + pick(c, SALT.hd, span), limZ), cz, limZ);
    halls.push({ i, j, cx, cz, rect: { x0: cx - hw, z0: cz - hd, x1: cx + hw, z1: cz + hd }, side: [-1, -1, -1, -1], limX, limZ });
    occupied[c] = halls.length - 1;
    return halls.length - 1;
  };

  /** Joins `h` and `o` (h west or south of o along `d` = e or n, else the other way round) by a Passage. */
  const join = (h: number, o: number, d: number, loop: boolean, far: boolean) => {
    const forward = d === 0 || d === 1;
    const a = forward ? h : o;
    const b = forward ? o : h;
    const axis = d % 2 === 1 ? 'x' : 'z';
    const p = passages.length;
    passages.push({ a, b, axis, loop, far, from: h, d });
    // Facing sides: a's n (or e) and b's s (or w).
    halls[a]!.side[axis === 'x' ? 1 : 0] = p;
    halls[b]!.side[axis === 'x' ? 3 : 2] = p;
  };

  // 3. Growth: the spanning tree.
  place(pick(0, SALT.start, cells));
  for (let step = 1; halls.length < t.rooms; step++) {
    const near: { h: number; d: number; c1: number }[] = [];
    const far: { h: number; d: number; c1: number; c2: number }[] = [];
    for (let h = 0; h < halls.length; h++) {
      const hall = halls[h]!;
      for (let d = 0; d < 4; d++) {
        if (hall.side[d] !== -1) continue;
        const i1 = hall.i + DIRS[d]!.di;
        const j1 = hall.j + DIRS[d]!.dj;
        if (i1 < 0 || i1 >= cols || j1 < 0 || j1 >= rows) continue;
        const c1 = j1 * cols + i1;
        if (reserved[c1] || occupied[c1]! >= 0) continue;
        near.push({ h, d, c1 });
        const i2 = i1 + DIRS[d]!.di;
        const j2 = j1 + DIRS[d]!.dj;
        if (i2 < 0 || i2 >= cols || j2 < 0 || j2 >= rows) continue;
        const c2 = j2 * cols + i2;
        if (reserved[c2] || occupied[c2]! >= 0) continue;
        far.push({ h, d, c1, c2 });
      }
    }
    if (near.length === 0) break;
    const useFar = far.length > 0 && pick(step, SALT.far, 100) < t.farPercent;
    const list = useFar ? far : near;
    const chosen = list[pick(step, SALT.grow, list.length)]!;
    const target = useFar ? (chosen as (typeof far)[number]).c2 : chosen.c1;
    const o = place(target);
    if (useFar) reserved[chosen.c1] = true;
    join(chosen.h, o, chosen.d, false, useFar);
  }

  // 3b. Galleries: a Hall's side has room for one when the wall is deep enough across (`GALLERY_DEPTH` and the clear centre) and long enough
  // along (the Ramp, its approach and the shortest Deck); a side already holding a tree Passage needs the stairwell's room too (its Deck covers
  // the Passage's door with a metre each side). A seeded share of the Halls with room for one get one (side n, e, s, w order).
  const spanOf = (h: number, d: number) => {
    const r = halls[h]!.rect;
    return d % 2 === 0 ? { across: (r.z1 - r.z0) / 2, par: (r.x1 - r.x0) / 2 } : { across: (r.x1 - r.x0) / 2, par: (r.z1 - r.z0) / 2 };
  };
  const roomFor = (h: number, d: number, stairwell: boolean): boolean => {
    const { across, par } = spanOf(h, d);
    if (across < GALLERY_DEPTH + CENTRE_CLEAR || par < (GALLERY_RAMP + GALLERY_APPROACH + DECK_MIN) / 2) return false;
    return !stairwell || par - GALLERY_RAMP - GALLERY_APPROACH >= w / 2 + 1;
  };
  const gal: ({ d: number; end: 0 | 1 } | null)[] = halls.map(() => null);
  if (t.levels.galleryPercent > 0) {
    const fitting = halls.map((hall, h) => [0, 1, 2, 3].filter((d) => roomFor(h, d, hall.side[d] !== -1)));
    const withRoom = halls
      .map((_, h) => ({ h, key: pick(h, SALT.galleryOrder, 0x1_0000_0000) }))
      .filter((c) => fitting[c.h]!.length > 0)
      .sort((a, b) => a.key - b.key || a.h - b.h);
    const wanted = Math.floor((withRoom.length * t.levels.galleryPercent + 99) / 100);
    for (const { h } of withRoom.slice(0, wanted)) {
      const sides = fitting[h]!;
      gal[h] = { d: sides[pick(h, SALT.gallerySide, sides.length)]!, end: pick(h, SALT.galleryEnd, 2) as 0 | 1 };
    }
  }

  // 3c. Levels, on the tree in growth order: the first Hall's level is picked; each tree Passage then keeps its child's door at its parent's
  // door height, or (by `changePercent`) one level up or down. A gallery's wall is flat. The child's level is its door's, less one through its
  // own gallery's wall; when no option keeps it within 0 to `levels.max`, the gallery on this Passage's wall is dropped and the Passage is flat.
  const lmax = t.levels.max;
  const level = new Array<number>(halls.length).fill(0);
  if (lmax > 0) level[0] = pick(0, SALT.levelBase, lmax + 1);
  const doorLevel = (h: number, d: number): number => level[h]! + (gal[h]?.d === d ? 1 : 0);
  passages.forEach((p, n) => {
    const parent = p.from;
    const child = p.a === parent ? p.b : p.a;
    const dp = p.d;
    const dc = opposite(p.d);
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
    if (lmax > 0 && gal[parent]?.d !== dp && gal[child]?.d !== dc && pick(n, SALT.levelChange, 100) < t.levels.changePercent) {
      const up = pick(n, SALT.levelUp, 2) === 1 ? 1 : -1;
      options = [up, -up, 0];
    }
    if (!settle(options)) {
      if (gal[parent]?.d === dp) gal[parent] = null;
      else gal[child] = null;
      settle([0]);
    }
  });

  // 4. Loops: extra Passages between Halls at least 3 Passages apart in the tree, to the nearest Hall that way.
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
  const loopCandidates = () => {
    const out: { h: number; b: number; d: number; c1: number; far: boolean }[] = [];
    for (let h = 0; h < halls.length; h++) {
      const hall = halls[h]!;
      for (let d = 0; d < 2; d++) {
        if (hall.side[d] !== -1) continue;
        const i1 = hall.i + DIRS[d]!.di;
        const j1 = hall.j + DIRS[d]!.dj;
        if (i1 < 0 || i1 >= cols || j1 < 0 || j1 >= rows) continue;
        const c1 = j1 * cols + i1;
        if (reserved[c1]) continue;
        let b = occupied[c1]!;
        let far = false;
        if (b < 0) {
          const i2 = i1 + DIRS[d]!.di;
          const j2 = j1 + DIRS[d]!.dj;
          if (i2 < 0 || i2 >= cols || j2 < 0 || j2 >= rows) continue;
          const c2 = j2 * cols + i2;
          if (reserved[c2]) continue;
          b = occupied[c2]!;
          far = true;
        }
        if (b < 0 || halls[b]!.side[opposite(d)] !== -1) continue;
        if (passages.some((p) => (p.a === h && p.b === b) || (p.a === b && p.b === h))) continue;
        if (apart[h]![b]! < 3) continue;
        // Levels: the doors at most one level apart, equal through a gallery's wall, which then needs the stairwell's room.
        const dh = doorLevel(h, d);
        const db = doorLevel(b, opposite(d));
        const wallH = gal[h]?.d === d;
        const wallB = gal[b]?.d === opposite(d);
        if (Math.abs(dh - db) > 1 || ((wallH || wallB) && dh !== db)) continue;
        if ((wallH && !roomFor(h, d, true)) || (wallB && !roomFor(b, opposite(d), true))) continue;
        out.push({ h, b, d, c1, far });
      }
    }
    return out;
  };
  const loopCount = t.loops[0] + pick(0, SALT.loopCount, t.loops[1] - t.loops[0] + 1);
  for (let n = 0; n < loopCount; n++) {
    const valid = loopCandidates();
    if (valid.length === 0) break;
    const chosen = valid[pick(n, SALT.loop, valid.length)]!;
    if (chosen.far) reserved[chosen.c1] = true;
    join(chosen.h, chosen.b, chosen.d, true, chosen.far);
  }

  // 5. A Passage's geometry: straight between the facing side centres.
  const half = w / 2;
  const doors: Record<Side, number>[] = halls.map(() => ({}) as Record<Side, number>);
  const passageRect = (p: { a: number; b: number; axis: 'x' | 'z' }): Rect => {
    const ha = halls[p.a]!;
    const hb = halls[p.b]!;
    return p.axis === 'x'
      ? { x0: ha.rect.x1, z0: ha.cz - half, x1: hb.rect.x0, z1: ha.cz + half }
      : { x0: ha.cx - half, z0: ha.rect.z1, x1: ha.cx + half, z1: hb.rect.z0 };
  };
  const plannedPassages: DelverPassage[] = passages.map((p, n) => {
    const ha = halls[p.a]!;
    const hb = halls[p.b]!;
    // The sides it leaves a (n or e) and b (s or w) by, and its door heights there (a gallery's wall: the Deck's).
    const sa = p.axis === 'x' ? 1 : 0;
    const sb = p.axis === 'x' ? 3 : 2;
    const ya = doorLevel(p.a, sa) * LEVEL_RISE;
    const yb = doorLevel(p.b, sb) * LEVEL_RISE;
    // A Hall's doors list only the Passages attached at its floor; a gallery's wall is cut by the Passage's own doorway.
    if (gal[p.a]?.d !== sa) doors[p.a]![SIDES[sa]!] = w;
    if (gal[p.b]?.d !== sb) doors[p.b]![SIDES[sb]!] = w;
    const rect = passageRect(p);
    return { id: `pass${n}`, a: p.a, b: p.b, axis: p.axis, rect, length: Math.abs(ha.cx - hb.cx) + Math.abs(ha.cz - hb.cz), loop: p.loop, ya, yb };
  });

  const n = halls.length;
  const adj: Edge[][] = halls.map(() => []);
  for (const p of plannedPassages) {
    adj[p.a]!.push({ to: p.b, w: p.length });
    adj[p.b]!.push({ to: p.a, w: p.length });
  }
  const joined = (a: number, b: number) => plannedPassages.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));

  // 7. Kinds. The Entrance is a leaf (a Hall with one Passage) when there is one.
  const passageCount = halls.map((_, h) => halls[h]!.side.filter((p) => p !== -1).length);
  const leaves = halls.flatMap((_, h) => (passageCount[h] === 1 ? [h] : []));
  const entranceCandidates = leaves.length > 0 ? leaves : halls.map((_, h) => h);
  const entrance = entranceCandidates[pick(0, SALT.entrance, entranceCandidates.length)]!;

  // 6. Depth: the walk from the Entrance.
  const { dist: depth, pred } = dijkstra(adj, [entrance]);
  let stairs = entrance;
  for (let h = 0; h < n; h++) if (depth[h]! > depth[stairs]!) stairs = h;
  const mainPath: number[] = [];
  for (let h = stairs; h !== -1; h = pred[h]!) mainPath.push(h);
  mainPath.reverse();
  const onMain = new Array<boolean>(n).fill(false);
  for (const h of mainPath) onMain[h] = true;

  const kind = new Array<DelverHallKind | null>(n).fill(null);
  kind[entrance] = 'Entrance';
  // A Boss Floor's Stairs Hall is the Boss Hall, grown to the most its gaps allow (the Passages touching it re-rected by step 5's formula).
  const bossHall = boss && stairs !== entrance;
  if (stairs !== entrance) kind[stairs] = bossHall ? 'Boss' : 'Stairs';
  if (bossHall) {
    const bh = halls[stairs]!;
    const hw = offDots(Math.min(t.halfSize[1], bh.limX), bh.cx, bh.limX);
    const hd = offDots(Math.min(t.halfSize[1], bh.limZ), bh.cz, bh.limZ);
    bh.rect = { x0: bh.cx - hw, z0: bh.cz - hd, x1: bh.cx + hw, z1: bh.cz + hd };
    passages.forEach((p, n) => {
      if (p.a === stairs || p.b === stairs) plannedPassages[n] = { ...plannedPassages[n]!, rect: passageRect(p) };
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
    galleryOf[h] = { side, end: g.end, y: level[h]! * LEVEL_RISE + LEVEL_RISE, deck: rect(d0, d1), ramp: rect(r0, r1), up, high: hall.side[g.d] !== -1 };
  });

  // In line: straight on from the Entrance, through each Hall by the side opposite the one entered.
  const inLine: number[] = [];
  const seen = new Array<boolean>(n).fill(false);
  seen[entrance] = true;
  for (let d = 0; d < 4; d++) {
    let from = entrance;
    let dir = d;
    for (;;) {
      const p = halls[from]!.side[dir]!;
      if (p === -1) break;
      const pass = plannedPassages[p]!;
      const next = pass.a === from ? pass.b : pass.a;
      if (seen[next]) break;
      seen[next] = true;
      inLine.push(next);
      from = next;
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

  // Treasure: off the main path, furthest by walking from it.
  const fromMain = dijkstra(adj, mainPath).dist;
  for (let k = 0; k < t.treasures; k++) {
    const pool = halls.map((_, h) => h).filter((h) => !onMain[h] && kind[h] === null);
    if (pool.length === 0) break;
    const far = Math.max(...pool.map((h) => fromMain[h]!));
    const tied = pool.filter((h) => fromMain[h] === far);
    kind[tied[pick(k, SALT.treasure, tied.length)]!] = 'Treasure';
  }

  // Fight / Empty: the Halls left. Those in line are Empty; of the others, a share by a seeded order.
  const left = halls.map((_, h) => h).filter((h) => kind[h] === null);
  const leftInLine = left.filter((h) => isInLine[h]);
  const free = left
    .filter((h) => !isInLine[h])
    .map((h) => ({ h, key: pick(h, SALT.order, 0x1_0000_0000) }))
    .sort((a, b) => a.key - b.key || a.h - b.h);
  const empties = Math.max(0, Math.floor((left.length * t.emptyPercent) / 100) - leftInLine.length);
  for (const h of leftInLine) kind[h] = 'Empty';
  free.forEach((f, k) => {
    kind[f.h] = k < empties ? 'Empty' : 'Fight';
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
      id: `hall${k}`, i: h.i, j: h.j, cx: h.cx, cz: h.cz, rect: h.rect, doors: ordered, kind: kind[k]!, depth: depth[k]!,
      level: level[k]!, y: hy(k), top: hy(k) + (gallery ? GALLERY_STOREY : HALL_STOREY), ...(gallery ? { gallery } : {}),
    };
  });
  return { seed, floor, attempt, halls: outHalls, passages: plannedPassages, entrance, stairs, mainPath, inLine, markers };
}
