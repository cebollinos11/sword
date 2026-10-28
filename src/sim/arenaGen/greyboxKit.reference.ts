/**
 * The greybox Kit as it was written by hand before it became a Kit file (data/kits/greybox.json, built by
 * art/build_kit_greybox.py). Tests only: the Kit read from the file must deep-equal it, so every Generated Arena
 * is the same as before. Do not edit it to match the file; a Piece added later (the door, for the Dungeon's Hall
 * Arenas) is added here as well, so it is checked too.
 */
import type { Connector, Kit, PieceSurface, PieceWall, Skirt } from '../../tuning';

const CELL = 3;
const LEVEL = 3;
const CRATE = 0.8;
const RAIL = 1;
const PILLAR = 4;
const DOOR_WALL = 4;

/** A flat rectangle from (x0, z0) to (x1, z1) at height y. */
const rect = (x0: number, z0: number, x1: number, z1: number, y = 0): PieceSurface['points'] => [
  [x0, y, z0],
  [x1, y, z0],
  [x1, y, z1],
  [x0, y, z1],
];

/** The four Walls round a box from (x0, z0) to (x1, z1), solid from 0 to `top`. */
const box = (x0: number, z0: number, x1: number, z1: number, top: number): PieceWall[] => [
  { a: [x0, z0], b: [x1, z0], bottom: 0, top },
  { a: [x1, z0], b: [x1, z1], bottom: 0, top },
  { a: [x1, z1], b: [x0, z1], bottom: 0, top },
  { a: [x0, z1], b: [x0, z0], bottom: 0, top },
];

/** The floor of a cell round a box from `lo` to `hi` (both axes): four rectangles, so the navmesh goes round it. */
const ring = (lo: number, hi: number): PieceSurface[] => [
  { points: rect(0, 0, CELL, lo) },
  { points: rect(hi, lo, CELL, hi) },
  { points: rect(0, hi, CELL, CELL) },
  { points: rect(0, lo, lo, hi) },
];

const ALL_SIDES: Connector[] = ([0, 1, 2, 3] as const).map((side) => ({ col: 0, row: 0, side, y: 0 }));
const LEVEL_SKIRTS: Skirt[] = ([0, 1, 2, 3] as const).map((side) => ({ col: 0, row: 0, side, min: 0, max: 0 }));
const TILE: PieceSurface = { points: rect(0, 0, CELL, CELL), tile: true };

/** The grey placeholder Kit as it was written by hand in TypeScript (Stages 1-3): a 3 m grid, floors at 0, 3 and 6 m, 0.8 m crates. */
export const HAND_WRITTEN_GREYBOX_KIT: Kit = {
  name: 'greybox',
  cell: CELL,
  levelHeight: LEVEL,
  maxLevels: 3,
  pieces: {
    floor: { id: 'floor', cols: 1, rows: 1, walk: [TILE], walls: [], connectors: ALL_SIDES, skirts: LEVEL_SKIRTS, solid: true },
    // Rises one level along +z over two cells.
    ramp: {
      id: 'ramp',
      cols: 1,
      rows: 2,
      walk: [
        {
          points: [
            [0, 0, 0],
            [CELL, 0, 0],
            [CELL, LEVEL, 2 * CELL],
            [0, LEVEL, 2 * CELL],
          ],
        },
      ],
      walls: [],
      connectors: [
        { col: 0, row: 0, side: 0, y: 0 },
        { col: 0, row: 1, side: 2, y: LEVEL },
      ],
      skirts: [
        { col: 0, row: 0, side: 0, min: 0, max: 0 },
        { col: 0, row: 0, side: 1, min: 0, max: LEVEL / 2 },
        { col: 0, row: 0, side: 3, min: 0, max: LEVEL / 2 },
        { col: 0, row: 1, side: 1, min: LEVEL / 2, max: LEVEL },
        { col: 0, row: 1, side: 3, min: LEVEL / 2, max: LEVEL },
        { col: 0, row: 1, side: 2, min: LEVEL, max: LEVEL },
      ],
      solid: true,
    },
    // A 1.5 m crate in the middle of the cell, with a lid to Jump onto.
    crate: { id: 'crate', cols: 1, rows: 1, walk: [...ring(0.75, 2.25), { points: rect(0.75, 0.75, 2.25, 2.25, CRATE) }], walls: box(0.75, 0.75, 2.25, 2.25, CRATE), connectors: ALL_SIDES, skirts: LEVEL_SKIRTS, solid: true },
    pillar: { id: 'pillar', cols: 1, rows: 1, walk: ring(1, 2), walls: box(1, 1, 2, 2, PILLAR), connectors: ALL_SIDES, skirts: LEVEL_SKIRTS, solid: true },
    // A floor with a low Wall along its -z side.
    rail: { id: 'rail', cols: 1, rows: 1, walk: [TILE], walls: [{ a: [0, 0], b: [CELL, 0], bottom: 0, top: RAIL }], connectors: ALL_SIDES.filter((c) => c.side !== 0), skirts: LEVEL_SKIRTS, solid: true },
    // A 2 m wide floor along z, with nothing either side of it.
    bridge: {
      id: 'bridge',
      cols: 1,
      rows: 1,
      walk: [{ points: rect(0.5, 0, 2.5, CELL) }],
      walls: [],
      connectors: [
        { col: 0, row: 0, side: 0, y: 0 },
        { col: 0, row: 0, side: 2, y: 0 },
      ],
      skirts: [],
      solid: false,
    },
    void: { id: 'void', cols: 1, rows: 1, walk: [], walls: [], connectors: [], skirts: [], solid: false },
    // An edge cell's floor with a tall Wall along its -z side (a doorway drawn in it) and a door zone before it.
    door: {
      id: 'door',
      cols: 1,
      rows: 1,
      walk: [TILE],
      walls: [{ a: [0, 0], b: [CELL, 0], bottom: 0, top: DOOR_WALL }],
      connectors: ALL_SIDES.filter((c) => c.side !== 0),
      skirts: LEVEL_SKIRTS,
      solid: true,
      zone: [
        [0.25, 0],
        [2.75, 0],
        [2.75, 2.5],
        [0.25, 2.5],
      ],
    },
  },
};
