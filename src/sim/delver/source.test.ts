import { describe, expect, it } from 'vitest';
import { floorName, isFloorName } from './source';

describe('isFloorName', () => {
  it('is true for the names floorName makes', () => {
    for (const [seed, floor] of [[0, 1], [1, 9], [4294967295, 3], [123456, 12]] as const) expect(isFloorName(floorName(seed, floor))).toBe(true);
  });

  it('is false for other names', () => {
    for (const name of ['delverspike', 'delver0s1', 'delver1', 'fort', '', 'delver1s', 'xdelver1s1', 'delver1s1x']) expect(isFloorName(name)).toBe(false);
  });
});
