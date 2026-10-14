import { describe, expect, it } from 'vitest';
import { loadTuningData, tuningDataHash, type TuningData } from './index';

const tuning = loadTuningData();

describe('Tuning Data content hash', () => {
  it('is a stable 8-hex digest of the whole Tuning Data set', () => {
    expect(tuningDataHash(tuning)).toMatch(/^[0-9a-f]{8}$/);
    expect(tuningDataHash(loadTuningData())).toBe(tuningDataHash(tuning));
  });

  it('ignores key order (content only)', () => {
    const reordered: TuningData = { motions: tuning.motions, skeleton: tuning.skeleton, hitZones: tuning.hitZones, weapon: tuning.weapon, arena: tuning.arena, fighter: tuning.fighter };
    expect(tuningDataHash(reordered)).toBe(tuningDataHash(tuning));
  });

  it('changes when any value changes, including inside a Motion', () => {
    const weapon: TuningData = { ...tuning, weapon: { ...tuning.weapon, damage: tuning.weapon.damage + 1 } };
    const idle = tuning.motions.Idle!;
    const motion: TuningData = { ...tuning, motions: { ...tuning.motions, Idle: { ...idle, duration: idle.duration + 0.01 } } };
    expect(tuningDataHash(weapon)).not.toBe(tuningDataHash(tuning));
    expect(tuningDataHash(motion)).not.toBe(tuningDataHash(tuning));
  });
});
