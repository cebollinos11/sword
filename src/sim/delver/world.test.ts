import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../../tuning';
import { arenaOf } from '../arena';
import { arenaTuning, floorArenaName, floorOf, parseFloorArena } from './world';

const tuning = loadTuningData();
const SEED = 4242;

describe('Floor arena names', () => {
  it('floorArenaName and parseFloorArena round-trip', () => {
    for (const [seed, floor] of [[SEED, 1], [0, 9], [4_294_967_295, 12]] as const) {
      const name = floorArenaName(seed, floor);
      expect(name).toBe(`battle:delver${floor}s${seed}`);
      expect(parseFloorArena(name)).toEqual({ seed, floor });
    }
  });

  it('parseFloorArena is null for any other name', () => {
    for (const name of ['battle:1', 'battle:fort', 'gen:greybox:1', 'arena', 'battle:delver0s1', 'battle:delver1', 'delver1s1']) expect(parseFloorArena(name)).toBeNull();
  });
});

describe('arenaTuning and floorOf', { timeout: 60_000 }, () => {
  const name = floorArenaName(SEED, 1);

  it('is the same Tuning Data object for a name that is not a Floor', () => {
    expect(arenaTuning(tuning, 'arena')).toBe(tuning);
    expect(arenaTuning(tuning, 'battle:1')).toBe(tuning);
    expect(floorOf(tuning, 'gen:greybox:1')).toBeNull();
  });

  it('gives a Floor its own Tuning Data, one object while kept, the base untouched', () => {
    const before = tuning.battle;
    const t = arenaTuning(tuning, name);
    expect(t).not.toBe(tuning);
    expect(arenaTuning(tuning, name)).toBe(t);
    expect(t.battle.crowd.flowCell).toBe(tuning.delver.flowCell);
    expect(Object.keys(t.battle.maps)).toEqual([`delver1s${SEED}`]);
    expect(tuning.battle).toBe(before);
    expect(tuning.battle.crowd.flowCell).not.toBe(tuning.delver.flowCell);
    expect(Object.keys(tuning.battle.maps)).not.toContain(`delver1s${SEED}`);
    expect(arenaOf(t, name)).toBe(floorOf(tuning, name)!.field.arena);
  });

  it('a copy maps back to its base: it shares the builds and returns itself for its own name', () => {
    const copy = arenaTuning(tuning, name);
    expect(arenaTuning(copy, name)).toBe(copy);
    expect(floorOf(copy, name)).toBe(floorOf(tuning, name));
    const other = floorArenaName(SEED, 2);
    expect(arenaTuning(copy, other)).toBe(arenaTuning(tuning, other));
    expect(floorOf(copy, other)).toBe(floorOf(tuning, other));
  });
});
