/**
 * Scripted Intent sequences: a small vocabulary for writing "Fighter A does
 * this while Fighter B does that" as data, then running it through the real
 * Simulation. Used by tests and by the Editor's scripted Duel sandbox.
 *
 *   const run = runDuel(tuning, {
 *     distance: 1.3,
 *     a: [...wait(10), ...attack('Overhead', 40)],   // hold the Wind-up 40 Ticks
 *     b: walk(30, { x: 0, z: -1 }),
 *   });
 *   run.final.fighters[1].hp; run.events.filter((e) => e.type === 'Hit');
 */
import type { TuningData } from '../tuning';
import type { SimEvent } from './events';
import { IDLE_INTENT, type Direction, type Intent } from './intent';
import type { Placement } from './skeleton';
import type { SimState, Vec2 } from './state';
import { createInitialState, duelPlacements, step } from './step';

/** `ticks` consecutive Ticks of the same Intent (unset fields are Idle). */
export interface ScriptSegment {
  readonly ticks: number;
  readonly intent: Partial<Intent>;
}

/** One Fighter's script: segments played back to back, then Idle forever. */
export type Track = readonly ScriptSegment[];

export const hold = (ticks: number, intent: Partial<Intent> = {}): Track => [{ ticks, intent }];
/** Stand Idle. */
export const wait = (ticks: number): Track => hold(ticks);
/** Walk with a fixed move vector. */
export const walk = (ticks: number, move: Vec2): Track => hold(ticks, { move });
/**
 * Press attack in `direction` and hold it for `holdTicks` Ticks, then let go.
 * A Wind-up always plays to its end even if let go sooner, then Releases.
 */
export const attack = (direction: Direction = 'Overhead', holdTicks = 1): Track => hold(holdTicks, { attack: true, direction });

export const trackLength = (track: Track): number => track.reduce((n, s) => n + s.ticks, 0);

/** The Intent a Track gives on `tick` (0-based from the script start). */
export function intentAt(track: Track, tick: number): Intent {
  let t = tick;
  for (const seg of track) {
    if (t < seg.ticks) return { ...IDLE_INTENT, ...seg.intent };
    t -= seg.ticks;
  }
  return IDLE_INTENT;
}

/** Per-Tick Intents for several Tracks (`out[t][i]` drives Fighter i on Tick t). */
export function scriptIntents(tracks: readonly Track[], ticks: number): Intent[][] {
  return Array.from({ length: ticks }, (_, t) => tracks.map((track) => intentAt(track, t)));
}

/** Ticks a script runs past its longest Track by default: long enough for any Attack to finish. */
export const SETTLE_TICKS = 120;

export type TimedEvent = SimEvent & { readonly tick: number };

export interface ScriptRun {
  /** `states[k]` is the state after k Ticks; `states[0]` is the initial state. */
  readonly states: readonly SimState[];
  readonly final: SimState;
  /** Every event, tagged with the Tick of the state it appeared in. */
  readonly events: readonly TimedEvent[];
}

/** Run Tracks (one per Fighter) from `initial` for `ticks` Ticks. */
export function runScript(tuning: TuningData, initial: SimState, tracks: readonly Track[], ticks?: number): ScriptRun {
  const total = ticks ?? Math.max(0, ...tracks.map(trackLength)) + SETTLE_TICKS;
  const states: SimState[] = [initial];
  const events: TimedEvent[] = [];
  let s = initial;
  for (const intents of scriptIntents(tracks, total)) {
    s = step(s, intents, tuning);
    states.push(s);
    for (const e of s.events) events.push({ ...e, tick: s.tick });
  }
  return { states, final: s, events };
}

export interface DuelScript {
  /** Distance between the two Fighters, who face each other (default 2 m). */
  readonly distance?: number;
  /** Explicit starting placements instead of `distance`. */
  readonly placements?: readonly Placement[];
  readonly seed?: number;
  /** Each Fighter's Weapon (default: the default Weapon). */
  readonly weapons?: readonly string[];
  /** Fighter 0's Track. */
  readonly a?: Track;
  /** Fighter 1's Track. */
  readonly b?: Track;
  /** Total Ticks (default: the longest Track plus SETTLE_TICKS). */
  readonly ticks?: number;
}

/** Run a two-Fighter Duel from scripted Tracks. */
export function runDuel(tuning: TuningData, script: DuelScript): ScriptRun {
  const placements = script.placements ?? duelPlacements(script.distance ?? 2);
  const initial = createInitialState(tuning, script.seed ?? 1, placements, script.weapons);
  return runScript(tuning, initial, [script.a ?? [], script.b ?? []], script.ticks);
}
