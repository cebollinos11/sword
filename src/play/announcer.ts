import type { MatchState } from '../sim';

/** Something worth announcing about a Match (HUD banner, camera reset, result screen). */
export type Milestone =
  | { readonly type: 'DuelStart'; readonly duelNumber: number }
  /** `winner` null = a draw. */
  | { readonly type: 'DuelEnd'; readonly duelNumber: number; readonly winner: number | null }
  | { readonly type: 'MatchEnd'; readonly winner: number; readonly score: readonly number[] };

/**
 * Turns the Match states a loop presents into announcements, read from the
 * state itself rather than from the Tick's events. With Rollback the Tick that
 * carried an event may only ever have been re-simulated (its events never
 * presented), and the same Tick may be seen twice; here each milestone is
 * announced exactly once, as soon as any presented state shows it.
 */
export class MatchAnnouncer {
  private duelNumber = 0;
  private duelEnded = false;
  private matchEnded = false;

  update(match: MatchState): Milestone[] {
    const out: Milestone[] = [];
    if (match.duelNumber !== this.duelNumber) {
      this.duelNumber = match.duelNumber;
      this.duelEnded = false;
      out.push({ type: 'DuelStart', duelNumber: match.duelNumber });
    }
    const duel = match.duel.duel;
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
