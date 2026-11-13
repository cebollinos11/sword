import type { SimState } from '../sim';

/**
 * The Body each Fighter slot of a Delver Run's Floor wears (docs/plans/delver.md, Stage 3): the party's slots (the first `party`) keep
 * the Lineup's choice in `chosen` (none for an AI), and a Pool slot a Soldier is bound to wears that Soldier's Body (`bodyOf`, as a Battle's
 * `battleBodies` does), so a promoted enemy is drawn as the Troop it was. An unbound Pool slot is not drawn and needs none. Pure.
 */
export function floorBodies(duel: SimState, party: number, chosen: readonly (string | undefined)[], bodyOf: (soldier: number) => string): (string | undefined)[] {
  return duel.fighters.map((f, k) => (k < party ? chosen[k] : f.soldier ? bodyOf(f.soldier.index) : undefined));
}
