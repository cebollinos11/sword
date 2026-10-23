/**
 * Chambers: countering an incoming Attack by attacking into it at the
 * right moment. The rule decides whether, the blades decide when (as for a
 * Block, ADR 0002): judged once per Tick after every Fighter's Action has
 * advanced and before Blade Sweeps are tested.
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
 * That only makes the Chamber pending: C joins A's Attack's `chamberedBy`,
 * and nothing happens yet. It lands when A's Blade Sweep reaches C's Weapon
 * (or, failing that, C's Hit Zones), whichever first, on this Tick or a later
 * one, while C is still in its Attack in that mirrored Direction
 * (`chamberHolds`; see `findContacts`). An Attack that reaches nothing (C out
 * of its reach) is no Chamber: it plays out as a whiff.
 *
 * Outcome, on contact: A's Attack is cancelled: A Staggers with cause `Chambered`
 * (so its Blade Sweep is no longer live). C's own Attack carries on unchanged through
 * Wind-up, Release and Recovery. Events: `Chamber{chamberer: C, attacker: A, direction, point}`
 * (A's Direction, where the blades met), then `Stagger{fighter: A}`.
 * All Chambers of a Tick are judged against the same pre-resolution state.
 */
import type { TuningData } from '../tuning';
import { attackTimings, roughlyFaces } from './actions';
import { secondsToTicks } from './constants';
import { inDuel } from './duel';
import { mirrorDirection, type Direction } from './intent';
import type { Action, AttackAction, FighterState } from './state';

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

/**
 * Whether `chamberer`'s pending Chamber of an Attack in `direction` still holds: it is in the Duel and still in
 * its Attack, in the mirrored Direction (a Stagger, or a Feint into another Direction, drops it).
 */
export function chamberHolds(chamberer: FighterState, direction: Direction): boolean {
  return inDuel(chamberer) && chamberer.action.kind === 'Attack' && chamberer.action.direction === mirrorDirection(direction);
}

/** Mark this Tick's Chambers on the freshly advanced Fighters (`prev` = last Tick's): each pending until the blades meet. */
export function resolveChambers(prev: readonly FighterState[], next: readonly FighterState[], tuning: TuningData): FighterState[] {
  const out = next.slice();
  next.forEach((chamberer, c) => {
    const before = prev[c];
    if (!before || !inDuel(chamberer) || !startedAttack(before.action, chamberer.action) || chamberer.action.kind !== 'Attack') return;
    const direction = chamberer.action.direction;
    next.forEach((attacker, a) => {
      if (a === c || !inDuel(attacker) || attacker.action.kind !== 'Attack' || attacker.action.direction !== mirrorDirection(direction)) return;
      if (!chamberable(attacker, tuning) || !roughlyFaces(chamberer, attacker, tuning)) return;
      const action = out[a]!.action as AttackAction;
      if (action.chamberedBy?.includes(c)) return;
      out[a] = { ...out[a]!, action: { ...action, chamberedBy: [...(action.chamberedBy ?? []), c] } };
    });
  });
  return out;
}
