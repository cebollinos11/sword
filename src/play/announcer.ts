import type { MatchState } from '../sim';

/** Something worth announcing about a Match (HUD banner, camera reset, result screen). */
export type Milestone =
  | { readonly type: 'DuelStart'; readonly duelNumber: number }
  /** `winner` is a team; null = a draw. */
  | { readonly type: 'DuelEnd'; readonly duelNumber: number; readonly winner: number | null }
  /** The watched Fighter fell while its team fought on. */
  | { readonly type: 'Fell'; readonly duelNumber: number }
  | { readonly type: 'MatchEnd'; readonly winner: number; readonly score: readonly number[] };

/**
 * Turns the Match states a loop presents into announcements, read from the
 * state itself rather than from the Tick's events. With Rollback the Tick that
 * carried an event may only ever have been re-simulated (its events never
 * presented), and the same Tick may be seen twice; here each milestone is
 * announced exactly once, as soon as any presented state shows it.
 */
export class MatchAnnouncer {
  private matchNumber = 0;
  private duelNumber = 0;
  private duelEnded = false;
  private fell = false;
  private matchEnded = false;

  /** `me`: the Fighter whose fall is announced (default none). */
  update(match: MatchState, me = -1): Milestone[] {
    const out: Milestone[] = [];
    if (match.matchNumber !== this.matchNumber) {
      // A rematch (or the first Match): announce it all afresh.
      this.matchNumber = match.matchNumber;
      this.duelNumber = 0;
      this.matchEnded = false;
    }
    if (match.duelNumber !== this.duelNumber) {
      this.duelNumber = match.duelNumber;
      this.duelEnded = false;
      this.fell = false;
      out.push({ type: 'DuelStart', duelNumber: match.duelNumber });
    }
    const duel = match.duel.duel;
    if (!this.fell && duel.status === 'Fighting' && match.duel.fighters[me]?.death) {
      this.fell = true;
      out.push({ type: 'Fell', duelNumber: match.duelNumber });
    }
    if (!this.duelEnded && duel.status === 'Over') {
      this.duelEnded = true;
      out.push({ type: 'DuelEnd', duelNumber: match.duelNumber, winner: duel.winner });
    }
    if (!this.matchEnded && match.status.status === 'Over') {
      this.matchEnded = true;
      out.push({ type: 'MatchEnd', winner: match.status.winner, score: match.score });
    }
    return out;
  }
}
