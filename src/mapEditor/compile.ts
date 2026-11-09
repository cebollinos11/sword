/**
 * The Map Compiler (docs/plans/map-editor.md, Stage 0): a Map Source (`source.ts`) in, an ordinary `BattleMapTuning` out, as the Python
 * generators (`art/build_battle_<map>.py`) make one from their rasters. Nothing the Simulation reads is new: a compiled map is just another
 * `data/battlemaps/<map>.json`, and the compiler hands its output to the game's own checks (`parseBattleMap`, `walkCheck`), so it can never
 * give a map the game refuses.
 *
 * How (all on the source's fine grid, one raster per level):
 *  - **Paint**: each Brush in order paints the cells of its rectangle. A Floor, Deck or Hazard lays its floor at its level; a Platform cuts
 *    out every floor under its top and lays its top. A Hole takes away, at its level, what the Brushes before it laid there (a Platform
 *    wholly, so its ground comes back). Then, whatever their order, each Ramp cuts out the floors from its foot to below its top and each
 *    Block every floor under its top.
 *  - **Walk Surfaces**: each Brush's cells at its level are merged into rectangles (row by row from the south-west, each as wide and then
 *    as deep as it goes), `WALK_<brush>_<n>`; each Ramp is one sloped quad, `WALK_<ramp>`.
 *  - **Walls** (ADR 0014's and the generators' rules): the field's four edges (`WALL_edge_<side>`); a face under every edge of a floor where
 *    the ground beside it is higher than a step (so nobody walks under a raised floor or into a Platform's side), owned by the higher Brush
 *    (`WALL_<brush>_<side><n>`, merged along each line); on each Ramp's long sides a rail, or else a skirt stepped up the slope (each step
 *    no higher than `battle.levels.stepUp`, so nobody on the ramp is stopped by it and nobody beside it walks under); each Rail and Wall.
 *  - **Blocks**, Objectives, Bases and the settings carry straight through.
 *
 * Pure and deterministic: no trig, no `Math.random`, every tie broken by Brush order then row-major cell order, so the same source always
 * compiles to the same bytes, and every id comes from a Brush id, so a small edit gives a small diff.
 */
import { parseBattleMap, type ArenaGeometry, type ArenaPoint, type BattleMapTuning, type BattleTuning, type WalkSurface, type WallBlock, type WallSegment } from '../tuning';
import { TuningDataError } from '../tuning/validate';
import { blockWalls } from '../sim/battlefield';
import { walkCheck } from '../sim/levels';
import { RAIL, SIDES, type Brush, type MapSource, type RampBrush, type Rect, type Side } from './source';

/** Something the compiler noticed that the game accepts but the author likely did not mean. */
export interface CompileWarning {
  readonly message: string;
  /** The Brush it concerns, when one does. */
  readonly brush?: string;
}

/** The source cannot compile to a map the game accepts: `brushes` are the ids of the Brushes the error concerns (none when it is a marker or a setting). */
export class MapCompileError extends Error {
  override name = 'MapCompileError';
  constructor(
    message: string,
    readonly brushes: readonly string[] = [],
  ) {
    super(message);
  }
}

export interface CompiledMap {
  readonly map: BattleMapTuning;
  readonly warnings: readonly CompileWarning[];
}

/** Heights this close (m) are equal. */
const EPS = 1e-9;
/** A face Wall starts this far (m) under the floor it rises from, as the generators' do. */
const BELOW = 1;
/** The field's edge Walls rise this far (m) over the highest floor. */
const EDGE_OVER = 4;
/** Where the Simulation's Walls round a Block start (`blockWalls`). */
const BLOCK_BOTTOM = -1;
/** The most levels a source may have (a cell's levels are a bit mask). */
const MAX_LEVELS = 31;

/** A step across a cell's side: east, north, west, south as (di, dj), and the side of the cell it leaves by. */
const DIRS: readonly { readonly di: number; readonly dj: number; readonly side: Side }[] = [
  { di: 1, dj: 0, side: 'e' },
  { di: 0, dj: 1, side: 'n' },
  { di: -1, dj: 0, side: 'w' },
  { di: 0, dj: -1, side: 's' },
];
const OPPOSITE: Readonly<Record<Side, Side>> = { n: 's', s: 'n', e: 'w', w: 'e' };
const SIDE_ORDER: Readonly<Record<Side, number>> = { n: 0, e: 1, s: 2, w: 3 };

/** A Brush's rectangle in cells: i from i0 to i1 - 1 (x), j from j0 to j1 - 1 (z). */
interface CellRect {
  readonly i0: number;
  readonly j0: number;
  readonly i1: number;
  readonly j1: number;
}

/** A face Wall along one cell side, before merging: on the line `axis` = `line` (in cells), from `a` to `b` (cells) along it. */
interface FacePiece {
  readonly owner: number;
  readonly side: Side;
  readonly axis: 'x' | 'z';
  readonly line: number;
  readonly a: number;
  readonly b: number;
  readonly bottom: number;
  readonly top: number;
}

/** The height a Brush lays its floor at, for the kinds that lay one. */
const floorLevel = (b: Brush): number | null => (b.kind === 'floor' || b.kind === 'deck' || b.kind === 'hazard' ? b.y : b.kind === 'platform' ? b.top : null);

const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

/** The ramp's slope axis, and whether its height rises along that axis (toward + x or + z). */
const slopeOf = (r: RampBrush): { axis: 'x' | 'z'; rising: boolean } => ({ axis: r.up === 'e' || r.up === 'w' ? 'x' : 'z', rising: r.up === 'e' || r.up === 'n' });

/** A ramp's height at a corner of its rectangle (exactly `lo` or `hi`: no division). */
function rampCorner(r: RampBrush, x: number, z: number): number {
  const { axis, rising } = slopeOf(r);
  const atHigh = axis === 'x' ? (rising ? x === r.rect.x1 : x === r.rect.x0) : rising ? z === r.rect.z1 : z === r.rect.z0;
  return atHigh ? r.hi : r.lo;
}

/**
 * Compile `source` into a Battle map for `battle` (its field, army layout and walk rule). Throws MapCompileError naming the Brushes
 * concerned when the source is inconsistent or the game would refuse the map (`parseBattleMap`, `walkCheck`).
 */
export function compileMap(source: MapSource, battle: Pick<BattleTuning, 'field' | 'deploy' | 'squad' | 'levels'>): CompiledMap {
  const warnings: CompileWarning[] = [];
  const { brushes, levels } = source;
  const step = source.grid.step;
  const half = source.size / 2;
  if (source.size !== battle.field.size) throw new MapCompileError(`the map is ${source.size} m a side, but a Battle's field is ${battle.field.size} m`);
  if (levels.length > MAX_LEVELS) throw new MapCompileError(`a map has at most ${MAX_LEVELS} levels, this one ${levels.length}`);
  const stepUp = battle.levels.stepUp;
  const N = Math.round(source.size / step);
  const levelOf = new Map(levels.map((y, l) => [y, l]));
  const cellsOf = (r: Rect): CellRect => ({ i0: Math.round((r.x0 + half) / step), j0: Math.round((r.z0 + half) / step), i1: Math.round((r.x1 + half) / step), j1: Math.round((r.z1 + half) / step) });
  const xAt = (i: number) => i * step - half;
  const zAt = (j: number) => j * step - half;

  // Rectangles that must not overlap: a Ramp with any other Ramp, a Block with any Ramp, a Platform with a Ramp that does not stand on it.
  brushes.forEach((r, k) => {
    if (r.kind !== 'ramp') return;
    brushes.forEach((b, m) => {
      if (m === k || !('rect' in b) || !overlaps(r.rect, b.rect)) return;
      if (b.kind === 'ramp' && m < k) throw new MapCompileError(`Ramps ${b.id} and ${r.id} overlap`, [b.id, r.id]);
      if (b.kind === 'block') throw new MapCompileError(`Block ${b.id} overlaps Ramp ${r.id}`, [b.id, r.id]);
      if (b.kind === 'platform' && b.top > r.lo + EPS) throw new MapCompileError(`Platform ${b.id} (top ${b.top}) stands through Ramp ${r.id} (from ${r.lo})`, [b.id, r.id]);
    });
  });

  // What later Holes take away from each Brush that lays a floor: its cells (rect-local, 1 = taken) where a Hole at its level comes after it.
  const masks = new Map<number, Uint8Array>();
  brushes.forEach((b, k) => {
    const y = floorLevel(b);
    if (y === null || !('rect' in b)) return;
    const cr = cellsOf(b.rect);
    const w = cr.i1 - cr.i0;
    for (let h = k + 1; h < brushes.length; h++) {
      const hole = brushes[h]!;
      if (hole.kind !== 'hole' || hole.y !== y || !overlaps(hole.rect, b.rect)) continue;
      let mask = masks.get(k);
      if (!mask) masks.set(k, (mask = new Uint8Array(w * (cr.j1 - cr.j0))));
      const hr = cellsOf(hole.rect);
      for (let j = Math.max(cr.j0, hr.j0); j < Math.min(cr.j1, hr.j1); j++) for (let i = Math.max(cr.i0, hr.i0); i < Math.min(cr.i1, hr.i1); i++) mask[(j - cr.j0) * w + (i - cr.i0)] = 1;
    }
  });
  brushes.forEach((hole, h) => {
    if (hole.kind !== 'hole') return;
    if (!brushes.some((b, k) => k < h && floorLevel(b) === hole.y && 'rect' in b && overlaps(b.rect, hole.rect)))
      warnings.push({ message: `Hole ${hole.id} takes nothing away: no Brush before it lays floor at ${hole.y} under it`, brush: hole.id });
  });

  // Paint. `own[l][c]` is 1 + the Brush whose floor stands at level l in cell c (0: none); `ramp[c]` the Ramp over cell c (-1: none).
  const own = levels.map(() => new Int32Array(N * N));
  const ramp = new Int32Array(N * N).fill(-1);
  const each = (r: Rect, k: number, f: (c: number) => void) => {
    const cr = cellsOf(r);
    const mask = masks.get(k);
    const w = cr.i1 - cr.i0;
    for (let j = cr.j0; j < cr.j1; j++)
      for (let i = cr.i0; i < cr.i1; i++) if (!mask || !mask[(j - cr.j0) * w + (i - cr.i0)]) f(j * N + i);
  };
  const cutBelow = (c: number, top: number, from = -Infinity) => {
    for (let l = 0; l < levels.length; l++) if (levels[l]! < top - EPS && levels[l]! >= from - EPS) own[l]![c] = 0;
  };
  brushes.forEach((b, k) => {
    switch (b.kind) {
      case 'floor':
      case 'deck':
      case 'hazard': {
        const l = levelOf.get(b.y)!;
        each(b.rect, k, (c) => (own[l]![c] = k + 1));
        break;
      }
      case 'platform': {
        const l = levelOf.get(b.top)!;
        each(b.rect, k, (c) => {
          cutBelow(c, b.top);
          own[l]![c] = k + 1;
        });
        break;
      }
      default:
        break;
    }
  });
  // A Ramp's wedge and a Block are solid whatever order they come in: they cut out the floors under them after every Brush is painted.
  const block = new Uint8Array(N * N);
  brushes.forEach((b, k) => {
    if (b.kind === 'ramp')
      each(b.rect, k, (c) => {
        cutBelow(c, b.hi, b.lo);
        ramp[c] = k;
      });
    if (b.kind !== 'block') return;
    // A Block stands on one floor, and nothing stands over it or inside it (a Deck laid across it is refused, whatever the order).
    let lowest = Infinity;
    each(b.rect, k, (c) => {
      for (let l = 0; l < levels.length; l++) if (own[l]![c]) lowest = Math.min(lowest, levels[l]!);
    });
    each(b.rect, k, (c) => {
      for (let l = 0; l < levels.length; l++) {
        const o = own[l]![c]!;
        if (o && levels[l]! > lowest + EPS) throw new MapCompileError(`Block ${b.id} stands under ${brushes[o - 1]!.id} (at ${levels[l]}): nothing may stand over a Block (make it a Platform)`, [b.id, brushes[o - 1]!.id]);
      }
      cutBelow(c, Infinity);
      block[c] = 1;
    });
    // The Simulation stands its Walls from BLOCK_BOTTOM to its top: they must stand across a body on that floor.
    if (lowest < Infinity && (lowest + battle.levels.height <= BLOCK_BOTTOM + EPS || b.top <= lowest + stepUp + EPS))
      throw new MapCompileError(`Block ${b.id} stands on floor at ${lowest}, but a Block's Walls stand from ${BLOCK_BOTTOM} to its top (${b.top}): make it a Platform`, [b.id]);
  });

  // Nothing stands in a Ramp's way from its foot to a body's height over its top.
  brushes.forEach((b, k) => {
    if (b.kind !== 'ramp') return;
    each(b.rect, k, (c) => {
      for (let l = 0; l < levels.length; l++) {
        const o = own[l]![c]!;
        if (!o) continue;
        const y = levels[l]!;
        const other = brushes[o - 1]!;
        if (y >= b.lo - EPS && y <= b.hi + battle.levels.height + EPS) throw new MapCompileError(`${other.id} lays floor at ${y} in the way of Ramp ${b.id} (${b.lo} to ${b.hi})`, [b.id, other.id]);
      }
    });
  });

  // Each cell's levels as a bit mask, for the quick test that a neighbour's floors are the same as a cell's.
  const present = new Int32Array(N * N);
  own.forEach((o, l) => {
    for (let c = 0; c < N * N; c++) if (o[c]) present[c]! |= 1 << l;
  });
  const deadlyOwner = (o: number) => brushes[o - 1]!.kind === 'hazard';

  // Walk Surfaces: per level, each Brush's cells merged into rectangles.
  const rects: { l: number; i0: number; j0: number; i1: number; j1: number }[][] = brushes.map(() => []);
  own.forEach((o, l) => {
    const used = new Uint8Array(N * N);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const c = j * N + i;
        const k = o[c]!;
        if (!k || used[c]) continue;
        let i1 = i + 1;
        while (i1 < N && o[j * N + i1] === k && !used[j * N + i1]) i1++;
        let j1 = j + 1;
        for (; j1 < N; j1++) {
          let full = true;
          for (let x = i; x < i1 && full; x++) full = o[j1 * N + x] === k && !used[j1 * N + x];
          if (!full) break;
        }
        for (let z = j; z < j1; z++) for (let x = i; x < i1; x++) used[z * N + x] = 1;
        rects[k - 1]!.push({ l, i0: i, j0: j, i1, j1 });
      }
  });
  const walk: WalkSurface[] = [];
  const surfaceBrush: string[] = [];
  brushes.forEach((b, k) => {
    if (b.kind === 'ramp') {
      const { x0, z0, x1, z1 } = b.rect;
      const corner = (x: number, z: number): ArenaPoint => ({ x, y: rampCorner(b, x, z), z });
      walk.push({ id: `WALK_${b.id}`, points: [corner(x0, z0), corner(x1, z0), corner(x1, z1), corner(x0, z1)] });
      surfaceBrush.push(b.id);
      return;
    }
    if (floorLevel(b) === null) return;
    if (rects[k]!.length === 0) warnings.push({ message: `${b.id} lays no floor: every cell of it is painted over or taken away`, brush: b.id });
    rects[k]!.forEach((r, n) => {
      const y = levels[r.l]!;
      const points = [
        { x: xAt(r.i0), y, z: zAt(r.j0) },
        { x: xAt(r.i1), y, z: zAt(r.j0) },
        { x: xAt(r.i1), y, z: zAt(r.j1) },
        { x: xAt(r.i0), y, z: zAt(r.j1) },
      ];
      walk.push(b.kind === 'hazard' ? { id: `WALK_${b.id}_${n}`, points, [b.hazard]: true } : { id: `WALK_${b.id}_${n}`, points });
      surfaceBrush.push(b.id);
    });
  });

  // Face Walls. `candidates` are the floors across a cell's side from it: the neighbour's levels, and a Ramp's end if the side is one.
  const pieces: FacePiece[] = [];
  const overNothing = new Set<number>();
  const rampEnd = (r: RampBrush, side: Side): number | null => (side === r.up ? r.hi : side === OPPOSITE[r.up] ? r.lo : null);
  /** The floors of cell n as seen from cell c across n's side `side`, into `out` as [height, owner]; false when that side is a Ramp's long side. */
  const across = (c: number, n: number, side: Side, out: [number, number][]): boolean => {
    out.length = 0;
    const m = present[n]!;
    if (m) for (let l = 0; l < levels.length; l++) if (m & (1 << l)) out.push([levels[l]!, own[l]![n]!]);
    const r = ramp[n]!;
    if (r < 0 || ramp[c] === r) return true;
    const end = rampEnd(brushes[r] as RampBrush, side);
    if (end === null) return false;
    out.push([end, r + 1]);
    return true;
  };
  const seen: [number, number][] = [];
  /** The face (if any) on the side `dir` of cell (i, j) for a body on its floor at `y` owned by `from`. */
  const faceFrom = (i: number, j: number, y: number, from: number, dir: (typeof DIRS)[number]) => {
    const ni = i + dir.di;
    const nj = j + dir.dj;
    if (ni < 0 || nj < 0 || ni >= N || nj >= N) return;
    const side = OPPOSITE[dir.side];
    if (!across(j * N + i, nj * N + ni, side, seen)) return;
    let top = Infinity;
    let owner = 0;
    for (const [h, o] of seen) {
      if (Math.abs(h - y) <= stepUp + EPS) return;
      if (h > y && h < top) [top, owner] = [h, o];
    }
    if (seen.length === 0 && !block[nj * N + ni]) overNothing.add(from);
    if (owner === 0) return;
    const axis = dir.di !== 0 ? 'x' : 'z';
    const line = dir.di > 0 ? i + 1 : dir.di < 0 ? i : dir.dj > 0 ? j + 1 : j;
    const a = axis === 'x' ? j : i;
    pieces.push({ owner: owner - 1, side, axis, line, a, b: a + 1, bottom: y - BELOW, top });
  };
  own.forEach((o, l) => {
    const y = levels[l]!;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const c = j * N + i;
        const k = o[c]!;
        if (!k || deadlyOwner(k)) continue;
        for (const dir of DIRS) {
          const ni = i + dir.di;
          const nj = j + dir.dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const n = nj * N + ni;
          if (present[n] === present[c] && ramp[n]! < 0) continue;
          faceFrom(i, j, y, k, dir);
        }
      }
  });
  // A Ramp's ends are floors at its foot and its top, seen across that end only.
  brushes.forEach((b, k) => {
    if (b.kind !== 'ramp') return;
    const cr = cellsOf(b.rect);
    for (const side of [b.up, OPPOSITE[b.up]]) {
      const y = side === b.up ? b.hi : b.lo;
      const dir = DIRS.find((d) => d.side === side)!;
      const cells: [number, number][] = [];
      if (side === 'e' || side === 'w') for (let j = cr.j0; j < cr.j1; j++) cells.push([side === 'e' ? cr.i1 - 1 : cr.i0, j]);
      else for (let i = cr.i0; i < cr.i1; i++) cells.push([i, side === 'n' ? cr.j1 - 1 : cr.j0]);
      for (const [i, j] of cells) faceFrom(i, j, y, k + 1, dir);
    }
  });
  // A Ramp's long sides: a face where the floor beside is higher than the slope there, and a rail or a stepped skirt where it is lower.
  const rampWalls: WallSegment[][] = brushes.map(() => []);
  brushes.forEach((b, k) => {
    if (b.kind !== 'ramp') return;
    const cr = cellsOf(b.rect);
    const { axis, rising } = slopeOf(b);
    const m = axis === 'x' ? cr.i1 - cr.i0 : cr.j1 - cr.j0;
    const rise = b.hi - b.lo;
    // The slope's height at t cells from the ramp's foot.
    const at = (t: number) => b.lo + (rise * t) / m;
    for (const side of SIDES) {
      if (side === b.up || side === OPPOSITE[b.up]) continue;
      const dir = DIRS.find((d) => d.side === side)!;
      // Per cell along the side from the foot: the lowest floor beside it, and whether any floor lies there at all.
      const lowest: number[] = [];
      for (let t = 0; t < m; t++) {
        const u = rising ? t : m - 1 - t;
        const i = axis === 'x' ? cr.i0 + u : side === 'e' ? cr.i1 - 1 : cr.i0;
        const j = axis === 'z' ? cr.j0 + u : side === 'n' ? cr.j1 - 1 : cr.j0;
        const ni = i + dir.di;
        const nj = j + dir.dj;
        lowest.push(Infinity);
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const n = nj * N + ni;
        across(j * N + i, n, OPPOSITE[side], seen);
        let top = Infinity;
        let owner = 0;
        for (const [h, o] of seen) {
          if (ramp[n]! >= 0 && o === ramp[n]! + 1) continue;
          if (h < lowest[t]!) lowest[t] = h;
          if (h > at(t + 1) + stepUp + EPS && h < top) [top, owner] = [h, o];
        }
        if (owner) {
          const line = axis === 'x' ? (side === 'n' ? cr.j1 : cr.j0) : side === 'e' ? cr.i1 : cr.i0;
          pieces.push({ owner: owner - 1, side: OPPOSITE[side], axis: axis === 'x' ? 'z' : 'x', line, a: axis === 'x' ? i : j, b: (axis === 'x' ? i : j) + 1, bottom: b.lo - BELOW, top });
        }
      }
      // From the side's foot end to its top end, `f` of the way along (0 to 1), as a point on the ground.
      const lineAt = (num: number, den: number): { x: number; z: number } => {
        const { x0, z0, x1, z1 } = b.rect;
        const fx = side === 'e' ? x1 : x0;
        const fz = side === 'n' ? z1 : z0;
        if (axis === 'x') return { x: rising ? x0 + ((x1 - x0) * num) / den : x1 - ((x1 - x0) * num) / den, z: fz };
        return { x: fx, z: rising ? z0 + ((z1 - z0) * num) / den : z1 - ((z1 - z0) * num) / den };
      };
      if (b.rails.includes(side)) {
        const low = Math.min(b.lo, ...lowest);
        rampWalls[k]!.push({ id: `WALL_${b.id}_${side}`, a: lineAt(0, 1), b: lineAt(1, 1), bottom: low - BELOW, top: b.hi + RAIL });
        continue;
      }
      // The skirt: steps no higher than a step each, each topped at the slope's height at its high end.
      const steps = Math.max(1, Math.ceil(rise / stepUp - EPS));
      for (let s = 0; s < steps; s++) {
        const top = b.lo + (rise * (s + 1)) / steps;
        let low = Infinity;
        for (let t = Math.floor((s * m) / steps); t < Math.ceil(((s + 1) * m) / steps); t++) if (lowest[t]! < low) low = lowest[t]!;
        if (!(top > low + stepUp + EPS)) continue;
        rampWalls[k]!.push({ id: `WALL_${b.id}_${side}${s}`, a: lineAt(s, steps), b: lineAt(s + 1, steps), bottom: low - BELOW, top });
      }
    }
  });
  for (const k of [...overNothing].sort((a, b) => a - b)) warnings.push({ message: `${brushes[k - 1]!.id} has an open edge over nothing: a body that walks off it falls out of the map (lay a Hazard or a floor under it)`, brush: brushes[k - 1]!.id });

  // Merge the faces along each line, per owner, side, height range; number them per owner and side.
  pieces.sort((p, q) => p.owner - q.owner || SIDE_ORDER[p.side] - SIDE_ORDER[q.side] || (p.axis < q.axis ? -1 : p.axis > q.axis ? 1 : 0) || p.line - q.line || p.bottom - q.bottom || p.top - q.top || p.a - q.a);
  const faceWalls: WallSegment[][] = brushes.map(() => []);
  const counts = new Map<string, number>();
  for (let s = 0; s < pieces.length; ) {
    const p = pieces[s]!;
    let b = p.b;
    let e = s + 1;
    for (; e < pieces.length; e++) {
      const q = pieces[e]!;
      if (q.owner !== p.owner || q.side !== p.side || q.axis !== p.axis || q.line !== p.line || q.bottom !== p.bottom || q.top !== p.top || q.a > b) break;
      if (q.b > b) b = q.b;
    }
    const key = `${p.owner}${p.side}`;
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    const id = brushes[p.owner]!.id;
    const [a, z] = p.axis === 'x' ? [{ x: xAt(p.line), z: zAt(p.a) }, { x: xAt(p.line), z: zAt(b) }] : [{ x: xAt(p.a), z: zAt(p.line) }, { x: xAt(b), z: zAt(p.line) }];
    faceWalls[p.owner]!.push({ id: `WALL_${id}_${p.side}${n}`, a, b: z, bottom: p.bottom, top: p.top });
    s = e;
  }

  if (walk.length === 0) throw new MapCompileError('the map has no floor: lay a Floor over the field');
  const ys = walk.flatMap((w) => w.points.map((p) => p.y));
  const bottom = Math.min(...ys) - BELOW;
  const top = Math.max(...ys) + EDGE_OVER;
  const corner = (x: number, z: number) => ({ x: x * half, z: z * half });
  const walls: WallSegment[] = [
    { id: 'WALL_edge_s', a: corner(-1, -1), b: corner(1, -1), bottom, top },
    { id: 'WALL_edge_e', a: corner(1, -1), b: corner(1, 1), bottom, top },
    { id: 'WALL_edge_n', a: corner(1, 1), b: corner(-1, 1), bottom, top },
    { id: 'WALL_edge_w', a: corner(-1, 1), b: corner(-1, -1), bottom, top },
  ];
  const wallBrush: string[] = walls.map(() => '');
  const blocks: WallBlock[] = [];
  brushes.forEach((b, k) => {
    const own = [...faceWalls[k]!, ...rampWalls[k]!];
    if (b.kind === 'rail') own.push({ id: `WALL_${b.id}`, a: b.a, b: b.b, bottom: b.y, top: b.y + b.height });
    if (b.kind === 'wall') own.push({ id: `WALL_${b.id}`, a: b.a, b: b.b, bottom: b.bottom, top: b.top });
    if (b.kind === 'block') blocks.push({ id: `BLOCK_${b.id}`, minX: b.rect.x0, minZ: b.rect.z0, maxX: b.rect.x1, maxZ: b.rect.z1, top: b.top });
    walls.push(...own);
    wallBrush.push(...own.map(() => b.id));
  });
  const blockBrush = brushes.filter((b) => b.kind === 'block').map((b) => b.id);

  const draft = {
    name: source.name,
    walk,
    walls,
    blocks,
    objectives: source.objectives,
    bases: source.bases,
    front: source.front,
    armySize: source.armySize,
    ...(source.ticketsPerSoldier === undefined ? {} : { ticketsPerSoldier: source.ticketsPerSoldier }),
  };
  // The game's own checks: what it would refuse, refused here, against the Brush it concerns.
  let map: BattleMapTuning;
  try {
    map = parseBattleMap(draft, `map ${source.name}`, battle);
  } catch (e) {
    if (!(e instanceof TuningDataError)) throw e;
    const of = (re: RegExp, ids: readonly string[]) => {
      const hit = re.exec(e.message);
      return hit ? ids[Number(hit[1])] : undefined;
    };
    const brush = of(/walk\[(\d+)\]/, surfaceBrush) ?? of(/walls\[(\d+)\]/, wallBrush) ?? of(/blocks\[(\d+)\]/, blockBrush);
    throw new MapCompileError(`the game refuses the map: ${e.message}`, brush ? [brush] : []);
  }
  const arena: ArenaGeometry = { name: `battle:${map.name}`, walk: map.walk, walls: [...map.walls, ...map.blocks.flatMap(blockWalls)], spawns: [], doors: [], jumpLinks: false };
  const unjoined = walkCheck(arena, battle.levels);
  if (unjoined) {
    // walkCheck names the Walk Surface that cannot be reached (or cannot get back) first.
    const lost = /Walk Surface (\S+)/.exec(unjoined)?.[1];
    const k = map.walk.findIndex((w) => w.id === lost);
    throw new MapCompileError(`Soldiers cannot walk the whole map: ${unjoined}`, k >= 0 ? [surfaceBrush[k]!] : []);
  }
  return { map, warnings };
}

/** A file's list `key`, one entry a line (the layout of the map files and the Map Sources). */
export function list(key: string, items: readonly unknown[]): string {
  const line = (v: unknown) => JSON.stringify(v);
  return items.length === 0 ? `  ${line(key)}: []` : `  ${line(key)}: [\n${items.map((v) => `    ${line(v)}`).join(',\n')}\n  ]`;
}

/**
 * A compiled map as `data/battlemaps/<map>.json` writes it (the generators' layout: points `[x, y, z]`, Wall ends `[x, z]`, Blocks by
 * `min` and `max`), one entry a line so a small edit gives a small diff. `parseBattleMap` reads it back as the same map.
 */
export function mapFileText(map: BattleMapTuning): string {
  const line = (v: unknown) => JSON.stringify(v);
  const head: string[] = [`  "name": ${line(map.name)}`, `  "front": ${line(map.front)}`, `  "armySize": ${line(map.armySize)}`];
  if (map.ticketsPerSoldier !== undefined) head.push(`  "ticketsPerSoldier": ${line(map.ticketsPerSoldier)}`);
  head.push(`  "bases": ${line(map.bases.map((b) => [b.x, b.z]))}`);
  const body = [
    list('objectives', map.objectives),
    list(
      'blocks',
      map.blocks.map((b) => ({ id: b.id, min: [b.minX, b.minZ], max: [b.maxX, b.maxZ], top: b.top })),
    ),
    list(
      'walls',
      map.walls.map((w) => ({ id: w.id, a: [w.a.x, w.a.z], b: [w.b.x, w.b.z], bottom: w.bottom, top: w.top })),
    ),
    list(
      'walk',
      map.walk.map((w) => {
        const { id, points, ...kind } = w;
        return { id, points: points.map((p) => [p.x, p.y, p.z]), ...kind };
      }),
    ),
  ];
  return `{\n${[...head, ...body].join(',\n')}\n}\n`;
}
