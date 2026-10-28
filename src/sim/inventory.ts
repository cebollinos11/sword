/**
 * A Player's inventory in a Run (docs/plans/dungeon.md): the Weapons and Relics its Fighter holds, equipped or carried. It
 * changes only through the Intent's `equip` and `drop`, and only while no enemy in the Hall is alive (`stepMatch` asks
 * `canChangeInventory`), so a Weapon swap is never mid-Action. Everything here is pure.
 */
import type { TuningData } from '../tuning';
import { inDuel } from './duel';
import type { InventoryRef } from './intent';
import { foldMods, setMods, type Mods } from './mods';
import { bladeAndLeg, fighterPose } from './pose';
import type { FighterState } from './state';

/**
 * What a Fighter holds. `weapons` and `relics` are Tuning Data names, in the order they were picked up; `weapon` indexes the
 * Weapon it wields (always a valid index: it keeps at least that one) and `equipped` the Relics whose effects it has (ascending,
 * distinct, so the fold of Mods has one order on every peer). Sizes come from `dungeon.inventory`.
 */
export interface Inventory {
  readonly weapons: readonly string[];
  readonly relics: readonly string[];
  readonly weapon: number;
  readonly equipped: readonly number[];
}

/** The inventory of a Player's Fighter at the Run's start: the Weapon the Lineup chose, wielded, and nothing else. */
export const startingInventory = (weapon: string): Inventory => ({ weapons: [weapon], relics: [], weapon: 0, equipped: [] });

/** The name of the Weapon the inventory has wielded. */
export const wieldedWeapon = (inv: Inventory): string => inv.weapons[inv.weapon]!;

/** The Mods of an inventory: its equipped Relics folded (`foldMods`) in `equipped` order. Throws on a Relic Tuning Data lacks. */
export function inventoryMods(tuning: Pick<TuningData, 'relics'>, inv: Inventory): Mods {
  return foldMods(
    inv.equipped.map((slot) => {
      const name = inv.relics[slot]!;
      const relic = tuning.relics.find((r) => r.name === name);
      if (!relic) throw new RangeError(`Unknown Relic "${name}" (have: ${tuning.relics.map((r) => r.name).join(', ')})`);
      return relic;
    }),
  );
}

/** A slot of `list`: a whole number inside it. */
const inside = (slot: number, list: readonly unknown[]): boolean => Number.isInteger(slot) && slot >= 0 && slot < list.length;

/**
 * The inventory after equipping `ref`, or null when it is refused. A Weapon in a slot not wielded becomes the wielded one. A Relic
 * not equipped is equipped if fewer than `sizes.equippedRelics` are; one already equipped is unequipped, which is how a Relic comes off.
 */
export function equipItem(inv: Inventory, ref: InventoryRef, sizes: TuningData['dungeon']['inventory']): Inventory | null {
  if (ref.kind === 'weapon') return inside(ref.slot, inv.weapons) && ref.slot !== inv.weapon ? { ...inv, weapon: ref.slot } : null;
  if (!inside(ref.slot, inv.relics)) return null;
  if (inv.equipped.includes(ref.slot)) return { ...inv, equipped: inv.equipped.filter((s) => s !== ref.slot) };
  if (inv.equipped.length >= sizes.equippedRelics) return null;
  return { ...inv, equipped: [...inv.equipped, ref.slot].sort((a, b) => a - b) };
}

/**
 * The inventory after dropping `ref`, and the item's name, or null when it is refused: the Weapon wielded is never dropped (a Fighter
 * keeps one). Dropping a Relic equipped unequips it. Later slots close up, and the wielded Weapon and the equipped Relics keep their items.
 */
export function dropItem(inv: Inventory, ref: InventoryRef): { readonly inventory: Inventory; readonly item: string } | null {
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
 * The Fighter holding `inventory`: its wielded Weapon (the pose follows it), and its Mods and max HP from the equipped Relics (`setMods`,
 * the seam: HP kept but never above the new max HP, Throwing Daggers moved by the change in `mods.daggers`). A Fighter whose Weapon
 * and Relics are the ones it had comes back as it was, inventory aside.
 */
export function holdInventory(f: FighterState, inventory: Inventory, tuning: TuningData): FighterState {
  const weapon = wieldedWeapon(inventory);
  const armed = setMods({ ...f, inventory, weapon }, inventoryMods(tuning, inventory), tuning.fighter.maxHp);
  return weapon === f.weapon ? armed : { ...armed, ...bladeAndLeg(fighterPose(armed, tuning)) };
}

/**
 * Whether the Fighter may change its inventory this Tick (the Hall being Cleared is the caller's to say): it has an inventory, still fights,
 * and is Idle on the ground, never mid-Action.
 */
export const canChangeInventory = (f: FighterState): boolean => f.inventory !== undefined && inDuel(f) && f.hp > 0 && f.action.kind === 'Idle' && !f.air;

/** An item that left a Fighter's inventory by a drop. */
export interface Dropped {
  readonly kind: InventoryRef['kind'];
  readonly item: string;
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
    const next = equipItem(fighter.inventory!, intent.equip, tuning.dungeon.inventory);
    if (next) fighter = holdInventory(fighter, next, tuning);
  }
  let dropped: Dropped | null = null;
  if (intent.drop) {
    const left = dropItem(fighter.inventory!, intent.drop);
    if (left) {
      fighter = holdInventory(fighter, left.inventory, tuning);
      dropped = { kind: intent.drop.kind, item: left.item };
    }
  }
  return { fighter, dropped };
}
