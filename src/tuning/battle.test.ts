import { describe, expect, it } from 'vitest';
import { applyBattleKnobs, bubbleSlots, deployLayout, loadTuningData, maxArmySize, parseBattle, parseBattleKnobs, squadSizes, startingTickets, tuningDataHash, TuningDataError } from './index';

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

  it('sets the Squads: 12 Soldiers, 2 Hz, column 3 wide, line 6 wide, and what it refuses', () => {
    const b = tuning.battle;
    expect(b.squad).toMatchObject({ size: 12, spacing: 1.5, brainSeconds: 0.5, moraleThreshold: 0.3, engage: 15, column: { wide: 3 }, line: { wide: 6 } });
    expect(() => parseBattle({ ...b, squad: { ...b.squad, size: 0 } })).toThrow(/battle\.squad\.size/);
    expect(() => parseBattle({ ...b, squad: { ...b.squad, catchUp: 0.9 } })).toThrow(/battle\.squad\.catchUp must be at least 1/);
    expect(() => parseBattle({ ...b, squad: { ...b.squad, speed: 1.2 } })).toThrow(/battle\.squad\.speed must be at most 1/);
    expect(() => parseBattle({ ...b, squad: { ...b.squad, moraleThreshold: 1.5 } })).toThrow(/battle\.squad\.moraleThreshold must be at most 1/);
    expect(() => parseBattle({ ...b, squad: { ...b.squad, mergeMax: 11 } })).toThrow(/battle\.squad\.mergeMax \(11\) must be at least/);
    expect(() => parseBattle({ ...b, squad: { ...b.squad, baseDistance: 100 } })).toThrow(/battle\.squad\.baseDistance/);
    expect(() => parseBattle({ ...b, squad: { ...b.squad, column: { wide: 2.5 } } })).toThrow(/battle\.squad\.column\.wide must be a whole number/);
    expect(() => parseBattle({ ...b, squad: undefined })).toThrow(TuningDataError);
    expect(() => parseBattle({ ...b, squad: { ...b.squad, mergeMax: 65 } })).toThrow(/at most 64 Soldiers/);
    expect(parseBattle(b)).toEqual(b);
  });

  it('sets the Objectives, Tickets and Commander, and what it refuses', () => {
    const b = tuning.battle;
    expect(b.objectives.openField.map((o) => o.id)).toEqual(['H0', 'A', 'B', 'C', 'H1']);
    expect(b.objectives.openField.map((o) => o.owner)).toEqual([0, -1, -1, -1, 1]);
    expect(b.objectives).toMatchObject({ radius: 12, playerCount: 3 });
    expect(b.tickets).toMatchObject({ perSoldier: 3.5, limitSeconds: 900, respawnSeconds: 10 });
    expect(startingTickets(b)).toBe(700);
    expect(b.commander).toMatchObject({ planSeconds: 2.5, holdSeconds: 15 });
    const site = b.objectives.openField[1]!;
    const sites = (openField: unknown[]) => parseBattle({ ...b, objectives: { ...b.objectives, openField } });
    expect(() => sites([{ ...site, owner: 2 }])).toThrow(/openField\[0\]\.owner/);
    expect(() => sites([{ ...site, x: 150 }])).toThrow(/must lie inside the 200 m field/);
    expect(() => sites([{ ...site, spawn: 1 }])).toThrow(/spawn must be true or false/);
    expect(() => sites([{ ...site, weight: 0 }])).toThrow(/weight/);
    expect(() => sites([site, site])).toThrow(/its own id/);
    expect(() => sites([])).toThrow(/must hold 1 to 12 Objectives/);
    expect(() => parseBattle({ ...b, objectives: { ...b.objectives, maxRate: 0.001 } })).toThrow(/maxRate/);
    expect(() => parseBattle({ ...b, commander: { ...b.commander, falloff: 1.5 } })).toThrow(/battle\.commander\.falloff must be at most 1/);
    expect(() => parseBattle({ ...b, tickets: undefined })).toThrow(TuningDataError);
    expect(() => parseBattle({ ...b, commander: undefined })).toThrow(TuningDataError);
    expect(parseBattle(b)).toEqual(b);
  });

  it('cuts an army into Squads of 12, the remainder folded one each into the last, and lays them out inside the field', () => {
    expect(squadSizes(200, 12)).toEqual([...new Array<number>(8).fill(12), ...new Array<number>(8).fill(13)]);
    expect(squadSizes(120, 12)).toEqual(new Array<number>(10).fill(12));
    expect(squadSizes(40, 12)).toEqual([13, 13, 14]);
    expect(squadSizes(5, 12)).toEqual([5]);
    for (const army of [1, 11, 12, 23, 100, 199, 200, 331]) expect(squadSizes(army, 12).reduce((a, s) => a + s, 0)).toBe(army);
    const layout = deployLayout(tuning.battle);
    expect(layout).toMatchObject({ perRank: 6, ranks: 3, rows: 4, deepest: 5 });
    expect(layout.depth).toBeLessThan(tuning.battle.field.size / 2);
    expect(maxArmySize(tuning.battle)).toBeGreaterThan(200);
  });

  it('is part of the Tuning Data hash', () => {
    const base = tuningDataHash(tuning);
    const b = tuning.battle;
    for (const battle of [{ ...b, squad: { ...b.squad, size: 10 } }, { ...b, squad: { ...b.squad, column: { wide: 4 } } }, { ...b, armySize: 199 }, { ...b, tickets: { ...b.tickets, drain: 0.5 } }, { ...b, commander: { ...b.commander, holdSeconds: 10 } }, { ...b, objectives: { ...b.objectives, radius: 10 } }, { ...b, crowd: { ...b.crowd, hp: 99 } }, { ...b, field: { ...b.field, hillHeight: 2 } }, { ...b, rout: { ...b.rout, seconds: 4 } }, { ...b, soldier: { ...b.soldier, weapon: 'Longsword' } }, { ...b, bubble: { ...b.bubble, poolSize: 12 } }, { ...b, bubble: { ...b.bubble, demote: 18 } }, { ...b, slots: { ...b.slots, enemies: 3 } }, { ...b, slots: { ...b.slots, shared: [{ enemies: 3, allies: 1 }] } }, { ...b, ring: { ...b.ring, radius: 4 } }, { ...b, ring: { ...b.ring, waiting: 9 } }, { ...b, takeover: { seconds: 2 } }, { ...b, soldier: { ...b.soldier, difficulty: 'Skilled' } }, { ...b, soldier: { ...b.soldier, style: { aggression: 0.5 } } }, { ...b, soldier: { ...b.soldier, mods: { damage: 0.6 } } }])
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

describe('Battle knobs', () => {
  const b = tuning.battle;
  it('leave Tuning Data as it is when they change nothing', () => {
    expect(applyBattleKnobs(b, undefined)).toBe(b);
    expect(applyBattleKnobs(b, {})).toBe(b);
    expect(applyBattleKnobs(b, { armySize: b.armySize, hitRate: 1 })).toBe(b);
  });

  it('set the army size and scale the chance of a blow', () => {
    const k = applyBattleKnobs(b, { armySize: 50, hitRate: 0.5 });
    expect(k.armySize).toBe(50);
    expect(k.crowd.hitChance).toBeCloseTo(b.crowd.hitChance / 2);
    expect(parseBattle(k)).toEqual(k);
  });

  it('hold out-of-range values to what the field takes', () => {
    expect(applyBattleKnobs(b, { armySize: 1e6 }).armySize).toBe(maxArmySize(b));
    expect(() => parseBattle(applyBattleKnobs(b, { armySize: 1e6 }))).not.toThrow();
    expect(() => parseBattle({ ...b, armySize: maxArmySize(b) + 1 })).toThrow(/must fit inside/);
    expect(applyBattleKnobs(b, { armySize: -5 }).armySize).toBe(1);
    expect(applyBattleKnobs(b, { hitRate: 100 }).crowd.hitChance).toBe(1);
  });

  it('are read back from storage only as known numeric keys', () => {
    expect(parseBattleKnobs({ armySize: 50, hitRate: 'x', other: 1 })).toEqual({ armySize: 50 });
    expect(parseBattleKnobs({})).toBeNull();
    expect(parseBattleKnobs([1])).toBeNull();
  });
});
