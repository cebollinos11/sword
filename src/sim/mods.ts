/**
 * A Fighter's Mods: its equipped Relics, and a Player's wielded Weapon's effects (docs/plans/loot-rarity.md), folded into one record (docs/plans/dungeon.md). Every place that reads one of
 * these numbers (a Hit, a Throwing Dagger, a Kick, a Block Impact, max HP, heals) reads the Fighter's own `mods`.
 */
import { sizedTuning, type TuningData } from '../tuning';
import { PACE_MODS, RELIC_ADDITIONS, RELIC_COUNTS, RELIC_EFFECTS, RELIC_GOOD_LOW, RELIC_MULTIPLIERS, type RelicEffect, type RelicEffects } from '../tuning/relics';
import type { FighterState } from './state';
import { windUpTuning } from './tempo';

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

/** A pace Mod (`PACE_MODS`): `walkSpeed` or `windUp`. */
export type PaceMod = (typeof PACE_MODS)[number];

/**
 * Mods as a Fighter, a Duel Troop and the wire store them: every Mod but the pace Mods, and each pace Mod only while it is not 1
 * (`storedMods`). So a Fighter with Relics (or a Troop with `damage` 0.6) stores, hashes and sends exactly the record it did before the pace
 * Mods existed. Read a pace Mod with `walkSpeedOf` or `windUpOf`.
 */
export type StoredMods = Readonly<Omit<Mods, PaceMod> & Partial<Pick<Mods, PaceMod>>>;

/** `mods` as stored: each pace Mod at 1 left out (a new object). */
export function storedMods(mods: StoredMods): StoredMods {
  const out: Record<string, number> = { ...mods };
  for (const key of PACE_MODS) if (out[key] === undefined || out[key] === 1) delete out[key];
  return out as unknown as StoredMods;
}

/** The identity: no Relics. */
export const NO_MODS: Mods = Object.freeze({
  damage: 1,
  heavyDamage: 1,
  damageTaken: 1,
  blockImpactTaken: 1,
  daggerDamage: 1,
  kickDamage: 1,
  walkSpeed: 1,
  windUp: 1,
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

/**
 * `effects` scaled by a Rarity's multiplier `m` (`dungeon.loot.rarity.multipliers`), a new object with the same keys. A multiplier good above 1 (`f > 1`)
 * becomes `1 + (f - 1) × m`; one good below 1 (`RELIC_GOOD_LOW`, `f < 1`) `1 - (1 - f) × m`; a share (`a > 0`) `a × m`; a count (`RELIC_COUNTS`, `a > 0`)
 * `Math.round(a × m)`, so it stays whole (a half rounds up). A downside (a multiplier on the wrong side of 1) and a factor of 1 stay. At `m = 1` the
 * values come back bit-for-bit (`1 + (f - 1) × 1` can differ from `f` in the last bit), so a Common item folds exactly as an unscaled Relic. Pure.
 */
export function scaleEffects(effects: RelicEffects, m: number): RelicEffects {
  if (m === 1) return { ...effects };
  const scaled: Partial<Record<RelicEffect, number>> = {};
  for (const key of RELIC_EFFECTS) {
    const v = effects[key];
    if (v === undefined) continue;
    if ((RELIC_MULTIPLIERS as readonly string[]).includes(key)) {
      const low = (RELIC_GOOD_LOW as readonly string[]).includes(key);
      scaled[key] = low ? (v < 1 ? 1 - (1 - v) * m : v) : v > 1 ? 1 + (v - 1) * m : v;
    } else if ((RELIC_COUNTS as readonly string[]).includes(key)) scaled[key] = v > 0 ? Math.round(v * m) : v;
    else scaled[key] = v > 0 ? v * m : v;
  }
  return scaled;
}

/** Every Mods key (the Relic vocabulary), for a hash or a message validator. */
export const MODS_KEYS: readonly RelicEffect[] = RELIC_EFFECTS;

/** A Fighter's Mods: its own `mods`, which is absent (never stored) while they are `NO_MODS`, so a Fighter without Relics hashes as it always did. Its pace Mods are read with `walkSpeedOf` and `windUpOf`. */
export const modsOf = (f: Pick<FighterState, 'mods'>): StoredMods => f.mods ?? NO_MODS;

/** The factor a Fighter's ground walk is multiplied by (its `walkSpeed` Mod; 1 without one). */
export const walkSpeedOf = (f: Pick<FighterState, 'mods'>): number => f.mods?.walkSpeed ?? 1;

/** The factor a Fighter's Attack Wind-up lasts (its `windUp` Mod; 1 without one), on top of its Weapon's own `tempo.windUp`. */
export const windUpOf = (f: Pick<FighterState, 'mods'>): number => f.mods?.windUp ?? 1;

/** Whether `mods` change nothing (a pace Mod left out is 1). */
export const isNoMods = (mods: StoredMods): boolean => RELIC_EFFECTS.every((key) => (mods[key] ?? NO_MODS[key]) === NO_MODS[key]);

/**
 * The Tuning Data a Fighter's own Motions play by: its Size's (`sizedTuning`), with every Weapon's Attack Wind-up stretched by its `windUp`
 * Mod (`windUpTuning`). The standard Tuning Data itself for a standard Fighter without a `windUp`, so it plays and poses as it always did.
 * Every place that times or poses a Fighter's own Motion (its Action this Tick, its pose, its Chamber window, the drawing) reads this one.
 */
export function fighterTuning(standard: TuningData, f: Pick<FighterState, 'mods' | 'size'>): TuningData {
  // A Fighter's own Tuning Data handed on as the standard one (a Landing's Stagger, `staggerFighter`) is not stretched twice.
  if (stretchedTunings.has(standard)) return standard;
  const windUp = windUpOf(f);
  const own = sizedTuning(windUpTuning(standard, windUp), f.size);
  if (windUp !== 1) stretchedTunings.add(own);
  return own;
}

/** Every Tuning Data `fighterTuning` gave a Fighter with a `windUp` Mod (a Wind-up already stretched). */
const stretchedTunings = new WeakSet<TuningData>();

/**
 * The one seam that gives a Fighter its Mods, called at a Hall's start (`hallDuel`) and by anything that changes the Relics
 * it wields mid-Hall (an equip): `f` with `mods` stored (absent when they are `NO_MODS`), max HP `baseMaxHp × (1 + mods.maxHp)`
 * (`baseMaxHp` is the Fighter's max HP before Mods: `fighter.maxHp`, or an enemy's scaled one), HP kept but never above the new
 * max HP (a Mod that raises max HP does not heal; the caller sets HP when it wants a full one), and its Throwing Daggers moved by the change in
 * `mods.daggers` (a Fighter fresh from a Duel's start holds `dagger.count`, so it ends with `dagger.count + daggers`; one equipping mid-Hall
 * is not refilled). Pure.
 */
export function setMods(f: FighterState, mods: StoredMods, baseMaxHp: number): FighterState {
  const { mods: previous, ...rest } = f;
  const maxHp = baseMaxHp * (1 + mods.maxHp);
  return {
    ...rest,
    ...(isNoMods(mods) ? {} : { mods: storedMods(mods) }),
    maxHp,
    hp: Math.min(f.hp, maxHp),
    daggers: Math.max(0, f.daggers + mods.daggers - (previous ?? NO_MODS).daggers),
  };
}
