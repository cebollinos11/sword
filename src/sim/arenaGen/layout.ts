/**
 * The layout generator: (Kit, seed, params) → Layout. It fills the whole grid freely (no symmetry, nothing
 * checks fairness), raises a few plateaus, gives every raised level a ramp onto it so walking reaches it (or
 * flattens it), adds ramps until walking joins every floor (voiding what none can join), then knocks out voids
 * (keeping every floor walkable from every other), bridges some of them, and scatters cover and rails. A Hall Arena's
 * Doors (`doors`) go on edge cells at ground level once the floors are joined, before the voids, so nothing is knocked out
 * round them. Seeded only through ../rng, every choice made in cell order.
 */
import { createRng, nextFloat, type RngState } from '../rng';
import type { Kit, PieceId, Side } from './kit';
import { cellGraph, SIDE_STEP, type Layout, type PlacedPiece } from './grid';

export interface GenParams {
  /** The footprint, in cells. */
  readonly cols: number;
  readonly rows: number;
  /** How many floor levels (1 to the Kit's `maxLevels`). */
  readonly levels: number;
  /** The chance (0–1) that a floor cell becomes a void. */
  readonly voidDensity: number;
  /** The chance (0–1) that a floor cell gets cover (a crate or a pillar), or a raised one a rail. */
  readonly coverDensity: number;
  /** The least share (0–1) of the footprint that must be open floor at the lowest fighting level (the judge's rule). */
  readonly minOpenFloor: number;
  /** A Hall Arena's Doors (0, or missing: none, and the Layout is a Random Map's as before Doors). */
  readonly doors?: number;
}

export const DEFAULT_GEN_PARAMS: GenParams = { cols: 7, rows: 7, levels: 3, voidDensity: 0.12, coverDensity: 0.08, minOpenFloor: 0.25 };

/** The share of cover that is crates (the rest pillars): every crate lid adds jump Links, so a slower navmesh build. */
const CRATE_SHARE = 0.3;
/**
 * A raised floor with an edge over lower ground gets a rail along it when its roll misses cover but falls under
 * RAIL_FACTOR times the cover density (about four times as often as cover). A railed
 * edge is never searched for shortcut Jumps (ADR 0013), so rails keep the navmesh cheap as well as the fall off it.
 */
const RAIL_FACTOR = 5;

/** A seeded draw in [0, 1) that advances the generator. */
type Draw = () => number;

function drawFrom(seed: number): Draw {
  let rng: RngState = createRng(seed);
  return () => {
    const [v, next] = nextFloat(rng);
    rng = next;
    return v;
  };
}

/** A whole number in [0, n). */
const pick = (draw: Draw, n: number) => Math.floor(draw() * n);

interface Cell {
  piece: PieceId;
  level: number;
  turn: number;
  /** For the cells of a two-cell ramp: the cell its PlacedPiece starts at. */
  anchor: number;
  /** Kept a plain floor: the cell walking onto a ramp starts from, or the one it leads onto (or kept round a Door). */
  keep: boolean;
  /** A door's index among the Doors (Door 0 the entrance). */
  door?: number;
}

/** The Layout `seed` gives on `kit` with `params`: the same seed and params always give the same Layout. */
export function generateLayout(kit: Kit, seed: number, params: GenParams): Layout {
  const { cols, rows } = params;
  const levels = Math.max(1, Math.min(kit.maxLevels, Math.floor(params.levels)));
  const draw = drawFrom(seed);
  const cells: Cell[] = Array.from({ length: cols * rows }, (_, k) => ({ piece: 'floor', level: 0, turn: 0, anchor: k, keep: false }));
  const index = (c: number, r: number) => (c < 0 || c >= cols || r < 0 || r >= rows ? -1 : r * cols + c);
  const step = (cell: number, side: number) => index((cell % cols) + SIDE_STEP[side]![0], Math.floor(cell / cols) + SIDE_STEP[side]![1]);
  const layout = (): Layout => toLayout(kit, cols, rows, cells);

  // Plateaus: rectangles raised one level, each on what the level below already holds.
  for (let level = 1; level < levels; level++) {
    const count = level === 1 ? 2 + pick(draw, 2) : 1 + pick(draw, 2);
    for (let k = 0; k < count; k++) {
      const w = Math.min(cols, 2 + pick(draw, 3));
      const d = Math.min(rows, 2 + pick(draw, 3));
      const c0 = pick(draw, cols - w + 1);
      const r0 = pick(draw, rows - d + 1);
      for (let r = r0; r < r0 + d; r++) for (let c = c0; c < c0 + w; c++) if (cells[index(c, r)]!.level === level - 1) cells[index(c, r)]!.level = level;
    }
  }

  /** The ramps that could rise onto plain floor `k` from the level below: its high, low and foot cells, and the side it rises toward. */
  const waysOnto = (k: number) => {
    const level = cells[k]!.level;
    const ways: { low: number; high: number; foot: number; side: Side }[] = [];
    if (level < 1 || cells[k]!.piece !== 'floor') return ways;
    const fits = (n: number) => n >= 0 && cells[n]!.piece === 'floor' && cells[n]!.level === level - 1;
    for (let side = 0; side < 4; side++) {
      // Walking up the ramp onto `k` is walking out through `side`.
      const back = (side + 2) % 4;
      const high = step(k, back);
      const low = high >= 0 ? step(high, back) : -1;
      const foot = low >= 0 ? step(low, back) : -1;
      if (fits(high) && !cells[high]!.keep && fits(low) && !cells[low]!.keep && fits(foot)) ways.push({ low, high, foot, side: side as Side });
    }
    return ways;
  };
  /** Place one of `ways` (ordered by cell, then side), picked by the seed. */
  const placeRamp = (ways: ReturnType<typeof waysOnto>) => {
    ways.sort((a, b) => a.low - b.low || a.side - b.side);
    const { low, high, foot, side } = ways[pick(draw, ways.length)]!;
    // The ramp rises toward +z (side 2) unturned.
    const turn = (side + 2) % 4;
    for (const k of [low, high]) Object.assign(cells[k]!, { piece: 'ramp', level: cells[k]!.level, turn, anchor: Math.min(low, high) });
    cells[foot]!.keep = true;
    cells[step(high, side)]!.keep = true;
  };

  // A ramp onto every plateau, from the level below; a plateau with no room for one is flattened.
  for (let level = 1; level < levels; level++) {
    for (const plateau of regions(cols * rows, (k) => cells[k]!.level >= level, (k, s) => step(k, s))) {
      const ways = plateau.filter((k) => cells[k]!.level === level).flatMap(waysOnto);
      if (ways.length) placeRamp(ways);
      else for (const k of plateau) cells[k]!.level = level - 1;
    }
  }

  // Regions of floor walking joins, in order of their first cell.
  const joined = (): number[][] => {
    const graph = cellGraph(kit, layout());
    return regions(cols * rows, (k) => cells[k]!.piece !== 'void', (k, s) => {
      const n = step(k, s);
      return n >= 0 && graph[k]!.includes(n) ? n : -1;
    });
  };
  const biggest = (parts: number[][]) => parts.reduce((a, b) => (b.length > a.length ? b : a), []);
  // While walking leaves the floor in parts, a ramp between the biggest and another; what no ramp joins becomes voids.
  for (;;) {
    const parts = joined();
    if (parts.length <= 1) break;
    const main = parts.indexOf(biggest(parts));
    const region = new Array<number>(cells.length).fill(-1);
    parts.forEach((part, i) => part.forEach((k) => (region[k] = i)));
    const ways = cells.flatMap((_, k) => waysOnto(k).filter((w) => region[k] !== region[w.foot] && (region[k] === main || region[w.foot] === main)));
    if (!ways.length) {
      const keep = parts[main]!;
      cells.forEach((cell, k) => {
        if (!keep.includes(k)) Object.assign(cell, { piece: 'void', level: 0, turn: 0, anchor: k, keep: false });
      });
      break;
    }
    placeRamp(ways);
  }

  // The lowest floor left is the ground level.
  const lowest = Math.min(...cells.filter((c) => c.piece !== 'void').map((c) => c.level));
  for (const cell of cells) if (cell.piece !== 'void') cell.level -= lowest;

  if (params.doors) placeDoors(cells, cols, rows, params.doors, draw);

  // Voids, wherever one leaves every floor still walkable from every other.
  for (let k = 0; k < cells.length; k++) {
    const roll = draw();
    const cell = cells[k]!;
    if (roll >= params.voidDensity || cell.piece !== 'floor' || cell.keep) continue;
    const was = { ...cell };
    Object.assign(cell, { piece: 'void', level: 0 });
    if (joined().length > 1) Object.assign(cell, was);
  }

  // Bridges across some voids, between two floors on the same raised level.
  for (let k = 0; k < cells.length; k++) {
    if (cells[k]!.piece !== 'void') continue;
    for (const turn of [0, 1]) {
      const a = step(k, turn), b = step(k, turn + 2);
      const level = a >= 0 ? cells[a]!.level : 0;
      if (a < 0 || b < 0 || cells[a]!.piece !== 'floor' || cells[b]!.piece !== 'floor' || level < 1 || cells[b]!.level !== level) continue;
      if (draw() < 0.5) Object.assign(cells[k]!, { piece: 'bridge', level, turn });
      break;
    }
  }

  // Cover: crates and pillars on floors, rails along raised edges over lower ground.
  for (let k = 0; k < cells.length; k++) {
    const cell = cells[k]!;
    const roll = draw();
    if (cell.piece !== 'floor' || cell.keep) continue;
    if (roll < params.coverDensity) {
      cell.piece = draw() < CRATE_SHARE ? 'crate' : 'pillar';
      continue;
    }
    if (cell.level === 0 || roll >= RAIL_FACTOR * params.coverDensity) continue;
    const edges = [0, 1, 2, 3].filter((side) => {
      const n = step(k, side);
      return n < 0 || cells[n]!.piece === 'void' || (cells[n]!.piece !== 'ramp' && cells[n]!.piece !== 'bridge' && cells[n]!.level < cell.level);
    });
    // The rail stands along -z (side 0) unturned.
    if (edges.length) Object.assign(cell, { piece: 'rail', turn: edges[pick(draw, edges.length)]! });
  }
  return layout();
}

/**
 * A Hall Arena's Doors, Door 0 first: each a `door` on an edge cell (not a corner) at ground level, its Wall along the
 * footprint's edge. Door 0's cell is picked by the seed; each next one is the cell furthest round the edge from the
 * Doors already placed (ties: the first, clockwise from the -x, -z corner). A Door's spawns stand within DEADLY_RADIUS of
 * the cells either side of it, so those must be ground-level floors and become rails along the edge, and the three cells
 * inward of them must be ground; all six are kept (no void, no cover). Fewer Doors than asked when the edge has no room
 * (the judge then turns the Layout down).
 */
function placeDoors(cells: Cell[], cols: number, rows: number, doors: number, draw: Draw): void {
  // The edge, clockwise from the -x, -z corner: each cell with the side that faces out (the one its Wall stands on).
  const edge: { cell: number; out: Side }[] = [];
  for (let c = 0; c < cols - 1; c++) edge.push({ cell: c, out: 0 });
  for (let r = 0; r < rows - 1; r++) edge.push({ cell: r * cols + cols - 1, out: 1 });
  for (let c = cols - 1; c > 0; c--) edge.push({ cell: (rows - 1) * cols + c, out: 2 });
  for (let r = rows - 1; r > 0; r--) edge.push({ cell: r * cols, out: 3 });
  const at = (k: number) => cells[k]!;
  const step = (k: number, side: number) => {
    const [dc, dr] = SIDE_STEP[side]!;
    const c = (k % cols) + dc;
    const r = Math.floor(k / cols) + dr;
    return c < 0 || c >= cols || r < 0 || r >= rows ? -1 : r * cols + c;
  };
  /** The cells either side of edge cell `k` along the edge, and the three inward of them and it; null at a corner. */
  const around = ({ cell, out }: { cell: number; out: Side }) => {
    const sides = [step(cell, (out + 1) % 4), step(cell, (out + 3) % 4)];
    const inward = [cell, ...sides].map((k) => (k < 0 ? -1 : step(k, (out + 2) % 4)));
    return sides.includes(-1) || inward.includes(-1) ? null : { sides, inward };
  };
  const ground = (k: number) => at(k).level === 0 && at(k).piece === 'floor';
  const fits = (e: (typeof edge)[number]) => {
    const near = around(e);
    if (!near || !ground(e.cell)) return false;
    // A side already a rail along this edge (the next Door's but one) can stand for both.
    if (!near.sides.every((k) => ground(k) || (at(k).piece === 'rail' && at(k).level === 0 && at(k).turn === e.out))) return false;
    return near.inward.every((k) => at(k).piece !== 'void' && at(k).piece !== 'bridge' && at(k).piece !== 'door');
  };
  const placed: number[] = [];
  for (let n = 0; n < doors; n++) {
    const open = edge.map((_, i) => i).filter((i) => fits(edge[i]!));
    if (!open.length) return;
    let i: number;
    if (n === 0) i = open[pick(draw, open.length)]!;
    else {
      /** How far round the edge (in cells, either way) edge cell `i` is from the nearest Door placed. */
      const gap = (i: number) => Math.min(...placed.map((j) => Math.min(Math.abs(i - j), edge.length - Math.abs(i - j))));
      i = open.reduce((best, k) => (gap(k) > gap(best) ? k : best));
    }
    placed.push(i);
    const e = edge[i]!;
    const near = around(e)!;
    // The door and the rails rise their Wall along -z (side 0) unturned.
    Object.assign(at(e.cell), { piece: 'door', turn: e.out, keep: true, door: n });
    for (const k of near.sides) Object.assign(at(k), { piece: 'rail', turn: e.out, keep: true });
    for (const k of near.inward) at(k).keep = true;
  }
}

/** The regions (cells joined across sides, each ascending, in order of their first cell) of the cells `inside` lets in. */
function regions(count: number, inside: (k: number) => boolean, neighbour: (k: number, side: number) => number): number[][] {
  const seen = new Uint8Array(count);
  const out: number[][] = [];
  for (let k = 0; k < count; k++) {
    if (seen[k] || !inside(k)) continue;
    const region = [k];
    seen[k] = 1;
    for (let i = 0; i < region.length; i++)
      for (let side = 0; side < 4; side++) {
        const n = neighbour(region[i]!, side);
        if (n >= 0 && !seen[n] && inside(n)) (seen[n] = 1), region.push(n);
      }
    out.push(region.sort((a, b) => a - b));
  }
  return out;
}

function toLayout(kit: Kit, cols: number, rows: number, cells: readonly Cell[]): Layout {
  const placements: PlacedPiece[] = [];
  cells.forEach((cell, k) => {
    if (cell.anchor !== k) return;
    const placed: PlacedPiece = { piece: cell.piece, col: k % cols, row: Math.floor(k / cols), level: cell.level, turn: cell.turn };
    placements.push(cell.door === undefined ? placed : { ...placed, door: cell.door });
  });
  return { kit: kit.name, cols, rows, placements };
}
