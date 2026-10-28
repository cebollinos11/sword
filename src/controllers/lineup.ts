/**
 * A Lineup: who fights a Match. One slot per Fighter (slot i is Fighter i):
 * its team, and whether one of the (at most MAX_PLAYERS) human Players or the
 * AI drives it. Players pick their own Weapon; each AI's Weapon is set in its slot.
 *
 * Plain data, so the host of a Player vs Player Match can send it to the
 * guest and both peers build the same Match and the same AI Controllers.
 */
import { checkRunTeams, checkTeams, runPick, type MatchFormat, type MatchOptions } from '../sim';
import { DEFAULT_STYLE, defaultWeaponName, RANDOM_PICK, type TuningData } from '../tuning';
import { createAiController } from './ai';
import { createAllyAi } from './allyAi';
import type { Controller } from './controller';
import { createHallAi } from './hallAi';

/** The most human Players a Match fields (online: the host and three guests). */
export const MAX_PLAYERS = 4;

/** A human Player: 0 (Player vs AI, or the host online), 1 to 3 (the guests online, in Lobby order). */
export type PlayerNumber = 0 | 1 | 2 | 3;

/**
 * What drives a Fighter: a human Player, or the AI at a difficulty preset (Tuning Data `ai.difficulties`) playing a Style
 * (`ai.styles`, or RANDOM_PICK: one picked from the Match seed by `lineupStyle`; absent: DEFAULT_STYLE).
 */
export type Pilot = { readonly kind: 'Player'; readonly player: PlayerNumber } | { readonly kind: 'AI'; readonly difficulty: string; readonly style?: string };

/**
 * The difficulty a Gauntlet's Team 1 slots name: none of their own, since each Hall decides who stands in the slot (its
 * Hall AI plays the Hall's Encounter's difficulty for it, Tuning Data `dungeon.floors`).
 */
export const FLOOR_DIFFICULTY = 'Floor';

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
 * (1 to MAX_TEAM_SIZE Fighters a side), each Player driving exactly one Fighter, and every
 * AI difficulty, Style (or RANDOM_PICK) and Weapon in Tuning Data. In a Gauntlet: Team 0's Fighters, then
 * MAX_TEAM_SIZE Team 1 slots, each an AI of FLOOR_DIFFICULTY (the Floors drive them).
 */
export function checkLineup(tuning: TuningData, lineup: Lineup, players: number, format: MatchFormat = 'Duels'): void {
  const teams = lineup.map((s) => s.team);
  if (format === 'Gauntlet') checkRunTeams(teams);
  else checkTeams(teams);
  const floors = (s: LineupSlot) => format === 'Gauntlet' && s.team === 1;
  for (const s of lineup) {
    if (floors(s) && (s.pilot.kind !== 'AI' || s.pilot.difficulty !== FLOOR_DIFFICULTY))
      throw new RangeError(`A Gauntlet's Team 1 slots are the Floors' (an AI of difficulty "${FLOOR_DIFFICULTY}")`);
  }
  if (!Number.isInteger(players) || players < 1 || players > MAX_PLAYERS) throw new RangeError(`A Match fields 1 to ${MAX_PLAYERS} Players, not ${players}`);
  for (let p = 0; p < MAX_PLAYERS; p++) {
    const driving = lineup.filter((s) => s.pilot.kind === 'Player' && s.pilot.player === p).length;
    const wanted = p < players ? 1 : 0;
    if (driving !== wanted) throw new RangeError(`Player ${p} must drive ${wanted} Fighter${wanted === 1 ? '' : 's'}, drives ${driving}`);
  }
  for (const s of lineup) {
    if (floors(s)) continue;
    if (s.pilot.kind === 'AI' && !tuning.ai.difficulties[s.pilot.difficulty]) throw new RangeError(`Unknown AI difficulty "${s.pilot.difficulty}"`);
    if (s.pilot.kind === 'AI' && s.pilot.style !== undefined && s.pilot.style !== RANDOM_PICK && !tuning.ai.styles[s.pilot.style]) throw new RangeError(`Unknown AI Style "${s.pilot.style}"`);
    if (s.pilot.kind === 'AI' && s.weapon !== undefined && !tuning.weapons[s.weapon]) throw new RangeError(`Unknown Weapon "${s.weapon}"`);
  }
}

/**
 * The Match options for a Lineup: its teams, each Fighter's Weapon (Player p's from `playerWeapons[p]`), and for a
 * Gauntlet how many human Players it fields (`humans`, which scales the Run's enemies) and which Fighters they drive
 * (`players`, whose standing counts at a Door), so every peer building the Match from the same Lineup gets the same.
 * Duels never read them, and keep the defaults.
 */
export function lineupMatch(tuning: TuningData, lineup: Lineup, playerWeapons: readonly string[], options: MatchOptions): MatchOptions {
  const weapons = lineup.map((s) => (s.pilot.kind === 'Player' ? playerWeapons[s.pilot.player] : s.weapon) ?? defaultWeaponName(tuning));
  const players = lineup.flatMap((s, i) => (s.pilot.kind === 'Player' ? [i] : []));
  return { ...options, teams: lineup.map((s) => s.team), weapons, ...(options.format === 'Gauntlet' ? { humans: players.length, players } : {}) };
}

/** How many human Players the Lineup fields. */
export function lineupPlayers(lineup: Lineup): number {
  return lineup.filter((s) => s.pilot.kind === 'Player').length;
}

/**
 * The Style Fighter `fighter`'s AI plays: its Pilot's, DEFAULT_STYLE when it names none, and for RANDOM_PICK one of
 * `ai.styles` picked by a pure hash of the Match seed and the Fighter (`runPick`), so every peer picks the same.
 */
export function lineupStyle(tuning: TuningData, style: string | undefined, seed: number, fighter: number): string {
  if (style !== RANDOM_PICK) return style ?? DEFAULT_STYLE;
  const styles = Object.keys(tuning.ai.styles);
  return styles[runPick(seed, 0, fighter, 2, styles.length)]!;
}

/**
 * A fresh AI Controller for each AI slot; null for each Player's slot. In a Gauntlet, each Team 1 slot gets a Hall AI
 * instead (its Halls decide its difficulty and Style), counting Team 1's slots from 0 in Fighter order, and each Team 0 AI
 * an Ally AI (its own AI, walking with the Players once a Hall is cleared). `match` is the Match's options: its seed picks
 * each RANDOM_PICK Style (`lineupStyle`), and its Arena is the Run's first (the Run seed).
 */
export function lineupAis(tuning: TuningData, lineup: Lineup, format: MatchFormat = 'Duels', match: Pick<MatchOptions, 'seed' | 'arena'> = {}): (Controller | null)[] {
  let slot = 0;
  const players = lineup.flatMap((s, i) => (s.pilot.kind === 'Player' ? [i] : []));
  return lineup.map((s, i) => {
    if (format === 'Gauntlet' && s.team === 1) return createHallAi(tuning, slot++, match.arena);
    if (s.pilot.kind !== 'AI') return null;
    const style = lineupStyle(tuning, s.pilot.style, match.seed ?? 1, i);
    return format === 'Gauntlet' ? createAllyAi(tuning, s.pilot.difficulty, style, players) : createAiController(tuning, s.pilot.difficulty, style);
  });
}
