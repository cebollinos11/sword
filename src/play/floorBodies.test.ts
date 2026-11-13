import { describe, expect, it } from 'vitest';
import { createMatch } from '../sim';
import { loadTuningData } from '../tuning';
import { floorBodies } from './floorBodies';

const tuning = loadTuningData();

describe("a Delver Run's Fighters' Bodies", () => {
  const m = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', delver: true, teams: [0, 0, 1, 1, 1, 1], humans: 2, players: [0, 1] });
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
