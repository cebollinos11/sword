/**
 * Kits as Tuning Data (data/kits/<name>.json): the Pieces a Generated Arena is assembled from
 * (docs/plans/generated-arenas.md, ADR 0014). Exported from Blender by art/build_kit_<name>.py, read back
 * from each Piece's Collision helpers, and hashed with the rest of Tuning Data: a Kit decides the Arena a
 * seed gives, so peers with different Kits refuse each other.
 *
 * Every Piece lists its own Walk Surfaces, Walls and connectors relative to its grid cells, unturned:
 * x and z run from 0 to `cols`·cell and `rows`·cell metres, y from the height of the level it stands on.
 * Sides are numbered 0: -z, 1: +x, 2: +z, 3: -x; a quarter turn moves side s to s + 1.
 */
import { checkSurface } from './arena';
import { array, finiteNumber, nonEmptyString, positiveNumber, record, TuningDataError } from './validate';

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

function wholeNumber(o: Record<string, unknown>, key: string, where: string, min: number): number {
  const v = finiteNumber(o, key, where);
  if (!Number.isInteger(v) || v < min) throw new TuningDataError(`${where}.${key} must be a whole number of at least ${min}, got ${v}`);
  return v;
}

function numbers<N extends number>(v: unknown, n: N, where: string): number[] {
  const a = array(v, where);
  if (a.length !== n || !a.every((x) => typeof x === 'number' && Number.isFinite(x))) throw new TuningDataError(`${where} must be ${n} numbers, got ${JSON.stringify(v)}`);
  return a as number[];
}

function side(o: Record<string, unknown>, where: string): Side {
  const s = o.side;
  if (s !== 0 && s !== 1 && s !== 2 && s !== 3) throw new TuningDataError(`${where}.side must be 0, 1, 2 or 3, got ${JSON.stringify(s)}`);
  return s;
}

function parsePiece(raw: unknown, id: PieceId, cell: number, where: string): Piece {
  const o = record(raw, where);
  if (o.id !== id) throw new TuningDataError(`${where}.id must be "${id}", got ${JSON.stringify(o.id)}`);
  const cols = wholeNumber(o, 'cols', where, 1);
  const rows = wholeNumber(o, 'rows', where, 1);
  const inside = (x: number, z: number, at: string) => {
    if (x < 0 || x > cols * cell || z < 0 || z > rows * cell) throw new TuningDataError(`${at}: (${x}, ${z}) is outside the Piece's footprint`);
  };
  /** A cell of the footprint, by its `col` and `row`. */
  const cellOf = (c: Record<string, unknown>, at: string) => {
    const col = finiteNumber(c, 'col', at);
    const row = finiteNumber(c, 'row', at);
    if (!Number.isInteger(col) || col < 0 || col >= cols) throw new TuningDataError(`${at}.col must be a cell of the Piece (0 to ${cols - 1}), got ${col}`);
    if (!Number.isInteger(row) || row < 0 || row >= rows) throw new TuningDataError(`${at}.row must be a cell of the Piece (0 to ${rows - 1}), got ${row}`);
    return { col, row, side: side(c, at) };
  };

  const walk = array(o.walk, `${where}.walk`).map((w, i): PieceSurface => {
    const at = `${where}.walk[${i}]`;
    const s = record(w, at);
    const points = array(s.points, `${at}.points`).map((p, k) => {
      const [x, y, z] = numbers(p, 3, `${at}.points[${k}]`) as [number, number, number];
      inside(x, z, `${at}.points[${k}]`);
      return [x, y, z] as const;
    });
    checkSurface({ id: at, points: points.map(([x, y, z]) => ({ x, y, z })) }, at);
    if (s.tile !== undefined && typeof s.tile !== 'boolean') throw new TuningDataError(`${at}.tile must be true or false`);
    return s.tile === true ? { points, tile: true } : { points };
  });
  const walls = array(o.walls, `${where}.walls`).map((w, i): PieceWall => {
    const at = `${where}.walls[${i}]`;
    const s = record(w, at);
    const [ax, az] = numbers(s.a, 2, `${at}.a`) as [number, number];
    const [bx, bz] = numbers(s.b, 2, `${at}.b`) as [number, number];
    inside(ax, az, `${at}.a`);
    inside(bx, bz, `${at}.b`);
    const bottom = finiteNumber(s, 'bottom', at);
    const top = finiteNumber(s, 'top', at);
    if (top <= bottom) throw new TuningDataError(`${at}.top must be above its bottom`);
    return { a: [ax, az], b: [bx, bz], bottom, top };
  });
  const connectors = array(o.connectors, `${where}.connectors`).map((c, i): Connector => {
    const at = `${where}.connectors[${i}]`;
    const s = record(c, at);
    return { ...cellOf(s, at), y: finiteNumber(s, 'y', at) };
  });
  const skirts = array(o.skirts, `${where}.skirts`).map((c, i): Skirt => {
    const at = `${where}.skirts[${i}]`;
    const s = record(c, at);
    const min = finiteNumber(s, 'min', at);
    const max = finiteNumber(s, 'max', at);
    if (max < min) throw new TuningDataError(`${at}.max must be at least its min`);
    return { ...cellOf(s, at), min, max };
  });
  if (typeof o.solid !== 'boolean') throw new TuningDataError(`${where}.solid must be true or false`);
  return { id, cols, rows, walk, walls, connectors, skirts, solid: o.solid };
}

/** Validate one raw Kit file. Throws TuningDataError naming the path. */
export function parseKit(raw: unknown, where: string): Kit {
  const r = record(raw, where);
  const name = nonEmptyString(r, 'name', where);
  const cell = positiveNumber(r, 'cell', where);
  const levelHeight = positiveNumber(r, 'levelHeight', where);
  const maxLevels = wholeNumber(r, 'maxLevels', where, 1);
  const raws = record(r.pieces, `${where}.pieces`);
  for (const id of Object.keys(raws)) if (!(PIECE_IDS as readonly string[]).includes(id)) throw new TuningDataError(`${where}.pieces: unknown Piece "${id}" (Pieces: ${PIECE_IDS.join(', ')})`);
  const pieces = Object.fromEntries(PIECE_IDS.map((id) => [id, parsePiece(raws[id], id, cell, `${where}.pieces.${id}`)])) as { [K in PieceId]: Piece };
  return { name, cell, levelHeight, maxLevels, pieces };
}
