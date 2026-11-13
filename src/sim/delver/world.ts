/**
 * Floors from (Run seed, Floor) alone (docs/plans/delver.md, Stage 2): a Delver Run's Floor is the Arena `battle:delver<F>s<S>`, built
 * by `delverFloor` from Tuning Data and its name, so every peer deals the same Floor with nothing sent. `floorOf` keeps the last few
 * built, as `generatedArena` does, and `arenaTuning` is the Tuning Data to read a Floor's Arena under (`arenaOf` itself knows no Floors).
 * Everything cached here is derived from static data: never stored in the Simulation, and a rebuilt one is equal.
 */
import type { TuningData } from '../../tuning';
import { delverFloor, type DelverFloor } from './generate';
import { floorName, isFloorName } from './source';

/** How many Floors one Tuning Data keeps built: the current, the next (warmed) and slack. A dropped one is built again (the same Floor). */
export const KEPT_FLOORS = 4;

const PREFIX = 'battle:';

/** The Arena name of Floor `floor` (1-based) of Run seed `seed`: `battle:delver<F>s<S>`. */
export const floorArenaName = (seed: number, floor: number): string => `${PREFIX}${floorName(seed, floor)}`;

/** The Run seed and Floor a Floor's Arena name gives (the inverse of `floorArenaName`), or null for any other name. */
export function parseFloorArena(name: string): { seed: number; floor: number } | null {
  if (!name.startsWith(PREFIX)) return null;
  const map = name.slice(PREFIX.length);
  if (!isFloorName(map)) return null;
  const [floor, seed] = map.slice('delver'.length).split('s');
  return { seed: Number(seed), floor: Number(floor) };
}

/** A kept Floor and the Tuning Data copy that reads it. */
interface Kept {
  readonly floor: DelverFloor;
  readonly tuning: TuningData;
}

/** Built Floors per base Tuning Data, most recently used last. */
const builds = new WeakMap<object, Map<string, Kept>>();
/** Each copy `arenaTuning` made, to the Tuning Data it copied: the copy shares that one's builds. */
const bases = new WeakMap<object, TuningData>();

/** The kept entry of Floor arena `name` under `tuning` (its base, for a copy), built if need be; null for a name that is not a Floor's. */
function entryOf(tuning: TuningData, name: string): Kept | null {
  const parsed = parseFloorArena(name);
  if (!parsed) return null;
  const base = bases.get(tuning) ?? tuning;
  let kept = builds.get(base);
  if (!kept) builds.set(base, (kept = new Map()));
  let entry = kept.get(name);
  if (entry) {
    kept.delete(name);
  } else {
    const floor = delverFloor(base, parsed.seed, parsed.floor);
    const copy: TuningData = { ...base, battle: floor.battle };
    bases.set(copy, base);
    entry = { floor, tuning: copy };
    if (kept.size >= KEPT_FLOORS) kept.delete(kept.keys().next().value!);
  }
  kept.set(name, entry);
  return entry;
}

/** The built Floor of a Floor's Arena name, else null. Built once per (Tuning Data, name) and kept (`KEPT_FLOORS`, most recently used last). Throws if no layout builds. */
export function floorOf(tuning: TuningData, name: string): DelverFloor | null {
  return entryOf(tuning, name)?.floor ?? null;
}

/**
 * The Tuning Data to read Arena `name` under: `tuning` itself for any name that is not a Floor's; for a Floor's, `{ ...base, battle: floor.battle }`
 * (the Battles' Tuning with the Floor's map the only one, at `delver.flowCell`), the same object while the Floor is kept. A copy maps back
 * to its base, so it shares the builds, and a copy asked for its own Floor's name is returned as it is.
 */
export function arenaTuning(tuning: TuningData, name: string): TuningData {
  return entryOf(tuning, name)?.tuning ?? tuning;
}
