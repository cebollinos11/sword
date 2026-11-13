/**
 * A Delver Floor's Troops (docs/plans/delver.md, Stage 4): `battle.troops` first, at their own indices, then each tier's Boss Troop and
 * then the elite Troops. Pure and derived, cached per (battle, delver) objects, never state. A Floor's Battle Tuning carries this list
 * as its `troops` (`delverBattle`), so a Floor's Crowd indexes its Troops in it; the Battles' own `battle.troops` is never touched.
 */
import type { BattleTuning, DelverTuning, TroopTuning } from '../../tuning';

export interface FloorTroops {
  /** `battle.troops`, then each tier's Boss Troop, then the elite Troops. */
  readonly troops: readonly TroopTuning[];
  /** Per tier: its Boss Troop's index, or -1 when the tier has no Boss. */
  readonly boss: readonly number[];
  /** [tier][elite template][row]: that row's elite Troop index. */
  readonly elite: readonly (readonly (readonly number[])[])[];
}

/** The tier (1 to `tiers`) of Floor `floor`. */
export function tierOf(delver: DelverTuning, floor: number): number {
  return Math.min(delver.tiers, Math.max(1, Math.ceil(floor / delver.floorsPerTier)));
}

/** Whether Floor `floor` is a Boss Floor: the last of its tier, and its tier has a Boss. */
export function isBossFloor(delver: DelverTuning, floor: number): boolean {
  return floor % delver.floorsPerTier === 0 && delver.warbands[tierOf(delver, floor) - 1]?.boss !== undefined;
}

const cache = new WeakMap<BattleTuning, WeakMap<DelverTuning, FloorTroops>>();

function build(battle: BattleTuning, delver: DelverTuning): FloorTroops {
  const troops: TroopTuning[] = [...battle.troops];
  const boss = delver.warbands.map((tier): number => {
    const b = tier.boss;
    if (!b) return -1;
    const { troop: t } = b;
    troops.push({
      ...battle.troops[t.base]!,
      name: t.name,
      weight: 1,
      bodies: [t.body],
      teamBodies: undefined,
      height: [t.height, t.height],
      width: [t.width, t.width],
      weapon: t.weapon,
      difficulty: t.difficulty,
      mods: {},
      style: t.style,
      relics: t.relics,
      boss: true,
    });
    return troops.length - 1;
  });
  const elite = delver.warbands.map((tier) =>
    (tier.elite ?? []).map((template) =>
      template.troops.map((row) => {
        const base = battle.troops[row.troop]!;
        troops.push({ ...base, name: `${base.name} (elite)`, relics: template.relics });
        return troops.length - 1;
      }),
    ),
  );
  return { troops, boss, elite };
}

/** The Troops a Delver Floor's Crowd indexes, for `battle` and `delver` (cached per pair of objects). */
export function floorTroops(battle: BattleTuning, delver: DelverTuning): FloorTroops {
  let byDelver = cache.get(battle);
  if (!byDelver) cache.set(battle, (byDelver = new WeakMap()));
  let made = byDelver.get(delver);
  if (!made) byDelver.set(delver, (made = build(battle, delver)));
  return made;
}
