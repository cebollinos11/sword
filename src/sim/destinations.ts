/**
 * The destination fields (docs/plans/battle-objectives.md, Stage 2a; ADR 0021): one distance field to each place a Squad may head for,
 * the map's Objectives and each Team's Base, over a coarse grid (`battle.crowd.flowCell`). Static: built once per map and Tuning Data
 * (cached on the built Battlefield, like the navmesh), pure and tie-broken by index, never part of the state. A Rollback never rebuilds
 * them and they add nothing to a Tick. They replace the per-Team flow field rebuilt from the Soldiers' positions: a Squad's anchor
 * marches by them, and the Commander reads its path distances from them.
 *
 * A cell holds the length (m) of the shortest path from it to the destination over the cells that are not blocked (8 ways, the
 * diagonal costing √2), and -1 when it cannot be reached. The open field has no Walls, so no cell is blocked and its clearance is
 * unbounded; a hand-built map's blocks (its walls and towers, Stage 3a) block the cells whose centres they cover, and a blocked cell holds
 * one step more than its lowest open neighbour. Where nothing stands between a point and a destination the anchor walks straight at it
 * (`steerToward`); the field leads it round what does. Each cell also stores its clearance (Stage 3b): how far its centre is from the
 * nearest block, which a Squad's Formation narrows to (`clearanceAt`, `formationNarrow` in `squad.ts`).
 */
import type { BattleTuning, WallBlock } from '../tuning';
import { battlefieldOf, inBlock, type Battlefield } from './battlefield';

/** The fields to every destination of one map. Destination d is Objective d for d below `objectives`, then each Team's Base (`objectives + team`). */
export interface DestinationFields {
  readonly cell: number;
  /** Cells along each side. */
  readonly side: number;
  /** 1 where a map's block covers the cell's centre; all 0 on the open field. */
  readonly blocked: Uint8Array;
  /** Per destination, per cell (row by row along z): the path length (m) to it, or -1. */
  readonly dist: readonly Float64Array[];
  readonly objectives: number;
  /**
   * Per cell, how far (m) its centre is from the nearest of the map's blocks (negative inside one): static, like the fields. Null on the
   * open field, where nothing is ever near (`clearanceAt` is Infinity).
   */
  readonly clearance: Float64Array | null;
  /** The map's solid blocks (none on the open field), and how far (m) a straight line keeps from them to count as clear (`lineClear`). */
  readonly blocks: readonly WallBlock[];
  readonly margin: number;
}

const built = new WeakMap<Battlefield, DestinationFields>();

/** Neighbour offsets (dx, dz) in a fixed order: the first lowest neighbour wins a tie. */
const STEPS: readonly (readonly [number, number])[] = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/** The cell along one axis: `side` (odd) cells of `cell` metres, the middle one centred on 0, so a point and its mirror through the centre fall in mirrored cells (a point exactly between two rounds away from the centre, on both sides). */
const cellOf = (v: number, cell: number, side: number): number => Math.min(side - 1, Math.max(0, Math.sign(v) * Math.round(Math.abs(v) / cell) + (side - 1) / 2));

/** The binary heap Dijkstra pops from: ordered by distance, then cell index, so the result never depends on insertion order. */
class Heap {
  private readonly keys: number[] = [];
  private readonly cells: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  private less(a: number, b: number): boolean {
    return this.keys[a]! < this.keys[b]! || (this.keys[a] === this.keys[b] && this.cells[a]! < this.cells[b]!);
  }
  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
    [this.cells[a], this.cells[b]] = [this.cells[b]!, this.cells[a]!];
  }
  push(key: number, cell: number): void {
    this.keys.push(key);
    this.cells.push(cell);
    for (let i = this.keys.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.cells[0]!;
    const lastKey = this.keys.pop()!;
    const lastCell = this.cells.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.cells[0] = lastCell;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.less(l, m)) m = l;
        if (r < this.keys.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

function fill(side: number, cell: number, blocked: Uint8Array, start: number): Float64Array {
  const field = new Float64Array(side * side).fill(-1);
  const heap = new Heap();
  field[start] = 0;
  heap.push(0, start);
  const diagonal = cell * Math.SQRT2;
  while (heap.size > 0) {
    const c = heap.pop();
    const cx = c % side;
    const cz = (c - cx) / side;
    const here = field[c]!;
    for (const [dx, dz] of STEPS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= side || nz >= side) continue;
      const n = nz * side + nx;
      if (blocked[n]) continue;
      // A diagonal step may not cut a blocked corner.
      if (dx !== 0 && dz !== 0 && (blocked[cz * side + nx] || blocked[nz * side + cx])) continue;
      const d = here + (dx !== 0 && dz !== 0 ? diagonal : cell);
      if (field[n]! < 0 || d < field[n]!) {
        field[n] = d;
        heap.push(d, n);
      }
    }
  }
  return field;
}

/**
 * A blocked cell's length to the destination: one step more than its lowest open neighbour (8 ways), so a Squad pushed up against a wall,
 * its anchor in a blocked cell, still has a way out and a distance (-1 where no neighbour has one). The open cells' lengths are unchanged.
 */
function fillBlocked(field: Float64Array, side: number, cell: number, blocked: Uint8Array): void {
  const diagonal = cell * Math.SQRT2;
  for (let c = 0; c < field.length; c++) {
    if (!blocked[c]) continue;
    const cx = c % side;
    const cz = (c - cx) / side;
    let best = -1;
    for (const [dx, dz] of STEPS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= side || nz >= side) continue;
      const n = nz * side + nx;
      if (blocked[n] || field[n]! < 0) continue;
      const d = field[n]! + (dx !== 0 && dz !== 0 ? diagonal : cell);
      if (best < 0 || d < best) best = d;
    }
    field[c] = best;
  }
}

/**
 * The destination fields of `field`, built once and kept with it (so a Rollback, which re-simulates against the same map, never rebuilds them).
 * A cell is blocked when its centre lies inside one of the map's solid blocks (none on the open field).
 */
export function destinationFields(battle: BattleTuning, field: Battlefield): DestinationFields {
  const kept = built.get(field);
  if (kept) return kept;
  const cell = battle.crowd.flowCell;
  const side = 2 * Math.ceil(battle.field.size / 2 / cell) + 1;
  const blocked = new Uint8Array(side * side);
  const mid = (side - 1) / 2;
  if (field.blocks.length > 0) for (let c = 0; c < side * side; c++) blocked[c] = inBlock(field, ((c % side) - mid) * cell, (Math.floor(c / side) - mid) * cell) ? 1 : 0;
  const places = [...field.objectives, ...field.bases];
  const dist = places.map((p) => fill(side, cell, blocked, cellOf(p.z, cell, side) * side + cellOf(p.x, cell, side)));
  if (field.blocks.length > 0) for (const d of dist) fillBlocked(d, side, cell, blocked);
  const clearance = field.blocks.length > 0 ? clearanceOf(field.blocks, side, cell) : null;
  const fields: DestinationFields = { cell, side, blocked, dist, objectives: field.objectives.length, clearance, blocks: field.blocks, margin: battle.squad.spacing };
  built.set(field, fields);
  return fields;
}

/** How far (m) (x, z) is from block `b`'s sides: negative inside it, by the depth to its nearest side. */
function blockDistance(b: WallBlock, x: number, z: number): number {
  const dx = Math.max(b.minX - x, x - b.maxX);
  const dz = Math.max(b.minZ - z, z - b.maxZ);
  return dx <= 0 && dz <= 0 ? Math.max(dx, dz) : Math.hypot(Math.max(0, dx), Math.max(0, dz));
}

/** Each cell's clearance (see `DestinationFields.clearance`): its centre's distance from the nearest block. */
function clearanceOf(blocks: readonly WallBlock[], side: number, cell: number): Float64Array {
  const mid = (side - 1) / 2;
  const out = new Float64Array(side * side);
  for (let c = 0; c < out.length; c++) {
    const x = ((c % side) - mid) * cell;
    const z = (Math.floor(c / side) - mid) * cell;
    let near = Infinity;
    for (const b of blocks) near = Math.min(near, blockDistance(b, x, z));
    out[c] = near;
  }
  return out;
}

/**
 * The clearance (m) at (x, z): the cells' clearances round it blended by where it stands among their centres (bilinear), so it falls
 * smoothly toward a wall. Infinity on the open field. Off the grid, the edge cells'.
 */
export function clearanceAt(f: DestinationFields, x: number, z: number): number {
  const cl = f.clearance;
  if (!cl) return Infinity;
  const mid = (f.side - 1) / 2;
  const gx = Math.min(f.side - 1, Math.max(0, x / f.cell + mid));
  const gz = Math.min(f.side - 1, Math.max(0, z / f.cell + mid));
  const cx = Math.min(f.side - 2, Math.floor(gx));
  const cz = Math.min(f.side - 2, Math.floor(gz));
  const u = gx - cx;
  const v = gz - cz;
  const at = cz * f.side + cx;
  return (cl[at]! * (1 - u) + cl[at + 1]! * u) * (1 - v) + (cl[at + f.side]! * (1 - u) + cl[at + f.side + 1]! * u) * v;
}

/**
 * A clearance (m) that (x, z) certainly has: its cell's less its distance from the cell's centre (a wall can be no nearer). Infinity on the
 * open field. A line from (x, z) shorter than this, less a body's half width, passes no block: the walls' tests can be skipped.
 */
export function clearanceBelow(f: DestinationFields, x: number, z: number): number {
  const cl = f.clearance;
  if (!cl) return Infinity;
  const cx = cellOf(x, f.cell, f.side);
  const cz = cellOf(z, f.cell, f.side);
  const mid = (f.side - 1) / 2;
  return cl[cz * f.side + cx]! - Math.hypot(x - (cx - mid) * f.cell, z - (cz - mid) * f.cell);
}

/** The path length (m) from (x, z) to destination `d`, or -1 where it cannot be reached. */
export function fieldDistance(f: DestinationFields, d: number, x: number, z: number): number {
  return f.dist[d]![cellOf(z, f.cell, f.side) * f.side + cellOf(x, f.cell, f.side)]!;
}

/** Whether the segment from (x, z) to (tx, tz) passes within `margin` of block `b` (a slab test against the block grown by it). */
function crosses(b: WallBlock, margin: number, x: number, z: number, tx: number, tz: number): boolean {
  // One axis's slab at a time (x, then z), narrowing the share [t0, t1] of the segment inside both.
  let t0 = 0;
  let t1 = 1;
  for (let axis = 0; axis < 2; axis++) {
    const p = axis === 0 ? x : z;
    const d = axis === 0 ? tx - x : tz - z;
    const lo = (axis === 0 ? b.minX : b.minZ) - margin;
    const hi = (axis === 0 ? b.maxX : b.maxZ) + margin;
    if (Math.abs(d) < 1e-12) {
      if (p <= lo || p >= hi) return false;
      continue;
    }
    const a = (lo - p) / d;
    const c = (hi - p) / d;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
    if (t0 >= t1) return false;
  }
  return true;
}

/**
 * Whether the straight line from (x, z) to (tx, tz) crosses no blocked cell (sampled every half cell) and, on a hand-built map, passes no
 * nearer than the fields' `margin` to any of its blocks (the cells alone would let a line clip a wall's end).
 */
export function lineClear(f: DestinationFields, x: number, z: number, tx: number, tz: number): boolean {
  for (const b of f.blocks) if (crosses(b, f.margin, x, z, tx, tz)) return false;
  const len = Math.hypot(tx - x, tz - z);
  const steps = Math.ceil(len / (f.cell / 2));
  for (let k = 1; k < steps; k++) {
    const u = k / steps;
    if (f.blocked[cellOf(z + (tz - z) * u, f.cell, f.side) * f.side + cellOf(x + (tx - x) * u, f.cell, f.side)]) return false;
  }
  return true;
}

/**
 * Whether one can see from (x, z) to (tx, tz): no block of a hand-built map stands across the line (always, on the open field). With
 * `margin`, whether a body that wide (m, each side) can walk it: the line keeps that far from every block.
 */
export function inSight(f: DestinationFields, x: number, z: number, tx: number, tz: number, margin = 0): boolean {
  for (const b of f.blocks) if (crosses(b, margin, x, z, tx, tz)) return false;
  return true;
}

/**
 * The heading (yaw, 0 facing +z) from (x, z) toward (tx, tz), a point of destination `d`'s surroundings: straight at it when nothing
 * blocks the line, else down the destination's field (`descend`, Team `team`'s way on a tie), and straight at it again where the field
 * does not reach.
 */
export function steerToward(f: DestinationFields, d: number, x: number, z: number, tx: number, tz: number, team = 0): number {
  if (lineClear(f, x, z, tx, tz)) return Math.atan2(tx - x, tz - z);
  return descend(f, d, x, z, team) ?? Math.atan2(tx - x, tz - z);
}

/** Two path lengths (m) closer than this are a tie: equal paths summed in another order differ in their last bits. */
const TIE = 1e-9;

/**
 * The heading (yaw) from (x, z) toward the centre of the lowest of the 8 cells round it in destination `d`'s field, or null at a minimum or
 * where the field does not reach. On a tie (two ways round a wall as long), the first in `STEPS` order for Team 0, and for Team 1 the first in
 * that order turned half round, so each Team takes the other's way turned with the map (the armies are a half turn of each other). With
 * `room`, a cell whose centre is nearer a block than that (its clearance) counts as blocked too, so a body that wide never walks at a
 * centre on a wall's face (Stage 3b: a Soldier walking round).
 */
export function descend(f: DestinationFields, d: number, x: number, z: number, team = 0, room = 0): number | null {
  const turn = team === 1 ? -1 : 1;
  const field = f.dist[d]!;
  const cx = cellOf(x, f.cell, f.side);
  const cz = cellOf(z, f.cell, f.side);
  let best = -1;
  let bestD = field[cz * f.side + cx]!;
  if (bestD < 0) return null;
  const cl = room > 0 ? f.clearance : null;
  const shut = (c: number): boolean => f.blocked[c] === 1 || (cl !== null && cl[c]! < room);
  for (const [sx, sz] of STEPS) {
    const dx = sx * turn;
    const dz = sz * turn;
    const nx = cx + dx;
    const nz = cz + dz;
    if (nx < 0 || nz < 0 || nx >= f.side || nz >= f.side) continue;
    // Never into a blocked cell, nor diagonally past a blocked corner, as the field's own paths never go (out of a blocked cell, any way).
    if (shut(nz * f.side + nx) || (dx !== 0 && dz !== 0 && (shut(cz * f.side + nx) || shut(nz * f.side + cx)))) continue;
    const v = field[nz * f.side + nx]!;
    if (v >= 0 && v < bestD - TIE) [best, bestD] = [nz * f.side + nx, v];
  }
  if (best < 0) return null;
  const mid = (f.side - 1) / 2;
  return Math.atan2(((best % f.side) - mid) * f.cell - x, (Math.floor(best / f.side) - mid) * f.cell - z);
}

/**
 * The destination whose field best leads from (x, z) toward (tx, tz), for a Soldier walled off from its Squad (Stage 3b): the one whose path
 * from (x, z) is the most longer than its path from (tx, tz), so (tx, tz) lies the most nearly on the way to it (the best of the lower bounds
 * the fields give on the walk between the two points). Team 1 looks at the destinations in Team 0's order turned half round (Objective k
 * as Objective n - 1 - k, each Team's Base as the other's), so a tie goes the mirrored way. -1 when no field reaches both.
 */
export function toward(f: DestinationFields, x: number, z: number, tx: number, tz: number, team = 0): number {
  const n = f.objectives;
  let best = -1;
  let gain = -Infinity;
  for (let j = 0; j < f.dist.length; j++) {
    const d = team === 1 ? (j < n ? n - 1 - j : 2 * n + 1 - j) : j;
    const from = fieldDistance(f, d, x, z);
    const to = fieldDistance(f, d, tx, tz);
    if (from < 0 || to < 0) continue;
    if (from - to > gain + TIE) [best, gain] = [d, from - to];
  }
  return best;
}

/** What a Battle's Squads and Commanders read of the map: the Battlefield (its Objectives and Bases) and the destination fields to them. Static. */
export interface BattleMap {
  readonly field: Battlefield;
  readonly fields: DestinationFields;
}

/** The map of Battlefield `arena` (`battle:<seed>`) under `battle`, built once and then reused. Throws on a name that is not a Battlefield. */
export function battleMapOf(battle: BattleTuning, arena: string): BattleMap {
  const field = battlefieldOf(battle, arena);
  if (!field) throw new RangeError(`A Battle is fought on a Battlefield (battle:<seed> or a map of battle.maps), got "${arena}"`);
  return { field, fields: destinationFields(battle, field) };
}
