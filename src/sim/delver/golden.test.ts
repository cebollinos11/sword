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
  { seed: 1, floor: 1, hash: '782d0689', plan: 'a60bda59', attempts: 1 },
  { seed: 1, floor: 9, hash: 'a6bc473c', plan: 'b7ed1574', attempts: 1 },
  { seed: 7, floor: 1, hash: '097acc8d', plan: '5d673a2c', attempts: 1 },
  { seed: 7, floor: 9, hash: '5e7b9eb5', plan: '2ec47849', attempts: 1 },
  { seed: 123456789, floor: 1, hash: 'f8b88ef5', plan: 'd8cf14cb', attempts: 1 },
  { seed: 123456789, floor: 9, hash: '0ee8578e', plan: '14e11d8b', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '81db2e39', plan: '16a567eb', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: '39a62be6', plan: 'b556e6a8', attempts: 1 },
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
