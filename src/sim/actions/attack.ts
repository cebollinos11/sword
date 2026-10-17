/**
 * The Attack Action: Wind-up → Release → Recovery, driven by the Attack's
 * Motion. Phase boundaries come from the Motion's `windUpEnd` and
 * `releaseEnd` markers; Recovery ends with the Motion.
 */
import { weaponMotion, type TuningData } from '../../tuning';
import { secondsToTicks } from '../constants';
import type { Direction, Intent } from '../intent';
import { motionBlendTicks } from '../motion';
import type { Action, AttackAction, AttackPhase, FighterState } from '../state';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import type { ActionContext, ActionHandler, ActionStarter, ActionUpdate } from './types';

/** How long (Ticks) a Weapon stays lodged in the victim after a Hit. */
export const LODGE_TICKS = 18;

/** The Motion that animates an Attack in `direction` (one Motion file per Direction). */
export const attackMotionName = (direction: Direction): string => direction;

/** Phase boundaries of an Attack, as Motion playhead Ticks. */
export interface AttackTimings {
  /** Wind-up reaches its held pose here; Release can start from here. */
  readonly windUpEnd: number;
  /** Release ends (the Blade Sweep stops being live) here. */
  readonly releaseEnd: number;
  /** Recovery ends and the Fighter is Idle again. */
  readonly end: number;
}

/** Phase boundaries of an Attack in `direction` by a Fighter wielding `weapon` (its Motion override, if any, sets them). */
export function attackTimings(tuning: TuningData, weapon: string, direction: Direction): AttackTimings {
  const name = attackMotionName(direction);
  const motion = weaponMotion(tuning, weapon, name);
  if (!motion) throw new Error(`No Motion "${name}" for the ${direction} Attack`);
  const { windUpEnd, releaseEnd } = motion.markers;
  if (windUpEnd === undefined || releaseEnd === undefined) {
    throw new Error(`Attack Motion "${name}" needs windUpEnd and releaseEnd markers`);
  }
  return { windUpEnd: secondsToTicks(windUpEnd), releaseEnd: secondsToTicks(releaseEnd), end: secondsToTicks(motion.duration) };
}

function enter(action: AttackAction, phase: AttackPhase, tick: number, ctx: ActionContext): ActionUpdate {
  if (phase !== action.phase) ctx.emit({ type: 'AttackPhase', fighter: ctx.fighter, direction: action.direction, phase });
  return { action: { ...action, phase }, motion: { name: attackMotionName(action.direction), tick } };
}

/** Pressing attack starts a Wind-up in the Intent's Direction. */
export const startAttack: ActionStarter = (_f, intent, ctx) => {
  if (!intent.attack) return null;
  const action: AttackAction = { kind: 'Attack', direction: intent.direction, phase: 'Wind-up', landed: false };
  ctx.emit({ type: 'AttackPhase', fighter: ctx.fighter, direction: action.direction, phase: 'Wind-up' });
  return { action, motion: { name: attackMotionName(action.direction), tick: 0 } };
};

export const updateAttack: ActionHandler<AttackAction> = (f, intent, ctx) => {
  const a = f.action;
  const t = attackTimings(ctx.tuning, f.weapon, a.direction);
  const tick = f.motion.tick;
  // The Weapon is lodged in the victim after a Hit: hold the pose, then play out the rest of the swing.
  if (a.lodge) return { action: { ...a, lodge: a.lodge - 1 }, motion: { name: attackMotionName(a.direction), tick } };
  switch (a.phase) {
    case 'Wind-up':
      // Wind-up always plays to its held pose; it then holds (playhead frozen) while attack is held.
      // A held Wind-up looks and swings exactly like a short one: no damage bonus for holding.
      if (tick < t.windUpEnd) return enter(a, 'Wind-up', tick + 1, ctx);
      if (intent.attack) return enter(a, 'Wind-up', tick, ctx);
      return enter(a, 'Release', tick + 1, ctx);
    case 'Release':
      return enter(a, tick + 1 >= t.releaseEnd ? 'Recovery' : 'Release', tick + 1, ctx);
    case 'Recovery':
      return recover(f, t, intent, ctx);
  }
};

/**
 * One Tick of Recovery. Its length never changes, but holding attack during it Chains: rather than
 * playing back to guard and winding up from there, the pose blends straight from where it is to the
 * next Attack's held Wind-up pose, arriving on the very Tick it would have anyway (Recovery, the Idle
 * Tick that follows it, then the whole Wind-up). The blade is not live meanwhile, so only the pose changes.
 * Letting go drops the Chain and the Recovery plays on.
 */
function recover(f: FighterState & { readonly action: AttackAction }, t: AttackTimings, intent: Intent, ctx: ActionContext): ActionUpdate {
  const { chain, ...unchained } = f.action;
  // While Chained the playback shows the next Attack, so the Recovery's own playhead lives in the Chain.
  const tick = chain?.tick ?? f.motion.tick;
  if (tick + 1 >= t.end) {
    // A Chain still held goes on showing the next Attack through the Idle Tick, until that Attack starts.
    const motion = chain && intent.attack ? { name: attackMotionName(chain.direction), tick: 0 } : IDLE_MOTION;
    return { action: IDLE_ACTION, motion };
  }
  if (!intent.attack) {
    if (!chain) return enter(unchained, 'Recovery', tick + 1, ctx);
    // Dropping the Chain: blend back into the Recovery where it has got to.
    return { ...enter(unchained, 'Recovery', tick + 1, ctx), blendTicks: motionBlendTicks(ctx.tuning) };
  }
  const direction = chain?.direction ?? intent.direction;
  const action: AttackAction = { ...unchained, chain: { direction, tick: tick + 1 } };
  const motion = { name: attackMotionName(direction), tick: 0 };
  if (chain) return { action, motion };
  // One blend over the rest of Recovery, the Idle Tick and the next Wind-up, ending as that Wind-up reaches its held pose.
  const blendTicks = t.end - tick + 1 + attackTimings(ctx.tuning, f.weapon, direction).windUpEnd;
  return { action, motion, blendTicks };
}

/**
 * Whether the Blade Sweep between a Fighter's previous and next Tick is live:
 * the segment lies in the Release span of one Attack (entering Release,
 * during it, or leaving it into Recovery).
 */
export function attackSweepLive(prev: Action, next: Action): next is AttackAction {
  if (next.kind !== 'Attack' || next.landed) return false;
  return next.phase === 'Release' || (prev.kind === 'Attack' && prev.phase === 'Release');
}
