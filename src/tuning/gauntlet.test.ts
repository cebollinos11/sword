import { describe, expect, it } from 'vitest';
import { MAX_TEAM_SIZE } from '../sim';
import { loadTuningData, MAX_FLOOR_ENEMIES, parseGauntlet, tuningDataHash, type TuningData } from './index';

const tuning = loadTuningData();
const WEAPONS = Object.keys(tuning.weapons);
const DIFFICULTIES = Object.keys(tuning.ai.difficulties);
const STYLES = Object.keys(tuning.ai.styles);
const raw = () => JSON.parse(JSON.stringify(tuning.gauntlet)) as Record<string, unknown> & { floors: { enemies: Record<string, unknown>[] }[] };
const parse = (g: unknown) => parseGauntlet(g, WEAPONS, DIFFICULTIES, STYLES);

describe('Gauntlet Tuning Data (data/gauntlet.json)', () => {
  it('loads the repo file: 7 Floors, the last the boss, and the HP carry-over numbers', () => {
    const g = tuning.gauntlet;
    expect(g.floors.length).toBe(7);
    expect(g.floors.map((f) => f.boss)).toEqual([false, false, false, false, false, false, true]);
    expect(g.floors[6]!.enemies[0]).toEqual({ difficulty: 'Hard', weapon: 'Sledge Hammer', body: 'wraith', hpScale: 3 });
    expect(g.floors[0]!.enemies[0]).toEqual({ difficulty: 'Easy', weapon: 'random', body: 'random', hpScale: 1 });
    expect([g.interFloorSeconds, g.heal, g.revive, g.perPlayerHp]).toEqual([5, 0.3, 0.4, 0.5]);
    // Parsing its own output gives it back (the Editor reparses loaded Tuning Data).
    expect(parse(g)).toEqual(g);
    expect(MAX_FLOOR_ENEMIES).toBe(MAX_TEAM_SIZE);
  });

  it('rejects an unknown difficulty or Weapon, 0 or more than 3 enemies, no Floors, and bad numbers', () => {
    const floor = (enemies: unknown[]) => ({ ...raw(), floors: [{ enemies }] });
    expect(() => parse(floor([{ difficulty: 'Legendary', weapon: 'random' }]))).toThrow(/floors\[0\]\.enemies\[0\]\.difficulty/);
    expect(() => parse(floor([{ difficulty: 'Easy', weapon: 'Spoon' }]))).toThrow(/floors\[0\]\.enemies\[0\]\.weapon/);
    expect(() => parse(floor([]))).toThrow(/1 to 3 enemies/);
    expect(() => parse(floor(Array(4).fill({ difficulty: 'Easy', weapon: 'random' })))).toThrow(/1 to 3 enemies/);
    expect(() => parse(floor([{ difficulty: 'Easy', weapon: 'random', hpScale: 0 }]))).toThrow(/hpScale/);
    expect(() => parse({ ...raw(), floors: [] })).toThrow(/at least one Floor/);
    expect(() => parse({ ...raw(), perPlayerHp: -0.1 })).toThrow(/perPlayerHp/);
    expect(() => parse({ ...raw(), revive: 0 })).toThrow(/revive/);
    expect(() => parse({ ...raw(), heal: 1.5 })).toThrow(/heal/);
    expect(() => parse({ ...raw(), interFloorSeconds: 0 })).toThrow(/interFloorSeconds/);
    expect(() => parse({ ...raw(), floors: [{ boss: 'yes', enemies: [{ difficulty: 'Easy', weapon: 'random' }] }] })).toThrow(/boss/);
  });

  it('takes an optional AI Style per enemy, a Style of ai.styles or "random", and rejects an unknown one', () => {
    const floor = (enemies: unknown[]) => ({ ...raw(), floors: [{ enemies }] });
    expect(parse(floor([{ difficulty: 'Easy', weapon: 'random', style: 'Counter' }, { difficulty: 'Easy', weapon: 'random', style: 'random' }])).floors[0]!.enemies.map((e) => e.style)).toEqual(['Counter', 'random']);
    expect(parse(floor([{ difficulty: 'Easy', weapon: 'random' }])).floors[0]!.enemies[0]).not.toHaveProperty('style');
    expect(() => parse(floor([{ difficulty: 'Easy', weapon: 'random', style: 'Sneaky' }]))).toThrow(/floors\[0\]\.enemies\[0\]\.style/);
    expect(() => parse(floor([{ difficulty: 'Easy', weapon: 'random', style: 3 }]))).toThrow(/style/);
  });

  it('is in the Tuning Data hash: any change to it changes the hash', () => {
    const base = tuningDataHash(tuning);
    const g = tuning.gauntlet;
    const changed = (gauntlet: TuningData['gauntlet']) => tuningDataHash({ ...tuning, gauntlet });
    expect(changed({ ...g, perPlayerHp: g.perPlayerHp + 0.1 })).not.toBe(base);
    expect(changed({ ...g, heal: g.heal + 0.1 })).not.toBe(base);
    expect(changed({ ...g, floors: g.floors.slice(1) })).not.toBe(base);
    const [first, ...rest] = g.floors;
    expect(changed({ ...g, floors: [{ ...first!, enemies: [{ ...first!.enemies[0]!, difficulty: 'Hard' }] }, ...rest] })).not.toBe(base);
  });
});
