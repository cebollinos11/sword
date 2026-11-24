/**
 * The navmesh probe: what the Fighters' AI (an AI ally, the Delver pilot, a promoted enemy) can path to on a draft, read from the very navmesh
 * (`navMesh`, ADR 0006) and A* (`findPath`, `corners`) the AI Controller walks by. It is not the walk check (`checkMap`'s reachability), which
 * is the Soldiers' destination fields: a Floor both pass for Soldiers can still hold a doorway too narrow for a walk Link, a pit the navmesh
 * drops into with no Link out, or a Deck only a Jump reaches (and a walking pilot, `jumps: false`, never does).
 *
 * Per Walk Surface, whether the navmesh reaches it from the start and back (`navReach`); per target, the route there and back, with jump
 * Links and walking only (`probeRoutes`); and the issues a map author acts on (`navIssues`). Targets are any points: a Floor's
 * (`floorTargets`, its Hall centres and markers) or a Battle map's Objectives and Bases. Pure, a function of the arena and Tuning Data.
 */
import { deadly, surfaceHeight, surfacesAt } from '../sim/arena';
import { corners, findPath, navMesh, navPolygon, type NavLink, type NavPoint } from '../sim/nav';
import type { Vec2 } from '../sim/state';
import type { FloorPlan } from '../sim/delver/plan';
import type { ArenaGeometry, BattleMapTuning, TuningData } from '../tuning';

/** Something the AI is meant to get to: a point on a floor, named for the list. */
export interface NavTarget extends NavPoint {
  /** What it is, for the list ("Stairs", "fire 1", "hall4 centre"). */
  readonly label: string;
  /** The Hall it is in (a Floor's), by id; absent on a Battle map. */
  readonly hall?: string;
}

/** How the navmesh sees a Walk Surface from the start: reached and back, never reached, reached with no way back, deadly, or a roof. */
export type NavReach = 'reached' | 'unreached' | 'stranded' | 'deadly' | 'roof';

/** One way between two points: the Links it takes and its string-pulled corners (from first), or null where there is none. */
export interface NavRoute {
  readonly links: readonly number[];
  /** The corners from the start to the end, each at the height of the floor under it. */
  readonly corners: readonly NavPoint[];
  /** Its length along the corners (m, on the ground plane). */
  readonly length: number;
  readonly jumps: number;
  readonly drops: number;
}

export interface RouteProbe {
  readonly target: NavTarget;
  /** There from the start, jump Links allowed (an AI ally, a promoted enemy). */
  readonly there: NavRoute | null;
  /** There walking only: Ramps and drops (the Delver pilot online, `jumps: false`). */
  readonly walking: NavRoute | null;
  /** Back to the start from it, jump Links allowed: none means a trap. */
  readonly back: NavRoute | null;
}

export interface NavProbe {
  readonly start: NavTarget;
  /** Per Walk Surface of the arena. */
  readonly reach: readonly NavReach[];
  /** Per Walk Surface, whether walking only (no jump Link) reaches it. */
  readonly walkReach: readonly boolean[];
  readonly routes: readonly RouteProbe[];
  /** The navmesh's Links, for drawing. */
  readonly links: readonly NavLink[];
}

/** An issue the probe found, in `MapIssue`'s terms (the UI lists it with the checks). */
export interface NavIssue {
  readonly severity: 'error' | 'warning' | 'note';
  readonly message: string;
  readonly at: Vec2;
  /** The height (m) of the floor it is on, where known. */
  readonly y?: number;
}

/**
 * A Floor's targets: the first Entrance spawn as the start, then every Hall's centre (in plan order), each fire, each pedestal, the Boss's post
 * and the Stairs zone's centre. Markers on a Hall centre already listed are folded into it ("hall3 centre, post").
 */
export function floorTargets(plan: FloorPlan): { start: NavTarget; targets: NavTarget[] } {
  const m = plan.markers;
  const hallAt = (x: number, z: number): string | undefined =>
    plan.halls.find((h) => x >= h.rect.x0 && x <= h.rect.x1 && z >= h.rect.z0 && z <= h.rect.z1)?.id;
  const targets: NavTarget[] = plan.halls.map((h) => ({ label: `${h.id} (${h.kind}) centre`, hall: h.id, x: h.cx, z: h.cz, y: h.y }));
  const add = (label: string, p: NavPoint) => {
    const same = targets.find((t) => t.x === p.x && t.z === p.z && Math.abs(t.y - p.y) < 0.5);
    if (same) return void (targets[targets.indexOf(same)] = { ...same, label: `${same.label}, ${label}` });
    targets.push({ label, hall: hallAt(p.x, p.z), x: p.x, z: p.z, y: p.y });
  };
  m.fires.forEach((f, k) => add(`fire ${k + 1}`, f));
  m.pedestals.forEach((p, k) => add(`pedestal ${k + 1}`, p));
  if (m.boss) add('Boss post', m.boss);
  add('Stairs', { x: (m.stairs.zone.x0 + m.stairs.zone.x1) / 2, z: (m.stairs.zone.z0 + m.stairs.zone.z1) / 2, y: m.stairs.y });
  const s = m.spawns[0]!;
  return { start: { label: 'Entrance spawn', hall: hallAt(s.x, s.z), x: s.x, z: s.z, y: s.y }, targets };
}

/**
 * A Battle map's targets: Team 0's Base as the start, then each Objective (at its `y`, else the highest floor there no roof, as the
 * Battlefield stands it) and Team 1's Base.
 */
export function mapTargets(map: Pick<BattleMapTuning, 'objectives' | 'bases'>, arena: ArenaGeometry): { start: NavTarget; targets: NavTarget[] } {
  const floorAt = (x: number, z: number, y?: number): number => {
    if (y !== undefined) return y;
    let best = 0;
    let found = false;
    for (const s of surfacesAt(arena, x, z)) {
      const w = arena.walk[s]!;
      if (w.roof || deadly(w)) continue;
      const h = surfaceHeight(arena, s, x, z);
      if (!found || h > best) (best = h), (found = true);
    }
    return best;
  };
  const at = (label: string, p: { x: number; z: number; y?: number }): NavTarget => ({ label, x: p.x, z: p.z, y: floorAt(p.x, p.z, p.y) });
  return { start: at("Team 0's Base", map.bases[0]), targets: [...map.objectives.map((o) => at(`Objective ${o.id}`, o)), at("Team 1's Base", map.bases[1])] };
}

/** The route from `from` to `to` (`findPath` then `corners`), or null. */
function route(arena: ArenaGeometry, tuning: TuningData, from: NavPoint, to: NavPoint, jumps: boolean): NavRoute | null {
  const links = findPath(arena, tuning, from, to, { jumps });
  if (!links) return null;
  const mesh = navMesh(arena, tuning);
  const flat = corners(arena, tuning, links, from, to);
  // Each corner at the height of the route's own Walk Surface under it (the start's, then each Link's `to` in turn), never a roof above it.
  const surfaces = [navPolygon(arena, tuning, from), ...links.map((id) => mesh.links[id]!.to)];
  const pts: NavPoint[] = [from];
  let length = 0;
  let prev: Vec2 = from;
  let k = 0;
  for (const c of flat) {
    length += Math.hypot(c.x - prev.x, c.z - prev.z);
    prev = c;
    const on = (s: number) => surfacesAt(arena, c.x, c.z).includes(s);
    let j = k;
    while (j < surfaces.length && !on(surfaces[j]!)) j++;
    if (j < surfaces.length) k = j;
    pts.push({ x: c.x, z: c.z, y: surfaceHeight(arena, surfaces[k]!, c.x, c.z) });
  }
  pts[pts.length - 1] = to;
  const kinds = links.map((id) => mesh.links[id]!.kind);
  return { links, corners: pts, length, jumps: kinds.filter((k) => k === 'jump').length, drops: kinds.filter((k) => k === 'drop').length };
}

/** Which Walk Surfaces the Links reach from `start` (`forward`), or reach `start` (`!forward`), taking jump Links or not. */
function flood(links: readonly NavLink[], count: number, start: number, forward: boolean, jumps: boolean): boolean[] {
  const into: number[][] = Array.from({ length: count }, () => []);
  for (const l of links) if (jumps || l.kind !== 'jump') (forward ? into[l.from]! : into[l.to]!).push(forward ? l.to : l.from);
  const seen = new Array<boolean>(count).fill(false);
  if (start < 0) return seen;
  seen[start] = true;
  const stack = [start];
  while (stack.length) for (const n of into[stack.pop()!]!) if (!seen[n]) (seen[n] = true), stack.push(n);
  return seen;
}

/** The probe of `arena` from `start` to each of `targets`. */
export function probeRoutes(arena: ArenaGeometry, tuning: TuningData, start: NavTarget, targets: readonly NavTarget[]): NavProbe {
  const mesh = navMesh(arena, tuning);
  const n = arena.walk.length;
  const from = navPolygon(arena, tuning, start);
  const there = flood(mesh.links, n, from, true, true);
  const home = flood(mesh.links, n, from, false, true);
  const walkReach = flood(mesh.links, n, from, true, false);
  const reach: NavReach[] = arena.walk.map((w, i) => (deadly(w) ? 'deadly' : w.roof ? 'roof' : !there[i] ? 'unreached' : !home[i] ? 'stranded' : 'reached'));
  const routes = targets.map((t) => ({
    target: t,
    there: route(arena, tuning, start, t, true),
    walking: route(arena, tuning, start, t, false),
    back: route(arena, tuning, t, start, true),
  }));
  return { start, reach, walkReach, routes, links: mesh.links };
}

/** A Walk Surface's middle, for pointing at it. */
function middle(arena: ArenaGeometry, s: number): Vec2 {
  const pts = arena.walk[s]!.points;
  let x = 0;
  let z = 0;
  for (const p of pts) (x += p.x), (z += p.z);
  return { x: x / pts.length, z: z / pts.length };
}

/**
 * What the probe found, worst first: a target with no route (off the navmesh, or none from the start), a trap (no way back), one only a Jump
 * reaches (a walking pilot never does), then Walk Surfaces the Soldiers walk to (`soldiersReach`) that the navmesh does not.
 */
export function navIssues(arena: ArenaGeometry, tuning: TuningData, probe: NavProbe, soldiersReach?: readonly string[]): NavIssue[] {
  const out: NavIssue[] = [];
  for (const r of probe.routes) {
    const t = r.target;
    const at = { x: t.x, z: t.z };
    const y = t.y;
    if (navPolygon(arena, tuning, t) < 0) out.push({ severity: 'error', message: `AI: ${t.label} is off the navmesh (no Walk Surface under it at ${t.y} m).`, at, y });
    else if (!r.there) out.push({ severity: 'error', message: `AI: no route from the ${probe.start.label} to ${t.label}.`, at, y });
    else if (!r.back) out.push({ severity: 'error', message: `AI: ${t.label} is a trap: a route in, none back to the ${probe.start.label}.`, at, y });
    else if (!r.walking) out.push({ severity: 'warning', message: `AI: ${t.label} needs a Jump (${r.there.jumps} on its route): a walking pilot never gets there.`, at, y });
  }
  probe.reach.forEach((k, s) => {
    if (k !== 'unreached' && k !== 'stranded') return;
    if (soldiersReach && soldiersReach[s] !== 'reached') return;
    const at = middle(arena, s);
    const y = surfaceHeight(arena, s, at.x, at.z);
    out.push({
      severity: 'warning',
      message: `AI: ${arena.walk[s]!.id} (${y.toFixed(1)} m) ${k === 'unreached' ? 'is walked to by Soldiers, but the navmesh never reaches it' : 'is reached by the navmesh with no way back'}.`,
      at,
      y,
    });
  });
  const rank = { error: 0, warning: 1, note: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
