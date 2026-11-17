/**
 * The Dungeon as Tuning Data (data/dungeon.json, hashed): what a Run (docs/plans/delver.md) keeps across its Floors: how long the party
 * stands on the Stairs and fades to the next Floor, how fires heal and revive, the Inventory's sizes, and the loot's weights, counts and Rarity. The Floors themselves are generated (`data/delver.json`, `src/sim/delver/`).
 */
import { parseRarity, type RarityTuning } from './rarity';
import { nonNegativeNumber, positiveNumber, record, TuningDataError } from './validate';

/** A Weapon or AI Style written `"random"` is picked by a pure hash of a seed and a slot. */
export const RANDOM_PICK = 'random';

/** The most items a wiped Warband drops, or a Treasure Hall puts on pedestals, for one Player. */
export const MAX_LOOT_SPOTS = 4;

/** What a Run's loot is (docs/plans/delver.md, Stage 4). */
export interface DungeonLoot {
  /** Relative weights of what an item is: a Relic (the usual), a Weapon or a Consumable (0 when the file leaves it out). Not all 0. */
  readonly weights: { readonly Relic: number; readonly Weapon: number; readonly Consumable: number };
  /** Items a wiped Warband of that rank drops for each Player (0 to MAX_LOOT_SPOTS). An elite Warband's carried Relics come on top of its count. */
  readonly drops: { readonly Fight: number; readonly Elite: number; readonly Boss: number };
  /** Pedestals each Player has in a Treasure Hall (1 to MAX_LOOT_SPOTS): they take one of them. */
  readonly pedestals: number;
  /** How good an item is (Common, Rare, Legendary): what its effects scale by. */
  readonly rarity: RarityTuning;
}

export interface DungeonTuning {
  /** Seconds every counted Fighter must stand in a Floor's Stairs zone to take them. */
  readonly stairsSeconds: number;
  /** Seconds of fade from taking the Stairs to the next Floor's start. */
  readonly fadeSeconds: number;
  /** A fallen Player's Fighter a fire (or the Stairs) brings back comes back with this share of its max HP. */
  readonly revive: number;
  /** A Player's Fighter at a fire heals this share of its max HP (once a fire). */
  readonly restHeal: number;
  /** Inventory sizes: Weapons held, Relics held and how many of those are equipped. */
  readonly inventory: { readonly weapons: number; readonly relics: number; readonly equippedRelics: number };
  /** What wiped Warbands drop and Treasure Halls offer. */
  readonly loot: DungeonLoot;
}

function share(obj: Record<string, unknown>, key: string, where: string, min: 'zero' | 'positive'): number {
  const v = min === 'zero' ? nonNegativeNumber(obj, key, where) : positiveNumber(obj, key, where);
  if (v > 1) throw new TuningDataError(`${where}.${key} must be at most 1, got ${v}`);
  return v;
}

function wholeNumber(obj: Record<string, unknown>, key: string, where: string, lo: number, hi: number): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new TuningDataError(`${where}.${key} must be a whole number from ${lo} to ${hi}, got ${JSON.stringify(v)}`);
  return v;
}

/** Validate the raw Dungeon. Accepts its own output. */
export function parseDungeon(raw: unknown): DungeonTuning {
  const d = record(raw, 'dungeon');
  if (d.leftOutWeapons !== undefined) throw new TuningDataError('dungeon.leftOutWeapons is retired: every Weapon is loot (docs/plans/loot-rarity.md)');
  const inv = record(d.inventory, 'dungeon.inventory');
  const relics = wholeNumber(inv, 'relics', 'dungeon.inventory', 0, 99);
  const loot = record(d.loot, 'dungeon.loot');
  const lootWeights = record(loot.weights, 'dungeon.loot.weights');
  const lootDrops = record(loot.drops, 'dungeon.loot.drops');
  const weights = {
    Relic: nonNegativeNumber(lootWeights, 'Relic', 'dungeon.loot.weights'),
    Weapon: nonNegativeNumber(lootWeights, 'Weapon', 'dungeon.loot.weights'),
    Consumable: lootWeights.Consumable === undefined ? 0 : nonNegativeNumber(lootWeights, 'Consumable', 'dungeon.loot.weights'),
  };
  if (weights.Relic + weights.Weapon + weights.Consumable <= 0) throw new TuningDataError('dungeon.loot.weights must give Relic, Weapon or Consumable a weight above 0');

  return {
    stairsSeconds: positiveNumber(d, 'stairsSeconds', 'dungeon'),
    fadeSeconds: nonNegativeNumber(d, 'fadeSeconds', 'dungeon'),
    revive: share(d, 'revive', 'dungeon', 'positive'),
    restHeal: share(d, 'restHeal', 'dungeon', 'zero'),
    inventory: {
      weapons: wholeNumber(inv, 'weapons', 'dungeon.inventory', 1, 99),
      relics,
      equippedRelics: wholeNumber(inv, 'equippedRelics', 'dungeon.inventory', 0, relics),
    },
    loot: {
      weights,
      drops: {
        Fight: wholeNumber(lootDrops, 'Fight', 'dungeon.loot.drops', 0, MAX_LOOT_SPOTS),
        Elite: wholeNumber(lootDrops, 'Elite', 'dungeon.loot.drops', 0, MAX_LOOT_SPOTS),
        Boss: wholeNumber(lootDrops, 'Boss', 'dungeon.loot.drops', 0, MAX_LOOT_SPOTS),
      },
      pedestals: wholeNumber(loot, 'pedestals', 'dungeon.loot', 1, MAX_LOOT_SPOTS),
      rarity: parseRarity(loot.rarity, 'dungeon.loot.rarity'),
    },
  };
}
