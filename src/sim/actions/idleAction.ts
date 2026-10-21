import type { FighterState, IdleAction, MotionPlayback } from '../state';

export const IDLE_ACTION: IdleAction = { kind: 'Idle' };
/** Idle's Motion from its start; every Action that ends returns here. */
export const IDLE_MOTION: MotionPlayback = { name: 'Idle', tick: 0 };

/** The Motion a soft Landing plays in Idle: the hips dip and the torso leans as the legs take the weight, then Idle carries on. */
export const LAND_SOFT_MOTION = 'LandSoft';

/** The Motion a Sheathed Fighter plays while Idle: empty hands, relaxed. */
export const SHEATHED_IDLE_MOTION = 'SheathedIdle';

/**
 * The Motion an Idle Fighter plays: the Idle, or the Sheathed Idle while Sheathed. Handlers end their Actions on `IDLE_MOTION`, and the
 * Simulation swaps in the Sheathed Idle here (`stepFighter`, `land`), so no handler needs to know.
 */
export const idleMotionFor = (f: Pick<FighterState, 'sheathed'>): string => (f.sheathed ? SHEATHED_IDLE_MOTION : IDLE_MOTION.name);
