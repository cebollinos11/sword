import { describe, expect, it } from 'vitest';
import { bubbleSlots, loadTuningData, parseBattle, tuningDataHash, TuningDataError } from './index';

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

  it('sets the Bubble: a Pool of 16, promote at 10 m and demote beyond 16 m, holding outside sword reach', () => {
    const b = tuning.battle;
    expect(b.bubble).toEqual({ poolSize: 16, promote: 10, demote: 16, minPromotedSeconds: 1, corpseSeconds: 3, hold: 3 });
    expect(() => parseBattle({ ...b, bubble: { ...b.bubble, demote: 10 } })).toThrow(/battle\.bubble\.demote \(10\) must be more than/);
    expect(() => parseBattle({ ...b, bubble: { ...b.bubble, hold: 12 } })).toThrow(/battle\.bubble\.hold/);
    expect(() => parseBattle({ ...b, bubble: { ...b.bubble, poolSize: 1.5 } })).toThrow(/battle\.bubble\.poolSize must be a whole number/);
    expect(() => parseBattle({ ...b, bubble: undefined })).toThrow(/battle\.bubble/);
  });

  it('sets the Attack Slots (4 enemies, 3 allies) and the waiting ring just outside sword reach', () => {
    const b = tuning.battle;
    expect(b.slots).toMatchObject({ enemies: 4, allies: 3, engaged: 2.5 });
    expect(b.ring).toEqual({ radius: 3.5, spacing: 1.2, pathAhead: 3, pathWidth: 0.8, waiting: 8 });
    expect(parseBattle({ ...b, slots: { ...b.slots, allies: 0, shared: [] } }).slots.allies).toBe(0);
    expect(() => parseBattle({ ...b, slots: { ...b.slots, enemies: 0 } })).toThrow(/battle\.slots\.enemies/);
    expect(() => parseBattle({ ...b, slots: { ...b.slots, allies: 1.5 } })).toThrow(/battle\.slots\.allies must be a whole number/);
    expect(() => parseBattle({ ...b, slots: { ...b.slots, enemies: 10, allies: 6 } })).toThrow(/must leave room in the Pool/);
    expect(() => parseBattle({ ...b, ring: { ...b.ring, radius: 2 } })).toThrow(/battle\.ring\.radius \(2\) must be at least battle\.bubble\.hold/);
    expect(() => parseBattle({ ...b, ring: { ...b.ring, radius: 10 } })).toThrow(/battle\.ring\.radius/);
    expect(() => parseBattle({ ...b, ring: undefined })).toThrow(/battle\.ring/);
  });

  it("shrinks each Bubble's slots as more Bubbles are in use, so the Players and their slots fit the Pool", () => {
    const b = tuning.battle;
    expect(b.slots.shared).toEqual([
      { enemies: 2, allies: 1 },
      { enemies: 2, allies: 1 },
      { enemies: 1, allies: 1 },
    ]);
    expect([0, 1, 2, 3, 4, 5].map((n) => bubbleSlots(b.slots, n))).toEqual([
      { enemies: 4, allies: 3 },
      { enemies: 4, allies: 3 },
      { enemies: 2, allies: 1 },
      { enemies: 2, allies: 1 },
      { enemies: 1, allies: 1 },
      { enemies: 1, allies: 1 },
    ].map((e) => expect.objectContaining(e)));
    for (let n = 1; n <= 4; n++) {
      const { enemies, allies } = bubbleSlots(b.slots, n);
      expect(n * (1 + enemies + allies)).toBeLessThanOrEqual(b.bubble.poolSize);
    }
    expect(bubbleSlots({ ...b.slots, shared: [] }, 4)).toMatchObject({ enemies: 4, allies: 3 });
    const shared = (s: unknown) => parseBattle({ ...b, slots: { ...b.slots, shared: s } });
    expect(shared([]).slots.shared).toEqual([]);
    expect(() => shared(undefined)).toThrow(/battle\.slots\.shared/);
    expect(() => shared([{ enemies: 5, allies: 1 }])).toThrow(/battle\.slots\.shared\[0\]: a Bubble's slots never grow/);
    expect(() => shared([{ enemies: 3, allies: 2 }, { enemies: 3, allies: 3 }])).toThrow(/battle\.slots\.shared\[1\]: a Bubble's slots never grow/);
    expect(() => shared([{ enemies: 0, allies: 1 }])).toThrow(/battle\.slots\.shared\[0\]\.enemies/);
    expect(() => shared([{ enemies: 2, allies: 0.5 }])).toThrow(/battle\.slots\.shared\[0\]\.allies must be a whole number/);
    expect(() => shared([{ enemies: 3, allies: 2 }, { enemies: 3, allies: 1 }, { enemies: 3, allies: 1 }])).toThrow(/battle\.slots\.shared\[2\]: 4 Bubbles .* must fit the Pool of 16/);
    expect(parseBattle(b)).toEqual(b);
  });

  it('is part of the Tuning Data hash', () => {
    const base = tuningDataHash(tuning);
    const b = tuning.battle;
    for (const battle of [{ ...b, armySize: 199 }, { ...b, crowd: { ...b.crowd, hp: 99 } }, { ...b, field: { ...b.field, hillHeight: 2 } }, { ...b, rout: { ...b.rout, seconds: 4 } }, { ...b, soldier: { ...b.soldier, weapon: 'Longsword' } }, { ...b, bubble: { ...b.bubble, poolSize: 12 } }, { ...b, bubble: { ...b.bubble, demote: 18 } }, { ...b, slots: { ...b.slots, enemies: 3 } }, { ...b, slots: { ...b.slots, shared: [{ enemies: 3, allies: 1 }] } }, { ...b, ring: { ...b.ring, radius: 4 } }, { ...b, ring: { ...b.ring, waiting: 9 } }, { ...b, takeover: { seconds: 2 } }, { ...b, soldier: { ...b.soldier, difficulty: 'Skilled' } }, { ...b, soldier: { ...b.soldier, style: { aggression: 0.5 } } }, { ...b, soldier: { ...b.soldier, mods: { damage: 0.6 } } }])
      expect(tuningDataHash({ ...tuning, battle })).not.toBe(base);
  });

  it("sets the takeover's delay, the waiting ring's cap and how a promoted soldier fights, Battle only", () => {
    const b = tuning.battle;
    expect(b.takeover).toEqual({ seconds: 1.5 });
    expect(b.soldier).toMatchObject({ difficulty: 'Beginner', style: { throwRate: 0 }, mods: { damage: 0.5 } });
    expect(() => parseBattle({ ...b, ring: { ...b.ring, waiting: 2.5 } })).toThrow(/battle\.ring\.waiting must be a whole number/);
    expect(() => parseBattle({ ...b, takeover: { seconds: -1 } })).toThrow(/battle\.takeover\.seconds/);
    expect(() => parseBattle({ ...b, soldier: { ...b.soldier, difficulty: 'Godlike' } }, undefined, ['Beginner'])).toThrow(/battle\.soldier\.difficulty "Godlike"/);
    expect(() => parseBattle({ ...b, soldier: { ...b.soldier, style: { reactionTime: 2 } } }, undefined, undefined, ['aggression'])).toThrow(/battle\.soldier\.style\.reactionTime/);
    expect(() => parseBattle({ ...b, soldier: { ...b.soldier, mods: { maxHp: 1 } } })).toThrow(/battle\.soldier\.mods\.maxHp/);
    expect(() => parseBattle({ ...b, soldier: { ...b.soldier, mods: { damage: 0 } } })).toThrow(/battle\.soldier\.mods/);
  });
});
