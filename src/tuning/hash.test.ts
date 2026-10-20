import { describe, expect, it } from 'vitest';
import { loadTuningData, tuningDataHash, withWeapon, type TuningData } from './index';

const tuning = loadTuningData();

describe('Tuning Data content hash', () => {
  it('is a stable 8-hex digest of the whole Tuning Data set', () => {
    expect(tuningDataHash(tuning)).toMatch(/^[0-9a-f]{8}$/);
    expect(tuningDataHash(loadTuningData())).toBe(tuningDataHash(tuning));
  });

  it('ignores key order (content only)', () => {
    const reordered: TuningData = { motions: tuning.motions, skeleton: tuning.skeleton, hitZones: tuning.hitZones, weapons: tuning.weapons, motionOverrides: tuning.motionOverrides, arena: tuning.arena, arenas: tuning.arenas, kits: tuning.kits, fall: tuning.fall, fighter: tuning.fighter, chamber: tuning.chamber, kick: tuning.kick, dagger: tuning.dagger, ai: tuning.ai, match: tuning.match, block: tuning.block, gait: tuning.gait, camera: tuning.camera };
    expect(tuningDataHash(reordered)).toBe(tuningDataHash(tuning));
  });

  it('changes when any value changes, including inside a Motion', () => {
    const weapon: TuningData = withWeapon(tuning, { damage: tuning.weapons['Arming Sword']!.damage + 1 });
    const idle = tuning.motions.Idle!;
    const motion: TuningData = { ...tuning, motions: { ...tuning.motions, Idle: { ...idle, duration: idle.duration + 0.01 } } };
    const gait: TuningData = { ...tuning, gait: { ...tuning.gait, stepHeight: tuning.gait.stepHeight + 0.01 } };
    const hipBob: TuningData = { ...tuning, gait: { ...tuning.gait, hipBob: tuning.gait.hipBob + 0.01 } };
    const hipSway: TuningData = { ...tuning, gait: { ...tuning.gait, hipSway: tuning.gait.hipSway + 0.01 } };
    const kick: TuningData = { ...tuning, kick: { ...tuning.kick, shoveDamage: tuning.kick.shoveDamage + 1 } };
    expect(tuningDataHash(kick)).not.toBe(tuningDataHash(tuning));
    const dagger: TuningData = { ...tuning, dagger: { ...tuning.dagger, damage: tuning.dagger.damage + 1 } };
    expect(tuningDataHash(dagger)).not.toBe(tuningDataHash(tuning));
    expect(tuningDataHash(weapon)).not.toBe(tuningDataHash(tuning));
    expect(tuningDataHash(motion)).not.toBe(tuningDataHash(tuning));
    expect(tuningDataHash(gait)).not.toBe(tuningDataHash(tuning));
    expect(tuningDataHash(hipBob)).not.toBe(tuningDataHash(tuning));
    expect(tuningDataHash(hipSway)).not.toBe(tuningDataHash(tuning));
  });

  it('ignores the camera (presentation only)', () => {
    const camera: TuningData = { ...tuning, camera: { ...tuning.camera, back: tuning.camera.back + 1 } };
    expect(tuningDataHash(camera)).toBe(tuningDataHash(tuning));
  });
});
