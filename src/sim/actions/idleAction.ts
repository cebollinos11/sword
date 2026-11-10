import type { FighterState, IdleAction, MotionPlayback } from '../state';

export const IDLE_ACTION: IdleAction = { kind: 'Idle' };
/** Idle's Motion from its start; every Action that ends returns here. */
export const IDLE_MOTION: MotionPlayback = { name: 'Idle', tick: 0 };

/** The Motion a soft Landing plays in Idle: the hips dip and the torso leans as the legs take the weight, then Idle carries on. */
export const LAND_SOFT_MOTION = 'LandSoft';

/** The Motion a Sheathed Fighter plays while Idle: empty hands, relaxed. */
export const SHEATHED_IDLE_MOTION = 'SheathedIdle';

/** The Motion a Sheathed Fighter plays while Idle and running forward: leaning into it, both arms trailing straight back. */
export const SHEATHED_RUN_MOTION = 'SheathedRun';

/** Whether `name` is a Motion an Idle Fighter in `f`'s state plays on its own: its Idle, or (Sheathed) the Sheathed run. */
export const isIdleMotion = (f: Pick<FighterState, 'sheathed'>, name: string): boolean => name === idleMotionFor(f) || (f.sheathed && name === SHEATHED_RUN_MOTION);

/**
 * The Motion an Idle Fighter plays: the Idle, or the Sheathed Idle while Sheathed. Handlers end their Actions on `IDLE_MOTION`, and the
 * Simulation swaps in the Sheathed Idle here (`stepFighter`, `land`), so no handler needs to know. `stepFighter` swaps in the Sheathed
 * run instead while the Fighter runs forward.
 */
export const idleMotionFor = (f: Pick<FighterState, 'sheathed'>): string => (f.sheathed ? SHEATHED_IDLE_MOTION : IDLE_MOTION.name);
