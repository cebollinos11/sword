/**
 * The Stagger Action: a short forced Action that interrupts whatever the
 * Fighter was doing. Intents are ignored until the Stagger Motion ends; then
 * the Fighter is Idle again.
 */
import { secondsToTicks } from '../constants';
import type { StaggerAction, StaggerCause } from '../state';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import type { ActionHandler, ActionUpdate } from './types';

/** The Motion that animates (and times) a Stagger. */
export const STAGGER_MOTION = 'Stagger';

/** A Stagger from its first Tick. */
export function stagger(cause: StaggerCause): ActionUpdate {
  const action: StaggerAction = { kind: 'Stagger', cause };
  return { action, motion: { name: STAGGER_MOTION, tick: 0 } };
}

export const updateStagger: ActionHandler<StaggerAction> = (f, _intent, ctx) => {
  const motion = ctx.tuning.motions[STAGGER_MOTION];
  if (!motion) throw new Error(`No Motion "${STAGGER_MOTION}" for the Stagger Action`);
  const end = secondsToTicks(motion.duration);
  if (f.motion.tick + 1 >= end) return { action: IDLE_ACTION, motion: IDLE_MOTION };
  return { action: f.action, motion: { name: STAGGER_MOTION, tick: f.motion.tick + 1 } };
};
