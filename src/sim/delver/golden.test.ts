import { describe, expect, it } from 'vitest';
import { mapFileText } from '../../mapEditor/compile';
import { loadTuningData } from '../../tuning';
import { hashValue } from '../hash';
import { flatFloors } from './flat.testdata';
import { delverFloor } from './index';

/**
 * Golden Floors: the same (seed, Floor) builds the same map file bytes, passes the judge, and hashes to the pinned value after the pinned
 * number of attempts. The plan is pinned beside the map: it carries the markers, kinds, main path, in-line Halls and patrols the later
 * Stages read, which the compiled map does not. A pin of either that moves means `DELVER_VERSION` + 1 and new pins.
 */
const tuning = loadTuningData();

/** The default Tuning's Floors (levels, galleries and sloped Passages; `DELVER_VERSION` 5). */
const PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: '4b55b26e', plan: '52aa5738', attempts: 1 },
  { seed: 1, floor: 3, hash: 'b64b7391', plan: 'cddba64f', attempts: 1 },
  { seed: 1, floor: 9, hash: '094f6914', plan: 'b5c1dcec', attempts: 1 },
  { seed: 7, floor: 1, hash: 'b4859c66', plan: 'f3a91240', attempts: 1 },
  { seed: 7, floor: 3, hash: '2123c3b1', plan: '011369e4', attempts: 1 },
  { seed: 7, floor: 9, hash: 'bd7f124c', plan: 'f1da56d6', attempts: 1 },
  { seed: 123456789, floor: 1, hash: 'c51da678', plan: '6794cac8', attempts: 1 },
  { seed: 123456789, floor: 3, hash: '0846dc38', plan: '0fdd1119', attempts: 1 },
  { seed: 123456789, floor: 9, hash: 'aced9fc1', plan: 'f20db2fd', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '27c6a8d9', plan: 'f1862b5d', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '00fe0b5e', plan: '41199148', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: 'ab53f03d', plan: 'c9f51cb5', attempts: 1 },
];

/**
 * The same seeds and Floors on `flatFloors(tuning)` (no levels, no galleries): the map hashes are Stage 5's pins exactly (a flat Floor is byte
 * for byte what it was); the plan hashes are new, since the plan gained its height fields.
 */
const FLAT_PINS: readonly { seed: number; floor: number; hash: string; plan: string }[] = [
  { seed: 1, floor: 1, hash: '782d0689', plan: '46ae2de1' },
  { seed: 1, floor: 3, hash: '39b46f5a', plan: 'a91cb8b1' },
  { seed: 1, floor: 9, hash: 'ea7a8c5e', plan: '9a6882df' },
  { seed: 7, floor: 1, hash: '097acc8d', plan: '6f6c5239' },
  { seed: 7, floor: 3, hash: 'f0b9a9a5', plan: '69cff3cf' },
  { seed: 7, floor: 9, hash: '06121599', plan: '15864676' },
  { seed: 123456789, floor: 1, hash: 'f8b88ef5', plan: '2fd1625a' },
  { seed: 123456789, floor: 3, hash: '0b038ea0', plan: 'db43a772' },
  { seed: 123456789, floor: 9, hash: '4afc2270', plan: '47dd5264' },
  { seed: 4294967295, floor: 1, hash: '81db2e39', plan: '88c58958' },
  { seed: 4294967295, floor: 3, hash: 'a47e9d77', plan: '648a4f1e' },
  { seed: 4294967295, floor: 9, hash: '549cc7ee', plan: 'd1b23646' },
];

/** Floor 9's pins from before Boss Halls (DELVER_VERSION 2), on a flat Floor: a Floor with no Boss must still come out byte for byte as it was. */
const OLD_FLOOR_9: readonly { seed: number; hash: string; plan: string }[] = [
  { seed: 1, hash: 'a6bc473c', plan: '4bc3ade8' },
  { seed: 7, hash: '5e7b9eb5', plan: '5d8cf0b0' },
  { seed: 123456789, hash: '0ee8578e', plan: '28f9efbf' },
  { seed: 4294967295, hash: '39a62be6', plan: 'b77e6fd8' },
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
      // Levels: at least `levels.min` of them, and a gallery asks for shortcut jump Links.
      expect(new Set(a.plan.halls.map((h) => h.level)).size).toBeGreaterThanOrEqual(tuning.delver.floor.levels.min);
      expect(a.map.shortcuts === true).toBe(a.plan.halls.some((h) => h.gallery));
    });
  }

  const flat = flatFloors(tuning);
  for (const { seed, floor, hash, plan } of FLAT_PINS) {
    it(`flat Tuning, seed ${seed}, Floor ${floor}: Stage 5's map hash ${hash} exactly, plan hash ${plan} on the first attempt`, () => {
      const a = delverFloor(flat, seed, floor);
      expect(a.judgement).toEqual({ ok: true, reasons: [] });
      expect({ hash: hashValue(mapFileText(a.map)), plan: hashValue(JSON.stringify(a.plan)), attempts: a.attempts }).toEqual({ hash, plan, attempts: 1 });
      expect(a.map.shortcuts).toBeUndefined();
      expect(a.source.levels).toEqual([-8, 0, 4]);
    });
  }

  const noBoss = { ...flat, delver: { ...flat.delver, warbands: flat.delver.warbands.map((t, i) => (i === 2 ? { guard: t.guard, patrol: t.patrol, elite: t.elite } : t)) } };
  for (const { seed, hash, plan } of OLD_FLOOR_9) {
    it(`flat Tuning, seed ${seed}, Floor 9 with tier 3's Boss removed is the old Floor 9 (${hash} / ${plan})`, () => {
      const a = delverFloor(noBoss, seed, 9);
      expect(a.judgement).toEqual({ ok: true, reasons: [] });
      expect({ hash: hashValue(mapFileText(a.map)), plan: hashValue(JSON.stringify(a.plan)), attempts: a.attempts }).toEqual({ hash, plan, attempts: 1 });
    });
  }
});
