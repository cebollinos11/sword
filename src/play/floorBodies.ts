import { soldierBody, type CrowdState, type SimState } from '../sim';
import { arenaTuning } from '../sim/delver';
import type { TuningData } from '../tuning';

/**
 * The Body each Fighter slot of a Delver Run's Floor wears (docs/plans/delver.md, Stage 3): the party's slots (the first `party`) keep
 * the Lineup's choice in `chosen` (none for an AI), and a Pool slot a Soldier is bound to wears that Soldier's Body (`bodyOf`, as a Battle's
 * `battleBodies` does), so a promoted enemy is drawn as the Troop it was. An unbound Pool slot is not drawn and needs none. Pure.
 */
export function floorBodies(duel: SimState, party: number, chosen: readonly (string | undefined)[], bodyOf: (soldier: number) => string): (string | undefined)[] {
  return duel.fighters.map((f, k) => (k < party ? chosen[k] : f.soldier ? bodyOf(f.soldier.index) : undefined));
}

/**
 * The Body of each Soldier of a Delver Floor's Crowd (`soldierBody`), read from the Floor's own Troops (`arenaTuning(...).battle.troops`: the Battle's, then
 * each tier's Boss and the elites), since a Boss's or elite's Troop index lies past the Battle's. So a promoted Boss wears its Boss Troop's Body. Pure.
 */
export function floorBodyOf(tuning: TuningData, arena: string, crowd: Pick<CrowdState, 'troop' | 'look' | 'team'> | undefined): (soldier: number) => string {
  const { battle } = arenaTuning(tuning, arena);
  return (i) => (crowd ? soldierBody(battle, crowd, i) : battle.soldier.body);
}
