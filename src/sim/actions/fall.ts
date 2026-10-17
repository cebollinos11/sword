/**
 * The Fall Action: a Fighter in the air, arms out and knees drawn up. Entered
 * on a Jump, or once a Fighter has been airborne for `fall.fallDelay` seconds
 * (so stepping off a low ledge does not). A Fighter that fell off a ledge cannot
 * Attack or Block; one that jumped can, leaving the Fall. Either can still be hit. It lasts until the Fighter lands: a soft
 * Landing returns it to Idle, a hard one Staggers it (cause `Landed`).
 */
import type { FallAction } from '../state';
import { startAction } from './index';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import { advance, type ActionHandler, type ActionUpdate } from './types';

/** The Motion that animates a Fall (it holds its last pose until the Fighter lands). */
export const FALL_MOTION = 'Fall';

export const FALL_ACTION: FallAction = { kind: 'Fall' };

/** A Fall from its first Tick. */
export const fall = (): ActionUpdate => ({ action: FALL_ACTION, motion: { name: FALL_MOTION, tick: 0 } });

/** Falls for as long as the Fighter is airborne; on the ground (it landed) it is Idle. */
export const updateFall: ActionHandler<FallAction> = (f, intent, ctx) => {
  if (!f.air) return { action: IDLE_ACTION, motion: IDLE_MOTION };
  // A Fighter that jumped can still Attack or Block mid-air.
  return startAction(f, intent, ctx) ?? { action: f.action, motion: advance(f.motion) };
};
