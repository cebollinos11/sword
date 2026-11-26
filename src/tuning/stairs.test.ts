import { describe, expect, it } from 'vitest';
import { stairCount, stairHeight, type WalkSurface } from './arena';

const ramp: WalkSurface = {
  id: 'r',
  points: [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 2, z: 4 },
    { x: 0, y: 2, z: 4 },
  ],
  stairs: 0.25,
};

describe('stairHeight', () => {
  it('snaps a slope height up to the tread under it, the first one rise over the foot and the last at the head', () => {
    expect(stairCount(0, 2, 0.25)).toBe(8);
    expect(stairHeight(ramp, 0)).toBeCloseTo(0.25, 9);
    expect(stairHeight(ramp, 0.2)).toBeCloseTo(0.25, 9);
    expect(stairHeight(ramp, 0.3)).toBeCloseTo(0.5, 9);
    expect(stairHeight(ramp, 2)).toBeCloseTo(2, 9);
  });
  it('leaves a plain surface alone', () => {
    expect(stairHeight({ ...ramp, stairs: undefined }, 0.3)).toBe(0.3);
  });
});
