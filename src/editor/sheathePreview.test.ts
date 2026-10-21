import { describe, expect, it } from 'vitest';
import { loadTuningData, weaponMotion } from '../tuning';
import { sheathePreview } from './sheathePreview';

const tuning = loadTuningData();
const motion = (name: string, weapon = 'Arming Sword') => weaponMotion(tuning, weapon, name)!;
const blend = tuning.fighter.motionBlend;

describe('the Editor preview of a Sheathe, Draw or Sheathed Idle', () => {
  it('draws the Weapon in its slot after a Sheathe swaps it, and before a Draw does', () => {
    for (const name of ['SheatheHip', 'SheatheBack']) {
      const swap = motion(name).markers.swap!;
      expect(sheathePreview(motion(name), swap - 0.01, tuning).sheathed).toBe(false);
      expect(sheathePreview(motion(name), swap, tuning).sheathed).toBe(true);
    }
    for (const name of ['DrawHip', 'DrawBack']) {
      const swap = motion(name).markers.swap!;
      expect(sheathePreview(motion(name), swap - 0.01, tuning).sheathed).toBe(true);
      expect(sheathePreview(motion(name), swap, tuning).sheathed).toBe(false);
    }
    expect(sheathePreview(motion('SheathedIdle'), 1, tuning)).toEqual({ sheathed: true, offHandFree: 1 });
    expect(sheathePreview(motion('Idle'), 1, tuning)).toEqual({ sheathed: false, offHandFree: 0 });
    expect(sheathePreview(motion('Throw'), 0.2, tuning).sheathed).toBe(false);
  });

  it('lets the off hand go over the Motion Blend as a Sheathe starts, and take hold again as a Draw ends, as in play', () => {
    const sheathe = motion('SheatheBack', 'Longsword');
    expect(sheathePreview(sheathe, 0, tuning).offHandFree).toBe(0);
    expect(sheathePreview(sheathe, blend / 2, tuning).offHandFree).toBeCloseTo(0.5, 9);
    expect(sheathePreview(sheathe, blend, tuning).offHandFree).toBe(1);
    const draw = motion('DrawBack', 'Longsword');
    expect(sheathePreview(draw, 0, tuning).offHandFree).toBe(1);
    expect(sheathePreview(draw, draw.duration - blend / 2, tuning).offHandFree).toBeCloseTo(0.5, 9);
    expect(sheathePreview(draw, draw.duration, tuning).offHandFree).toBe(0);
  });
});
