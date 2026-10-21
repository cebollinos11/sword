/**
 * The Throw Action: Wind-up → Release → Recovery, driven by the Throw Motion (the off, left hand takes the dagger by its point, draws it
 * back behind the head and snaps it forward). Phase boundaries come from the Motion's `windUpEnd` and `releaseEnd` markers, as for an
 * Attack, and like an Attack's its Wind-up plays to its held pose and holds there while throw is held, for up to `dagger.maxHoldTicks`.
 * It cannot be cancelled. The dagger leaves the hand on the first Tick of Release (spent in `step.ts`). The Fighter can still walk (at
 * `dagger.throwWalkFactor`), turn and crouch.
 */
import { weaponMotion, type TuningData } from '../../tuning';
import { secondsToTicks } from '../constants';
import type { AttackPhase, ThrowAction } from '../state';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import type { ActionHandler, ActionStarter, ActionUpdate } from './types';

/** The Motion that animates (and times) a Throw. */
export const THROW_MOTION = 'Throw';

/** Phase boundaries of a Throw, as Motion playhead Ticks. */
export interface ThrowTimings {
  /** Wind-up ends and Release starts here: the dagger leaves the hand. */
  readonly windUpEnd: number;
  /** Release ends and Recovery starts here. */
  readonly releaseEnd: number;
  /** Recovery ends and the Fighter is Idle again. */
  readonly end: number;
}

/** Phase boundaries of the Throw of a Fighter wielding `weapon` (its Motion override, if any, sets them). */
export function throwTimings(tuning: TuningData, weapon: string): ThrowTimings {
  const motion = weaponMotion(tuning, weapon, THROW_MOTION);
  if (!motion) throw new Error(`No Motion "${THROW_MOTION}" for the Throw`);
  const { windUpEnd, releaseEnd } = motion.markers;
  if (windUpEnd === undefined || releaseEnd === undefined) throw new Error(`Throw Motion "${THROW_MOTION}" needs windUpEnd and releaseEnd markers`);
  return { windUpEnd: secondsToTicks(windUpEnd), releaseEnd: secondsToTicks(releaseEnd), end: secondsToTicks(motion.duration) };
}

const play = (action: ThrowAction, tick: number): ActionUpdate => ({ action, motion: { name: THROW_MOTION, tick } });

/** Pressing throw starts a Throw if a dagger is left (`startAction` already refuses anything in the air unless the Fighter jumped there). Crouching is allowed. */
export const startThrow: ActionStarter = (f, intent, ctx) => {
  if (intent.throw !== true || f.daggers <= 0) return null;
  return play({ kind: 'Throw', phase: 'Wind-up', startTick: ctx.tick }, 0);
};

const enter = (a: ThrowAction, phase: AttackPhase, tick: number): ActionUpdate => play({ ...a, phase }, tick);

export const updateThrow: ActionHandler<ThrowAction> = (f, intent, ctx) => {
  const a = f.action;
  const t = throwTimings(ctx.tuning, f.weapon);
  const tick = f.motion.tick;
  switch (a.phase) {
    case 'Wind-up': {
      // Wind-up always plays to its held pose; it then holds (playhead frozen) while throw is held, until the hold runs out.
      if (tick < t.windUpEnd) return enter(a, 'Wind-up', tick + 1);
      const held = a.held ?? 0;
      if (intent.throwHeld === true && held < ctx.tuning.dagger.maxHoldTicks) return enter({ ...a, held: held + 1 }, 'Wind-up', tick);
      return enter(a, 'Release', tick + 1);
    }
    case 'Release':
      return enter(a, tick + 1 >= t.releaseEnd ? 'Recovery' : 'Release', tick + 1);
    case 'Recovery':
      if (tick + 1 >= t.end) return { action: IDLE_ACTION, motion: IDLE_MOTION };
      return play(a, tick + 1);
  }
};
