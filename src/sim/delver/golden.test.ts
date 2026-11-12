import { describe, expect, it } from 'vitest';
import { mapFileText } from '../../mapEditor/compile';
import { loadTuningData } from '../../tuning';
import { hashValue } from '../hash';
import { delverFloor } from './index';

/**
 * Golden Floors: the same (seed, Floor) builds the same map file bytes, passes the judge, and hashes to the pinned value after the pinned
 * number of attempts. A pin that moves means the plan, the source, the judge or the reroll changed: `DELVER_VERSION` + 1 and new pins.
 */
const tuning = loadTuningData();

const PINS: readonly { seed: number; floor: number; hash: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: 'e1b1b7b1', attempts: 1 },
  { seed: 1, floor: 9, hash: '2bd7db72', attempts: 1 },
  { seed: 7, floor: 1, hash: '1477b32b', attempts: 1 },
  { seed: 7, floor: 9, hash: '7c68ba61', attempts: 1 },
  { seed: 123456789, floor: 1, hash: 'fa8f54b9', attempts: 1 },
  { seed: 123456789, floor: 9, hash: 'f135ec9a', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '3e1d6005', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: '88b4e34c', attempts: 1 },
];

describe('golden Delver Floors', () => {
  for (const { seed, floor, hash, attempts } of PINS) {
    it(`seed ${seed}, Floor ${floor}: same bytes twice, passes the judge, hash ${hash} after ${attempts} attempt(s)`, () => {
      const a = delverFloor(tuning, seed, floor);
      const b = delverFloor(tuning, seed, floor);
      expect(mapFileText(a.map)).toBe(mapFileText(b.map));
      expect(a.judgement).toEqual({ ok: true, reasons: [] });
      expect({ hash: hashValue(mapFileText(a.map)), attempts: a.attempts }).toEqual({ hash, attempts });
    });
  }
});
