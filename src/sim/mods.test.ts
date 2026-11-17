import { describe, expect, it } from 'vitest';
import { RELIC_EFFECTS, RELIC_MULTIPLIERS, type RelicEffect } from '../tuning';
import { foldMods, NO_MODS, scaleEffects } from './mods';

const fold = (...effects: Partial<Record<RelicEffect, number>>[]) => foldMods(effects.map((e) => ({ effects: e })));
const isMultiplier = (key: RelicEffect) => (RELIC_MULTIPLIERS as readonly string[]).includes(key);

describe('foldMods', () => {
  it('gives NO_MODS for no Relics: multipliers 1, additions 0', () => {
    expect(fold()).toEqual(NO_MODS);
    for (const key of RELIC_EFFECTS) expect(NO_MODS[key]).toBe(isMultiplier(key) ? 1 : 0);
  });

  it('changes exactly the field an effect names', () => {
    for (const key of RELIC_EFFECTS) {
      const value = isMultiplier(key) ? 1.5 : 2;
      expect(fold({ [key]: value })).toEqual({ ...NO_MODS, [key]: value });
    }
  });

  it('multiplies multipliers and adds additions', () => {
    expect(fold({ damage: 1.5 }, { damage: 0.5 }, { damage: 2 }).damage).toBeCloseTo(1.5);
    expect(fold({ daggers: 1 }, { daggers: 2 }).daggers).toBe(3);
    expect(fold({ maxHp: 0.2 }, { maxHp: 0.1 }).maxHp).toBeCloseTo(0.3);
    expect(fold({ healOnKill: 5 }, { healOnKill: 10 }).healOnKill).toBe(15);
  });

  it('counts a Relic equipped twice twice', () => {
    const r = { effects: { damage: 1.1, healOnClear: 0.1 } };
    const twice = foldMods([r, r]);
    expect(twice.damage).toBeCloseTo(1.21);
    expect(twice.healOnClear).toBeCloseTo(0.2);
  });

  it('leaves NO_MODS and its inputs untouched', () => {
    const r = { effects: { damage: 2 } };
    foldMods([r]);
    expect(NO_MODS.damage).toBe(1);
    expect(r.effects).toEqual({ damage: 2 });
  });
});

describe('scaleEffects', () => {
  /** Each effect as the data has it, scaled by x1.5 and x2. */
  const cases: readonly [RelicEffect, number, number, number][] = [
    ['damage', 1.1, 1.15, 1.2],
    ['heavyDamage', 1.3, 1.45, 1.6],
    ['damageTaken', 0.9, 0.85, 0.8],
    ['blockImpactTaken', 0.7, 0.55, 0.4],
    ['daggerDamage', 1.4, 1.6, 1.8],
    ['kickDamage', 1.5, 1.75, 2],
    ['maxHp', 0.2, 0.3, 0.4],
    ['daggers', 1, 2, 2],
    ['healOnKill', 10, 15, 20],
    ['healOnClear', 0.15, 0.225, 0.3],
  ];

  it.each(cases)('%s %d becomes %d at x1.5 and %d at x2', (key, base, rare, legendary) => {
    expect(scaleEffects({ [key]: base }, 1.5)[key]).toBeCloseTo(rare, 12);
    expect(scaleEffects({ [key]: base }, 2)[key]).toBeCloseTo(legendary, 12);
  });

  it('covers every effect of the vocabulary', () => {
    expect(cases.map(([key]) => key).sort()).toEqual([...RELIC_EFFECTS].sort());
  });

  it('scales the good side of a Relic with a downside and keeps the downside: Glass Cannon', () => {
    for (const m of [1, 1.5, 2, 3]) {
      const scaled = scaleEffects({ damage: 1.3, damageTaken: 1.25 }, m);
      expect(scaled.damage).toBeCloseTo(1 + 0.3 * m, 12);
      expect(scaled.damageTaken).toBe(1.25);
    }
  });

  it('keeps a factor of exactly 1', () => {
    expect(scaleEffects({ damage: 1, damageTaken: 1 }, 2)).toEqual({ damage: 1, damageTaken: 1 });
  });

  it('is the identity at x1, bit for bit, and a new object', () => {
    const effects = { damage: 1.1, heavyDamage: 1.3, damageTaken: 0.9, blockImpactTaken: 0.7, daggerDamage: 1.4, kickDamage: 1.5, maxHp: 0.2, daggers: 1, healOnKill: 10, healOnClear: 0.15 };
    const same = scaleEffects(effects, 1);
    expect(same).toEqual(effects);
    expect(same).not.toBe(effects);
    for (const key of RELIC_EFFECTS) expect(Object.is(same[key], effects[key])).toBe(true);
  });

  it('rounds a count, a half up, and keeps it whole', () => {
    expect(scaleEffects({ daggers: 1 }, 1.5).daggers).toBe(2);
    expect(scaleEffects({ daggers: 3 }, 1.5).daggers).toBe(5);
    expect(scaleEffects({ healOnKill: 7 }, 1.5).healOnKill).toBe(11);
    for (const m of [1.5, 2, 2.7]) for (const n of [1, 2, 3, 7, 10]) expect(Number.isInteger(scaleEffects({ daggers: n, healOnKill: n }, m).daggers)).toBe(true);
  });

  it('returns the same keys and leaves its input untouched', () => {
    const effects = Object.freeze({ damage: 1.3, damageTaken: 1.25 });
    const scaled = scaleEffects(effects, 2);
    expect(Object.keys(scaled).sort()).toEqual(['damage', 'damageTaken']);
    expect(effects).toEqual({ damage: 1.3, damageTaken: 1.25 });
  });
});
