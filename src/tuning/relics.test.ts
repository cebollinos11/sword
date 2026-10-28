import { describe, expect, it } from 'vitest';
import { loadTuningData, parseRelics, RELIC_EFFECTS, tuningDataHash } from './index';

const tuning = loadTuningData();
const raw = () => JSON.parse(JSON.stringify(tuning.relics)) as Record<string, unknown>[];
const relic = (effects: Record<string, unknown>, more: Record<string, unknown> = {}) => [{ name: 'Test', icon: 'test', effects, ...more }];

describe('Relic Tuning Data (data/relics.json)', () => {
  it('loads the repo file: 10 to 15 Relics, each with an icon and effects, and every effect of the vocabulary used', () => {
    expect(tuning.relics.length).toBeGreaterThanOrEqual(10);
    expect(tuning.relics.length).toBeLessThanOrEqual(15);
    for (const r of tuning.relics) {
      expect(r.icon).not.toBe('');
      expect(Object.keys(r.effects).length).toBeGreaterThan(0);
    }
    const used = new Set(tuning.relics.flatMap((r) => Object.keys(r.effects)));
    expect([...used].sort()).toEqual([...RELIC_EFFECTS].sort());
  });

  it('accepts its own output', () => {
    expect(parseRelics(raw())).toEqual(tuning.relics);
  });

  it('refuses an unknown effect, and any Motion, Tempo or speed effect', () => {
    expect(() => parseRelics(relic({ luck: 2 }))).toThrow(/unknown effect "luck"/);
    for (const effect of ['walkSpeed', 'speed', 'tempo', 'motion', 'attackSpeed']) expect(() => parseRelics(relic({ [effect]: 1.2 }))).toThrow(/unknown effect/);
  });

  it('refuses a duplicate name, an empty name or icon, and no effects', () => {
    const one = { name: 'A', icon: 'a', effects: { damage: 1.1 } };
    expect(() => parseRelics([one, { ...one, icon: 'b' }])).toThrow(/duplicate Relic "A"/);
    expect(() => parseRelics(relic({ damage: 1.1 }, { name: ' ' }))).toThrow(/name/);
    expect(() => parseRelics(relic({ damage: 1.1 }, { icon: '' }))).toThrow(/icon/);
    expect(() => parseRelics(relic({}))).toThrow(/at least one effect/);
    expect(() => parseRelics({})).toThrow(/relics/);
  });

  it('refuses a bad number: a factor not above 0, a bad addition, or not a number', () => {
    for (const effect of ['damage', 'heavyDamage', 'damageTaken', 'blockImpactTaken', 'daggerDamage', 'kickDamage'])
      for (const v of [0, -1, '1.1', null, Infinity]) expect(() => parseRelics(relic({ [effect]: v }))).toThrow(new RegExp(`effects\\.${effect}`));
    for (const v of [0, -0.1, 'x']) expect(() => parseRelics(relic({ maxHp: v }))).toThrow(/maxHp/);
    for (const v of [0, 1.5, -1]) expect(() => parseRelics(relic({ daggers: v }))).toThrow(/daggers/);
    for (const v of [0, -5]) expect(() => parseRelics(relic({ healOnKill: v }))).toThrow(/healOnKill/);
    for (const v of [0, 1.1, -0.1]) expect(() => parseRelics(relic({ healOnClear: v }))).toThrow(/healOnClear/);
    expect(parseRelics(relic({ healOnClear: 1, daggers: 2, maxHp: 1.5 }))[0]!.effects).toEqual({ healOnClear: 1, daggers: 2, maxHp: 1.5 });
  });

  it('is part of the Tuning Data hash', () => {
    const changed = tuning.relics.map((r, i) => (i === 0 ? { ...r, effects: { damage: 1.11 } } : r));
    expect(tuningDataHash({ ...tuning, relics: changed })).not.toBe(tuningDataHash(tuning));
  });
});
