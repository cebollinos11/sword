/**
 * The Stagger Action: a short forced Action that interrupts whatever the
 * Fighter was doing. Intents are ignored until its Motion ends; then the
 * Fighter is Idle again. Its Motion (Tuning Data) sets how long it lasts:
 * `Stagger` for being hit or Chambered, and the shorter `Recoil` for an
 * attacker whose Attack was Blocked (story 14: a short Stagger). A blade Hit
 * plays the hit reaction for the side it came from (`StaggerLeft`,
 * `StaggerRight`, `StaggerOverhead`, `StaggerThrust`), as long as `Stagger`.
 */
import { weaponMotion, type TuningData } from '../../tuning';
import { secondsToTicks } from '../constants';
import type { UpperBody } from '../motion';
import type { Direction } from '../intent';
import type { StaggerAction, StaggerCause } from '../state';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import type { ActionHandler, ActionUpdate } from './types';

/** The Motion that animates (and times) a Stagger from being hit or Chambered. */
export const STAGGER_MOTION = 'Stagger';
/** The Motion that animates (and times) the recoil of a Blocked attacker: a short Stagger. */
export const RECOIL_MOTION = 'Recoil';
/** The Motion that animates (and times) a hard Landing: a crouch the Fighter is open in. */
export const LAND_MOTION = 'Land';

/**
 * The Motion that animates (and times) a Stagger with this cause: for a blade Hit from `from`, `Stagger<from>`
 * when the Weapon has it, else `Stagger`.
 */
export function staggerMotionName(tuning: Pick<TuningData, 'motions' | 'motionOverrides'>, weapon: string, cause: StaggerCause, from?: Direction): string {
  if (cause === 'Blocked') return RECOIL_MOTION;
  if (cause === 'Landed') return LAND_MOTION;
  const reaction = from && `${STAGGER_MOTION}${from}`;
  return reaction && weaponMotion(tuning, weapon, reaction) ? reaction : STAGGER_MOTION;
}

/**
 * A Stagger from its first Tick. `hold` (a blocked attacker's upper body, as it was when blocked) is frozen
 * for the whole Stagger, while the Motion still moves the rest. `from` (a blade Hit only) picks the hit reaction.
 */
export function stagger(tuning: TuningData, weapon: string, cause: StaggerCause, hold?: UpperBody, from?: Direction): ActionUpdate {
  const action: StaggerAction = { kind: 'Stagger', cause, ...(from && { from }) };
  return { action, motion: { name: staggerMotionName(tuning, weapon, cause, from), tick: 0, ...(hold && { hold }) } };
}

export const updateStagger: ActionHandler<StaggerAction> = (f, _intent, ctx) => {
  const name = staggerMotionName(ctx.tuning, f.weapon, f.action.cause, f.action.from);
  const motion = weaponMotion(ctx.tuning, f.weapon, name);
  if (!motion) throw new Error(`No Motion "${name}" for the Stagger Action (cause ${f.action.cause})`);
  const end = secondsToTicks(motion.duration);
  if (f.motion.tick + 1 >= end) return { action: IDLE_ACTION, motion: IDLE_MOTION };
  return { action: f.action, motion: { name, tick: f.motion.tick + 1, ...(f.motion.hold && { hold: f.motion.hold }) } };
};
