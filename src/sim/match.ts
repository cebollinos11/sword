/**
 * Match progression: a best-of-N sequence of Duels.
 *
 * A Match wraps the current Duel's SimState. `stepMatch` steps that Duel;
 * when it ends, the score updates on the same Tick, the finished Duel stays
 * frozen for `interDuelTicks` (so its end can be seen), and then the next
 * Duel starts with both Fighters back at their starting positions and full
 * HP. The Match ends once a Fighter has won a majority of N Duels. A drawn
 * Duel scores for nobody and is simply replayed.
 *
 * Like SimState, MatchState is plain JSON-like data and `stepMatch` is pure,
 * so a whole Match hashes (`hashValue`) and snapshots (`snapshot`) exactly
 * for Rollback.
 */
import { defaultWeaponName, weaponByName, type TuningData } from '../tuning';
import { secondsToTicks } from './constants';
import type { Intent } from './intent';
import type { SimState } from './state';
import { createInitialState, duelPlacements, step } from './step';

export interface MatchConfig {
  /** N: the Match is best of this many Duels. A positive integer. */
  readonly bestOf: number;
  /** Starting distance between the Fighters at the start of every Duel (metres). */
  readonly distance: number;
  /** Ticks between a Duel ending and the next one starting (at least 1). */
  readonly interDuelTicks: number;
  /** Each Fighter's Weapon (a Tuning Data Weapon name), kept across Duels. */
  readonly weapons: readonly string[];
}

export interface MatchOptions extends Partial<MatchConfig> {
  readonly bestOf: number;
  /** Seeds the Simulation's generator; it carries over from Duel to Duel. */
  readonly seed?: number;
}

export type MatchStatus = { readonly status: 'InProgress' } | { readonly status: 'Over'; readonly winner: number; readonly tick: number };

/** A new Duel of the Match began (Fighters reset). */
export interface DuelStartEvent {
  readonly type: 'DuelStart';
  /** 1-based. */
  readonly duelNumber: number;
}

/** A Fighter reached the winning number of Duels. */
export interface MatchEndEvent {
  readonly type: 'MatchEnd';
  readonly winner: number;
  readonly score: readonly number[];
}

/** Match-level events of one Match Tick. Duel events stay on `duel.events`. */
export type MatchEvent = DuelStartEvent | MatchEndEvent;

export interface MatchState {
  readonly config: MatchConfig;
  /** Match Ticks since the Match started (Duel ticks restart at 0 each Duel). */
  readonly tick: number;
  /** 1-based number of the current Duel, draws included. */
  readonly duelNumber: number;
  /** Duels won by each Fighter. */
  readonly score: readonly number[];
  /** The current Duel. */
  readonly duel: SimState;
  /** The Match Tick on which the next Duel starts, or null while a Duel is being fought (or the Match is over). */
  readonly nextDuelTick: number | null;
  readonly status: MatchStatus;
  readonly events: readonly MatchEvent[];
}

/** Duel wins needed to take a best-of-N Match: a strict majority. */
export function duelsToWin(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

function freshDuel(tuning: TuningData, config: MatchConfig, rng: SimState['rng']): SimState {
  return { ...createInitialState(tuning, 0, duelPlacements(config.distance), config.weapons), rng };
}

/** A Match at Tick 0: Duel 1 about to be fought, score 0–0. Throws on an unknown Weapon name. */
export function createMatch(tuning: TuningData, options: MatchOptions): MatchState {
  const config: MatchConfig = {
    bestOf: options.bestOf,
    distance: options.distance ?? tuning.match.duelDistance,
    interDuelTicks: options.interDuelTicks ?? secondsToTicks(tuning.match.interDuelSeconds),
    weapons: [0, 1].map((i) => weaponByName(tuning, options.weapons?.[i] ?? defaultWeaponName(tuning)).name),
  };
  if (!Number.isInteger(config.bestOf) || config.bestOf < 1) throw new RangeError(`bestOf must be a positive integer, got ${config.bestOf}`);
  if (!Number.isInteger(config.interDuelTicks) || config.interDuelTicks < 1)
    throw new RangeError(`interDuelTicks must be an integer >= 1, got ${config.interDuelTicks}`);
  const duel = createInitialState(tuning, options.seed ?? 1, duelPlacements(config.distance), config.weapons);
  return {
    config,
    tick: 0,
    duelNumber: 1,
    score: duel.fighters.map(() => 0),
    duel,
    nextDuelTick: null,
    status: { status: 'InProgress' },
    events: [],
  };
}

/**
 * Advance the Match by one Tick. Pure: never mutates `match`.
 * `intents[i]` drives Fighter i of the current Duel (ignored between Duels).
 */
export function stepMatch(match: MatchState, intents: readonly Intent[], tuning: TuningData): MatchState {
  const tick = match.tick + 1;
  const events: MatchEvent[] = [];

  if (match.nextDuelTick !== null && tick >= match.nextDuelTick) {
    const duelNumber = match.duelNumber + 1;
    events.push({ type: 'DuelStart', duelNumber });
    return { ...match, tick, duelNumber, duel: freshDuel(tuning, match.config, match.duel.rng), nextDuelTick: null, events };
  }

  const duel = step(match.duel, intents, tuning);
  let { score, status, nextDuelTick } = match;
  if (match.duel.duel.status === 'Fighting' && duel.duel.status === 'Over') {
    const { winner } = duel.duel;
    if (winner !== null) score = score.map((s, i) => (i === winner ? s + 1 : s));
    if (winner !== null && score[winner]! >= duelsToWin(match.config.bestOf)) {
      status = { status: 'Over', winner, tick };
      events.push({ type: 'MatchEnd', winner, score });
    } else {
      nextDuelTick = tick + match.config.interDuelTicks;
    }
  }
  return { ...match, tick, score, duel, nextDuelTick, status, events };
}
