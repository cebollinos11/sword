import type { Emit } from './events';
import type { DuelState, FighterState } from './state';

export const DUEL_FIGHTING: DuelState = { status: 'Fighting' };

/**
 * End the Duel on the Tick a Fighter's HP reaches zero. The winner is the
 * only Fighter left standing, or null when all fall on the same Tick.
 */
export function updateDuel(duel: DuelState, fighters: readonly FighterState[], tick: number, emit: Emit): DuelState {
  if (duel.status !== 'Fighting' || fighters.every((f) => f.hp > 0)) return duel;
  const standing = fighters.flatMap((f, i) => (f.hp > 0 ? [i] : []));
  const winner = standing.length === 1 ? standing[0]! : null;
  emit({ type: 'DuelEnd', winner });
  return { status: 'Over', winner, tick };
}
