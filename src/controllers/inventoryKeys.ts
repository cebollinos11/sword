/**
 * The Local Controller's inventory keys (docs/plans/dungeon.md, "Loot and the inventory"), as a pure function. Number keys equip (1 to 3 the
 * Weapons in slots 0 to 2, 4 to 9 the Relics in slots 0 to 5: `dungeon.inventory` sizes 3 and 6), Shift and a number key only selects the item
 * (a Weapon equipped is the wielded one, which cannot be dropped, so a carried Weapon is dropped by selecting it this way), X drops the item last
 * selected, I shows the inventory list (render only, `src/game.ts`). None clashes with the movement, combat or Ctrl keys, and the Escape of the menu.
 * The Simulation refuses `equip` and `drop` while an enemy lives, so a press then does nothing (and the selection stays).
 */
import type { InventoryRef } from '../sim';

/** The keys that equip (or, with Shift, select), by `KeyboardEvent.code`. */
export const EQUIP_KEYS: Readonly<Record<string, InventoryRef>> = Object.freeze({
  Digit1: { kind: 'weapon', slot: 0 },
  Digit2: { kind: 'weapon', slot: 1 },
  Digit3: { kind: 'weapon', slot: 2 },
  Digit4: { kind: 'relic', slot: 0 },
  Digit5: { kind: 'relic', slot: 1 },
  Digit6: { kind: 'relic', slot: 2 },
  Digit7: { kind: 'relic', slot: 3 },
  Digit8: { kind: 'relic', slot: 4 },
  Digit9: { kind: 'relic', slot: 5 },
});

/** The key that drops the selected item. */
export const DROP_KEY = 'KeyX';

/** The key that shows or hides the inventory list. */
export const INVENTORY_LIST_KEY = 'KeyI';

/** What a key press asks of the inventory: the Intent field it fills and the item selected afterwards (null: none). */
export interface InventoryKey {
  readonly equip?: InventoryRef;
  readonly drop?: InventoryRef;
  readonly selected: InventoryRef | null;
}

/**
 * What pressing `code` does with `selected` (the item a number key picked last, or null): a number key equips its slot and selects it, or with
 * `shift` only selects it; the drop key drops the selected one, and with none selected does nothing; the selection ends with the drop (later slots
 * close up). Null for any other key.
 */
export function inventoryKey(code: string, selected: InventoryRef | null, shift = false): InventoryKey | null {
  const ref = EQUIP_KEYS[code];
  if (ref) return shift ? { selected: ref } : { equip: ref, selected: ref };
  if (code === DROP_KEY) return selected ? { drop: selected, selected: null } : { selected };
  return null;
}
