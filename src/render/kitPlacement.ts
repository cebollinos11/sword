/**
 * Where a Kit model's parts are drawn for a Layout (docs/plans/generated-arenas.md, Stage 4): each placed Piece's
 * root node (`PIECE_<id>`, exported by art/build_kit_<name>.py) moved by whole cells and turned by quarter turns,
 * the same way the assembler places its Walk Surfaces and Walls, so the art stands exactly where the collision does.
 * No trig: every matrix entry is 0, 1 or -1, or an offset in whole (or half) cells. Pure: no three.js.
 */
import { turnPoint, type Kit, type Layout } from '../sim';

/** A support column (one cell, one level tall, its top at its origin) stacked under every cell of a solid Piece above level 0. */
export const SUPPORT_NODE = 'TRIM_support';

/** One part of the Kit model to draw: its node, and its 4 × 4 matrix (column-major, as THREE.Matrix4.elements) from Piece-local to world. */
export interface KitPlacement {
  readonly node: string;
  readonly matrix: readonly number[];
}

/** `matrix` applied to the point (x, y, z). */
export function transformPoint(matrix: readonly number[], [x, y, z]: readonly [number, number, number]): [number, number, number] {
  const m = matrix;
  return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
}

/** Every Piece of the Layout but void (in Layout order), then the support columns (in Layout order, cell by cell, bottom up). */
export function kitPlacements(kit: Kit, layout: Layout): KitPlacement[] {
  const size = kit.cell;
  const x0 = (-layout.cols * size) / 2;
  const z0 = (-layout.rows * size) / 2;
  const placed: KitPlacement[] = [];
  const supports: KitPlacement[] = [];
  for (const p of layout.placements) {
    if (p.piece === 'void') continue;
    const piece = kit.pieces[p.piece];
    const [w, d] = [piece.cols * size, piece.rows * size];
    // The turn as an exact linear map: where the origin and the two unit steps along x and z go.
    const [ox, oz] = turnPoint(0, 0, w, d, p.turn);
    const [xx, xz] = turnPoint(1, 0, w, d, p.turn);
    const [zx, zz] = turnPoint(0, 1, w, d, p.turn);
    const tx = x0 + p.col * size + ox;
    const ty = p.level * kit.levelHeight;
    const tz = z0 + p.row * size + oz;
    placed.push({ node: `PIECE_${p.piece}`, matrix: [xx - ox, 0, xz - oz, 0, 0, 1, 0, 0, zx - ox, 0, zz - oz, 0, tx, ty, tz, 1] });
    if (!piece.solid) continue;
    const [fw, fd] = p.turn % 2 === 0 ? [piece.cols, piece.rows] : [piece.rows, piece.cols];
    for (let r = p.row; r < p.row + fd; r++)
      for (let c = p.col; c < p.col + fw; c++)
        for (let k = 1; k <= p.level; k++) supports.push({ node: SUPPORT_NODE, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x0 + c * size, k * kit.levelHeight, z0 + r * size, 1] });
  }
  return [...placed, ...supports];
}
