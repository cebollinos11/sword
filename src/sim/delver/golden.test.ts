import { describe, expect, it } from 'vitest';
import { mapFileText } from '../../mapEditor/compile';
import { loadTuningData } from '../../tuning';
import { hashValue } from '../hash';
import { delverFloor } from './index';

/**
 * Golden Floors: the same (seed, Floor) builds the same map file bytes, passes the judge, and hashes to the pinned value after the pinned
 * number of attempts. The plan is pinned beside the map: it carries the markers, kinds, main path, in-line Halls and patrols the later
 * Stages read, which the compiled map does not. A pin of either that moves means `DELVER_VERSION` + 1 and new pins.
 */
const tuning = loadTuningData();

const PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: 'e1b1b7b1', plan: '139b0ca7', attempts: 1 },
  { seed: 1, floor: 9, hash: '2bd7db72', plan: '155ed3c9', attempts: 1 },
  { seed: 7, floor: 1, hash: '1477b32b', plan: 'fa1a9173', attempts: 1 },
  { seed: 7, floor: 9, hash: '7c68ba61', plan: '70134dfd', attempts: 1 },
  { seed: 123456789, floor: 1, hash: 'fa8f54b9', plan: '8df7fd83', attempts: 1 },
  { seed: 123456789, floor: 9, hash: 'f135ec9a', plan: 'd5a2ea83', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '3e1d6005', plan: '7ec65a70', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: '88b4e34c', plan: '9d897fe9', attempts: 1 },
];

describe('golden Delver Floors', () => {
  for (const { seed, floor, hash, plan, attempts } of PINS) {
    it(`seed ${seed}, Floor ${floor}: same bytes twice, passes the judge, map hash ${hash} and plan hash ${plan} after ${attempts} attempt(s)`, () => {
      const a = delverFloor(tuning, seed, floor);
      const b = delverFloor(tuning, seed, floor);
      expect(mapFileText(a.map)).toBe(mapFileText(b.map));
      expect(a.judgement).toEqual({ ok: true, reasons: [] });
      expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
      expect({ hash: hashValue(mapFileText(a.map)), plan: hashValue(JSON.stringify(a.plan)), attempts: a.attempts }).toEqual({ hash, plan, attempts });
    });
  }
});
