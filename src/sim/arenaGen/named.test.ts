import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena } from '../../tuning';
import { hashValue } from '../hash';
import { DEFAULT_GEN_PARAMS, generateArena, GREYBOX_KIT, isArenaName, parseGeneratedName, withGeneratedArena } from './index';

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
