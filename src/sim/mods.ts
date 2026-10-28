/**
 * A Fighter's Mods: its equipped Relics folded into one record (docs/plans/dungeon.md). Every place that reads one of
 * these numbers (a Hit, a Throwing Dagger, a Kick, a Block Impact, max HP, heals) reads the Fighter's own `mods`.
 */
import { RELIC_ADDITIONS, RELIC_EFFECTS, RELIC_MULTIPLIERS, type RelicEffect, type RelicEffects } from '../tuning/relics';

/** One number per Relic effect: a multiplier is 1 when unchanged, an addition 0. */
export type Mods = Readonly<Record<RelicEffect, number>>;

/** The identity: no Relics. */
export const NO_MODS: Mods = Object.freeze({
  damage: 1,
  heavyDamage: 1,
  damageTaken: 1,
  blockImpactTaken: 1,
  daggerDamage: 1,
  kickDamage: 1,
  maxHp: 0,
  daggers: 0,
  healOnKill: 0,
  healOnClear: 0,
});

/** Fold Relics into Mods: multipliers multiply, additions add; a Relic listed twice counts twice. Pure. */
export function foldMods(relics: readonly { readonly effects: RelicEffects }[]): Mods {
  const mods: Record<RelicEffect, number> = { ...NO_MODS };
  for (const relic of relics) {
    for (const key of RELIC_MULTIPLIERS) mods[key] *= relic.effects[key] ?? 1;
    for (const key of RELIC_ADDITIONS) mods[key] += relic.effects[key] ?? 0;
  }
  return mods;
}

/** Every Mods key (the Relic vocabulary), for a hash or a message validator. */
export const MODS_KEYS: readonly RelicEffect[] = RELIC_EFFECTS;
