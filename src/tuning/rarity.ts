/**
 * Rarity as Tuning Data (`dungeon.loot.rarity`, docs/plans/loot-rarity.md): how good an item is, Common to Legendary. For now the
 * multipliers a Relic's or Weapon's effects scale by (`scaleEffects`, `src/sim/mods.ts`) and the damage a Weapon's Rarity adds to its own Hit; later Stages add the odds.
 */
import { finiteNumber, record, TuningDataError } from './validate';

/** The Rarities, lowest first. */
export const RARITIES = ['Common', 'Rare', 'Legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

export interface RarityTuning {
  /** What a Relic's effects scale by at each Rarity: Common 1 or more, never falling as the Rarity rises. */
  readonly multipliers: Readonly<Record<Rarity, number>>;
  /** What a Weapon's Rarity multiplies its own Hit's damage by (`mods.damage`, never a Throwing Dagger's or a Kick's): Common 1 or more, never falling. */
  readonly weaponDamage: Readonly<Record<Rarity, number>>;
}

/** A table of one number per Rarity at `where`.`key`: every Rarity, at least 1, never falling as the Rarity rises. */
function risingTable(r: Record<string, unknown>, key: string, where: string): Readonly<Record<Rarity, number>> {
  const m = record(r[key], `${where}.${key}`);
  const table = {} as Record<Rarity, number>;
  let previous = 1;
  for (const rarity of RARITIES) {
    const v = finiteNumber(m, rarity, `${where}.${key}`);
    if (v < 1) throw new TuningDataError(`${where}.${key}.${rarity} must be at least 1, got ${v}`);
    if (v < previous) throw new TuningDataError(`${where}.${key} must not fall as the Rarity rises: ${rarity} ${v} is below the Rarity before it, ${previous}`);
    table[rarity] = previous = v;
  }
  return table;
}

/** Validate the raw Rarity tuning at `where`. Accepts its own output. */
export function parseRarity(raw: unknown, where: string): RarityTuning {
  const r = record(raw, where);
  return { multipliers: risingTable(r, 'multipliers', where), weaponDamage: risingTable(r, 'weaponDamage', where) };
}
