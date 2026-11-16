/**
 * The grid a Layout lives on: turning Pieces a quarter at a time, and which cells walking joins
 * (through matching connectors). Shared by the generator and the assembler. Exact: grid cells and
 * quarter turns only, no trig.
 */
import type { Kit, PieceId, Side } from './kit';

/** One Piece placed on the grid: its cell nearest -x and -z, the level it stands on, and how many quarter turns. */
export interface PlacedPiece {
  readonly piece: PieceId;
  readonly col: number;
  readonly row: number;
  readonly level: number;
  readonly turn: number;
}

/** The Pieces a seed places, before they are assembled into an Arena. */
export interface Layout {
  readonly kit: string;
  readonly cols: number;
  readonly rows: number;
  /** In the order of their first cell (row by row, -z first, then -x first). */
  readonly placements: readonly PlacedPiece[];
}

/** A Piece's footprint (cols, rows) after `turn` quarter turns. */
export function footprint(kit: Kit, p: Pick<PlacedPiece, 'piece' | 'turn'>): [cols: number, rows: number] {
  const piece = kit.pieces[p.piece];
  return p.turn % 2 === 0 ? [piece.cols, piece.rows] : [piece.rows, piece.cols];
}

/** The point (x, z) of a footprint `w` × `d` (m), turned `turn` quarter turns within it: each turn takes (x, z) to (d − z, x). */
export function turnPoint(x: number, z: number, w: number, d: number, turn: number): [number, number] {
  for (let t = 0; t < turn % 4; t++) {
    [x, z] = [d - z, x];
    [w, d] = [d, w];
  }
  return [x, z];
}

/** The step (dc, dr) out of a cell through side `side`. */
export const SIDE_STEP: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Per cell (row by row), the index of the PlacedPiece covering it, or -1. */
export function owners(kit: Kit, layout: Layout): number[] {
  const owner = new Array<number>(layout.cols * layout.rows).fill(-1);
  layout.placements.forEach((p, i) => {
    const [w, d] = footprint(kit, p);
    for (let r = p.row; r < p.row + d; r++) for (let c = p.col; c < p.col + w; c++) owner[r * layout.cols + c] = i;
  });
  return owner;
}

/** Whether a cell is covered by a Piece with somewhere to stand. */
export function walkable(kit: Kit, layout: Layout, owner: readonly number[], cell: number): boolean {
  const i = owner[cell]!;
  return i >= 0 && kit.pieces[layout.placements[i]!.piece].walk.length > 0;
}

/**
 * Which cells walking joins: per cell, its neighbours (ascending) that it shares a Piece with, or that it meets
 * through a connector on each side at the same height.
 */
export function cellGraph(kit: Kit, layout: Layout): number[][] {
  const { cols, rows } = layout;
  const owner = owners(kit, layout);
  // Per cell and side, the heights (m) walking crosses it at.
  const open: number[][] = Array.from({ length: cols * rows * 4 }, () => []);
  layout.placements.forEach((p) => {
    const piece = kit.pieces[p.piece];
    const [w, d] = [piece.cols, piece.rows];
    for (const c of piece.connectors) {
      // The connector's cell centre, turned, gives the cell it is on.
      const [x, z] = turnPoint(c.col + 0.5, c.row + 0.5, w, d, p.turn);
      const cell = (p.row + Math.floor(z)) * cols + p.col + Math.floor(x);
      open[cell * 4 + ((c.side + p.turn) % 4)]!.push(p.level * kit.levelHeight + c.y);
    }
  });
  const graph: number[][] = Array.from({ length: cols * rows }, () => []);
  for (let cell = 0; cell < cols * rows; cell++) {
    const c = cell % cols;
    const r = Math.floor(cell / cols);
    for (let side = 0; side < 4; side++) {
      const [dc, dr] = SIDE_STEP[side]!;
      if (c + dc < 0 || c + dc >= cols || r + dr < 0 || r + dr >= rows) continue;
      const other = (r + dr) * cols + c + dc;
      const shared = owner[cell]! >= 0 && owner[cell] === owner[other];
      const meet = open[cell * 4 + side]!.some((y) => open[other * 4 + ((side + 2) % 4)]!.includes(y));
      if (shared || meet) graph[cell]!.push(other);
    }
    graph[cell]!.sort((a, b) => a - b);
  }
  return graph;
}

/** Walking distances (in cells) from `start` over `graph`, -1 where it never gets. */
export function distances(graph: readonly (readonly number[])[], start: number): number[] {
  const dist = new Array<number>(graph.length).fill(-1);
  dist[start] = 0;
  const queue = [start];
  for (let k = 0; k < queue.length; k++) {
    const at = queue[k]!;
    for (const n of graph[at]!) if (dist[n] === -1) (dist[n] = dist[at]! + 1), queue.push(n);
  }
  return dist;
}

export type { Side };
