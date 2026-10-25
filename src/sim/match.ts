/**
 * Match progression: a best-of-N sequence of Duels between two teams.
 *
 * Each Fighter is on team 0 or 1 (`teams`, default one Fighter a side), at
 * most MAX_TEAM_SIZE a side. A Match wraps the current Duel's SimState.
 * `stepMatch` steps that Duel; when the last Fighter of a team falls, the
 * Duel ends and the other team scores on the same Tick, the finished Duel stays
 * frozen for `interDuelTicks` (so its end can be seen), and then the next
 * Duel starts with every Fighter back at its starting position and full
 * HP. The Match ends once a team has won a majority of N Duels. A drawn
 * Duel scores for nobody and is simply replayed.
 *
 * In Gauntlet format (docs/plans/gauntlet.md) the Match is a Run instead: each
 * Duel is a Floor on its own Arena, against the enemies Tuning Data lists for it
 * (`floorDuel`), HP carrying over; the Run ends when Team 0 loses a Floor or
 * clears the last.
 *
 * Like SimState, MatchState is plain JSON-like data and `stepMatch` is pure,
 * so a whole Match hashes (`hashValue`) and snapshots (`snapshot`) exactly
 * for Rollback.
 */
import { defaultWeaponName, weaponByName, type TuningData } from '../tuning';
import { secondsToTicks } from './constants';
import type { Intent } from './intent';
import type { SimState } from './state';
import { arenaOf } from './arena';
import { nextArenaName } from './arenaGen/named';
import { inDuel } from './duel';
import { floorRoster } from './gauntlet';
import { createRng } from './rng';
import type { Placement } from './skeleton';
import { createInitialState, step, teamPlacements } from './step';

/** The most Fighters a team may field. */
export const MAX_TEAM_SIZE = 4;

/** How a Match is played: Duels (best-of-N, the default) or Gauntlet (a Run of Floors). */
export type MatchFormat = 'Duels' | 'Gauntlet';
export const MATCH_FORMATS: readonly MatchFormat[] = ['Duels', 'Gauntlet'];

export interface MatchConfig {
  /** Duels (default) or Gauntlet: a Run, where `bestOf` is ignored and `teams` is Team 0's 1 to MAX_TEAM_SIZE Fighters followed by MAX_TEAM_SIZE Team 1 slots. */
  readonly format: MatchFormat;
  /** N: the Match is best of this many Duels. A positive integer. */
  readonly bestOf: number;
  /** Starting distance between the two teams' lines at the start of every Duel (metres). */
  readonly distance: number;
  /** Starting distance between teammates side by side in a line (metres). */
  readonly spacing: number;
  /** Ticks between a Duel ending and the next one starting (at least 1); in a Run, between Floors (default `gauntlet.interFloorSeconds`). */
  readonly interDuelTicks: number;
  /** Each Fighter's Weapon (a Tuning Data Weapon name), kept across Duels. */
  readonly weapons: readonly string[];
  /** Each Fighter's team (0 or 1); its length is the number of Fighters. */
  readonly teams: readonly number[];
  /** Ticks after the Match ends before a fresh Match (same config, score 0–0) starts, or null for none (the default). */
  readonly rematchTicks: number | null;
  /**
   * The Arena the first Match's Duels are fought in (a Tuning Data Arena name, or a Generated Arena's `gen:<kit>:<seed>`;
   * default `arena.match`); each Rematch moves to the next (`MatchState.arena`). Fighters start at its spawns when it
   * has one for each, else in two facing lines (`distance`, `spacing`).
   */
  readonly arena: string;
  /**
   * How many human Players the Lineup fields (default 1; `lineupMatch` fills it for a Gauntlet, and Duels never read it).
   * A Run scales its enemies' max HP with it, so it is fixed for the Run: an AI Takeover never changes it. 1 to Team 0's size in a Run.
   */
  readonly humans: number;
}

export interface MatchOptions extends Partial<MatchConfig> {
  readonly bestOf: number;
  /** Seeds the Simulation's generator; it carries over from Duel to Duel. */
  readonly seed?: number;
}

/** `winner` is a team (0 or 1). */
export type MatchStatus = { readonly status: 'InProgress' } | { readonly status: 'Over'; readonly winner: number; readonly tick: number };

/** A new Duel of the Match began (Fighters reset). */
export interface DuelStartEvent {
  readonly type: 'DuelStart';
  /** 1-based. */
  readonly duelNumber: number;
}

/** A team reached the winning number of Duels. */
export interface MatchEndEvent {
  readonly type: 'MatchEnd';
  readonly winner: number;
  readonly score: readonly number[];
}

/** A Run ended: Team 0 lost (or drew) a Floor, `winner` 1, or cleared the last, `winner` 0. */
export interface RunEndEvent {
  readonly type: 'RunEnd';
  readonly winner: number;
  /** Floors Team 0 cleared. */
  readonly cleared: number;
  readonly floors: number;
}

/** Match-level events of one Match Tick. Duel events stay on `duel.events`. */
export type MatchEvent = DuelStartEvent | MatchEndEvent | RunEndEvent;

/** A Gauntlet Run's progress (`MatchState.run`). */
export interface RunState {
  /** The Floor being fought, or just fought (1-based); the current Duel's `floor`. */
  readonly floor: number;
  /** Floors in the Run (Tuning Data `gauntlet.floors`); the last is the boss. */
  readonly floors: number;
  /** Floors Team 0 has cleared. */
  readonly cleared: number;
  /** The Match Tick the Run started on. */
  readonly startTick: number;
}

export interface MatchState {
  readonly config: MatchConfig;
  /** 1-based number of this Match, counting rematches (see `rematchTicks`). */
  readonly matchNumber: number;
  /**
   * The Arena this Match's Duels are fought in, every one of them: `config.arena` for the first Match, and at each
   * Rematch the next (`nextArenaName`: a Random Map's next seed, a hand-made Arena itself), which every peer builds.
   * In a Run, the current Floor's: `config.arena` for Floor 1, the next one for each Floor after.
   */
  readonly arena: string;
  /** Match Ticks since the first Match started, carried across rematches (Duel ticks restart at 0 each Duel). */
  readonly tick: number;
  /** 1-based number of the current Duel, draws included. */
  readonly duelNumber: number;
  /** Duels won by each team (team 0, team 1). */
  readonly score: readonly number[];
  /** The current Duel. */
  readonly duel: SimState;
  /** The Match Tick on which the next Duel starts, or null while a Duel is being fought (or the Match is over). */
  readonly nextDuelTick: number | null;
  readonly status: MatchStatus;
  readonly events: readonly MatchEvent[];
  /** The Run, in Gauntlet format; null in Duels. */
  readonly run: RunState | null;
}

/** Duel wins needed to take a best-of-N Match: a strict majority. */
export function duelsToWin(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

/** Throws unless `teams` puts 1 to MAX_TEAM_SIZE Fighters on each of team 0 and team 1. */
export function checkTeams(teams: readonly number[]): void {
  if (!teams.every((t) => t === 0 || t === 1)) throw new RangeError(`Every Fighter's team must be 0 or 1, got [${teams.join(', ')}]`);
  for (const t of [0, 1]) {
    const size = teams.filter((team) => team === t).length;
    if (size < 1 || size > MAX_TEAM_SIZE) throw new RangeError(`Team ${t} must field 1 to ${MAX_TEAM_SIZE} Fighters, got ${size}`);
  }
}

/** Throws unless `teams` is a Run's: Team 0's 1 to MAX_TEAM_SIZE Fighters, then exactly MAX_TEAM_SIZE Team 1 slots. */
export function checkRunTeams(teams: readonly number[]): void {
  checkTeams(teams);
  const own = teams.indexOf(1);
  if (teams.length - own !== MAX_TEAM_SIZE || teams.slice(own).some((t) => t !== 1))
    throw new RangeError(`A Run's teams must be Team 0's Fighters followed by ${MAX_TEAM_SIZE} Team 1 slots, got [${teams.join(', ')}]`);
}

/** Where each Fighter starts: team t's k-th Fighter at the Arena's spawn for (t, k), or (if any is missing) in two facing lines. */
function startPlacements(tuning: TuningData, config: MatchConfig, arena: string): Placement[] {
  const { spawns } = arenaOf(tuning, arena);
  const seen = [0, 0];
  const placed = config.teams.map((team) => {
    const slot = seen[team]!++;
    const s = spawns.find((p) => p.team === team && p.slot === slot);
    return s && { position: { x: s.position.x, z: s.position.z }, y: s.position.y, facing: s.facing };
  });
  return placed.every((p) => p !== undefined) ? placed : teamPlacements(config.teams, config.distance, config.spacing);
}

function initialDuel(tuning: TuningData, config: MatchConfig, arena: string, seed: number): SimState {
  return createInitialState(tuning, seed, startPlacements(tuning, config, arena), config.weapons, config.teams, arena);
}

function freshDuel(tuning: TuningData, config: MatchConfig, arena: string, rng: SimState['rng']): SimState {
  return { ...initialDuel(tuning, config, arena, 0), rng };
}

/**
 * A Run's Floor `floor` (1-based) on `arena`, replacing `freshDuel`: every Fighter at the Arena's spawns, drawn, daggers
 * refilled. Team 0 keeps its HP from `previous` (the Floor before; null for Floor 1: full HP), plus `gauntlet.heal` of its
 * max HP, and a fallen one comes back at `gauntlet.revive` of it. Each Team 1 slot holds the Floor's enemy for it, with
 * its Weapon and scaled max HP (`floorRoster`), or is Benched when the Floor has none for it.
 */
function floorDuel(tuning: TuningData, config: MatchConfig, floor: number, previous: SimState | null, arena: string, rng: SimState['rng']): SimState {
  const roster = floorRoster(tuning, config, floor);
  let slot = 0;
  const enemies = config.teams.map((team) => (team === 1 ? roster[slot++] ?? null : null));
  const weapons = config.weapons.map((w, i) => enemies[i]?.weapon ?? w);
  const base = createInitialState(tuning, 0, startPlacements(tuning, config, arena), weapons, config.teams, arena);
  const { heal, revive } = tuning.gauntlet;
  const fighters = base.fighters.map((f, i) => {
    if (f.team === 1) {
      const enemy = enemies[i];
      return enemy ? { ...f, hp: enemy.maxHp, maxHp: enemy.maxHp } : { ...f, hp: 0, benched: true as const };
    }
    const before = previous?.fighters[i];
    if (!before) return f;
    return { ...f, hp: inDuel(before) ? Math.min(f.maxHp, before.hp + heal * f.maxHp) : revive * f.maxHp };
  });
  return { ...base, rng, fighters, floor };
}

/** A Match at Tick 0: Duel 1 (or a Run's Floor 1) about to be fought, score 0–0. Throws on an unknown Weapon name or an invalid lineup. */
export function createMatch(tuning: TuningData, options: MatchOptions): MatchState {
  const format = options.format ?? 'Duels';
  if (!MATCH_FORMATS.includes(format)) throw new RangeError(`format must be one of ${MATCH_FORMATS.join(', ')}, got ${String(format)}`);
  const gauntlet = format === 'Gauntlet';
  const teams = options.teams ?? [0, 1];
  if (gauntlet) checkRunTeams(teams);
  else checkTeams(teams);
  const config: MatchConfig = {
    format,
    bestOf: options.bestOf,
    distance: options.distance ?? tuning.match.duelDistance,
    spacing: options.spacing ?? tuning.match.lineSpacing,
    interDuelTicks: options.interDuelTicks ?? secondsToTicks(gauntlet ? tuning.gauntlet.interFloorSeconds : tuning.match.interDuelSeconds),
    weapons: teams.map((_, i) => weaponByName(tuning, options.weapons?.[i] ?? defaultWeaponName(tuning)).name),
    teams: [...teams],
    rematchTicks: options.rematchTicks ?? null,
    arena: arenaOf(tuning, options.arena ?? tuning.arena.match).name,
    humans: options.humans ?? 1,
  };
  if (!Number.isInteger(config.humans) || config.humans < 0) throw new RangeError(`humans must be an integer >= 0, got ${config.humans}`);
  if (gauntlet) {
    const own = teams.filter((t) => t === 0).length;
    if (config.humans < 1 || config.humans > own) throw new RangeError(`A Run fields 1 to ${own} humans (Team 0's size), got ${config.humans}`);
    if (config.rematchTicks !== null) throw new RangeError('A Run has no Rematch: rematchTicks must be null');
  }
  if (!Number.isInteger(config.bestOf) || config.bestOf < 1) throw new RangeError(`bestOf must be a positive integer, got ${config.bestOf}`);
  if (!Number.isInteger(config.interDuelTicks) || config.interDuelTicks < 1)
    throw new RangeError(`interDuelTicks must be an integer >= 1, got ${config.interDuelTicks}`);
  if (config.rematchTicks !== null && (!Number.isInteger(config.rematchTicks) || config.rematchTicks < 1))
    throw new RangeError(`rematchTicks must be null or an integer >= 1, got ${config.rematchTicks}`);
  const seed = options.seed ?? 1;
  const duel = gauntlet ? floorDuel(tuning, config, 1, null, config.arena, createRng(seed)) : initialDuel(tuning, config, config.arena, seed);
  return {
    config,
    matchNumber: 1,
    arena: config.arena,
    tick: 0,
    duelNumber: 1,
    score: [0, 0],
    duel,
    nextDuelTick: null,
    status: { status: 'InProgress' },
    events: [{ type: 'DuelStart', duelNumber: 1 }],
    run: gauntlet ? { floor: 1, floors: tuning.gauntlet.floors.length, cleared: 0, startTick: 0 } : null,
  };
}

/** The Fighters on `team`, by index. */
export function teamMembers(match: MatchState, team: number): number[] {
  return match.config.teams.flatMap((t, i) => (t === team ? [i] : []));
}

/**
 * Advance the Match by one Tick. Pure: never mutates `match`.
 * `intents[i]` drives Fighter i of the current Duel (ignored between Duels).
 */
export function stepMatch(match: MatchState, intents: readonly Intent[], tuning: TuningData): MatchState {
  const tick = match.tick + 1;
  const events: MatchEvent[] = [];

  const { status: over, config } = match;
  if (over.status === 'Over' && config.rematchTicks !== null && tick >= over.tick + config.rematchTicks) {
    // A fresh Match: Duel 1, score 0–0, the generator carried on so it isn't a replay of the last one, on the next
    // Arena (a Random Map's next seed; the game builds it ahead, while the result shows, so this Tick only reads it).
    events.push({ type: 'DuelStart', duelNumber: 1 });
    const arena = nextArenaName(match.arena);
    return {
      ...match,
      matchNumber: match.matchNumber + 1,
      arena,
      tick,
      duelNumber: 1,
      score: [0, 0],
      duel: freshDuel(tuning, match.config, arena, match.duel.rng),
      nextDuelTick: null,
      status: { status: 'InProgress' },
      events,
    };
  }

  if (match.nextDuelTick !== null && tick >= match.nextDuelTick) {
    const duelNumber = match.duelNumber + 1;
    events.push({ type: 'DuelStart', duelNumber });
    if (match.run) {
      // The next Floor, on the next Generated Arena (warmed ahead by the game, so this Tick only reads it), HP carried over.
      const floor = match.run.floor + 1;
      const arena = nextArenaName(match.arena);
      const duel = floorDuel(tuning, config, floor, match.duel, arena, match.duel.rng);
      return { ...match, tick, arena, duelNumber, duel, run: { ...match.run, floor }, nextDuelTick: null, events };
    }
    return { ...match, tick, duelNumber, duel: freshDuel(tuning, match.config, match.arena, match.duel.rng), nextDuelTick: null, events };
  }

  const duel = step(match.duel, intents, tuning);
  let { score, status, nextDuelTick, run } = match;
  if (match.duel.duel.status === 'Fighting' && duel.duel.status === 'Over') {
    const { winner } = duel.duel;
    if (winner !== null) score = score.map((s, i) => (i === winner ? s + 1 : s));
    if (run) {
      // A Floor cleared goes on to the next; a Floor lost or drawn, or the last one cleared, ends the Run.
      const cleared = run.cleared + (winner === 0 ? 1 : 0);
      run = { ...run, cleared };
      if (winner === 0 && run.floor < run.floors) {
        nextDuelTick = tick + config.interDuelTicks;
      } else {
        const runWinner = winner === 0 ? 0 : 1;
        status = { status: 'Over', winner: runWinner, tick };
        events.push({ type: 'RunEnd', winner: runWinner, cleared, floors: run.floors });
      }
    } else if (winner !== null && score[winner]! >= duelsToWin(match.config.bestOf)) {
      status = { status: 'Over', winner, tick };
      events.push({ type: 'MatchEnd', winner, score });
    } else {
      nextDuelTick = tick + match.config.interDuelTicks;
    }
  }
  return { ...match, tick, score, duel, nextDuelTick, status, events, run };
}
