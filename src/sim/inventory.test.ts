import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, MAX_TEAM_SIZE } from './match';
import { addItem, commonItem, dropItem, holdInventory, inventoryMods, relicMods, startingInventory, useInventory, withStartingRelics, type Inventory, type Item } from './inventory';

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

  it('equals relicMods of the names for an all-Common inventory, bit for bit, plus the Common Arming Sword\'s own effect', () => {
    const names = tuning.relics.slice(0, 3).map((r) => r.name);
    const relics = relicMods(tuning, names);
    expect(inventoryMods(tuning, held(names.map(commonItem), [0, 1, 2]))).toEqual({ ...relics, blockImpactTaken: relics.blockImpactTaken * 0.85 });
  });

  it('scales a Rare Vital Charm: holdInventory raises max HP by 30%', () => {
    const f = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] }).duel.fighters[0]!;
    const armed = holdInventory(f, held([rare('Vital Charm')], [0]), tuning);
    expect(armed.maxHp).toBeCloseTo(tuning.fighter.maxHp * 1.3, 9);
  });
});

describe('a Weapon in hand', () => {
  const fighter = () => createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] }).duel.fighters[0]!;
  const weaponsOf = (...weapons: Item[]): Inventory => ({ ...startingInventory('Arming Sword'), weapons, weapon: 0 });
  const dagger = tuning.dagger.count;

  it('gives a Dagger its effects and a Throwing Dagger more; equipping the Arming Sword takes them away and gives Block Impact', () => {
    const f = fighter();
    expect(f.daggers).toBe(dagger);
    const inv = weaponsOf(commonItem('Dagger'), commonItem('Arming Sword'));
    const holding = holdInventory(f, inv, tuning);
    expect(holding.mods).toMatchObject({ daggers: 1, daggerDamage: 1.25, damage: 1, blockImpactTaken: 1 });
    expect(holding.daggers).toBe(dagger + 1);
    const { fighter: swapped } = useInventory(holding, { equip: { kind: 'weapon', slot: 1 } }, tuning);
    expect(swapped.weapon).toBe('Arming Sword');
    expect(swapped.mods).toMatchObject({ daggers: 0, daggerDamage: 1, blockImpactTaken: 0.85 });
    expect(swapped.daggers).toBe(dagger);
  });

  it('scales a Rare Longsword: its own effect by 1.5, then the Rarity damage 1.15', () => {
    expect(inventoryMods(tuning, weaponsOf(rare('Longsword'))).damage).toBeCloseTo(1.15 * 1.15, 12);
    expect(inventoryMods(tuning, weaponsOf({ name: 'Longsword', rarity: 'Legendary' })).damage).toBeCloseTo(1.2 * 1.3, 12);
    expect(inventoryMods(tuning, weaponsOf(commonItem('Longsword'))).damage).toBe(1.1);
  });

  it('puts the Rarity damage on damage only: a Rare Dagger\'s daggerDamage is 1.375', () => {
    const mods = inventoryMods(tuning, weaponsOf(rare('Dagger')));
    expect(mods.daggerDamage).toBeCloseTo(1 + 0.25 * 1.5, 12);
    expect(mods.damage).toBe(1.15);
    expect(mods.daggers).toBe(2);
  });

  it('folds the Relics first, then the Weapon: a Whetstone and a Longsword multiply to the same bits in the fixed order', () => {
    const inv: Inventory = { ...held([commonItem('Whetstone')], [0]), weapons: [commonItem('Longsword')], weapon: 0 };
    expect(inventoryMods(tuning, inv).damage).toBe(1.1 * 1.1 * 1);
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
