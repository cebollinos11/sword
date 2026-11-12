/**
 * The Delver Floor judge (docs/plans/delver.md, Stage 1): the rules a planned and built Floor must keep before a Run is dealt it.
 * Each failure is one line, prefixed by its rule's name and naming the Hall, Passage or marker, so a reroll's reasons read as the
 * plan's tests do. The rules, in order:
 *
 *  1. `rooms`: the plan has the Halls wanted, one Entrance, one Stairs, Rests within range and a Fight (checkable without a build).
 *  2. `compile`: the Map Source did not compile, `walkCheck` included (the other rules are then skipped).
 *  3. `halls`: the field from the Entrance's centre reaches every Hall's centre.
 *  4. `passages` (Stage 0's check): the field to one Hall's centre, read at its neighbour's, follows the Passage between them.
 *  5. `markers`: each marker stands in its Hall, on the floor, off any hazard, and is reached from the Entrance.
 *  6. `sight`: no Warband post or patrol point is in sight of an Entrance spawn.
 *
 * Pure: no clock, so a verdict never hangs on a machine's speed.
 */
import { MapCompileError } from '../../mapEditor/compile';
import type { DelverFloorTuning } from '../../tuning/delver';
import type { TuningData } from '../../tuning';
import { deadly, surfaceHeight } from '../arena';
import { groundOf } from '../battlefield';
import { distanceTo, inSight, type DestinationFields } from '../destinations';
import { buildFloor, type BuiltFloor } from './build';
import type { FloorPlan } from './plan';

export interface FloorJudgement {
  readonly ok: boolean;
  /** One line per failure, in the rules' order; none when `ok`. */
  readonly reasons: readonly string[];
}

/**
 * The distance (m) at the node of the cell (x, z) lies in, on the level of Walk Surface `s` exactly (-1: no such node; no neighbour's
 * is borrowed). `d` is a field of `f` (`distanceTo`).
 */
export function fieldAt(f: DestinationFields, d: Float64Array, x: number, z: number, s: number): number {
  const mid = (f.side - 1) / 2;
  const cellOf = (v: number) => Math.min(f.side - 1, Math.max(0, Math.sign(v) * Math.round(Math.abs(v) / f.cell) + mid));
  const c = cellOf(z) * f.side + cellOf(x);
  if (!f.levels) return d[c]!;
  for (let k = f.levels.start[c]!; k < f.levels.start[c + 1]!; k++) if (f.levels.surface[k] === s) return d[k]!;
  return -1;
}

const m = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Rule 1, `rooms`: what a plan alone can show. */
export function judgePlan(t: DelverFloorTuning, plan: FloorPlan): string[] {
  const out: string[] = [];
  const count = (k: string) => plan.halls.filter((h) => h.kind === k).length;
  if (plan.halls.length !== t.rooms) out.push(`rooms: ${plan.halls.length} Halls, ${t.rooms} wanted (the layout stalled)`);
  if (count('Entrance') !== 1) out.push(`rooms: ${count('Entrance')} Entrances, one wanted`);
  if (count('Stairs') !== 1) out.push(`rooms: ${count('Stairs')} Stairs, one wanted`);
  const rests = count('Rest');
  if (rests < t.rests[0] || rests > t.rests[1]) out.push(`rooms: ${rests} Rests, ${t.rests[0]} to ${t.rests[1]} wanted`);
  if (count('Fight') < 1) out.push('rooms: no Fight Hall');
  return out;
}

/** A marker to judge: its name, its Hall and where it stands. */
interface Marker {
  readonly name: string;
  readonly hall: number;
  readonly x: number;
  readonly z: number;
}

function markersOf(plan: FloorPlan): Marker[] {
  const m = plan.markers;
  const zone = m.stairs.zone;
  return [
    ...m.spawns.map((p, k): Marker => ({ name: `spawn${k}`, hall: p.hall, x: p.x, z: p.z })),
    { name: 'stairs', hall: m.stairs.hall, x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 },
    ...m.fires.map((p, k): Marker => ({ name: `fire${k}`, hall: p.hall, x: p.x, z: p.z })),
    ...m.pedestals.map((p, k): Marker => ({ name: `pedestal${k}`, hall: p.hall, x: p.x, z: p.z })),
    ...m.posts.map((p, k): Marker => ({ name: `post${k}`, hall: p.hall, x: p.x, z: p.z })),
    ...m.patrols.flatMap((patrol, k) => patrol.points.map((p, n): Marker => ({ name: `patrol${k}.${n}`, hall: patrol.halls[n]!, x: p.x, z: p.z }))),
  ];
}

/** Rules 3 to 6 on a built Floor. */
function judgeFields(t: DelverFloorTuning, b: BuiltFloor): string[] {
  const { plan, battle, field, fields } = b;
  const halls = plan.halls;
  const out: string[] = [];
  const surfaceOf = (x: number, z: number) => groundOf(battle, field, x, z);
  // One field to each Hall's centre, shared by rules 3 to 5.
  const centre = halls.map((h) => ({ x: h.cx, z: h.cz, s: surfaceOf(h.cx, h.cz) }));
  const to = centre.map((c) => distanceTo(fields, c.x, c.z, c.s));
  const fromEntrance = to[plan.entrance]!;

  halls.forEach((h, k) => {
    if (fieldAt(fields, fromEntrance, centre[k]!.x, centre[k]!.z, centre[k]!.s) < 0) out.push(`halls: ${h.id} is not reached from the Entrance (${halls[plan.entrance]!.id})`);
  });

  plan.passages.forEach((p) => {
    const c = centre[p.b]!;
    const d = fieldAt(fields, to[p.a]!, c.x, c.z, c.s);
    if (d < 0 || d > t.follow * p.length) {
      out.push(`passages: ${p.id} (${halls[p.a]!.id} to ${halls[p.b]!.id}) is not followed: ${d < 0 ? 'no way' : `${m(d)} m`} against ${p.length} m`);
    }
  });

  const markers = markersOf(plan);
  for (const mk of markers) {
    const r = halls[mk.hall]!.rect;
    if (mk.x < r.x0 + 1 || mk.x > r.x1 - 1 || mk.z < r.z0 + 1 || mk.z > r.z1 - 1) {
      out.push(`markers: ${mk.name} (${m(mk.x)}, ${m(mk.z)}) is not inside ${halls[mk.hall]!.id} shrunk by 1 m`);
      continue;
    }
    const s = surfaceOf(mk.x, mk.z);
    const surface = s >= 0 ? field.arena.walk[s]! : null;
    if (!surface) out.push(`markers: ${mk.name} (${m(mk.x)}, ${m(mk.z)}) stands on no Walk Surface`);
    else if (deadly(surface)) out.push(`markers: ${mk.name} (${m(mk.x)}, ${m(mk.z)}) stands on deadly ground (${deadly(surface)})`);
    else if (surface.roof) out.push(`markers: ${mk.name} (${m(mk.x)}, ${m(mk.z)}) stands on a roof`);
    else if (Math.abs(surfaceHeight(field.arena, s, mk.x, mk.z)) > 1e-6) out.push(`markers: ${mk.name} (${m(mk.x)}, ${m(mk.z)}) is not at height 0`);
    else if (fieldAt(fields, fromEntrance, mk.x, mk.z, s) < 0) out.push(`markers: ${mk.name} (${m(mk.x)}, ${m(mk.z)}) is not reached from the Entrance`);
  }

  const spawns = plan.markers.spawns;
  for (const mk of markers) {
    if (!/^(post|patrol)/.test(mk.name)) continue;
    const seen = spawns.findIndex((sp) => inSight(fields, sp.x, sp.z, mk.x, mk.z, 0, 0, 0));
    if (seen >= 0) out.push(`sight: ${mk.name} (${halls[mk.hall]!.id}) is in sight of spawn${seen}`);
  }
  return out;
}

/** Rules 1 and 3 to 6 on a built Floor (the compile rule is the build's own throw). */
export function judgeBuilt(t: DelverFloorTuning, b: BuiltFloor): string[] {
  return [...judgePlan(t, b.plan), ...judgeFields(t, b)];
}

/** All the rules on a plan: rule 1, then the build (a throw is rule 2 and ends it), then rules 3 to 6. `built` is absent when it did not compile. */
export function judgeFloor(tuning: Pick<TuningData, 'battle' | 'delver'>, plan: FloorPlan): { judgement: FloorJudgement; built?: BuiltFloor } {
  const t = tuning.delver.floor;
  const reasons = judgePlan(t, plan);
  let built: BuiltFloor;
  try {
    built = buildFloor(tuning, plan);
  } catch (e) {
    if (!(e instanceof MapCompileError)) throw e;
    reasons.push(`compile: ${e.message}`);
    return { judgement: { ok: false, reasons } };
  }
  reasons.push(...judgeFields(t, built));
  return { judgement: { ok: reasons.length === 0, reasons }, built };
}
