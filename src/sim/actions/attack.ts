/**
 * The Attack Action: Wind-up → Release → Recovery, driven by the Attack's
 * Motion. Phase boundaries come from the Motion's `windUpEnd` and
 * `releaseEnd` markers; Recovery ends with the Motion.
 */
import type { TuningData } from '../../tuning';
import { secondsToTicks } from '../constants';
import type { Direction } from '../intent';
import type { Action, AttackAction, AttackPhase } from '../state';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import type { ActionContext, ActionHandler, ActionStarter, ActionUpdate } from './types';

/** The Motion that animates an Attack in `direction` (one Motion file per Direction). */
export const attackMotionName = (direction: Direction): string => direction;

/** Phase boundaries of an Attack, as Motion playhead Ticks. */
export interface AttackTimings {
  /** Wind-up reaches its held pose here; Release can start from here. */
  readonly windUpEnd: number;
  /** Release ends (the Blade Sweep stops being live) here. */
  readonly releaseEnd: number;
  /** Recovery ends and the Fighter is Idle again. */
  readonly end: number;
}

export function attackTimings(tuning: TuningData, direction: Direction): AttackTimings {
  const name = attackMotionName(direction);
  const motion = tuning.motions[name];
  if (!motion) throw new Error(`No Motion "${name}" for the ${direction} Attack`);
  const { windUpEnd, releaseEnd } = motion.markers;
  if (windUpEnd === undefined || releaseEnd === undefined) {
    throw new Error(`Attack Motion "${name}" needs windUpEnd and releaseEnd markers`);
  }
  return { windUpEnd: secondsToTicks(windUpEnd), releaseEnd: secondsToTicks(releaseEnd), end: secondsToTicks(motion.duration) };
}

function enter(action: AttackAction, phase: AttackPhase, tick: number, ctx: ActionContext): ActionUpdate {
  if (phase !== action.phase) ctx.emit({ type: 'AttackPhase', fighter: ctx.fighter, direction: action.direction, phase });
  return { action: { ...action, phase }, motion: { name: attackMotionName(action.direction), tick } };
}

/** Pressing attack starts a Wind-up in the Intent's Direction. */
export const startAttack: ActionStarter = (_f, intent, ctx) => {
  if (!intent.attack) return null;
  const action: AttackAction = { kind: 'Attack', direction: intent.direction, phase: 'Wind-up', landed: false };
  ctx.emit({ type: 'AttackPhase', fighter: ctx.fighter, direction: action.direction, phase: 'Wind-up' });
  return { action, motion: { name: attackMotionName(action.direction), tick: 0 } };
};

export const updateAttack: ActionHandler<AttackAction> = (f, intent, ctx) => {
  const a = f.action;
  const t = attackTimings(ctx.tuning, a.direction);
  const tick = f.motion.tick;
  switch (a.phase) {
    case 'Wind-up':
      // Wind-up always plays to its held pose; it then holds (playhead frozen) while attack is held.
      // A held Wind-up looks and swings exactly like a short one: no damage bonus for holding.
      if (tick < t.windUpEnd) return enter(a, 'Wind-up', tick + 1, ctx);
      if (intent.attack) return enter(a, 'Wind-up', tick, ctx);
      return enter(a, 'Release', tick + 1, ctx);
    case 'Release':
      return enter(a, tick + 1 >= t.releaseEnd ? 'Recovery' : 'Release', tick + 1, ctx);
    case 'Recovery':
      if (tick + 1 >= t.end) return { action: IDLE_ACTION, motion: IDLE_MOTION };
      return enter(a, 'Recovery', tick + 1, ctx);
  }
};

/**
 * Whether the Blade Sweep between a Fighter's previous and next Tick is live:
 * the segment lies in the Release span of one Attack (entering Release,
 * during it, or leaving it into Recovery).
 */
export function attackSweepLive(prev: Action, next: Action): next is AttackAction {
  if (next.kind !== 'Attack' || next.landed) return false;
  return next.phase === 'Release' || (prev.kind === 'Attack' && prev.phase === 'Release');
}
