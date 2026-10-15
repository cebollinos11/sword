/**
 * Chambers: countering an incoming Attack by attacking into it at the
 * right moment. Decided by rule, like a Block (ADR 0002), once per Tick after
 * every Fighter's Action has advanced and before Blade Sweeps are tested.
 *
 * Fighter C chambers Fighter A's Attack on a Tick when ALL of these hold:
 *   1. C started an Attack this Tick: its Action is an Attack in Wind-up and
 *      last Tick it was not already winding up that same Direction (a fresh
 *      press from Idle, or a cancel into a new Direction, counts; a held
 *      Wind-up does not).
 *   2. C's Attack is in the mirrored Direction of A's Attack (the Direction a
 *      Block would need to stop it, so the blades meet on the same side).
 *   3. A's Attack is in Release, has not landed, and this Tick is within the
 *      Chamber window: Ticks since A's Release began (1 = its first Release
 *      Tick) is between 1 and `chamberWindowTicks(tuning)` inclusive. Wind-up
 *      (even held) and Recovery never count.
 *   4. C roughly faces A (the same facing rule as a Block).
 *
 * Outcome: A's Attack is cancelled: A Staggers with cause `Chambered` (so its
 * Blade Sweep is no longer live and cannot land this Tick or later). C's own
 * Attack carries on unchanged through Wind-up, Release and Recovery. Events:
 * `Chamber{chamberer: C, attacker: A, direction}` (A's Direction), then `Stagger{fighter: A}`.
 * All Chambers of a Tick are judged against the same pre-resolution state.
 */
import type { TuningData } from '../tuning';
import { attackTimings, roughlyFaces } from './actions';
import { staggerFighter } from './combat';
import { secondsToTicks } from './constants';
import type { Emit } from './events';
import { mirrorDirection } from './intent';
import type { Action, FighterState } from './state';

/** The Chamber window (Tuning Data `chamber.windowSeconds`, seconds) in Ticks. */
export const chamberWindowTicks = (tuning: TuningData): number => secondsToTicks(tuning.chamber.windowSeconds);

/** Rule 1: `next` is an Attack whose Wind-up began this Tick. */
function startedAttack(prev: Action, next: Action): boolean {
  if (next.kind !== 'Attack' || next.phase !== 'Wind-up') return false;
  return !(prev.kind === 'Attack' && prev.phase === 'Wind-up' && prev.direction === next.direction);
}

/** Rule 3: `f` has an un-landed Attack in Release, inside the Chamber window. */
function chamberable(f: FighterState, tuning: TuningData): boolean {
  const a = f.action;
  if (a.kind !== 'Attack' || a.phase !== 'Release' || a.landed) return false;
  const sinceRelease = f.motion.tick - attackTimings(tuning, f.weapon, a.direction).windUpEnd;
  return sinceRelease >= 1 && sinceRelease <= chamberWindowTicks(tuning);
}

/** Apply this Tick's Chambers to the freshly advanced Fighters (`prev` = last Tick's). */
export function resolveChambers(
  prev: readonly FighterState[],
  next: readonly FighterState[],
  tuning: TuningData,
  emit: Emit,
): FighterState[] {
  const out = next.slice();
  next.forEach((chamberer, c) => {
    const before = prev[c];
    if (!before || chamberer.death || !startedAttack(before.action, chamberer.action) || chamberer.action.kind !== 'Attack') return;
    const direction = chamberer.action.direction;
    next.forEach((attacker, a) => {
      if (a === c || attacker.death || attacker.action.kind !== 'Attack' || attacker.action.direction !== mirrorDirection(direction)) return;
      if (!chamberable(attacker, tuning) || !roughlyFaces(chamberer, attacker, tuning)) return;
      emit({ type: 'Chamber', chamberer: c, attacker: a, direction: attacker.action.direction });
      if (out[a]!.action.kind !== 'Stagger') out[a] = staggerFighter(out[a]!, a, 'Chambered', tuning, emit);
    });
  });
  return out;
}
