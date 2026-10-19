/**
 * The Stagger Action: a short forced Action that interrupts whatever the
 * Fighter was doing. Intents are ignored until its Motion ends; then the
 * Fighter is Idle again. Its Motion (Tuning Data) sets how long it lasts:
 * `Stagger` for being hit or Chambered, and the shorter `Recoil` for an
 * attacker whose Attack was Blocked (story 14: a short Stagger). A Parried
 * attacker (a Perfect Block) holds the Recoil's last pose for `block.perfectRecoil` more.
 */
import { weaponMotion } from '../../tuning';
import { secondsToTicks } from '../constants';
import type { UpperBody } from '../motion';
import type { StaggerAction, StaggerCause } from '../state';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import type { ActionHandler, ActionUpdate } from './types';

/** The Motion that animates (and times) a Stagger from being hit or Chambered. */
export const STAGGER_MOTION = 'Stagger';
/** The Motion that animates (and times) the recoil of a Blocked attacker: a short Stagger. */
export const RECOIL_MOTION = 'Recoil';
/** The Motion that animates (and times) a hard Landing: a crouch the Fighter is open in. */
export const LAND_MOTION = 'Land';

/** The Motion that animates (and times) a Stagger with this cause. */
export const staggerMotionName = (cause: StaggerCause): string =>
  cause === 'Blocked' || cause === 'Parried' ? RECOIL_MOTION : cause === 'Landed' ? LAND_MOTION : STAGGER_MOTION;

/**
 * A Stagger from its first Tick. `hold` (a blocked attacker's upper body, as it was when blocked) is frozen
 * for the whole Stagger, while the Motion still moves the rest.
 */
export function stagger(cause: StaggerCause, hold?: UpperBody): ActionUpdate {
  const action: StaggerAction = { kind: 'Stagger', cause };
  return { action, motion: { name: staggerMotionName(cause), tick: 0, ...(hold && { hold }) } };
}

export const updateStagger: ActionHandler<StaggerAction> = (f, _intent, ctx) => {
  const name = staggerMotionName(f.action.cause);
  const motion = weaponMotion(ctx.tuning, f.weapon, name);
  if (!motion) throw new Error(`No Motion "${name}" for the Stagger Action (cause ${f.action.cause})`);
  // Parried: the Recoil's last pose holds for `block.perfectRecoil` more (a non-looping Motion stops at its end).
  const end = secondsToTicks(motion.duration) + (f.action.cause === 'Parried' ? secondsToTicks(ctx.tuning.block.perfectRecoil) : 0);
  if (f.motion.tick + 1 >= end) return { action: IDLE_ACTION, motion: IDLE_MOTION };
  return { action: f.action, motion: { name, tick: f.motion.tick + 1, ...(f.motion.hold && { hold: f.motion.hold }) } };
};
