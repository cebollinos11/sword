import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, MAX_TEAM_SIZE } from './match';
import { addItem, commonItem, dropItem, holdInventory, inventoryMods, relicMods, startingInventory, withStartingRelics, type Inventory, type Item } from './inventory';

const tuning = loadTuningData();
const sizes = tuning.dungeon.inventory;
const rare = (name: string): Item => ({ name, rarity: 'Rare' });
const held = (relics: readonly Item[], equipped: readonly number[]): Inventory => ({ ...startingInventory('Arming Sword'), relics, equipped });
const POTION = tuning.consumables[0]!.name;

describe('inventoryMods', () => {
  it('stacks two Whetstones of different Rarity: Common 1.1 times Rare 1.15', () => {
    const mods = inventoryMods(tuning, held([commonItem('Whetstone'), rare('Whetstone')], [0, 1]));
    expect(mods.damage).toBeCloseTo(1.1 * 1.15, 12);
  });

  it('equals relicMods of the names for an all-Common inventory, bit for bit', () => {
    const names = tuning.relics.slice(0, 3).map((r) => r.name);
    expect(inventoryMods(tuning, held(names.map(commonItem), [0, 1, 2]))).toEqual(relicMods(tuning, names));
  });

  it('scales a Rare Vital Charm: holdInventory raises max HP by 30%', () => {
    const f = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] }).duel.fighters[0]!;
    const armed = holdInventory(f, held([rare('Vital Charm')], [0]), tuning);
    expect(armed.maxHp).toBeCloseTo(tuning.fighter.maxHp * 1.3, 9);
  });
});

describe('withStartingRelics', () => {
  it('holds the names as Common Items', () => {
    expect(withStartingRelics(startingInventory('Halberd'), ['Whetstone'], tuning).relics).toEqual([commonItem('Whetstone')]);
  });
});

describe('addItem', () => {
  it('refuses a Rare Consumable and accepts a Common one', () => {
    const inv = startingInventory('Arming Sword');
    expect(addItem(inv, { kind: 'consumable', item: rare(POTION) }, sizes)).toBeNull();
    expect(addItem(inv, { kind: 'consumable', item: commonItem(POTION) }, sizes)!.relics).toEqual([commonItem(POTION)]);
  });

  it('takes a Rare Relic as it is', () => {
    expect(addItem(startingInventory('Arming Sword'), { kind: 'relic', item: rare('Whetstone') }, sizes)!.relics).toEqual([rare('Whetstone')]);
  });
});

describe('dropItem', () => {
  it('returns the Item with its Rarity', () => {
    const inv: Inventory = { ...held([commonItem('Whetstone'), rare('Iron Plate')], [0]), weapons: [commonItem('Arming Sword'), rare('Halberd')], weapon: 0 };
    expect(dropItem(inv, { kind: 'relic', slot: 1 })!.item).toEqual(rare('Iron Plate'));
    expect(dropItem(inv, { kind: 'weapon', slot: 1 })!.item).toEqual(rare('Halberd'));
  });
});
