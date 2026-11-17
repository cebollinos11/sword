/**
 * Rarity as Tuning Data (`dungeon.loot.rarity`, docs/plans/loot-rarity.md): how good an item is, Common to Legendary. For now the
 * multipliers a Relic's or Weapon's effects scale by (`scaleEffects`, `src/sim/mods.ts`), the damage a Weapon's Rarity adds to its own Hit, the odds a drop rolls by
 * depth and source, and the Rarity a carried Relic drops at.
 */
import { array, finiteNumber, record, TuningDataError } from './validate';

/** The Rarities, lowest first. */
export const RARITIES = ['Common', 'Rare', 'Legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

export interface RarityTuning {
  /** What a Relic's effects scale by at each Rarity: Common 1 or more, never falling as the Rarity rises. */
  readonly multipliers: Readonly<Record<Rarity, number>>;
  /** What a Weapon's Rarity multiplies its own Hit's damage by (`mods.damage`, never a Throwing Dagger's or a Kick's): Common 1 or more, never falling. */
  readonly weaponDamage: Readonly<Record<Rarity, number>>;
  /** Per tier (one row each, `delver.tiers` of them): the weights (whole, >= 0, a row not all 0) of Common, Rare and Legendary a drop rolls by. */
  readonly odds: readonly (readonly [number, number, number])[];
  /** How many tiers deeper an Elite's drops roll (whole, >= 0): its odds row is the next tier's (the last tier's at most). */
  readonly eliteTierStep: number;
  /** The lowest Rarity a Boss's drops roll to. */
  readonly bossMin: Rarity;
  /** The lowest Rarity a Treasure Hall's pedestal rolls to. */
  readonly pedestalMin: Rarity;
  /** Per tier (`delver.tiers` of them): the Rarity of the Relic an Elite carries (and drops). */
  readonly carried: readonly Rarity[];
  /** How many Rarities higher a Boss's carried Relic drops than its tier's `carried` (whole, >= 0, capped at Legendary). */
  readonly bossCarriedStep: number;
}

/** `raw` as a Rarity name at `where`. */
function rarityName(raw: unknown, where: string): Rarity {
  if (typeof raw !== 'string' || !(RARITIES as readonly string[]).includes(raw)) throw new TuningDataError(`${where} must be one of ${RARITIES.join(', ')}, got ${JSON.stringify(raw)}`);
  return raw as Rarity;
}

/** `raw` as a whole number >= 0 at `where`. */
function step(raw: unknown, where: string): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) throw new TuningDataError(`${where} must be a whole number, 0 or more, got ${JSON.stringify(raw)}`);
  return raw;
}

/** `raw` as one odds row at `where`: three whole weights >= 0, not all 0 (`runPick` draws from their whole sum). */
function oddsRow(raw: unknown, where: string): [number, number, number] {
  const row = array(raw, where);
  if (row.length !== RARITIES.length) throw new TuningDataError(`${where} must be ${RARITIES.length} weights (${RARITIES.join(', ')}), got ${JSON.stringify(raw)}`);
  const weights = row.map((w, i) => step(w, `${where}[${i}]`));
  if (weights.every((w) => w === 0)) throw new TuningDataError(`${where} must have a weight above 0, got ${JSON.stringify(raw)}`);
  return weights as [number, number, number];
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
  return {
    multipliers: risingTable(r, 'multipliers', where),
    weaponDamage: risingTable(r, 'weaponDamage', where),
    odds: array(r.odds, `${where}.odds`).map((row, i) => oddsRow(row, `${where}.odds[${i}]`)),
    eliteTierStep: step(r.eliteTierStep, `${where}.eliteTierStep`),
    bossMin: rarityName(r.bossMin, `${where}.bossMin`),
    pedestalMin: rarityName(r.pedestalMin, `${where}.pedestalMin`),
    carried: array(r.carried, `${where}.carried`).map((c, i) => rarityName(c, `${where}.carried[${i}]`)),
    bossCarriedStep: step(r.bossCarriedStep, `${where}.bossCarriedStep`),
  };
}

/** `r` raised `steps` Rarities, capped at Legendary. */
export function raiseRarity(r: Rarity, steps: number): Rarity {
  return RARITIES[Math.min(RARITIES.length - 1, RARITIES.indexOf(r) + steps)]!;
}

/** `r`, or `min` when `r` is below it. */
export function atLeast(r: Rarity, min: Rarity): Rarity {
  return RARITIES.indexOf(r) >= RARITIES.indexOf(min) ? r : min;
}

/** The Rarity of the Relic an Elite (or, with `boss`, a Boss) of `tier` (1-based) carries and drops. */
export function carriedRarity(rarity: RarityTuning, tier: number, boss: boolean): Rarity {
  return raiseRarity(rarity.carried[tier - 1]!, boss ? rarity.bossCarriedStep : 0);
}
