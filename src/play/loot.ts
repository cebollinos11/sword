/**
 * Placeholder presentation of loot (docs/plans/dungeon.md, Stage 2; Stage 3 brings the art): the text the inventory screen shows for a
 * Relic. Everything here is pure and render only.
 */
import type { RelicEffect, RelicEffects } from '../tuning';

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
