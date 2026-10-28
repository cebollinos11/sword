import type { Emit } from './events';
import type { DuelState, FighterState } from './state';

export const DUEL_FIGHTING: DuelState = { status: 'Fighting' };

/**
 * Whether the Fighter is still in the Duel: neither fallen (Death) nor Benched. Every check that skips a Fighter out of
 * the fight (stepping, bodies, Blade Sweeps, daggers, Kicks, Chambers, the AI's targets, the Duel's end) goes through this.
 */
export const inDuel = (f: FighterState): boolean => !f.death && !f.benched;

/**
 * End the Duel on the Tick the last Fighter of a team falls. The winner is the
 * team with Fighters left standing, or null when the last of both teams fall on
 * the same Tick. In a Hall (`hall`), only on the Tick the last of Team 0 falls.
 */
export function updateDuel(duel: DuelState, fighters: readonly FighterState[], tick: number, emit: Emit, hall = false): DuelState {
  // A Benched slot never took part: it neither stands nor has fallen.
  const fielded = fighters.filter((f) => !f.benched);
  if (duel.status !== 'Fighting' || fielded.every(inDuel)) return duel;
  const standing = new Set(fielded.filter(inDuel).map((f) => f.team));
  // A Hall's Duel (a Dungeon Run) goes on while Team 0 stands, its Encounter beaten or not.
  if (hall ? standing.has(0) : standing.size > 1) return duel;
  const winner = standing.size === 1 ? [...standing][0]! : null;
  emit({ type: 'DuelEnd', winner });
  return { status: 'Over', winner, tick };
}
