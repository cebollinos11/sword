import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { isArenaName, withGeneratedArena } from '../sim';
import { arenaLabel, mapSeed, randomMap } from './lobbyView';

const tuning = loadTuningData();

describe('the Random Map entry', () => {
  it('names a Generated Arena of the one Kit from the seed the host picked, which every peer can build', () => {
    expect(randomMap(tuning, 1234)).toBe('gen:greybox:1234');
    expect(isArenaName(tuning, randomMap(tuning, 1234))).toBe(true);
    expect(withGeneratedArena(tuning, randomMap(tuning, 5)).layout).toBeDefined();
  });

  it('shows the seed, so a good map can be played again', () => {
    expect(arenaLabel('gen:greybox:1234')).toBe('Random · seed 1234');
    expect(mapSeed('gen:greybox:1234')).toBe(1234);
    expect(mapSeed('library')).toBeNull();
    expect(arenaLabel('library')).toBe('Library');
  });
});
