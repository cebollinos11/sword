/**
 * The Sheathe and Draw Actions: the sword hand puts the Weapon away in its slot (Weapon `sheathe.slot`, the hip or the back), or takes it
 * back out, driven by the slot's Sheathe or Draw Motion, whose length sets how long it takes. The Weapon changes between hand and slot at
 * the Motion's `swap` marker: that Tick `FighterState.sheathed` flips, and it lives on the Fighter, not in the Action, so a Stagger or
 * Knockdown keeps whatever already happened. Committed: the Fighter can still walk, turn and crouch, but cannot Jump, Kick, Throw,
 * Attack, Block or cancel. A Sheathe ends on the Sheathed Idle, a Draw on the Guard.
 */
import { weaponByName, weaponMotion, type TuningData } from '../../tuning';
import { secondsToTicks } from '../constants';
import { motionBlendTicks } from '../motion';
import type { DrawAction, FighterState, SheatheAction } from '../state';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import { throwTimings } from './throw';
import type { ActionHandler, ActionStarter, ActionUpdate } from './types';

/** Which of the two: putting the Weapon away, or taking it out. */
export type SheatheKind = (SheatheAction | DrawAction)['kind'];

/** The Motion that animates (and times) a Sheathe or Draw for a Weapon in `slot`. */
export const sheatheMotionName = (kind: SheatheKind, slot: 'hip' | 'back'): string => `${kind}${slot === 'hip' ? 'Hip' : 'Back'}`;

/** Points in a Sheathe or Draw, as Motion playhead Ticks. */
export interface SheatheTimings {
  /** The Weapon changes between hand and slot here: the Fighter becomes Sheathed (or drawn) on the Tick the playhead reaches it. */
  readonly swap: number;
  /** The Motion ends and the Fighter is Idle again. */
  readonly end: number;
}

/** The Motion a Fighter wielding `weapon` plays for a Sheathe or Draw (its Weapon's slot picks it; its Motion override, if any, plays). */
function sheatheMotion(tuning: TuningData, weapon: string, kind: SheatheKind) {
  const name = sheatheMotionName(kind, weaponByName(tuning, weapon).sheathe.slot);
  const motion = weaponMotion(tuning, weapon, name);
  if (!motion) throw new Error(`No Motion "${name}" for the ${kind}`);
  return motion;
}

/** The swap and end of a Sheathe or Draw by a Fighter wielding `weapon`. */
export function sheatheTimings(tuning: TuningData, weapon: string, kind: SheatheKind): SheatheTimings {
  const motion = sheatheMotion(tuning, weapon, kind);
  const { swap } = motion.markers;
  if (swap === undefined) throw new Error(`${kind} Motion "${motion.name}" needs a swap marker`);
  return { swap: secondsToTicks(swap), end: secondsToTicks(motion.duration) };
}

const play = (f: FighterState, kind: SheatheKind, tick: number, tuning: TuningData): ActionUpdate => ({
  action: { kind },
  motion: { name: sheatheMotion(tuning, f.weapon, kind).name, tick },
});

/**
 * Pressing sheathe starts a Sheathe while drawn and a Draw while Sheathed; pressing attack or block while Sheathed also Draws (there is no
 * quick-draw Attack). Tried before every other starter, so nothing else sees an Attack or Block pressed while Sheathed. `startAction`
 * already refuses anything in the air unless the Fighter jumped there.
 */
export const startSheathe: ActionStarter = (f, intent, ctx) => {
  if (intent.sheathe === true) return play(f, f.sheathed ? 'Draw' : 'Sheathe', 0, ctx.tuning);
  if (f.sheathed && (intent.attack || intent.block)) return play(f, 'Draw', 0, ctx.tuning);
  return null;
};

export const updateSheathe: ActionHandler<SheatheAction | DrawAction> = (f, _intent, ctx) => {
  const kind = f.action.kind;
  const t = sheatheTimings(ctx.tuning, f.weapon, kind);
  const tick = f.motion.tick + 1;
  // The Weapon reaches the slot (or the hand) this Tick.
  const swapped = f.motion.tick < t.swap && tick >= t.swap;
  if (swapped) ctx.emit({ type: kind === 'Sheathe' ? 'Sheathed' : 'Drawn', fighter: ctx.fighter });
  const swap = swapped ? { sheathed: kind === 'Sheathe' } : {};
  if (tick >= t.end) return { action: IDLE_ACTION, motion: IDLE_MOTION, ...swap };
  return { ...play(f, kind, tick, ctx.tuning), ...swap };
};

/**
 * How far (0..1) a Fighter's off hand has let go of a two-handed Weapon's Off-hand Grip: fully while Sheathed (there is nothing to hold),
 * letting go over the Motion Blend as a Sheathe or a Throw begins, and taking the grip back over the Motion Blend before a Draw or a Throw
 * ends. 0 otherwise.
 */
export function offHandFree(f: FighterState, tuning: TuningData): number {
  const blend = motionBlendTicks(tuning);
  const ramp = (ticks: number) => Math.min(1, Math.max(0, ticks / blend));
  switch (f.action.kind) {
    case 'Sheathe':
      return ramp(f.motion.tick);
    case 'Draw':
      return ramp(sheatheTimings(tuning, f.weapon, 'Draw').end - f.motion.tick);
    case 'Throw':
      return f.sheathed ? 1 : ramp(Math.min(f.motion.tick, throwTimings(tuning, f.weapon).end - f.motion.tick));
    default:
      return f.sheathed ? 1 : 0;
  }
}
