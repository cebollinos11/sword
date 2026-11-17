/**
 * Rarity as Tuning Data (`dungeon.loot.rarity`, docs/plans/loot-rarity.md): how good an item is, Common to Legendary. For now only the
 * multipliers a Relic's effects scale by (`scaleEffects`, `src/sim/mods.ts`); later Stages add the odds and the Weapon bonus.
 */
import { finiteNumber, record, TuningDataError } from './validate';

/** The Rarities, lowest first. */
export const RARITIES = ['Common', 'Rare', 'Legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

export interface RarityTuning {
  /** What a Relic's effects scale by at each Rarity: Common 1 or more, never falling as the Rarity rises. */
  readonly multipliers: Readonly<Record<Rarity, number>>;
}

/** Validate the raw Rarity tuning at `where`. Accepts its own output. */
export function parseRarity(raw: unknown, where: string): RarityTuning {
  const r = record(raw, where);
  const m = record(r.multipliers, `${where}.multipliers`);
  const multipliers = {} as Record<Rarity, number>;
  let previous = 1;
  for (const rarity of RARITIES) {
    const v = finiteNumber(m, rarity, `${where}.multipliers`);
    if (v < 1) throw new TuningDataError(`${where}.multipliers.${rarity} must be at least 1, got ${v}`);
    if (v < previous) throw new TuningDataError(`${where}.multipliers must not fall as the Rarity rises: ${rarity} ${v} is below the Rarity before it, ${previous}`);
    multipliers[rarity] = previous = v;
  }
  return { multipliers };
}
