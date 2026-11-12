/**
 * Soldiers on several levels (docs/plans/battle-objectives.md, Stage 4a; ADR 0022): a Soldier stands on a Walk Surface of its Battle map,
 * stored beside its x and z (`CrowdState.surface`), and its height is that surface's at its place. It crosses from one Walk Surface onto
 * another only as a walk or drop Link of the navmesh does, and never jumps:
 *  - **walking**: past its surface's edge, onto the highest ground there no more than `levels.stepUp` above or below its feet;
 *  - **dropping**: else, off an open ledge onto the highest ground there at most `levels.drop` below its feet;
 *  - a Wall standing across the step at its height (from `stepUp` over its feet to `height`) stops either, as no Link goes through one.
 * Anything else (higher ground, a drop too deep, no ground at all) stops it. Where levels overlap (a bridge over a tunnel) a Soldier on the
 * tunnel's floor stays on it: higher ground than a step is never walked onto, so it is not "the highest ground at x, z".
 *
 * Every function is pure, a function of the map (`ArenaGeometry`) and Tuning Data, with ties broken by index, so every peer moves its
 * Soldiers alike. The Crowd, the Squads' anchors and the destination fields all move by `trace`, so the fields only ever lead a Squad
 * where its Soldiers can walk.
 */
import type { ArenaGeometry, LevelsTuning } from '../tuning';
import { deadly, onSurface, surfaceHeight, surfacesAt } from './arena';

/** A walk is traced in steps of at most this (m): short enough that no Walk Surface of a Battle map is stepped over. */
const SUB = 0.25;
/** Heights this close (m) are equal: a shared edge's two sides, summed in another order. */
const EPS = 1e-9;

/** Segments a–b and c–d cross (or touch), seen from above (as the navmesh's walk Links test them). */
function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(cx, cz, dx, dz, ax, az);
  const d2 = o(cx, cz, dx, dz, bx, bz);
  const d3 = o(ax, az, bx, bz, cx, cz);
  const d4 = o(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0) || d1 === 0 || d2 === 0) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0) || d3 === 0 || d4 === 0);
}

/** The wall lookup's cell (m). */
const WALL_CELL = 8;

/** An arena's Walls binned by the cells their bounding boxes touch (static, built once per arena): `walled` then looks only at the Walls near a step. */
interface WallGrid {
  readonly x0: number;
  readonly z0: number;
  readonly side: number;
  readonly cells: readonly (readonly number[])[];
}
const wallGrids = new WeakMap<ArenaGeometry, WallGrid>();

/** The wall lookup's cell along one axis for a coordinate `v` from the grid's origin `o`, kept inside the grid. */
const wallCell = (g: WallGrid, v: number, o: number): number => Math.min(g.side - 1, Math.max(0, Math.floor((v - o) / WALL_CELL)));

function wallGridOf(arena: ArenaGeometry): WallGrid {
  let g = wallGrids.get(arena);
  if (g) return g;
  const xs = arena.walls.flatMap((w) => [w.a.x, w.b.x]);
  const zs = arena.walls.flatMap((w) => [w.a.z, w.b.z]);
  const x0 = Math.min(0, ...xs) - 1;
  const z0 = Math.min(0, ...zs) - 1;
  const side = Math.max(1, Math.ceil((Math.max(0, ...xs) - x0 + 1) / WALL_CELL), Math.ceil((Math.max(0, ...zs) - z0 + 1) / WALL_CELL));
  const cells: number[][] = Array.from({ length: side * side }, () => []);
  const at = (v: number, o: number) => wallCell({ x0, z0, side, cells }, v, o);
  arena.walls.forEach((w, k) => {
    for (let r = at(Math.min(w.a.z, w.b.z), z0); r <= at(Math.max(w.a.z, w.b.z), z0); r++)
      for (let c = at(Math.min(w.a.x, w.b.x), x0); c <= at(Math.max(w.a.x, w.b.x), x0); c++) cells[r * side + c]!.push(k);
  });
  wallGrids.set(arena, (g = { x0, z0, side, cells }));
  return g;
}

/** Whether a Wall of `arena` stands across the step p → q for a Soldier with its feet at `y` (from `stepUp` over them to `height`). */
export function walled(arena: ArenaGeometry, lv: LevelsTuning, px: number, pz: number, qx: number, qz: number, y: number): boolean {
  const g = wallGridOf(arena);
  const c0 = wallCell(g, Math.min(px, qx), g.x0);
  const c1 = wallCell(g, Math.max(px, qx), g.x0);
  const r0 = wallCell(g, Math.min(pz, qz), g.z0);
  const r1 = wallCell(g, Math.max(pz, qz), g.z0);
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      for (const k of g.cells[r * g.side + c]!) {
        const w = arena.walls[k]!;
        if (w.bottom >= y + lv.height || w.top <= y + lv.stepUp) continue;
        if (Math.max(px, qx) < Math.min(w.a.x, w.b.x) || Math.min(px, qx) > Math.max(w.a.x, w.b.x) || Math.max(pz, qz) < Math.min(w.a.z, w.b.z) || Math.min(pz, qz) > Math.max(w.a.z, w.b.z)) continue;
        if (segmentsCross(px, pz, qx, qz, w.a.x, w.a.z, w.b.x, w.b.z)) return true;
      }
  return false;
}

/**
 * The Walk Surface a Soldier on `from` with its feet at `y` reaches stepping from p, on `from`, to q, off it: walking, the highest at q
 * within `stepUp` of its feet; else, with `drops`, dropping, the highest at q no more than `drop` below. -1 when it cannot (no such ground,
 * or a Wall across the step).
 */
function stepOff(arena: ArenaGeometry, lv: LevelsTuning, y: number, px: number, pz: number, qx: number, qz: number, drops: boolean): number {
  let walk = -1;
  let walkY = -Infinity;
  let low = -1;
  let lowY = -Infinity;
  for (const t of surfacesAt(arena, qx, qz)) {
    const h = surfaceHeight(arena, t, qx, qz);
    if (h > y + lv.stepUp + EPS) continue;
    if (h >= y - lv.stepUp - EPS) {
      if (h > walkY) [walk, walkY] = [t, h];
    } else if (y - h <= lv.drop + EPS && h > lowY) [low, lowY] = [t, h];
  }
  const to = walk >= 0 ? walk : drops ? low : -1;
  return to >= 0 && !walled(arena, lv, px, pz, qx, qz, y) ? to : -1;
}

/**
 * The Walk Surface a Soldier standing on `s` at (x0, z0) ends on walking straight to (x1, z1), stepping across surfaces as the walk rule
 * says (with `drops`, dropping off open ledges too), or -1 when anything on the way stops it. A walk that ends on its own surface stays on it
 * (a Walk Surface is convex, so the whole line lies on it).
 */
export function trace(arena: ArenaGeometry, lv: LevelsTuning, s: number, x0: number, z0: number, x1: number, z1: number, drops: boolean): number {
  if (onSurface(arena, s, x1, z1)) return s;
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / SUB));
  let cur = s;
  let px = x0;
  let pz = z0;
  let y = surfaceHeight(arena, s, x0, z0);
  for (let k = 1; k <= n; k++) {
    const qx = k === n ? x1 : x0 + ((x1 - x0) * k) / n;
    const qz = k === n ? z1 : z0 + ((z1 - z0) * k) / n;
    if (!onSurface(arena, cur, qx, qz)) {
      cur = stepOff(arena, lv, y, px, pz, qx, qz, drops);
      if (cur < 0) return -1;
    }
    y = surfaceHeight(arena, cur, qx, qz);
    px = qx;
    pz = qz;
  }
  return cur;
}

/**
 * A Soldier's step on a map of several levels: from (x0, z0) on Walk Surface `s` toward (x1, z1), walking, and with `drops` dropping too
 * (`trace`). Where the way is stopped it slides along whichever axis still goes (x, then z, the same for both Teams: a half turn swaps
 * neither axis), and else stands. Where it ends into `out`; the Walk Surface it stands on.
 */
export function walkTo(arena: ArenaGeometry, lv: LevelsTuning, s: number, x0: number, z0: number, x1: number, z1: number, out: [number, number], drops = true): number {
  // The whole step, then its x alone, then its z alone.
  for (let k = 0; k < 3; k++) {
    const x = k === 2 ? x0 : x1;
    const z = k === 1 ? z0 : z1;
    if (x === x0 && z === z0) continue;
    const to = trace(arena, lv, s, x0, z0, x, z, drops);
    if (to < 0) continue;
    out[0] = x;
    out[1] = z;
    return to;
  }
  out[0] = x0;
  out[1] = z0;
  return s;
}

/** Whether Walk Surfaces `a` and `b` are on the same level at (x, z): their heights there within a step. */
export const sameLevel = (arena: ArenaGeometry, lv: LevelsTuning, a: number, b: number, x: number, z: number): boolean => a === b || Math.abs(surfaceHeight(arena, a, x, z) - surfaceHeight(arena, b, x, z)) <= lv.stepUp + EPS;

/**
 * The Walk Surface a body put down at (x, z) at about height `y` stands on: the highest there no more than a step above `y`, else the lowest
 * above it; -1 where there is none. With `y` Infinity, the highest. `noRoofs`: leaving out every roof (`WalkSurface.roof`), as for a
 * Soldier put down, an Objective or a Base.
 */
export function groundNear(arena: ArenaGeometry, lv: LevelsTuning, x: number, z: number, y: number, noRoofs = false): number {
  let best = -1;
  let bestY = -Infinity;
  let above = -1;
  let aboveY = Infinity;
  for (const t of surfacesAt(arena, x, z)) {
    if (noRoofs && arena.walk[t]!.roof) continue;
    const h = surfaceHeight(arena, t, x, z);
    if (h <= y + lv.stepUp + EPS) {
      if (h > bestY) [best, bestY] = [t, h];
    } else if (h < aboveY) [above, aboveY] = [t, h];
  }
  return best >= 0 ? best : above;
}

/** A Walk Surface's edges from above, each with its outward unit normal. */
export function edgesOf(arena: ArenaGeometry, i: number): { px: number; pz: number; qx: number; qz: number; length: number; nx: number; nz: number }[] {
  const pts = arena.walk[i]!.points;
  let area = 0;
  pts.forEach((p, k) => {
    const q = pts[(k + 1) % pts.length]!;
    area += p.x * q.z - q.x * p.z;
  });
  const w = Math.sign(area);
  return pts.map((p, k) => {
    const q = pts[(k + 1) % pts.length]!;
    const length = Math.hypot(q.x - p.x, q.z - p.z);
    const dx = (q.x - p.x) / length;
    const dz = (q.z - p.z) / length;
    return { px: p.x, pz: p.z, qx: q.x, qz: q.z, length, nx: w * dz, nz: -w * dx };
  });
}

/** How often (m) along a Walk Surface's edge a crossing is tried, and how far (m) in from it and out past it. */
export const EDGE_PROBE = 0.25;
export const EDGE_REACH = 0.05;

/**
 * Where a Soldier can step off each Walk Surface's edges: probed every EDGE_PROBE along every edge, from EDGE_REACH inside to EDGE_REACH
 * past it, by `trace` (with `drops`). Calls `each(from, to, x, z)` for every probe that crosses onto another surface, and `none(from, x, z)`
 * for every one that cannot step off at all (an edge of its level: a ledge, the foot of higher ground, a Wall, the field's edge); each with
 * how far along which of its surface's edges (`edgesOf`) the probe stands.
 */
export function probeEdges(arena: ArenaGeometry, lv: LevelsTuning, drops: boolean, each: (from: number, to: number, x: number, z: number, along: number, edge: number) => void, none: (from: number, x: number, z: number, along: number, edge: number) => void): void {
  arena.walk.forEach((_, i) => {
    edgesOf(arena, i).forEach((e, k) => {
      for (let u = EDGE_PROBE / 2; u < e.length; u += EDGE_PROBE) {
        const ox = e.px + ((e.qx - e.px) * u) / e.length;
        const oz = e.pz + ((e.qz - e.pz) * u) / e.length;
        const to = trace(arena, lv, i, ox - e.nx * EDGE_REACH, oz - e.nz * EDGE_REACH, ox + e.nx * EDGE_REACH, oz + e.nz * EDGE_REACH, drops);
        if (to >= 0 && to !== i) each(i, to, ox, oz, u, k);
        else if (to < 0) none(i, ox, oz, u, k);
      }
    });
  });
}

/** Which Walk Surfaces the walk check (`walkCheck`) finds joined to the first by the Soldiers' walk rule. */
export interface WalkReach {
  /** The surface it starts from: the first that is not deadly, or -1 when every one is. */
  readonly first: number;
  /** Per Walk Surface, 1 where it can be walked (and dropped) to from `first`. */
  readonly there: Uint8Array;
  /** Per Walk Surface, 1 where it can walk (and drop) back to `first`. */
  readonly home: Uint8Array;
}

/**
 * The walk check's reach (`walkCheck`): every edge of every Walk Surface probed once (`probeEdges`, with drops), the crossings joined into
 * the ways out of and back into each surface, and both walked from the first surface that is not deadly. `each` and `none` see every probe
 * as `probeEdges` gives it (the Map Editor's overlays read them; the check does not need them).
 */
export function walkReach(arena: ArenaGeometry, lv: LevelsTuning, each?: (from: number, to: number, x: number, z: number, along: number, edge: number) => void, none?: (from: number, x: number, z: number, along: number, edge: number) => void): WalkReach {
  const n = arena.walk.length;
  const first = arena.walk.findIndex((w) => !deadly(w) && !w.roof);
  const out = arena.walk.map(() => new Set<number>());
  const back = arena.walk.map(() => new Set<number>());
  probeEdges(arena, lv, true, (from, to, x, z, along, edge) => {
    out[from]!.add(to);
    back[to]!.add(from);
    each?.(from, to, x, z, along, edge);
  }, none ?? (() => {}));
  const reach = (links: readonly Set<number>[]): Uint8Array => {
    const seen = new Uint8Array(n);
    if (first < 0) return seen;
    seen[first] = 1;
    const todo = [first];
    while (todo.length) for (const t of links[todo.pop()!]!) if (!seen[t]) (seen[t] = 1), todo.push(t);
    return seen;
  };
  return { first, there: reach(out), home: reach(back) };
}

/**
 * The build-time walk check (docs/plans/battle-objectives.md, Stage 4a; like ADR 0014's judge): whether every Walk Surface of a Battle map
 * can be walked (and dropped) to from every other by the Soldiers' walk rule, so no Squad is ever sent where it cannot go. Null when it can;
 * else what fails, naming the first Walk Surface that cannot be reached from the first one, or cannot get back to it. Pass the map's
 * `walkReach` when it is already worked out.
 */
export function walkCheck(arena: ArenaGeometry, lv: LevelsTuning, reach?: WalkReach): string | null {
  const n = arena.walk.length;
  if (n === 0) return 'it has no Walk Surface';
  if (arena.walk.every((w) => deadly(w))) return 'it has no walkable Walk Surface';
  const { first, there, home } = reach ?? walkReach(arena, lv);
  for (let i = 0; i < n; i++) {
    // Deadly ground (a lava river, far below every ledge) is never walked to or from: Soldiers do not drop that far. A roof Soldiers need
    // never reach (only a Jump gets onto it).
    if (deadly(arena.walk[i]!) || arena.walk[i]!.roof) continue;
    if (!there[i]) return `Walk Surface ${arena.walk[i]!.id} cannot be walked to from ${arena.walk[first]!.id}`;
    if (!home[i]) return `Walk Surface ${arena.walk[i]!.id} cannot walk back to ${arena.walk[first]!.id}`;
  }
  return null;
}
