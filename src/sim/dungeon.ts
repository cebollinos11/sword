/**
 * A Dungeon's Floors as the Simulation reads them (docs/plans/dungeon.md): each Floor a layered graph of Halls, rebuilt
 * from Tuning Data (`dungeon`) and the Run seed whenever it is needed, like a Generated Arena from its name. Never stored
 * in `MatchState`, so nothing about it is hashed or rolled back: every peer builds the same graph with nothing sent.
 */
import type { DungeonEncounter, DungeonFloor, DungeonTuning, HallKind, PooledHallKind, WeightedHallKind } from '../tuning';
import { ARENA_SEED_RANGE } from './arenaGen/named';
import { runPick } from './gauntlet';

/** One node of a Floor graph. */
export interface Hall {
  readonly kind: HallKind;
  /**
   * The Halls its exit Doors lead to: indices into the next row, ascending, 1 to 3 of them. The Boss's `[0]` is row 1 of
   * the next Floor; the last Floor's Boss has none.
   */
  readonly exits: readonly number[];
  /** Its Generated Arena: `gen:<kit>:<seed>:d<n>`, `n` its exits plus the entrance Door. */
  readonly arena: string;
  /** Its Encounter (one of the Floor's pool for a Fight or Elite, the Floor's Boss for the Boss), or null (Treasure, Rest). */
  readonly encounter: DungeonEncounter | null;
}

/** A Floor's Halls by row: row 1 (index 0) the entrance Fight Hall, rows 2 to 4 their Tuning Data widths, row 5 the Boss. */
export type FloorGraph = readonly (readonly Hall[])[];

/** A Floor has 5 rows: the entrance, three rows of 2 to 3 Halls, the Boss. */
export const FLOOR_ROWS = 5;
/** The most exit Doors a Hall has (with the entrance, a Hall Arena holds up to four Doors). */
export const MAX_HALL_EXITS = 3;

/** `runPick` salts, so each choice made for one Hall is independent of the others. */
const SALT = { kind: 10, rest: 11, exitCount: 12, exit: 13, joinFrom: 14, encounter: 15, arena: 16 } as const;
/** How many exits a Hall of rows 2 to 3 asks for, before every Hall of the next row is joined: mostly a choice of two. */
const EXIT_COUNTS = [1, 2, 2, 2, 3] as const;

/** A Hall's slot for `runPick`: unique per (row, index) within a Floor (rows are at most 3 wide). */
const slot = (row: number, index: number) => row * 4 + index;

/** A pure pick of a kind out of `kinds` by their `weights` (the first with weight left over wins; all-zero: the first). */
function weightedKind(weights: Readonly<Record<WeightedHallKind, number>>, kinds: readonly WeightedHallKind[], seed: number, floor: number, at: number): WeightedHallKind {
  const total = kinds.reduce((sum, k) => sum + weights[k], 0);
  let u = (runPick(seed, floor, at, SALT.kind, 0x1_0000_0000) / 0x1_0000_0000) * total;
  for (const k of kinds) {
    if (u < weights[k]) return k;
    u -= weights[k];
  }
  // Rounding left a sliver past the last weight: the last weighted kind.
  for (let k = kinds.length - 1; k > 0; k--) if (weights[kinds[k]!] > 0) return kinds[k]!;
  return kinds[0]!;
}

/** The kinds of a Floor's rows: row 1 a Fight; rows 2 to 4 by weight (no Elite in row 2, one Rest placed in row 4); the Boss. */
function floorKinds(f: DungeonFloor, seed: number, floor: number): HallKind[][] {
  const widths = [1, ...f.rows, 1];
  return widths.map((width, row): HallKind[] => {
    if (row === 0) return ['Fight'];
    if (row === FLOOR_ROWS - 1) return ['Boss'];
    const kinds: readonly WeightedHallKind[] = row === 1 ? ['Fight', 'Treasure'] : ['Fight', 'Elite', 'Treasure'];
    const rest = row === FLOOR_ROWS - 2 ? runPick(seed, floor, row, SALT.rest, width) : -1;
    return Array.from({ length: width }, (_, i) => (i === rest ? 'Rest' : weightedKind(f.weights, kinds, seed, floor, slot(row, i))));
  });
}

/**
 * The exits from a row of `from` Halls into one of `to`: each Hall asks for a few (EXIT_COUNTS), then every Hall of the
 * next row no one reached is joined from a picked Hall of this one, so every Hall is reachable. Paths may cross.
 */
function rowExits(seed: number, floor: number, row: number, from: number, to: number): number[][] {
  if (row === 0 || row === FLOOR_ROWS - 2) return Array.from({ length: from }, () => (row === 0 ? Array.from({ length: to }, (_, j) => j) : [0]));
  const exits = Array.from({ length: from }, (_, i) => {
    const want = Math.min(to, EXIT_COUNTS[runPick(seed, floor, slot(row, i), SALT.exitCount, EXIT_COUNTS.length)]!);
    const left = Array.from({ length: to }, (_, j) => j);
    const picked: number[] = [];
    for (let k = 0; k < want; k++) picked.push(left.splice(runPick(seed, floor, slot(row, i), SALT.exit + 8 * k, left.length), 1)[0]!);
    return picked;
  });
  for (let j = 0; j < to; j++) {
    if (exits.some((e) => e.includes(j))) continue;
    // No Hall reaches j, so none has every Hall of the next row (at most 3) as an exit: each has room for one more.
    exits[runPick(seed, floor, slot(row + 1, j), SALT.joinFrom, from)]!.push(j);
  }
  return exits.map((e) => e.sort((a, b) => a - b));
}

/**
 * Picks each Fight and Elite Hall's Encounter from its Floor's pool, row by row: a pure pick among the pool's least-used
 * Encounters so far, so a Floor repeats one only once the pool has run out (and then evenly).
 */
function floorEncountersByHall(f: DungeonFloor, kinds: readonly (readonly HallKind[])[], seed: number, floor: number): (DungeonEncounter | null)[][] {
  const used: Record<PooledHallKind, number[]> = { Fight: f.encounters.Fight.map(() => 0), Elite: f.encounters.Elite.map(() => 0) };
  return kinds.map((row, r) =>
    row.map((kind, i) => {
      if (kind === 'Boss') return f.boss;
      if (kind !== 'Fight' && kind !== 'Elite') return null;
      const counts = used[kind];
      const least = Math.min(...counts);
      const candidates = counts.flatMap((n, k) => (n === least ? [k] : []));
      const pick = candidates[runPick(seed, floor, slot(r, i), SALT.encounter, candidates.length)]!;
      counts[pick]!++;
      return f.encounters[kind][pick]!;
    }),
  );
}

function dungeonFloor(dungeon: DungeonTuning, floor: number): DungeonFloor {
  const f = dungeon.floors[floor - 1];
  if (!f) throw new RangeError(`A Dungeon has Floors 1 to ${dungeon.floors.length}, not ${floor}`);
  return f;
}

/**
 * Floor `floor`'s (1-based) graph of Halls for the Run seed: kinds, exits, Arena names and Encounters, all pure picks of
 * (Run seed, Floor, row, Hall). Hall Arenas are Generated Arenas of `kit` (the Run's first Arena's). Throws on a Floor the
 * Dungeon lacks.
 */
export function floorGraph(dungeon: DungeonTuning, runSeed: number, floor: number, kit: string): FloorGraph {
  const f = dungeonFloor(dungeon, floor);
  const kinds = floorKinds(f, runSeed, floor);
  const encounters = floorEncountersByHall(f, kinds, runSeed, floor);
  return kinds.map((row, r) => {
    const last = r === FLOOR_ROWS - 1;
    const exits = last ? [floor < dungeon.floors.length ? [0] : []] : rowExits(runSeed, floor, r, row.length, kinds[r + 1]!.length);
    return row.map((kind, i): Hall => {
      const seed = runPick(runSeed, floor, slot(r, i), SALT.arena, ARENA_SEED_RANGE);
      return { kind, exits: exits[i]!, arena: `gen:${kit}:${seed}:d${exits[i]!.length + 1}`, encounter: encounters[r]![i]! };
    });
  });
}

/** The Encounter of Hall `index` of row `row` (0-based, row 0 the entrance) on Floor `floor`: as `floorGraph` gives it. */
export function hallEncounter(dungeon: DungeonTuning, runSeed: number, floor: number, row: number, index: number): DungeonEncounter | null {
  const f = dungeonFloor(dungeon, floor);
  const hall = floorEncountersByHall(f, floorKinds(f, runSeed, floor), runSeed, floor)[row]?.[index];
  if (hall === undefined) throw new RangeError(`Floor ${floor} has no Hall ${index} in row ${row}`);
  return hall;
}
