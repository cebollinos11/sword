import { describe, expect, it } from 'vitest';
import { loadTuningData, parseBattle, tuningDataHash, TuningDataError } from './index';

const tuning = loadTuningData();

describe('Battle Tuning Data (data/battle.json)', () => {
  it('loads, and accepts its own output', () => {
    expect(tuning.battle.armySize).toBe(200);
    expect(tuning.battle.crowd.stagger).toBe(6);
    expect(parseBattle(tuning.battle)).toEqual(tuning.battle);
  });

  it('rejects bad values, naming them', () => {
    const b = tuning.battle;
    expect(() => parseBattle({ ...b, armySize: 2.5 })).toThrow(/battle\.armySize must be a whole number/);
    expect(() => parseBattle({ ...b, crowd: { ...b.crowd, stagger: 0 } })).toThrow(/battle\.crowd\.stagger/);
    expect(() => parseBattle({ ...b, crowd: { ...b.crowd, damage: [20, 8] } })).toThrow(/battle\.crowd\.damage/);
    expect(() => parseBattle({ ...b, crowd: { ...b.crowd, hitChance: 1.5 } })).toThrow(/battle\.crowd\.hitChance must be at most 1/);
    expect(() => parseBattle({ ...b, rout: { ...b.rout, threshold: -0.1 } })).toThrow(/battle\.rout\.threshold/);
    expect(() => parseBattle({ ...b, field: { ...b.field, cell: 7 } })).toThrow(/must divide/);
    expect(() => parseBattle({ ...b, deploy: { ...b.deploy, front: 95 } })).toThrow(/must fit/);
    expect(() => parseBattle(undefined)).toThrow(TuningDataError);
  });

  it('is part of the Tuning Data hash', () => {
    const base = tuningDataHash(tuning);
    const b = tuning.battle;
    for (const battle of [{ ...b, armySize: 199 }, { ...b, crowd: { ...b.crowd, hp: 99 } }, { ...b, field: { ...b.field, hillHeight: 2 } }, { ...b, rout: { ...b.rout, seconds: 4 } }])
      expect(tuningDataHash({ ...tuning, battle })).not.toBe(base);
  });
});
