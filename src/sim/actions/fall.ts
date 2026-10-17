/**
 * The Fall Action: a Fighter in the air, arms out and knees drawn up. Entered
 * on a Jump, or once a Fighter has been airborne for `fall.fallDelay` seconds
 * (so stepping off a low ledge does not). A falling Fighter cannot Attack or
 * Block, but it can still be hit. It lasts until the Fighter lands: a soft
 * Landing returns it to Idle, a hard one Staggers it (cause `Landed`).
 */
import type { FallAction } from '../state';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import { advance, type ActionHandler, type ActionUpdate } from './types';

/** The Motion that animates a Fall (it holds its last pose until the Fighter lands). */
export const FALL_MOTION = 'Fall';

export const FALL_ACTION: FallAction = { kind: 'Fall' };

/** A Fall from its first Tick. */
export const fall = (): ActionUpdate => ({ action: FALL_ACTION, motion: { name: FALL_MOTION, tick: 0 } });

/** Falls for as long as the Fighter is airborne; on the ground (it landed) it is Idle. */
export const updateFall: ActionHandler<FallAction> = (f) => (f.air ? { action: f.action, motion: advance(f.motion) } : { action: IDLE_ACTION, motion: IDLE_MOTION });
