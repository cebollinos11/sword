import { describe, expect, it } from 'vitest';
import { createMatch } from '../sim';
import { loadTuningData, troopBodies } from '../tuning';
import { floorTroops } from '../sim/delver';
import { floorBodies, floorBodyOf } from './floorBodies';

const tuning = loadTuningData();

describe("a Delver Run's Fighters' Bodies", () => {
  const m = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', teams: [0, 0, 1, 1, 1, 1], humans: 2, players: [0, 1] });
  const duel = m.duel;
  const bound = { ...duel, fighters: duel.fighters.map((f, k) => (k === 3 ? { ...f, soldier: { index: 5, since: 0, role: 'Attack' as const } } : f)) };

  it("dresses a bound Pool slot in its Soldier's Body, the party in the Lineup's, and an unbound slot in none", () => {
    const bodies = floorBodies(bound, 2, ['male', undefined, 'female', 'female'], (s) => `soldier${s}`);
    expect(bodies).toHaveLength(duel.fighters.length);
    expect(bodies.slice(0, 2)).toEqual(['male', undefined]);
    expect(bodies[3]).toBe('soldier5');
    expect(bodies[2]).toBeUndefined();
    expect(bodies.slice(4).every((b) => b === undefined)).toBe(true);
  });
});

describe("a Delver traitor's Body (Stage 8a)", () => {
  it("dresses a traitor's slot in the Soldier it took over, and in none while it watches", () => {
    const m = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', teams: [0, 0], humans: 2, players: [0, 1], traitors: [{}] });
    const watching = floorBodies(m.duel, 2, [], (s) => `soldier${s}`);
    expect(watching[2]).toBeUndefined();
    const records = [{ ...m.delver!.traitors![0]!, soldier: 7, warband: 0 }];
    const held = { ...m.duel, delver: { ...m.duel.delver!, traitors: records } };
    expect(floorBodies(held, 2, [], (s) => `soldier${s}`)[2]).toBe('soldier7');
  });
});

describe('a Delver Floor’s Soldiers’ Bodies', () => {
  const two = { ...tuning, delver: { ...tuning.delver, tiers: 2, floorsPerTier: 1 } };
  const run = createMatch(two, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', teams: [0] });
  const crowd = run.duel.crowd!;
  const { troops, boss, elite } = floorTroops(two.delver);

  it('reads a Boss Troop as its Prefab\'s Body, and an elite as its Variant\'s Prefab\'s', () => {
    const as = (troop: number) => floorBodyOf(two, run.arena, { ...crowd, troop: crowd.troop.map(() => troop), look: crowd.look.map(() => 0), team: crowd.team.map(() => 1) })(0);
    expect(troopBodies(troops[boss[0]!]!, 1)).toEqual([as(boss[0]!)]);
    const spec = two.delver.warbands[0]!.boss!;
    expect(as(boss[0]!)).toBe(two.delver.troops[spec.prefab]!.body);
    const eliteTroop = elite[0]![2]![0]!;
    expect(as(eliteTroop)).toBe(two.delver.troops[2]!.body);
  });

  it('falls back to the Battle’s Soldier Body without a Crowd', () => {
    expect(floorBodyOf(two, run.arena, undefined)(0)).toBe(two.battle.soldier.body);
  });
});

