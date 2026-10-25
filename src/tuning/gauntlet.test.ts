import { describe, expect, it } from 'vitest';
import { MAX_TEAM_SIZE } from '../sim';
import { applyRunKnobs, loadTuningData, MAX_FLOOR_ENEMIES, parseGauntlet, runDifficultyLadder, tuningDataHash, type TuningData } from './index';

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
    expect(g.floors[6]!.enemies[0]).toEqual({ difficulty: 'Expert', style: 'random', weapon: 'Sledge Hammer', body: 'wraith', hpScale: 3 });
    expect(g.floors[0]!.enemies[0]).toEqual({ difficulty: 'Beginner', style: 'random', weapon: 'random', body: 'random', hpScale: 1 });
    expect([g.interFloorSeconds, g.heal, g.revive, g.perPlayerHp]).toEqual([5, 0.3, 0.4, 0.5]);
    // Parsing its own output gives it back (the Editor reparses loaded Tuning Data).
    expect(parse(g)).toEqual(g);
    expect(MAX_FLOOR_ENEMIES).toBe(MAX_TEAM_SIZE);
  });

  it('rejects an unknown difficulty or Weapon, 0 or more than 4 enemies, no Floors, and bad numbers', () => {
    const floor = (enemies: unknown[]) => ({ ...raw(), floors: [{ enemies }] });
    expect(() => parse(floor([{ difficulty: 'Legendary', weapon: 'random' }]))).toThrow(/floors\[0\]\.enemies\[0\]\.difficulty/);
    expect(() => parse(floor([{ difficulty: 'Easy', weapon: 'Spoon' }]))).toThrow(/floors\[0\]\.enemies\[0\]\.weapon/);
    expect(() => parse(floor([]))).toThrow(/1 to 4 enemies/);
    expect(() => parse(floor(Array(5).fill({ difficulty: 'Easy', weapon: 'random' })))).toThrow(/1 to 4 enemies/);
    for (const minTeam of [0, 1.5, 5]) expect(() => parse(floor([{ difficulty: 'Easy', weapon: 'random', minTeam }]))).toThrow(/minTeam/);
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

describe('Run knobs (applyRunKnobs)', () => {
  const g = tuning.gauntlet;

  it('none, or every knob at its standard, leave the Gauntlet as it is', () => {
    expect(applyRunKnobs(g, undefined)).toBe(g);
    expect(applyRunKnobs(g, {})).toBe(g);
    expect(applyRunKnobs(g, { difficulty: 0, enemyHp: 1, maxEnemies: MAX_FLOOR_ENEMIES, heal: g.heal, perPlayerHp: g.perPlayerHp })).toBe(g);
  });

  it('steps each enemy along the ladder its Floors name, held at either end', () => {
    expect(runDifficultyLadder(g)).toEqual(['Beginner', 'Skilled', 'Expert']);
    const difficulties = (k: Parameters<typeof applyRunKnobs>[1]) => applyRunKnobs(g, k).floors.map((f) => f.enemies.map((e) => e.difficulty));
    expect(difficulties({ difficulty: -1 })[4]).toEqual(['Skilled', 'Beginner', 'Beginner']);
    expect(difficulties({ difficulty: -2 }).flat().every((d) => d === 'Beginner')).toBe(true);
    expect(difficulties({ difficulty: 1 })[0]).toEqual(['Skilled', 'Skilled']);
    expect(difficulties({ difficulty: 5 })[0]).toEqual(['Expert', 'Expert']);
  });

  it('scales every enemy HP, keeps the first enemies of a Floor (the boss among them), and replaces heal and co-op scaling', () => {
    const k = applyRunKnobs(g, { enemyHp: 0.5, maxEnemies: 1, heal: 1, perPlayerHp: 0 });
    expect(k.floors.every((f) => f.enemies.length === 1)).toBe(true);
    expect(k.floors[6]!.enemies[0]).toMatchObject({ weapon: 'Sledge Hammer', hpScale: 1.5 });
    expect(k.floors[6]!.boss).toBe(true);
    expect([k.heal, k.perPlayerHp, k.revive]).toEqual([1, 0, g.revive]);
    // Out of range is held to range; the result still parses as Tuning Data.
    const wild = applyRunKnobs(g, { maxEnemies: 9, heal: 3, perPlayerHp: -1, enemyHp: -2 });
    expect([wild.heal, wild.perPlayerHp, wild.floors[5]!.enemies.length, wild.floors[0]!.enemies[0]!.hpScale]).toEqual([1, 0, MAX_FLOOR_ENEMIES, 1]);
    expect(parse(k)).toEqual(k);
  });
});
