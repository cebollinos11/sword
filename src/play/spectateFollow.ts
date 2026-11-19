/**
 * Who a watching Delver Player's camera follows (a fallen party Fighter, or a traitor waiting to take over a Soldier): one living party
 * Fighter, kept until it falls, then the next living one after it (by Fighter index, wrapping round). Present Players come first; only
 * when none of them lives are the AI allies followed. Render only: it never changes an outcome.
 */
import { inDuel, presentPlayers, type MatchConfig, type SimState } from '../sim';

/** The party Fighter `me` follows, `current` (the last one followed, or -1) while it still lives; -1 if no party Fighter lives. */
export function spectateTarget(config: Pick<MatchConfig, 'teams' | 'humans' | 'players'>, duel: SimState, me: number, current: number): number {
  const living = (k: number): boolean => {
    const f = duel.fighters[k];
    return k !== me && f !== undefined && f.team === 0 && inDuel(f) && f.death === undefined;
  };
  const players = presentPlayers(config, duel.delver?.away).filter(living);
  const party = config.teams.map((_, k) => k).filter(living);
  const pool = players.length > 0 ? players : party;
  if (pool.includes(current)) return current;
  if (pool.length === 0) return -1;
  // The next after the one that fell, so the camera walks round the party rather than always jumping back to the first.
  return pool.find((k) => k > current) ?? pool[0]!;
}
