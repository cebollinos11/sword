import { describe, expect, it } from 'vitest';
import { applyBattleKnobs, loadTuningData, parseBattle, type TuningData } from '../tuning';
import { soldierLooks } from '../render/impostorAtlas';
import { createCrowd, hashValue, soldierBody, soldierTroops, troopOf } from '.';

const tuning = loadTuningData();
const small: TuningData = { ...tuning, battle: { ...tuning.battle, armySize: 40, deploy: { ...tuning.battle.deploy, front: 10, perRank: 10 } } };
const army = small.battle.armySize;

describe('Troops (Soldier Types)', () => {
  it('fields the one generic soldier when a Battle names no Troops', () => {
    const { troops: _troops, ...raw } = tuning.battle;
    const b = parseBattle(raw);
    expect(b.troops).toHaveLength(1);
    const [t] = b.troops;
    expect(t).toMatchObject({ bodies: [b.soldier.body], weapon: b.soldier.weapon, difficulty: b.soldier.difficulty, hp: b.crowd.hp, damage: b.crowd.damage, hitChance: b.crowd.hitChance, engageReach: b.crowd.engageReach });
  });

  it("fills what a Troop leaves out from the generic soldier, accepts its own output and refuses what is not a Weapon or difficulty", () => {
    const raw = { ...tuning.battle, troops: [{ name: 'A', weapon: 'Halberd' }, { name: 'B', body: 'monk', hp: 80, weight: 3 }] };
    const b = parseBattle(raw);
    expect(b.troops[0]).toMatchObject({ weight: 1, bodies: [b.soldier.body], weapon: 'Halberd', hp: b.crowd.hp });
    expect(b.troops[1]).toMatchObject({ weight: 3, bodies: ['monk'], weapon: b.soldier.weapon, hp: 80 });
    expect(parseBattle(b)).toEqual(b);
    expect(() => parseBattle({ ...raw, troops: [{ name: 'A', weapon: 'Spoon' }] }, Object.keys(tuning.weapons))).toThrow(/battle\.troops\[0\]\.weapon "Spoon"/);
    expect(() => parseBattle({ ...raw, troops: [{ name: 'A', difficulty: 'Godlike' }] }, undefined, ['Beginner'])).toThrow(/battle\.troops\[0\]\.difficulty/);
    expect(() => parseBattle({ ...raw, troops: [{ name: 'A' }, { name: 'A' }] })).toThrow(/named twice/);
    expect(() => parseBattle({ ...raw, troops: [] })).toThrow(/battle\.troops/);
  });

  it('gives each Soldier a Troop and look from the seed, the same place for place in both armies, every Troop by its weight', () => {
    const n = 2 * army;
    const a = soldierTroops(small.battle, 7, n);
    expect(soldierTroops(small.battle, 7, n)).toEqual(a);
    for (let i = 0; i < army; i++) {
      expect(a.troop[army + i]).toBe(a.troop[i]);
      expect(a.look[army + i]).toBe(a.look[i]);
      expect(a.look[i]!).toBeLessThan(small.battle.troops[a.troop[i]!]!.bodies.length);
    }
    // A big army fields every Troop.
    const big = soldierTroops({ ...tuning.battle, armySize: 1000 }, 3, 1000);
    for (let t = 0; t < tuning.battle.troops.length; t++) expect(big.troop).toContain(t);
  });

  it("starts each Soldier at its Troop's HP, and its Troop is part of the state's hash", () => {
    const c = createCrowd(small.battle, 5);
    for (let i = 0; i < c.x.length; i++) {
      expect(c.hp[i]).toBe(troopOf(small.battle, c, i).hp);
      expect(troopOf(small.battle, c, i).bodies).toContain(soldierBody(small.battle, c, i));
    }
    const other = { ...c, troop: c.troop.map((t) => (t + 1) % small.battle.troops.length) };
    expect(hashValue(other)).not.toBe(hashValue(c));
  });

  it('scales every Troop’s hit chance by the hit-rate knob', () => {
    const b = applyBattleKnobs(tuning.battle, { hitRate: 2 });
    b.troops.forEach((t, k) => expect(t.hitChance).toBeCloseTo(Math.min(1, 2 * tuning.battle.troops[k]!.hitChance), 9));
  });

  it('bakes one impostor atlas per distinct Body and Weapon', () => {
    const { looks, index } = soldierLooks({ troops: [
      { ...tuning.battle.troops[0]!, bodies: ['female', 'monk'], weapon: 'Arming Sword' },
      { ...tuning.battle.troops[0]!, bodies: ['monk'], weapon: 'Arming Sword' },
      { ...tuning.battle.troops[0]!, bodies: ['monk'], weapon: 'Halberd' },
    ] });
    expect(looks).toEqual([
      { body: 'female', weapon: 'Arming Sword' },
      { body: 'monk', weapon: 'Arming Sword' },
      { body: 'monk', weapon: 'Halberd' },
    ]);
    expect(index).toEqual([[[0, 1], [1], [2]], [[0, 1], [1], [2]]]);
  });

  it('draws a Troop in different Bodies per Team when it names teamBodies', () => {
    const troop = { ...tuning.battle.troops[0]!, bodies: ['female'], teamBodies: [['female'], ['monk', 'prince']] as [string[], string[]], weapon: 'Arming Sword' };
    const { looks, index } = soldierLooks({ troops: [troop] });
    expect(looks.map((l) => l.body)).toEqual(['female', 'monk', 'prince']);
    expect(index).toEqual([[[0]], [[1, 2]]]);

    const battle = { ...small.battle, troops: [troop] };
    const crowd = createCrowd(battle, 7);
    const t0 = crowd.team.findIndex((t) => t === 0);
    const t1 = crowd.team.findIndex((t) => t === 1);
    expect(soldierBody(battle, crowd, t0)).toBe('female');
    expect(['monk', 'prince']).toContain(soldierBody(battle, crowd, t1));
  });

  it('parses teamBodies, taking null to mean the Troop’s own bodies', () => {
    const raw = { ...tuning.battle, troops: [{ name: 'A', bodies: ['monk'], teamBodies: [null, ['prince']] }] } as unknown as Parameters<typeof parseBattle>[0];
    const parsed = parseBattle(raw);
    expect(parsed.troops[0]!.teamBodies).toEqual([['monk'], ['prince']]);
  });
});
