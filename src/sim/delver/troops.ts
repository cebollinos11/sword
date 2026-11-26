/**
 * A Delver Floor's Troops (docs/plans/delver.md, Stage 4; docs/plans/delver-troops.md): every Variant of every Prefab of `delver.troops`
 * in order, then each non-Boss Variant again for each distinct elite Relic set (wearing that set too). Pure and derived, cached per `delver`
 * object, never state. A Floor's Battle Tuning carries this list as its `troops` (`delverBattle`), so a Floor's Crowd indexes its Troops in
 * it; the Battles' own `battle.troops` are never a Floor's. Which Prefabs a Floor fields is `floorPrefabs`.
 */
import { clampSize, eliteRelicSets, fieldedIn, MAX_SIZE, MIN_SIZE, type DelverTuning, type RelicEffects, type Size, type TroopTuning, type TuningData } from '../../tuning';
import type { DelverFloorTuning, DelverPrefab, DelverVariant } from '../../tuning/delver';
import { runPick } from '../dungeon';
import { relicMods, relicOf } from '../inventory';
import { foldMods, type Mods } from '../mods';

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
      ...(v.quirks ? { quirks: v.quirks } : {}),
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

/** A Delver Soldier's height runs MIN_SIZE to this (not MAX_SIZE), and its thickness runs DELVE_MIN_THICK to MAX_SIZE. */
export const DELVE_MAX_HEIGHT = 1.3;
export const DELVE_MIN_THICK = 0.9;

/**
 * The Size of a Delver Soldier of `hp` (its final HP, every scale and Relic applied): the smallest body at `delver.sizeHp[0]` HP or less,
 * the biggest at `sizeHp[1]` or more, in a straight line between (snapped, `clampSize`). Height runs MIN_SIZE to DELVE_MAX_HEIGHT (0.6 to
 * 1.3), thickness DELVE_MIN_THICK to MAX_SIZE (0.9 to 1.4).
 */
export function sizeOfHp(delver: Pick<DelverTuning, 'sizeHp'>, hp: number): Size {
  const [lo, hi] = delver.sizeHp;
  const t = (Math.min(hi, Math.max(lo, hp)) - lo) / (hi - lo);
  return clampSize({
    height: MIN_SIZE + t * (DELVE_MAX_HEIGHT - MIN_SIZE),
    thick: DELVE_MIN_THICK + t * (MAX_SIZE - DELVE_MIN_THICK),
  });
}

/**
 * A Delver Soldier's HP from its Troop (docs/plans/delver-troops.md): a Boss's whole HP (`boss`), every other Soldier's times its Warband
 * template's `hpScale` and then its tier's `tierHp`, with its Relics' `maxHp` share on top, multiplied left to right in that order so every
 * caller gets the same bits. The one formula a Floor's Crowd (`deployWarbands`) and a Duel Troop (`resolveTroop`, `hpScale` 1) both use.
 * Throws on a Relic Tuning Data lacks. Pure.
 */
export function soldierHp(tuning: Pick<TuningData, 'relics'>, troop: Pick<TroopTuning, 'hp' | 'relics'>, boss: boolean, hpScale: number, tierHp: number): number {
  const worn = relicMods(tuning, troop.relics ?? []).maxHp;
  return boss ? troop.hp * (1 + worn) : troop.hp * hpScale * tierHp * (1 + worn);
}

/**
 * A promoted Soldier's Mods from its Troop: its Troop's `mods`, then its Relics, then its Quirks' `body` parts (`ai.quirks`), folded
 * (`foldMods`). The one fold a Floor's promotion (`bubble.ts`) and a Duel Troop (`resolveTroop`) both use. Throws on a Relic or a Quirk
 * Tuning Data lacks. Pure.
 */
export function troopMods(tuning: Pick<TuningData, 'relics' | 'ai'>, troop: Pick<TroopTuning, 'mods' | 'relics' | 'quirks'>): Mods {
  return foldMods([{ effects: troop.mods }, ...(troop.relics ?? []).map((name) => relicOf(tuning, name)), ...quirkBodies(tuning, troop.quirks ?? [])]);
}

/** The `body` parts of Quirks `names`, as Relic-like effects to fold (a Quirk with none adds nothing). Throws on a Quirk Tuning Data lacks. */
function quirkBodies(tuning: Pick<TuningData, 'ai'>, names: readonly string[]): { readonly effects: RelicEffects }[] {
  return names.flatMap((name) => {
    const q = tuning.ai.quirks[name];
    if (!q) throw new RangeError(`Unknown Quirk "${name}" (have: ${Object.keys(tuning.ai.quirks).join(', ') || 'none'})`);
    return q.body ? [{ effects: q.body }] : [];
  });
}

/**
 * A Delver Troop to fight in a Duel (docs/plans/enemy-behaviours.md, Stage 0): a Prefab by its name, one of its Variants by the Variant's own
 * `name` ("Uruk (Beginner)" for a plain one, "Warden" for a Boss), and the Floor tier whose HP it has (1 to `delver.tiers`; absent:
 * `duelTroopTier`). Plain data, on an AI Seat and its Lineup slot, and over the wire.
 */
export interface TroopRef {
  readonly prefab: string;
  readonly variant: string;
  readonly tier?: number;
}

/** The Floor tier a Duel Troop's HP is scaled as when its ref names none. */
export const DUEL_TROOP_TIER = 2;

/** The tier a Duel Troop takes with no `tier` of its own: DUEL_TROOP_TIER, or the last tier when a Run has fewer. */
export const duelTroopTier = (delver: Pick<DelverTuning, 'tiers'>): number => Math.min(DUEL_TROOP_TIER, delver.tiers);

/** A Duel Troop resolved from Tuning Data (`resolveTroop`): everything a Duel needs to field it as the enemy it is on a Floor. */
export interface ResolvedTroop {
  /** Its Prefab (an index into `delver.troops`) and Variant there. */
  readonly prefab: number;
  readonly variant: number;
  /** The Floor's own Troop for that Variant (`floorTroops(...).plain`), which a Floor's Crowd indexes. */
  readonly troop: TroopTuning;
  /** The Floor tier its HP is scaled as (a Boss's HP is whole whatever it says). */
  readonly tier: number;
  /** Its Prefab's Body (render-only) and Weapon. */
  readonly body: string;
  readonly weapon: string;
  /** Its Variant's AI difficulty, Style and Quirks (`ai.quirks` names; [] for none). */
  readonly difficulty: string;
  readonly style: string;
  readonly quirks: readonly string[];
  /** The Relics it wears (its Variant's). */
  readonly relics: readonly string[];
  /** Its Mods: the Variant's `mods` with its Relics and its Quirks' `body` parts folded in (`troopMods`). */
  readonly mods: Mods;
  /** Its HP and max HP (`soldierHp`, scaled as on a Floor of `tier`). */
  readonly maxHp: number;
  /** Its Size, from that HP (`sizeOfHp`). */
  readonly size: Size;
}

/** How the Lobby names a Variant: "Uruk · Beginner" for a plain one with its default name, "Uruk · Warden (Boss)", else "Prefab · its name". */
export function troopLabel(p: Pick<DelverPrefab, 'name'>, v: Pick<DelverVariant, 'name' | 'difficulty' | 'boss'>): string {
  if (v.boss) return `${p.name} · ${v.name} (Boss)`;
  return `${p.name} · ${v.name === `${p.name} (${v.difficulty})` ? v.difficulty : v.name}`;
}

/**
 * The Duel Troop `ref` names, from Tuning Data (docs/plans/enemy-behaviours.md, Stage 0), built the way a Floor builds its promoted Soldier:
 * the Floor's own Troop for the Variant (`floorTroops`), its HP (`soldierHp`, a Boss's whole, every other at its tier's `tierHp`: a Duel has
 * no Warband template, so no `hpScale`), its Mods (`troopMods`) and its Size from that HP (`sizeOfHp`). Every peer resolves the same ref to the
 * same numbers. Throws a RangeError naming the known ones for a Prefab, a Variant or a tier Tuning Data does not have. Pure.
 * Its Quirks go beside its Style, for the AI to apply after it (`lineupAis`), and their `body` parts into `mods` through `troopMods`, the
 * seam a Floor's promotion shares.
 */
export function resolveTroop(tuning: Pick<TuningData, 'delver' | 'relics' | 'ai'>, ref: TroopRef): ResolvedTroop {
  const { delver } = tuning;
  const prefab = delver.troops.findIndex((p) => p.name === ref.prefab);
  if (prefab < 0) throw new RangeError(`Unknown Troop Prefab "${ref.prefab}" (have: ${delver.troops.map((p) => p.name).join(', ')})`);
  const p = delver.troops[prefab]!;
  const variant = p.variants.findIndex((v) => v.name === ref.variant);
  if (variant < 0) throw new RangeError(`Unknown Variant "${ref.variant}" of Troop Prefab "${p.name}" (have: ${p.variants.map((v) => v.name).join(', ')})`);
  const tier = ref.tier ?? duelTroopTier(delver);
  if (!Number.isInteger(tier) || tier < 1 || tier > delver.tiers) throw new RangeError(`A Troop's Floor tier is 1 to ${delver.tiers}, got ${tier}`);
  const troop = floorTroops(delver).troops[floorTroops(delver).plain[prefab]![variant]!]!;
  const boss = troop.boss === true;
  const maxHp = soldierHp(tuning, troop, boss, 1, delver.tierHp[tier - 1]!);
  return {
    prefab,
    variant,
    troop,
    tier,
    body: troop.bodies[0]!,
    weapon: troop.weapon,
    difficulty: troop.difficulty,
    style: troop.style ?? p.variants[variant]!.style,
    quirks: troop.quirks ?? [],
    relics: troop.relics ?? [],
    mods: troopMods(tuning, troop),
    maxHp,
    size: sizeOfHp(delver, maxHp),
  };
}
