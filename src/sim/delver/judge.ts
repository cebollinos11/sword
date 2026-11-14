/**
 * The Delver Floor judge (docs/plans/delver.md, Stage 1): the rules a planned and built Floor must keep before a Run is dealt it.
 * Each failure is one line, prefixed by its rule's name and naming the Hall, Passage or marker, so a reroll's reasons read as the
 * plan's tests do. The rules, in order:
 *
 *  1. `rooms`: the plan has the Halls wanted, one Entrance, one Stairs (a Boss Floor: one Boss Hall, the Stairs Hall, and no Stairs kind), Rests within range and a Fight (checkable without a build).
 *     With great halls wanted (Stage 7a): as many great halls as `great.count` allows, and a Boss Floor's Boss Hall is one.
 *     And `levels` (Stage 6): at least `levels.min` distinct Hall levels (also plan-only).
 *     And `layout` (Stage 7a, plan-only): seen from above, no two Halls share interior, no Passage's piece shares interior with another Passage's piece or with any Hall
 *     (its own end Halls, and its own other pieces, it may only touch), and every Hall and piece is inside the field (when the field's size is known).
 *  2. `compile`: the Map Source did not compile, `walkCheck` included (the other rules are then skipped; a plan rule 1 refused is not built).
 *  3. `halls`: the field from the Entrance's centre reaches every Hall's centre.
 *  4. `passages` (Stage 0's check), both ways and along every leg of the Passage itself (Stage 7a): the checkpoints are the point 1 m inside the first piece, each corner's
 *     centre, and the point 1 m inside the last piece (each on the Walk Surface at its own height); between each two the field is at most `follow` times the leg's length,
 *     and so is the reverse (a sloped leg is climbed and walked down). A straight Passage is one leg.
 *  5. `markers`: each marker stands in its Hall, on a Walk Surface at its own height (a Hall's floor or a Deck), off any hazard and no roof, and is reached from the Entrance.
 *  6. `sight`: no Warband post, patrol point or Boss post is in sight of an Entrance spawn (each at its own height).
 *  7. `galleries` (Stage 6): each gallery's Deck centre is a Walk Surface at the Deck's height that is no roof, reached from the Entrance, and its Hall's centre is reached from it.
 *
 * Pure: no clock, so a verdict never hangs on a machine's speed.
 */
import { MapCompileError } from '../../mapEditor/compile';
import type { DelverFloorTuning } from '../../tuning/delver';
import type { TuningData } from '../../tuning';
import { deadly, surfaceHeight } from '../arena';
import { floorNear } from '../levels';
import { groundOf } from '../battlefield';
import { cellAt, distanceTo, inSight, nodeIn, type DestinationFields } from '../destinations';
import { buildFloor, type BuiltFloor } from './build';
import type { DelverPassage, FloorPlan, PassagePiece } from './plan';
import { pieceId } from './source';
import type { Rect, Side } from '../../mapEditor/source';

export interface FloorJudgement {
  readonly ok: boolean;
  /** One line per failure, in the rules' order; none when `ok`. */
  readonly reasons: readonly string[];
}

/**
 * The distance (m) at the node of the cell (x, z) lies in, on the level of Walk Surface `s` (-1: no such node). `d` is a field of `f`
 * (`distanceTo`). A cell's node stands on its level's highest Walk Surface at the cell's centre, so when a seam between two floor pieces
 * (a gallery's Ramp cuts the Hall's floor into pieces) puts the cell's centre on a neighbour of `s`, the node taken is the one within a step
 * (`levels.stepUp`) of `s`'s height there (`nodeIn`, the fields' own rule); nothing of another level is ever borrowed.
 */
export function fieldAt(f: DestinationFields, d: Float64Array, x: number, z: number, s: number): number {
  const c = cellAt(f, x, z);
  if (!f.levels) return d[c]!;
  const k = nodeIn(f, c, s);
  return k < 0 ? -1 : d[k]!;
}

const m = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Whether two rects share interior (touching edges do not). */
const overlap = (p: Rect, q: Rect): boolean => p.x0 < q.x1 && q.x0 < p.x1 && p.z0 < q.z1 && q.z0 < p.z1;

/**
 * Rules 1 (`rooms`, `levels`) and `layout`: what a plan alone can show. `fieldSize` (m) is the Battle's field the Floor stands in; without it the
 * `layout` rule's field check is skipped.
 */
export function judgePlan(t: DelverFloorTuning, plan: FloorPlan, fieldSize?: number): string[] {
  const out: string[] = [];
  const count = (k: string) => plan.halls.filter((h) => h.kind === k).length;
  if (plan.halls.length !== t.rooms) out.push(`rooms: ${plan.halls.length} Halls, ${t.rooms} wanted (the layout stalled)`);
  if (count('Entrance') !== 1) out.push(`rooms: ${count('Entrance')} Entrances, one wanted`);
  if (count('Boss') > 0 || plan.markers.boss) {
    // A Boss Floor: exactly one Boss Hall, the Stairs Hall, and no other Stairs.
    if (count('Boss') !== 1) out.push(`rooms: ${count('Boss')} Boss Halls, one wanted`);
    else if (plan.halls[plan.stairs]?.kind !== 'Boss') out.push(`rooms: the Boss Hall is not the Stairs Hall (${plan.halls[plan.stairs]?.id})`);
    if (count('Stairs') !== 0) out.push(`rooms: ${count('Stairs')} Stairs on a Boss Floor, none wanted`);
  } else if (count('Stairs') !== 1) out.push(`rooms: ${count('Stairs')} Stairs, one wanted`);
  const rests = count('Rest');
  if (rests < t.rests[0] || rests > t.rests[1]) out.push(`rooms: ${rests} Rests, ${t.rests[0]} to ${t.rests[1]} wanted`);
  if (count('Fight') < 1) out.push('rooms: no Fight Hall');
  if (t.great.count[1] > 0) {
    const great = plan.halls.filter((h) => h.great).length;
    if (great < t.great.count[0] || great > t.great.count[1]) out.push(`rooms: ${great} great halls, ${t.great.count[0]} to ${t.great.count[1]} wanted`);
    for (const h of plan.halls) if (h.kind === 'Boss' && !h.great) out.push(`rooms: the Boss Hall ${h.id} is not a great hall`);
  }
  const levels = new Set(plan.halls.map((h) => h.level)).size;
  if (levels < t.levels.min) out.push(`levels: ${levels} Hall level${levels === 1 ? '' : 's'}, at least ${t.levels.min} wanted`);
  out.push(...judgeLayout(plan, fieldSize));
  return out;
}

/** The `layout` rule: nothing overlaps seen from above, and everything is inside the field (when `fieldSize` is given). */
function judgeLayout(plan: FloorPlan, fieldSize: number | undefined): string[] {
  const out: string[] = [];
  const halls = plan.halls;
  halls.forEach((h, i) => {
    for (let j = i + 1; j < halls.length; j++) if (overlap(h.rect, halls[j]!.rect)) out.push(`layout: ${h.id} overlaps ${halls[j]!.id}`);
  });
  const pieces = plan.passages.flatMap((p, n) => p.pieces.map((q, k) => ({ n, id: pieceId(p, k), rect: q.rect })));
  for (const q of pieces) {
    for (const h of halls) if (overlap(q.rect, h.rect)) out.push(`layout: ${q.id} overlaps ${h.id}`);
  }
  pieces.forEach((q, i) => {
    for (let j = i + 1; j < pieces.length; j++) if (pieces[j]!.n !== q.n && overlap(q.rect, pieces[j]!.rect)) out.push(`layout: ${q.id} overlaps ${pieces[j]!.id}`);
  });
  if (fieldSize !== undefined) {
    const half = fieldSize / 2;
    const outside = (r: Rect) => r.x0 < -half || r.z0 < -half || r.x1 > half || r.z1 > half;
    for (const h of halls) if (outside(h.rect)) out.push(`layout: ${h.id} is outside the field`);
    for (const q of pieces) if (outside(q.rect)) out.push(`layout: ${q.id} is outside the field`);
  }
  return out;
}

/** A marker to judge: its kind, its name, its Hall and where it stands. */
interface Marker {
  readonly kind: 'spawn' | 'stairs' | 'fire' | 'pedestal' | 'post' | 'patrol' | 'boss';
  readonly name: string;
  readonly hall: number;
  readonly x: number;
  /** The height it stands at (m). */
  readonly y: number;
  readonly z: number;
}

function markersOf(plan: FloorPlan): Marker[] {
  const m = plan.markers;
  const zone = m.stairs.zone;
  return [
    ...m.spawns.map((p, k): Marker => ({ kind: 'spawn', name: `spawn${k}`, hall: p.hall, x: p.x, y: p.y, z: p.z })),
    { kind: 'stairs', name: 'stairs', hall: m.stairs.hall, x: (zone.x0 + zone.x1) / 2, y: m.stairs.y, z: (zone.z0 + zone.z1) / 2 },
    ...m.fires.map((p, k): Marker => ({ kind: 'fire', name: `fire${k}`, hall: p.hall, x: p.x, y: p.y, z: p.z })),
    ...m.pedestals.map((p, k): Marker => ({ kind: 'pedestal', name: `pedestal${k}`, hall: p.hall, x: p.x, y: p.y, z: p.z })),
    ...m.posts.map((p, k): Marker => ({ kind: 'post', name: `post${k}`, hall: p.hall, x: p.x, y: p.y, z: p.z })),
    ...m.patrols.flatMap((patrol, k) => patrol.points.map((p, n): Marker => ({ kind: 'patrol', name: `patrol${k}.${n}`, hall: patrol.halls[n]!, x: p.x, y: p.y, z: p.z }))),
    ...(m.boss ? [{ kind: 'boss', name: 'boss', hall: m.boss.hall, x: m.boss.x, y: m.boss.y, z: m.boss.z } as Marker] : []),
  ];
}

/** The point on piece `q`'s side `side`'s centre, moved `inset` m inside it. */
function onSide(q: PassagePiece, side: Side, inset: number): { x: number; z: number } {
  const r = q.rect;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  return side === 'w' ? { x: r.x0 + inset, z: cz } : side === 'e' ? { x: r.x1 - inset, z: cz } : side === 'n' ? { x: cx, z: r.z1 - inset } : { x: cx, z: r.z0 + inset };
}

/**
 * Rule 4's checkpoints along Passage `p`: the point 1 m inside its first piece from its `from` side (at `y0`), each corner's centre (at its height), and the point
 * 1 m inside its last piece from its `to` side (at `y1`). Each carries `nominal`, the length (m) of the leg that begins there: from `a`'s side to the first corner's
 * centre, corner centre to corner centre, and the last corner's centre to `b`'s side (the last checkpoint has none: 0).
 */
function checkpoints(p: DelverPassage): { x: number; z: number; y: number; nominal: number }[] {
  const first = p.pieces[0]!;
  const last = p.pieces[p.pieces.length - 1]!;
  const edge = (q: PassagePiece, side: Side) => onSide(q, side, 0);
  const pts = [
    { ...onSide(first, first.from, 1), y: first.y0, at: edge(first, first.from) },
    ...p.pieces.filter((q) => q.corner).map((q) => {
      const centre = { x: (q.rect.x0 + q.rect.x1) / 2, z: (q.rect.z0 + q.rect.z1) / 2 };
      return { ...centre, y: q.y0, at: centre };
    }),
    { ...onSide(last, last.to, 1), y: last.y1, at: edge(last, last.to) },
  ];
  return pts.map((pt, k) => {
    const next = pts[k + 1];
    return { x: pt.x, z: pt.z, y: pt.y, nominal: next ? Math.abs(next.at.x - pt.at.x) + Math.abs(next.at.z - pt.at.z) : 0 };
  });
}

/** Rules 3 to 7 on a built Floor. */
export function judgeFields(t: DelverFloorTuning, b: BuiltFloor): string[] {
  const { plan, battle, field, fields } = b;
  const halls = plan.halls;
  const out: string[] = [];
  const surfaceOf = (x: number, z: number, y: number) => groundOf(battle, field, x, z, y);
  const centre = halls.map((h) => ({ x: h.cx, z: h.cz, s: surfaceOf(h.cx, h.cz, h.y) }));
  // A field to a Hall's centre, built when first asked and kept: rules 3, 4 and 7 need the Entrance's and each Passage's two Halls'.
  const cache: (Float64Array | undefined)[] = [];
  const to = (k: number): Float64Array => (cache[k] ??= distanceTo(fields, centre[k]!.x, centre[k]!.z, centre[k]!.s));
  const fromEntrance = to(plan.entrance);

  halls.forEach((h, k) => {
    if (fieldAt(fields, fromEntrance, centre[k]!.x, centre[k]!.z, centre[k]!.s) < 0) out.push(`halls: ${h.id} is not reached from the Entrance (${halls[plan.entrance]!.id})`);
  });

  // The field to a Passage's end, kept by its place and Walk Surface (each end is read twice, and by a neighbour Passage's check never).
  const endFields = new Map<string, Float64Array>();
  const fieldFrom = (e: { x: number; z: number; s: number }): Float64Array => {
    const key = `${e.x},${e.z},${e.s}`;
    let d = endFields.get(key);
    if (!d) endFields.set(key, (d = distanceTo(fields, e.x, e.z, e.s)));
    return d;
  };

  // Rule 4 measures the Passage itself, leg by leg: from the point 1 m inside its first piece to each corner's centre and on to the point 1 m inside its last,
  // each on the floor nearest its own height (`floorNear`), so a stairwell Hall's way round its Ramp is not charged to the Passage.
  plan.passages.forEach((p) => {
    const spots = checkpoints(p).map((e) => ({ ...e, s: floorNear(field.arena, e.x, e.z, e.y) }));
    const turning = p.pieces.length > 1;
    const name = (k: number) => (k === 0 ? `${halls[p.a]!.id}'s end` : k === spots.length - 1 ? `${halls[p.b]!.id}'s end` : `corner ${k}`);
    const head = `passages: ${p.id} (${halls[p.a]!.id} to ${halls[p.b]!.id})`;
    if (!turning) {
      const [f, o] = [spots[0]!, spots[1]!];
      if (f.s < 0 || o.s < 0) {
        out.push(`${head} its end at ${halls[f.s < 0 ? p.a : p.b]!.id} stands on no floor`);
        return;
      }
      for (const [from, onward] of [[f, o], [o, f]] as const) {
        const d = fieldAt(fields, fieldFrom(from), onward.x, onward.z, onward.s);
        if (d < 0 || d > t.follow * f.nominal) {
          const [x, y] = from === f ? [p.b, p.a] : [p.a, p.b];
          out.push(`${head} is not followed from ${halls[x]!.id}'s end to ${halls[y]!.id}'s: ${d < 0 ? 'no way' : `${m(d)} m`} against ${f.nominal} m`);
        }
      }
      return;
    }
    for (let k = 0; k + 1 < spots.length; k++) {
      const f = spots[k]!;
      const o = spots[k + 1]!;
      const leg = `${head} leg ${k + 1} of ${spots.length - 1}`;
      if (f.s < 0 || o.s < 0) {
        out.push(`${leg} is not followed from ${name(k)} to ${name(k + 1)}: ${name(f.s < 0 ? k : k + 1)} stands on no floor`);
        return;
      }
      for (const [from, onward, nf, no] of [[f, o, k, k + 1], [o, f, k + 1, k]] as const) {
        const d = fieldAt(fields, fieldFrom(from), onward.x, onward.z, onward.s);
        if (d < 0 || d > t.follow * f.nominal) out.push(`${leg} is not followed from ${name(no)} to ${name(nf)}: ${d < 0 ? 'no way' : `${m(d)} m`} against ${f.nominal} m`);
      }
    }
  });

  const markers = markersOf(plan);
  for (const mk of markers) {
    const r = halls[mk.hall]!.rect;
    if (mk.x < r.x0 + 1 || mk.x > r.x1 - 1 || mk.z < r.z0 + 1 || mk.z > r.z1 - 1) {
      out.push(`markers: ${mk.name} (${m(mk.x)}, ${m(mk.z)}) is not inside ${halls[mk.hall]!.id} shrunk by 1 m`);
      continue;
    }
    const s = surfaceOf(mk.x, mk.z, mk.y);
    const surface = s >= 0 ? field.arena.walk[s]! : null;
    if (!surface) out.push(`markers: ${mk.name} (${m(mk.x)}, ${m(mk.z)}) stands on no Walk Surface`);
    else if (deadly(surface)) out.push(`markers: ${mk.name} (${m(mk.x)}, ${m(mk.z)}) stands on deadly ground (${deadly(surface)})`);
    else if (surface.roof) out.push(`markers: ${mk.name} (${m(mk.x)}, ${m(mk.z)}) stands on a roof`);
    else if (Math.abs(surfaceHeight(field.arena, s, mk.x, mk.z) - mk.y) > 1e-6) out.push(`markers: ${mk.name} (${m(mk.x)}, ${m(mk.z)}) is not at height ${m(mk.y)}`);
    else if (fieldAt(fields, fromEntrance, mk.x, mk.z, s) < 0) out.push(`markers: ${mk.name} (${m(mk.x)}, ${m(mk.z)}) is not reached from the Entrance`);
  }

  const spawns = plan.markers.spawns;
  for (const mk of markers) {
    if (mk.kind !== 'post' && mk.kind !== 'patrol' && mk.kind !== 'boss') continue;
    const seen = spawns.findIndex((sp) => inSight(fields, sp.x, sp.z, mk.x, mk.z, 0, sp.y, mk.y));
    if (seen >= 0) out.push(`sight: ${mk.name} (${halls[mk.hall]!.id}) is in sight of spawn${seen}`);
  }

  halls.forEach((h, k) => {
    const g = h.gallery;
    if (!g) return;
    const x = (g.deck.x0 + g.deck.x1) / 2;
    const z = (g.deck.z0 + g.deck.z1) / 2;
    const at = `galleries: ${h.id}'s Deck (${m(x)}, ${m(z)}) at ${m(g.y)}`;
    const s = surfaceOf(x, z, g.y);
    const surface = s >= 0 ? field.arena.walk[s]! : null;
    if (!surface) out.push(`${at} stands on no Walk Surface`);
    else if (surface.roof) out.push(`${at} is a roof`);
    else if (Math.abs(surfaceHeight(field.arena, s, x, z) - g.y) > 1e-6) out.push(`${at} is not at that height`);
    else if (fieldAt(fields, fromEntrance, x, z, s) < 0) out.push(`${at} is not reached from the Entrance`);
    else if (fieldAt(fields, to(k), x, z, s) < 0) out.push(`${at} does not lead down to ${h.id}'s centre`);
  });
  return out;
}

/** Rules 1 and 3 to 7 on a built Floor (the compile rule is the build's own throw). */
export function judgeBuilt(t: DelverFloorTuning, b: BuiltFloor): string[] {
  return [...judgePlan(t, b.plan, b.battle.field.size), ...judgeFields(t, b)];
}

/**
 * One attempt's judging, the only path to a verdict: rule 1 on the plan, and if it refuses, nothing is built (`built` absent). Else the
 * plan is built (a Map Source that does not compile is the `compile:` line, rule 2, and ends it) and rules 3 to 7 run: `judge` stands
 * in for them (a test's refusals). `reasons` are in the rules' order, none when the plan passes.
 */
export function judgeAttempt(
  tuning: Pick<TuningData, 'battle' | 'delver'>,
  plan: FloorPlan,
  judge: (t: DelverFloorTuning, b: BuiltFloor) => string[] = judgeFields,
): { reasons: string[]; built: BuiltFloor | undefined } {
  const t = tuning.delver.floor;
  const reasons = judgePlan(t, plan, tuning.battle.field.size);
  if (reasons.length > 0) return { reasons, built: undefined };
  let built: BuiltFloor;
  try {
    built = buildFloor(tuning, plan);
  } catch (e) {
    if (!(e instanceof MapCompileError)) throw e;
    return { reasons: [`compile: ${e.message}`], built: undefined };
  }
  return { reasons: judge(t, built), built };
}

/** All the rules on a plan (`judgeAttempt`). `built` is absent when rule 1 refused or it did not compile. */
export function judgeFloor(tuning: Pick<TuningData, 'battle' | 'delver'>, plan: FloorPlan): { judgement: FloorJudgement; built?: BuiltFloor } {
  const { reasons, built } = judgeAttempt(tuning, plan);
  return { judgement: { ok: reasons.length === 0, reasons }, ...(built ? { built } : {}) };
}
