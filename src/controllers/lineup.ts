/**
 * A Lineup: who fights a Match. One slot per Fighter (slot i is Fighter i):
 * its team, and whether one of the (at most two) human Players or the AI
 * drives it. Players pick their own Weapon; each AI's Weapon is set in its slot.
 *
 * Plain data, so the host of a Player vs Player Match can send it to the
 * guest and both peers build the same Match and the same AI Controllers.
 */
import { checkTeams, type MatchOptions } from '../sim';
import { defaultWeaponName, type TuningData } from '../tuning';
import { createAiController } from './ai';
import type { Controller } from './controller';

/** A human Player: 0 (Player vs AI, or the host online) or 1 (the guest online). */
export type PlayerNumber = 0 | 1;

/** What drives a Fighter: a human Player, or the AI at a difficulty preset (Tuning Data `ai.difficulties`). */
export type Pilot = { readonly kind: 'Player'; readonly player: PlayerNumber } | { readonly kind: 'AI'; readonly difficulty: string };

export interface LineupSlot {
  /** 0 or 1. */
  readonly team: number;
  readonly pilot: Pilot;
  /** An AI's Weapon (a Tuning Data Weapon name; default: the default Weapon). Ignored for a Player, who picks their own. */
  readonly weapon?: string;
}

export type Lineup = readonly LineupSlot[];

/** Player 0 against Player 1, one Fighter a side: the classic Player vs Player Duel. */
export const ONE_VS_ONE: Lineup = [
  { team: 0, pilot: { kind: 'Player', player: 0 } },
  { team: 1, pilot: { kind: 'Player', player: 1 } },
];

/** The Fighter Player `player` drives, or -1 if the Lineup has no such Player. */
export function playerFighter(lineup: Lineup, player: PlayerNumber): number {
  return lineup.findIndex((s) => s.pilot.kind === 'Player' && s.pilot.player === player);
}

/**
 * Throws unless the Lineup is playable with `players` human Players: valid teams
 * (1 to 3 Fighters a side), each Player driving exactly one Fighter, and every
 * AI difficulty and Weapon in Tuning Data.
 */
export function checkLineup(tuning: TuningData, lineup: Lineup, players: 1 | 2): void {
  checkTeams(lineup.map((s) => s.team));
  for (let p = 0; p < 2; p++) {
    const driving = lineup.filter((s) => s.pilot.kind === 'Player' && s.pilot.player === p).length;
    const wanted = p < players ? 1 : 0;
    if (driving !== wanted) throw new RangeError(`Player ${p} must drive ${wanted} Fighter${wanted === 1 ? '' : 's'}, drives ${driving}`);
  }
  for (const s of lineup) {
    if (s.pilot.kind === 'AI' && !tuning.ai.difficulties[s.pilot.difficulty]) throw new RangeError(`Unknown AI difficulty "${s.pilot.difficulty}"`);
    if (s.pilot.kind === 'AI' && s.weapon !== undefined && !tuning.weapons[s.weapon]) throw new RangeError(`Unknown Weapon "${s.weapon}"`);
  }
}

/** The Match options for a Lineup: its teams, and each Fighter's Weapon (Player p's from `playerWeapons[p]`). */
export function lineupMatch(tuning: TuningData, lineup: Lineup, playerWeapons: readonly string[], options: MatchOptions): MatchOptions {
  const weapons = lineup.map((s) => (s.pilot.kind === 'Player' ? playerWeapons[s.pilot.player] : s.weapon) ?? defaultWeaponName(tuning));
  return { ...options, teams: lineup.map((s) => s.team), weapons };
}

/** A fresh AI Controller for each AI slot; null for each Player's slot. */
export function lineupAis(tuning: TuningData, lineup: Lineup): (Controller | null)[] {
  return lineup.map((s) => (s.pilot.kind === 'AI' ? createAiController(tuning, s.pilot.difficulty) : null));
}
