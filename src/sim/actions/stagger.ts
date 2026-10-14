/**
 * The Stagger Action: a short forced Action that interrupts whatever the
 * Fighter was doing. Intents are ignored until its Motion ends; then the
 * Fighter is Idle again. Its Motion (Tuning Data) sets how long it lasts:
 * `Stagger` for being hit or Chambered, and the shorter `Recoil` for an
 * attacker whose Attack was Blocked (story 14: a short Stagger).
 */
import { secondsToTicks } from '../constants';
import type { StaggerAction, StaggerCause } from '../state';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import type { ActionHandler, ActionUpdate } from './types';

/** The Motion that animates (and times) a Stagger from being hit or Chambered. */
export const STAGGER_MOTION = 'Stagger';
/** The Motion that animates (and times) the recoil of a Blocked attacker: a short Stagger. */
export const RECOIL_MOTION = 'Recoil';

/** The Motion that animates (and times) a Stagger with this cause. */
export const staggerMotionName = (cause: StaggerCause): string => (cause === 'Blocked' ? RECOIL_MOTION : STAGGER_MOTION);

/** A Stagger from its first Tick. */
export function stagger(cause: StaggerCause): ActionUpdate {
  const action: StaggerAction = { kind: 'Stagger', cause };
  return { action, motion: { name: staggerMotionName(cause), tick: 0 } };
}

export const updateStagger: ActionHandler<StaggerAction> = (f, _intent, ctx) => {
  const name = staggerMotionName(f.action.cause);
  const motion = ctx.tuning.motions[name];
  if (!motion) throw new Error(`No Motion "${name}" for the Stagger Action (cause ${f.action.cause})`);
  const end = secondsToTicks(motion.duration);
  if (f.motion.tick + 1 >= end) return { action: IDLE_ACTION, motion: IDLE_MOTION };
  return { action: f.action, motion: { name, tick: f.motion.tick + 1 } };
};
