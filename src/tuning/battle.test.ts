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

  it('names the generic soldier: a Weapon from the roster and a colour for each Team', () => {
    const b = tuning.battle;
    expect(b.soldier.weapon in tuning.weapons).toBe(true);
    expect(b.soldier.colours).toEqual([0xc0392b, 0x2e86c1]);
    expect(() => parseBattle({ ...b, soldier: { ...b.soldier, weapon: 'Spoon' } }, Object.keys(tuning.weapons))).toThrow(/battle\.soldier\.weapon "Spoon" is not a Weapon/);
    expect(() => parseBattle({ ...b, soldier: { ...b.soldier, colours: ['#c0392b'] } })).toThrow(/battle\.soldier\.colours/);
    expect(() => parseBattle({ ...b, soldier: { ...b.soldier, colours: ['red', '#2e86c1'] } })).toThrow(/battle\.soldier\.colours\[0\] must be a colour/);
    expect(() => parseBattle({ ...b, soldier: { ...b.soldier, body: '' } })).toThrow(/battle\.soldier\.body/);
  });

  it('is part of the Tuning Data hash', () => {
    const base = tuningDataHash(tuning);
    const b = tuning.battle;
    for (const battle of [{ ...b, armySize: 199 }, { ...b, crowd: { ...b.crowd, hp: 99 } }, { ...b, field: { ...b.field, hillHeight: 2 } }, { ...b, rout: { ...b.rout, seconds: 4 } }, { ...b, soldier: { ...b.soldier, weapon: 'Longsword' } }])
      expect(tuningDataHash({ ...tuning, battle })).not.toBe(base);
  });
});
