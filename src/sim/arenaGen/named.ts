/**
 * A Random Map built from its name alone (docs/plans/generated-arenas.md, Stage 5): `gen:<kit>:<seed>` names a Generated
 * Arena from that Kit (out of Tuning Data) and seed with DEFAULT_GEN_PARAMS, so every peer that holds the same Tuning Data
 * builds the same Arena from the Lobby's Map setting.
 */
import type { TuningData } from '../../tuning';
import { generateArena, type GeneratedArena } from './generate';
import type { Layout } from './grid';
import { DEFAULT_GEN_PARAMS } from './layout';

const PREFIX = 'gen:';

/** Random Map seeds run from 0 to ARENA_SEED_RANGE - 1 (short enough to read out). */
export const ARENA_SEED_RANGE = 1_000_000;
/** The fixed step from one Match's seed to the next: odd and not a multiple of 5, so it visits every seed in range before any repeats. */
const ARENA_SEED_STEP = 381_967;

/** The Kit and seed a `gen:<kit>:<seed>` name gives, or null for any other name. Throws on a gen: name that is malformed. */
export function parseGeneratedName(name: string): { kit: string; seed: number } | null {
  if (!name.startsWith(PREFIX)) return null;
  const parts = name.slice(PREFIX.length).split(':');
  if (parts.length !== 2) throw new Error(`Generated Arena "${name}": the name must be gen:<kit>:<seed>`);
  const [kit, text] = parts as [string, string];
  const seed = Number(text);
  // Written as generatedName writes it (no sign, no leading zeros), so the name the Arena carries is the one asked for.
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(seed) || String(seed) !== text) throw new Error(`Generated Arena "${name}": the seed "${text}" is not a whole number`);
  return { kit, seed };
}

/** The seed of the Match after one on `seed` (Stage 6): a fixed whole-number step, so every peer derives the same one. */
export function nextArenaSeed(seed: number): number {
  return ((seed % ARENA_SEED_RANGE) + ARENA_SEED_STEP) % ARENA_SEED_RANGE;
}

/** The Arena of the Match after one on `name`: a Random Map's next seed (`nextArenaSeed`); a hand-made Arena itself. */
export function nextArenaName(name: string): string {
  const parsed = parseGeneratedName(name);
  return parsed ? `${PREFIX}${parsed.kit}:${nextArenaSeed(parsed.seed)}` : name;
}

/** May a Lobby name this Arena: one Tuning Data holds, or a well-formed gen: name of a Kit it holds? Builds nothing. */
export function isArenaName(tuning: Pick<TuningData, 'arenas' | 'kits'>, name: string): boolean {
  if (!name.startsWith(PREFIX)) return Boolean(tuning.arenas[name]);
  try {
    return Boolean(tuning.kits[parseGeneratedName(name)!.kit]);
  } catch {
    return false;
  }
}

/** How many Generated Arenas one Tuning Data keeps built; a name dropped from the cache is built again (the same Arena). */
const KEPT_BUILDS = 8;
/** Built Generated Arenas, per Tuning Data (its base, for a copy withGeneratedArena made), most recently used last. */
const builds = new WeakMap<object, Map<string, GeneratedArena>>();
/** Each copy withGeneratedArena made, to the Tuning Data it copied: the copy shares that one's builds. */
const bases = new WeakMap<object, TuningData>();

/**
 * Generated Arena `name` (gen:<kit>:<seed>) from Tuning Data's Kit, with DEFAULT_GEN_PARAMS, built once and then reused
 * while it stays among the last few. Pure: the same name always gives the same Arena. Null for a name that is not gen:.
 */
export function generatedArena(tuning: TuningData, name: string): GeneratedArena | null {
  const parsed = parseGeneratedName(name);
  if (!parsed) return null;
  const base = bases.get(tuning) ?? tuning;
  let kept = builds.get(base);
  if (!kept) builds.set(base, (kept = new Map()));
  let built = kept.get(name);
  if (built) {
    kept.delete(name);
  } else {
    const kit = base.kits[parsed.kit];
    if (!kit) throw new Error(`Generated Arena "${name}": no Kit "${parsed.kit}" (have: ${Object.keys(base.kits).join(', ')})`);
    built = generateArena(kit, parsed.seed, DEFAULT_GEN_PARAMS, base);
    if (kept.size >= KEPT_BUILDS) kept.delete(kept.keys().next().value!);
  }
  kept.set(name, built);
  return built;
}

/**
 * The Tuning Data to play Arena `name` in: for a `gen:<kit>:<seed>` name, a copy holding the Arena generated from
 * `tuning.kits[kit]` and that seed with DEFAULT_GEN_PARAMS, plus its Layout (for drawing it from the Kit's model);
 * any other name, `tuning` unchanged. Throws on an unknown Kit or a seed that is not a whole number.
 */
export function withGeneratedArena(tuning: TuningData, name: string): { tuning: TuningData; layout?: Layout } {
  const built = generatedArena(tuning, name);
  if (!built) return { tuning };
  const { arena, layout } = built;
  const copy: TuningData = { ...tuning, arenas: { ...tuning.arenas, [arena.name]: arena } };
  bases.set(copy, bases.get(tuning) ?? tuning);
  return { tuning: copy, layout };
}
