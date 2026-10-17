import type { TuningData } from '../../tuning';
import type { Emit } from '../events';
import type { Intent } from '../intent';
import type { Action, FighterState, MotionPlayback } from '../state';

/** What an Action handler gets besides the Fighter and its Intent. */
export interface ActionContext {
  /** Index of the Fighter being updated (for events). */
  readonly fighter: number;
  readonly tuning: TuningData;
  readonly emit: Emit;
}

/** The result of one Tick of an Action: the (possibly new) Action and its Motion playhead. */
export interface ActionUpdate {
  readonly action: Action;
  readonly motion: MotionPlayback;
  /** Start a fresh Motion Blend this many Ticks long, even if the Motion carries on (absent: the usual rule, see followMotion). */
  readonly blendTicks?: number;
}

/** Advances a Fighter whose current Action is `A` by one Tick. Must be pure apart from `ctx.emit`. */
export type ActionHandler<A extends Action> = (f: FighterState & { readonly action: A }, intent: Intent, ctx: ActionContext) => ActionUpdate;

/**
 * Tries to start a new Action from an Intent (used by Idle, and later by
 * anything that can be cancelled). Returns null when the Intent doesn't ask for it.
 */
export type ActionStarter = (f: FighterState, intent: Intent, ctx: ActionContext) => ActionUpdate | null;

/** The Motion playhead one Tick later. */
export const advance = (m: MotionPlayback): MotionPlayback => ({ name: m.name, tick: m.tick + 1 });
