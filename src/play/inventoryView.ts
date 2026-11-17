/**
 * The inventory screen's view model (docs/plans/dungeon.md, Stage 3): what the Fighter holds in slots, what is wielded or equipped, each Relic's
 * effects in words, a Consumable's (docs/plans/delver.md, Stage 10) in its Relic slot, the Fighter's resulting numbers, and for each action whether
 * the Simulation would act on it now, and if not why. Pure and render only (ADR 0001): the screen (`inventoryScreen.ts`) draws it, and a click becomes
 * the Local Controller's `equip`, `drop` or `use`.
 */
import { canChangeInventory, canUseConsumable, inDuel, modsOf, type DelverPhase, type FighterState, type InventoryRef, type MatchState } from '../sim';
import { floorOf } from '../sim/delver';
import { fullReveal } from '../sim/delver/reveal';
import { scaleEffects } from '../sim/mods';
import { weaponByName, type ConsumableEffect, type Rarity, type TuningData } from '../tuning';
import { relicIcon, weaponIcon } from './icons';
import { consumableWords, relicWords } from './loot';
import { daggerCapacity } from './runBuilds';

/** One action on an item: its label, whether the Simulation would act on it now, and the reason when it would not. */
export interface ActionView {
  readonly label: string;
  readonly available: boolean;
  readonly reason: string | null;
}

/**
 * An item held. `marked`: the Weapon wielded or the Relic equipped. `equip` is null for the wielded Weapon, `drop` too (a Fighter keeps one).
 * `use` is a Consumable's main control (its `equip` is null: it is never equipped); null for a Weapon or Relic.
 */
export interface ItemView {
  readonly name: string;
  readonly rarity: Rarity;
  /** The name for a Common item, else `"<name> · <Rarity>"`. */
  readonly label: string;
  /** The item's icon, an inline SVG. */
  readonly icon: string;
  /** A Relic's (or Consumable's) effects in words, scaled by its Rarity; a Weapon's `loot.effects` scaled, then its Rarity damage (counted only while wielded). */
  readonly words: string;
  readonly marked: boolean;
  readonly equip: ActionView | null;
  readonly drop: ActionView | null;
  readonly use: ActionView | null;
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
 * A Delver Run's context for the inventory screen: its phase, and for a Consumable's reasons whether the Floor is all revealed (`mapped`) and whether a
 * Team 0 Fighter has fallen (`fallen`); each absent reads as "no".
 */
export interface DelverContext {
  readonly phase: DelverPhase;
  readonly mapped?: boolean;
  readonly fallen?: boolean;
}

/** The inventory screen's context of a Delver Run (`match.delver`), or undefined outside one. Pure. */
export function delverContextOf(match: MatchState, tuning: TuningData): DelverContext | undefined {
  const run = match.delver;
  if (!run) return undefined;
  const plan = floorOf(tuning, match.duel.arena)?.plan;
  const mapped = plan !== undefined && fullReveal(plan).every((w, k) => w === (run.revealed[k] ?? 0));
  const fallen = match.duel.fighters.some((f) => f.team === 0 && f.death !== undefined);
  return { phase: run.phase, mapped, fallen };
}

/**
 * Why the Fighter may not use a Consumable of `effect` now, or null when it may. Mirrors the Simulation (`useConsumables`: while Exploring, a Fighter
 * that still fights and lives, in any Action; refused when the use would do nothing).
 */
export function consumableLock(f: FighterState, effect: ConsumableEffect, delver?: DelverContext): string | null {
  if (!delver) return 'Only in a Run';
  if (delver.phase === 'Descending') return 'Descending';
  if (!canUseConsumable(f)) return 'You have fallen';
  if (effect === 'healFull' && f.hp >= f.maxHp) return 'Already at full HP';
  if (effect === 'revealFloor' && delver.mapped) return 'Floor already mapped';
  if (effect === 'reviveFallen' && !delver.fallen) return 'Nobody has fallen';
  return null;
}

/**
 * Why the Fighter may not change its inventory now, or null when it may. Mirrors the Simulation's rule (`stepDelver` acts on `equip` and
 * `drop` while Exploring, not while Descending, and `canChangeInventory`: the Fighter has an inventory, still fights, lives, is Idle and on
 * the ground); the order of the reasons is the order a player would clear them in. `delver` is the Run's phase; absent outside a Run.
 */
export function inventoryLock(f: FighterState, delver?: DelverContext): string | null {
  if (!delver) return 'Only in a Run';
  if (delver.phase === 'Descending') return 'Descending';
  if (!inDuel(f) || f.hp <= 0) return 'You have fallen';
  if (f.action.kind !== 'Idle') return 'Finish your move';
  if (f.air) return 'Land first';
  // The rule itself, should it grow a condition this list does not name yet.
  return canChangeInventory(f) ? null : 'Not now';
}

/** A factor as `×1.1` (trailing zeros dropped). */
const factor = (n: number): string => `×${Number(n.toFixed(2))}`;

const labelOf = (name: string, rarity: Rarity): string => (rarity === 'Common' ? name : `${name} · ${rarity}`);

const action = (label: string, reason: string | null): ActionView => ({ label, available: reason === null, reason });

/**
 * The inventory screen for `fighter` (the local Player's) in a Run (`delver` its phase), or null when it holds no inventory (outside a Run). Slots
 * are sized from `dungeon.inventory`; the Weapons and Relics are listed in slot order, which is the order the keys number them.
 */
export function inventoryView(
  fighter: FighterState | undefined,
  tuning: Pick<TuningData, 'relics' | 'consumables' | 'dungeon' | 'dagger' | 'weapons'>,
  delver?: DelverContext,
): InventoryView | null {
  const inv = fighter?.inventory;
  if (!fighter || !inv) return null;
  const sizes = tuning.dungeon.inventory;
  const lock = inventoryLock(fighter, delver);
  const { multipliers, weaponDamage } = tuning.dungeon.loot.rarity;
  const full = inv.equipped.length >= sizes.equippedRelics;

  const weapons: SlotView[] = Array.from({ length: sizes.weapons }, (_, slot) => {
    const ref: InventoryRef = { kind: 'weapon', slot };
    const held = inv.weapons[slot];
    if (held === undefined) return { ref, item: null };
    const { name, rarity } = held;
    const wielded = slot === inv.weapon;
    const effects = relicWords(scaleEffects(weaponByName(tuning, name).loot?.effects ?? {}, multipliers[rarity]));
    const damage = rarity === 'Common' ? '' : `+${Math.round((weaponDamage[rarity] - 1) * 100)}% damage (${rarity})`;
    const words = [effects, damage].filter(Boolean).join(', ');
    return { ref, item: { name, rarity, label: labelOf(name, rarity), icon: weaponIcon(name), words, marked: wielded, equip: wielded ? null : action('Wield', lock), drop: wielded ? null : action('Drop', lock), use: null } };
  });
  const relics: SlotView[] = Array.from({ length: sizes.relics }, (_, slot) => {
    const ref: InventoryRef = { kind: 'relic', slot };
    const held = inv.relics[slot];
    if (held === undefined) return { ref, item: null };
    const { name, rarity } = held;
    const label = labelOf(name, rarity);
    const consumable = tuning.consumables.find((c) => c.name === name);
    if (consumable) {
      const item: ItemView = { name, rarity, label, icon: relicIcon(consumable.icon), words: consumableWords(consumable.effect), marked: false, equip: null, drop: action('Drop', lock), use: action('Use', consumableLock(fighter, consumable.effect, delver)) };
      return { ref, item };
    }
    const relic = tuning.relics.find((r) => r.name === name);
    const on = inv.equipped.includes(slot);
    const equip = on ? action('Unequip', lock) : action('Equip', lock ?? (full ? `Relic slots full (${sizes.equippedRelics} / ${sizes.equippedRelics})` : null));
    return { ref, item: { name, rarity, label, icon: relicIcon(relic?.icon ?? ''), words: relic ? relicWords(scaleEffects(relic.effects, multipliers[rarity])) : '', marked: on, equip, drop: action('Drop', lock), use: null } };
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
 * A cheap string that differs whenever what the screen draws does, for redrawing only on change: the names, Rarities, marks, actions with their
 * availability and reasons, and the numbers. Not the icons (inline SVGs, fixed by the name) nor the effects in words (fixed by the name).
 */
export function inventoryViewKey(view: InventoryView | null): string {
  if (!view) return 'none';
  const slot = (s: SlotView) => (s.item ? `${s.item.name}|${s.item.rarity}|${s.item.marked ? 1 : 0}|${actionKey(s.item.equip)}|${actionKey(s.item.drop)}|${actionKey(s.item.use)}` : '_');
  return [view.lock ?? '', view.relicsEquipped, view.numbers.map((n) => `${n.label}=${n.value}`).join(), view.weapons.map(slot).join(), view.relics.map(slot).join()].join('\n');
}
