/**
 * The inventory screen's view model (docs/plans/dungeon.md, Stage 3): what the Fighter holds in slots, what is wielded or equipped, each Relic's
 * effects in words, the Fighter's resulting numbers, and for each action whether the Simulation would act on it now, and if not why. Pure and
 * render only (ADR 0001): the screen (`inventoryScreen.ts`) draws it, and a click becomes the Local Controller's `equip` or `drop`.
 */
import { canChangeInventory, inDuel, modsOf, type FighterState, type HallPhase, type InventoryRef } from '../sim';
import type { TuningData } from '../tuning';
import { relicIcon, weaponIcon } from './icons';
import { relicWords } from './loot';
import { daggerCapacity } from './runBuilds';

/** One action on an item: its label, whether the Simulation would act on it now, and the reason when it would not. */
export interface ActionView {
  readonly label: string;
  readonly available: boolean;
  readonly reason: string | null;
}

/** An item held. `marked`: the Weapon wielded or the Relic equipped. `equip` is null for the wielded Weapon, `drop` too (a Fighter keeps one). */
export interface ItemView {
  readonly name: string;
  /** The item's icon, an inline SVG. */
  readonly icon: string;
  /** A Relic's effects in words; empty for a Weapon. */
  readonly words: string;
  readonly marked: boolean;
  readonly equip: ActionView | null;
  readonly drop: ActionView | null;
}

/** A slot of the inventory: where it is, and what it holds (null: empty). */
export interface SlotView {
  readonly ref: InventoryRef;
  readonly item: ItemView | null;
}

export interface InventoryView {
  readonly weapons: readonly SlotView[];
  readonly relics: readonly SlotView[];
  /** How many Relics are equipped of how many may be, as words. */
  readonly relicsEquipped: string;
  /** The Fighter's numbers under its Relics. */
  readonly numbers: readonly { readonly label: string; readonly value: string }[];
  /** Why no action is available right now, or null when they are (the item's own reasons aside). */
  readonly lock: string | null;
}

/**
 * Why the Fighter may not change its inventory now, or null when it may. Mirrors the Simulation's rule (`stepMatch` acts on `equip` and
 * `drop` only in a Cleared Hall, and `canChangeInventory`: the Fighter has an inventory, still fights, lives, is Idle and on the ground);
 * the order of the reasons is the order a player would clear them in.
 */
export function inventoryLock(f: FighterState, phase: HallPhase | undefined): string | null {
  if (phase === 'Fighting') return 'Enemies remain';
  if (phase === 'Leaving') return 'Leaving the Hall';
  if (phase !== 'Cleared') return 'Only in a Run';
  if (!inDuel(f) || f.hp <= 0) return 'You have fallen';
  if (f.action.kind !== 'Idle') return 'Finish your move';
  if (f.air) return 'Land first';
  // The rule itself, should it grow a condition this list does not name yet.
  return canChangeInventory(f) ? null : 'Not now';
}

/**
 * Whether the open screen takes over the Local Controller's input (and lets go of its held keys), as the menu does: only once the Hall is
 * not being fought. In a fight (a Hall `Fighting`, or a Duel) the screen is a read-only view and the Fighter keeps its keys: the Simulation
 * runs on, and opening the screen must never leave a Fighter defenceless.
 */
export function inventoryHoldsInput(phase: HallPhase | undefined): boolean {
  return phase === 'Cleared' || phase === 'Leaving';
}

/** A factor as `×1.1` (trailing zeros dropped). */
const factor = (n: number): string => `×${Number(n.toFixed(2))}`;

const action = (label: string, reason: string | null): ActionView => ({ label, available: reason === null, reason });

/**
 * The inventory screen for `fighter` (the local Player's) in a Hall in `phase`, or null when it holds no inventory (outside a Run). Slots
 * are sized from `dungeon.inventory`; the Weapons and Relics are listed in slot order, which is the order the keys number them.
 */
export function inventoryView(
  fighter: FighterState | undefined,
  tuning: Pick<TuningData, 'relics' | 'dungeon' | 'dagger'>,
  phase: HallPhase | undefined,
): InventoryView | null {
  const inv = fighter?.inventory;
  if (!fighter || !inv) return null;
  const sizes = tuning.dungeon.inventory;
  const lock = inventoryLock(fighter, phase);
  const full = inv.equipped.length >= sizes.equippedRelics;

  const weapons: SlotView[] = Array.from({ length: sizes.weapons }, (_, slot) => {
    const ref: InventoryRef = { kind: 'weapon', slot };
    const name = inv.weapons[slot];
    if (name === undefined) return { ref, item: null };
    const wielded = slot === inv.weapon;
    return { ref, item: { name, icon: weaponIcon(name), words: '', marked: wielded, equip: wielded ? null : action('Wield', lock), drop: wielded ? null : action('Drop', lock) } };
  });
  const relics: SlotView[] = Array.from({ length: sizes.relics }, (_, slot) => {
    const ref: InventoryRef = { kind: 'relic', slot };
    const name = inv.relics[slot];
    if (name === undefined) return { ref, item: null };
    const relic = tuning.relics.find((r) => r.name === name);
    const on = inv.equipped.includes(slot);
    const equip = on ? action('Unequip', lock) : action('Equip', lock ?? (full ? `Relic slots full (${sizes.equippedRelics} / ${sizes.equippedRelics})` : null));
    return { ref, item: { name, icon: relicIcon(relic?.icon ?? ''), words: relic ? relicWords(relic.effects) : '', marked: on, equip, drop: action('Drop', lock) } };
  });

  const mods = modsOf(fighter);
  return {
    weapons,
    relics,
    relicsEquipped: `${inv.equipped.length} / ${sizes.equippedRelics} equipped`,
    numbers: [
      { label: 'Damage', value: factor(mods.damage) },
      { label: 'Damage taken', value: factor(mods.damageTaken) },
      { label: 'Max HP', value: String(Math.round(fighter.maxHp)) },
      { label: 'Daggers', value: `${fighter.daggers} / ${daggerCapacity(tuning, fighter)}` },
    ],
    lock,
  };
}

const actionKey = (a: ActionView | null): string => (a ? `${a.label}|${a.available ? 1 : 0}|${a.reason ?? ''}` : '-');

/**
 * A cheap string that differs whenever what the screen draws does, for redrawing only on change: the names, marks, actions with their
 * availability and reasons, and the numbers. Not the icons (inline SVGs, fixed by the name) nor the effects in words (fixed by the name).
 */
export function inventoryViewKey(view: InventoryView | null): string {
  if (!view) return 'none';
  const slot = (s: SlotView) => (s.item ? `${s.item.name}|${s.item.marked ? 1 : 0}|${actionKey(s.item.equip)}|${actionKey(s.item.drop)}` : '_');
  return [view.lock ?? '', view.relicsEquipped, view.numbers.map((n) => `${n.label}=${n.value}`).join(), view.weapons.map(slot).join(), view.relics.map(slot).join()].join('\n');
}
