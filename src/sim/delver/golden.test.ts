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
  { seed: 1, floor: 3, hash: '39b46f5a', plan: '99eb9be2', attempts: 1 },
  { seed: 1, floor: 9, hash: 'ea7a8c5e', plan: '97741466', attempts: 1 },
  { seed: 7, floor: 1, hash: '097acc8d', plan: '5d673a2c', attempts: 1 },
  { seed: 7, floor: 3, hash: 'f0b9a9a5', plan: '9628e450', attempts: 1 },
  { seed: 7, floor: 9, hash: '06121599', plan: '4b0aaac2', attempts: 1 },
  { seed: 123456789, floor: 1, hash: 'f8b88ef5', plan: 'd8cf14cb', attempts: 1 },
  { seed: 123456789, floor: 3, hash: '0b038ea0', plan: '6796a579', attempts: 1 },
  { seed: 123456789, floor: 9, hash: '4afc2270', plan: 'd9e26c8d', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '81db2e39', plan: '16a567eb', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: 'a47e9d77', plan: '3861aafe', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: '549cc7ee', plan: 'b5c9b787', attempts: 1 },
];

/** Floor 9's pins from before Boss Halls (DELVER_VERSION 2): a Floor with no Boss must still come out byte for byte as they were. */
const OLD_FLOOR_9: readonly { seed: number; hash: string; plan: string }[] = [
  { seed: 1, hash: 'a6bc473c', plan: 'b7ed1574' },
  { seed: 7, hash: '5e7b9eb5', plan: '2ec47849' },
  { seed: 123456789, hash: '0ee8578e', plan: '14e11d8b' },
  { seed: 4294967295, hash: '39a62be6', plan: 'b556e6a8' },
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
      // The Boss Floors (3 and 9 under the bundled Tuning) have a Boss Hall as their Stairs Hall; the others keep their Stairs.
      expect(a.plan.halls[a.plan.stairs]!.kind).toBe(floor % 3 === 0 ? 'Boss' : 'Stairs');
      expect('boss' in a.plan.markers).toBe(floor % 3 === 0);
    });
  }

  const noBoss = { ...tuning, delver: { ...tuning.delver, warbands: tuning.delver.warbands.map((t, i) => (i === 2 ? { guard: t.guard, patrol: t.patrol, elite: t.elite } : t)) } };
  for (const { seed, hash, plan } of OLD_FLOOR_9) {
    it(`seed ${seed}, Floor 9 with tier 3's Boss removed is the old Floor 9 (${hash} / ${plan})`, () => {
      const a = delverFloor(noBoss, seed, 9);
      expect(a.judgement).toEqual({ ok: true, reasons: [] });
      expect({ hash: hashValue(mapFileText(a.map)), plan: hashValue(JSON.stringify(a.plan)), attempts: a.attempts }).toEqual({ hash, plan, attempts: 1 });
    });
  }
});
