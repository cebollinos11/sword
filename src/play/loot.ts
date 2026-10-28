/**
 * Placeholder presentation of loot (docs/plans/dungeon.md, Stage 2; Stage 3 brings the art): the text a pickup's label and the inventory screen
 * show. Everything here is pure and render only: it reads the Match, never changes it.
 */
import { pickupVisibleTo, type MatchState, type Pickup, type PickupAt } from '../sim';
import type { RelicEffect, RelicEffects } from '../tuning';

/** A pickup's floating label: the item's name. */
export const pickupLabel = (p: Pick<Pickup, 'item'>): string => p.item;

/** The pickups the Player Fighter `fighter` sees, as the Simulation lets it take them (`pickupVisibleTo`): its own and shared ones, not taken. */
export const visiblePickups = (match: MatchState, fighter: number): Pickup[] => (match.run?.pickups ?? []).filter((p) => pickupVisibleTo(p, fighter));

const percent = (factor: number): string => `${Math.round(Math.abs(factor - 1) * 100)}%`;
const signed = (factor: number): string => `${factor >= 1 ? '+' : '-'}${percent(factor)}`;

/** How each effect reads, from its number. */
const WORDS: Readonly<Record<RelicEffect, (n: number) => string>> = {
  damage: (n) => `${signed(n)} damage`,
  heavyDamage: (n) => `${signed(n)} heavy blow damage`,
  damageTaken: (n) => `${signed(n)} damage taken`,
  blockImpactTaken: (n) => `${signed(n)} block impact taken`,
  daggerDamage: (n) => `${signed(n)} dagger damage`,
  kickDamage: (n) => `${signed(n)} kick damage`,
  maxHp: (n) => `+${Math.round(n * 100)}% max HP`,
  daggers: (n) => `+${n} dagger${n === 1 ? '' : 's'}`,
  healOnKill: (n) => `heal ${n} HP on a kill`,
  healOnClear: (n) => `heal ${Math.round(n * 100)}% max HP on clearing a Hall`,
};

/** A Relic's effects in words, in the order of the vocabulary, joined by commas. */
export function relicWords(effects: RelicEffects): string {
  return (Object.keys(WORDS) as RelicEffect[])
    .filter((k) => effects[k] !== undefined)
    .map((k) => WORDS[k](effects[k]!))
    .join(', ');
}

/** One pickup's floating label: where (a little over its ground) and what it says. */
export interface PickupMark {
  readonly id: number;
  readonly at: PickupAt;
  readonly text: string;
  readonly kind: Pickup['kind'];
}

/** How far over the ground (m) a pickup's label floats. */
export const PICKUP_LABEL_HEIGHT = 1.0;

/** The labels over the pickups `fighter` sees, in id order. */
export const pickupMarks = (match: MatchState, fighter: number): PickupMark[] =>
  visiblePickups(match, fighter).map((p) => ({ id: p.id, at: { x: p.at.x, y: p.at.y + PICKUP_LABEL_HEIGHT, z: p.at.z }, text: pickupLabel(p), kind: p.kind }));
