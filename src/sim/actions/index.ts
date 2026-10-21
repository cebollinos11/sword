/**
 * The Action state machine. Each Action kind has one handler that advances it
 * by a Tick; Idle tries the starters in order. To add an Action (Block,
 * Stagger, ...): add it to the `Action` union in state.ts, write a handler in
 * its own file, register it in HANDLERS, and (if Idle can start it) add a
 * starter to STARTERS.
 */
import { weaponMotion, type TuningData } from '../../tuning';
import { secondsToTicks } from '../constants';
import type { Intent } from '../intent';
import type { Action, ActionKind, FighterState, MotionPlayback } from '../state';
import { startAttack, updateAttack } from './attack';
import { startBlock, updateBlock } from './block';
import { updateFall } from './fall';
import { feint } from './feint';
import { startKick, updateKick } from './kick';
import { IDLE_ACTION, IDLE_MOTION, idleMotionFor, LAND_SOFT_MOTION } from './idleAction';
import { updateKnockdown } from './knockdown';
import { startSheathe, updateSheathe } from './sheathe';
import { updateStagger } from './stagger';
import { startThrow, updateThrow } from './throw';
import { advance, type ActionContext, type ActionHandler, type ActionStarter, type ActionUpdate } from './types';

/** What Idle can turn into, tried in order; the first that accepts the Intent wins. Sheathe comes first: while Sheathed, attack and block Draw. */
const STARTERS: readonly ActionStarter[] = [startSheathe, startKick, startThrow, startAttack, startBlock];

export function startAction(f: FighterState, intent: Intent, ctx: ActionContext): ActionUpdate | null {
  // Nothing starts in the air unless the Fighter jumped there: one that walked or was pushed off the ground waits to Fall or land.
  if (f.air && !f.air.jumped) return null;
  for (const start of STARTERS) {
    const started = start(f, intent, ctx);
    if (started) return started;
  }
  return null;
}

// A Chain reaches Idle still showing the next Attack's Motion: if that Attack doesn't start after all, Idle takes over. A Sheathed Fighter's
// Idle plays on as the Sheathed Idle (stepFighter swaps it in for IDLE_MOTION).
const updateIdle: ActionHandler<Extract<Action, { kind: 'Idle' }>> = (f, intent, ctx) =>
  startAction(f, intent, ctx) ?? { action: IDLE_ACTION, motion: idleMotion(f, ctx.tuning) };

/**
 * Idle's Motion next Tick. A soft Landing's `LandSoft` plays out first, then hands over to Idle at the Tick Idle would have
 * reached had it started on the Landing, so its sway carries on in step; any other Motion gives way to Idle at once.
 */
function idleMotion(f: FighterState, tuning: TuningData): MotionPlayback {
  if (f.motion.name === idleMotionFor(f)) return advance(f.motion);
  if (f.motion.name !== LAND_SOFT_MOTION) return IDLE_MOTION;
  const next = advance(f.motion);
  return next.tick < secondsToTicks(weaponMotion(tuning, f.weapon, LAND_SOFT_MOTION)!.duration) ? next : { ...IDLE_MOTION, tick: next.tick };
}

const HANDLERS: { readonly [K in ActionKind]: ActionHandler<Extract<Action, { kind: K }>> } = {
  Idle: updateIdle,
  // A Wind-up can be cancelled by a Feint before the Attack advances.
  Attack: (f, intent, ctx) => feint(f, intent, ctx) ?? updateAttack(f, intent, ctx),
  Block: updateBlock,
  // Committed: its Intent is ignored until the Motion ends.
  Kick: updateKick,
  // Committed except for walking and turning: its Intent is ignored until the Motion ends.
  Throw: updateThrow,
  // Committed except for walking, turning and crouching: its Intent is ignored until the Motion ends.
  Sheathe: updateSheathe,
  Draw: updateSheathe,
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
export { IDLE_ACTION, IDLE_MOTION, idleMotionFor, LAND_SOFT_MOTION, SHEATHED_IDLE_MOTION } from './idleAction';
export { KICK_MAX_CROUCH, KICK_MOTION, kickSweepLive, kickTimings, type KickTimings } from './kick';
export { THROW_MOTION, throwTimings, type ThrowTimings } from './throw';
export { offHandFree, sheatheMotionName, sheatheTimings, type SheatheKind, type SheatheTimings } from './sheathe';
export { fall, FALL_ACTION, FALL_MOTION } from './fall';
export { GET_UP_MOTION, knockdown, KNOCKDOWN_MOTION } from './knockdown';
export { LAND_MOTION, RECOIL_MOTION, STAGGER_MOTION, stagger, staggerMotionName } from './stagger';
export type { ActionContext, ActionHandler, ActionStarter, ActionUpdate } from './types';
