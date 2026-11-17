/**
 * A Run's Weapon loot (docs/plans/loot-rarity.md): every Weapon of the roster can drop, as a Common Item (the Rarity draw comes in a later Stage).
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { pickItemAt } from './pickups';

const tuning = loadTuningData();

describe("a Run's Weapon loot", () => {
  it('drops every Weapon of the roster, the Flail, the Quarterstaff and the Dagger too, and each Common', () => {
    const weaponsOnly: TuningData = { ...tuning, dungeon: { ...tuning.dungeon, loot: { ...tuning.dungeon.loot, weights: { Relic: 0, Weapon: 1, Consumable: 0 } } } };
    const names = new Set<string>();
    for (let seed = 1; seed <= 4; seed++)
      for (let floor = 1; floor <= 9; floor++)
        for (let slot = 0; slot < 64; slot++) {
          const drop = pickItemAt(weaponsOnly, seed, floor, slot, []);
          expect(drop.kind).toBe('weapon');
          expect(drop.item.rarity).toBe('Common');
          names.add(drop.item.name);
        }
    const roster = Object.keys(tuning.weapons);
    expect(roster).toHaveLength(7);
    expect([...names].sort()).toEqual([...roster].sort());
    for (const w of ['Flail', 'Quarterstaff', 'Dagger']) expect(names.has(w), w).toBe(true);
  });
});
