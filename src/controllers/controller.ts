/**
 * Controllers: the sources of Fighters' Intents (Local, AI, Remote). They live
 * outside the Simulation and talk to it only through Intents, so a Fighter
 * never knows which kind drives it.
 */
import {
  intentAt,
  SETTLE_TICKS,
  step,
  stepMatch,
  type Intent,
  type MatchState,
  type ScriptRun,
  type SimState,
  type TimedEvent,
  type Track,
} from '../sim';
import type { TuningData } from '../tuning';

/**
 * Yields one Intent per Tick for one Fighter. Called exactly once per Tick, in
 * Tick order, with the state about to be stepped (`state.tick` is the Tick
 * being decided). A Controller may keep memory between calls; a new Duel shows
 * up as `state.tick` going back to 0.
 */
export interface Controller {
  intent(state: SimState, fighter: number): Intent;
}

/** A Controller that plays back a scripted Track (Tick t of the Duel gets the Track's Intent t). */
export function scriptedController(track: Track): Controller {
  return { intent: (state) => intentAt(track, state.tick) };
}

/** Ask every Controller for its Intent this Tick (`controllers[i]` drives Fighter i). */
export function controllerIntents(state: SimState, controllers: readonly Controller[]): Intent[] {
  return controllers.map((c, i) => c.intent(state, i));
}

/** Run a Duel driven by Controllers for `ticks` Ticks (default SETTLE_TICKS). Same shape as a scripted run. */
export function runControllers(tuning: TuningData, initial: SimState, controllers: readonly Controller[], ticks = SETTLE_TICKS): ScriptRun {
  const states: SimState[] = [initial];
  const events: TimedEvent[] = [];
  let s = initial;
  for (let t = 0; t < ticks; t++) {
    s = step(s, controllerIntents(s, controllers), tuning);
    states.push(s);
    for (const e of s.events) events.push({ ...e, tick: s.tick });
  }
  return { states, final: s, events };
}

/** One Match Tick: the Controllers decide on the current Duel, then the Match steps. */
export function stepMatchWith(match: MatchState, controllers: readonly Controller[], tuning: TuningData): MatchState {
  return stepMatch(match, controllerIntents(match.duel, controllers), tuning);
}

export interface MatchRun {
  /** `matches[k]` is the Match after k Match Ticks; `matches[0]` is the start. */
  readonly matches: readonly MatchState[];
  readonly final: MatchState;
}

/** Run a Match driven by Controllers until it is over, or for at most `maxTicks` Match Ticks. */
export function runMatch(tuning: TuningData, start: MatchState, controllers: readonly Controller[], maxTicks: number): MatchRun {
  const matches: MatchState[] = [start];
  let m = start;
  for (let t = 0; t < maxTicks && m.status.status !== 'Over'; t++) {
    m = stepMatchWith(m, controllers, tuning);
    matches.push(m);
  }
  return { matches, final: m };
}
