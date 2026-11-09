/**
 * The Map Editor's live checks (docs/plans/map-editor.md, Stage 2): what the Simulation will do on a Map Source, worked out on every edit
 * and shown as a list and as overlays. Every check is the game's own code run on the compiled draft (`compileDraft`), not a copy of it:
 *  - **Reachability**: the walk check's reach (`walkReach`, which `walkCheck` decides by): a Walk Surface Soldiers cannot walk (and drop)
 *    to from the first, or cannot get back from, is an error, and Save refuses the map.
 *  - **Edges**: every probe of the walk check's pass along every Walk Surface edge, as a Soldier crosses it: a **walk** (onto ground within
 *    `battle.levels.stepUp`), a **drop** (one way, onto ground at most `battle.levels.drop` below), a **wall** (a Wall stands across the step
 *    at body height, `walled`) or a **ledge** (no ground it may step or drop onto). A walk or drop onto deadly ground is a warning.
 *  - **Field cell centres**: the destination fields' grid (`battle.crowd.flowCell`). On a map of several levels a Wall through a cell's
 *    centre, standing across a body on a floor there, cuts that node off from all its neighbours (every join from or to it starts or ends
 *    on the Wall, and `walled` counts a touch), so its cell is led by its neighbours' and the two Teams' fields stop being each other's half
 *    turn. A warning. (A map of one level reads no Wall in its fields, only its Blocks' insides, so it has none.)
 *  - **Clearance** (`fieldClearance`, built on demand: it is the costliest): the real destination fields (`battleMapOf`), each node's
 *    clearance and the files a Formation fits there (`filesFit`).
 *  - **Markers**: an Objective or a Base with no floor under it (`groundNear`, as the Battlefield stands them), one on deadly ground, an
 *    Objective over several levels without its `y` (it takes the highest), or whose `y` names no floor there.
 *  - **Ramps** steeper than a Fighter walks: one Tick at its fastest walk (Sheathed) climbs more than `fall.stepUp` or falls more than
 *    `fall.snapDown`, so `settleGround` stops it (or lifts it off the slope).
 *  - The compiler's own warnings, and its refusal (an error naming its Brushes).
 *
 * Every result names the Brushes it concerns (an Objective's or a Base's too), so the editor can select and frame them. Pure (no DOM, no
 * three.js, no clock: the editor times it), deterministic, every list in Brush order.
 */
import type { ArenaPoint, BattleTuning, TuningData } from '../tuning';
import { deadly, surfaceHeight, surfacesAt } from '../sim/arena';
import { isLayered } from '../sim/battlefield';
import { TICK_SECONDS } from '../sim/constants';
import { battleMapOf } from '../sim/destinations';
import { EDGE_PROBE, EDGE_REACH, edgesOf, groundNear, walkReach, walled, type WalkReach } from '../sim/levels';
import { filesFit } from '../sim/squad';
import { compileDraft, MapCompileError, walkChecked, type DraftMap } from './compile';
import { boundsOf } from './session';
import type { GroundPoint, MapSource, Rect } from './source';

/** What a check is about. */
export type IssueKind = 'compile' | 'unreachable' | 'deadly' | 'centre' | 'steep' | 'objective' | 'base' | 'compiler';

/**
 * One thing the checks found. Errors stop Save (the game would refuse the map); warnings are what the Simulation does that the author likely
 * did not mean; notes say what it does where a choice is the author's (an Objective over two levels takes the higher, as the Fort's B does).
 */
export interface MapIssue {
  readonly severity: 'error' | 'warning' | 'note';
  readonly kind: IssueKind;
  readonly message: string;
  /** The ids of the Brushes it concerns, the one to select first. */
  readonly brushes: readonly string[];
  /** The Objective it concerns, by id. */
  readonly objective?: string;
  /** The Base it concerns: its Team. */
  readonly base?: 0 | 1;
  /** Where on the ground it is, when that is a point (an Objective, a probe, a cell centre). */
  readonly at?: GroundPoint;
}

/** How the walk check sees a Walk Surface: reached both ways, not walked to from the first, walked to but no way back, or deadly (never walked to). */
export type SurfaceReach = 'reached' | 'unreached' | 'stranded' | 'deadly';

/** How a Soldier crosses a Walk Surface's edge (see the file's head). */
export type EdgeKind = 'walk' | 'drop' | 'wall' | 'ledge';
export const EDGE_KINDS: readonly EdgeKind[] = ['walk', 'drop', 'wall', 'ledge'];

/** A run of one Walk Surface's edge crossed the same way, its ends at the surface's height. */
export interface EdgeRun {
  readonly surface: number;
  readonly kind: EdgeKind;
  readonly a: ArenaPoint;
  readonly b: ArenaPoint;
}

/** A destination-field cell centre a Wall runs through, at the height of the floor whose node it cuts off. */
export interface CentreHit {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly wall: string;
  readonly brush: string;
}

export interface MapChecks {
  readonly source: MapSource;
  /** The compiled draft, or null where the compiler refuses the source. */
  readonly draft: DraftMap | null;
  /** Errors first, then warnings, then notes, each in Brush order. */
  readonly issues: readonly MapIssue[];
  /** Whether Save would write the map (no error). */
  readonly ok: boolean;
  /** Per Walk Surface of the draft. */
  readonly reach: readonly SurfaceReach[];
  /** Every Walk Surface edge as a Soldier crosses it, when asked for (`checkMap`'s `edges`); else none. */
  readonly edges: readonly EdgeRun[];
  /** The destination fields' cell (m) and the centres Walls cut off; `layered` false where the fields read no Wall. */
  readonly centres: { readonly cell: number; readonly layered: boolean; readonly hits: readonly CentreHit[] };
}

/** Heights this close (m) are equal. */
const EPS = 1e-9;

/** The steepest rise a metre (m/m) a Fighter walks up and down: one Tick at its fastest walk stays within a step up and a snap down. */
export function steepestRamp(tuning: Pick<TuningData, 'fall' | 'fighter'>): number {
  const tick = tuning.fighter.walkSpeed * tuning.fighter.sheathedWalkFactor * TICK_SECONDS;
  return Math.min(tuning.fall.stepUp, tuning.fall.snapDown) / tick;
}

/**
 * The checks of `source` under `tuning` (its Battle, and the Fighters' fall and walk for the Ramps). With `edges`, every edge's runs too
 * (the edges overlay): they read every probe again, a third of the time on a big map, so they are left out unless shown.
 */
export function checkMap(source: MapSource, tuning: Pick<TuningData, 'battle' | 'fall' | 'fighter'>, { edges: withEdges = false } = {}): MapChecks {
  const battle = tuning.battle;
  const lv = battle.levels;
  const issues: MapIssue[] = [];
  const order = new Map(source.brushes.map((b, k) => [b.id, k]));
  const cell = battle.crowd.flowCell;
  let draft: DraftMap | null = null;
  try {
    draft = compileDraft(source, battle);
  } catch (e) {
    if (!(e instanceof MapCompileError)) throw e;
    issues.push({ severity: 'error', kind: 'compile', message: e.message, brushes: e.brushes });
  }
  if (!draft) return { source, draft, issues, ok: false, reach: [], edges: [], centres: { cell, layered: false, hits: [] } };
  const { map, arena, surfaceBrush } = draft;
  const brushOfWall = (i: number) => (i < map.walls.length ? draft.wallBrush[i]! : draft.blockBrush[Math.floor((i - map.walls.length) / 4)]!);

  // The walk check's own pass: every probe, as runs of one kind along each edge, and the walks and drops onto deadly ground.
  const edges: EdgeRun[] = [];
  const intoDeadly = new Map<string, { from: number; to: number; drop: number; at: GroundPoint }>();
  let run: { surface: number; edge: number; e: ReturnType<typeof edgesOf>[number]; kind: EdgeKind; u0: number; u1: number } | null = null;
  // The probes come surface by surface, so each surface's edges are worked out once.
  let edgesFor = -1;
  let edgesNow: ReturnType<typeof edgesOf> = [];
  const edgeOf = (s: number, k: number) => {
    if (s !== edgesFor) [edgesFor, edgesNow] = [s, edgesOf(arena, s)];
    return edgesNow[k]!;
  };
  const close = () => {
    if (!run) return;
    const e = run.e;
    const point = (u: number): ArenaPoint => {
      const t = Math.min(e.length, Math.max(0, u)) / e.length;
      const x = e.px + (e.qx - e.px) * t;
      const z = e.pz + (e.qz - e.pz) * t;
      return { x, y: surfaceHeight(arena, run!.surface, x, z), z };
    };
    edges.push({ surface: run.surface, kind: run.kind, a: point(run.u0 - EDGE_PROBE / 2), b: point(run.u1 + EDGE_PROBE / 2) });
    run = null;
  };
  const probe = (s: number, edge: number, u: number, kind: EdgeKind) => {
    if (run && run.surface === s && run.edge === edge && run.kind === kind && u - run.u1 <= EDGE_PROBE * 1.5) run.u1 = u;
    else {
      close();
      run = { surface: s, edge, e: edgeOf(s, edge), kind, u0: u, u1: u };
    }
  };
  // Each probe steps across its edge from EDGE_REACH inside to EDGE_REACH past it, as `probeEdges` makes it.
  const reach: WalkReach = walkReach(
    arena,
    lv,
    (from, to, x, z, u, edge) => {
      const into = deadly(map.walk[to]!) && !deadly(map.walk[from]!);
      if (!withEdges && !into) return;
      const e = edgeOf(from, edge);
      const y = surfaceHeight(arena, from, x - e.nx * EDGE_REACH, z - e.nz * EDGE_REACH);
      const h = surfaceHeight(arena, to, x + e.nx * EDGE_REACH, z + e.nz * EDGE_REACH);
      if (withEdges) probe(from, edge, u, h >= y - lv.stepUp - EPS ? 'walk' : 'drop');
      if (!into) return;
      const key = `${surfaceBrush[from]}|${surfaceBrush[to]}`;
      const was = intoDeadly.get(key);
      if (!was || y - h > was.drop + EPS) intoDeadly.set(key, { from, to, drop: y - h, at: { x, z } });
    },
    !withEdges ? undefined : (from, x, z, u, edge) => {
      const e = edgeOf(from, edge);
      const px = x - e.nx * EDGE_REACH;
      const pz = z - e.nz * EDGE_REACH;
      probe(from, edge, u, walled(arena, lv, px, pz, x + e.nx * EDGE_REACH, z + e.nz * EDGE_REACH, surfaceHeight(arena, from, px, pz)) ? 'wall' : 'ledge');
    },
  );
  close();

  // Reachability, one error a Brush.
  const reachOf: SurfaceReach[] = map.walk.map((w, i) => (deadly(w) ? 'deadly' : !reach.there[i] ? 'unreached' : !reach.home[i] ? 'stranded' : 'reached'));
  const firstId = reach.first >= 0 ? map.walk[reach.first]!.id : '';
  const lost = new Map<string, { unreached: string[]; stranded: string[] }>();
  reachOf.forEach((r, i) => {
    if (r !== 'unreached' && r !== 'stranded') return;
    const b = surfaceBrush[i]!;
    if (!lost.has(b)) lost.set(b, { unreached: [], stranded: [] });
    lost.get(b)![r].push(map.walk[i]!.id);
  });
  for (const [b, { unreached, stranded }] of [...lost].sort((p, q) => order.get(p[0])! - order.get(q[0])!)) {
    const parts = [];
    if (unreached.length) parts.push(`cannot be walked to from ${firstId} (${unreached.join(', ')})`);
    if (stranded.length) parts.push(`cannot walk back to ${firstId} (${stranded.join(', ')})`);
    issues.push({ severity: 'error', kind: 'unreachable', message: `Soldiers cannot walk the whole map: ${b} ${parts.join(' and ')}. Give it a Ramp, or lower it within a drop.`, brushes: [b] });
  }
  // The game's own verdict: the error Save shows, and nothing else may pass it.
  try {
    walkChecked(draft, battle, reach);
  } catch (e) {
    if (!(e instanceof MapCompileError)) throw e;
    if (!issues.some((i) => i.kind === 'unreachable')) issues.push({ severity: 'error', kind: 'unreachable', message: e.message, brushes: e.brushes });
  }

  // Walks and drops onto deadly ground.
  for (const { from, to, drop, at } of [...intoDeadly.values()].sort((p, q) => order.get(surfaceBrush[p.to]!)! - order.get(surfaceBrush[q.to]!)! || order.get(surfaceBrush[p.from]!)! - order.get(surfaceBrush[q.from]!)!)) {
    const kind = deadly(map.walk[to]!)!;
    const how = drop > lv.stepUp + EPS ? `drop ${round(drop)} m off ${surfaceBrush[from]} into it` : `walk off ${surfaceBrush[from]} into it`;
    issues.push({
      severity: 'warning',
      kind: 'deadly',
      message: `${surfaceBrush[to]} (${kind === 'Fall' ? 'abyss' : kind.toLowerCase()}) lies within a Soldier's drop (${lv.drop} m): Soldiers ${how}. Lower it more than ${lv.drop} m under the edge, or rail the edge.`,
      brushes: [surfaceBrush[to]!, surfaceBrush[from]!],
      at,
    });
  }

  // Walls through the destination fields' cell centres (a map of several levels only).
  const layered = isLayered(map);
  const hits: CentreHit[] = [];
  if (layered) {
    const half = battle.field.size / 2;
    const reachCell = Math.ceil(half / cell);
    arena.walls.forEach((w, i) => {
      const brush = brushOfWall(i);
      if (brush === '') return; // The field's edge: every map's, and nothing walks beyond it.
      const dx = w.b.x - w.a.x;
      const dz = w.b.z - w.a.z;
      for (let cz = Math.max(-reachCell, Math.ceil(Math.min(w.a.z, w.b.z) / cell)); cz <= Math.min(reachCell, Math.floor(Math.max(w.a.z, w.b.z) / cell)); cz++)
        for (let cx = Math.max(-reachCell, Math.ceil(Math.min(w.a.x, w.b.x) / cell)); cx <= Math.min(reachCell, Math.floor(Math.max(w.a.x, w.b.x) / cell)); cx++) {
          const x = cx * cell;
          const z = cz * cell;
          // On the Wall's line exactly, as `walled` counts a touch (exactly: grid coordinates are whole quarter metres, so this is exact too).
          if (dx * (z - w.a.z) - dz * (x - w.a.x) !== 0) continue;
          // The floors there it stands across a body on (as `walled` counts heights).
          for (const t of surfacesAt(arena, x, z)) {
            if (deadly(map.walk[t]!)) continue;
            const y = surfaceHeight(arena, t, x, z);
            if (w.bottom >= y + lv.height || w.top <= y + lv.stepUp) continue;
            if (!hits.some((h) => h.x === x && h.z === z && Math.abs(h.y - y) <= lv.stepUp + EPS && h.wall === w.id)) hits.push({ x, z, y, wall: w.id, brush });
          }
        }
    });
    const byBrush = new Map<string, CentreHit[]>();
    for (const h of hits) byBrush.set(h.brush, [...(byBrush.get(h.brush) ?? []), h]);
    for (const [b, list] of [...byBrush].sort((p, q) => order.get(p[0])! - order.get(q[0])!)) {
      const points = [...new Set(list.map((h) => `(${h.x}, ${h.z})`))];
      issues.push({
        severity: 'warning',
        kind: 'centre',
        message: `${b}'s Walls run through ${points.length} destination-field cell centre${points.length === 1 ? '' : 's'} (the ${cell} m grid) at ${points.slice(0, 3).join(', ')}${points.length > 3 ? '…' : ''}: the field's node there is cut off, so Squads in that cell are led by its neighbours'. Move it off the dots.`,
        brushes: [b],
        at: { x: list[0]!.x, z: list[0]!.z },
      });
    }
  }

  // Ramps steeper than a Fighter walks.
  const steepest = steepestRamp(tuning);
  for (const b of source.brushes) {
    if (b.kind !== 'ramp') continue;
    const run = b.up === 'n' || b.up === 's' ? b.rect.z1 - b.rect.z0 : b.rect.x1 - b.rect.x0;
    const slope = (b.hi - b.lo) / run;
    if (slope > steepest + EPS)
      issues.push({ severity: 'warning', kind: 'steep', message: `Ramp ${b.id} rises ${round(b.hi - b.lo)} m in ${round(run)} m (${round(slope)} a metre): steeper than a Fighter walks (${round(steepest)}). Make it at least ${round((b.hi - b.lo) / steepest)} m long.`, brushes: [b.id] });
  }

  // Objectives and Bases on the floor, where the Battlefield stands them (`groundNear`).
  const brushesAt = (x: number, z: number): string[] => {
    const out = new Set<string>();
    for (const t of surfacesAt(arena, x, z)) out.add(surfaceBrush[t]!);
    return [...out].sort((p, q) => order.get(p)! - order.get(q)!);
  };
  for (const o of source.objectives) {
    const s = groundNear(arena, lv, o.x, o.z, o.y ?? Infinity);
    const at = { x: o.x, z: o.z };
    const say = (message: string, severity: MapIssue['severity'] = 'warning') => {
      // The floor it stands on first (the one to select), then the others there.
      const here = brushesAt(o.x, o.z);
      const on = s >= 0 ? surfaceBrush[s]! : null;
      issues.push({ severity, kind: 'objective', message: `Objective ${o.id} ${message}`, brushes: on ? [on, ...here.filter((b) => b !== on)] : here, objective: o.id, at });
    };
    if (s < 0) {
      say('has no Walk Surface under it: no Squad can reach it.');
      continue;
    }
    const h = surfaceHeight(arena, s, o.x, o.z);
    const kind = deadly(map.walk[s]!);
    if (kind) {
      say(`stands on deadly ground (${surfaceBrush[s]}).`);
      continue;
    }
    if (o.y !== undefined) {
      if (Math.abs(h - o.y) > lv.stepUp + EPS) say(`names its floor at y ${o.y}, but there is none there: it stands on ${surfaceBrush[s]} at ${round(h)} m.`);
      continue;
    }
    const others = surfacesAt(arena, o.x, o.z).filter((t) => !deadly(map.walk[t]!) && Math.abs(surfaceHeight(arena, t, o.x, o.z) - h) > lv.stepUp + EPS);
    if (others.length > 0) say(`stands over ${others.length + 1} levels without its y: it takes the highest (${surfaceBrush[s]} at ${round(h)} m), and only Soldiers on that level take it. Set its y to choose another.`, 'note');
  }
  map.bases.forEach((p, t) => {
    const s = groundNear(arena, lv, p.x, p.z, Infinity);
    if (s >= 0 && !deadly(map.walk[s]!)) return;
    issues.push({ severity: 'warning', kind: 'base', message: `Team ${t}'s Base ${s < 0 ? 'has no floor under it' : `stands on deadly ground (${surfaceBrush[s]})`}: its Squads fall back and respawn there.`, brushes: brushesAt(p.x, p.z), base: t as 0 | 1, at: { x: p.x, z: p.z } });
  });

  for (const w of draft.warnings) issues.push({ severity: 'warning', kind: 'compiler', message: w.message, brushes: w.brush ? [w.brush] : [] });

  const sorted = (['error', 'warning', 'note'] as const).flatMap((v) => issues.filter((i) => i.severity === v));
  return { source, draft, issues: sorted, ok: !sorted.some((i) => i.severity === 'error'), reach: reachOf, edges, centres: { cell, layered, hits } };
}

/** A number as the messages write it: to the centimetre, no trailing zeros. */
const round = (v: number): string => String(Math.round(v * 100) / 100);

/** One node of the destination fields: a cell centre on one level, its clearance (m; Infinity where nothing is near) and the files a Formation fits there. */
export interface ClearanceNode {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly clearance: number;
  readonly files: number;
}

/**
 * The destination fields' clearance of a checked map, from the Battle's own build of them (`battleMapOf` on the draft, as a Battle on it
 * would build them): every node, with the files a Formation of `battle.squad.line.wide` fits there. Null where Save would refuse the map
 * (the Battlefield is not built for a map Soldiers cannot walk).
 */
export function fieldClearance(checks: MapChecks, battle: BattleTuning): { readonly cell: number; readonly nodes: readonly ClearanceNode[] } | null {
  const draft = checks.draft;
  if (!draft || !checks.ok) return null;
  const { field, fields } = battleMapOf({ ...battle, maps: { [draft.map.name]: draft.map } }, `battle:${draft.map.name}`);
  const { side, cell } = fields;
  const mid = (side - 1) / 2;
  const nodes: ClearanceNode[] = [];
  const node = (c: number, y: number, clearance: number) => {
    const x = ((c % side) - mid) * cell;
    const z = (Math.floor(c / side) - mid) * cell;
    nodes.push({ x, z, y, clearance, files: Math.min(battle.squad.line.wide, filesFit(battle, clearance)) });
  };
  const L = fields.levels;
  if (L) for (let k = 0; k < L.y.length; k++) node(L.cell[k]!, L.y[k]!, fields.clearance![k]!);
  else
    for (let c = 0; c < side * side; c++) {
      if (fields.blocked[c]) continue;
      const x = ((c % side) - mid) * cell;
      const z = (Math.floor(c / side) - mid) * cell;
      const s = groundNear(field.arena, battle.levels, x, z, Infinity);
      node(c, s >= 0 ? surfaceHeight(field.arena, s, x, z) : 0, fields.clearance ? fields.clearance[c]! : Infinity);
    }
  return { cell, nodes };
}

/** Where on the ground an issue is, to frame it: its Brushes' bounds and its point together, or null when it names neither. */
export function issueBounds(source: MapSource, issue: MapIssue): Rect | null {
  let r: { x0: number; z0: number; x1: number; z1: number } | null = null;
  const add = (b: Rect) => {
    r = r ? { x0: Math.min(r.x0, b.x0), z0: Math.min(r.z0, b.z0), x1: Math.max(r.x1, b.x1), z1: Math.max(r.z1, b.z1) } : { ...b };
  };
  // A Brush as wide as the field (the ground) frames nothing: the point does, when there is one.
  for (const id of issue.brushes) {
    const b = source.brushes.find((x) => x.id === id);
    if (!b) continue;
    const bounds = boundsOf(b);
    if (issue.at && bounds.x1 - bounds.x0 >= source.size / 2 && bounds.z1 - bounds.z0 >= source.size / 2) continue;
    add(bounds);
  }
  if (issue.at) add({ x0: issue.at.x - 4, z0: issue.at.z - 4, x1: issue.at.x + 4, z1: issue.at.z + 4 });
  return r;
}
