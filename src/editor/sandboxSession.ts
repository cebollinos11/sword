/**
 * The Editor sandbox's timeline: a Duel or Match stepped live by Controllers,
 * with every Tick kept as a snapshot so it can be paused, stepped one Tick,
 * scrubbed back and forth, and resumed (no DOM, no three.js; unit-tested).
 *
 * Determinism across a scrub: Simulation states are immutable, so the stored
 * state at a Tick is its snapshot. Controllers with memory (the AI keeps its
 * own generator outside SimState) are saved alongside every Tick and loaded
 * back before resuming from a scrubbed-to Tick, so they give the same Intents
 * again. Resuming re-simulates each Tick and checks it against the stored
 * future: the same Intents must give the same state (otherwise `divergence`
 * records the Tick), while different Intents (a player doing something else
 * after a scrub) start a branch and drop the old future.
 */
import { createMatch, hashValue, step, stepMatch, type Intent, type MatchOptions, type MatchState, type SimState, type TimedEvent } from '../sim';
import type { TuningData } from '../tuning';
import { createAiController, createTestOpponent, isTestOpponent, type Controller } from '../controllers';

/** How the sandbox steps one kind of run (a bare Duel, or a Match of Duels). */
export interface Sandbox<S> {
  /** The Duel inside the run: what Controllers see and what is drawn. */
  duel(state: S): SimState;
  step(state: S, intents: readonly Intent[]): S;
  /** Nothing more to play (the Match is over). */
  over(state: S): boolean;
}

/** A single Duel, played on past its end (Recovery keeps animating) for as long as the caller advances it. */
export function duelSandbox(tuning: TuningData): Sandbox<SimState> {
  return { duel: (s) => s, step: (s, intents) => step(s, intents, tuning), over: () => false };
}

/** A best-of-N Match. Its index in the session is the Match Tick. */
export function matchSandbox(tuning: TuningData): Sandbox<MatchState> {
  return { duel: (m) => m.duel, step: (m, intents) => stepMatch(m, intents, tuning), over: (m) => m.status.status === 'Over' };
}

/** A Duel event shown in the sandbox's event log: everything but footsteps, which would crowd every other event out of a short log. */
export type LoggedEvent = Exclude<TimedEvent, { readonly type: 'Step' }>;
const isLogged = (e: TimedEvent): e is LoggedEvent => e.type !== 'Step';

export interface SandboxSession<S> {
  /** The Tick being shown (an index into `history`). */
  readonly cursor: number;
  /** The last Tick computed so far (`history.length - 1`). */
  readonly frontier: number;
  /** The state at the cursor. */
  readonly state: S;
  /** `history[t]` is the state after t Ticks, up to the frontier. */
  readonly history: readonly S[];
  /** The state at the cursor ends the run (Match over). */
  readonly over: boolean;
  /** The first Tick where re-simulating with the same Intents gave a different state, or null (it never should). */
  readonly divergence: number | null;
  /** Move the cursor to an already computed Tick (0..frontier). */
  seek(tick: number): void;
  /** Move the cursor back one Tick (stays at 0). */
  stepBack(): void;
  /** Step one Tick forward from the cursor, asking the Controllers for Intents. */
  advance(): S;
  /** Up to `count` of the latest Duel events (footsteps left out) at or before Tick `tick`, oldest first, tagged with their Tick. */
  recentEvents(tick: number, count: number): LoggedEvent[];
}

export interface PlayerVsAiSandboxOptions extends MatchOptions {
  /** An AI difficulty preset name from Tuning Data (`ai.difficulties`), or a test opponent (`TEST_OPPONENTS`: Dummy, Wall, Runner). */
  readonly opponent: string;
}

/**
 * A live Player vs AI Match: `player` (the Local Controller) drives Fighter 0,
 * an AI Controller (or a test opponent) Fighter 1. Nothing is precomputed; the frontier grows as
 * the run is played. Scrubbing back and playing on retakes from that Tick: the
 * AI's memory is restored, and the first Tick the player does something
 * different starts a branch (the old future is dropped). It is fought in the Editor's Arena
 * (Tuning Data `arena.editor`) unless `options.arena` names another.
 */
export function playerVsAiSession(
  tuning: TuningData,
  player: Controller,
  options: PlayerVsAiSandboxOptions,
  /** The Match sandbox to step through, e.g. wrapped by `recordingSandbox` to record a golden replay. */
  sandbox: Sandbox<MatchState> = matchSandbox(tuning),
): SandboxSession<MatchState> {
  const { opponent, ...match } = options;
  const other = isTestOpponent(opponent) ? createTestOpponent(opponent) : createAiController(tuning, opponent);
  return createSandboxSession(sandbox, createMatch(tuning, { arena: tuning.arena.editor, ...match }), [player, other]);
}

/** A live run's scrub slider grows in steps of this many Ticks (its range can only be set by rebuilding it). */
export const LIVE_SCRUB_CHUNK = 600;

/** The scrub slider's upper end for a live run whose frontier is `frontier`: rounded up to whole chunks. */
export function liveScrubMax(frontier: number): number {
  return Math.max(1, Math.ceil(frontier / LIVE_SCRUB_CHUNK)) * LIVE_SCRUB_CHUNK;
}

interface Saved {
  /** Each Controller's memory before it decides this Tick. */
  readonly controllers: readonly unknown[];
  /** The Intents chosen at this Tick (once it has been stepped from). */
  intents: string | null;
}

export function createSandboxSession<S>(sandbox: Sandbox<S>, initial: S, controllers: readonly Controller[]): SandboxSession<S> {
  const states: S[] = [initial];
  const saved: Saved[] = [{ controllers: controllers.map((c) => c.save?.()), intents: null }];
  let cursor = 0;
  /** The Tick the Controllers' live memory belongs to. */
  let controllersAt = 0;
  let divergence: number | null = null;

  const truncateAfter = (t: number) => {
    states.length = t + 1;
    saved.length = t + 1;
  };

  return {
    get cursor() {
      return cursor;
    },
    get frontier() {
      return states.length - 1;
    },
    get state() {
      return states[cursor]!;
    },
    history: states,
    get over() {
      return sandbox.over(states[cursor]!);
    },
    get divergence() {
      return divergence;
    },
    seek(tick) {
      if (!Number.isInteger(tick) || tick < 0 || tick >= states.length) throw new RangeError(`Tick ${tick} is outside 0..${states.length - 1}`);
      cursor = tick;
    },
    stepBack() {
      cursor = Math.max(0, cursor - 1);
    },
    advance() {
      const from = states[cursor]!;
      const here = saved[cursor]!;
      if (controllersAt !== cursor) controllers.forEach((c, i) => c.load?.(here.controllers[i]));
      const duel = sandbox.duel(from);
      const intents = controllers.map((c, i) => c.intent(duel, i));
      const next = sandbox.step(from, intents);
      const key = hashValue(intents);
      const memory = controllers.map((c) => c.save?.());
      const t = cursor + 1;
      controllersAt = t;
      const known = states[t];
      if (known !== undefined && here.intents === key) {
        if (hashValue(known) === hashValue(next)) {
          cursor = t;
          return known;
        }
        divergence ??= t;
      }
      truncateAfter(cursor);
      here.intents = key;
      states.push(next);
      saved.push({ controllers: memory, intents: null });
      cursor = t;
      return next;
    },
    recentEvents(tick, count) {
      const found: LoggedEvent[] = [];
      for (let t = Math.min(tick, states.length - 1); t >= 0 && found.length < count; t--) {
        const events = sandbox.duel(states[t]!).events;
        for (let k = events.length - 1; k >= 0 && found.length < count; k--) {
          const e: TimedEvent = { ...events[k]!, tick: t };
          if (isLogged(e)) found.push(e);
        }
      }
      return found.reverse();
    },
  };
}
