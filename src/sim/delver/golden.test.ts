import { describe, expect, it } from 'vitest';
import { mapFileText } from '../../mapEditor/compile';
import { loadTuningData } from '../../tuning';
import { hashValue } from '../hash';
import { flatFloors, flatHalls, flatRooms, fullFloors, noLava, noSetPieces, plainHalls } from './flat.testdata';
import { setPieceOf } from './plan';
import { delverFloor } from './index';

/**
 * Golden Floors: the same (seed, Floor) builds the same map file bytes, passes the judge, and hashes to the pinned value after the pinned
 * number of attempts. The plan is pinned beside the map: it carries the markers, kinds, main path, in-line Halls and patrols the later
 * Stages read, which the compiled map does not. A pin of either that moves means `DELVER_VERSION` + 1 and new pins.
 *
 * `DELVER_VERSION` 12 (issue #157): the compiler stands no Wall up to an Enclosure's roof along a Ramp inside it (a Gallery's), so every
 * map hash below moved and no plan hash or attempt count did. Where a comment says a set of pins equals an earlier Stage's, it did so
 * before that change.
 *
 * `DELVER_VERSION` 13 (issue #163): a Hall's roof is 6 m over its floor (was 4) and a gallery Hall's 8 m (was 6), so a full Jump has room;
 * a Passage's stays 4 m. Every map and plan hash below moved, and no attempt count did: the earlier "byte for byte" claims held before it.
 *
 * `DELVER_VERSION` 14 (Stage 7d, lava): the bundled Tuning ships lava on (`delver.floor.lava.percent` [20, 55, 70]) and the judge gained its `lava` and `lavaWalk` rules. A Floor with a lava Hall has a new
 * plan and map; a Floor with none keeps today's bytes (the pick is the only change to a plan, the Brushes the only change to a map), so only the Floors below that hold lava (`HOLDS`) have new
 * `PINS` and `TIER_PINS`, and no attempt count moved. `NO_LAVA_PINS` and `NO_LAVA_TIER_PINS` are the old pins on `noLava`, unchanged.
 *
 * `DELVER_VERSION` 15 (Stage 7f, set pieces): the bundled Tuning ships set pieces on (`delver.floor.setPieces.percent` [60, 60, 50]) and the judge gained its `setPieces` and
 * `setPieceWalk` rules. A Hall rolled for a set piece takes no other feature even when the set piece then does not fit, so every Floor below has new `PINS` and `TIER_PINS`, whether
 * or not it holds a set piece (`HOLDS`). Seed 7's tier-1 Floor 1 now takes 2 attempts (its first lays every Hall on one level: the `levels` rule). `NO_SET_PIECE_PINS` and
 * `NO_SET_PIECE_TIER_PINS` are 7d's pins on `noSetPieces`, unchanged, and `noLava` (which turns set pieces off too) keeps 7c's.
 */
const tuning = loadTuningData();

/**
 * `flatHalls(tuning)` (the 7c knobs off) on the same seeds and Floors: 7b's default pins exactly (the map hashes, the plan hashes and the attempts: a Floor with every 7c knob off is byte
 * for byte what 7b dealt, shaped Halls and pillars and all). The byte-identity proof of Stage 7c.
 */
const FLAT_HALLS_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: 'fc60f4ae', plan: '4dad09f4', attempts: 1 },
  { seed: 1, floor: 3, hash: '4b8cc803', plan: 'b5bcf9b5', attempts: 1 },
  { seed: 1, floor: 9, hash: '104eed1b', plan: '34fadf79', attempts: 1 },
  { seed: 7, floor: 1, hash: '6ebce621', plan: '41025a88', attempts: 1 },
  { seed: 7, floor: 3, hash: '86522574', plan: 'ef89640f', attempts: 1 },
  { seed: 7, floor: 9, hash: '4f19b3fe', plan: '85da9cd7', attempts: 1 },
  { seed: 123456789, floor: 1, hash: 'a6af8e82', plan: 'd2e0e6f0', attempts: 1 },
  { seed: 123456789, floor: 3, hash: 'e9250f85', plan: 'db39d4c3', attempts: 1 },
  { seed: 123456789, floor: 9, hash: '983dda67', plan: '0cac5927', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '3af1dba5', plan: '158e8863', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '0cf014de', plan: '9a9671b3', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: '58007a7e', plan: '180c62d0', attempts: 1 },
];


/**
 * `fullFloors(tuning)` (every Floor 20 Halls, issue #135's `tierRooms` off): Stage 7c's default pins exactly (`DELVER_VERSION` 8), so a full-length
 * Floor is byte for byte what it was. Floor 9 is the default Tuning's own (its tier is full length); the shorter tiers are pinned in `TIER_PINS`.
 */
const PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: 'c48e1007', plan: '503b72ad', attempts: 1 },
  { seed: 1, floor: 3, hash: '58b1d1b9', plan: 'd451f24c', attempts: 1 },
  { seed: 1, floor: 9, hash: '64a63934', plan: '8ee6541e', attempts: 1 },
  { seed: 7, floor: 1, hash: 'efa14ed2', plan: 'e17dfdf7', attempts: 1 },
  { seed: 7, floor: 3, hash: '16277202', plan: '3d9a2ba7', attempts: 1 },
  { seed: 7, floor: 9, hash: '67e8c6b5', plan: '2f5b2569', attempts: 1 },
  { seed: 123456789, floor: 1, hash: 'a9a2d2db', plan: '80ab15b8', attempts: 1 },
  { seed: 123456789, floor: 3, hash: 'b9ca25a4', plan: '5c7fda40', attempts: 1 },
  { seed: 123456789, floor: 9, hash: '61fbd1cc', plan: '5c0600eb', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: 'f2924a17', plan: 'b8f733f5', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: 'e1926448', plan: 'd254460c', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: '499721cb', plan: 'ce0129ae', attempts: 1 },
];

/** The default Tuning's shorter Floors (issue #135, `DELVER_VERSION` 9): tier 1's 7 Halls (Floors 1 and 3) and tier 2's 10 (Floors 4 and 6). */
const TIER_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: '7c0116b6', plan: 'd3043749', attempts: 1 },
  { seed: 1, floor: 3, hash: '3c7754d9', plan: 'd24cc853', attempts: 1 },
  { seed: 1, floor: 4, hash: '1b69910a', plan: 'afae4fb3', attempts: 1 },
  { seed: 1, floor: 6, hash: 'bb0e6b6b', plan: '1be4dbfb', attempts: 1 },
  { seed: 7, floor: 1, hash: '252b87a6', plan: 'a032a91b', attempts: 2 },
  { seed: 7, floor: 3, hash: '22b2ee17', plan: 'e4da3803', attempts: 2 },
  { seed: 7, floor: 4, hash: '4cedeec7', plan: '3c2f645e', attempts: 1 },
  { seed: 7, floor: 6, hash: 'c398a05f', plan: '9daf20c1', attempts: 1 },
  { seed: 123456789, floor: 1, hash: 'ea4d8c28', plan: '5b7ace8a', attempts: 1 },
  { seed: 123456789, floor: 3, hash: '3198bf49', plan: '5bbbbc86', attempts: 1 },
  { seed: 123456789, floor: 4, hash: '1991fca1', plan: '03426049', attempts: 1 },
  { seed: 123456789, floor: 6, hash: 'c0e2f84d', plan: '074f31c7', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: 'a2b7f38b', plan: 'd5f24209', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '39df6c11', plan: '4441c4d9', attempts: 1 },
  { seed: 4294967295, floor: 4, hash: '4ec377e6', plan: 'cfa9a25e', attempts: 1 },
  { seed: 4294967295, floor: 6, hash: 'ecaa7529', plan: 'ad50bcf9', attempts: 1 },
];

/**
 * `noSetPieces(fullFloors(tuning))` (Stage 7f's set pieces off) on the same seeds and Floors as `PINS`: its map hashes, plan hashes and attempts are Stage 7d's `PINS` exactly, so a
 * Floor with no set piece is byte for byte what 7d dealt (no new plan field, no Brush). The byte-identity proof of Stage 7f.
 */
const NO_SET_PIECE_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: '0e07e8be', plan: '7f78371a', attempts: 1 },
  { seed: 1, floor: 3, hash: '130cb2f4', plan: 'a0f115d4', attempts: 1 },
  { seed: 1, floor: 9, hash: 'be91efc2', plan: '46e1c726', attempts: 1 },
  { seed: 7, floor: 1, hash: '135bdf8d', plan: '788b8e85', attempts: 1 },
  { seed: 7, floor: 3, hash: 'db669ddd', plan: '926000ad', attempts: 1 },
  { seed: 7, floor: 9, hash: 'cbd18615', plan: '487fbbee', attempts: 1 },
  { seed: 123456789, floor: 1, hash: 'a3c15235', plan: 'bb120eb9', attempts: 1 },
  { seed: 123456789, floor: 3, hash: '13bac101', plan: '4988e84a', attempts: 1 },
  { seed: 123456789, floor: 9, hash: '04467a1b', plan: 'c237a324', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: 'a7c56cc6', plan: '3ed46d37', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: 'ef61b589', plan: 'b3227f95', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: 'a88fbb1a', plan: 'fc0c4cff', attempts: 1 },
];

/** `noSetPieces(tuning)` (the default Tuning's tiers) on `TIER_PINS`' seeds and Floors: Stage 7d's `TIER_PINS` exactly. */
const NO_SET_PIECE_TIER_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: '9f1682ed', plan: 'ff91735f', attempts: 1 },
  { seed: 1, floor: 3, hash: 'ad8f5be0', plan: '783d69db', attempts: 1 },
  { seed: 1, floor: 4, hash: '7865e16d', plan: '29ba5db1', attempts: 1 },
  { seed: 1, floor: 6, hash: '71f24ab7', plan: '8868856b', attempts: 1 },
  { seed: 7, floor: 1, hash: 'ad32184c', plan: 'db815292', attempts: 1 },
  { seed: 7, floor: 3, hash: '7d6b1205', plan: '2566b278', attempts: 2 },
  { seed: 7, floor: 4, hash: 'a06d32f8', plan: 'bbd149e3', attempts: 1 },
  { seed: 7, floor: 6, hash: '09d01bcb', plan: 'd1a83768', attempts: 1 },
  { seed: 123456789, floor: 1, hash: '6d4006bb', plan: '216c5c76', attempts: 1 },
  { seed: 123456789, floor: 3, hash: 'bea765c9', plan: '8b89821b', attempts: 1 },
  { seed: 123456789, floor: 4, hash: 'a7a3a285', plan: '98186abc', attempts: 1 },
  { seed: 123456789, floor: 6, hash: '3777f36b', plan: 'd4fe55d0', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '82b6d129', plan: '6d345e65', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: 'ca5acdff', plan: '2d825023', attempts: 1 },
  { seed: 4294967295, floor: 4, hash: '67a0636a', plan: '9c6fe974', attempts: 1 },
  { seed: 4294967295, floor: 6, hash: 'f4954294', plan: '4c8ace82', attempts: 1 },
];

/**
 * `noLava(fullFloors(tuning))` (Stage 7d's lava off) on the same seeds and Floors as `PINS`: its map hashes, plan hashes and attempts are `PINS`' exactly, so a Floor with every
 * 7d knob off is byte for byte what 7c dealt (no `lava` field, no Brush). The byte-identity proof of Stage 7d, Task 1.
 */
const NO_LAVA_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: 'e4c03085', plan: 'ac6bbfb9', attempts: 1 },
  { seed: 1, floor: 3, hash: 'fe2cce8a', plan: '551e09f0', attempts: 1 },
  { seed: 1, floor: 9, hash: '5351dcb9', plan: '00e03d9d', attempts: 1 },
  { seed: 7, floor: 1, hash: '135bdf8d', plan: '788b8e85', attempts: 1 },
  { seed: 7, floor: 3, hash: 'db669ddd', plan: '926000ad', attempts: 1 },
  { seed: 7, floor: 9, hash: 'b28d21d0', plan: 'a615b4a6', attempts: 1 },
  { seed: 123456789, floor: 1, hash: 'a3c15235', plan: 'bb120eb9', attempts: 1 },
  { seed: 123456789, floor: 3, hash: '13c3dec6', plan: '87c55526', attempts: 1 },
  { seed: 123456789, floor: 9, hash: 'e266e878', plan: 'b133164e', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: 'a7c56cc6', plan: '3ed46d37', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: 'a9bc9474', plan: 'c4233cab', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: 'c06b5d7d', plan: '3b046796', attempts: 1 },
];

/** `noLava(tuning)` (the default Tuning's tiers) on `TIER_PINS`' seeds and Floors: `TIER_PINS`' values exactly. */
const NO_LAVA_TIER_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: '9f1682ed', plan: 'ff91735f', attempts: 1 },
  { seed: 1, floor: 3, hash: '40b3574a', plan: '40d614e5', attempts: 1 },
  { seed: 1, floor: 4, hash: '48aa7f48', plan: '4e94305c', attempts: 1 },
  { seed: 1, floor: 6, hash: '71f24ab7', plan: '8868856b', attempts: 1 },
  { seed: 7, floor: 1, hash: 'ad32184c', plan: 'db815292', attempts: 1 },
  { seed: 7, floor: 3, hash: '7d6b1205', plan: '2566b278', attempts: 2 },
  { seed: 7, floor: 4, hash: 'f533e3f7', plan: '30e6a25e', attempts: 1 },
  { seed: 7, floor: 6, hash: '090add16', plan: 'b832c7c6', attempts: 1 },
  { seed: 123456789, floor: 1, hash: '6d4006bb', plan: '216c5c76', attempts: 1 },
  { seed: 123456789, floor: 3, hash: '6b69627e', plan: '720d77c3', attempts: 1 },
  { seed: 123456789, floor: 4, hash: '945db25e', plan: '0ca39271', attempts: 1 },
  { seed: 123456789, floor: 6, hash: '3777f36b', plan: 'd4fe55d0', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '093ad97a', plan: '85cb8f13', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: 'ca5acdff', plan: '2d825023', attempts: 1 },
  { seed: 4294967295, floor: 4, hash: '707fe4ea', plan: '69604c3e', attempts: 1 },
  { seed: 4294967295, floor: 6, hash: 'eb31c493', plan: 'b9808843', attempts: 1 },
];

/**
 * `plainHalls(tuning)` (7a's Floors: every Hall a rect) on the same seeds and Floors: the map hashes are 7a's default pins exactly (shapes and pillars off is byte for
 * byte what it was), on the first attempt; the plan hashes are new, since the plan gained its fields.
 */
const PLAIN_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: '23cb4cce', plan: '84d5729b', attempts: 1 },
  { seed: 1, floor: 3, hash: '401df4e4', plan: '5cc71a3f', attempts: 1 },
  { seed: 1, floor: 9, hash: 'd67e8880', plan: '48d03504', attempts: 1 },
  { seed: 7, floor: 1, hash: '35f27c9e', plan: '77d15adc', attempts: 1 },
  { seed: 7, floor: 3, hash: '781cb669', plan: '954cafbf', attempts: 1 },
  { seed: 7, floor: 9, hash: 'ee8b51e9', plan: '48e55cc3', attempts: 1 },
  { seed: 123456789, floor: 1, hash: '5b28a630', plan: '214c9d76', attempts: 1 },
  { seed: 123456789, floor: 3, hash: '1aa44a04', plan: '9cd1a79d', attempts: 1 },
  { seed: 123456789, floor: 9, hash: 'bc01d3b8', plan: '431273a1', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: 'f6a549ea', plan: '3b3bbb6e', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: 'd0f4e602', plan: '22a5537e', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: '44aa41c5', plan: 'c5268372', attempts: 1 },
];

/**
 * `flatRooms(tuning)` (Stage 6's lattice, no turning Passages, no great halls) on the same seeds and Floors: the map hashes are Stage 6's default pins
 * exactly (a Floor with every 7a knob off is byte for byte what it was), on the first attempt; the plan hashes are new, since the plan gained its fields (and again with Stage 7b's Hall shapes).
 */
const ROOMS_PINS: readonly { seed: number; floor: number; hash: string; plan: string }[] = [
  { seed: 1, floor: 1, hash: 'b1d4d1dc', plan: '010eaef2' },
  { seed: 1, floor: 3, hash: '26a2b7de', plan: '20092659' },
  { seed: 1, floor: 9, hash: '80ab2837', plan: '0785b534' },
  { seed: 7, floor: 1, hash: 'd1faed88', plan: '5a7c0dc3' },
  { seed: 7, floor: 3, hash: '07e0bd32', plan: '8fc6ecc8' },
  { seed: 7, floor: 9, hash: '3b06d1d0', plan: '627802dd' },
  { seed: 123456789, floor: 1, hash: '24a975be', plan: '7bd2a37a' },
  { seed: 123456789, floor: 3, hash: 'd2167bed', plan: '08fa9f6a' },
  { seed: 123456789, floor: 9, hash: 'b3d8f20e', plan: '53392bae' },
  { seed: 4294967295, floor: 1, hash: '13905dec', plan: '55d794e1' },
  { seed: 4294967295, floor: 3, hash: '18a1ab4d', plan: '9d31c8d6' },
  { seed: 4294967295, floor: 9, hash: 'f6ce72a8', plan: 'c1764d13' },
];

/**
 * The same seeds and Floors on `flatFloors(flatRooms(tuning))` (no levels, no galleries): the map hashes are Stage 5's pins exactly (a flat Floor is byte
 * for byte what it was); the plan hashes are new, since the plan gained its height fields.
 */
const FLAT_PINS: readonly { seed: number; floor: number; hash: string; plan: string }[] = [
  { seed: 1, floor: 1, hash: '48adaf68', plan: '171c806e' },
  { seed: 1, floor: 3, hash: '5f6a8bbb', plan: 'e50601a5' },
  { seed: 1, floor: 9, hash: '43496d9b', plan: 'd9cfacf5' },
  { seed: 7, floor: 1, hash: 'd29ebe39', plan: 'b9ebf188' },
  { seed: 7, floor: 3, hash: '938bd293', plan: '65fd99a3' },
  { seed: 7, floor: 9, hash: '56f686f4', plan: '5b7d0795' },
  { seed: 123456789, floor: 1, hash: '5d509786', plan: '2ab522be' },
  { seed: 123456789, floor: 3, hash: '51552fbd', plan: '88672291' },
  { seed: 123456789, floor: 9, hash: '9a77db25', plan: '53d9e74f' },
  { seed: 4294967295, floor: 1, hash: 'e46ce3a5', plan: '557a645c' },
  { seed: 4294967295, floor: 3, hash: '257a0dea', plan: 'd51b2add' },
  { seed: 4294967295, floor: 9, hash: '2bf5d5dd', plan: '47785f91' },
];

/** Floor 9's pins from before Boss Halls (DELVER_VERSION 2), on a flat Floor: a Floor with no Boss must still come out byte for byte as it was. */
const OLD_FLOOR_9: readonly { seed: number; hash: string; plan: string }[] = [
  { seed: 1, hash: 'da914e65', plan: '28f493bd' },
  { seed: 7, hash: '78c6eb08', plan: '63fdc509' },
  { seed: 123456789, hash: 'c61ffceb', plan: '3088f076' },
  { seed: 4294967295, hash: '5afd67fd', plan: '2fd2277b' },
];

/** Per default pin: has the Floor a split, a pit, a dais, a wrapped gallery, a shaped Hall, a pillared Hall (recorded, not forced), and the kind of the first Hall (in index order) holding lava, or false for none. */
const HOLDS: Record<string, { split: boolean; pit: boolean; dais: boolean; wrapped: boolean; shaped: boolean; pillared: boolean; lava: false | 'pit' | 'river' | 'trough'; setPiece: false | 'cross' | 'uphill' | 'spiral' }> = {
  '1/1': { split: true, pit: false, dais: true, wrapped: true, shaped: true, pillared: false, lava: 'trough', setPiece: 'cross' },
  '1/3': { split: true, pit: false, dais: true, wrapped: true, shaped: true, pillared: true, lava: 'trough', setPiece: 'spiral' },
  '1/9': { split: true, pit: true, dais: false, wrapped: true, shaped: true, pillared: false, lava: 'trough', setPiece: 'uphill' },
  '7/1': { split: false, pit: true, dais: false, wrapped: true, shaped: true, pillared: true, lava: false, setPiece: false },
  '7/3': { split: true, pit: false, dais: true, wrapped: false, shaped: true, pillared: false, lava: false, setPiece: false },
  '7/9': { split: true, pit: true, dais: true, wrapped: true, shaped: true, pillared: false, lava: false, setPiece: 'spiral' },
  '123456789/1': { split: true, pit: false, dais: false, wrapped: true, shaped: true, pillared: false, lava: false, setPiece: 'cross' },
  '123456789/3': { split: true, pit: true, dais: false, wrapped: false, shaped: true, pillared: true, lava: 'trough', setPiece: 'uphill' },
  '123456789/9': { split: true, pit: true, dais: false, wrapped: false, shaped: true, pillared: true, lava: 'pit', setPiece: 'uphill' },
  '4294967295/1': { split: true, pit: false, dais: true, wrapped: true, shaped: true, pillared: false, lava: false, setPiece: 'uphill' },
  '4294967295/3': { split: true, pit: false, dais: true, wrapped: true, shaped: true, pillared: false, lava: false, setPiece: 'spiral' },
  '4294967295/9': { split: true, pit: true, dais: true, wrapped: true, shaped: true, pillared: true, lava: 'trough', setPiece: false },
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
      // What holds of the pinned Floor (recorded, not forced): whether it has a split, a pit, a dais, a wrapped gallery, a shaped Hall (solids), a pillared one, a 7d lava Hall (the first one's kind) and a set piece (Stage 7f: the first one's kind).
      expect({
        split: a.plan.halls.some((h) => h.feature?.kind === 'split'),
        pit: a.plan.halls.some((h) => h.feature?.kind === 'pit'),
        dais: a.plan.halls.some((h) => h.feature?.kind === 'dais'),
        wrapped: a.plan.halls.some((h) => h.gallery?.wrap),
        shaped: a.plan.halls.some((h) => h.solids.length > 0),
        pillared: a.plan.halls.some((h) => h.pillars.length > 0),
        lava: a.plan.halls.find((h) => h.lava && h.lava.kind !== 'cross')?.lava?.kind ?? false,
        setPiece: a.plan.halls.find((h) => setPieceOf(h)) ? setPieceOf(a.plan.halls.find((h) => setPieceOf(h))!)! : false,
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

  const noSetFull = noSetPieces(full);
  for (const { seed, floor, hash, plan, attempts } of NO_SET_PIECE_PINS) {
    it(`noSetPieces(fullFloors Tuning), seed ${seed}, Floor ${floor}: 7d's map hash ${hash} and plan hash ${plan} after ${attempts} attempt(s), no set piece`, () => {
      const a = delverFloor(noSetFull, seed, floor);
      expect(a.judgement).toEqual({ ok: true, reasons: [] });
      expect({ hash: hashValue(mapFileText(a.map)), plan: hashValue(JSON.stringify(a.plan)), attempts: a.attempts }).toEqual({ hash, plan, attempts });
      expect(a.plan.halls.some((h) => setPieceOf(h))).toBe(false);
    });
  }

  const noSetTier = noSetPieces(tuning);
  for (const { seed, floor, hash, plan, attempts } of NO_SET_PIECE_TIER_PINS) {
    it(`noSetPieces(Tuning), seed ${seed}, Floor ${floor}: 7d's map hash ${hash} and plan hash ${plan} after ${attempts} attempt(s), no set piece`, () => {
      const a = delverFloor(noSetTier, seed, floor);
      expect(a.judgement).toEqual({ ok: true, reasons: [] });
      expect({ hash: hashValue(mapFileText(a.map)), plan: hashValue(JSON.stringify(a.plan)), attempts: a.attempts }).toEqual({ hash, plan, attempts });
    });
  }

  const noLavaFull = noLava(full);
  for (const { seed, floor, hash, plan, attempts } of NO_LAVA_PINS) {
    it(`noLava(fullFloors Tuning), seed ${seed}, Floor ${floor}: today's map hash ${hash} and plan hash ${plan} after ${attempts} attempt(s), no lava`, () => {
      const a = delverFloor(noLavaFull, seed, floor);
      expect(a.judgement).toEqual({ ok: true, reasons: [] });
      expect({ hash: hashValue(mapFileText(a.map)), plan: hashValue(JSON.stringify(a.plan)), attempts: a.attempts }).toEqual({ hash, plan, attempts });
      expect(a.plan.halls.some((h) => 'lava' in h)).toBe(false);
    });
  }

  const noLavaTier = noLava(tuning);
  for (const { seed, floor, hash, plan, attempts } of NO_LAVA_TIER_PINS) {
    it(`noLava(Tuning), seed ${seed}, Floor ${floor}: today's map hash ${hash} and plan hash ${plan} after ${attempts} attempt(s), no lava`, () => {
      const a = delverFloor(noLavaTier, seed, floor);
      expect(a.judgement).toEqual({ ok: true, reasons: [] });
      expect({ hash: hashValue(mapFileText(a.map)), plan: hashValue(JSON.stringify(a.plan)), attempts: a.attempts }).toEqual({ hash, plan, attempts });
      expect(a.plan.halls.some((h) => 'lava' in h)).toBe(false);
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
      expect(a.source.levels).toEqual([-8, 0, 4, 6]);
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
