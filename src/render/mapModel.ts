/**
 * The model of a map made in the Map Editor (docs/plans/map-editor.md, Stage 5), generated from its Brushes with no Blender step, and what
 * Save exports as `public/models/arenas/battle_<map>.glb` (three.js `GLTFExporter`), so the game loads it as it loads a shipped map's
 * (`stage.ts` `battle()`). Render-only: the compiled map is what the Simulation reads; this only draws it.
 *
 * Built from the compiled draft (`compileDraft`), so it stands exactly where the Walk Surfaces and Walls do, each part in its Brush's material
 * (`look.ts`): every Walk Surface (a Hazard's in its own look), a Deck and an Enclosure's roof as a slab, each Wall the compiler stood (a Platform's and a raised
 * floor's faces, the skirts under raised edges, Rails, Walls) as a box on its line, each bank with no Wall (over lava) down to the floor beyond, each Ramp's open sides as its wedge (in place of the
 * stepped skirt the Simulation stands there), each Block as its box, the ground run on beyond the field's edge into the haze, then the props
 * (`mapProps.ts`) and their torches' lights. A Wall whose foot stands over lava is drawn down to it (`overLava`). One mesh per material. The root carries the map's sky (`userData.sky`), read back once loaded.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { DraftMap } from '../mapEditor/compile';
import { surfaceHeight, surfacesAt } from '../sim';
import { brushLook, groundOf, HAZARD_LOOKS, MAP_MODEL_ROOT, MATERIAL_LOOKS, materialOf, type MaterialLook } from '../mapEditor/look';
import { enclosureTop, type Brush, type EnclosureBrush, type MapSource, type RampBrush } from '../mapEditor/source';
import type { Vec2 } from '../sim';
import { stairCount, STEP_RISE, type WallSegment } from '../tuning';
import { MeshBuckets } from './meshBuckets';
import { placeProps } from './mapProps';
import { seamShade, type ShadedWall } from './seamShade';

/** How thick (m) each kind of Wall is drawn: a Wall Brush, a rail, and a face (a Platform's side, a skirt under a raised edge). */
const THICKNESS = { wall: 0.6, rail: 0.22, face: 0.3 };
/**
 * How thick (m) a Deck's slab is drawn under its floor, and an Enclosure's roof's over its roof: the roof's underside is then the
 * ceiling a head bumps (`ceilingAbove`) and the camera stops at (`CameraCollider`), so neither sinks into the slab.
 */
export const DECK_SLAB = 0.45;
/** A Ramp's wedge, and a Block, reach this far (m) under the floor they stand on, as the compiler's faces do. */
const BELOW = 1;
/** How far (m) beyond the field's edge the ground runs on (into the haze). */
const BEYOND = 700;
/** The ground beyond the field sits this far (m) under the field's own, so the two never fight for depth at the edge. */
const BEYOND_DROP = 0.02;

/** Heights this close (m) are one floor; a bank's side is drawn in pieces this long (m) along its edge, and probed this far (m) beyond it. */
const LEVEL_EPS = 0.05;
const BANK_PIECE = 0.5;
const BANK_PROBE = 0.25;

/** A Ramp's four corners at its heights: the foot's two (at `lo`) and the head's two (at `hi`), each pair in the same order along the slope's sides. */
function rampCorners(r: RampBrush): { foot: [THREE.Vector3, THREE.Vector3]; head: [THREE.Vector3, THREE.Vector3] } {
  const { x0, z0, x1, z1 } = r.rect;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  switch (r.up) {
    case 'n':
      return { foot: [v(x0, r.lo, z0), v(x1, r.lo, z0)], head: [v(x0, r.hi, z1), v(x1, r.hi, z1)] };
    case 's':
      return { foot: [v(x0, r.lo, z1), v(x1, r.lo, z1)], head: [v(x0, r.hi, z0), v(x1, r.hi, z0)] };
    case 'e':
      return { foot: [v(x0, r.lo, z0), v(x0, r.lo, z1)], head: [v(x1, r.hi, z0), v(x1, r.hi, z1)] };
    case 'w':
      return { foot: [v(x1, r.lo, z0), v(x1, r.lo, z1)], head: [v(x0, r.hi, z0), v(x0, r.hi, z1)] };
  }
}

/** The look of a floor's side: grass shows its dirt there; every other material is its own. */
const sideLook = (look: MaterialLook): MaterialLook => (look === MATERIAL_LOOKS.grass ? MATERIAL_LOOKS.dirt : look);

/** Whether the Wall `id` (owned by the Ramp `ramp`) is one step of its stepped skirt (`WALL_<ramp>_<side><n>`; its rail has no number). */
const isSkirt = (id: string, ramp: string): boolean => new RegExp(`^WALL_${ramp}_[nesw]\\d+$`).test(id);

/** Whether the Wall `id` is one of an Enclosure's sides (`WALL_<brush>_<side>d<n>`), not a face the compiler stood under a floor's edge. */
const isEnclosureSide = (id: string): boolean => /_[nesw]d\d+$/.test(id);

/** Whether Wall `e` holds Wall `w`: on the same line, over all of `w`'s length and heights. */
function holds(e: WallSegment, w: WallSegment): boolean {
  const onX = Math.abs(e.a.x - e.b.x) < LEVEL_EPS;
  if (onX !== Math.abs(w.a.x - w.b.x) < LEVEL_EPS) return false;
  if (Math.abs(onX ? e.a.x - w.a.x : e.a.z - w.a.z) > LEVEL_EPS) return false;
  const span = (s: WallSegment): [number, number] => (onX ? [Math.min(s.a.z, s.b.z), Math.max(s.a.z, s.b.z)] : [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)]);
  const [e0, e1] = span(e);
  const [w0, w1] = span(w);
  return e0 <= w0 + LEVEL_EPS && e1 >= w1 - LEVEL_EPS && e.bottom <= w.bottom + LEVEL_EPS && e.top >= w.top - LEVEL_EPS;
}

/** Whether the floor at `y` that Brush `b` lays is drawn as a slab over open space: a Deck's, and an Enclosure's roof. */
const isSlab = (b: Brush, y: number): boolean => b.kind === 'deck' || (b.kind === 'enclosure' && y > b.y + LEVEL_EPS);

/**
 * Where a Passage's piece opens into a Hall (a doorway in a Hall's side, the Passage's Walls standing on the doorway's jambs), the Hall's
 * Wall at each jamb stops this far (m) short, its end face then inside the Passage's Wall, and the Passage's Wall runs this far on, its end
 * face proud of the Hall's: else each end face lies in the other's inner face and the two fight for depth (the game's near plane is close,
 * and faces even a centimetre apart fight at range). A lip this small is not seen.
 */
const DOORWAY_NUDGE = 0.02;

/** One box of a Wall as drawn: its line's ends and its heights. */
interface WallPiece {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly bottom: number;
  readonly top: number;
}

/** The first Enclosure other than `b` whose rect holds the point (x, z) and passes `ok`, and its Walls' heights (from under its floor to its roof). */
function enclosureAt(source: MapSource, b: EnclosureBrush, x: number, z: number, ok: (r: EnclosureBrush['rect']) => boolean): [number, number] | null {
  for (const o of source.brushes) {
    if (o === b || o.kind !== 'enclosure') continue;
    const r = o.rect;
    if (x <= r.x0 || x >= r.x1 || z <= r.z0 || z >= r.z1 || !ok(r)) continue;
    return [o.y - BELOW, enclosureTop(o, source.levels) ?? o.y];
  }
  return null;
}

/**
 * Where an Enclosure's Wall `w` is drawn, `thick` thick: wholly outside its rect, its inner face on the Wall's line, so a body (which the
 * Simulation keeps a radius off the line) and the camera stop at the face seen rather than inside a slab centred on the line. Stretched
 * past each end on a corner of the rect by the thickness, so two sides meeting there close the corner outside, unless a doorway on the
 * other side reaches that corner (a Passage's piece, joined full width to the next or to a Hall): stretched, it would stand in the doorway
 * as a stub. Where a Passage meets a Hall at a doorway, each end is nudged (`DOORWAY_NUDGE`) over the heights of the other's Walls, so no
 * end face lies in the other's inner face. In pieces by height where the nudges hold over only some of it. Null (centred on its line, as any
 * other Wall) when another Enclosure stands on the far side of it within its height: the Wall is both rooms', its slab between them.
 */
function outsideEnclosure(b: EnclosureBrush, w: WallSegment, source: MapSource, thick: number): WallPiece[] | null {
  const { x0, z0, x1, z1 } = b.rect;
  const onX = Math.abs(w.a.x - w.b.x) < LEVEL_EPS;
  const line = onX ? w.a.x : w.a.z;
  const [lo, hi] = onX ? [x0, x1] : [z0, z1];
  // Out of the rect: away from its far side.
  const sign = Math.abs(line - hi) < Math.abs(line - lo) ? 1 : -1;
  const mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
  const probe = onX ? { x: line + sign * LEVEL_EPS, z: mid.z } : { x: mid.x, z: line + sign * LEVEL_EPS };
  const shared = source.brushes.some((o) => {
    if (o === b || o.kind !== 'enclosure') return false;
    const r = o.rect;
    if (probe.x <= r.x0 || probe.x >= r.x1 || probe.z <= r.z0 || probe.z >= r.z1) return false;
    const top = enclosureTop(o, source.levels) ?? o.y;
    return o.y - LEVEL_EPS < w.top && top + LEVEL_EPS > w.bottom;
  });
  if (shared) return null;
  const [along0, along1] = onX ? [z0, z1] : [x0, x1];
  // The side across the rect's corner at along0 and at along1, and how long each is.
  const across = onX ? (['s', 'n'] as const) : (['w', 'e'] as const);
  const acrossLength = onX ? x1 - x0 : z1 - z0;
  /** Whether the doorway (if any) of the side across the corner at `end` reaches within the thickness of that corner. */
  const doorAtCorner = (end: 0 | 1): boolean => (b.doors[across[end]] ?? 0) >= acrossLength - 2 * thick - LEVEL_EPS;
  const off = (sign * thick) / 2;
  const near = (p: number, q: number) => Math.abs(p - q) < LEVEL_EPS;
  // The rect's edges across the line (`t`, along it) and along it (`line`, across it), each as (lo, hi).
  const edgesAcross = (r: EnclosureBrush['rect']): [number, number] => (onX ? [r.z0, r.z1] : [r.x0, r.x1]);
  const edgesAlong = (r: EnclosureBrush['rect']): [number, number] => (onX ? [r.x0, r.x1] : [r.z0, r.z1]);
  const at = (t: number, across: number): [number, number] => (onX ? [across, t] : [t, across]);
  type End = { at: number; nudge: number; range: [number, number] | null };
  // Each end: where it stands (stretched away from the other end at a closed corner), and how far it is nudged on (+) or back (-) over which heights.
  const forward = Math.sign(onX ? w.b.z - w.a.z : w.b.x - w.a.x) || 1;
  const endOf = (p: Vec2, dir: number): End => {
    const t = onX ? p.z : p.x;
    const corner = near(t, along0) ? 0 : near(t, along1) ? 1 : null;
    if (corner !== null && !doorAtCorner(corner)) return { at: t + dir * thick, nudge: 0, range: null };
    if (corner !== null) {
      // A Passage's end at a doorway into a Hall: the Hall's side runs on across this line, past it both ways.
      const [x, z] = at(t + dir * 0.25, line - sign * 0.25);
      const hall = enclosureAt(source, b, x, z, (r) => edgesAcross(r).some((e) => near(e, t)) && edgesAlong(r)[0] < line - LEVEL_EPS && edgesAlong(r)[1] > line + LEVEL_EPS);
      return { at: t, nudge: hall ? DOORWAY_NUDGE : 0, range: hall };
    }
    // A Hall's jamb: a Passage beyond it, in the doorway and outside this rect, whose side Wall stands on this end.
    const [x, z] = at(t + dir * 0.25, line + sign * 0.25);
    const passage = enclosureAt(source, b, x, z, (r) => edgesAcross(r).some((e) => near(e, t)));
    return { at: t, nudge: passage ? -DOORWAY_NUDGE : 0, range: passage };
  };
  const ea = endOf(w.a, -forward);
  const eb = endOf(w.b, forward);
  const point = (t: number): Vec2 => (onX ? { x: line + off, z: t } : { x: t, z: line + off });
  // Cut the heights at the nudges' ranges; each band is nudged at the ends whose range holds it.
  const cuts = [w.bottom, w.top, ...[ea.range, eb.range].flatMap((r) => r ?? [])].filter((y) => y >= w.bottom && y <= w.top).sort((p, q) => p - q);
  const pieces: WallPiece[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [bottom, top] = [cuts[k]!, cuts[k + 1]!];
    if (top - bottom < LEVEL_EPS) continue;
    const y = (bottom + top) / 2;
    const nudge = (e: End) => (e.range !== null && y > e.range[0] && y < e.range[1] ? e.nudge : 0);
    pieces.push({ a: point(ea.at - forward * nudge(ea)), b: point(eb.at + forward * nudge(eb)), bottom, top });
  }
  return pieces;
}

/**
 * Wall `w`'s run `a` to `b` (heights `bottom` to `top`, `thick` thick) in pieces, each with the height it is drawn down to. Where a Wall's foot
 * stands over lava (the floor beside it, on either side and within its height, is a lava Walk Surface lower than the foot: a Hall's Enclosure
 * Wall, standing from a metre under its floor, over the end of a river or the length of a trough, the lava 4 m down) the piece is drawn down to
 * that lava's height, so no gap shows under it. Render only: the Simulation's Wall is as the compiler stood it. Null when no piece reaches lava
 * (every Wall of a map with none), so such a Wall is drawn whole, as it was.
 */
function overLava(draft: DraftMap, a: Vec2, b: Vec2, bottom: number, top: number, thick: number): { a: Vec2; b: Vec2; bottom: number; top?: number }[] | null {
  const { map, arena } = draft;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < LEVEL_EPS) return null;
  const pieces = Math.max(1, Math.round(len / BANK_PIECE));
  const [nx, nz] = [-(b.z - a.z) / len, (b.x - a.x) / len];
  const reach = thick / 2 + BANK_PROBE;
  const downs: number[] = [];
  let any = false;
  for (let n = 0; n < pieces; n++) {
    const t = (n + 0.5) / pieces;
    let down = bottom;
    for (const side of [-1, 1]) {
      const x = a.x + (b.x - a.x) * t + nx * reach * side;
      const z = a.z + (b.z - a.z) * t + nz * reach * side;
      // The highest floor under the Wall's top there: if it is lava below the foot, the Wall stands over lava.
      let best: { y: number; lava: boolean } | null = null;
      for (const j of surfacesAt(arena, x, z)) {
        // Not a roof (the Hall's own ceiling, which lies over the lava at the Wall's top and is no floor to stand on).
        if (map.walk[j]!.roof) continue;
        const y = surfaceHeight(arena, j, x, z);
        if (y <= top + LEVEL_EPS && (best === null || y > best.y)) best = { y, lava: !!map.walk[j]!.lava };
      }
      if (best?.lava && best.y < down - LEVEL_EPS) down = best.y;
    }
    downs.push(down);
    if (down < bottom) any = true;
  }
  if (!any) return null;
  const out: { a: Vec2; b: Vec2; bottom: number; top?: number }[] = [];
  const at = (t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  // A run drawn lower than its neighbour also reaches `thick` into it, under the neighbour's foot only, so no slit shows down the corner where
  // the run's end meets a pit's bank (the bank stands on the piece boundary, edge on to the gap a butt joint leaves).
  const over = thick / len;
  for (let n = 0; n < pieces; ) {
    let m = n + 1;
    while (m < pieces && downs[m] === downs[n]) m++;
    const down = downs[n]!;
    out.push({ a: at(n / pieces), b: at(m / pieces), bottom: down });
    if (n > 0 && downs[n - 1]! > down) out.push({ a: at(Math.max(0, n / pieces - over)), b: at(n / pieces), bottom: down, top: downs[n - 1]! });
    if (m < pieces && downs[m]! > down) out.push({ a: at(m / pieces), b: at(Math.min(1, m / pieces + over)), bottom: down, top: downs[m]! });
    n = m;
  }
  return out;
}

/**
 * How low (m) the side of Ramp `r`'s wedge from `p` to `q` (two corners on one edge of its rect) is drawn: `BELOW` under the lowest of the
 * floors beneath that edge, either side of it (each probe's highest floor no higher than the foot; not the Ramp's own slope, a roof or the
 * abyss), and never higher than `BELOW` under the foot. Render only, as `overLava`: the Simulation's skirt is as the compiler stood it.
 */
function wedgeBottom(draft: DraftMap, r: RampBrush, p: THREE.Vector3, q: THREE.Vector3): number {
  const { map, arena } = draft;
  const len = Math.hypot(q.x - p.x, q.z - p.z);
  const pieces = Math.max(1, Math.round(len / BANK_PIECE));
  const [nx, nz] = [-(q.z - p.z) / len, (q.x - p.x) / len];
  let low = r.lo;
  for (let n = 0; n < pieces; n++) {
    const t = (n + 0.5) / pieces;
    for (const side of [-1, 1]) {
      const x = p.x + (q.x - p.x) * t + nx * BANK_PROBE * side;
      const z = p.z + (q.z - p.z) * t + nz * BANK_PROBE * side;
      let best = -Infinity;
      for (const j of surfacesAt(arena, x, z)) {
        const w = map.walk[j]!;
        if (w.roof || w.abyss || draft.surfaceBrush[j] === r.id) continue;
        const y = surfaceHeight(arena, j, x, z);
        if (y <= r.lo + LEVEL_EPS && y > best) best = y;
      }
      if (best > -Infinity && best < low) low = best;
    }
  }
  return low - BELOW;
}

/** The model of `source` as compiled (`draft`, from `compileDraft(source, …)`): a group of one mesh per material, the torches' lights, and its sky. */
export function mapModel(source: MapSource, draft: DraftMap): THREE.Group {
  const buckets = new MeshBuckets();
  const brushes = new Map<string, Brush>(source.brushes.map((b) => [b.id, b]));
  const lookOf = (id: string) => {
    const b = brushes.get(id);
    return b ? brushLook(b, source) : MATERIAL_LOOKS.stone;
  };
  const { map } = draft;

  // The floors: each Walk Surface in its Brush's material, a Hazard's (and any deadly floor's) in its own look; a Deck's as a slab.
  map.walk.forEach((w, i) => {
    const owner = brushes.get(draft.surfaceBrush[i]!);
    const look = w.lava ? HAZARD_LOOKS.lava : w.water ? HAZARD_LOOKS.water : w.abyss ? HAZARD_LOOKS.abyss : lookOf(draft.surfaceBrush[i]!);
    const slab = !!owner && isSlab(owner, w.points[0]!.y);
    // A Ramp's slope is drawn as stairs below, not as a plane.
    if (!(slab && w.roof) && owner?.kind !== 'ramp') buckets.polygon(look, w.points);
    if (!slab) return;
    if (w.roof) {
      // A roof: its slab stands over it, its underside (the ceiling seen from inside) on the Walk Surface itself.
      const over = w.points.map((p) => ({ x: p.x, y: p.y + DECK_SLAB, z: p.z }));
      buckets.polygon(look, [...w.points].reverse());
      buckets.polygon(look, over);
      w.points.forEach((p, k) => {
        const q = w.points[(k + 1) % w.points.length]!;
        buckets.quad(look, over[k]!, over[(k + 1) % over.length]!, q, p);
      });
      return;
    }
    const under = w.points.map((p) => ({ x: p.x, y: p.y - DECK_SLAB, z: p.z }));
    buckets.polygon(look, [...under].reverse());
    w.points.forEach((p, k) => {
      const q = w.points[(k + 1) % w.points.length]!;
      buckets.quad(look, p, q, under[(k + 1) % under.length]!, under[k]!);
    });
  });

  // The banks: where a floor's edge drops to lower floor with no Wall the compiler stood there (a bank over lava, a step lower than a step
  // up), its side down to the floor beyond, so no gap shows under it. Not a Ramp's (its wedge) nor a Deck's (its slab, over open space).
  map.walk.forEach((w, i) => {
    const owner = brushes.get(draft.surfaceBrush[i]!);
    if (!owner || owner.kind === 'ramp' || isSlab(owner, w.points[0]!.y) || w.lava || w.water || w.abyss) return;
    const look = sideLook(lookOf(owner.id));
    const cx = w.points.reduce((t, p) => t + p.x, 0) / w.points.length;
    const cz = w.points.reduce((t, p) => t + p.z, 0) / w.points.length;
    w.points.forEach((p, k) => {
      const q = w.points[(k + 1) % w.points.length]!;
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      // Out of the surface, across this edge.
      let [nx, nz] = [(q.z - p.z) / len, -(q.x - p.x) / len];
      if (nx * ((p.x + q.x) / 2 - cx) + nz * ((p.z + q.z) / 2 - cz) < 0) [nx, nz] = [-nx, -nz];
      const pieces = Math.max(1, Math.round(len / BANK_PIECE));
      let run: { from: number; to: number; down: number } | null = null;
      const flush = () => {
        if (!run) return;
        const a = run.from / pieces;
        const b = run.to / pieces;
        const at = (t: number, y: number) => ({ x: p.x + (q.x - p.x) * t, y, z: p.z + (q.z - p.z) * t });
        buckets.quad(look, at(a, p.y + (q.y - p.y) * a), at(b, p.y + (q.y - p.y) * b), at(b, run.down), at(a, run.down));
        run = null;
      };
      for (let n = 0; n < pieces; n++) {
        const t = (n + 0.5) / pieces;
        const x = p.x + (q.x - p.x) * t + nx * BANK_PROBE;
        const z = p.z + (q.z - p.z) * t + nz * BANK_PROBE;
        const y = p.y + (q.y - p.y) * t;
        // Not a roof or a Deck over it (a Hall's ceiling over its lava pit, a gallery): a slab stands no side down to this floor.
        const beyond = surfacesAt(draft.arena, x, z)
          .filter((j) => {
            if (j === i || map.walk[j]!.roof) return false;
            const o = brushes.get(draft.surfaceBrush[j]!);
            const h = surfaceHeight(draft.arena, j, x, z);
            return !(o && isSlab(o, h) && h > y + LEVEL_EPS);
          })
          .map((j) => surfaceHeight(draft.arena, j, x, z));
        const below = beyond.filter((h) => h < y - LEVEL_EPS);
        // Nothing beyond (the field's edge), or floor beyond at this height or higher (whose own side, or a Wall, stands there): no bank.
        const down = beyond.length === 0 || beyond.some((h) => h >= y - LEVEL_EPS) ? null : Math.max(...below);
        if (down !== null && run && run.down === down && run.to === n) run.to = n + 1;
        else {
          flush();
          if (down !== null) run = { from: n, to: n + 1, down };
        }
      }
      flush();
    });
  });

  // The Walls the compiler stood, as boxes on their lines (the field's edge is open ground; a Ramp's skirt is drawn as its wedge below).
  // An Enclosure's sides are drawn first, so a face that one of them already holds (a roof's edge over a doorway's lintel) is not drawn again.
  const sides = map.walls.filter((w, i) => brushes.get(draft.wallBrush[i]!)?.kind === 'enclosure' && isEnclosureSide(w.id));
  // Every Wall box as drawn, and each Block's sides, for the shade where they meet floor and ceiling.
  const shaded: ShadedWall[] = [];
  const hasLava = map.walk.some((w) => w.lava);
  const wall = (look: MaterialLook, a: Vec2, b: Vec2, bottom: number, top: number, thick: number) => {
    // A Wall standing over lava is drawn down to it, in pieces (`overLava`).
    for (const p of (hasLava ? overLava(draft, a, b, bottom, top, thick) : null) ?? [{ a, b, bottom, top }]) {
      buckets.slab(look, p.a, p.b, p.bottom, p.top ?? top, thick);
      shaded.push({ a: p.a, b: p.b, bottom: p.bottom, top: p.top ?? top, thick });
    }
  };
  map.walls.forEach((w, i) => {
    const id = draft.wallBrush[i]!;
    const owner = brushes.get(id);
    if (!owner) return;
    if (owner.kind === 'ramp' && isSkirt(w.id, owner.id)) return;
    const thick = owner.kind === 'wall' || owner.kind === 'enclosure' ? THICKNESS.wall : owner.kind === 'rail' || owner.kind === 'ramp' ? THICKNESS.rail : THICKNESS.face;
    // An Enclosure's face (under its floor's edge, as at a doorway into a Gallery's Deck; a roof's edge): none where one of the Enclosures'
    // sides holds it, and its top just under the floor it reaches, which may lie on both sides of its line (the Deck's beyond the doorway).
    const face = owner.kind === 'enclosure' && !isEnclosureSide(w.id);
    if (face && sides.some((e) => holds(e, w))) return;
    const drawn = face ? { ...w, top: w.top - DOORWAY_NUDGE } : w;
    if (owner.kind === 'ramp') {
      // A Ramp's rail stops just short of each end, where it meets a Hall's Wall at a sloped Passage's mouth (or a Deck's side at a Gallery's head).
      const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
      const [ux, uz] = [((w.b.x - w.a.x) / len) * DOORWAY_NUDGE, ((w.b.z - w.a.z) / len) * DOORWAY_NUDGE];
      wall(lookOf(id), { x: w.a.x + ux, z: w.a.z + uz }, { x: w.b.x - ux, z: w.b.z - uz }, w.bottom, w.top, thick);
      return;
    }
    const out = owner.kind === 'enclosure' ? outsideEnclosure(owner, drawn, source, thick) : null;
    if (out) for (const p of out) wall(lookOf(id), p.a, p.b, p.bottom, p.top, thick);
    else wall(lookOf(id), drawn.a, drawn.b, drawn.bottom, drawn.top, thick);
  });

  for (const b of source.brushes) {
    const look = brushLook(b, source);
    // A Block from its floor (the map's lowest level: a Block stands only on a map of one) or the Simulation's -1 m, whichever is lower, to its top.
    if (b.kind === 'block') {
      const { x0, z0, x1, z1 } = b.rect;
      const bottom = Math.min(-BELOW, source.levels[0]! - BELOW);
      buckets.box(look, x0, bottom, z0, x1, b.top, z1);
      const corners = [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
      const centre = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
      corners.forEach((a, k) => shaded.push({ a, b: corners[(k + 1) % 4]!, bottom, top: b.top, thick: 0, centre }));
    }
    if (b.kind !== 'ramp') continue;
    // A Ramp's wedge: each long side up to the slope, its head's end up to its top and its foot's end up to its foot, each from under the
    // floor beneath it (`wedgeBottom`): a Ramp whose foot stands over a lower floor (a level 1 to 2 Ramp in a room floored at 0) is solid
    // down to it, as the compiler's skirt and foot face are (which are not drawn: this wedge stands in their place).
    const { foot, head } = rampCorners(b);
    const down = (p: THREE.Vector3, y: number) => new THREE.Vector3(p.x, y, p.z);
    // Drawn as stairs (the walk surface stays a slope for collision and pathing): each step's tread, its riser, and its side from the wedge's bottom.
    const steps = stairCount(b.lo, b.hi, STEP_RISE);
    const at = (k: 0 | 1, t: number, y: number) => new THREE.Vector3(foot[k].x + (head[k].x - foot[k].x) * t, y, foot[k].z + (head[k].z - foot[k].z) * t);
    const yb = [0, 1].map((k) => wedgeBottom(draft, b, foot[k]!, head[k]!)) as [number, number];
    const run = new THREE.Vector3().subVectors(head[0], foot[0]).setY(0).normalize();
    const across = new THREE.Vector3().subVectors(foot[1], foot[0]).setY(0).normalize();
    // A quad a-b-c-d, wound to face `n`.
    const facing = (a: THREE.Vector3, bb: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3) => {
      const normal = new THREE.Vector3().subVectors(bb, a).cross(new THREE.Vector3().subVectors(c, a));
      if (normal.dot(n) >= 0) buckets.quad(look, a, bb, c, d);
      else buckets.quad(look, d, c, bb, a);
    };
    const up = new THREE.Vector3(0, 1, 0);
    for (let n = 0; n < steps; n++) {
      const [t0, t1] = [n / steps, (n + 1) / steps];
      const top = b.lo + ((n + 1) / steps) * (b.hi - b.lo);
      const prev = b.lo + (n / steps) * (b.hi - b.lo);
      facing(at(0, t0, top), at(1, t0, top), at(1, t1, top), at(0, t1, top), up);
      facing(at(0, t0, prev), at(1, t0, prev), at(1, t0, top), at(0, t0, top), run.clone().negate());
      for (const k of [0, 1] as const) {
        const out = across.clone().multiplyScalar(k === 0 ? -1 : 1);
        facing(at(k, t0, yb[k]), at(k, t1, yb[k]), at(k, t1, top), at(k, t0, top), out);
      }
    }
    const yh = wedgeBottom(draft, b, head[0], head[1]);
    buckets.quad(look, down(head[0], yh), down(head[1], yh), head[1], head[0]);
    const yf = wedgeBottom(draft, b, foot[1], foot[0]);
    buckets.quad(look, down(foot[1], yf), down(foot[0], yf), foot[0], foot[1]);
  }

  // The ground beyond the field: four strips round it at the ground's height (the first Floor's; else the lowest walkable floor's), in its material.
  const groundBrush = groundOf(source);
  const safe = map.walk.filter((w) => !w.lava && !w.water && !w.abyss).flatMap((w) => w.points.map((p) => p.y));
  const groundY = (groundBrush?.kind === 'floor' ? groundBrush.y : safe.length > 0 ? Math.min(...safe) : 0) - BEYOND_DROP;
  const ground = MATERIAL_LOOKS[groundBrush ? materialOf(groundBrush, source) : 'grass'];
  const h = source.size / 2;
  const far = h + BEYOND;
  const v = (x: number, z: number) => ({ x, y: groundY, z });
  buckets.quad(ground, v(-far, -far), v(far, -far), v(far, -h), v(-far, -h));
  buckets.quad(ground, v(-far, h), v(far, h), v(far, far), v(-far, far));
  buckets.quad(ground, v(-far, -h), v(-h, -h), v(-h, h), v(-far, h));
  buckets.quad(ground, v(h, -h), v(far, -h), v(far, h), v(h, h));

  // Each prop stands on the floor nearest under the height it names (the level it was placed at), as an Objective does: a tree placed while
  // editing the keep's level but out on the field stands on the ground, one on a Ramp on its slope.
  const props = (source.look?.props ?? []).map((p) => {
    const under = surfacesAt(draft.arena, p.x, p.z)
      .map((j) => surfaceHeight(draft.arena, j, p.x, p.z))
      .filter((y) => y <= p.y + LEVEL_EPS);
    return under.length > 0 ? { ...p, y: Math.max(...under) } : p;
  });
  const lights = placeProps(props, buckets);
  const root = new THREE.Group();
  root.name = MAP_MODEL_ROOT;
  // The shade where Walls meet floor and ceiling: none on deadly ground; a roof's ceiling is its own underside, a Deck's its slab's.
  const shade = seamShade(
    draft.arena,
    shaded,
    (i) => !!(map.walk[i]!.lava || map.walk[i]!.water || map.walk[i]!.abyss),
    (i) => {
      const w = map.walk[i]!;
      if (w.roof) return 0;
      const owner = brushes.get(draft.surfaceBrush[i]!);
      return owner && isSlab(owner, w.points[0]!.y) ? DECK_SLAB : null;
    },
  );
  root.add(...buckets.meshes(), ...(shade ? [shade] : []), ...lights);
  root.userData = { sky: source.look?.sky ?? 'dusk' };
  return root;
}

/** The model as a `.glb` file (binary glTF), what Save writes to `public/models/arenas/battle_<map>.glb`. */
export async function exportMapModel(model: THREE.Object3D): Promise<ArrayBuffer> {
  const out = await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: true });
  if (!(out instanceof ArrayBuffer)) throw new Error('GLTFExporter did not give a binary file');
  return out;
}
