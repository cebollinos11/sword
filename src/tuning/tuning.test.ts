import { describe, expect, it } from 'vitest';
import { loadTuningData, parseTuningData, TuningDataError } from './index';

describe('Tuning Data', () => {
  it('loads the repo data/ files', () => {
    const t = loadTuningData();
    expect(t.fighter.walkSpeed).toBe(2.5);
    expect(t.arena.radius).toBe(8);
  });

  it('rejects invalid data on load', () => {
    const good = { fighter: { maxHp: 100, walkSpeed: 2, radius: 0.3, height: 1.8 }, arena: { radius: 8 } };
    expect(() => parseTuningData({ ...good, arena: { radius: -1 } })).toThrow(TuningDataError);
    expect(() => parseTuningData({ ...good, fighter: { ...good.fighter, walkSpeed: '2' } })).toThrow(/walkSpeed/);
    expect(() => parseTuningData({ arena: good.arena })).toThrow(/fighter/);
  });
});
