import { describe, expect, it } from 'vitest';
import { RELIC_EFFECTS, RELIC_MULTIPLIERS, type RelicEffect } from '../tuning';
import { foldMods, NO_MODS } from './mods';

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
