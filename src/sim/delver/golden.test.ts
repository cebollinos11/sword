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
  { seed: 1, floor: 1, hash: '7df78d73', plan: '455a2dc1', attempts: 1 },
  { seed: 1, floor: 3, hash: 'f210fd08', plan: '550ba04a', attempts: 1 },
  { seed: 1, floor: 9, hash: '58e32628', plan: '6aaab58d', attempts: 1 },
  { seed: 7, floor: 1, hash: '0a9af48a', plan: '1154cd54', attempts: 1 },
  { seed: 7, floor: 3, hash: 'c79b0278', plan: '2cb2bc31', attempts: 1 },
  { seed: 7, floor: 9, hash: '63377c42', plan: 'b108bd8a', attempts: 1 },
  { seed: 123456789, floor: 1, hash: '1276f117', plan: '2458a137', attempts: 1 },
  { seed: 123456789, floor: 3, hash: 'b5ea0e9f', plan: '164af432', attempts: 1 },
  { seed: 123456789, floor: 9, hash: 'c5071ac1', plan: 'ad04a886', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: 'a124cab9', plan: '4b3ee815', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '090b24f5', plan: '3b208803', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: '9e25d4c3', plan: '44b9069e', attempts: 1 },
];

/**
 * `flatRooms(tuning)` (Stage 6's lattice, no turning Passages, no great halls) on the same seeds and Floors: the map hashes are Stage 6's default pins
 * exactly (a Floor with every 7a knob off is byte for byte what it was), on the first attempt; the plan hashes are new, since the plan gained its fields (and again with Stage 7b's Hall shapes).
 */
const ROOMS_PINS: readonly { seed: number; floor: number; hash: string; plan: string }[] = [
  { seed: 1, floor: 1, hash: '4b55b26e', plan: '52ef38cc' },
  { seed: 1, floor: 3, hash: 'b64b7391', plan: '9f88eb9f' },
  { seed: 1, floor: 9, hash: '094f6914', plan: 'c8c1d280' },
  { seed: 7, floor: 1, hash: 'b4859c66', plan: '23f39bd0' },
  { seed: 7, floor: 3, hash: '2123c3b1', plan: '4f882386' },
  { seed: 7, floor: 9, hash: 'bd7f124c', plan: '5ec1ff05' },
  { seed: 123456789, floor: 1, hash: 'c51da678', plan: 'cba459cb' },
  { seed: 123456789, floor: 3, hash: '0846dc38', plan: '253ff092' },
  { seed: 123456789, floor: 9, hash: 'aced9fc1', plan: 'e2107d30' },
  { seed: 4294967295, floor: 1, hash: '27c6a8d9', plan: '9d5bb955' },
  { seed: 4294967295, floor: 3, hash: '00fe0b5e', plan: '240e6055' },
  { seed: 4294967295, floor: 9, hash: 'ab53f03d', plan: 'e95d9d05' },
];

/**
 * The same seeds and Floors on `flatFloors(flatRooms(tuning))` (no levels, no galleries): the map hashes are Stage 5's pins exactly (a flat Floor is byte
 * for byte what it was); the plan hashes are new, since the plan gained its height fields.
 */
const FLAT_PINS: readonly { seed: number; floor: number; hash: string; plan: string }[] = [
  { seed: 1, floor: 1, hash: '782d0689', plan: '160b96ca' },
  { seed: 1, floor: 3, hash: '39b46f5a', plan: '2a567301' },
  { seed: 1, floor: 9, hash: 'ea7a8c5e', plan: '9d4eb2b1' },
  { seed: 7, floor: 1, hash: '097acc8d', plan: '6245b668' },
  { seed: 7, floor: 3, hash: 'f0b9a9a5', plan: '1a0c8d8b' },
  { seed: 7, floor: 9, hash: '06121599', plan: '5f53bcc9' },
  { seed: 123456789, floor: 1, hash: 'f8b88ef5', plan: 'dfd11306' },
  { seed: 123456789, floor: 3, hash: '0b038ea0', plan: 'fce7a67d' },
  { seed: 123456789, floor: 9, hash: '4afc2270', plan: 'b224c63b' },
  { seed: 4294967295, floor: 1, hash: '81db2e39', plan: '197fe8f8' },
  { seed: 4294967295, floor: 3, hash: 'a47e9d77', plan: 'd77edd39' },
  { seed: 4294967295, floor: 9, hash: '549cc7ee', plan: '606fbfa9' },
];

/** Floor 9's pins from before Boss Halls (DELVER_VERSION 2), on a flat Floor: a Floor with no Boss must still come out byte for byte as it was. */
const OLD_FLOOR_9: readonly { seed: number; hash: string; plan: string }[] = [
  { seed: 1, hash: 'a6bc473c', plan: '966569c1' },
  { seed: 7, hash: '5e7b9eb5', plan: '234847a1' },
  { seed: 123456789, hash: '0ee8578e', plan: '1e89796a' },
  { seed: 4294967295, hash: '39a62be6', plan: 'e2b6762f' },
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
