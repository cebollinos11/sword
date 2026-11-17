/**
 * A Delver Floor's Troops (docs/plans/delver.md, Stage 4; docs/plans/delver-troops.md): every Variant of every Prefab of `delver.troops`
 * in order, then each non-Boss Variant again for each distinct elite Relic set (wearing that set too). Pure and derived, cached per `delver`
 * object, never state. A Floor's Battle Tuning carries this list as its `troops` (`delverBattle`), so a Floor's Crowd indexes its Troops in
 * it; the Battles' own `battle.troops` are never a Floor's. Which Prefabs a Floor fields is `floorPrefabs`.
 */
import { clampSize, eliteRelicSets, fieldedIn, MAX_SIZE, MIN_SIZE, type DelverTuning, type Size, type TroopTuning } from '../../tuning';
import type { DelverFloorTuning, DelverPrefab, DelverVariant } from '../../tuning/delver';
import { runPick } from '../dungeon';

/** The `runPick` salt of a Floor's Prefab order (apart from the Floor generator's and the Warbands'). */
const PREFAB_SALT = 40;

export interface FloorTroops {
  /** Every Variant (Prefab by Prefab), then the elite Variants (set by set, Prefab by Prefab). */
  readonly troops: readonly TroopTuning[];
  /** [prefab][variant]: that Variant's Troop. */
  readonly plain: readonly (readonly number[])[];
  /** [elite set][prefab][variant]: that Variant's Troop wearing the set's Relics too, or -1 for a Boss Variant. */
  readonly elite: readonly (readonly (readonly number[])[])[];
  /** [tier][elite template]: its Relic set (an index into `elite`). */
  readonly eliteSet: readonly (readonly number[])[];
  /** Per tier: its Boss Troop's index, or -1 when the tier has no Boss. */
  readonly boss: readonly number[];
}

/** The tier (1 to `tiers`) of Floor `floor`. */
export function tierOf(delver: DelverTuning, floor: number): number {
  return Math.min(delver.tiers, Math.max(1, Math.ceil(floor / delver.floorsPerTier)));
}

const floorCache = new WeakMap<DelverTuning, DelverFloorTuning[]>();

/**
 * The Floor generator's tuning for Floor `floor`: `delver.floor` with `rooms` the Floor's tier's `delver.tierRooms` (issue #135: a Run's first
 * tier's Floors a third as long as a full one, the second's half, the last full). Without `tierRooms` it is `delver.floor` itself. Cached per
 * (delver, tier), so the same Floor gets the same object.
 */
export function floorTuningOf(delver: DelverTuning, floor: number): DelverFloorTuning {
  const rooms = delver.tierRooms;
  if (!rooms) return delver.floor;
  const tier = tierOf(delver, floor);
  let list = floorCache.get(delver);
  if (!list) floorCache.set(delver, (list = []));
  return (list[tier - 1] ??= rooms[tier - 1] === delver.floor.rooms ? delver.floor : { ...delver.floor, rooms: rooms[tier - 1]! });
}

/** Whether Floor `floor` is a Boss Floor: the last of its tier, and its tier has a Boss. */
export function isBossFloor(delver: DelverTuning, floor: number): boolean {
  return floor % delver.floorsPerTier === 0 && delver.warbands[tierOf(delver, floor) - 1]?.boss !== undefined;
}

const cache = new WeakMap<DelverTuning, FloorTroops>();

function build(delver: DelverTuning): FloorTroops {
  const troops: TroopTuning[] = [];
  const troopOf = (p: DelverPrefab, prefab: number, v: DelverVariant, relics: readonly string[], elite: boolean): TroopTuning => {
    const tint = delver.skillTints[v.difficulty];
    return {
      name: elite ? `${v.name} (elite)` : v.name,
      weight: 1,
      bodies: [p.body],
      weapon: p.weapon,
      difficulty: v.difficulty,
      style: v.style,
      relics,
      hp: v.hp,
      damage: v.damage,
      hitChance: v.hitChance,
      engageReach: v.engageReach,
      mods: v.mods,
      prefab,
      ...(tint === undefined ? {} : { tint }),
      ...(v.boss ? { boss: true as const } : {}),
    };
  };
  const plain = delver.troops.map((p, i) =>
    p.variants.map((v) => {
      troops.push(troopOf(p, i, v, v.relics, false));
      return troops.length - 1;
    }),
  );
  const sets = eliteRelicSets(delver);
  const elite = sets.map((key) =>
    delver.troops.map((p, i) =>
      p.variants.map((v) => {
        if (v.boss) return -1;
        // The Variant's own Relics, then the template's it does not already wear: up to 2 * MAX_ENEMY_RELICS, on purpose (an elite stacks both).
        const relics = [...v.relics, ...key.split('\n').filter((r) => !v.relics.includes(r))];
        troops.push(troopOf(p, i, v, relics, true));
        return troops.length - 1;
      }),
    ),
  );
  const eliteSet = delver.warbands.map((t) => (t.elite ?? []).map((e) => sets.indexOf(e.relics.join('\n'))));
  const boss = delver.warbands.map((t) => (t.boss ? plain[t.boss.prefab]![t.boss.variant]! : -1));
  return { troops, plain, elite, eliteSet, boss };
}

/** The Troops a Delver Floor's Crowd indexes, for `delver` (cached per object). */
export function floorTroops(delver: DelverTuning): FloorTroops {
  let made = cache.get(delver);
  if (!made) cache.set(delver, (made = build(delver)));
  return made;
}

/**
 * The Prefabs (indices into `delver.troops`) Floor `floor` of the Run of `seed` fields (docs/plans/delver-troops.md): `delver.prefabsPerFloor`
 * of those that fill template rows on its tier (`fieldedIn`: a `regularPrefab` whose `minTier` has come), all different, in a seeded order and then ascending; every one of them when there are
 * no more. The next Floor draws afresh, so a Prefab may come back on it. Pure.
 */
export function floorPrefabs(delver: DelverTuning, seed: number, floor: number): number[] {
  const order: { i: number; key: number }[] = [];
  const tier = tierOf(delver, floor);
  delver.troops.forEach((p, i) => {
    if (fieldedIn(p, tier)) order.push({ i, key: runPick(seed, floor, i, PREFAB_SALT, 0x1_0000_0000) });
  });
  order.sort((a, b) => a.key - b.key || a.i - b.i);
  return order
    .slice(0, delver.prefabsPerFloor)
    .map((o) => o.i)
    .sort((a, b) => a - b);
}

/** Every Prefab drawn on Floor `floor` of the Run of `seed`: its `floorPrefabs`, and on a Boss Floor its Boss's Prefab too (ascending, each once). Pure. */
export function floorLooks(delver: DelverTuning, seed: number, floor: number): number[] {
  const looks = floorPrefabs(delver, seed, floor);
  const boss = delver.warbands[tierOf(delver, floor) - 1]?.boss;
  if (boss && isBossFloor(delver, floor) && !looks.includes(boss.prefab)) looks.push(boss.prefab);
  return looks.sort((a, b) => a - b);
}

/** The tallest a Delver Soldier stands (its height is clamped to MIN_SIZE..this; its thickness still runs to MAX_SIZE). */
export const DELVE_MAX_HEIGHT = 1.3;

/**
 * The Size of a Delver Soldier of `hp` (its final HP, every scale and Relic applied): MIN_SIZE at `delver.sizeHp[0]` HP or less, MAX_SIZE
 * at `sizeHp[1]` or more, in a straight line between, height and thickness alike (snapped, `clampSize`), except that height is clamped to DELVE_MAX_HEIGHT.
 */
export function sizeOfHp(delver: Pick<DelverTuning, 'sizeHp'>, hp: number): Size {
  const [lo, hi] = delver.sizeHp;
  const t = (Math.min(hi, Math.max(lo, hp)) - lo) / (hi - lo);
  const s = MIN_SIZE + t * (MAX_SIZE - MIN_SIZE);
  return clampSize({ height: Math.min(DELVE_MAX_HEIGHT, s), thick: s });
}
