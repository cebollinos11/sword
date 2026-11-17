import { describe, expect, it } from 'vitest';
import { mapFileText } from '../../mapEditor/compile';
import { loadTuningData } from '../../tuning';
import { hashValue } from '../hash';
import { flatFloors, flatHalls, flatRooms, fullFloors, plainHalls } from './flat.testdata';
import { delverFloor } from './index';

/**
 * Golden Floors: the same (seed, Floor) builds the same map file bytes, passes the judge, and hashes to the pinned value after the pinned
 * number of attempts. The plan is pinned beside the map: it carries the markers, kinds, main path, in-line Halls and patrols the later
 * Stages read, which the compiled map does not. A pin of either that moves means `DELVER_VERSION` + 1 and new pins.
 *
 * `DELVER_VERSION` 12 (issue #157): the compiler stands no Wall up to an Enclosure's roof along a Ramp inside it (a Gallery's), so every
 * map hash below moved and no plan hash or attempt count did. Where a comment says a set of pins equals an earlier Stage's, it did so
 * before that change.
 */
const tuning = loadTuningData();

/**
 * `flatHalls(tuning)` (the 7c knobs off) on the same seeds and Floors: 7b's default pins exactly (the map hashes, the plan hashes and the attempts: a Floor with every 7c knob off is byte
 * for byte what 7b dealt, shaped Halls and pillars and all). The byte-identity proof of Stage 7c.
 */
const FLAT_HALLS_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: '98847f14', plan: '001c55f6', attempts: 1 },
  { seed: 1, floor: 3, hash: '00bede15', plan: '244147aa', attempts: 1 },
  { seed: 1, floor: 9, hash: '3a08263f', plan: '230935be', attempts: 1 },
  { seed: 7, floor: 1, hash: '58073f19', plan: 'b712c258', attempts: 1 },
  { seed: 7, floor: 3, hash: '571eb334', plan: 'ebbe7931', attempts: 1 },
  { seed: 7, floor: 9, hash: '211eb761', plan: 'a190cc6c', attempts: 1 },
  { seed: 123456789, floor: 1, hash: '8fb4cc38', plan: '45477de5', attempts: 1 },
  { seed: 123456789, floor: 3, hash: '65fc835b', plan: '6d362586', attempts: 1 },
  { seed: 123456789, floor: 9, hash: 'ddaa7d64', plan: 'd67c0554', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '7fa81224', plan: 'd5295342', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '73ae5511', plan: '0f7b4856', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: 'bb07120c', plan: '20a8532c', attempts: 1 },
];


/**
 * `fullFloors(tuning)` (every Floor 20 Halls, issue #135's `tierRooms` off): Stage 7c's default pins exactly (`DELVER_VERSION` 8), so a full-length
 * Floor is byte for byte what it was. Floor 9 is the default Tuning's own (its tier is full length); the shorter tiers are pinned in `TIER_PINS`.
 */
const PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: 'b9df3fed', plan: 'f22f0e37', attempts: 1 },
  { seed: 1, floor: 3, hash: 'ace072ac', plan: '50dd4e74', attempts: 1 },
  { seed: 1, floor: 9, hash: 'd5e818ca', plan: '578018d0', attempts: 1 },
  { seed: 7, floor: 1, hash: '5a831d37', plan: '3d8f7150', attempts: 1 },
  { seed: 7, floor: 3, hash: '3143be9a', plan: '574470b1', attempts: 1 },
  { seed: 7, floor: 9, hash: 'a4b7e670', plan: 'e4cf1445', attempts: 1 },
  { seed: 123456789, floor: 1, hash: '98613406', plan: 'e413d36a', attempts: 1 },
  { seed: 123456789, floor: 3, hash: '7fb2844f', plan: '0d7827b2', attempts: 1 },
  { seed: 123456789, floor: 9, hash: '17c0d56f', plan: 'ae2e5f1a', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: 'ddd92e43', plan: '3a8093a2', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '48f86832', plan: '4f63fac9', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: '457578ab', plan: '218b7ec6', attempts: 1 },
];

/** The default Tuning's shorter Floors (issue #135, `DELVER_VERSION` 9): tier 1's 7 Halls (Floors 1 and 3) and tier 2's 10 (Floors 4 and 6). */
const TIER_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: 'eec2c124', plan: 'b6a5ecd3', attempts: 1 },
  { seed: 1, floor: 3, hash: '28404b80', plan: 'a0ab94f9', attempts: 1 },
  { seed: 1, floor: 4, hash: 'a1886dcf', plan: '891a1ef5', attempts: 1 },
  { seed: 1, floor: 6, hash: '8e783c78', plan: 'c4f030cb', attempts: 1 },
  { seed: 7, floor: 1, hash: 'aa06bca9', plan: '00b8a0c0', attempts: 1 },
  { seed: 7, floor: 3, hash: '3501f29b', plan: '237eea16', attempts: 2 },
  { seed: 7, floor: 4, hash: '48c75282', plan: 'b1d0d7fa', attempts: 1 },
  { seed: 7, floor: 6, hash: 'b3f94a7a', plan: '186555fa', attempts: 1 },
  { seed: 123456789, floor: 1, hash: '37926dcd', plan: '108dc545', attempts: 1 },
  { seed: 123456789, floor: 3, hash: '95d58ee9', plan: '410bae72', attempts: 1 },
  { seed: 123456789, floor: 4, hash: 'b0c6cecb', plan: '257d05e7', attempts: 1 },
  { seed: 123456789, floor: 6, hash: 'f03bd4e4', plan: '08d220b8', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '4457b460', plan: '86e0b88d', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '683ebeda', plan: '6531fb8b', attempts: 1 },
  { seed: 4294967295, floor: 4, hash: '04f7d22a', plan: '8d290682', attempts: 1 },
  { seed: 4294967295, floor: 6, hash: 'a04a50a5', plan: '6022c21d', attempts: 1 },
];

/**
 * `plainHalls(tuning)` (7a's Floors: every Hall a rect) on the same seeds and Floors: the map hashes are 7a's default pins exactly (shapes and pillars off is byte for
 * byte what it was), on the first attempt; the plan hashes are new, since the plan gained its fields.
 */
const PLAIN_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: 'd7235d42', plan: '455a2dc1', attempts: 1 },
  { seed: 1, floor: 3, hash: 'd52ca7d4', plan: '550ba04a', attempts: 1 },
  { seed: 1, floor: 9, hash: 'ec9a8982', plan: '6aaab58d', attempts: 1 },
  { seed: 7, floor: 1, hash: '1156b2ea', plan: '1154cd54', attempts: 1 },
  { seed: 7, floor: 3, hash: '2414f485', plan: '2cb2bc31', attempts: 1 },
  { seed: 7, floor: 9, hash: 'ffa5059e', plan: 'b108bd8a', attempts: 1 },
  { seed: 123456789, floor: 1, hash: '081ee6a4', plan: '2458a137', attempts: 1 },
  { seed: 123456789, floor: 3, hash: 'bff4f4e6', plan: '164af432', attempts: 1 },
  { seed: 123456789, floor: 9, hash: '8035e7e5', plan: 'ad04a886', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '97df3033', plan: '4b3ee815', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '51a9208f', plan: '3b208803', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: 'b03f4281', plan: '44b9069e', attempts: 1 },
];

/**
 * `flatRooms(tuning)` (Stage 6's lattice, no turning Passages, no great halls) on the same seeds and Floors: the map hashes are Stage 6's default pins
 * exactly (a Floor with every 7a knob off is byte for byte what it was), on the first attempt; the plan hashes are new, since the plan gained its fields (and again with Stage 7b's Hall shapes).
 */
const ROOMS_PINS: readonly { seed: number; floor: number; hash: string; plan: string }[] = [
  { seed: 1, floor: 1, hash: '06ad2938', plan: '52ef38cc' },
  { seed: 1, floor: 3, hash: '039293c7', plan: '9f88eb9f' },
  { seed: 1, floor: 9, hash: 'f39ce4fd', plan: 'c8c1d280' },
  { seed: 7, floor: 1, hash: 'ef747924', plan: '23f39bd0' },
  { seed: 7, floor: 3, hash: '29bbd241', plan: '4f882386' },
  { seed: 7, floor: 9, hash: 'ee796f53', plan: '5ec1ff05' },
  { seed: 123456789, floor: 1, hash: '640864ce', plan: 'cba459cb' },
  { seed: 123456789, floor: 3, hash: '215d10a7', plan: '253ff092' },
  { seed: 123456789, floor: 9, hash: '462a3b8b', plan: 'e2107d30' },
  { seed: 4294967295, floor: 1, hash: '5869b01a', plan: '9d5bb955' },
  { seed: 4294967295, floor: 3, hash: 'a06440e1', plan: '240e6055' },
  { seed: 4294967295, floor: 9, hash: 'fd5aa886', plan: 'e95d9d05' },
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

/** Per default pin: has the Floor a split, a pit, a dais, a wrapped gallery, a shaped Hall, a pillared Hall (recorded, not forced). */
const HOLDS: Record<string, { split: boolean; pit: boolean; dais: boolean; wrapped: boolean; shaped: boolean; pillared: boolean }> = {
  '1/1': { split: true, pit: true, dais: false, wrapped: true, shaped: true, pillared: true },
  '1/3': { split: true, pit: false, dais: true, wrapped: true, shaped: true, pillared: false },
  '1/9': { split: true, pit: true, dais: false, wrapped: true, shaped: true, pillared: true },
  '7/1': { split: false, pit: true, dais: true, wrapped: true, shaped: true, pillared: true },
  '7/3': { split: true, pit: false, dais: true, wrapped: true, shaped: true, pillared: false },
  '7/9': { split: true, pit: true, dais: true, wrapped: true, shaped: false, pillared: false },
  '123456789/1': { split: true, pit: false, dais: false, wrapped: true, shaped: true, pillared: false },
  '123456789/3': { split: true, pit: true, dais: true, wrapped: true, shaped: false, pillared: true },
  '123456789/9': { split: true, pit: true, dais: false, wrapped: true, shaped: true, pillared: false },
  '4294967295/1': { split: true, pit: true, dais: true, wrapped: true, shaped: true, pillared: false },
  '4294967295/3': { split: true, pit: true, dais: true, wrapped: true, shaped: true, pillared: false },
  '4294967295/9': { split: true, pit: false, dais: true, wrapped: true, shaped: true, pillared: false },
};

describe('golden Delver Floors', () => {
  const full = fullFloors(tuning);
  for (const { seed, floor, hash, plan, attempts } of PINS) {
    it(`fullFloors Tuning, seed ${seed}, Floor ${floor}: same bytes twice, passes the judge, map hash ${hash} and plan hash ${plan} after ${attempts} attempt(s)`, () => {
      const a = delverFloor(full, seed, floor);
      const b = delverFloor(full, seed, floor);
      if (floor === 9) expect(mapFileText(delverFloor(tuning, seed, floor).map)).toBe(mapFileText(a.map));
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
      expect(a.map.shortcuts === true).toBe(a.plan.halls.some((h) => h.gallery || h.feature));
      // What holds of the pinned Floor (recorded, not forced): whether it has a split, a pit, a dais, a wrapped gallery, a shaped Hall (solids) and a pillared one.
      expect({
        split: a.plan.halls.some((h) => h.feature?.kind === 'split'),
        pit: a.plan.halls.some((h) => h.feature?.kind === 'pit'),
        dais: a.plan.halls.some((h) => h.feature?.kind === 'dais'),
        wrapped: a.plan.halls.some((h) => h.gallery?.wrap),
        shaped: a.plan.halls.some((h) => h.solids.length > 0),
        pillared: a.plan.halls.some((h) => h.pillars.length > 0),
      }).toEqual(HOLDS[`${seed}/${floor}`]);
    });
  }

  for (const { seed, floor, hash, plan, attempts } of TIER_PINS) {
    it(`seed ${seed}, Floor ${floor}: ${tuning.delver.tierRooms![Math.ceil(floor / 3) - 1]} Halls, same bytes twice, passes the judge, map hash ${hash} and plan hash ${plan} after ${attempts} attempt(s)`, () => {
      const a = delverFloor(tuning, seed, floor);
      expect(mapFileText(delverFloor(tuning, seed, floor).map)).toBe(mapFileText(a.map));
      expect(a.judgement).toEqual({ ok: true, reasons: [] });
      expect(a.plan.halls.length).toBe(tuning.delver.tierRooms![Math.ceil(floor / 3) - 1]);
      expect(a.plan.halls[a.plan.stairs]!.kind).toBe(floor % 3 === 0 ? 'Boss' : 'Stairs');
      expect({ hash: hashValue(mapFileText(a.map)), plan: hashValue(JSON.stringify(a.plan)), attempts: a.attempts }).toEqual({ hash, plan, attempts });
    });
  }

  const flatHallsTuning = flatHalls(tuning);
  for (const { seed, floor, hash, plan, attempts } of FLAT_HALLS_PINS) {
    it(`flatHalls Tuning, seed ${seed}, Floor ${floor}: 7b's map hash ${hash} and plan hash ${plan} exactly, after ${attempts} attempt(s)`, () => {
      const a = delverFloor(flatHallsTuning, seed, floor);
      expect(a.judgement).toEqual({ ok: true, reasons: [] });
      expect({ hash: hashValue(mapFileText(a.map)), plan: hashValue(JSON.stringify(a.plan)), attempts: a.attempts }).toEqual({ hash, plan, attempts });
      expect(a.plan.halls.some((h) => h.feature || h.gallery?.wrap)).toBe(false);
    });
  }

  const plainTuning = plainHalls(tuning);
  for (const { seed, floor, hash, plan, attempts } of PLAIN_PINS) {
    it(`plainHalls Tuning, seed ${seed}, Floor ${floor}: 7a's map hash ${hash} exactly, plan hash ${plan} after ${attempts} attempt(s)`, () => {
      const a = delverFloor(plainTuning, seed, floor);
      expect(a.judgement).toEqual({ ok: true, reasons: [] });
      expect({ hash: hashValue(mapFileText(a.map)), plan: hashValue(JSON.stringify(a.plan)), attempts: a.attempts }).toEqual({ hash, plan, attempts });
      expect(a.plan.halls.every((h) => h.solids.length === 0 && h.pillars.length === 0)).toBe(true);
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
