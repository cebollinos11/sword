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
 *     And `shapes` (Stage 7b, plan-only, after `layout`): each Hall's rects and solids tile its rect; its centre is on its floor; every solid and pillar Wall is on an odd metre
 *     (off the fields' dots); every pillar stands on its Hall's floor; every marker keeps 1 m from its Hall's solids and pillars; and each Passage's doorway into a Hall is clear of them.
 *     And `features` (Stage 7c, plan-only, after `shapes`): a split or pit stands on a one-cell Hall that is no great hall, any feature on a rect Hall with no gallery, solid or pillar;
 *     a split's tiers tile its rect along its axis (one main tier at the Hall's level holding the centre, each other a level under it, at least `TIER_MIN` deep, each cut at least `SPLIT_CUT`
 *     from the centre); a pit's floor is the rect less `PIT_RIM` and its rims tile the rest (depth 2 or 4, rim at `y + depth`); a dais lies against a wall no Passage leaves by; every tier, rim,
 *     pit, dais and step edge is on an odd metre; each step lies in its Hall, between its two floors, at most `MAX_SLOPE`; each Passage's door height at a Hall is the height of that Hall's floor at
 *     that side (a gallery wall's Deck, a split's tier there, a pit's rim, else the Hall's); each doorway's lane is clear of every step and dais; and every marker keeps 1 m from every step and
 *     stands 1 m inside the floor part at its height.
 *  2. `compile`: the Map Source did not compile, `walkCheck` included (the other rules are then skipped; a plan rule 1 refused is not built).
 *  3. `halls`: the field from the Entrance's centre reaches every Hall's centre.
 *  4. `passages` (Stage 0's check), both ways and along every leg of the Passage itself (Stage 7a): the checkpoints are the point 1 m inside the first piece, each corner's
 *     centre, and the point 1 m inside the last piece (each on the Walk Surface at its own height); between each two the field is at most `follow` times the leg's length,
 *     and so is the reverse (a sloped leg is climbed and walked down). A straight Passage is one leg.
 *  5. `markers`: each marker stands in its Hall, on a Walk Surface at its own height (a Hall's floor or a Deck), off any hazard and no roof, and is reached from the Entrance.
 *  6. `sight`: no Warband post, patrol point or Boss post is in sight of an Entrance spawn (each at its own height).
 *  7. `galleries` (Stage 6): each gallery's Deck centre is a Walk Surface at the Deck's height that is no roof, reached from the Entrance, and its Hall's centre is reached from it.
 *
 *  8. `tiers` (Stage 7c, after `galleries`): for each Hall with a feature, each floor part's centre (each tier; a pit's floor and its first rim; a dais's top) is a Walk Surface at its
 *     height that is no roof, reached from the Entrance, and from which the Hall's centre is reached; and a pit's first rim is reached from its floor (the pit is left by walking).
 *     `galleries` also checks each wrap Deck's centre as it does the first Deck's.
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
import { DAIS_RISE, LEVEL_RISE, MAX_SLOPE, PIT_RIM, SPLIT_CUT, TIER_MIN, type DelverHall, type DelverPassage, type FloorPlan, type PassagePiece } from './plan';
import { pieceId, pillarId, solidId, stepId } from './source';
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
  out.push(...judgeShapes(plan));
  out.push(...judgeFeatures(plan));
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

/** The metres between rect `r` and the point (x, z): 0 inside or on it. */
const rectDistance = (r: Rect, x: number, z: number): number => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

/** Whether `v` is on an odd metre (a Wall there stands off the fields' 2 m dots). */
const odd = (v: number): boolean => Number.isInteger(v) && Math.abs(v % 2) === 1;

/** Whether rect `p` lies inside rect `q`, edges included. */
const inside = (p: Rect, q: Rect): boolean => p.x0 >= q.x0 && p.z0 >= q.z0 && p.x1 <= q.x1 && p.z1 <= q.z1;

const area = (r: Rect): number => (r.x1 - r.x0) * (r.z1 - r.z0);

/** A Hall's solids and pillars as named Blocks (the Brush ids `floorSource` writes). */
const blocksOf = (h: DelverHall): { id: string; rect: Rect; pillar: boolean }[] => [
  ...h.solids.map((rect, n) => ({ id: solidId(h, n), rect, pillar: false })),
  ...h.pillars.map((rect, n) => ({ id: pillarId(h, n), rect, pillar: true })),
];

/** How far (m) a doorway's lane is carried into its Hall. */
const DOORWAY_DEPTH = 3;

/** A doorway's lane: the edge of the Passage piece `r` at `side`, carried `DOORWAY_DEPTH` m outward into the Hall. */
function doorLane(r: Rect, side: Side): Rect {
  return side === 'w' ? { x0: r.x0 - DOORWAY_DEPTH, z0: r.z0, x1: r.x0, z1: r.z1 }
    : side === 'e' ? { x0: r.x1, z0: r.z0, x1: r.x1 + DOORWAY_DEPTH, z1: r.z1 }
    : side === 'n' ? { x0: r.x0, z0: r.z1, x1: r.x1, z1: r.z1 + DOORWAY_DEPTH }
    : { x0: r.x0, z0: r.z0 - DOORWAY_DEPTH, x1: r.x1, z1: r.z0 };
}

/**
 * The `shapes` rule (Stage 7b): what a plan's shaped and pillared Halls must keep. Each Hall's rects and solids lie inside its rect, share no interior and tile it; its centre is on
 * its floor (in a rect, in no solid or pillar); every solid and pillar edge is on an odd metre; every pillar stands inside one of its rects, clear of the solids; every marker keeps
 * 1 m from its Hall's solids and pillars; and each Passage's doorway into a Hall, carried 3 m inward, shares no interior with them.
 */
function judgeShapes(plan: FloorPlan): string[] {
  const out: string[] = [];
  const halls = plan.halls;
  const hallBlocks = halls.map(blocksOf);
  for (const [i, h] of halls.entries()) {
    const cut = [...h.rects, ...h.solids];
    const tiles = cut.every((r) => inside(r, h.rect)) && cut.every((r, i) => cut.every((o, j) => j <= i || !overlap(r, o))) && Math.abs(cut.reduce((s, r) => s + area(r), 0) - area(h.rect)) < 1e-6;
    if (!tiles) out.push(`shapes: ${h.id}'s rects and solids do not tile its rect`);
    const blocks = hallBlocks[i]!;
    const strictlyIn = (r: Rect) => h.cx > r.x0 && h.cx < r.x1 && h.cz > r.z0 && h.cz < r.z1;
    const onRect = h.rects.some((r) => h.cx >= r.x0 && h.cx <= r.x1 && h.cz >= r.z0 && h.cz <= r.z1);
    if (!onRect || blocks.some((b) => strictlyIn(b.rect))) out.push(`shapes: ${h.id}'s centre (${m(h.cx)}, ${m(h.cz)}) is not on its floor`);
    for (const b of blocks) {
      if (![b.rect.x0, b.rect.x1, b.rect.z0, b.rect.z1].every(odd)) out.push(`shapes: ${b.id} has a Wall on the field's dots`);
    }
    for (const b of blocks) {
      if (b.pillar && (!h.rects.some((r) => inside(b.rect, r)) || h.solids.some((s) => overlap(b.rect, s)))) out.push(`shapes: ${b.id} is not on ${h.id}'s floor`);
    }
  }
  for (const mk of markersOf(plan)) {
    const h = halls[mk.hall];
    if (!h) continue;
    for (const b of hallBlocks[mk.hall]!) if (rectDistance(b.rect, mk.x, mk.z) < 1) out.push(`shapes: ${mk.name} is within 1 m of ${b.id}`);
  }
  for (const p of plan.passages) {
    const first = p.pieces[0]!;
    const last = p.pieces[p.pieces.length - 1]!;
    for (const [hall, q, side] of [[p.a, first, first.from], [p.b, last, last.to]] as const) {
      const lane = doorLane(q.rect, side);
      const h = halls[hall];
      if (!h) continue;
      for (const b of hallBlocks[hall]!) if (overlap(lane, b.rect)) out.push(`shapes: ${p.id}'s doorway into ${h.id} is blocked by ${b.id}`);
    }
  }
  return out;
}

/** The Passage ends at a Hall: the Passage, the Hall's index, the piece at that end and the piece's side that meets the Hall (its lane's), the Hall's wall it leaves by, and its door height. */
function endsOf(plan: FloorPlan): { p: DelverPassage; hall: number; q: PassagePiece; side: Side; wall: Side; y: number }[] {
  return plan.passages.flatMap((p) => {
    const first = p.pieces[0]!;
    const last = p.pieces[p.pieces.length - 1]!;
    return [
      { p, hall: p.a, q: first, side: first.from, wall: p.sideA, y: p.ya },
      { p, hall: p.b, q: last, side: last.to, wall: p.sideB, y: p.yb },
    ];
  });
}

/** The height (m) of Hall `h`'s floor at its wall `side`: a gallery wall's Deck, a split's tier there (an end wall belongs to the end tier, a side wall to the main tier), a pit's rim, else the Hall's. */
function floorAt(h: DelverHall, side: Side): number {
  const f = h.feature;
  const g = h.gallery;
  if (g && (g.side === side || g.wrap?.walls.includes(side))) return g.y;
  if (f?.kind === 'pit') return f.rim;
  if (f?.kind === 'split') {
    const end = f.axis === 'x' ? (side === 'w' ? 0 : side === 'e' ? 1 : -1) : side === 's' ? 0 : side === 'n' ? 1 : -1;
    const tier = end < 0 ? f.tiers.find((t) => t.level === h.level) : f.tiers[end === 0 ? 0 : f.tiers.length - 1];
    return (tier ?? f.tiers[0]!).y;
  }
  return h.y;
}

/**
 * The `features` rule (Stage 7c): what a plan's splits, pits and daises must keep (see the module's rule 1), and, on every Floor, each Passage's door height at each end being its Hall's floor
 * there. Brush ids name the parts: `<hall>-tier` (the main tier; an outer tier is `<hall>-tier<n>` from 0 in tier order), `<hall>-pit`, `<hall>-rim<n>`, `<hall>-dais`, `<hall>-step<n>`.
 */
function judgeFeatures(plan: FloorPlan): string[] {
  const out: string[] = [];
  const halls = plan.halls;
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  for (const [k, h] of halls.entries()) {
    const f = h.feature;
    if (!f) continue;
    const plain = h.shape === 'rect' && !h.gallery && h.solids.length === 0 && h.pillars.length === 0;
    if (f.kind === 'dais' ? !plain : !(plain && h.cells.length === 1 && !h.great)) out.push(`features: ${h.id}'s ${f.kind} is not on a ${f.kind === 'dais' ? '' : 'one-cell '}rect Hall without a gallery`);
    // Each part's rect, named, for the odd-metre rule.
    const parts: { id: string; rect: Rect }[] = [];
    const r = h.rect;
    if (f.kind === 'split') {
      const alongX = f.axis === 'x';
      const span = (t: Rect): [number, number] => (alongX ? [t.x0, t.x1] : [t.z0, t.z1]);
      const across = (t: Rect): [number, number] => (alongX ? [t.z0, t.z1] : [t.x0, t.x1]);
      const [lo, hi] = span(r);
      const [a0, a1] = across(r);
      const c = alongX ? h.cx : h.cz;
      const main = f.tiers.filter((t) => t.level === h.level);
      let at = lo;
      let tiles = f.tiers.length >= 2 && f.tiers.length <= 3;
      for (const t of f.tiers) {
        const [p0, p1] = span(t.rect);
        const [q0, q1] = across(t.rect);
        if (!eq(p0, at) || p1 <= p0 || !eq(q0, a0) || !eq(q1, a1)) tiles = false;
        at = p1;
      }
      if (!eq(at, hi)) tiles = false;
      if (!tiles) out.push(`features: ${h.id}'s tiers do not tile its rect along ${f.axis}`);
      if (main.length !== 1) out.push(`features: ${h.id} has ${main.length} tiers at its level, one wanted`);
      else {
        const [p0, p1] = span(main[0]!.rect);
        if (!(p0 <= c && c <= p1)) out.push(`features: ${h.id}'s main tier does not hold its centre`);
        if (!eq(main[0]!.y, h.y)) out.push(`features: ${h.id}'s main tier is at ${m(main[0]!.y)}, its Hall at ${m(h.y)}`);
      }
      f.tiers.forEach((t, n) => {
        if (t.level === h.level) return;
        const [p0, p1] = span(t.rect);
        if (t.level !== h.level - 1 || !eq(t.y, h.y - LEVEL_RISE)) out.push(`features: ${h.id}'s tier ${n} is not a level under its main tier`);
        if (p1 - p0 < TIER_MIN) out.push(`features: ${h.id}'s tier ${n} is ${m(p1 - p0)} m deep, ${TIER_MIN} wanted`);
      });
      for (const t of f.tiers.slice(1)) {
        const cut = span(t.rect)[0];
        if (Math.abs(cut - c) < SPLIT_CUT) out.push(`features: ${h.id}'s cut at ${m(cut)} is under ${SPLIT_CUT} m from its centre`);
      }
      f.tiers.forEach((t, n) => parts.push({ id: t.level === h.level ? `${h.id}-tier` : `${h.id}-tier${n}`, rect: t.rect }));
    } else if (f.kind === 'pit') {
      const want: Rect = { x0: r.x0 + PIT_RIM, z0: r.z0 + PIT_RIM, x1: r.x1 - PIT_RIM, z1: r.z1 - PIT_RIM };
      if (!(eq(f.pit.x0, want.x0) && eq(f.pit.z0, want.z0) && eq(f.pit.x1, want.x1) && eq(f.pit.z1, want.z1))) out.push(`features: ${h.id}'s pit is not its rect less ${PIT_RIM} m`);
      const cut = [...f.rims, f.pit];
      const rimsTile = f.rims.every((q) => inside(q, r)) && cut.every((q, i) => cut.every((o, j) => j <= i || !overlap(q, o))) && eq(f.rims.reduce((a, q) => a + area(q), 0), area(r) - area(f.pit));
      if (!rimsTile) out.push(`features: ${h.id}'s rims do not tile its rect less its pit`);
      if (f.depth !== 2 && f.depth !== 4) out.push(`features: ${h.id}'s pit is ${f.depth} m deep, 2 or 4 wanted`);
      if (!eq(f.rim, h.y + f.depth)) out.push(`features: ${h.id}'s rim is at ${m(f.rim)}, ${m(h.y + f.depth)} wanted`);
      parts.push({ id: `${h.id}-pit`, rect: f.pit }, ...f.rims.map((rect, n) => ({ id: `${h.id}-rim${n}`, rect })));
    } else {
      const wall = f.side === 'n' ? eq(f.rect.z1, r.z1) : f.side === 's' ? eq(f.rect.z0, r.z0) : f.side === 'e' ? eq(f.rect.x1, r.x1) : eq(f.rect.x0, r.x0);
      if (!inside(f.rect, r) || !wall) out.push(`features: ${h.id}'s dais is not inside its rect against its ${f.side} wall`);
      if (plan.passages.some((p) => (p.a === k && p.sideA === f.side) || (p.b === k && p.sideB === f.side))) out.push(`features: ${h.id}'s dais stands against a wall a Passage leaves by`);
      if (!eq(f.y, h.y + DAIS_RISE)) out.push(`features: ${h.id}'s dais is at ${m(f.y)}, ${m(h.y + DAIS_RISE)} wanted`);
      parts.push({ id: `${h.id}-dais`, rect: f.rect });
    }
    const wanted = f.kind === 'split' ? f.tiers.length - 1 : f.kind === 'pit' ? 2 : 1;
    if (f.steps.length !== wanted) out.push(`features: ${h.id} has ${f.steps.length} steps, ${wanted} wanted`);
    f.steps.forEach((s, n) => parts.push({ id: stepId(h, n), rect: s.rect }));
    for (const q of parts) if (![q.rect.x0, q.rect.x1, q.rect.z0, q.rect.z1].every(odd)) out.push(`features: ${q.id} has a Wall on the field's dots`);
    // Each step: inside its Hall, rising at most `MAX_SLOPE` along `up`, from the lower floor to the higher.
    const outer = f.kind === 'split' ? f.tiers.filter((t) => t.level !== h.level) : [];
    f.steps.forEach((s, n) => {
      const id = stepId(h, n);
      if (!inside(s.rect, r)) out.push(`features: ${id} is not inside ${h.id}`);
      const length = s.up === 'e' || s.up === 'w' ? s.rect.x1 - s.rect.x0 : s.rect.z1 - s.rect.z0;
      if (!(length > 0) || (s.hi - s.lo) / length > MAX_SLOPE + 1e-9) out.push(`features: ${id} rises ${m(s.hi - s.lo)} m over ${m(length)} m, steeper than ${MAX_SLOPE}`);
      const lo = f.kind === 'split' ? outer[n]?.y : h.y;
      const hi = f.kind === 'split' ? h.y : f.kind === 'pit' ? f.rim : f.y;
      if (lo === undefined || !eq(s.lo, lo) || !eq(s.hi, hi)) out.push(`features: ${id} runs from ${m(s.lo)} to ${m(s.hi)}, its floors are ${lo === undefined ? 'none' : m(lo)} and ${m(hi)}`);
    });
  }
  // Each Passage's door at each end is at its Hall's floor there, and its doorway's lane is clear of the Hall's steps and dais.
  for (const { p, hall, q, side, wall, y } of endsOf(plan)) {
    const h = halls[hall];
    if (!h) continue;
    const floor = floorAt(h, wall);
    if (!eq(y, floor)) out.push(`features: ${p.id}'s door into ${h.id} is at ${m(y)}, its floor there at ${m(floor)}`);
    const f = h.feature;
    if (!f) continue;
    const lane = doorLane(q.rect, side);
    f.steps.forEach((s, n) => {
      if (overlap(lane, s.rect)) out.push(`features: ${p.id}'s doorway into ${h.id} is blocked by ${stepId(h, n)}`);
    });
    if (f.kind === 'dais' && overlap(lane, f.rect)) out.push(`features: ${p.id}'s doorway into ${h.id} is blocked by ${h.id}-dais`);
  }
  // Every marker keeps 1 m from each step and stands 1 m inside its floor part.
  for (const mk of markersOf(plan)) {
    const h = halls[mk.hall];
    const f = h?.feature;
    if (!h || !f) continue;
    f.steps.forEach((s, n) => {
      if (rectDistance(s.rect, mk.x, mk.z) < 1) out.push(`features: ${mk.name} stands within 1 m of ${stepId(h, n)}`);
    });
    const shrunk = (q: Rect): boolean => mk.x >= q.x0 + 1 && mk.x <= q.x1 - 1 && mk.z >= q.z0 + 1 && mk.z <= q.z1 - 1;
    const at = (y: number) => eq(mk.y, y);
    let [ok, what] = [shrunk(h.rect), 'wall'];
    if (f.kind === 'split') [ok, what] = [f.tiers.some((t) => at(t.y) && shrunk(t.rect)), 'tier edge'];
    else if (f.kind === 'pit' && at(h.y)) [ok, what] = [shrunk(f.pit), 'pit edge'];
    else if (f.kind === 'dais' && at(f.y)) [ok, what] = [shrunk(f.rect), 'dais edge'];
    // A marker on the floor of a dais Hall keeps 1 m off the dais: a cell centre under it has the dais's node only, so the floor's field never reaches it.
    else if (f.kind === 'dais') [ok, what] = [ok && rectDistance(f.rect, mk.x, mk.z) >= 1, ok ? 'dais' : what];
    if (!ok) out.push(`features: ${mk.name} stands within 1 m of ${h.id}'s ${what}`);
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

/** Rules 3 to 8 on a built Floor. */
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
    // The Deck, and each Deck of a wrap, in order.
    [g.deck, ...(g.wrap?.decks ?? [])].forEach((deck, n) => {
      const x = (deck.x0 + deck.x1) / 2;
      const z = (deck.z0 + deck.z1) / 2;
      const at = `galleries: ${h.id}'s Deck${n === 0 ? '' : ` ${n}`} (${m(x)}, ${m(z)}) at ${m(g.y)}`;
      const s = surfaceOf(x, z, g.y);
      const surface = s >= 0 ? field.arena.walk[s]! : null;
      if (!surface) out.push(`${at} stands on no Walk Surface`);
      else if (surface.roof) out.push(`${at} is a roof`);
      else if (Math.abs(surfaceHeight(field.arena, s, x, z) - g.y) > 1e-6) out.push(`${at} is not at that height`);
      else if (fieldAt(fields, fromEntrance, x, z, s) < 0) out.push(`${at} is not reached from the Entrance`);
      else if (fieldAt(fields, to(k), x, z, s) < 0) out.push(`${at} does not lead down to ${h.id}'s centre`);
    });
  });

  // Stage 7c: each feature Hall's floor parts. Each part's centre is a floor at its height, no roof, reached from the Entrance and leading to the Hall's centre; a pit's rim is reached from its floor.
  halls.forEach((h, k) => {
    const f = h.feature;
    if (!f) return;
    const mid = (r: Rect) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
    const parts = f.kind === 'split' ? f.tiers.map((t, n) => ({ name: `tier ${n}`, ...mid(t.rect), y: t.y }))
      : f.kind === 'pit' ? [{ name: 'floor', ...mid(f.pit), y: h.y }, { name: 'rim', ...mid(f.rims[0]!), y: f.rim }]
      : [{ name: 'dais', ...mid(f.rect), y: f.y }];
    for (const part of parts) {
      const at = `tiers: ${h.id}'s ${part.name} (${m(part.x)}, ${m(part.z)}) at ${m(part.y)}`;
      const s = floorNear(field.arena, part.x, part.z, part.y);
      const surface = s >= 0 ? field.arena.walk[s]! : null;
      if (!surface) out.push(`${at} stands on no Walk Surface`);
      else if (surface.roof) out.push(`${at} is a roof`);
      else if (Math.abs(surfaceHeight(field.arena, s, part.x, part.z) - part.y) > 1e-6) out.push(`${at} is not at that height`);
      else if (fieldAt(fields, fromEntrance, part.x, part.z, s) < 0) out.push(`${at} is not reached from the Entrance`);
      else if (fieldAt(fields, to(k), part.x, part.z, s) < 0) out.push(`${at} does not lead to ${h.id}'s centre`);
      else if (f.kind === 'pit' && part.name === 'rim' && fieldAt(fields, fieldFrom({ x: part.x, z: part.z, s }), centre[k]!.x, centre[k]!.z, centre[k]!.s) < 0) out.push(`tiers: ${h.id}'s rim is not reached from its floor`);
    }
  });
  return out;
}

/** Rules 1 and 3 to 8 on a built Floor (the compile rule is the build's own throw). */
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
