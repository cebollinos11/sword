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
 *    Block every floor under its top. A Block that stands in an Enclosure and reaches exactly its ceiling (a Hall's pillar or solid notch) stands on
 *    that Enclosure's floor instead: it cuts the floors under its top (the abyss under the Hall, the Hall's floor) and the Enclosure's roof stays over it.
 *  - **Walk Surfaces**: each Brush's cells at its level are merged into rectangles (row by row from the south-west, each as wide and then
 *    as deep as it goes), `WALK_<brush>_<n>`; each Ramp is one sloped quad, `WALK_<ramp>`.
 *  - **Walls** (ADR 0014's and the generators' rules): the field's four edges (`WALL_edge_<side>`); a face under every edge of a floor where
 *    the ground beside it is higher than a step (so nobody walks under a raised floor or into a Platform's side), owned by the higher Brush
 *    (`WALL_<brush>_<side><n>`, merged along each line); on each Ramp's long sides a rail, or else a skirt stepped up the slope (each step
 *    no higher than `battle.levels.stepUp`, so nobody on the ramp is stopped by it and nobody beside it walks under); each Rail and Wall.
 *  - **Enclosures**: each lays its floor at its level and its roof (a walkable floor, the floor under it kept, tagged `roof`: Soldiers need
 *    never reach it, a Player's Jump gets onto it) at the next level up, and stands
 *    a Wall on each side from under its floor to its roof, with a doorway (open `DOOR_HEIGHT` over its floor, a lintel above) centred where
 *    its `doors` name one. The Walls are stood line by line, so where Enclosures meet edge to edge one Wall stands (the earlier Brush's,
 *    as high as the higher roof) and a doorway in either opens through it (`WALL_<brush>_<side>d<n>`).
 *  - **Blocks** (a Block stands on one floor, with nothing over it, unless it stands in an Enclosure to its ceiling: see Paint), Objectives, Bases, the settings and the Lobby's card carry straight through.
 *
 * A mirrored source (`mirror: true`, Stage 6, `mirror.ts`) compiles so that its map can be its own half turn (ADR 0022): each Brush's
 * cells are merged in a way the half turn keeps (each row's runs, then runs alike in the rows above them), and its Objectives and Blocks
 * are listed in their mirrored order (`mirrorOrder`), so that k and n - 1 - k are twins. A source without `mirror` compiles as before.
 *
 * Pure and deterministic: no trig, no `Math.random`, every tie broken by Brush order then row-major cell order, so the same source always
 * compiles to the same bytes, and every id comes from a Brush id, so a small edit gives a small diff.
 */
import { LOBBY_KEYS, parseBattleMap, type ArenaGeometry, type ArenaPoint, type BattleMapTuning, type BattleTuning, type WalkSurface, type WallBlock, type WallSegment } from '../tuning';
import { TuningDataError } from '../tuning/validate';
import { blockWalls } from '../sim/battlefield';
import { walkCheck, type WalkReach } from '../sim/levels';
import { DOOR_HEIGHT, enclosureTop, RAIL, SIDES, type Brush, type EnclosureBrush, type MapSource, type RampBrush, type Rect, type Side } from './source';
import { inMirrorOrder } from './mirror';

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

/**
 * A compiled map before the walk check (`compileDraft`): the map `parseBattleMap` accepts, which Brush each of its Walk Surfaces, Walls
 * and Blocks comes from (`''` for the field's edge Walls), and the Arena the Simulation stands Soldiers on (its Walls and its Blocks' Walls,
 * as a Battlefield builds it). The Map Editor's checks (`checks.ts`) read it even where Soldiers cannot walk the whole map.
 */
export interface DraftMap extends CompiledMap {
  readonly surfaceBrush: readonly string[];
  readonly wallBrush: readonly string[];
  readonly blockBrush: readonly string[];
  readonly arena: ArenaGeometry;
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

/** The heights a Brush lays its floors at, for the kinds that lay one (an Enclosure two: its floor and its roof). */
function floorLevels(b: Brush, levels: readonly number[]): number[] {
  if (b.kind === 'floor' || b.kind === 'deck' || b.kind === 'hazard') return [b.y];
  if (b.kind === 'platform') return [b.top];
  if (b.kind === 'enclosure') {
    const top = enclosureTop(b, levels);
    return top === null ? [b.y] : [b.y, top];
  }
  return [];
}

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
  const draft = compileDraft(source, battle);
  walkChecked(draft, battle);
  return { map: draft.map, warnings: draft.warnings };
}

/**
 * Throws MapCompileError, naming the Brush of the Walk Surface it names, where `walkCheck` refuses the draft: Soldiers cannot walk (and
 * drop) between all of its Walk Surfaces. Pass the draft's `walkReach` when it is already worked out.
 */
export function walkChecked(draft: DraftMap, battle: Pick<BattleTuning, 'levels'>, reach?: WalkReach): void {
  const unjoined = walkCheck(draft.arena, battle.levels, reach);
  if (!unjoined) return;
  // walkCheck names the Walk Surface that cannot be reached (or cannot get back) first.
  const lost = /Walk Surface (\S+)/.exec(unjoined)?.[1];
  const k = draft.map.walk.findIndex((w) => w.id === lost);
  throw new MapCompileError(`Soldiers cannot walk the whole map: ${unjoined}`, k >= 0 ? [draft.surfaceBrush[k]!] : []);
}

/**
 * `compileMap` short of the walk check: the map `parseBattleMap` accepts, with the Brush of each of its parts. Throws MapCompileError
 * where the source is inconsistent or `parseBattleMap` refuses the map.
 */
export function compileDraft(source: MapSource, battle: Pick<BattleTuning, 'field' | 'deploy' | 'squad' | 'levels'>): DraftMap {
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
  const withinCells = (c: CellRect, i: number, j: number) => i >= c.i0 && i < c.i1 && j >= c.j0 && j < c.j1;
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

  brushes.forEach((b) => {
    if (b.kind === 'enclosure' && enclosureTop(b, levels) === null) throw new MapCompileError(`Enclosure ${b.id}'s ceiling is the level above its floor (${b.y}), but there is none: add a level above it`, [b.id]);
  });

  // What later Holes take away from each Brush that lays a floor: its cells (rect-local, 1 = taken) where a Hole at its level comes after it, by `<brush>:<level>`.
  const masks = new Map<string, Uint8Array>();
  brushes.forEach((b, k) => {
    if (!('rect' in b)) return;
    for (const y of floorLevels(b, levels)) {
      const cr = cellsOf(b.rect);
      const w = cr.i1 - cr.i0;
      for (let h = k + 1; h < brushes.length; h++) {
        const hole = brushes[h]!;
        if (hole.kind !== 'hole' || hole.y !== y || !overlaps(hole.rect, b.rect)) continue;
        let mask = masks.get(`${k}:${y}`);
        if (!mask) masks.set(`${k}:${y}`, (mask = new Uint8Array(w * (cr.j1 - cr.j0))));
        const hr = cellsOf(hole.rect);
        for (let j = Math.max(cr.j0, hr.j0); j < Math.min(cr.j1, hr.j1); j++) for (let i = Math.max(cr.i0, hr.i0); i < Math.min(cr.i1, hr.i1); i++) mask[(j - cr.j0) * w + (i - cr.i0)] = 1;
      }
    }
  });
  brushes.forEach((hole, h) => {
    if (hole.kind !== 'hole') return;
    if (!brushes.some((b, k) => k < h && floorLevels(b, levels).includes(hole.y) && 'rect' in b && overlaps(b.rect, hole.rect)))
      warnings.push({ message: `Hole ${hole.id} takes nothing away: no Brush before it lays floor at ${hole.y} under it`, brush: hole.id });
  });

  // Paint. `own[l][c]` is 1 + the Brush whose floor stands at level l in cell c (0: none); `ramp[c]` the Ramp over cell c (-1: none).
  const own = levels.map(() => new Int32Array(N * N));
  const ramp = new Int32Array(N * N).fill(-1);
  /** Each cell of `r` for Brush k, but those a later Hole takes away from its floor at `y` (every cell when no `y`). */
  const each = (r: Rect, k: number, f: (c: number) => void, y?: number) => {
    const cr = cellsOf(r);
    const mask = y === undefined ? undefined : masks.get(`${k}:${y}`);
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
        each(b.rect, k, (c) => (own[l]![c] = k + 1), b.y);
        break;
      }
      case 'platform': {
        const l = levelOf.get(b.top)!;
        each(
          b.rect,
          k,
          (c) => {
            cutBelow(c, b.top);
            own[l]![c] = k + 1;
          },
          b.top,
        );
        break;
      }
      case 'enclosure':
        // Its floor, then its roof as a Deck lays one (the floor under it stays: that is the room).
        for (const y of floorLevels(b, levels)) {
          const l = levelOf.get(y)!;
          each(b.rect, k, (c) => (own[l]![c] = k + 1), y);
        }
        break;
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
    // A Block in an Enclosure (a pillar or a solid notch of a Hall): the first Enclosure whose rect holds it and whose ceiling is its top. It stands on that
    // Enclosure's floor: the floors under it below its top (the abyss, the Enclosure's own floor) are cut and the Enclosure's roof over it is kept.
    const room = brushes.find((e) => e.kind === 'enclosure' && e.rect.x0 <= b.rect.x0 + EPS && e.rect.z0 <= b.rect.z0 + EPS && e.rect.x1 >= b.rect.x1 - EPS && e.rect.z1 >= b.rect.z1 - EPS && Math.abs((enclosureTop(e, levels) ?? NaN) - b.top) <= EPS) as EnclosureBrush | undefined;
    // Otherwise a Block stands on one floor, and nothing stands over it or inside it (a Deck laid across it is refused, whatever the order).
    let lowest = room ? room.y : Infinity;
    if (!room)
      each(b.rect, k, (c) => {
        for (let l = 0; l < levels.length; l++) if (own[l]![c]) lowest = Math.min(lowest, levels[l]!);
      });
    each(b.rect, k, (c) => {
      for (let l = 0; l < levels.length; l++) {
        const o = own[l]![c]!;
        if (o && levels[l]! > lowest + EPS && (!room || levels[l]! < b.top - EPS)) throw new MapCompileError(`Block ${b.id} stands under ${brushes[o - 1]!.id} (at ${levels[l]}): nothing may stand over a Block (make it a Platform)`, [b.id, brushes[o - 1]!.id]);
      }
      cutBelow(c, room ? b.top : Infinity);
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
  if (source.mirror) own.forEach((o, l) => mergeRuns(o, N, l, rects));
  else own.forEach((o, l) => {
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
    if (floorLevels(b, levels).length === 0) return;
    if (rects[k]!.length === 0) warnings.push({ message: `${b.id} lays no floor: every cell of it is painted over or taken away`, brush: b.id });
    rects[k]!.forEach((r, n) => {
      const y = levels[r.l]!;
      const points = [
        { x: xAt(r.i0), y, z: zAt(r.j0) },
        { x: xAt(r.i1), y, z: zAt(r.j0) },
        { x: xAt(r.i1), y, z: zAt(r.j1) },
        { x: xAt(r.i0), y, z: zAt(r.j1) },
      ];
      const id = `WALK_${b.id}_${n}`;
      // An Enclosure's roof: a floor Soldiers need never reach (a Player's Jump gets onto it).
      walk.push(b.kind === 'hazard' ? { id, points, [b.hazard]: true } : b.kind === 'enclosure' && y > b.y ? { id, points, roof: true } : { id, points });
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
      // An Enclosure's roof is no ledge to wall for a body inside its own rect: its own Walls stand to it, and a Deck under it (a gallery) has an open edge.
      // A body beside the Enclosure still meets its roof as a ledge, as before.
      const e = brushes[o - 1]!;
      const roof = e.kind === 'enclosure' && h > e.y && withinCells(cellsOf(e.rect), i, j);
      if (h > y && h < top && !roof) [top, owner] = [h, o];
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
  const enclosureWalls = standEnclosures(brushes, levels, stepUp, warnings);
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
    const own = [...faceWalls[k]!, ...rampWalls[k]!, ...enclosureWalls[k]!];
    if (b.kind === 'rail') own.push({ id: `WALL_${b.id}`, a: b.a, b: b.b, bottom: b.y, top: b.y + b.height });
    if (b.kind === 'wall') own.push({ id: `WALL_${b.id}`, a: b.a, b: b.b, bottom: b.bottom, top: b.top });
    if (b.kind === 'block') blocks.push({ id: `BLOCK_${b.id}`, minX: b.rect.x0, minZ: b.rect.z0, maxX: b.rect.x1, maxZ: b.rect.z1, top: b.top });
    walls.push(...own);
    wallBrush.push(...own.map(() => b.id));
  });
  let blockBrush = brushes.filter((b) => b.kind === 'block').map((b) => b.id);
  // A mirrored map lists its Objectives and Blocks so that k and n - 1 - k are twins (ADR 0022: Team 1 breaks its ties the half-turned way).
  let objectives = source.objectives;
  if (source.mirror) {
    objectives = inMirrorOrder(objectives);
    const order = inMirrorOrder(brushes.filter((b) => b.kind === 'block')).map((b) => blockBrush.indexOf(b.id));
    const listed = [...blocks];
    order.forEach((k, n) => (blocks[n] = listed[k]!));
    blockBrush = order.map((k) => blockBrush[k]!);
  }

  const draft = {
    name: source.name,
    walk,
    walls,
    blocks,
    objectives: objectives.map(({ twin: _twin, ...o }) => o),
    bases: source.bases,
    front: source.front,
    armySize: source.armySize,
    ...(source.shortcuts ? { shortcuts: true } : {}),
    ...(source.ticketsPerSoldier === undefined ? {} : { ticketsPerSoldier: source.ticketsPerSoldier }),
    ...(source.lobby === undefined ? {} : { lobby: source.lobby }),
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
  const arena: ArenaGeometry = { name: `battle:${map.name}`, walk: map.walk, walls: [...map.walls, ...map.blocks.flatMap(blockWalls)], spawns: [], doors: [], jumpLinks: map.shortcuts ? 'shortcuts' : false };
  return { map, warnings, surfaceBrush, wallBrush, blockBrush, arena };
}

/** One side of an Enclosure as its Wall stands: on the line `axis` = `line` (m), from `a` to `b` along it, its doorway's span (if any). */
interface EnclosureSide {
  readonly owner: number;
  readonly side: Side;
  readonly axis: 'x' | 'z';
  readonly line: number;
  readonly a: number;
  readonly b: number;
  readonly y: number;
  readonly top: number;
  readonly door: readonly [number, number] | null;
}

/**
 * The Enclosures' Walls, by Brush (Brush order, as `brushes`): each side from under its floor (`y` - BELOW) to its roof, less its doorway
 * (open from under the floor to `DOOR_HEIGHT` over it, the lintel standing over that to the roof). Stood line by line, so sides on one line
 * (Enclosures edge to edge) stand one Wall: where any of them stands solid it is solid, as high as the highest roof, and a doorway in any
 * of them opens through it. The earliest Enclosure on a stretch owns it (`WALL_<brush>_<side>d<n>`, merged along the line).
 */
function standEnclosures(brushes: readonly Brush[], levels: readonly number[], stepUp: number, warnings: CompileWarning[]): WallSegment[][] {
  const out: WallSegment[][] = brushes.map(() => []);
  const sides: EnclosureSide[] = [];
  brushes.forEach((b, k) => {
    if (b.kind !== 'enclosure') return;
    const top = enclosureTop(b, levels)!;
    if (top - b.y < DOOR_HEIGHT - EPS) warnings.push({ message: `Enclosure ${b.id} is ${top - b.y} m high: under ${DOOR_HEIGHT} m the tallest Fighters cannot stand in it (raise the level above its floor)`, brush: b.id });
    for (const side of SIDES) sides.push(enclosureSide(b, k, side, top));
  });
  if (sides.length === 0) return out;
  // The lines, in one order: x lines (east and west sides) then z lines, each by its coordinate.
  const lines = new Map<string, EnclosureSide[]>();
  for (const s of sides) {
    const key = `${s.axis}:${s.line}`;
    const on = lines.get(key);
    if (on) on.push(s);
    else lines.set(key, [s]);
  }
  const keys = [...lines.keys()].sort((p, q) => {
    const [pa, pl] = p.split(':');
    const [qa, ql] = q.split(':');
    return pa! < qa! ? -1 : pa! > qa! ? 1 : Number(pl) - Number(ql);
  });
  const counts = new Map<string, number>();
  for (const key of keys) {
    const on = lines.get(key)!;
    const cuts = [...new Set(on.flatMap((s) => [s.a, s.b, ...(s.door ?? [])]))].sort((p, q) => p - q);
    // Each stretch between two cuts: who owns it and the heights it stands solid over.
    type Stretch = { a: number; b: number; owner: number; side: Side; solid: [number, number][] };
    const stretches: Stretch[] = [];
    for (let n = 0; n + 1 < cuts.length; n++) {
      const a = cuts[n]!;
      const b = cuts[n + 1]!;
      const mid = (a + b) / 2;
      const here = on.filter((s) => s.a < mid && mid < s.b);
      if (here.length === 0) continue;
      const owner = here.reduce((p, q) => (q.owner < p.owner ? q : p));
      const solid: [number, number][] = [];
      const open: [number, number][] = [];
      for (const s of here) {
        const inDoor = s.door !== null && s.door[0] < mid && mid < s.door[1];
        if (!inDoor) solid.push([s.y - BELOW, s.top]);
        else {
          // From under its floor, but not into the Wall of a room under this one (whose roof is this floor).
          const under = here.filter((o) => o !== s && o.top <= s.y + EPS).map((o) => o.top);
          open.push([Math.max(s.y - BELOW, ...under), s.y + DOOR_HEIGHT]);
          if (s.top > s.y + DOOR_HEIGHT + stepUp + EPS) solid.push([s.y + DOOR_HEIGHT, s.top]);
        }
      }
      stretches.push({ a, b, owner: owner.owner, side: owner.side, solid: subtract(union(solid), open) });
    }
    // Merge neighbouring stretches alike, then stand a Wall for each height range.
    for (let s = 0; s < stretches.length; ) {
      const p = stretches[s]!;
      let e = s + 1;
      let b = p.b;
      while (e < stretches.length && stretches[e]!.a === b && stretches[e]!.owner === p.owner && stretches[e]!.side === p.side && JSON.stringify(stretches[e]!.solid) === JSON.stringify(p.solid)) b = stretches[e++]!.b;
      const id = brushes[p.owner]!.id;
      const axis = on[0]!.axis;
      const line = on[0]!.line;
      for (const [bottom, top] of p.solid) {
        const ck = `${p.owner}${p.side}`;
        const n = counts.get(ck) ?? 0;
        counts.set(ck, n + 1);
        const [wa, wb] = axis === 'x' ? [{ x: line, z: p.a }, { x: line, z: b }] : [{ x: p.a, z: line }, { x: b, z: line }];
        out[p.owner]!.push({ id: `WALL_${id}_${p.side}d${n}`, a: wa, b: wb, bottom, top });
      }
      s = e;
    }
  }
  return out;
}

/** The side `side` of Enclosure `b` (Brush k), its doorway centred along it and cut to it. */
function enclosureSide(b: EnclosureBrush, k: number, side: Side, top: number): EnclosureSide {
  const { x0, z0, x1, z1 } = b.rect;
  const axis = side === 'e' || side === 'w' ? 'x' : 'z';
  const line = side === 'e' ? x1 : side === 'w' ? x0 : side === 'n' ? z1 : z0;
  const [a, e] = axis === 'x' ? [z0, z1] : [x0, x1];
  const width = b.doors[side];
  const mid = (a + e) / 2;
  const door: [number, number] | null = width === undefined ? null : [Math.max(a, mid - width / 2), Math.min(e, mid + width / 2)];
  return { owner: k, side, axis, line, a, b: e, y: b.y, top, door };
}

/** Height ranges merged where they overlap or touch, ascending. */
function union(ranges: readonly [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const out: [number, number][] = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + EPS) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/** `ranges` (ascending, apart) less every range of `cut`, dropping slivers. */
function subtract(ranges: readonly [number, number][], cut: readonly [number, number][]): [number, number][] {
  let out = ranges.map(([lo, hi]) => [lo, hi] as [number, number]);
  for (const [clo, chi] of cut) {
    const next: [number, number][] = [];
    for (const [lo, hi] of out) {
      if (chi <= lo + EPS || clo >= hi - EPS) {
        next.push([lo, hi]);
        continue;
      }
      if (clo > lo + EPS) next.push([lo, clo]);
      if (chi < hi - EPS) next.push([chi, hi]);
    }
    out = next;
  }
  return out;
}

/**
 * A mirrored source's merge (Stage 6): each row's runs of one Brush's cells at level `l`, then each run stacked with the same run in the rows
 * above it, as `art/build_battle_fort.py`'s `floor_rects` does. It depends only on the cells, and the half turn maps a row's runs to its
 * turned row's and a stack to a stack, so a map whose cells are their own half turn gets Walk Surfaces that are too (row-major greedy
 * rectangles do not: they grow from the south-west). Each Brush's rectangles in row-major order of their south-west corners.
 */
function mergeRuns(o: Int32Array, N: number, l: number, rects: { l: number; i0: number; j0: number; i1: number; j1: number }[][]): void {
  type Run = { k: number; i0: number; i1: number; j0: number };
  // The runs still open after the rows so far, by owner and span, each with the row it began in.
  let open = new Map<string, Run>();
  const done: Run[] = [];
  const ends: number[] = [];
  for (let j = 0; j <= N; j++) {
    const next = new Map<string, Run>();
    for (let i = 0; j < N && i < N; ) {
      const k = o[j * N + i]!;
      let i1 = i + 1;
      while (i1 < N && o[j * N + i1] === k) i1++;
      if (k) {
        const key = `${k}:${i}:${i1}`;
        next.set(key, open.get(key) ?? { k, i0: i, i1, j0: j });
        open.delete(key);
      }
      i = i1;
    }
    for (const r of open.values()) {
      done.push(r);
      ends.push(j);
    }
    open = next;
  }
  const order = done.map((_, n) => n).sort((p, q) => done[p]!.j0 - done[q]!.j0 || done[p]!.i0 - done[q]!.i0);
  for (const n of order) {
    const r = done[n]!;
    rects[r.k - 1]!.push({ l, i0: r.i0, j0: r.j0, i1: r.i1, j1: ends[n]! });
  }
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
  if (map.shortcuts) head.push(`  "shortcuts": true`);
  if (map.ticketsPerSoldier !== undefined) head.push(`  "ticketsPerSoldier": ${line(map.ticketsPerSoldier)}`);
  // The Lobby's card (Stage 3), its parts in one order whatever order the source gave them.
  if (map.lobby !== undefined) head.push(`  "lobby": ${line(Object.fromEntries(LOBBY_KEYS.filter((k) => map.lobby![k] !== undefined).map((k) => [k, map.lobby![k]])))}`);
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
