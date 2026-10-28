/**
 * A Fighter's Mods: its equipped Relics folded into one record (docs/plans/dungeon.md). Every place that reads one of
 * these numbers (a Hit, a Throwing Dagger, a Kick, a Block Impact, max HP, heals) reads the Fighter's own `mods`.
 */
import { RELIC_ADDITIONS, RELIC_EFFECTS, RELIC_MULTIPLIERS, type RelicEffect, type RelicEffects } from '../tuning/relics';
import type { FighterState } from './state';

/*
 * Rounding rule, for every place that reads a Mod: none. HP and damage are real numbers already (a Hit's damage is a product of
 * floats, and the HUD rounds only to display: `hpText`), so a Mod multiplies or adds straight through and nothing is rounded,
 * floored or ceiled on the way. The order is fixed, left to right, so every peer gets the same bits: a blade Hit is
 * `hitDamage × attacker.damage × (Heavy Blows: attacker.heavyDamage) × defender.damageTaken`, a dagger Hit
 * `dagger.damage × zone × thrower.daggerDamage × defender.damageTaken`, a Kick's Knockdown `knockdownDamage × kicker.kickDamage ×
 * defender.damageTaken`, max HP `base × (1 + maxHp)`, a Clear's heal `healOnClear × max HP` (HP never rises above max HP). Counts
 * (`daggers`) are whole because the Relic parser only lets a whole number in. Fall damage, Lava and Water are not Hits: no Mod
 * touches them. A Shove's damage is not a Knockdown's: `kickDamage` leaves it alone.
 */

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

/** A Fighter's Mods: its own `mods`, which is absent (never stored) while they are `NO_MODS`, so a Fighter without Relics hashes as it always did. */
export const modsOf = (f: Pick<FighterState, 'mods'>): Mods => f.mods ?? NO_MODS;

/** Whether `mods` change nothing. */
export const isNoMods = (mods: Mods): boolean => RELIC_EFFECTS.every((key) => mods[key] === NO_MODS[key]);

/**
 * The one seam that gives a Fighter its Mods, called at a Hall's start (`hallDuel`) and by anything that changes the Relics
 * it wields mid-Hall (an equip): `f` with `mods` stored (absent when they are `NO_MODS`), max HP `baseMaxHp × (1 + mods.maxHp)`
 * (`baseMaxHp` is the Fighter's max HP before Mods: `fighter.maxHp`, or an enemy's scaled one), HP kept but never above the new
 * max HP (a Mod that raises max HP does not heal; the caller sets HP when it wants a full one), and its Throwing Daggers moved by the change in
 * `mods.daggers` (a Fighter fresh from a Duel's start holds `dagger.count`, so it ends with `dagger.count + daggers`; one equipping mid-Hall
 * is not refilled). Pure.
 */
export function setMods(f: FighterState, mods: Mods, baseMaxHp: number): FighterState {
  const { mods: previous, ...rest } = f;
  const maxHp = baseMaxHp * (1 + mods.maxHp);
  return {
    ...rest,
    ...(isNoMods(mods) ? {} : { mods: { ...mods } }),
    maxHp,
    hp: Math.min(f.hp, maxHp),
    daggers: Math.max(0, f.daggers + mods.daggers - (previous ?? NO_MODS).daggers),
  };
}
