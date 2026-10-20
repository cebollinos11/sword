import { describe, expect, it } from 'vitest';
import { assembleArena, DEFAULT_GEN_PARAMS, generateLayout, GREYBOX_KIT, type Layout } from '../sim';
import { kitPlacements, transformPoint, type KitPlacement } from './kitPlacement';

const kit = GREYBOX_KIT;
const layouts: Layout[] = [1, 12, 31, 77].map((seed) => generateLayout(kit, seed, DEFAULT_GEN_PARAMS));

const pieces = (placed: readonly KitPlacement[]) => placed.filter((p) => p.node.startsWith('PIECE_'));

describe('kitPlacements: where the renderer draws each placed Piece of a Kit model', () => {
  it('draws every placed Piece but void, in Layout order, as PIECE_<id>', () => {
    for (const layout of layouts) {
      expect(pieces(kitPlacements(kit, layout)).map((p) => p.node)).toEqual(layout.placements.filter((p) => p.piece !== 'void').map((p) => `PIECE_${p.piece}`));
    }
  });

  it("moves each Piece's own Walls exactly onto the assembled Arena's (the art stands where the collision does)", () => {
    for (const layout of layouts) {
      const arena = assembleArena(kit, layout, 'test');
      const placed = pieces(kitPlacements(kit, layout));
      const walls = layout.placements
        .filter((p) => p.piece !== 'void')
        .flatMap((p, i) =>
          kit.pieces[p.piece].walls.map((w) => {
            const a = transformPoint(placed[i]!.matrix, [w.a[0], w.bottom, w.a[1]]);
            const b = transformPoint(placed[i]!.matrix, [w.b[0], w.top, w.b[1]]);
            return { a: { x: a[0], z: a[2] }, b: { x: b[0], z: b[2] }, bottom: a[1], top: b[1] };
          }),
        );
      // The Pieces' Walls come first, in placement order; the skirt Walls follow.
      expect(walls).toEqual(arena.walls.slice(0, walls.length).map(({ id: _id, ...w }) => w));
    }
  });

  it("moves each Piece's own (unmerged) Walk Surfaces exactly onto the assembled Arena's", () => {
    for (const layout of layouts) {
      const arena = assembleArena(kit, layout, 'test');
      const placed = pieces(kitPlacements(kit, layout));
      const surfaces = layout.placements
        .filter((p) => p.piece !== 'void')
        .flatMap((p, i) =>
          kit.pieces[p.piece].walk
            .filter((s) => !s.tile)
            .map((s) => s.points.map((pt) => {
              const [x, y, z] = transformPoint(placed[i]!.matrix, pt);
              return { x, y, z };
            })),
        );
      // After the merged whole cells, before the Abyss.
      const walk = arena.walk.filter((s) => !s.abyss);
      expect(surfaces).toEqual(walk.slice(walk.length - surfaces.length).map((s) => s.points));
    }
  });

  it('uses whole quarter turns only: every matrix entry is 0, 1 or -1 (or a whole-cell offset)', () => {
    for (const layout of layouts)
      for (const { matrix } of kitPlacements(kit, layout)) {
        const basis = [0, 1, 2, 4, 5, 6, 8, 9, 10].map((k) => matrix[k]!);
        expect(basis.every((v) => v === 0 || v === 1 || v === -1)).toBe(true);
        expect(Number.isInteger(matrix[12]! / (kit.cell / 2))).toBe(true);
        expect(Number.isInteger(matrix[14]! / (kit.cell / 2))).toBe(true);
      }
  });

  it('stands a support column under every cell of a solid Piece above level 0, one per level below it', () => {
    for (const layout of layouts) {
      const supports = kitPlacements(kit, layout).filter((p) => p.node === 'TRIM_support');
      const expected = layout.placements
        .filter((p) => kit.pieces[p.piece].solid)
        .reduce((n, p) => n + kit.pieces[p.piece].cols * kit.pieces[p.piece].rows * p.level, 0);
      expect(supports).toHaveLength(expected);
      // Each column's top (its origin) is at a whole level, from 1 up.
      for (const s of supports) expect(s.matrix[13]! / kit.levelHeight).toBeGreaterThanOrEqual(1);
    }
    expect(layouts.some((l) => l.placements.some((p) => p.level > 0 && kit.pieces[p.piece].solid))).toBe(true);
  });
});
