import type { Emit } from './events';
import type { DuelState, FighterState } from './state';

export const DUEL_FIGHTING: DuelState = { status: 'Fighting' };

/**
 * End the Duel on the Tick the last Fighter of a team falls. The winner is the
 * team with Fighters left standing, or null when the last of both teams fall on
 * the same Tick.
 */
export function updateDuel(duel: DuelState, fighters: readonly FighterState[], tick: number, emit: Emit): DuelState {
  if (duel.status !== 'Fighting' || fighters.every((f) => f.hp > 0)) return duel;
  const standing = new Set(fighters.filter((f) => f.hp > 0).map((f) => f.team));
  if (standing.size > 1) return duel;
  const winner = standing.size === 1 ? [...standing][0]! : null;
  emit({ type: 'DuelEnd', winner });
  return { status: 'Over', winner, tick };
}
