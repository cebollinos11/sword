/**
 * Building a planned Floor (docs/plans/delver.md, Stage 1): its Map Source compiled, its Battlefield made and its destination fields
 * built at the Floor's own cell. Pure, and rebuilt from (Run seed, Floor) on every peer; the Battlefield and the fields are caches
 * derived from the plan, never stored in the Simulation.
 */
import { compileMap } from '../../mapEditor/compile';
import type { MapSource } from '../../mapEditor/source';
import type { BattleMapTuning, BattleTuning, TuningData } from '../../tuning';
import { battlefieldOf, type Battlefield } from '../battlefield';
import { destinationFields, type DestinationFields } from '../destinations';
import type { FloorPlan } from './plan';
import { floorSource } from './source';

/** A Floor, built. */
export interface BuiltFloor {
  readonly plan: FloorPlan;
  readonly source: MapSource;
  readonly map: BattleMapTuning;
  /** The Battle Tuning the Floor runs under: the Battles' with the Floor's map and the Floor's flow cell. */
  readonly battle: BattleTuning;
  readonly field: Battlefield;
  readonly fields: DestinationFields;
}

/**
 * A Floor's Battle Tuning: the Battles' with the destination fields' cell at `delver.flowCell` (2 m, so every 3 m Passage holds a
 * node) and the Floor's map the only one. Everything that reads `crowd.flowCell` (the fields, `distanceTo`, the Crowd's density grid)
 * then runs at the Floor's cell; the Battles' own Tuning is never touched.
 */
export function delverBattle(tuning: Pick<TuningData, 'battle' | 'delver'>, map: BattleMapTuning): BattleTuning {
  const { battle, delver } = tuning;
  return { ...battle, crowd: { ...battle.crowd, flowCell: delver.flowCell }, maps: { [map.name]: map } };
}

/** `buildFloor` of a source other than the plan's own (the judge's tests mutate it). Throws MapCompileError. */
export function buildFromSource(tuning: Pick<TuningData, 'battle' | 'delver'>, plan: FloorPlan, source: MapSource): BuiltFloor {
  // compileMap only needs the Battle's field, deploy, squad and levels, which the Floor's Tuning shares with the Battles'.
  const { map } = compileMap(source, tuning.battle);
  const battle = delverBattle(tuning, map);
  const field = battlefieldOf(battle, `battle:${map.name}`)!;
  const fields = destinationFields(battle, field);
  return { plan, source, map, battle, field, fields };
}

/** The Floor's source compiled (its parse and walk check included), its Battlefield and its destination fields. Throws MapCompileError. */
export function buildFloor(tuning: Pick<TuningData, 'battle' | 'delver'>, plan: FloorPlan): BuiltFloor {
  return buildFromSource(tuning, plan, floorSource(plan));
}
