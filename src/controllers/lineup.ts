/**
 * A Lineup: who fights a Match. One slot per Fighter (slot i is Fighter i):
 * its team, and whether one of the (at most MAX_PLAYERS) human Players or the
 * AI drives it. Players pick their own Weapon; each AI's Weapon is set in its slot.
 *
 * Plain data, so the host of a Player vs Player Match can send it to the
 * guest and both peers build the same Match and the same AI Controllers.
 */
import { checkRunTeams, checkTeams, MAX_TEAM_SIZE, runPick, type MatchFormat, type MatchOptions } from '../sim';
import { resolveTroop, type ResolvedTroop, type TroopRef } from '../sim/delver';
import { clampSize, DEFAULT_STYLE, defaultWeaponName, RANDOM_PICK, type Size, type TuningData } from '../tuning';
import { createAiController } from './ai';
import { createAllyAi } from './allyAi';
import type { Controller } from './controller';
import { createPoolAi } from './poolAi';

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
 * The difficulty a Gauntlet's Team 1 slots name past its traitors: none of their own, since the Floors' enemies are the Crowd's Warbands
 * (docs/plans/delver.md), driven by Pool AIs once promoted.
 */
export const FLOOR_DIFFICULTY = 'Floor';

export interface LineupSlot {
  /** 0 or 1. */
  readonly team: number;
  readonly pilot: Pilot;
  /** An AI's Weapon (a Tuning Data Weapon name; default: the default Weapon). Ignored for a Player, who picks their own. */
  readonly weapon?: string;
  /** Its Fighter's Size (default: the standard body). A Player's is the one they picked; an AI's is set in its slot. */
  readonly size?: Size;
  /**
   * A Delver Troop this AI fights as (docs/plans/enemy-behaviours.md, Stage 0; Duels only): its Body, Weapon, HP, Size, Mods, Relics,
   * difficulty and Style, all from Tuning Data (`resolveTroop`). While set, the Pilot's difficulty and Style and the slot's `weapon` and
   * `size` are ignored. Absent: a plain AI.
   */
  readonly troop?: TroopRef;
}

/** The Troop slot `s` fights as, resolved, or null for a slot without one. Throws on a Troop Tuning Data does not have (`resolveTroop`). */
export function slotTroop(tuning: TuningData, s: LineupSlot): ResolvedTroop | null {
  return s.troop ? resolveTroop(tuning, s.troop) : null;
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
 * AI difficulty, Style (or RANDOM_PICK) and Weapon in Tuning Data, and every Troop too (AI slots only, Duels only). In a Gauntlet: Team 0's Fighters, then
 * MAX_TEAM_SIZE Team 1 slots, its traitors (Players, docs/plans/delver.md, Stage 8a) first, then each an AI of FLOOR_DIFFICULTY. In a Battle: only the Players' slots,
 * 0 to MAX_TEAM_SIZE a Team (the rest of the Fighter Pool is the Bubbles', each slot a Pool AI).
 */
export function checkLineup(tuning: TuningData, lineup: Lineup, players: number, format: MatchFormat = 'Duels'): void {
  const teams = lineup.map((s) => s.team);
  if (format === 'Gauntlet') checkRunTeams(teams);
  else if (format === 'Battle') checkBattleTeams(lineup);
  else checkTeams(teams);
  // A Run's Team 1 slots may be Players (its traitors, docs/plans/delver.md, Stage 8a), each before every Floor slot.
  const traitor = (s: LineupSlot) => format === 'Gauntlet' && s.team === 1 && s.pilot.kind === 'Player';
  const floors = (s: LineupSlot) => format === 'Gauntlet' && s.team === 1 && !traitor(s);
  let floorSeen = false;
  for (const s of lineup) {
    if (floors(s) && (s.pilot.kind !== 'AI' || s.pilot.difficulty !== FLOOR_DIFFICULTY))
      throw new RangeError(`A Gauntlet's Team 1 slots are the Floors' (an AI of difficulty "${FLOOR_DIFFICULTY}") or traitors`);
    if (floors(s)) floorSeen = true;
    else if (traitor(s) && floorSeen) throw new RangeError("A Run's traitors come before its Floor slots");
  }
  if (!Number.isInteger(players) || players < 1 || players > MAX_PLAYERS) throw new RangeError(`A Match fields 1 to ${MAX_PLAYERS} Players, not ${players}`);
  for (let p = 0; p < MAX_PLAYERS; p++) {
    const driving = lineup.filter((s) => s.pilot.kind === 'Player' && s.pilot.player === p).length;
    const wanted = p < players ? 1 : 0;
    if (driving !== wanted) throw new RangeError(`Player ${p} must drive ${wanted} Fighter${wanted === 1 ? '' : 's'}, drives ${driving}`);
  }
  for (const s of lineup) {
    if (s.size !== undefined && (clampSize(s.size).height !== s.size.height || clampSize(s.size).thick !== s.size.thick)) throw new RangeError('A Size is 0.6 to 1.4 in steps of 0.05');
    if (floors(s)) continue;
    if (s.pilot.kind === 'AI' && !tuning.ai.difficulties[s.pilot.difficulty]) throw new RangeError(`Unknown AI difficulty "${s.pilot.difficulty}"`);
    if (s.pilot.kind === 'AI' && s.pilot.style !== undefined && s.pilot.style !== RANDOM_PICK && !tuning.ai.styles[s.pilot.style]) throw new RangeError(`Unknown AI Style "${s.pilot.style}"`);
    if (s.pilot.kind === 'AI' && s.weapon !== undefined && !tuning.weapons[s.weapon]) throw new RangeError(`Unknown Weapon "${s.weapon}"`);
    if (s.troop !== undefined) {
      if (s.pilot.kind !== 'AI') throw new RangeError('Only an AI slot fights as a Troop');
      if (format !== 'Duels') throw new RangeError('Only Duels field a Delver Troop');
      slotTroop(tuning, s);
    }
  }
}

/** Throws unless a Battle's Lineup is its Players' slots alone (no AI: the Pool's other slots are the Bubbles'), at most MAX_TEAM_SIZE a Team. */
function checkBattleTeams(lineup: Lineup): void {
  if (lineup.some((s) => s.pilot.kind !== 'Player')) throw new RangeError("A Battle's Lineup names only its Players: the Fighter Pool's other slots are the Bubbles'");
  for (const t of [0, 1]) {
    const size = lineup.filter((s) => s.team === t).length;
    if (size > MAX_TEAM_SIZE) throw new RangeError(`A Battle fields at most ${MAX_TEAM_SIZE} Players on Team ${t}, got ${size}`);
  }
  if (!lineup.every((s) => s.team === 0 || s.team === 1)) throw new RangeError("Every Player's team must be 0 or 1");
}

/**
 * The Match options for a Lineup: its teams, each Fighter's Weapon (Player p's from `playerWeapons[p]`) and Size, and for a
 * Gauntlet how many human Players its party fields (`humans`, which sizes the Warbands) and which Fighters they drive
 * (`players`, whose standing counts at the Stairs), and its traitors, so every peer building the Match from the same Lineup gets the same.
 * Duels never read them, and keep the defaults. A slot with a Troop fields the Troop's Weapon and Size, and its Body, HP and Mods
 * (`troops`, absent when no slot has one, so a Lineup without Troops gives the options it always did).
 */
export function lineupMatch(tuning: TuningData, lineup: Lineup, playerWeapons: readonly string[], options: MatchOptions): MatchOptions {
  const troops = lineup.map((s) => slotTroop(tuning, s));
  const weapons = lineup.map((s, i) => troops[i]?.weapon ?? (s.pilot.kind === 'Player' ? playerWeapons[s.pilot.player] : s.weapon) ?? defaultWeaponName(tuning));
  const gauntlet = options.format === 'Gauntlet';
  const players = lineup.flatMap((s, i) => (s.pilot.kind === 'Player' && (!gauntlet || s.team === 0) ? [i] : []));
  // A Run's Team 1 Players are its traitors (docs/plans/delver.md, Stage 8a): each with its own Size, in Lineup order.
  const traitors = gauntlet ? lineup.filter((s) => s.team === 1 && s.pilot.kind === 'Player').map((s) => (s.size ? { size: s.size } : {})) : [];
  return {
    ...options,
    teams: lineup.map((s) => s.team),
    weapons,
    sizes: lineup.map((s, i) => troops[i]?.size ?? s.size),
    ...(gauntlet ? { humans: players.length, players } : {}),
    ...(traitors.length > 0 ? { traitors } : {}),
    ...(troops.some((t) => t) ? { troops: troops.map((t) => t && { body: t.body, maxHp: t.maxHp, mods: t.mods }) } : {}),
  };
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
 * A fresh AI Controller for each AI slot; null for each Player's slot. In a Battle, one entry per Fighter Pool slot: the
 * Players' (null), then a Pool AI on every other slot (`poolControllers`). In a Gauntlet (a Run, docs/plans/delver.md) the party's entries,
 * each Team 0 AI an Ally AI (walking with the party's Players), then a Pool AI on every Pool slot from the party's size to `bubble.poolSize`:
 * the Lineup's Team 1 slots are dropped (the Floors' enemies are the Crowd's; a traitor plays a Pool slot, which a Pool AI drives once it
 * leaves). `match` is the Match's options: its seed picks each RANDOM_PICK Style (`lineupStyle`). In Duels, a slot with a Troop gets an AI of
 * its Troop's difficulty and Style.
 */
export function lineupAis(tuning: TuningData, lineup: Lineup, format: MatchFormat = 'Duels', match: Pick<MatchOptions, 'seed'> = {}): (Controller | null)[] {
  if (format === 'Battle') return Array.from({ length: tuning.battle.bubble.poolSize }, (_, k) => (k < lineup.length ? null : createPoolAi(tuning)));
  if (format === 'Gauntlet') {
    const party = lineup.filter((s) => s.team === 0);
    const own = lineup.flatMap((s, i) => (s.pilot.kind === 'Player' && s.team === 0 ? [i] : []));
    const ais = party.map((s, i) => (s.pilot.kind !== 'AI' ? null : createAllyAi(tuning, s.pilot.difficulty, lineupStyle(tuning, s.pilot.style, match.seed ?? 1, i), own)));
    return [...ais, ...Array.from({ length: tuning.battle.bubble.poolSize - ais.length }, () => createPoolAi(tuning))];
  }
  return lineup.map((s, i) => {
    if (s.pilot.kind !== 'AI') return null;
    // A Troop plays its Variant's difficulty and Style (Stage 4 of docs/plans/enemy-behaviours.md adds its Quirks here).
    const troop = slotTroop(tuning, s);
    return troop ? createAiController(tuning, troop.difficulty, troop.style) : createAiController(tuning, s.pilot.difficulty, lineupStyle(tuning, s.pilot.style, match.seed ?? 1, i));
  });
}
