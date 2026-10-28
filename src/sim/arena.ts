/**
 * The Arena's geometry inside the simulation (ADR 0006): which Walk Surface is
 * under a point and how high it is, and the Walls Fighter capsules cannot pass.
 * Pure functions of Tuning Data. The per-Arena lookup grid is a cache derived
 * from Tuning Data only (never state), so it cannot change an outcome.
 */
import { surfacePlane, type ArenaGeometry, type TuningData, type WalkSurface, type WallSegment } from '../tuning';
import { generatedArena, isArenaName } from './arenaGen/named';
import type { Vec2 } from './state';
import type { Vec3 } from './vec';

/** A Walk Surface ready for queries: its plane (y = a·x + c·z + d) and bounds from above. */
interface IndexedSurface {
  readonly surface: WalkSurface;
  readonly a: number;
  readonly c: number;
  readonly d: number;
  /** +1 or -1: the winding from above, so "inside" is the same side of every edge. */
  readonly winding: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Per edge, how far (scaled by its length) a point may lie outside it and still count as inside: EDGE_EPS × its length. */
  readonly slack: readonly number[];
}

interface ArenaIndex {
  readonly surfaces: readonly IndexedSurface[];
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  /** Per grid cell, the indices of the surfaces whose bounds overlap it, ascending. */
  readonly cells: readonly (readonly number[])[];
  /** The last point looked up and the surfaces there: a Tick asks for the same point several times. A cache of a pure function, so it cannot change an outcome. */
  last: { readonly x: number; readonly z: number; readonly at: readonly number[] } | null;
  /** Per Wall (in file order), its bounds from above: minX, maxX, minZ, maxZ. */
  readonly wallBounds: Float64Array;
  /** Per body radius, per grid cell, the Walls (ascending) that come within two radii of it: built on first use. */
  readonly wallCells: Map<number, readonly (readonly number[])[]>;
}

/** Grid cell size (m) of the surface lookup. */
const CELL = 1;
/** A point this close outside an edge still counts as on the surface (shared edges never leave a gap). */
const EDGE_EPS = 1e-6;

const indexes = new WeakMap<ArenaGeometry, ArenaIndex>();

function buildIndex(arena: ArenaGeometry): ArenaIndex {
  const surfaces = arena.walk.map((surface): IndexedSurface => {
    const { a, c, d } = surfacePlane(surface);
    const xs = surface.points.map((p) => p.x);
    const zs = surface.points.map((p) => p.z);
    let area = 0;
    surface.points.forEach((p, i) => {
      const q = surface.points[(i + 1) % surface.points.length]!;
      area += p.x * q.z - q.x * p.z;
    });
    const slack = surface.points.map((p, i) => {
      const q = surface.points[(i + 1) % surface.points.length]!;
      return EDGE_EPS * Math.hypot(q.x - p.x, q.z - p.z);
    });
    return { surface, a, c, d, winding: Math.sign(area), minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), slack };
  });
  const x0 = Math.floor(Math.min(...surfaces.map((s) => s.minX)));
  const z0 = Math.floor(Math.min(...surfaces.map((s) => s.minZ)));
  const cols = Math.ceil((Math.max(...surfaces.map((s) => s.maxX)) - x0) / CELL) + 1;
  const rows = Math.ceil((Math.max(...surfaces.map((s) => s.maxZ)) - z0) / CELL) + 1;
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  surfaces.forEach((s, i) => {
    const c0 = Math.floor((s.minX - x0) / CELL);
    const c1 = Math.floor((s.maxX - x0) / CELL);
    const r0 = Math.floor((s.minZ - z0) / CELL);
    const r1 = Math.floor((s.maxZ - z0) / CELL);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * cols + c]!.push(i);
  });
  const wallBounds = new Float64Array(arena.walls.length * 4);
  arena.walls.forEach((w, i) => wallBounds.set([Math.min(w.a.x, w.b.x), Math.max(w.a.x, w.b.x), Math.min(w.a.z, w.b.z), Math.max(w.a.z, w.b.z)], i * 4));
  return { surfaces, x0, z0, cols, rows, cells, last: null, wallBounds, wallCells: new Map() };
}

function indexOf(arena: ArenaGeometry): ArenaIndex {
  let index = indexes.get(arena);
  if (!index) {
    index = buildIndex(arena);
    indexes.set(arena, index);
  }
  return index;
}

/**
 * The Arena named `name` in Tuning Data, or the Generated Arena a `gen:<kit>:<seed>` name builds from Tuning Data's Kit
 * (built once and reused, `generatedArena`: a Rematch's next Random Map, Stage 6). Throws on an unknown name.
 */
export function arenaOf(tuning: Pick<TuningData, 'arenas'>, name: string): ArenaGeometry {
  const arena = tuning.arenas[name] ?? ('kits' in tuning && isArenaName(tuning as TuningData, name) ? generatedArena(tuning as TuningData, name)?.arena : undefined);
  if (!arena) throw new Error(`Unknown Arena "${name}" (have: ${Object.keys(tuning.arenas).join(', ')})`);
  return arena;
}

function inside(s: IndexedSurface, x: number, z: number): boolean {
  if (x < s.minX - EDGE_EPS || x > s.maxX + EDGE_EPS || z < s.minZ - EDGE_EPS || z > s.maxZ + EDGE_EPS) return false;
  const pts = s.surface.points;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    const ex = q.x - p.x;
    const ez = q.z - p.z;
    const cross = (ex * (z - p.z) - ez * (x - p.x)) * s.winding;
    if (cross < -s.slack[i]!) return false;
  }
  return true;
}

/** Surfaces (by index into `arena.walk`) whose polygon, seen from above, contains (x, z), ascending. */
export function surfacesAt(arena: ArenaGeometry, x: number, z: number): readonly number[] {
  const index = indexOf(arena);
  if (index.last && index.last.x === x && index.last.z === z) return index.last.at;
  const c = Math.floor((x - index.x0) / CELL);
  const r = Math.floor((z - index.z0) / CELL);
  const at = c < 0 || r < 0 || c >= index.cols || r >= index.rows ? [] : index.cells[r * index.cols + c]!.filter((i) => inside(index.surfaces[i]!, x, z));
  index.last = { x, z, at };
  return at;
}

/** The height of Walk Surface `i` above (x, z) (its plane, wherever the point is). */
export function surfaceHeight(arena: ArenaGeometry, i: number, x: number, z: number): number {
  const s = indexOf(arena).surfaces[i]!;
  return s.a * x + s.c * z + s.d;
}

/** The ground a body at (x, z) can stand on: the highest Walk Surface there no higher than `maxY`. */
export interface Ground {
  /** Index into `arena.walk`. */
  readonly surface: number;
  readonly y: number;
}

/**
 * The highest Walk Surface under (x, z) at or below `maxY`, or null when there
 * is none (off the Arena, or only higher ground). Ties go to the lower index.
 */
export function groundBelow(arena: ArenaGeometry, x: number, z: number, maxY: number): Ground | null {
  let best: Ground | null = null;
  for (const i of surfacesAt(arena, x, z)) {
    const y = surfaceHeight(arena, i, x, z);
    if (y > maxY + 1e-9) continue;
    if (!best || y > best.y) best = { surface: i, y };
  }
  return best;
}

/** What kills a body standing at `y` at (x, z): the ground under its feet is a `lava`, `water` or `abyss` Walk Surface; null if none. */
export function deadlyGround(arena: ArenaGeometry, x: number, z: number, y: number): DeadlyGround | null {
  const g = groundBelow(arena, x, z, y + 1e-6);
  if (!g || g.y < y - 1e-6) return null;
  return deadly(arena.walk[g.surface]!);
}

/** How a deadly Walk Surface kills whoever comes to stand on it: the Death's cause (an Abyss is a Death by Fall). */
export type DeadlyGround = 'Lava' | 'Water' | 'Fall';

/** What a Walk Surface kills whoever stands on with, if anything. */
export const deadly = (s: WalkSurface): DeadlyGround | null => (s.lava ? 'Lava' : s.water ? 'Water' : s.abyss ? 'Fall' : null);

/**
 * Whether a body standing at `y` at (x, z) would be inside solid ground: some
 * Walk Surface there lies above a step (`fall.stepUp`) over its feet but below
 * its top (`fighter.height`). Higher ground than a step is a wall even where no
 * Wall was drawn; ground well overhead (a gallery) is not.
 */
export function blockedAt(arena: ArenaGeometry, x: number, z: number, y: number, tuning: TuningData): boolean {
  for (const i of surfacesAt(arena, x, z)) {
    const h = surfaceHeight(arena, i, x, z);
    if (h > y + tuning.fall.stepUp + 1e-9 && h < y + tuning.fighter.height) return true;
  }
  return false;
}

/**
 * The Walk Surface a body rising from feet at `fromY` to `toY` at (x, z) bumps its head on: the lowest one there
 * between its last top and its new top (`fighter.height` above the feet) and more than a step (`fall.stepUp`)
 * above its new feet. A Walk Surface is solid from below. Null when nothing is overhead.
 */
export function ceilingAbove(arena: ArenaGeometry, x: number, z: number, fromY: number, toY: number, tuning: TuningData): number | null {
  const { height } = tuning.fighter;
  let best: number | null = null;
  for (const i of surfacesAt(arena, x, z)) {
    const h = surfaceHeight(arena, i, x, z);
    if (h < fromY + height - 1e-9 || h > toY + height + 1e-9 || h <= toY + tuning.fall.stepUp + 1e-9) continue;
    if (best === null || h < best) best = h;
  }
  return best;
}

/**
 * Where the segment a→b first crosses a Wall (its vertical face, between `bottom` and `top`): `t` along the
 * segment (0 at a) and the point, or null. Ties go to the Wall earlier in the file.
 */
export function wallCrossing(a: Vec3, b: Vec3, arena: ArenaGeometry): { t: number; point: Vec3 } | null {
  let best: { t: number; point: Vec3 } | null = null;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const w of arena.walls) {
    const ex = w.b.x - w.a.x;
    const ez = w.b.z - w.a.z;
    const denom = dx * ez - dz * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((w.a.x - a.x) * ez - (w.a.z - a.z) * ex) / denom;
    const u = ((w.a.x - a.x) * dz - (w.a.z - a.z) * dx) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    const y = a.y + (b.y - a.y) * t;
    if (y < w.bottom || y > w.top) continue;
    if (!best || t < best.t) best = { t, point: { x: a.x + dx * t, y, z: a.z + dz * t } };
  }
  return best;
}

/** Whether a Wall's solid height range overlaps a capsule standing at `y` (from `stepUp` above its feet to its top). */
const wallOverlaps = (w: WallSegment, y: number, stepUp: number, height: number): boolean => w.bottom < y + height && w.top > y + stepUp;

/** The Walls (ascending) that come within two radii (`radius`) of grid cell (c, r) of `index`. */
function wallsNear(index: ArenaIndex, radius: number, c: number, r: number): readonly number[] {
  let cells = index.wallCells.get(radius);
  if (!cells) {
    const near = 2 * radius + 1e-9;
    const b = index.wallBounds;
    const all: number[][] = Array.from({ length: index.cols * index.rows }, () => []);
    for (let k = 0; k < b.length / 4; k++) {
      const c0 = Math.max(0, Math.floor((b[k * 4]! - near - index.x0) / CELL));
      const c1 = Math.min(index.cols - 1, Math.floor((b[k * 4 + 1]! + near - index.x0) / CELL));
      const r0 = Math.max(0, Math.floor((b[k * 4 + 2]! - near - index.z0) / CELL));
      const r1 = Math.min(index.rows - 1, Math.floor((b[k * 4 + 3]! + near - index.z0) / CELL));
      for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) all[rr * index.cols + cc]!.push(k);
    }
    cells = all;
    index.wallCells.set(radius, cells);
  }
  return cells[r * index.cols + c]!;
}

/**
 * Push a circle (a Fighter capsule from above) of `radius` at `p` out of
 * every Wall it overlaps at its height, in file order. Deterministic.
 *
 * Only the Walls within two radii of its grid cell are looked at, while the pushes move it less than a radius
 * altogether (so no other Wall comes within reach); otherwise, or off the grid, every Wall is. Either way the
 * result is the same as pushing it out of every Wall in turn.
 */
export function pushOutOfWalls(p: Vec2, y: number, arena: ArenaGeometry, tuning: TuningData): Vec2 {
  const index = indexOf(arena);
  const c = Math.floor((p.x - index.x0) / CELL);
  const r = Math.floor((p.z - index.z0) / CELL);
  if (c >= 0 && r >= 0 && c < index.cols && r < index.rows) {
    const near = pushOut(p, y, arena, tuning, wallsNear(index, tuning.fighter.radius, c, r));
    if (near.moved < tuning.fighter.radius) return near.at;
  }
  return pushOut(p, y, arena, tuning, null).at;
}

/** Push the circle at `p` out of the Walls `walls` (indices, ascending; null: all of them) in turn: where it ends, and how far it was pushed altogether. */
function pushOut(p: Vec2, y: number, arena: ArenaGeometry, tuning: TuningData, walls: readonly number[] | null): { at: Vec2; moved: number } {
  const { radius, height } = tuning.fighter;
  const bounds = indexOf(arena).wallBounds;
  // Beyond a Wall's bounds by more than the radius, the circle cannot touch it.
  const far = radius + 1e-9;
  let { x, z } = p;
  let moved = 0;
  const count = walls ? walls.length : arena.walls.length;
  for (let n = 0; n < count; n++) {
    const k = walls ? walls[n]! : n;
    const w = arena.walls[k]!;
    if (x < bounds[k * 4]! - far || x > bounds[k * 4 + 1]! + far || z < bounds[k * 4 + 2]! - far || z > bounds[k * 4 + 3]! + far) continue;
    if (!wallOverlaps(w, y, tuning.fall.stepUp, height)) continue;
    const ex = w.b.x - w.a.x;
    const ez = w.b.z - w.a.z;
    const len2 = ex * ex + ez * ez;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - w.a.x) * ex + (z - w.a.z) * ez) / len2));
    const qx = w.a.x + ex * t;
    const qz = w.a.z + ez * t;
    let dx = x - qx;
    let dz = z - qz;
    const d = Math.hypot(dx, dz);
    if (d >= radius) continue;
    if (d < 1e-12) {
      // Exactly on the wall: out along its left-hand normal.
      const l = Math.sqrt(len2) || 1;
      dx = -ez / l;
      dz = ex / l;
    } else {
      dx /= d;
      dz /= d;
    }
    moved += radius - d;
    x = qx + dx * radius;
    z = qz + dz * radius;
  }
  return { at: { x, z }, moved };
}

/** Whether (x, z) is inside (or on the edge of) the convex polygon `zone`, from above. */
export function insideZone(zone: readonly { readonly x: number; readonly z: number }[], x: number, z: number): boolean {
  let sign = 0;
  for (let i = 0; i < zone.length; i++) {
    const a = zone[i]!;
    const b = zone[(i + 1) % zone.length]!;
    const cross = Math.sign((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x));
    if (cross === 0) continue;
    if (sign !== 0 && cross !== sign) return false;
    sign = cross;
  }
  return true;
}
