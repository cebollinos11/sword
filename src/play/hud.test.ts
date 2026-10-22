import { describe, expect, it } from 'vitest';
import { floorBanner, runTime } from './hud';

describe('the Run’s HUD text', () => {
  it('names the Floor, the Run’s length and the Run seed, and the boss on the last Floor', () => {
    expect(floorBanner(3, 7, 4242)).toBe('Floor 3 / 7 · seed 4242');
    expect(floorBanner(7, 7, 4242)).toBe('Boss · Floor 7 / 7 · seed 4242');
  });

  it('gives the Run time as m:ss', () => {
    expect(runTime(0)).toBe('0:00');
    expect(runTime(65.9)).toBe('1:05');
    expect(runTime(754)).toBe('12:34');
  });
});
