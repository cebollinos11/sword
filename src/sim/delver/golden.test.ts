import { describe, expect, it } from 'vitest';
import { mapFileText } from '../../mapEditor/compile';
import { loadTuningData } from '../../tuning';
import { hashValue } from '../hash';
import { flatFloors, flatHalls, flatRooms, fullFloors, noLava, noRooms, noSetPieces, plainHalls } from './flat.testdata';
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
 *
 * `DELVER_VERSION` 16 (Stage 7g, drawn rooms): every pin runs on `noRooms(shipped)` (no drawn room is picked), so its hash is 7f's, unchanged, and committing a room file
 * moves no pin. The rooms' own pins use the fixture room (`rooms.testdata.ts`).
 *
 * `DELVER_VERSION` 17 (2026-11-26, the user's call): no Ramp has rails (a gallery's, a feature's step, a Passage's sloped leg, a drawn room's), so a Ramp's long sides are
 * open. `DelverStep.rails` is gone. Every map hash of a Floor with a Ramp moved (re-pinned on purpose), and a plan hash moved wherever the plan holds a feature step; no attempt
 * count moved and every Floor still passes the judge. Where a comment above says a set of pins equals an earlier Stage's, it did so before this change.
 */
const tuning = noRooms(loadTuningData());

/**
 * `flatHalls(tuning)` (the 7c knobs off) on the same seeds and Floors: 7b's default pins exactly (the map hashes, the plan hashes and the attempts: a Floor with every 7c knob off is byte
 * for byte what 7b dealt, shaped Halls and pillars and all). The byte-identity proof of Stage 7c.
 */
const FLAT_HALLS_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: 'de3db98b', plan: '4dad09f4', attempts: 1 },
  { seed: 1, floor: 3, hash: '25650d98', plan: 'b5bcf9b5', attempts: 1 },
  { seed: 1, floor: 9, hash: 'e4a03c6b', plan: '34fadf79', attempts: 1 },
  { seed: 7, floor: 1, hash: 'b4b0fe4c', plan: '41025a88', attempts: 1 },
  { seed: 7, floor: 3, hash: 'dd300ee6', plan: 'ef89640f', attempts: 1 },
  { seed: 7, floor: 9, hash: 'a051ccea', plan: '85da9cd7', attempts: 1 },
  { seed: 123456789, floor: 1, hash: '95e951e3', plan: 'd2e0e6f0', attempts: 1 },
  { seed: 123456789, floor: 3, hash: 'd1561a77', plan: 'db39d4c3', attempts: 1 },
  { seed: 123456789, floor: 9, hash: '515e0cd2', plan: '0cac5927', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '0efe3aef', plan: '158e8863', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '0cc8627f', plan: '9a9671b3', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: 'c0d43110', plan: '180c62d0', attempts: 1 },
];


/**
 * `fullFloors(tuning)` (every Floor 20 Halls, issue #135's `tierRooms` off): Stage 7c's default pins exactly (`DELVER_VERSION` 8), so a full-length
 * Floor is byte for byte what it was. Floor 9 is the default Tuning's own (its tier is full length); the shorter tiers are pinned in `TIER_PINS`.
 */
const PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: 'e8e04ba6', plan: 'fd9c8409', attempts: 1 },
  { seed: 1, floor: 3, hash: 'b0c09cad', plan: '009bb1bb', attempts: 1 },
  { seed: 1, floor: 9, hash: '9649dbff', plan: 'd77a9c2e', attempts: 1 },
  { seed: 7, floor: 1, hash: 'ecc3839e', plan: 'd53ef83f', attempts: 1 },
  { seed: 7, floor: 3, hash: 'b913e811', plan: 'a2cb0626', attempts: 1 },
  { seed: 7, floor: 9, hash: '32a72961', plan: '60f6c9c3', attempts: 1 },
  { seed: 123456789, floor: 1, hash: 'c850334a', plan: 'e047f65d', attempts: 1 },
  { seed: 123456789, floor: 3, hash: 'a4669af0', plan: '5dd008b9', attempts: 1 },
  { seed: 123456789, floor: 9, hash: '3218b1db', plan: 'a4f5f224', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: 'd4e49163', plan: '570181ee', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: 'd827bb6f', plan: 'ea1c0a74', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: 'd4e1e9c2', plan: 'c5568e46', attempts: 1 },
];

/** The default Tuning's shorter Floors (issue #135, `DELVER_VERSION` 9): tier 1's 7 Halls (Floors 1 and 3) and tier 2's 10 (Floors 4 and 6). */
const TIER_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: '0e78487c', plan: 'd3043749', attempts: 1 },
  { seed: 1, floor: 3, hash: 'c703486d', plan: '80901c81', attempts: 1 },
  { seed: 1, floor: 4, hash: '5d8fac8c', plan: 'afae4fb3', attempts: 1 },
  { seed: 1, floor: 6, hash: '9ea744a7', plan: '70010db0', attempts: 1 },
  { seed: 7, floor: 1, hash: '2932f6bc', plan: '3b6513e5', attempts: 2 },
  { seed: 7, floor: 3, hash: 'ecae8db7', plan: 'e4da3803', attempts: 2 },
  { seed: 7, floor: 4, hash: '424b6c02', plan: 'cb6aae88', attempts: 1 },
  { seed: 7, floor: 6, hash: 'c9c056db', plan: '9daf20c1', attempts: 1 },
  { seed: 123456789, floor: 1, hash: '12617f58', plan: '5b7ace8a', attempts: 1 },
  { seed: 123456789, floor: 3, hash: '7daaa004', plan: '6f3dc52f', attempts: 1 },
  { seed: 123456789, floor: 4, hash: 'b4ef6c5c', plan: '53268319', attempts: 1 },
  { seed: 123456789, floor: 6, hash: '3e2b1610', plan: '2b9c474a', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '5695f2b2', plan: 'bd7be8ed', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '3451a5d4', plan: '2168fa5f', attempts: 1 },
  { seed: 4294967295, floor: 4, hash: '03e3893f', plan: '39c8b953', attempts: 1 },
  { seed: 4294967295, floor: 6, hash: '1d4a97dc', plan: '0769c273', attempts: 1 },
];

/**
 * `noSetPieces(fullFloors(tuning))` (Stage 7f's set pieces off) on the same seeds and Floors as `PINS`: its map hashes, plan hashes and attempts are Stage 7d's `PINS` exactly, so a
 * Floor with no set piece is byte for byte what 7d dealt (no new plan field, no Brush). The byte-identity proof of Stage 7f.
 */
const NO_SET_PIECE_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: '50f22a1f', plan: 'da3e8937', attempts: 1 },
  { seed: 1, floor: 3, hash: 'e593d991', plan: 'f263e536', attempts: 1 },
  { seed: 1, floor: 9, hash: '56cf095c', plan: '91dacebb', attempts: 1 },
  { seed: 7, floor: 1, hash: '29e60bd6', plan: 'dd1b7cce', attempts: 1 },
  { seed: 7, floor: 3, hash: '3688be4e', plan: '5d69e504', attempts: 1 },
  { seed: 7, floor: 9, hash: '8e0d2f6c', plan: 'd07a66eb', attempts: 1 },
  { seed: 123456789, floor: 1, hash: 'b1e338da', plan: '4cc2c821', attempts: 1 },
  { seed: 123456789, floor: 3, hash: '85748f66', plan: '6a31f575', attempts: 1 },
  { seed: 123456789, floor: 9, hash: '449864b8', plan: '332adb0c', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '25d75047', plan: 'bc423489', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '52845a72', plan: '75eae6b7', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: 'a48ada05', plan: 'a80c94cb', attempts: 1 },
];

/** `noSetPieces(tuning)` (the default Tuning's tiers) on `TIER_PINS`' seeds and Floors: Stage 7d's `TIER_PINS` exactly. */
const NO_SET_PIECE_TIER_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: '3dfd02f7', plan: 'ff91735f', attempts: 1 },
  { seed: 1, floor: 3, hash: 'acfdf95f', plan: '8d97463a', attempts: 1 },
  { seed: 1, floor: 4, hash: '8fbd8e36', plan: '7f898289', attempts: 1 },
  { seed: 1, floor: 6, hash: '180e8ef5', plan: '8a932e75', attempts: 1 },
  { seed: 7, floor: 1, hash: '9615764a', plan: 'e36f4fac', attempts: 1 },
  { seed: 7, floor: 3, hash: 'dc87575c', plan: '2566b278', attempts: 2 },
  { seed: 7, floor: 4, hash: 'da2f93e7', plan: '5a168d33', attempts: 1 },
  { seed: 7, floor: 6, hash: '578e6b6b', plan: 'cb128267', attempts: 1 },
  { seed: 123456789, floor: 1, hash: '4c485bad', plan: 'b8581355', attempts: 1 },
  { seed: 123456789, floor: 3, hash: 'dcde116d', plan: '8ca76eaf', attempts: 1 },
  { seed: 123456789, floor: 4, hash: 'b567bd3e', plan: '8ef504e4', attempts: 1 },
  { seed: 123456789, floor: 6, hash: '227ac7ce', plan: '51fa41e4', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: 'eaad2242', plan: '58984549', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '6c31fb1f', plan: '133f4051', attempts: 1 },
  { seed: 4294967295, floor: 4, hash: '06dcd1e8', plan: '305577b3', attempts: 1 },
  { seed: 4294967295, floor: 6, hash: 'fb2c0f09', plan: '51f2f852', attempts: 1 },
];

/**
 * `noLava(fullFloors(tuning))` (Stage 7d's lava off) on the same seeds and Floors as `PINS`: its map hashes, plan hashes and attempts are `PINS`' exactly, so a Floor with every
 * 7d knob off is byte for byte what 7c dealt (no `lava` field, no Brush). The byte-identity proof of Stage 7d, Task 1.
 */
const NO_LAVA_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: '5ca7a2d2', plan: 'd316b02c', attempts: 1 },
  { seed: 1, floor: 3, hash: '023955fb', plan: 'c464606e', attempts: 1 },
  { seed: 1, floor: 9, hash: '945f3317', plan: '6b3581c4', attempts: 1 },
  { seed: 7, floor: 1, hash: '29e60bd6', plan: 'dd1b7cce', attempts: 1 },
  { seed: 7, floor: 3, hash: '3688be4e', plan: '5d69e504', attempts: 1 },
  { seed: 7, floor: 9, hash: '6c6b6acb', plan: 'ec19a40d', attempts: 1 },
  { seed: 123456789, floor: 1, hash: 'b1e338da', plan: '4cc2c821', attempts: 1 },
  { seed: 123456789, floor: 3, hash: 'ca9b3b2f', plan: 'b76a5b99', attempts: 1 },
  { seed: 123456789, floor: 9, hash: 'a23a225b', plan: '4cf5ca3e', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '25d75047', plan: 'bc423489', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '3c2eb5ef', plan: 'eef3b6b9', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: '2733a6a2', plan: '75fc106a', attempts: 1 },
];

/** `noLava(tuning)` (the default Tuning's tiers) on `TIER_PINS`' seeds and Floors: `TIER_PINS`' values exactly. */
const NO_LAVA_TIER_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: '3dfd02f7', plan: 'ff91735f', attempts: 1 },
  { seed: 1, floor: 3, hash: 'c4f12e3b', plan: 'b186e198', attempts: 1 },
  { seed: 1, floor: 4, hash: 'c1fe9659', plan: '566de454', attempts: 1 },
  { seed: 1, floor: 6, hash: '180e8ef5', plan: '8a932e75', attempts: 1 },
  { seed: 7, floor: 1, hash: '9615764a', plan: 'e36f4fac', attempts: 1 },
  { seed: 7, floor: 3, hash: 'dc87575c', plan: '2566b278', attempts: 2 },
  { seed: 7, floor: 4, hash: 'f8867c72', plan: '4bd94046', attempts: 1 },
  { seed: 7, floor: 6, hash: '256acd36', plan: 'fce744cf', attempts: 1 },
  { seed: 123456789, floor: 1, hash: '4c485bad', plan: 'b8581355', attempts: 1 },
  { seed: 123456789, floor: 3, hash: '21e183b2', plan: 'ab45e12f', attempts: 1 },
  { seed: 123456789, floor: 4, hash: 'f07d0b4b', plan: '40c9d3f9', attempts: 1 },
  { seed: 123456789, floor: 6, hash: '227ac7ce', plan: '51fa41e4', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: 'e542b825', plan: '6f316bb7', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '6c31fb1f', plan: '133f4051', attempts: 1 },
  { seed: 4294967295, floor: 4, hash: '2a263540', plan: 'ea03351b', attempts: 1 },
  { seed: 4294967295, floor: 6, hash: '2d6ab23a', plan: 'f32638bb', attempts: 1 },
];

/**
 * `plainHalls(tuning)` (7a's Floors: every Hall a rect) on the same seeds and Floors: the map hashes are 7a's default pins exactly (shapes and pillars off is byte for
 * byte what it was), on the first attempt; the plan hashes are new, since the plan gained its fields.
 */
const PLAIN_PINS: readonly { seed: number; floor: number; hash: string; plan: string; attempts: number }[] = [
  { seed: 1, floor: 1, hash: 'bf836b63', plan: '84d5729b', attempts: 1 },
  { seed: 1, floor: 3, hash: '3f76624f', plan: '5cc71a3f', attempts: 1 },
  { seed: 1, floor: 9, hash: '1a2eba74', plan: '48d03504', attempts: 1 },
  { seed: 7, floor: 1, hash: 'ca2e9715', plan: '77d15adc', attempts: 1 },
  { seed: 7, floor: 3, hash: '00d18893', plan: '954cafbf', attempts: 1 },
  { seed: 7, floor: 9, hash: '05ad59c9', plan: '48e55cc3', attempts: 1 },
  { seed: 123456789, floor: 1, hash: '17195c4d', plan: '214c9d76', attempts: 1 },
  { seed: 123456789, floor: 3, hash: '75352e2a', plan: '9cd1a79d', attempts: 1 },
  { seed: 123456789, floor: 9, hash: '927f502b', plan: '431273a1', attempts: 1 },
  { seed: 4294967295, floor: 1, hash: '895b2fb4', plan: '3b3bbb6e', attempts: 1 },
  { seed: 4294967295, floor: 3, hash: '911bddc3', plan: '22a5537e', attempts: 1 },
  { seed: 4294967295, floor: 9, hash: '4466fe9b', plan: 'c5268372', attempts: 1 },
];

/**
 * `flatRooms(tuning)` (Stage 6's lattice, no turning Passages, no great halls) on the same seeds and Floors: the map hashes are Stage 6's default pins
 * exactly (a Floor with every 7a knob off is byte for byte what it was), on the first attempt; the plan hashes are new, since the plan gained its fields (and again with Stage 7b's Hall shapes).
 */
const ROOMS_PINS: readonly { seed: number; floor: number; hash: string; plan: string }[] = [
  { seed: 1, floor: 1, hash: '7d1d2359', plan: '010eaef2' },
  { seed: 1, floor: 3, hash: '518da0b1', plan: '20092659' },
  { seed: 1, floor: 9, hash: '12464225', plan: '0785b534' },
  { seed: 7, floor: 1, hash: '60dc7194', plan: '5a7c0dc3' },
  { seed: 7, floor: 3, hash: '9cb3a10b', plan: '8fc6ecc8' },
  { seed: 7, floor: 9, hash: 'b1e2cb76', plan: '627802dd' },
  { seed: 123456789, floor: 1, hash: 'ab52752a', plan: '7bd2a37a' },
  { seed: 123456789, floor: 3, hash: '3dc02965', plan: '08fa9f6a' },
  { seed: 123456789, floor: 9, hash: '857cdbf9', plan: '53392bae' },
  { seed: 4294967295, floor: 1, hash: 'b8c4f677', plan: '55d794e1' },
  { seed: 4294967295, floor: 3, hash: 'dba49c48', plan: '9d31c8d6' },
  { seed: 4294967295, floor: 9, hash: 'ad898cce', plan: 'c1764d13' },
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
