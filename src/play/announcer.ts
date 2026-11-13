import type { MatchState } from '../sim';
import { BOSS } from '../sim/warband';

/** Something worth announcing about a Match (HUD banner, camera reset, result screen). */
export type Milestone =
  | { readonly type: 'DuelStart'; readonly duelNumber: number }
  /** `winner` is a team; null = a draw. */
  | { readonly type: 'DuelEnd'; readonly duelNumber: number; readonly winner: number | null }
  /** A Run's Hall was cleared (its Duel goes on: the party walks to a Door); `kind` its Hall kind. */
  | { readonly type: 'HallCleared'; readonly duelNumber: number; readonly kind: string }
  /** The watched Fighter took a Rest Hall's fire. */
  | { readonly type: 'Rested'; readonly duelNumber: number }
  /** The watched Fighter came back at a Delver Floor's fire. */
  | { readonly type: 'Revived'; readonly duelNumber: number }
  /** A Delver Floor's Boss Warband was wiped: the gate is open and the Stairs count (on the last Floor they win the Run). */
  | { readonly type: 'BossBeaten'; readonly duelNumber: number }
  /** A Delver Floor's wiped Warband laid an item for the watched Fighter (its Player; none while no Fighter is watched). */
  | { readonly type: 'LootDropped'; readonly duelNumber: number }
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
  private hallCleared = false;
  private rested = false;
  /** The Delver Floor's fires the watched Fighter has taken the heal of. */
  private fires = 0;
  private fell = false;
  private bossBeaten = false;
  /** The wipe drops lying for the watched Fighter (`pickups`, ids never reused), counted over the Floor. */
  private loot = 0;
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
      this.hallCleared = false;
      this.rested = false;
      this.fires = 0;
      this.fell = false;
      this.bossBeaten = false;
      this.loot = 0;
      out.push({ type: 'DuelStart', duelNumber: match.duelNumber });
    }
    const duel = match.duel.duel;
    // A Delver Run's fire brings the fallen back: the watched Fighter fell, and now stands.
    if (this.fell && match.delver && match.duel.fighters[me] && !match.duel.fighters[me]!.death) {
      this.fell = false;
      out.push({ type: 'Revived', duelNumber: match.duelNumber });
    }
    if (!this.fell && duel.status === 'Fighting' && match.duel.fighters[me]?.death) {
      this.fell = true;
      out.push({ type: 'Fell', duelNumber: match.duelNumber });
    }
    const run = match.run;
    if (!this.hallCleared && run && run.phase !== 'Fighting') {
      this.hallCleared = true;
      out.push({ type: 'HallCleared', duelNumber: match.duelNumber, kind: match.duel.hall?.kind ?? '' });
    }
    if (!this.rested && run?.rested.includes(me)) {
      this.rested = true;
      out.push({ type: 'Rested', duelNumber: match.duelNumber });
    }
    const fires = match.delver?.restUsed.filter((u) => u.healed.includes(me)).length ?? 0;
    if (fires > this.fires) {
      this.fires = fires;
      out.push({ type: 'Rested', duelNumber: match.duelNumber });
    }
    const delver = match.delver;
    if (delver && !this.bossBeaten) {
      const boss = match.duel.crowd?.warbands?.rank.indexOf(BOSS) ?? -1;
      if (boss >= 0 && delver.wiped.includes(boss)) {
        this.bossBeaten = true;
        out.push({ type: 'BossBeaten', duelNumber: match.duelNumber });
      }
    }
    // A wipe's drops are the Floor's pickups with an owner and no pedestal group (an inventory drop is shared and has `by`).
    const loot = delver?.pickups.filter((p) => p.owner === me && p.group === undefined && p.by === undefined).length ?? 0;
    if (loot > this.loot) {
      this.loot = loot;
      out.push({ type: 'LootDropped', duelNumber: match.duelNumber });
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
