/**
 * Kits and Pieces (docs/plans/generated-arenas.md): the parts a Generated Arena is assembled from.
 * Every Piece lists its own Walk Surfaces, Walls and connectors relative to its grid cells, unturned:
 * x and z run from 0 to `cols`·cell and `rows`·cell metres, y from the height of the level it stands on.
 * Sides are numbered 0: -z, 1: +x, 2: +z, 3: -x; a quarter turn moves side s to s + 1.
 */

export type PieceId = 'floor' | 'ramp' | 'crate' | 'pillar' | 'rail' | 'bridge' | 'void';
export const PIECE_IDS: readonly PieceId[] = ['floor', 'ramp', 'crate', 'pillar', 'rail', 'bridge', 'void'];

export type Side = 0 | 1 | 2 | 3;

/** A Walk Surface of a Piece: [x, y, z] corners, cell-local. `tile`: a whole flat cell, which the assembler may merge with its neighbours. */
export interface PieceSurface {
  readonly points: readonly (readonly [number, number, number])[];
  readonly tile?: boolean;
}

/** A Wall of a Piece: [x, z] ends, cell-local, solid from `bottom` to `top` above the Piece's level. */
export interface PieceWall {
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
  readonly bottom: number;
  readonly top: number;
}

/** Where walking crosses out of a Piece: out of its cell (`col`, `row`) through side `side`, at height `y` above its level. */
export interface Connector {
  readonly col: number;
  readonly row: number;
  readonly side: Side;
  readonly y: number;
}

/** The ground along side `side` of cell (`col`, `row`) of a Piece, from `min` to `max` above its level. The assembler stands a Wall under ground higher than its neighbour's. */
export interface Skirt {
  readonly col: number;
  readonly row: number;
  readonly side: Side;
  readonly min: number;
  readonly max: number;
}

export interface Piece {
  readonly id: PieceId;
  /** Its footprint in cells, unturned. */
  readonly cols: number;
  readonly rows: number;
  readonly walk: readonly PieceSurface[];
  readonly walls: readonly PieceWall[];
  readonly connectors: readonly Connector[];
  readonly skirts: readonly Skirt[];
  /** Whether its whole footprint is ground (or walled off), with no gap a body could step through into the Abyss. */
  readonly solid: boolean;
}

export interface Kit {
  readonly name: string;
  /** The grid cell's side (m). */
  readonly cell: number;
  /** How far apart (m) the floor levels are: level k stands at k · levelHeight. */
  readonly levelHeight: number;
  /** The most floor levels a Layout may use. */
  readonly maxLevels: number;
  readonly pieces: { readonly [K in PieceId]: Piece };
}

const CELL = 3;
const LEVEL = 3;
const CRATE = 0.8;
const RAIL = 1;
const PILLAR = 4;

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

/** The grey placeholder Kit, written by hand: a 3 m grid, floors at 0, 3 and 6 m, 0.8 m crates. */
export const GREYBOX_KIT: Kit = {
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
  },
};
