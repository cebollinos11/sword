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
import { startBlock, updateBlock } from './block';
import { updateFall } from './fall';
import { feint } from './feint';
import { startKick, updateKick } from './kick';
import { IDLE_ACTION } from './idleAction';
import { updateKnockdown } from './knockdown';
import { updateStagger } from './stagger';
import { advance, type ActionContext, type ActionHandler, type ActionStarter, type ActionUpdate } from './types';

/** What Idle can turn into, tried in order; the first that accepts the Intent wins. */
const STARTERS: readonly ActionStarter[] = [startKick, startAttack, startBlock];

export function startAction(f: FighterState, intent: Intent, ctx: ActionContext): ActionUpdate | null {
  // Nothing starts in the air unless the Fighter jumped there: one that walked or was pushed off the ground waits to Fall or land.
  if (f.air && !f.air.jumped) return null;
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
  // A Wind-up can be cancelled by a Feint before the Attack advances.
  Attack: (f, intent, ctx) => feint(f, intent, ctx) ?? updateAttack(f, intent, ctx),
  Block: updateBlock,
  // Committed: its Intent is ignored until the Motion ends.
  Kick: updateKick,
  // Forced: its Intent only steers the guard (and the turn, in step.ts) until the Get-up ends.
  Knockdown: updateKnockdown,
  Stagger: updateStagger,
  Fall: updateFall,
};

/** Advance a Fighter's Action and Motion playhead by one Tick. */
export function updateAction(f: FighterState, intent: Intent, ctx: ActionContext): ActionUpdate {
  const handler = HANDLERS[f.action.kind] as ActionHandler<Action>;
  return handler(f, intent, ctx);
}

export { attackSweepLive, attackTimings, attackMotionName, type AttackTimings } from './attack';
export { advanceBlockImpact, applyBlockImpact, applyGuard, blockMotionName, blocksAttack, guardDirection, roughlyFaces, startBlockImpact } from './block';
export { IDLE_ACTION, IDLE_MOTION } from './idleAction';
export { KICK_MAX_CROUCH, KICK_MOTION, kickSweepLive, kickTimings, type KickTimings } from './kick';
export { fall, FALL_ACTION, FALL_MOTION } from './fall';
export { GET_UP_MOTION, knockdown, KNOCKDOWN_MOTION } from './knockdown';
export { LAND_MOTION, RECOIL_MOTION, STAGGER_MOTION, stagger, staggerMotionName } from './stagger';
export type { ActionContext, ActionHandler, ActionStarter, ActionUpdate } from './types';
