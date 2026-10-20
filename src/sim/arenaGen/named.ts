/**
 * A Random Map built from its name alone (docs/plans/generated-arenas.md, Stage 5): `gen:<kit>:<seed>` names a Generated
 * Arena from that Kit (out of Tuning Data) and seed with DEFAULT_GEN_PARAMS, so every peer that holds the same Tuning Data
 * builds the same Arena from the Lobby's Map setting.
 */
import type { TuningData } from '../../tuning';
import { generateArena } from './generate';
import type { Layout } from './grid';
import { DEFAULT_GEN_PARAMS } from './layout';

const PREFIX = 'gen:';

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

/** May a Lobby name this Arena: one Tuning Data holds, or a well-formed gen: name of a Kit it holds? Builds nothing. */
export function isArenaName(tuning: Pick<TuningData, 'arenas' | 'kits'>, name: string): boolean {
  if (!name.startsWith(PREFIX)) return Boolean(tuning.arenas[name]);
  try {
    return Boolean(tuning.kits[parseGeneratedName(name)!.kit]);
  } catch {
    return false;
  }
}

/**
 * The Tuning Data to play Arena `name` in: for a `gen:<kit>:<seed>` name, a copy holding the Arena generated from
 * `tuning.kits[kit]` and that seed with DEFAULT_GEN_PARAMS, plus its Layout (for drawing it from the Kit's model);
 * any other name, `tuning` unchanged. Throws on an unknown Kit or a seed that is not a whole number.
 */
export function withGeneratedArena(tuning: TuningData, name: string): { tuning: TuningData; layout?: Layout } {
  const parsed = parseGeneratedName(name);
  if (!parsed) return { tuning };
  const kit = tuning.kits[parsed.kit];
  if (!kit) throw new Error(`Generated Arena "${name}": no Kit "${parsed.kit}" (have: ${Object.keys(tuning.kits).join(', ')})`);
  const { arena, layout } = generateArena(kit, parsed.seed, DEFAULT_GEN_PARAMS, tuning);
  return { tuning: { ...tuning, arenas: { ...tuning.arenas, [arena.name]: arena } }, layout };
}
