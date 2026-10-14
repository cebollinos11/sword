import type { IdleAction, MotionPlayback } from '../state';

export const IDLE_ACTION: IdleAction = { kind: 'Idle' };
/** Idle's Motion from its start; every Action that ends returns here. */
export const IDLE_MOTION: MotionPlayback = { name: 'Idle', tick: 0 };
