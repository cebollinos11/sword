import { describe, expect, it } from 'vitest';
import { mapFileText } from '../../mapEditor/compile';
import { loadTuningData } from '../../tuning';
import { hashValue } from '../hash';
import { flatFloors, flatRooms } from './flat.testdata';
import { delverFloor } from './index';

/**
 * Golden Floors: the same (seed, Floor) builds the same map file bytes, passes the judge, and hashes to the pinned value after the pinned
 * number of attempts. The plan is pinned beside the map: it carries the markers, kinds, main path, in-line Halls and patrols the later
 * Stages read, which the compiled map does not. A pin of either that moves means `DELVER_VERSION` + 1 and new pins.
 */
const tuning = loadTuningData();

/** The default Tuning's Floors (7a's bigger Halls, great halls and turning Passages; `DELVER_VERSION` 6). */
const PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: '7df78d73', plan: '11fbcb24', attempts: 1 },
  { seed: 1, floor: 3, hash: 'f210fd08', plan: '60584a4d', attempts: 1 },
  { seed: 1, floor: 9, hash: '58e32628', plan: '76b8b8e9', attempts: 1 },
  { seed: 7, floor: 1, hash: '0a9af48a', plan: 'bfcb2956', attempts: 1 },
  { seed: 7, floor: 3, hash: 'c79b0278', plan: '4f346578', attempts: 1 },
  { seed: 7, floor: 9, hash: '63377c42', plan: 'f41f4954', attempts: 1 },
  { seed: 123456789, floor: 1, hash: '1276f117', plan: 'f6c49f50', attempts: 1 },
  { seed: 123456789, floor: 3, hash: 'b5ea0e9f', plan: '07e54c9e', attempts: 1 },
  { seed: 123456789, floor: 9, hash: 'c5071ac1', plan: '7ab09e2d', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: 'a124cab9', plan: 'a7a54ed0', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '090b24f5', plan: '6848f404', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: '9e25d4c3', plan: '1861b414', attempts: 1 },
];

/**
 * `flatRooms(tuning)` (Stage 6's lattice, no turning Passages, no great halls) on the same seeds and Floors: the map hashes are Stage 6's default pins
 * exactly (a Floor with every 7a knob off is byte for byte what it was), on the first attempt; the plan hashes are new, since the plan gained its fields.
 */
const ROOMS_PINS: readonly { seed: number; floor: number; hash: string; plan: string }[] = [
  { seed: 1, floor: 1, hash: '4b55b26e', plan: 'e9f29789' },
  { seed: 1, floor: 3, hash: 'b64b7391', plan: '7266888f' },
  { seed: 1, floor: 9, hash: '094f6914', plan: '6cd74a9d' },
  { seed: 7, floor: 1, hash: 'b4859c66', plan: '3ab2d718' },
  { seed: 7, floor: 3, hash: '2123c3b1', plan: '2e5859ec' },
  { seed: 7, floor: 9, hash: 'bd7f124c', plan: '25715ad1' },
  { seed: 123456789, floor: 1, hash: 'c51da678', plan: '8dc880f9' },
  { seed: 123456789, floor: 3, hash: '0846dc38', plan: 'dc7675b7' },
  { seed: 123456789, floor: 9, hash: 'aced9fc1', plan: '265c5bc5' },
  { seed: 4294967295, floor: 1, hash: '27c6a8d9', plan: '9dfcbdcd' },
  { seed: 4294967295, floor: 3, hash: '00fe0b5e', plan: 'cc1aad31' },
  { seed: 4294967295, floor: 9, hash: 'ab53f03d', plan: '7f408021' },
];

/**
 * The same seeds and Floors on `flatFloors(flatRooms(tuning))` (no levels, no galleries): the map hashes are Stage 5's pins exactly (a flat Floor is byte
 * for byte what it was); the plan hashes are new, since the plan gained its height fields.
 */
const FLAT_PINS: readonly { seed: number; floor: number; hash: string; plan: string }[] = [
  { seed: 1, floor: 1, hash: '782d0689', plan: 'cc9e7f95' },
  { seed: 1, floor: 3, hash: '39b46f5a', plan: '7b653187' },
  { seed: 1, floor: 9, hash: 'ea7a8c5e', plan: 'bed5c264' },
  { seed: 7, floor: 1, hash: '097acc8d', plan: 'c185d888' },
  { seed: 7, floor: 3, hash: 'f0b9a9a5', plan: 'e534ca9f' },
  { seed: 7, floor: 9, hash: '06121599', plan: '9817c5ae' },
  { seed: 123456789, floor: 1, hash: 'f8b88ef5', plan: 'e83b0a16' },
  { seed: 123456789, floor: 3, hash: '0b038ea0', plan: 'c2e6101b' },
  { seed: 123456789, floor: 9, hash: '4afc2270', plan: '72c3fbb0' },
  { seed: 4294967295, floor: 1, hash: '81db2e39', plan: '84ce9798' },
  { seed: 4294967295, floor: 3, hash: 'a47e9d77', plan: 'd56192d0' },
  { seed: 4294967295, floor: 9, hash: '549cc7ee', plan: 'f73917ae' },
];

/** Floor 9's pins from before Boss Halls (DELVER_VERSION 2), on a flat Floor: a Floor with no Boss must still come out byte for byte as it was. */
const OLD_FLOOR_9: readonly { seed: number; hash: string; plan: string }[] = [
  { seed: 1, hash: 'a6bc473c', plan: '805af611' },
  { seed: 7, hash: '5e7b9eb5', plan: '5fefcb76' },
  { seed: 123456789, hash: '0ee8578e', plan: '34819d35' },
  { seed: 4294967295, hash: '39a62be6', plan: '8811493c' },
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
      // A Boss Floor's Boss Hall is a great hall.
      if (floor % 3 === 0) expect(a.plan.halls[a.plan.stairs]!.great).toBe(true);
      // Levels: at least `levels.min` of them, and a gallery asks for shortcut jump Links.
      expect(new Set(a.plan.halls.map((h) => h.level)).size).toBeGreaterThanOrEqual(tuning.delver.floor.levels.min);
      expect(a.map.shortcuts === true).toBe(a.plan.halls.some((h) => h.gallery));
    });
  }

  const rooms = flatRooms(tuning);
  for (const { seed, floor, hash, plan } of ROOMS_PINS) {
    it(`flatRooms Tuning, seed ${seed}, Floor ${floor}: Stage 6's map hash ${hash} exactly, plan hash ${plan} on the first attempt`, () => {
      const a = delverFloor(rooms, seed, floor);
      expect(a.judgement).toEqual({ ok: true, reasons: [] });
      expect({ hash: hashValue(mapFileText(a.map)), plan: hashValue(JSON.stringify(a.plan)), attempts: a.attempts }).toEqual({ hash, plan, attempts: 1 });
      expect(a.plan.halls.some((h) => h.great || h.cells.length > 1)).toBe(false);
      expect(a.plan.passages.every((p) => p.shape === 'straight')).toBe(true);
    });
  }

  const flat = flatFloors(flatRooms(tuning));
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
