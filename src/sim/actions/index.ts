/**
 * The Action state machine. Each Action kind has one handler that advances it
 * by a Tick; Idle tries the starters in order. To add an Action (Block,
 * Stagger, ...): add it to the `Action` union in state.ts, write a handler in
 * its own file, register it in HANDLERS, and (if Idle can start it) add a
 * starter to STARTERS.
 */
import type { Intent } from '../intent';
import type { Action, ActionKind, FighterState } from '../state';
import { startAttack, updateAttack } from './attack';
import { IDLE_ACTION } from './idleAction';
import { advance, type ActionContext, type ActionHandler, type ActionStarter, type ActionUpdate } from './types';

/** What Idle can turn into, tried in order; the first that accepts the Intent wins. */
const STARTERS: readonly ActionStarter[] = [startAttack];

export function startAction(f: FighterState, intent: Intent, ctx: ActionContext): ActionUpdate | null {
  for (const start of STARTERS) {
    const started = start(f, intent, ctx);
    if (started) return started;
  }
  return null;
}

const updateIdle: ActionHandler<Extract<Action, { kind: 'Idle' }>> = (f, intent, ctx) =>
  startAction(f, intent, ctx) ?? { action: IDLE_ACTION, motion: advance(f.motion) };

const HANDLERS: { readonly [K in ActionKind]: ActionHandler<Extract<Action, { kind: K }>> } = {
  Idle: updateIdle,
  Attack: updateAttack,
};

/** Advance a Fighter's Action and Motion playhead by one Tick. */
export function updateAction(f: FighterState, intent: Intent, ctx: ActionContext): ActionUpdate {
  const handler = HANDLERS[f.action.kind] as ActionHandler<Action>;
  return handler(f, intent, ctx);
}

export { attackSweepLive, attackTimings, attackMotionName, type AttackTimings } from './attack';
export { IDLE_ACTION, IDLE_MOTION } from './idleAction';
export type { ActionContext, ActionHandler, ActionStarter, ActionUpdate } from './types';
