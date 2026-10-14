/**
 * The Block Action: hold block to guard in the Intent's Direction (chosen on
 * press); let go to return to Idle. Whether a Block stops an Attack is decided
 * by rule, never by blade geometry (ADR 0002): see `blocksAttack`.
 */
import { TICK_RATE } from '../constants';
import type { Direction } from '../intent';
import type { BlockAction, FighterState } from '../state';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import type { ActionHandler, ActionStarter } from './types';

/** The Motion that animates a Block in `direction` (cosmetic only; one Motion file per Direction). */
export const blockMotionName = (direction: Direction): string => `Block${direction}`;

/**
 * How far (degrees either side of straight ahead) the attacker may be from
 * the defender's facing for a Block to count: "roughly faces the attacker".
 */
export const BLOCK_FACING_HALF_ANGLE = 60;

/** Pressing block (from Idle) raises a guard in the Intent's Direction. */
export const startBlock: ActionStarter = (_f, intent) => {
  if (!intent.block) return null;
  const action: BlockAction = { kind: 'Block', direction: intent.direction };
  return { action, motion: { name: blockMotionName(action.direction), tick: 0 } };
};

/** The guard is held while block is held; the playhead stops at the end of the (non-looping) Block Motion. */
export const updateBlock: ActionHandler<BlockAction> = (f, intent, ctx) => {
  if (!intent.block) return { action: IDLE_ACTION, motion: IDLE_MOTION };
  const motion = ctx.tuning.motions[f.motion.name];
  const end = motion ? Math.round(motion.duration * TICK_RATE) : 0;
  return { action: f.action, motion: { name: f.motion.name, tick: Math.min(f.motion.tick + 1, end) } };
};

/**
 * The Block rule: `defender` stops an Attack in `direction` from `attacker`
 * when it is Blocking in that same Direction and roughly faces the attacker.
 */
export function blocksAttack(defender: FighterState, attacker: FighterState, direction: Direction): boolean {
  if (defender.action.kind !== 'Block' || defender.action.direction !== direction) return false;
  return roughlyFaces(defender, attacker);
}

/** Whether `other` lies within BLOCK_FACING_HALF_ANGLE of `f`'s facing (used by Blocks and Chambers). */
export function roughlyFaces(f: FighterState, other: FighterState): boolean {
  const dx = other.position.x - f.position.x;
  const dz = other.position.z - f.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist === 0) return true;
  // Facing f looks along (sin f, cos f) on the ground plane.
  const cos = (Math.sin(f.facing) * dx + Math.cos(f.facing) * dz) / dist;
  return cos >= Math.cos((BLOCK_FACING_HALF_ANGLE * Math.PI) / 180);
}
