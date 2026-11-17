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
 *
 * On a map of several levels (Stage 4a, `Battlefield.layered`) a cell where levels overlap (a bridge over a tunnel) holds one node per
 * level standing at its centre (`FieldLevels`), and a node joins a neighbouring cell's node only where a Soldier walks (or drops, one way)
 * from its centre to the other's (`trace`, the walk rule of `levels.ts`), so the fields lead each level its own way. A point's node is the
 * one of its cell on its Walk Surface's level. A node's clearance is its distance to the nearest block and to the nearest edge of its
 * level a Soldier cannot step off (a ledge, the foot of higher ground, a Wall), so a Formation narrows on a bridge as in a gate.
 */
import type { ArenaGeometry, BattleTuning, LevelsTuning, WallBlock } from '../tuning';
import { surfaceHeight, surfacesAt } from './arena';
import { battlefieldOf, inBlock, type Battlefield } from './battlefield';
import { EDGE_PROBE, probeEdges, sameLevel, trace, walled } from './levels';

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
  /**
   * On a map of several levels (Stage 4a), its nodes: then `dist` and `clearance` hold an entry per node, not per cell. Null on the open
   * field and a one-level map, where each cell is one node (its index the cell's).
   */
  readonly levels: FieldLevels | null;
}

/** The nodes of a map of several levels' destination fields (`DestinationFields.levels`): static, built with the fields. */
export interface FieldLevels {
  readonly arena: ArenaGeometry;
  readonly lv: LevelsTuning;
  /** Cell c's nodes are `start[c]` to `start[c + 1] - 1`, lowest first: one per level a Soldier stands on at the cell's centre. */
  readonly start: Int32Array;
  /** Per node: its cell, its Walk Surface (the highest of its level at the centre) and its height there. */
  readonly cell: Int32Array;
  readonly surface: Int32Array;
  readonly y: Float64Array;
  /** Per node, per `STEPS` direction (node × 8 + k): the node of that neighbour a Soldier reaches walking from this one's centre to its, or -1. */
  readonly next: Int32Array;
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
 * The field to cell `start` on a map of one level: `fill`, then `fillBlocked` when the map has blocks. `destinationFields` (per place) and
 * `distanceTo` both build their one-level fields here, so the two cannot drift.
 */
function levelField(side: number, cell: number, blocked: Uint8Array, hasBlocks: boolean, start: number): Float64Array {
  const out = fill(side, cell, blocked, start);
  if (hasBlocks) fillBlocked(out, side, cell, blocked);
  return out;
}

/**
 * The destination fields of `field`, built once and kept with it (so a Rollback, which re-simulates against the same map, never rebuilds them).
 * A cell is blocked when its centre lies inside one of the map's solid blocks (none on the open field).
 */
export function destinationFields(battle: BattleTuning, field: Battlefield): DestinationFields {
  const kept = built.get(field);
  if (kept) return kept;
  if (field.layered) {
    const fields = layeredFields(battle, field);
    built.set(field, fields);
    return fields;
  }
  const cell = battle.crowd.flowCell;
  const side = 2 * Math.ceil(battle.field.size / 2 / cell) + 1;
  const blocked = new Uint8Array(side * side);
  const mid = (side - 1) / 2;
  if (field.blocks.length > 0) for (let c = 0; c < side * side; c++) blocked[c] = inBlock(field, ((c % side) - mid) * cell, (Math.floor(c / side) - mid) * cell) ? 1 : 0;
  const places = [...field.objectives, ...field.bases];
  const dist = places.map((p) => levelField(side, cell, blocked, field.blocks.length > 0, cellOf(p.z, cell, side) * side + cellOf(p.x, cell, side)));
  const clearance = field.blocks.length > 0 ? clearanceOf(field.blocks, side, cell) : null;
  const fields: DestinationFields = { cell, side, blocked, dist, objectives: field.objectives.length, clearance, blocks: field.blocks, margin: battle.squad.spacing, levels: null };
  built.set(field, fields);
  return fields;
}

/** `STEPS` turned half round (Team 1's order): the index in `STEPS` of each step negated. */
const TURNED: readonly number[] = [1, 0, 3, 2, 7, 6, 5, 4];
/** For a diagonal step (index 4 to 7 of `STEPS`), the indices in `STEPS` of its two straight parts (along x, along z). */
const partsOf = (k: number): readonly [number, number] => [STEPS[k]![0] < 0 ? 0 : 1, STEPS[k]![1] < 0 ? 2 : 3];

/** A cell's centre (m) along one axis. */
const centreOf = (c: number, cell: number, side: number): number => (c - (side - 1) / 2) * cell;

/**
 * The node of cell `c` on the level of Walk Surface `s`: the one on `s`, else the one whose height is nearest `s`'s plane at the centre and
 * within a step of it (a point of another level, a ramp's railed side beside it, gets none: `nearNode` leads it); -1 for none. With `s` -1,
 * the cell's highest.
 */
export function nodeIn(f: DestinationFields, c: number, s: number): number {
  const L = f.levels!;
  if (s < 0) return L.start[c + 1]! > L.start[c]! ? L.start[c + 1]! - 1 : -1;
  // The node on the surface itself, the usual case, needs no height.
  for (let k = L.start[c]!; k < L.start[c + 1]!; k++) if (L.surface[k] === s) return k;
  const h = surfaceHeight(L.arena, s, centreOf(c % f.side, f.cell, f.side), centreOf(Math.floor(c / f.side), f.cell, f.side));
  let best = -1;
  let bestD = L.lv.stepUp + 1e-9;
  for (let k = L.start[c]!; k < L.start[c + 1]!; k++) {
    const d = Math.abs(L.y[k]! - h);
    if (d < bestD) [best, bestD] = [k, d];
  }
  return best;
}

/** The cell (x, z) lies in. */
export const cellAt = (f: DestinationFields, x: number, z: number): number => cellOf(z, f.cell, f.side) * f.side + cellOf(x, f.cell, f.side);

/** The node a point (x, z) on Walk Surface `s` stands at: its cell's on its level (`nodeIn`); on a one-level map, its cell. -1 for none. */
function nodeAt(f: DestinationFields, x: number, z: number, s: number): number {
  const c = cellAt(f, x, z);
  return f.levels ? nodeIn(f, c, s) : c;
}

/** The fields of a map of several levels (`FieldLevels`): its nodes, joined by the walk rule, a Dijkstra backward over the joins, and clearance. */
function layeredFields(battle: BattleTuning, field: Battlefield): DestinationFields {
  const arena = field.arena;
  const lv = battle.levels;
  const cell = battle.crowd.flowCell;
  const side = 2 * Math.ceil(battle.field.size / 2 / cell) + 1;
  const cells = side * side;
  // Nodes: per cell centre not inside a block, its Walk Surfaces lowest first, each within a step of the one below it one level.
  const start = new Int32Array(cells + 1);
  const cellOfNode: number[] = [];
  const surfaceOf: number[] = [];
  const yOf: number[] = [];
  for (let c = 0; c < cells; c++) {
    start[c] = cellOfNode.length;
    const x = centreOf(c % side, cell, side);
    const z = centreOf(Math.floor(c / side), cell, side);
    if (field.blocks.length > 0 && inBlock(field, x, z)) continue;
    const here = surfacesAt(arena, x, z)
      .map((t) => ({ t, h: surfaceHeight(arena, t, x, z) }))
      .sort((a, b) => a.h - b.h || a.t - b.t);
    for (let k = 0; k < here.length; k++) {
      // The node stands on the level's highest Walk Surface (the lower index on a tie).
      let top = here[k]!;
      while (k + 1 < here.length && here[k + 1]!.h - here[k]!.h <= lv.stepUp) {
        k++;
        if (here[k]!.h > top.h) top = here[k]!;
      }
      cellOfNode.push(c);
      surfaceOf.push(top.t);
      yOf.push(top.h);
    }
  }
  start[cells] = cellOfNode.length;
  const nodes = cellOfNode.length;
  const blocked = new Uint8Array(cells);
  for (let c = 0; c < cells; c++) blocked[c] = start[c + 1] === start[c] ? 1 : 0;
  const levels: FieldLevels = { arena, lv, start, cell: Int32Array.from(cellOfNode), surface: Int32Array.from(surfaceOf), y: Float64Array.from(yOf), next: new Int32Array(nodes * 8).fill(-1) };
  const shell: DestinationFields = { cell, side, blocked, dist: [], objectives: field.objectives.length, clearance: null, blocks: field.blocks, margin: battle.squad.spacing, levels };
  // Joins: from each node's centre straight to each neighbour's by the walk rule (dropping too, one way); a diagonal only where both its
  // straight parts go, as the field's paths never cut a corner. The straight ones first, so the diagonals can read them.
  for (const diagonals of [false, true])
    for (let a = 0; a < nodes; a++) {
      const c = levels.cell[a]!;
      const cx = c % side;
      const cz = Math.floor(c / side);
      for (let k = diagonals ? 4 : 0; k < (diagonals ? 8 : 4); k++) {
        const nx = cx + STEPS[k]![0];
        const nz = cz + STEPS[k]![1];
        if (nx < 0 || nz < 0 || nx >= side || nz >= side || blocked[nz * side + nx]) continue;
        if (diagonals && partsOf(k).some((p) => levels.next[a * 8 + p]! < 0)) continue;
        const tx = centreOf(nx, cell, side);
        const tz = centreOf(nz, cell, side);
        const to = trace(arena, lv, levels.surface[a]!, centreOf(cx, cell, side), centreOf(cz, cell, side), tx, tz, true);
        if (to < 0) continue;
        const b = nodeIn(shell, nz * side + nx, to);
        if (b >= 0 && sameLevel(arena, lv, to, levels.surface[b]!, tx, tz)) levels.next[a * 8 + k] = b;
      }
    }
  const places = [...field.objectives.map((o, k) => ({ x: o.x, z: o.z, s: field.objectiveSurfaces[k]! })), ...field.bases.map((b, k) => ({ x: b.x, z: b.z, s: field.baseSurfaces[k]! }))];
  const dist = places.map((p) => backward(levels, cell, nodeAt(shell, p.x, p.z, p.s)));
  return { ...shell, dist, clearance: levelClearance(field, lv, levels, side, cell) };
}

/** The joins into each node of a map of several levels, in compact form: node n's are `joins[offsets[n]]` to `joins[offsets[n + 1] - 1]` (node × 8 + step, in node then step order). */
interface Backward {
  readonly offsets: Int32Array;
  readonly joins: Int32Array;
}

/** Derived from a `FieldLevels`' static joins, so built once per object and kept here, never in the state. */
const backwards = new WeakMap<FieldLevels, Backward>();

/** The joins into each node of `levels` (node × 8 + step), in node then step order, built once. */
function backwardOf(levels: FieldLevels): Backward {
  const kept = backwards.get(levels);
  if (kept) return kept;
  const next = levels.next;
  const nodes = levels.y.length;
  const offsets = new Int32Array(nodes + 1);
  for (let j = 0; j < next.length; j++) if (next[j]! >= 0) offsets[next[j]! + 1]!++;
  for (let n = 0; n < nodes; n++) offsets[n + 1]! += offsets[n]!;
  const joins = new Int32Array(offsets[nodes]!);
  const fillAt = offsets.slice(0, nodes);
  for (let j = 0; j < next.length; j++) if (next[j]! >= 0) joins[fillAt[next[j]!]!++] = j;
  const made = { offsets, joins };
  backwards.set(levels, made);
  return made;
}

/**
 * The path length (m) from every node of a map of several levels to node `from`, or -1: a Dijkstra backward over the joins (a join costing a
 * cell, a diagonal one √2 of it). All -1 where `from` is -1 (no node there). The one place `layeredFields` and `distanceTo` build a field.
 */
function backward(levels: FieldLevels, cell: number, from: number): Float64Array {
  const nodes = levels.y.length;
  const out = new Float64Array(nodes).fill(-1);
  if (from < 0) return out;
  const { offsets, joins } = backwardOf(levels);
  const diagonal = cell * Math.SQRT2;
  const heap = new Heap();
  out[from] = 0;
  heap.push(0, from);
  while (heap.size > 0) {
    const b = heap.pop();
    const here = out[b]!;
    for (let i = offsets[b]!; i < offsets[b + 1]!; i++) {
      const j = joins[i]!;
      const a = j >> 3;
      const d = here + (j % 8 >= 4 ? diagonal : cell);
      if (out[a]! < 0 || d < out[a]!) {
        out[a] = d;
        heap.push(d, a);
      }
    }
  }
  return out;
}

/**
 * A destination field to any one point (x, z) on Walk Surface `s` (-1: its cell's highest node), not only to an Objective or a Base, over the
 * same cells (on a map of several levels, nodes) as `f`: per cell (node) the path length (m) to the point, or -1. It is the field
 * `destinationFields` builds for an Objective standing there, entry for entry: a Squad or a Warband post, or a Player chased, is as
 * far from a cell as that. On a map of one level, `s` does not matter and the point's cell is the destination; on a map of several levels the
 * destination is the point's node on its level (`s`), and every entry is -1 where its cell has none there (a point inside a block). Built fresh
 * on every call and never kept (the point moves), so the result is the caller's; only the joins it runs over are, for they are static.
 * On a map of Enclosures (rooms with roofs) the caller passes the floor's Walk Surface (`groundOf` at the floor's height), since -1
 * means the cell's highest node, which there is the roof.
 */
export function distanceTo(f: DestinationFields, x: number, z: number, s = -1): Float64Array {
  if (f.levels) return backward(f.levels, f.cell, nodeAt(f, x, z, s));
  return levelField(f.side, f.cell, f.blocked, f.blocks.length > 0, cellAt(f, x, z));
}

/** How many fields `fieldToward` keeps per `DestinationFields` (about 7 MB at most on a Floor: 13,500 nodes of 8 bytes each). */
export const FIELDS_KEPT = 64;

/** The fields `fieldToward` kept per `DestinationFields`, by node, most recently used last. Derived from static data, never state. */
const kept = new WeakMap<DestinationFields, Map<number, Float64Array>>();

/**
 * `distanceTo`, kept: the field to the node of (x, z) on Walk Surface `s`, built once per (`f`, node) and kept (`FIELDS_KEPT`, most recently
 * used last). `distanceTo` depends on the point only through that node (-1 for none: an all -1 field, kept too), so a kept field equals a
 * fresh one entry for entry. The caller must not change it.
 */
export function fieldToward(f: DestinationFields, x: number, z: number, s = -1): Float64Array {
  let fields = kept.get(f);
  if (!fields) kept.set(f, (fields = new Map()));
  const node = nodeAt(f, x, z, s);
  let field = fields.get(node);
  if (field) {
    fields.delete(node);
  } else {
    const t0 = clock?.();
    field = distanceTo(f, x, z, s);
    fieldTally.count++;
    if (clock) fieldTally.ms += clock() - t0!;
    if (fields.size >= FIELDS_KEPT) fields.delete(fields.keys().next().value!);
  }
  fields.set(node, field);
  return field;
}

/** The `distanceTo` builds `fieldToward` has made, and their time by `clock`. Only counted, never read by the Simulation, kept out of the state and the hash. */
const fieldTally = { count: 0, ms: 0 };
/** The clock (ms) a test installs with `timeFieldBuilds` to time the builds; none in the game (the Simulation reads no wall-clock). */
let clock: (() => number) | null = null;

/** Time the `fieldToward` builds from now on by `now` (a wall-clock in ms, for the soaks' measurements), or stop timing with null. Counts and times only; no state. */
export function timeFieldBuilds(now: (() => number) | null): void {
  clock = now;
}

/** How many `distanceTo` builds `fieldToward` has made so far (kept fields found again are not counted), and their total time (ms) by the clock `timeFieldBuilds` installed (0 with none). For the soaks' measurements. */
export function fieldBuilds(): { readonly count: number; readonly ms: number } {
  return { count: fieldTally.count, ms: fieldTally.ms };
}

/** `f` with `field` as its only destination (d = 0), for `steerToward`, `descend` and `fieldDistance`. */
export function oneField(f: DestinationFields, field: Float64Array): DestinationFields {
  return { ...f, dist: [field], objectives: 0 };
}

/**
 * Each node's clearance on a map of several levels: its centre's distance to the nearest block (negative inside one) and to the nearest edge
 * of its level a Soldier cannot step off (`probeEdges` without drops: a ledge, the foot of higher ground, a Wall, the field's edge), such an
 * edge counting where its Walk Surface stands less than `levels.height` from the node's height.
 */
function levelClearance(field: Battlefield, lv: LevelsTuning, levels: FieldLevels, side: number, cell: number): Float64Array {
  const arena = field.arena;
  // Neighbouring probes along one edge that cannot step off, joined into segments.
  const runs: { s: number; edge: number; u: number; ax: number; az: number; bx: number; bz: number }[] = [];
  probeEdges(arena, lv, false, () => {}, (s, x, z, u, edge) => {
    const last = runs[runs.length - 1];
    if (last && last.s === s && last.edge === edge && u - last.u <= EDGE_PROBE * 1.5) [last.bx, last.bz, last.u] = [x, z, u];
    else runs.push({ s, edge, u, ax: x, az: z, bx: x, bz: z });
  });
  const out = new Float64Array(levels.y.length);
  for (let k = 0; k < out.length; k++) {
    const c = levels.cell[k]!;
    const x = centreOf(c % side, cell, side);
    const z = centreOf(Math.floor(c / side), cell, side);
    let near = Infinity;
    for (const b of field.blocks) near = Math.min(near, blockDistance(b, x, z));
    for (const r of runs) {
      const ex = r.bx - r.ax;
      const ez = r.bz - r.az;
      const len2 = ex * ex + ez * ez;
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - r.ax) * ex + (z - r.az) * ez) / len2));
      const px = r.ax + ex * t;
      const pz = r.az + ez * t;
      if (Math.abs(surfaceHeight(arena, r.s, px, pz) - levels.y[k]!) >= lv.height) continue;
      near = Math.min(near, Math.hypot(x - px, z - pz));
    }
    out[k] = near;
  }
  return out;
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
export function clearanceAt(f: DestinationFields, x: number, z: number, s = -1): number {
  const cl = f.clearance;
  if (!cl) return Infinity;
  if (f.levels) return levelClearanceAt(f, cl, x, z, s);
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
export function clearanceBelow(f: DestinationFields, x: number, z: number, s = -1): number {
  const cl = f.clearance;
  if (!cl) return Infinity;
  const cx = cellOf(x, f.cell, f.side);
  const cz = cellOf(z, f.cell, f.side);
  const mid = (f.side - 1) / 2;
  const at = f.levels ? nodeIn(f, cz * f.side + cx, s) : cz * f.side + cx;
  if (at < 0) return -Infinity;
  return cl[at]! - Math.hypot(x - (cx - mid) * f.cell, z - (cz - mid) * f.cell);
}

/**
 * On a map of several levels, `clearanceAt` for a point on Walk Surface `s`: the four cells' nodes of its level blended, a cell with none
 * there counting 0 (its centre is off the level, so an edge of it is near).
 */
function levelClearanceAt(f: DestinationFields, cl: Float64Array, x: number, z: number, s: number): number {
  const mid = (f.side - 1) / 2;
  const gx = Math.min(f.side - 1, Math.max(0, x / f.cell + mid));
  const gz = Math.min(f.side - 1, Math.max(0, z / f.cell + mid));
  const cx = Math.min(f.side - 2, Math.floor(gx));
  const cz = Math.min(f.side - 2, Math.floor(gz));
  const u = gx - cx;
  const v = gz - cz;
  const at = (c: number) => {
    const k = nodeIn(f, c, s);
    return k < 0 ? 0 : cl[k]!;
  };
  const c = cz * f.side + cx;
  return (at(c) * (1 - u) + at(c + 1) * u) * (1 - v) + (at(c + f.side) * (1 - u) + at(c + f.side + 1) * u) * v;
}

/**
 * The path length (m) from (x, z) to destination `d`, or -1 where it cannot be reached. On a map of several levels, from the point on Walk
 * Surface `s`: its node's, or where its cell has no node on its level, one step more than the lowest of its neighbours' that do.
 */
export function fieldDistance(f: DestinationFields, d: number, x: number, z: number, s = -1): number {
  if (!f.levels) return f.dist[d]![cellOf(z, f.cell, f.side) * f.side + cellOf(x, f.cell, f.side)]!;
  const at = nodeAt(f, x, z, s);
  if (at >= 0) return f.dist[d]![at]!;
  const near = nearNode(f, d, x, z, s);
  if (near < 0) return -1;
  const c = cellAt(f, x, z);
  const n = f.levels.cell[near]!;
  const diagonal = c % f.side !== n % f.side && Math.floor(c / f.side) !== Math.floor(n / f.side);
  return f.dist[d]![near]! + (diagonal ? f.cell * Math.SQRT2 : f.cell);
}

/**
 * For a point (x, z) on Walk Surface `s` whose cell has no node on its level, the lowest-distance node to destination `d` of its level in the
 * 8 cells round it (Team `team`'s `STEPS` order on a tie), or -1. As a blocked cell of a one-level map leads to its lowest open neighbour.
 */
function nearNode(f: DestinationFields, d: number, x: number, z: number, s: number, team = 0): number {
  const cx = cellOf(x, f.cell, f.side);
  const cz = cellOf(z, f.cell, f.side);
  const field = f.dist[d]!;
  let best = -1;
  let bestD = Infinity;
  for (let j = 0; j < 8; j++) {
    const [dx, dz] = STEPS[team === 1 ? TURNED[j]! : j]!;
    const nx = cx + dx;
    const nz = cz + dz;
    if (nx < 0 || nz < 0 || nx >= f.side || nz >= f.side) continue;
    const k = nodeIn(f, nz * f.side + nx, s);
    if (k >= 0 && field[k]! >= 0 && field[k]! < bestD - TIE) [best, bestD] = [k, field[k]!];
  }
  return best;
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
 * nearer than the fields' `margin` to any of its blocks (the cells alone would let a line clip a wall's end). On a map of several levels,
 * instead of the cells: a Soldier on Walk Surface `s` walks it without dropping (`trace`), arriving on the level of Walk Surface `ts`.
 */
export function lineClear(f: DestinationFields, x: number, z: number, tx: number, tz: number, s = -1, ts = -1): boolean {
  for (const b of f.blocks) if (crosses(b, f.margin, x, z, tx, tz)) return false;
  const L = f.levels;
  if (L && s >= 0) {
    const to = trace(L.arena, L.lv, s, x, z, tx, tz, false);
    return to >= 0 && (ts < 0 || sameLevel(L.arena, L.lv, to, ts, tx, tz));
  }
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
 * `margin`, whether a body that wide (m, each side) can walk it: the line keeps that far from every block. With the two heights (`y`, `ty`), on a
 * map of several levels, the map's Walls count too (see below).
 */
export function inSight(f: DestinationFields, x: number, z: number, tx: number, tz: number, margin = 0, y = NaN, ty = NaN): boolean {
  for (const b of f.blocks) if (crosses(b, margin, x, z, tx, tz)) return false;
  // On a map of several levels, given the two bodies' heights, no Wall of the map (a ramp's rail, a keep's face) stands across the line at the
  // lower one's height either: an enemy over a rail is not one a Squad can walk to.
  if (f.levels && y === y && ty === ty && walled(f.levels.arena, f.levels.lv, x, z, tx, tz, Math.min(y, ty))) return false;
  return true;
}

/**
 * The heading (yaw, 0 facing +z) from (x, z) toward (tx, tz), a point of destination `d`'s surroundings: straight at it when nothing
 * blocks the line, else down the destination's field (`descend`, Team `team`'s way on a tie), and straight at it again where the field
 * does not reach.
 */
export function steerToward(f: DestinationFields, d: number, x: number, z: number, tx: number, tz: number, team = 0, s = -1, ts = -1): number {
  if (lineClear(f, x, z, tx, tz, s, ts)) return Math.atan2(tx - x, tz - z);
  return descend(f, d, x, z, team, 0, s) ?? Math.atan2(tx - x, tz - z);
}

/** Two path lengths (m) closer than this are a tie: equal paths summed in another order differ in their last bits. */
const TIE = 1e-9;

/**
 * The heading (yaw) from (x, z) toward the centre of the lowest of the 8 cells round it in destination `d`'s field, or null at a minimum or
 * where the field does not reach. On a tie (two ways round a wall as long), the first in `STEPS` order for Team 0, and for Team 1 the first in
 * that order turned half round, so each Team takes the other's way turned with the map (the armies are a half turn of each other). With
 * `room`, a cell whose centre is nearer a block than that (its clearance) counts as blocked too, so a body that wide never walks at a
 * centre on a wall's face (Stage 3b: a Soldier walking round). On a map of several levels, from the node of (x, z) on Walk Surface `s` by
 * its joins (`levelDescend`).
 */
export function descend(f: DestinationFields, d: number, x: number, z: number, team = 0, room = 0, s = -1): number | null {
  if (f.levels) return levelDescend(f, d, x, z, team, room, s);
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
 * `descend` on a map of several levels: toward the centre of the lowest of the nodes the node of (x, z) on Walk Surface `s` joins (the walk
 * rule's way from its centre, a drop included), a diagonal only where both its straight parts go, ties the Team's `STEPS` way. With `room`, a
 * node whose clearance is less counts as shut. From a point whose cell has no node on its level, toward the lowest of its neighbours' that do.
 */
function levelDescend(f: DestinationFields, d: number, x: number, z: number, team: number, room: number, s: number): number | null {
  const L = f.levels!;
  const field = f.dist[d]!;
  const at = nodeAt(f, x, z, s);
  let best = -1;
  if (at < 0) best = nearNode(f, d, x, z, s, team);
  else {
    let bestD = field[at]!;
    if (bestD < 0) return null;
    const cl = room > 0 ? f.clearance : null;
    const shut = (k: number): boolean => k < 0 || (cl !== null && cl[k]! < room);
    for (let j = 0; j < 8; j++) {
      const k = team === 1 ? TURNED[j]! : j;
      const b = L.next[at * 8 + k]!;
      if (shut(b) || (k >= 4 && partsOf(k).some((p) => shut(L.next[at * 8 + p]!)))) continue;
      const v = field[b]!;
      if (v >= 0 && v < bestD - TIE) [best, bestD] = [b, v];
    }
  }
  if (best < 0) return null;
  const at2 = (k: number): [number, number] => [centreOf(L.cell[k]! % f.side, f.cell, f.side), centreOf(Math.floor(L.cell[k]! / f.side), f.cell, f.side)];
  const reach = (k: number): boolean => {
    const [cx, cz] = at2(k);
    return trace(L.arena, L.lv, s, x, z, cx, cz, true) >= 0;
  };
  // The field's way leaves from a node's centre, but the body may stand across a thin Wall from it (a ramp's rail through the cell): then take
  // the node of the cells round it on its level that it can walk to with the least way left, the field's length there and the walk to it
  // (the 3 x 3 cells in the Team's order, so a tie goes the mirrored way).
  if (s >= 0 && !reach(best)) {
    const turn = team === 1 ? -1 : 1;
    const c0 = cellAt(f, x, z);
    const [cx0, cz0] = [c0 % f.side, Math.floor(c0 / f.side)];
    let alt = -1;
    let altCost = Infinity;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const [nx, nz] = [cx0 + dx * turn, cz0 + dz * turn];
        if (nx < 0 || nz < 0 || nx >= f.side || nz >= f.side) continue;
        const k = nodeIn(f, nz * f.side + nx, s);
        if (k < 0 || field[k]! < 0 || (room > 0 && f.clearance![k]! < room) || !reach(k)) continue;
        const [cx, cz] = at2(k);
        const cost = field[k]! + Math.hypot(cx - x, cz - z);
        if (cost < altCost - TIE) [alt, altCost] = [k, cost];
      }
    if (alt >= 0) best = alt;
  }
  const [cx, cz] = at2(best);
  return Math.atan2(cx - x, cz - z);
}

/**
 * The destination whose field best leads from (x, z) toward (tx, tz), for a Soldier walled off from its Squad (Stage 3b): the one whose path
 * from (x, z) is the most longer than its path from (tx, tz), so (tx, tz) lies the most nearly on the way to it (the best of the lower bounds
 * the fields give on the walk between the two points). Team 1 looks at the destinations in Team 0's order turned half round (Objective k
 * as Objective n - 1 - k, each Team's Base as the other's), so a tie goes the mirrored way. -1 when no field reaches both. On a map of
 * several levels, from (x, z) on Walk Surface `s` toward (tx, tz) on `ts`.
 */
export function toward(f: DestinationFields, x: number, z: number, tx: number, tz: number, team = 0, s = -1, ts = -1): number {
  const n = f.objectives;
  let best = -1;
  let gain = -Infinity;
  for (let j = 0; j < f.dist.length; j++) {
    const d = team === 1 ? (j < n ? n - 1 - j : 2 * n + 1 - j) : j;
    const from = fieldDistance(f, d, x, z, s);
    const to = fieldDistance(f, d, tx, tz, ts);
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
