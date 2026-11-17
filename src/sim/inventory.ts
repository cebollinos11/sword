/**
 * A Player's inventory in a Run (docs/plans/dungeon.md): the Items (Weapons and Relics) its Fighter holds, equipped or carried, and the Consumables it
 * carries in Relic slots (docs/plans/delver.md, Stage 10; never equipped, used once by the Intent's `use`). It changes only through the Intent's
 * `equip`, `drop` and `use`, and `equip` and `drop` in a fight too, but only while its Fighter is Idle on the ground (`stepMatch` asks
 * `canChangeInventory`), so a Weapon swap is never mid-Action. Everything here is pure.
 */
import { weaponByName, type Rarity, type TuningData } from '../tuning';
import { inDuel } from './duel';
import type { InventoryRef } from './intent';
import { foldMods, scaleEffects, setMods, type Mods } from './mods';
import { withPose } from './pose';
import type { FighterState } from './state';

/** One thing held or lying on a Floor (docs/plans/loot-rarity.md): the Tuning Data name of a Weapon, Relic or Consumable, and its Rarity. */
export interface Item {
  readonly name: string;
  readonly rarity: Rarity;
}

/** The Common Item named `name`: every drop is Common until Rarity is rolled. */
export const commonItem = (name: string): Item => ({ name, rarity: 'Common' });

/**
 * What a Fighter holds. `weapons` and `relics` are Items (`relics` holds Consumables too: they take Relic slots, always Common), in the order they were picked up; `weapon` indexes the
 * Weapon it wields (always a valid index: it keeps at least that one) and `equipped` the Relics whose effects it has (ascending,
 * distinct, so the fold of Mods has one order on every peer). Sizes come from `dungeon.inventory`.
 */
export interface Inventory {
  readonly weapons: readonly Item[];
  readonly relics: readonly Item[];
  readonly weapon: number;
  readonly equipped: readonly number[];
}

/** The inventory of a Player's Fighter at the Run's start: the Weapon the Lineup chose, wielded, and nothing else. */
export const startingInventory = (weapon: string): Inventory => ({ weapons: [commonItem(weapon)], relics: [], weapon: 0, equipped: [] });

/**
 * `inv` holding `relics` (Relics or Consumables, by name, held Common), the first `equippedRelics` Relics of them equipped. Throws on a name Tuning Data lacks or more than
 * `dungeon.inventory.relics`.
 */
export function withStartingRelics(inv: Inventory, relics: readonly string[], tuning: Pick<TuningData, 'relics' | 'consumables' | 'dungeon'>): Inventory {
  const sizes = tuning.dungeon.inventory;
  if (relics.length > sizes.relics) throw new RangeError(`A Fighter carries at most ${sizes.relics} Relics, got ${relics.length}`);
  for (const name of relics)
    if (!tuning.relics.some((r) => r.name === name) && !isConsumable(tuning, name))
      throw new RangeError(`Unknown Relic "${name}" (have: ${[...tuning.relics, ...tuning.consumables].map((r) => r.name).join(', ')})`);
  const equipped = relics.flatMap((name, k) => (isConsumable(tuning, name) ? [] : [k])).slice(0, sizes.equippedRelics);
  return { ...inv, relics: relics.map(commonItem), equipped };
}

/** The Consumable of Tuning Data named `name`, or undefined when it names none (a Relic, say). */
export const consumableOf = (tuning: Pick<TuningData, 'consumables'>, name: string): TuningData['consumables'][number] | undefined => tuning.consumables.find((c) => c.name === name);

/** Whether `name` is a Consumable's (which a Relic slot may hold, but never equips). */
export const isConsumable = (tuning: Pick<TuningData, 'consumables'>, name: string): boolean => consumableOf(tuning, name) !== undefined;

/** What kind of item a Relic slot's name is, as it leaves the slot: a Consumable's or a Relic's. */
export const slotKind = (tuning: Pick<TuningData, 'consumables'>, name: string): Dropped['kind'] => (isConsumable(tuning, name) ? 'consumable' : 'relic');

/** The name of the Weapon the inventory has wielded. */
export const wieldedWeapon = (inv: Inventory): string => inv.weapons[inv.weapon]!.name;

/** The Relic of Tuning Data named `name`. Throws on a Relic Tuning Data lacks. */
export function relicOf(tuning: Pick<TuningData, 'relics'>, name: string): TuningData['relics'][number] {
  const relic = tuning.relics.find((r) => r.name === name);
  if (!relic) throw new RangeError(`Unknown Relic "${name}" (have: ${tuning.relics.map((r) => r.name).join(', ')})`);
  return relic;
}

/** The Mods of the Relics named, folded (`foldMods`) in order, unscaled (an enemy's Relics are Common). Throws on a Relic Tuning Data lacks. */
export function relicMods(tuning: Pick<TuningData, 'relics'>, names: readonly string[]): Mods {
  return foldMods(names.map((name) => relicOf(tuning, name)));
}

/**
 * The Mods of an inventory, folded (`foldMods`) in one fixed order so every peer multiplies the same way: the equipped Relics in `equipped` order, each scaled by
 * its Rarity (`scaleEffects`); then the wielded Weapon's `loot.effects`, scaled by its Rarity; then the Weapon's Rarity damage (`weaponDamage`, on `damage` only, so
 * a Common Weapon adds exactly 1). Throws on a Relic or Weapon Tuning Data lacks.
 */
export function inventoryMods(tuning: Pick<TuningData, 'relics' | 'dungeon' | 'weapons'>, inv: Inventory): Mods {
  const { multipliers, weaponDamage } = tuning.dungeon.loot.rarity;
  const weapon = inv.weapons[inv.weapon]!;
  return foldMods([
    ...inv.equipped.map((slot) => {
      const item = inv.relics[slot]!;
      return { effects: scaleEffects(relicOf(tuning, item.name).effects, multipliers[item.rarity]) };
    }),
    { effects: scaleEffects(weaponByName(tuning, weapon.name).loot?.effects ?? {}, multipliers[weapon.rarity]) },
    { effects: { damage: weaponDamage[weapon.rarity] } },
  ]);
}

/** A slot of `list`: a whole number inside it. */
const inside = (slot: number, list: readonly unknown[]): boolean => Number.isInteger(slot) && slot >= 0 && slot < list.length;

/**
 * The inventory after equipping `ref`, or null when it is refused. A Weapon in a slot not wielded becomes the wielded one. A Relic
 * not equipped is equipped if fewer than `sizes.equippedRelics` are; one already equipped is unequipped, which is how a Relic comes off.
 * A Consumable (`consumable` says which names are) is never equipped.
 */
export function equipItem(inv: Inventory, ref: InventoryRef, sizes: TuningData['dungeon']['inventory'], consumable: (name: string) => boolean = () => false): Inventory | null {
  if (ref.kind === 'weapon') return inside(ref.slot, inv.weapons) && ref.slot !== inv.weapon ? { ...inv, weapon: ref.slot } : null;
  if (!inside(ref.slot, inv.relics) || consumable(inv.relics[ref.slot]!.name)) return null;
  if (inv.equipped.includes(ref.slot)) return { ...inv, equipped: inv.equipped.filter((s) => s !== ref.slot) };
  if (inv.equipped.length >= sizes.equippedRelics) return null;
  return { ...inv, equipped: [...inv.equipped, ref.slot].sort((a, b) => a - b) };
}

/**
 * The inventory after dropping `ref`, and the Item, or null when it is refused: the Weapon wielded is never dropped (a Fighter
 * keeps one). Dropping a Relic equipped unequips it. Later slots close up, and the wielded Weapon and the equipped Relics keep their items.
 */
export function dropItem(inv: Inventory, ref: InventoryRef): { readonly inventory: Inventory; readonly item: Item } | null {
  if (ref.kind === 'weapon') {
    if (!inside(ref.slot, inv.weapons) || ref.slot === inv.weapon) return null;
    return { item: inv.weapons[ref.slot]!, inventory: { ...inv, weapons: inv.weapons.filter((_, s) => s !== ref.slot), weapon: inv.weapon - (ref.slot < inv.weapon ? 1 : 0) } };
  }
  if (!inside(ref.slot, inv.relics)) return null;
  return {
    item: inv.relics[ref.slot]!,
    inventory: { ...inv, relics: inv.relics.filter((_, s) => s !== ref.slot), equipped: inv.equipped.flatMap((s) => (s === ref.slot ? [] : [s - (s > ref.slot ? 1 : 0)])) },
  };
}

/**
 * The Fighter holding `inventory`: its wielded Weapon (the pose follows it), and its Mods and max HP from the equipped Relics and the Weapon in hand (`inventoryMods`, `setMods`,
 * the seam: HP kept but never above the new max HP, Throwing Daggers moved by the change in `mods.daggers`). Every change of Weapon, a drop, a use and a Floor's start come here, so the Mods follow the Weapon in hand. A Fighter whose Weapon
 * and Relics are the ones it had comes back as it was, inventory aside.
 */
export function holdInventory(f: FighterState, inventory: Inventory, tuning: TuningData): FighterState {
  const weapon = wieldedWeapon(inventory);
  const armed = setMods({ ...f, inventory, weapon }, inventoryMods(tuning, inventory), tuning.fighter.maxHp);
  return weapon === f.weapon ? armed : withPose(armed, tuning);
}

/**
 * The inventory after a Consumable in `ref`'s slot leaves it by being used, and the Item, or null when the slot holds no Consumable. Later slots close
 * up, and the equipped Relics keep their items (as a drop leaves them).
 */
export function spendConsumable(inv: Inventory, ref: InventoryRef, tuning: Pick<TuningData, 'consumables'>): { readonly inventory: Inventory; readonly item: Item } | null {
  if (ref.kind !== 'relic' || !inside(ref.slot, inv.relics) || !isConsumable(tuning, inv.relics[ref.slot]!.name)) return null;
  return dropItem(inv, ref);
}

/** Whether the Fighter may use a Consumable this Tick (the Run's phase is the caller's to say): it has an inventory, still fights and lives. No Action, the air included, stops it. */
export const canUseConsumable = (f: FighterState): boolean => f.inventory !== undefined && inDuel(f) && f.hp > 0;

/**
 * Whether the Fighter may change its inventory this Tick (the Run's phase is the caller's to say): it has an inventory, still fights,
 * and is Idle on the ground, never mid-Action.
 */
export const canChangeInventory = (f: FighterState): boolean => f.inventory !== undefined && inDuel(f) && f.hp > 0 && f.action.kind === 'Idle' && !f.air;

/** An item that left a Fighter's inventory by a drop (or lies as a pickup): a Weapon, a Relic or a Consumable (which takes a Relic slot). */
export interface Dropped {
  readonly kind: InventoryRef['kind'] | 'consumable';
  readonly item: Item;
}

/**
 * The inventory after taking `item` up (a pickup), or null when it is full or it is a Consumable that is not Common (Consumables have no Rarity): `sizes.weapons` Weapons held (the wielded one counts) or
 * `sizes.relics` Relics and Consumables (they share the Relic slots), equipped or carried. A new item goes last, so no slot moves; nothing is equipped or wielded by being taken, so
 * the Fighter's Mods and Weapon stay as they were. Pure.
 */
export function addItem(inv: Inventory, item: Dropped, sizes: TuningData['dungeon']['inventory']): Inventory | null {
  if (item.kind === 'consumable' && item.item.rarity !== 'Common') return null;
  if (item.kind === 'weapon') return inv.weapons.length < sizes.weapons ? { ...inv, weapons: [...inv.weapons, item.item] } : null;
  return inv.relics.length < sizes.relics ? { ...inv, relics: [...inv.relics, item.item] } : null;
}

/**
 * Act on a Fighter's Intent `equip` then `drop`: the Fighter after them (the same Fighter when both are absent or refused) and what
 * it dropped, if anything. Refused when `canChangeInventory` says no, or the item or slot is not there.
 */
export function useInventory(
  f: FighterState,
  intent: { readonly equip?: InventoryRef; readonly drop?: InventoryRef },
  tuning: TuningData,
): { readonly fighter: FighterState; readonly dropped: Dropped | null } {
  if ((!intent.equip && !intent.drop) || !canChangeInventory(f)) return { fighter: f, dropped: null };
  let fighter = f;
  if (intent.equip) {
    const next = equipItem(fighter.inventory!, intent.equip, tuning.dungeon.inventory, (name) => isConsumable(tuning, name));
    if (next) fighter = holdInventory(fighter, next, tuning);
  }
  let dropped: Dropped | null = null;
  if (intent.drop) {
    const left = dropItem(fighter.inventory!, intent.drop);
    if (left) {
      fighter = holdInventory(fighter, left.inventory, tuning);
      dropped = { kind: intent.drop.kind === 'weapon' ? 'weapon' : slotKind(tuning, left.item.name), item: left.item };
    }
  }
  return { fighter, dropped };
}
