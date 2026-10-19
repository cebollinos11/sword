/**
 * The Kick Action: Wind-up → Release → Recovery, driven by the Kick Motion
 * (`kickFoot` owns the right foot). Phase boundaries come from the Motion's
 * `windUpEnd` and `releaseEnd` markers, as for an Attack, but a Kick never
 * holds its Wind-up and cannot be cancelled. A Kick that reaches Recovery
 * without having landed holds its final pose for `kick.whiffRecovery` more Ticks.
 */
import { weaponMotion, type TuningData } from '../../tuning';
import { secondsToTicks } from '../constants';
import type { Action, AttackPhase, KickAction } from '../state';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import type { ActionContext, ActionHandler, ActionStarter, ActionUpdate } from './types';

/** The Motion that animates (and times) a Kick. */
export const KICK_MOTION = 'Kick';

/** Crouched deeper than this, a Fighter cannot start a Kick. */
export const KICK_MAX_CROUCH = 0.5;

/** Phase boundaries of a Kick, as Motion playhead Ticks. */
export interface KickTimings {
  /** Wind-up ends and Release starts here. */
  readonly windUpEnd: number;
  /** Release ends (the leg sweep stops being live) here. */
  readonly releaseEnd: number;
  /** Recovery ends and the Fighter is Idle again (not counting any whiff). */
  readonly end: number;
}

/** Phase boundaries of the Kick of a Fighter wielding `weapon` (its Motion override, if any, sets them). */
export function kickTimings(tuning: TuningData, weapon: string): KickTimings {
  const motion = weaponMotion(tuning, weapon, KICK_MOTION);
  if (!motion) throw new Error(`No Motion "${KICK_MOTION}" for the Kick`);
  const { windUpEnd, releaseEnd } = motion.markers;
  if (windUpEnd === undefined || releaseEnd === undefined) throw new Error(`Kick Motion "${KICK_MOTION}" needs windUpEnd and releaseEnd markers`);
  return { windUpEnd: secondsToTicks(windUpEnd), releaseEnd: secondsToTicks(releaseEnd), end: secondsToTicks(motion.duration) };
}

const play = (action: KickAction, tick: number): ActionUpdate => ({ action, motion: { name: KICK_MOTION, tick } });

/**
 * Pressing kick starts a Kick: not while crouched. (`startAction` already refuses anything in the air
 * unless the Fighter jumped there, so a Kick can start in a Jump but not after walking off a ledge.)
 */
export const startKick: ActionStarter = (f, intent, ctx) => {
  if (intent.kick !== true || f.crouch > KICK_MAX_CROUCH) return null;
  ctx.emit({ type: 'KickPhase', fighter: ctx.fighter, phase: 'Wind-up' });
  return play({ kind: 'Kick', phase: 'Wind-up', landed: false }, 0);
};

function enter(a: KickAction, phase: AttackPhase, tick: number, ctx: ActionContext): ActionUpdate {
  if (phase !== a.phase) ctx.emit({ type: 'KickPhase', fighter: ctx.fighter, phase });
  return play({ ...a, phase }, tick);
}

export const updateKick: ActionHandler<KickAction> = (f, _intent, ctx) => {
  const a = f.action;
  const t = kickTimings(ctx.tuning, f.weapon);
  const tick = f.motion.tick;
  switch (a.phase) {
    case 'Wind-up':
      return enter(a, tick + 1 >= t.windUpEnd ? 'Release' : 'Wind-up', tick + 1, ctx);
    case 'Release':
      return enter(a, tick + 1 >= t.releaseEnd ? 'Recovery' : 'Release', tick + 1, ctx);
    case 'Recovery': {
      // A Kick that landed nothing is open for longer: the pose is held while `whiff` counts down. Checked here, not on the
      // Tick Recovery began, so a Kick that lands on its last Release Tick is not punished.
      if (!a.landed && (a.whiff === undefined || a.whiff > 0)) {
        return play({ ...a, whiff: (a.whiff ?? ctx.tuning.kick.whiffRecovery) - 1 }, tick);
      }
      if (tick + 1 >= t.end) return { action: IDLE_ACTION, motion: IDLE_MOTION };
      return play(a, tick + 1);
    }
  }
};

/**
 * Whether the leg sweep between a Fighter's previous and next Tick is live: the segment lies in the
 * Release span of one Kick (entering Release, during it, or leaving it into Recovery) that has not landed.
 */
export function kickSweepLive(prev: Action, next: Action): next is KickAction {
  if (next.kind !== 'Kick' || next.landed) return false;
  return next.phase === 'Release' || (prev.kind === 'Kick' && prev.phase === 'Release');
}
