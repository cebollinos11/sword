/**
 * A Delver Run's Floor generator as Tuning Data (data/delver.json, hashed): the lattice of rooms, the passages between
 * them and the rules that place the Halls' kinds (docs/plans/delver.md, Stage 1). Every peer builds each Floor from this
 * and the Run seed, so peers with different Delver Tuning Data refuse each other at connect.
 */
import { array, finiteNumber, record, TuningDataError } from './validate';

export interface DelverFloorTuning {
  /** Lattice columns (whole, >= 2). */
  readonly cols: number;
  /** Lattice rows (whole, >= 2). */
  readonly rows: number;
  /** Halls wanted (whole, 2 to cols * rows). */
  readonly rooms: number;
  /** The metres between neighbouring lattice columns (rows), one picked per gap; each even and positive. */
  readonly gaps: readonly number[];
  /** [min, max] of a Hall's half-width and half-depth (whole m; min >= 4, a pedestal, the Stairs zone or a spawn and the judge's 1 m margin). */
  readonly halfSize: readonly [number, number];
  /** The shortest Passage between lattice neighbours (whole m, >= 1). */
  readonly minPassage: number;
  /** A Passage's width and its doorways' (whole m); wider than `flowCell`, at most twice the smallest half size. */
  readonly passage: number;
  /** The chance (in 100) that a growth step joins a Hall two lattice steps away over an empty cell. */
  readonly farPercent: number;
  /** [min, max] extra Passages after the spanning tree. */
  readonly loops: readonly [number, number];
  /** [min, max] Rest Halls (min >= 1). */
  readonly rests: readonly [number, number];
  /** Treasure Halls at most. */
  readonly treasures: number;
  /** The share (in 100) of the Halls left after the named kinds that are Empty. */
  readonly emptyPercent: number;
  /** Patrol loops at most. */
  readonly patrols: number;
  /** The judge's Passage slack: a field distance along a Passage may be up to this times its length (>= 1). */
  readonly follow: number;
  /** The most layouts tried for one (seed, Floor) (whole, >= 1). */
  readonly maxAttempts: number;
}

export interface DelverTuning {
  /** The tiers in a Run (whole, >= 1); a Boss ends each (docs/plans/delver.md, Decisions). */
  readonly tiers: number;
  /** The Floors in each tier (whole, >= 1); a Run is `tiers * floorsPerTier` Floors deep. */
  readonly floorsPerTier: number;
  /** The destination fields' cell (m) on a Floor; the Battles keep `crowd.flowCell`. */
  readonly flowCell: number;
  readonly floor: DelverFloorTuning;
}

/**
 * The smallest Hall half-width: a pedestal 3 m from the centre plus the judge's 1 m margin, which also covers the Stairs' 2 m half
 * zone and a spawn 1.5 m out, each plus that margin. (The Floor generator's constants live in `sim/delver`, which tuning must not import.)
 */
const MIN_HALL_HALF = 4;

function fail(where: string, what: string, v: unknown): never {
  throw new TuningDataError(`${where} must be ${what}, got ${JSON.stringify(v)}`);
}

function whole(obj: Record<string, unknown>, key: string, where: string, min: number): number {
  const v = finiteNumber(obj, key, where);
  if (!Number.isInteger(v) || v < min) fail(`${where}.${key}`, min === 0 ? 'a whole number >= 0' : `a whole number >= ${min}`, v);
  return v;
}

function range(obj: Record<string, unknown>, key: string, where: string, min: number): readonly [number, number] {
  const path = `${where}.${key}`;
  const a = array(obj[key], path);
  if (a.length !== 2) fail(path, 'a [min, max] pair', obj[key]);
  const lo = a[0];
  const hi = a[1];
  if (typeof lo !== 'number' || !Number.isInteger(lo) || lo < min) fail(`${path}[0]`, `a whole number >= ${min}`, lo);
  if (typeof hi !== 'number' || !Number.isInteger(hi) || hi < lo) fail(`${path}[1]`, `a whole number >= ${path}[0]`, hi);
  return [lo, hi];
}

function percent(obj: Record<string, unknown>, key: string, where: string): number {
  const v = whole(obj, key, where, 0);
  if (v > 100) fail(`${where}.${key}`, 'a whole number 0 to 100', v);
  return v;
}

/** Parse and validate `delver`; `fieldSize` is the Battle's field side (`battle.field.size`), which the lattice must fit. */
export function parseDelver(raw: unknown, fieldSize: number): DelverTuning {
  const root = record(raw, 'delver');
  const flowCell = finiteNumber(root, 'flowCell', 'delver');
  if (flowCell <= 0) fail('delver.flowCell', 'a positive number', flowCell);
  // The Floor generator keeps every Hall Wall on an odd metre so none runs through a 2 m cell centre; that rule is written for a 2 m cell.
  if (flowCell !== 2) fail('delver.flowCell', 'exactly 2 (the Floor generator keeps Walls off a 2 m field cell\'s centres)', flowCell);
  const tiers = whole(root, 'tiers', 'delver', 1);
  const floorsPerTier = whole(root, 'floorsPerTier', 'delver', 1);
  const f = record(root.floor, 'delver.floor');
  const w = 'delver.floor';

  const cols = whole(f, 'cols', w, 2);
  const rows = whole(f, 'rows', w, 2);
  const rooms = whole(f, 'rooms', w, 2);
  if (rooms > cols * rows) fail(`${w}.rooms`, `at most cols * rows (${cols * rows})`, rooms);

  const gapList = array(f.gaps, `${w}.gaps`);
  if (gapList.length === 0) fail(`${w}.gaps`, 'a non-empty array', f.gaps);
  const gaps = gapList.map((g, i) => {
    if (typeof g !== 'number' || !Number.isInteger(g) || g <= 0 || g % 2 !== 0) fail(`${w}.gaps[${i}]`, 'an even positive whole number', g);
    return g;
  });

  const halfSize = range(f, 'halfSize', w, MIN_HALL_HALF);
  const minPassage = whole(f, 'minPassage', w, 1);
  const passage = whole(f, 'passage', w, 1);
  const minGap = Math.min(...gaps);
  const maxGap = Math.max(...gaps);
  if (minGap - minPassage < 2 * halfSize[0]) fail(`${w}.minPassage`, `at most min(gaps) - 2 * halfSize[0] (${minGap - 2 * halfSize[0]})`, minPassage);
  // A Hall's half size may move one metre up to dodge an even-metre Wall (plan.ts), so the gaps must leave room for halfSize[0] + 1.
  if (Math.floor((minGap - minPassage) / 2) < halfSize[0] + 1) fail(`${w}.minPassage`, `at most min(gaps) - 2 * (halfSize[0] + 1) (${minGap - 2 * (halfSize[0] + 1)}), so a Hall can always grow a metre`, minPassage);
  if (passage > 2 * halfSize[0]) fail(`${w}.passage`, `at most 2 * halfSize[0] (${2 * halfSize[0]})`, passage);
  if (passage <= flowCell) fail(`${w}.passage`, `wider than delver.flowCell (${flowCell}), so a field node always lies inside a Passage`, passage);
  for (const [key, n] of [['cols', cols], ['rows', rows]] as const) {
    if (((n - 1) * maxGap) / 2 + halfSize[1] + 2 > fieldSize / 2) fail(`${w}.${key}`, `small enough that the lattice fits the ${fieldSize} m field`, n);
  }

  const farPercent = percent(f, 'farPercent', w);
  const loops = range(f, 'loops', w, 0);
  const rests = range(f, 'rests', w, 1);
  const treasures = whole(f, 'treasures', w, 0);
  const emptyPercent = percent(f, 'emptyPercent', w);
  const patrols = whole(f, 'patrols', w, 0);
  const follow = finiteNumber(f, 'follow', w);
  if (follow < 1) fail(`${w}.follow`, 'a number >= 1', follow);
  const maxAttempts = whole(f, 'maxAttempts', w, 1);

  return {
    tiers,
    floorsPerTier,
    flowCell,
    floor: { cols, rows, rooms, gaps, halfSize, minPassage, passage, farPercent, loops, rests, treasures, emptyPercent, patrols, follow, maxAttempts },
  };
}
