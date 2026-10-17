/**
 * The navmesh (ADR 0006): the Arena's Walk Surfaces are its polygons, so it
 * needs no data of its own. Surfaces whose edges lie along each other (from
 * above) at heights within a step are joined by a walk Link through the shared
 * stretch. An open ledge (no Wall at its height, lower ground beyond) gets a
 * one-way drop Link to the surface below, if the drop costs no more than
 * DROP_DAMAGE_LIMIT of fall damage; its cost counts that damage.
 *
 * `findPath` runs A* over Links from the start polygon to the goal's, and
 * `steer` pulls a string through the Links' portals (a funnel) for the next
 * corner to walk to. Both are pure functions of Tuning Data and their
 * arguments, with every tie broken by index, so the AI Controller (which runs
 * on both peers, ADR 0005) paths identically everywhere. Built once per Arena
 * and cached, like the Arena's lookup grid.
 */
import type { ArenaGeometry, TuningData } from '../tuning';
import { groundBelow, surfaceHeight, surfacesAt } from './arena';
import type { Vec2 } from './state';

/** A way from one Walk Surface into another, through `left`..`right` (as seen walking through it) on the first's edge. */
export interface NavLink {
  readonly from: number;
  readonly to: number;
  readonly left: Vec2;
  readonly right: Vec2;
  /** The unit normal out of `from` through the portal. */
  readonly normal: Vec2;
  /** Height dropped through it (m); 0 for a walk Link. */
  readonly drop: number;
}

export interface NavMesh {
  /** Every Link, in build order (its index is its id). */
  readonly links: readonly NavLink[];
  /** Per Walk Surface, the ids of the Links out of it, ascending. */
  readonly out: readonly (readonly number[])[];
}

/** The deepest drop a path takes: one that deals at most this much fall damage. */
export const DROP_DAMAGE_LIMIT = 35;
/** Path cost (m) of each point of fall damage a drop deals. */
const DAMAGE_COST = 0.5;
/** Portals keep this far (m, beyond a Fighter's radius) from their ends, where Walls and pillars stand. */
const PORTAL_CLEARANCE = 0.3;
/** Ledges are probed this often (m) along an edge, and this far (m, beyond a Fighter's radius) out from it. */
const PROBE_STEP = 0.5;
const PROBE_OUT = 0.35;
/**
 * A path crosses each portal square to it for this far (m, beyond a Fighter's radius) on both
 * sides, so it never runs along a surface's edge (where Walls and rails stand) between two portals.
 */
const CROSSING = 0.15;
/** A corner closer than this (m) has been reached: steer for the next one. */
const REACHED = 0.3;

const cache = new WeakMap<ArenaGeometry, WeakMap<TuningData, NavMesh>>();

/** The navmesh of `arena` (cached per Arena and Tuning Data). */
export function navMesh(arena: ArenaGeometry, tuning: TuningData): NavMesh {
  let byTuning = cache.get(arena);
  if (!byTuning) {
    byTuning = new WeakMap();
    cache.set(arena, byTuning);
  }
  let mesh = byTuning.get(tuning);
  if (!mesh) {
    mesh = buildNavMesh(arena, tuning);
    byTuning.set(tuning, mesh);
  }
  return mesh;
}

interface Edge {
  readonly p: Vec2;
  readonly q: Vec2;
  readonly length: number;
  /** Unit vector p → q, and the unit normal out of the surface. */
  readonly d: Vec2;
  readonly n: Vec2;
}

function edgesOf(arena: ArenaGeometry, i: number): Edge[] {
  const pts = arena.walk[i]!.points;
  let area = 0;
  pts.forEach((p, k) => {
    const q = pts[(k + 1) % pts.length]!;
    area += p.x * q.z - q.x * p.z;
  });
  const w = Math.sign(area);
  return pts.map((p, k) => {
    const q = pts[(k + 1) % pts.length]!;
    const ex = q.x - p.x;
    const ez = q.z - p.z;
    const length = Math.hypot(ex, ez);
    const d = { x: ex / length, z: ez / length };
    // The interior lies at w·(-ez, ex); out is the other way.
    return { p: { x: p.x, z: p.z }, q: { x: q.x, z: q.z }, length, d, n: { x: w * d.z, z: -w * d.x } };
  });
}

const at = (e: Edge, u: number): Vec2 => ({ x: e.p.x + e.d.x * u, z: e.p.z + e.d.z * u });

/** Segments a–b and c–d cross (or touch), seen from above. */
function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0) || d1 === 0 || d2 === 0) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0) || d3 === 0 || d4 === 0);
}

/** A Wall stands across a → b for a body standing at `y` (the same height test as body collision). */
function walled(arena: ArenaGeometry, tuning: TuningData, a: Vec2, b: Vec2, y: number): boolean {
  return arena.walls.some((w) => w.bottom < y + tuning.fighter.height && w.top > y + tuning.fall.stepUp && segmentsCross(a, b, w.a, w.b));
}

/** The portal on edge `e` from u0 to u1, kept clear of its ends, as seen walking out through it (left, right); null if too narrow. */
function portal(e: Edge, u0: number, u1: number, tuning: TuningData): { left: Vec2; right: Vec2 } | null {
  const keep = Math.min(tuning.fighter.radius + PORTAL_CLEARANCE, (u1 - u0) / 2 - 0.1);
  if (keep < tuning.fighter.radius * 0.5) return null;
  const a = at(e, u0 + keep);
  const b = at(e, u1 - keep);
  // Facing out along n, the left-hand side is n turned anticlockwise: (-n.z, n.x).
  const leftOfB = (b.x - a.x) * -e.n.z + (b.z - a.z) * e.n.x > 0;
  return leftOfB ? { left: b, right: a } : { left: a, right: b };
}

function buildNavMesh(arena: ArenaGeometry, tuning: TuningData): NavMesh {
  const count = arena.walk.length;
  const edges = arena.walk.map((_, i) => edgesOf(arena, i));
  const links: NavLink[] = [];
  const { stepUp, safeHeight, damagePerMetre } = tuning.fall;
  const maxDrop = safeHeight + DROP_DAMAGE_LIMIT / damagePerMetre;
  const r = tuning.fighter.radius;
  const tol = 1e-3;

  for (let i = 0; i < count; i++) {
    for (const e of edges[i]!) {
      // Walk Links: another surface's edge along this one, at the same height (within a step) all along the shared stretch.
      for (let j = 0; j < count; j++) {
        if (j === i) continue;
        for (const f of edges[j]!) {
          const off = (v: Vec2) => (v.x - e.p.x) * e.d.z - (v.z - e.p.z) * e.d.x;
          if (Math.abs(off(f.p)) > tol || Math.abs(off(f.q)) > tol) continue;
          const along = (v: Vec2) => (v.x - e.p.x) * e.d.x + (v.z - e.p.z) * e.d.z;
          const u0 = Math.max(0, Math.min(along(f.p), along(f.q)));
          const u1 = Math.min(e.length, Math.max(along(f.p), along(f.q)));
          if (u1 - u0 < 2 * r) continue;
          const ends = [at(e, u0), at(e, u1)];
          if (ends.some((v) => Math.abs(surfaceHeight(arena, i, v.x, v.z) - surfaceHeight(arena, j, v.x, v.z)) > stepUp)) continue;
          const mid = at(e, (u0 + u1) / 2);
          const y = surfaceHeight(arena, i, mid.x, mid.z);
          const inside = { x: mid.x - e.n.x * 0.05, z: mid.z - e.n.z * 0.05 };
          const beyond = { x: mid.x + e.n.x * (r + PROBE_OUT), z: mid.z + e.n.z * (r + PROBE_OUT) };
          if (walled(arena, tuning, inside, beyond, y)) continue;
          const p = portal(e, u0, u1, tuning);
          if (p) links.push({ from: i, to: j, ...p, normal: e.n, drop: 0 });
        }
      }
      // Drop Links: probe out over the edge; where there is no ground within a step, but lower ground not too far down, it is a ledge.
      const runs: { to: number; u0: number; u1: number; drop: number }[] = [];
      for (let u = PROBE_STEP / 2; u < e.length; u += PROBE_STEP) {
        const o = at(e, u);
        const y = surfaceHeight(arena, i, o.x, o.z);
        const probe = { x: o.x + e.n.x * (r + PROBE_OUT), z: o.z + e.n.z * (r + PROBE_OUT) };
        const level = surfacesAt(arena, probe.x, probe.z).some((k) => Math.abs(surfaceHeight(arena, k, probe.x, probe.z) - y) <= stepUp);
        const below = level ? null : groundBelow(arena, probe.x, probe.z, y - stepUp);
        const ok = below && y - below.y <= maxDrop && !walled(arena, tuning, { x: o.x - e.n.x * 0.05, z: o.z - e.n.z * 0.05 }, probe, y);
        const last = runs[runs.length - 1];
        if (!ok) continue;
        const drop = y - below.y;
        if (last && last.to === below.surface && last.u1 >= u - PROBE_STEP / 2 - 1e-9) {
          last.u1 = Math.min(e.length, u + PROBE_STEP / 2);
          last.drop = Math.max(last.drop, drop);
        } else runs.push({ to: below.surface, u0: Math.max(0, u - PROBE_STEP / 2), u1: Math.min(e.length, u + PROBE_STEP / 2), drop });
      }
      for (const run of runs) {
        const p = portal(e, run.u0, run.u1, tuning);
        if (p) links.push({ from: i, to: run.to, ...p, normal: e.n, drop: run.drop });
      }
    }
  }
  const out: number[][] = Array.from({ length: count }, () => []);
  links.forEach((l, id) => out[l.from]!.push(id));
  return { links, out };
}

/** A point on the Arena: where on the ground plane, and the height of the feet. */
export interface NavPoint {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

/** The Walk Surface a body standing at `p` is on (index into `arena.walk`), or -1 if none. */
export function navPolygon(arena: ArenaGeometry, tuning: TuningData, p: NavPoint): number {
  return groundBelow(arena, p.x, p.z, p.y + tuning.fall.stepUp)?.surface ?? -1;
}

const mid = (l: NavLink): Vec2 => ({ x: (l.left.x + l.right.x) / 2, z: (l.left.z + l.right.z) / 2 });
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * The Links (ids) to walk through from `from` to `to`, cheapest first by distance between portal
 * midpoints plus the fall damage of drops; [] when both are on the same Walk Surface, null when
 * there is no way (or either is off the Walk Surfaces). Deterministic: ties go to the lower id.
 */
export function findPath(arena: ArenaGeometry, tuning: TuningData, from: NavPoint, to: NavPoint): number[] | null {
  const start = navPolygon(arena, tuning, from);
  const goal = navPolygon(arena, tuning, to);
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [];
  const mesh = navMesh(arena, tuning);
  const { safeHeight, damagePerMetre } = tuning.fall;
  const count = arena.walk.length;
  const g = new Float64Array(count).fill(Infinity);
  const entry: Vec2[] = new Array<Vec2>(count);
  const via = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  g[start] = 0;
  entry[start] = from;
  for (;;) {
    // The open polygon with the lowest estimate (ties: lowest index).
    let best = -1;
    let bestF = Infinity;
    for (let k = 0; k < count; k++) {
      if (closed[k] || g[k] === Infinity) continue;
      const f = g[k]! + dist(entry[k]!, to);
      if (f < bestF) {
        bestF = f;
        best = k;
      }
    }
    if (best < 0) return null;
    if (best === goal) break;
    closed[best] = 1;
    for (const id of mesh.out[best]!) {
      const l = mesh.links[id]!;
      if (closed[l.to]) continue;
      const m = mid(l);
      const damage = Math.max(0, l.drop - safeHeight) * damagePerMetre;
      const cost = g[best]! + dist(entry[best]!, m) + damage * DAMAGE_COST;
      if (cost < g[l.to]!) {
        g[l.to] = cost;
        entry[l.to] = m;
        via[l.to] = id;
      }
    }
  }
  const path: number[] = [];
  for (let k = goal; k !== start; k = mesh.links[via[k]!]!.from) path.push(via[k]!);
  return path.reverse();
}

/** z-component of (a - o) × (b - o), seen from above with (x, z) as (x, y): > 0 when b lies anticlockwise of a around o. */
const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
const same = (a: Vec2, b: Vec2) => a.x === b.x && a.z === b.z;

/** The string-pulled path from `from` through the portals of `path` (Link ids) to `to`: its corners, `to` last. */
export function corners(arena: ArenaGeometry, tuning: TuningData, path: readonly number[], from: Vec2, to: Vec2): Vec2[] {
  const mesh = navMesh(arena, tuning);
  const d = tuning.fighter.radius + CROSSING;
  const shift = (l: NavLink, k: number) => ({
    left: { x: l.left.x + l.normal.x * k, z: l.left.z + l.normal.z * k },
    right: { x: l.right.x + l.normal.x * k, z: l.right.z + l.normal.z * k },
  });
  // Behind the first portal's near line already (it starts close to the edge): that line is behind it.
  const behind = (l: NavLink) => ((from.x - l.left.x) * l.normal.x + (from.z - l.left.z) * l.normal.z > -d ? [] : [shift(l, -d)]);
  const portals = [
    ...path.flatMap((id, k) => {
      const l = mesh.links[id]!;
      return [...(k === 0 ? behind(l) : [shift(l, -d)]), l, shift(l, d)];
    }),
    { left: to, right: to },
  ];
  const out: Vec2[] = [];
  let apex = from;
  let left = from;
  let right = from;
  let li = 0;
  let ri = 0;
  for (let k = 0; k < portals.length; k++) {
    const { left: L, right: R } = portals[k]!;
    // Tighten the right side: R must not swing past the left.
    if (cross(apex, right, R) >= 0) {
      if (same(apex, right) || cross(apex, left, R) < 0) {
        right = R;
        ri = k;
      } else {
        out.push(left);
        apex = right = left;
        ri = li;
        k = li;
        continue;
      }
    }
    if (cross(apex, left, L) <= 0) {
      if (same(apex, left) || cross(apex, right, L) > 0) {
        left = L;
        li = k;
      } else {
        out.push(right);
        apex = left = right;
        li = ri;
        k = ri;
        continue;
      }
    }
  }
  if (!out.length || !same(out[out.length - 1]!, to)) out.push(to);
  return out;
}

/** The next point to walk to from `from` along `path` (Link ids) towards `to`: the first corner not yet reached. */
export function steer(arena: ArenaGeometry, tuning: TuningData, path: readonly number[], from: Vec2, to: Vec2): Vec2 {
  const cs = corners(arena, tuning, path, from, to);
  return cs.find((c) => dist(c, from) > REACHED) ?? to;
}
