/**
 * Arenas as Tuning Data (data/arenas/<name>.json): the geometry the
 * simulation stands Fighters on (ADR 0006). Exported from Blender by
 * art/build_library.py (or written by hand for the flat `circle`), and hashed
 * with the rest of Tuning Data, since it decides where bodies walk and fall.
 *
 * - Walk Surfaces: planar convex polygons (floors and ramps) Fighters stand on.
 *   Seen from above, polygons that share an edge are neighbours (the navmesh).
 * - Walls: vertical segments with a bottom and a top height, that Fighter
 *   capsules cannot pass where their heights overlap.
 * - Spawns: where each team's k-th Fighter starts a Duel.
 * - An optional `radius`: a circular boundary every capsule stays inside (the flat circle).
 */
import { array, finiteNumber, nonEmptyString, positiveNumber, record, TuningDataError } from './validate';

export interface ArenaPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A floor or ramp: a planar, convex, non-vertical polygon (at least three corners, in order around it). */
export interface WalkSurface {
  readonly id: string;
  readonly points: readonly ArenaPoint[];
}

/** A vertical wall segment from `a` to `b` (ground plane), solid between heights `bottom` and `top`. */
export interface WallSegment {
  readonly id: string;
  readonly a: { readonly x: number; readonly z: number };
  readonly b: { readonly x: number; readonly z: number };
  readonly bottom: number;
  readonly top: number;
}

/** Where team `team`'s Fighter number `slot` (0-based, in Fighter order) starts each Duel. */
export interface SpawnPoint {
  readonly team: number;
  readonly slot: number;
  readonly position: ArenaPoint;
  /** Yaw in radians; 0 faces +z. */
  readonly facing: number;
}

export interface ArenaGeometry {
  readonly name: string;
  /** A circular boundary (m, around the origin) every Fighter capsule stays inside, if any. */
  readonly radius?: number;
  readonly walk: readonly WalkSurface[];
  readonly walls: readonly WallSegment[];
  readonly spawns: readonly SpawnPoint[];
}

/** Which Arena each kind of play uses. */
export interface ArenaSelection {
  /** The Arena every Match is fought in. */
  readonly match: string;
  /** The Arena of the Editor sandbox (and the default of `createInitialState`). */
  readonly editor: string;
}

/** `[x, y, z]` as the files write it, or `{ x, y, z }` as parsed (so parsed Tuning Data parses again). */
const triple = (v: unknown, where: string): ArenaPoint => {
  if (!Array.isArray(v)) {
    const o = record(v, where);
    return { x: finiteNumber(o, 'x', where), y: finiteNumber(o, 'y', where), z: finiteNumber(o, 'z', where) };
  }
  const a = array(v, where);
  if (a.length !== 3 || !a.every((n) => typeof n === 'number' && Number.isFinite(n))) throw new TuningDataError(`${where} must be [x, y, z], got ${JSON.stringify(v)}`);
  return { x: a[0] as number, y: a[1] as number, z: a[2] as number };
};

const pair = (v: unknown, where: string): { x: number; z: number } => {
  if (!Array.isArray(v)) {
    const o = record(v, where);
    return { x: finiteNumber(o, 'x', where), z: finiteNumber(o, 'z', where) };
  }
  const a = array(v, where);
  if (a.length !== 2 || !a.every((n) => typeof n === 'number' && Number.isFinite(n))) throw new TuningDataError(`${where} must be [x, z], got ${JSON.stringify(v)}`);
  return { x: a[0] as number, z: a[1] as number };
};

/** Twice the signed area of the polygon seen from above (x, z). */
function signedArea2(points: readonly ArenaPoint[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    s += p.x * q.z - q.x * p.z;
  }
  return s;
}

/** Throws unless the polygon is convex and non-degenerate from above, and planar (within 1 cm). */
function checkSurface(s: WalkSurface, where: string): void {
  const pts = s.points;
  if (pts.length < 3) throw new TuningDataError(`${where}.points must have at least 3 corners`);
  const area = signedArea2(pts);
  if (Math.abs(area) < 1e-6) throw new TuningDataError(`${where} is degenerate (no area from above)`);
  const sign = Math.sign(area);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const c = pts[(i + 2) % pts.length]!;
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    if (cross * sign < -1e-9) throw new TuningDataError(`${where} is not convex (at corner ${(i + 1) % pts.length})`);
  }
  const plane = surfacePlane(s);
  for (const p of pts) {
    if (Math.abs(plane.a * p.x + plane.c * p.z + plane.d - p.y) > 0.01) throw new TuningDataError(`${where} is not planar`);
  }
}

/** The surface's plane as y = a·x + c·z + d (through its first three corners' best fit: Newell's normal). */
export function surfacePlane(s: WalkSurface): { readonly a: number; readonly c: number; readonly d: number } {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const pts = s.points;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    nx += (p.y - q.y) * (p.z + q.z);
    ny += (p.z - q.z) * (p.x + q.x);
    nz += (p.x - q.x) * (p.y + q.y);
    cx += p.x;
    cy += p.y;
    cz += p.z;
  }
  const n = pts.length;
  if (Math.abs(ny) < 1e-9) throw new TuningDataError(`arena surface ${s.id} is vertical`);
  // n·(p - centroid) = 0  →  y = cy - (nx (x - cx) + nz (z - cz)) / ny
  const a = -nx / ny;
  const c = -nz / ny;
  return { a, c, d: cy / n - a * (cx / n) - c * (cz / n) };
}

/** Validate one raw Arena file. Throws TuningDataError naming the path. */
export function parseArena(raw: unknown, where: string): ArenaGeometry {
  const r = record(raw, where);
  const name = nonEmptyString(r, 'name', where);
  const ids = new Set<string>();
  const walk = array(r.walk, `${where}.walk`).map((w, i): WalkSurface => {
    const at = `${where}.walk[${i}]`;
    const o = record(w, at);
    const id = nonEmptyString(o, 'id', at);
    if (ids.has(id)) throw new TuningDataError(`${at}: duplicate id "${id}"`);
    ids.add(id);
    const surface = { id, points: array(o.points, `${at}.points`).map((p, k) => triple(p, `${at}.points[${k}]`)) };
    checkSurface(surface, at);
    return surface;
  });
  if (walk.length === 0) throw new TuningDataError(`${where}.walk must hold at least one Walk Surface`);
  const walls = array(r.walls ?? [], `${where}.walls`).map((w, i): WallSegment => {
    const at = `${where}.walls[${i}]`;
    const o = record(w, at);
    const bottom = finiteNumber(o, 'bottom', at);
    const top = finiteNumber(o, 'top', at);
    if (top <= bottom) throw new TuningDataError(`${at}.top must be above its bottom`);
    return { id: nonEmptyString(o, 'id', at), a: pair(o.a, `${at}.a`), b: pair(o.b, `${at}.b`), bottom, top };
  });
  const spawns = array(r.spawns ?? [], `${where}.spawns`).map((s, i): SpawnPoint => {
    const at = `${where}.spawns[${i}]`;
    const o = record(s, at);
    const team = finiteNumber(o, 'team', at);
    const slot = finiteNumber(o, 'slot', at);
    if (team !== 0 && team !== 1) throw new TuningDataError(`${at}.team must be 0 or 1`);
    if (!Number.isInteger(slot) || slot < 0) throw new TuningDataError(`${at}.slot must be an integer >= 0`);
    return { team, slot, position: triple(o.position, `${at}.position`), facing: finiteNumber(o, 'facing', at) };
  });
  const arena: ArenaGeometry = { name, walk, walls, spawns };
  return r.radius === undefined ? arena : { ...arena, radius: positiveNumber(r, 'radius', where) };
}

export function parseArenaSelection(raw: unknown, arenas: Readonly<Record<string, ArenaGeometry>>): ArenaSelection {
  const r = record(raw, 'arena');
  const pick = (key: 'match' | 'editor') => {
    const name = nonEmptyString(r, key, 'arena');
    if (!arenas[name]) throw new TuningDataError(`arena.${key}: no Arena "${name}" (have: ${Object.keys(arenas).join(', ')})`);
    return name;
  };
  return { match: pick('match'), editor: pick('editor') };
}
