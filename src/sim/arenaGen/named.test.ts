import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena } from '../../tuning';
import { arenaOf } from '../arena';
import { hashValue } from '../hash';
import { ARENA_SEED_RANGE, DEFAULT_GEN_PARAMS, generateArena, GREYBOX_KIT, isArenaName, nextArenaName, nextArenaSeed, parseGeneratedName, withGeneratedArena } from './index';

const tuning = loadTuningData();

describe('withGeneratedArena: a Random Map built from its name alone', () => {
  it('builds the Arena gen:<kit>:<seed> names, with DEFAULT_GEN_PARAMS, and its Layout', () => {
    const { tuning: built, layout } = withGeneratedArena(tuning, 'gen:greybox:42');
    const expected = generateArena(GREYBOX_KIT, 42, DEFAULT_GEN_PARAMS, tuning);
    expect(built.arenas['gen:greybox:42']).toStrictEqual(expected.arena);
    expect(layout).toStrictEqual(expected.layout);
    expect(built.kits).toBe(tuning.kits);
    // Every hand-made Arena stays as it was.
    for (const name of Object.keys(tuning.arenas)) expect(built.arenas[name]).toBe(tuning.arenas[name]);
  });

  it('builds the same Arena from the same name every time', () => {
    const a = withGeneratedArena(tuning, 'gen:greybox:7').tuning.arenas['gen:greybox:7'];
    const b = withGeneratedArena(loadTuningData(), 'gen:greybox:7').tuning.arenas['gen:greybox:7'];
    expect(b).toStrictEqual(a);
    expect(hashValue(b)).toBe(hashValue(a));
    expect(withGeneratedArena(tuning, 'gen:greybox:8').tuning.arenas['gen:greybox:8']).not.toEqual({ ...a, name: 'gen:greybox:8' });
  });

  it('gives an Arena parseArena accepts', () => {
    const arena = withGeneratedArena(tuning, 'gen:greybox:3').tuning.arenas['gen:greybox:3'];
    expect(parseArena(JSON.parse(JSON.stringify(arena)), 'gen:greybox:3')).toStrictEqual(arena);
  });

  it('hands any other name back unchanged', () => {
    expect(withGeneratedArena(tuning, 'library')).toStrictEqual({ tuning });
    expect(withGeneratedArena(tuning, 'library').tuning).toBe(tuning);
  });

  it('refuses a bad name with a clear error', () => {
    expect(() => withGeneratedArena(tuning, 'gen:marble:5')).toThrow(/no Kit "marble"/);
    for (const seed of ['1.5', '-3', 'abc', '', '007', '1e3', '99999999999999999999'])
      expect(() => withGeneratedArena(tuning, `gen:greybox:${seed}`), seed).toThrow(/seed .* is not a whole number/);
    expect(() => withGeneratedArena(tuning, 'gen:greybox')).toThrow(/gen:<kit>:<seed>/);
  });
});

describe('parseGeneratedName and isArenaName: checking a name without building it', () => {
  it('reads the Kit and seed of a gen: name, and null for any other', () => {
    expect(parseGeneratedName('gen:greybox:1234')).toEqual({ kit: 'greybox', seed: 1234 });
    expect(parseGeneratedName('library')).toBeNull();
  });

  it('knows the Arenas a Lobby may name: hand-made ones and gen: names of a Kit held', () => {
    expect(isArenaName(tuning, 'library')).toBe(true);
    expect(isArenaName(tuning, 'gen:greybox:5')).toBe(true);
    expect(isArenaName(tuning, 'gen:marble:5')).toBe(false);
    expect(isArenaName(tuning, 'gen:greybox:x')).toBe(false);
    expect(isArenaName(tuning, 'nowhere')).toBe(false);
  });
});

describe('nextArenaSeed / nextArenaName: the Arena of the next Match', () => {
  it('steps a seed by a fixed whole number, within the Random Map range', () => {
    expect(nextArenaSeed(0)).toBe(381_967);
    expect(nextArenaSeed(12)).toBe(381_979);
    expect(nextArenaSeed(700_000)).toBe(81_967);
    // A seed typed in above the range comes back into it.
    expect(nextArenaSeed(5_000_000)).toBe(381_967);
  });

  it('gives the same next seed for the same seed, a whole number in range', () => {
    for (const seed of [0, 1, 4242, 999_999, 123_456_789]) {
      const next = nextArenaSeed(seed);
      expect(nextArenaSeed(seed)).toBe(next);
      expect(Number.isInteger(next) && next >= 0 && next < ARENA_SEED_RANGE).toBe(true);
    }
  });

  it('repeats no seed in a long run of Matches', () => {
    const seen = new Set<number>();
    let seed = 16962;
    for (let i = 0; i < 1000; i++) {
      expect(seen.has(seed)).toBe(false);
      seen.add(seed);
      seed = nextArenaSeed(seed);
    }
  });

  it('moves a Random Map to the next seed, and leaves a hand-made Arena as it is', () => {
    expect(nextArenaName('gen:greybox:12')).toBe('gen:greybox:381979');
    expect(nextArenaName('library')).toBe('library');
  });
});

describe('a Generated Arena built on demand (a Rematch onto the next Random Map)', () => {
  it('arenaOf builds a gen: name Tuning Data does not hold, once, and the copies withGeneratedArena made share it', () => {
    const base = loadTuningData();
    const copy = withGeneratedArena(base, 'gen:greybox:21').tuning;
    const next = arenaOf(copy, 'gen:greybox:22');
    expect(next).toStrictEqual(generateArena(GREYBOX_KIT, 22, DEFAULT_GEN_PARAMS, base).arena);
    expect(arenaOf(copy, 'gen:greybox:22')).toBe(next);
    // The Renderer asks the base for it (with its Layout): the same build.
    expect(withGeneratedArena(base, 'gen:greybox:22').tuning.arenas['gen:greybox:22']).toBe(next);
    expect(arenaOf(base, 'gen:greybox:22')).toBe(next);
  });

  it('builds a name the cache has dropped again: the same Arena', () => {
    const base = loadTuningData();
    const first = arenaOf(base, 'gen:greybox:30');
    for (let seed = 31; seed <= 38; seed++) arenaOf(base, `gen:greybox:${seed}`);
    const again = arenaOf(base, 'gen:greybox:30');
    expect(again).toStrictEqual(first);
    expect(hashValue(again)).toBe(hashValue(first));
  });

  it('still refuses a name it cannot build', () => {
    expect(() => arenaOf(tuning, 'gen:marble:1')).toThrow(/Unknown Arena/);
    expect(() => arenaOf(tuning, 'nowhere')).toThrow(/Unknown Arena/);
  });
});
