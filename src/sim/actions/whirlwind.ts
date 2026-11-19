/**
 * The Whirlwind Action (Stage 1: the hold). The Fighter holds the Whirlwind button to coil (Wind-up), which arms after
 * `whirlwind.armSeconds`; letting go armed Spins it (its pose is the Spin Motion, high or low by the Fighter's crouch; the body turns a full turn per turn while a separate heading is steered, and it drives along that heading; contacts are later), letting go earlier cancels. After
 * the Spin comes a Recovery. It is committed: attack, block, kick, throw, sheathe, Feint and Direction changes do nothing.
 */
import { canWhirlwind, weaponMotion, type TuningData } from '../../tuning';
import { secondsToTicks, TICK_SECONDS } from '../constants';
import type { Direction } from '../intent';
import type { WhirlwindAction, WhirlwindDirection, WhirlwindPhase } from '../state';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import { advance, type ActionContext, type ActionHandler, type ActionStarter, type ActionUpdate } from './types';

/** The Motions that hold a Whirlwind Wind-up, by the side it coils to. */
export const WHIRLWIND_HOLD_MOTIONS: Readonly<Record<WhirlwindDirection, string>> = {
  Left: 'WhirlwindHoldLeft',
  Right: 'WhirlwindHoldRight',
};

/** The hold Motion of a Whirlwind coiled to `direction`. */
export const whirlwindHoldMotion = (direction: WhirlwindDirection): string => WHIRLWIND_HOLD_MOTIONS[direction];

/** The Motions that hold a Spin's blade out level and high (a standing spinner), by the side the blow comes from. */
export const WHIRLWIND_SPIN_MOTIONS: Readonly<Record<WhirlwindDirection, string>> = {
  Left: 'WhirlwindSpinLeft',
  Right: 'WhirlwindSpinRight',
};

/** The Motions that hold a Spin's blade out level and low (a fully crouched spinner, before the crouch's own drop), by side. */
export const WHIRLWIND_LOW_MOTIONS: Readonly<Record<WhirlwindDirection, string>> = {
  Left: 'WhirlwindLowLeft',
  Right: 'WhirlwindLowRight',
};

/** The high Spin Motion of a Whirlwind to `direction`. */
export const whirlwindSpinMotion = (direction: WhirlwindDirection): string => WHIRLWIND_SPIN_MOTIONS[direction];

/** The low Spin Motion of a Whirlwind to `direction`: the pose the high one is blended toward by the Fighter's `crouch`. */
export const whirlwindLowMotion = (direction: WhirlwindDirection): string => WHIRLWIND_LOW_MOTIONS[direction];

/** Phase lengths of a Whirlwind, in Ticks. */
export interface WhirlwindTimings {
  /** Ticks the Wind-up must be held to arm. */
  readonly armTicks: number;
  /** Ticks one turn of the Spin takes. */
  readonly turnTicks: number;
  /** Ticks the whole Spin takes (`turns` turns). */
  readonly spinTicks: number;
  /** Ticks of Recovery after the Spin. */
  readonly recoveryTicks: number;
}

export function whirlwindTimings(tuning: TuningData): WhirlwindTimings {
  const w = tuning.whirlwind;
  const turnTicks = secondsToTicks(w.turnSeconds);
  return { armTicks: secondsToTicks(w.armSeconds), turnTicks, spinTicks: w.turns * turnTicks, recoveryTicks: secondsToTicks(w.recoverySeconds) };
}

/**
 * The side a Whirlwind coils to for a gesture `d`: Left and Right are kept; Overhead and Thrust (which a Local Controller never sends with the
 * Whirlwind button, but the AI or touch might) give Right. The Simulation keeps no memory of earlier Directions.
 */
export const whirlwindDirection = (d: Direction): WhirlwindDirection => (d === 'Left' ? 'Left' : 'Right');

/** The last playhead Tick of the hold Motion to `direction` for a Fighter wielding `weapon`: the coiled pose it is held at. */
function holdEnd(tuning: TuningData, weapon: string, direction: WhirlwindDirection): number {
  const motion = weaponMotion(tuning, weapon, whirlwindHoldMotion(direction));
  if (!motion) throw new Error(`No Motion "${whirlwindHoldMotion(direction)}" for the Whirlwind`);
  return secondsToTicks(motion.duration);
}

/** The last playhead Tick of the named Motion as `weapon` plays it: the pose a held Motion stays at. */
export function lastTick(tuning: TuningData, weapon: string, name: string): number {
  const motion = weaponMotion(tuning, weapon, name);
  if (!motion) throw new Error(`No Motion "${name}" for the Whirlwind`);
  return secondsToTicks(motion.duration);
}

/** Wrap a yaw into (-π, π]. */
function wrapYaw(a: number): number {
  const w = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
  return w === -Math.PI ? Math.PI : w;
}

/** Which way a Whirlwind's body turns: Right +1 (yaw increases, the blade coming across the front to the Fighter's left), Left -1. */
export const spinSign = (direction: WhirlwindDirection): 1 | -1 => (direction === 'Right' ? 1 : -1);

/**
 * A Spin's heading after one Tick of steering: toward `face` (a yaw, or null to keep it) the shorter way by at most
 * `whirlwind.steerSpeed` degrees per second, landing exactly on it when closer.
 */
export function steerHeading(heading: number, face: number | null, tuning: TuningData): number {
  if (face === null) return heading;
  const maxStep = (tuning.whirlwind.steerSpeed * Math.PI * TICK_SECONDS) / 180;
  const delta = wrapYaw(face - heading);
  if (Math.abs(delta) <= maxStep) return wrapYaw(face);
  return wrapYaw(heading + Math.sign(delta) * maxStep);
}

/**
 * The facing of a Fighter in a Whirlwind's Spin (or on the Tick Recovery begins): its heading plus the turns made so far, a closed form of the
 * Spin's own Tick so no float error builds over the turns. A full turn ends back on the heading.
 */
export function spinFacing(a: WhirlwindAction, tuning: TuningData): number {
  const { turnTicks } = whirlwindTimings(tuning);
  const heading = a.heading ?? 0;
  return wrapYaw(heading + (spinSign(a.direction) * 2 * Math.PI * (a.ticks % turnTicks)) / turnTicks);
}

/** The high Spin Motion of a Whirlwind, held at its last Tick (the Motion Blend from the coil carries it in). */
function playSpin(a: WhirlwindAction, tuning: TuningData, weapon: string): ActionUpdate {
  const name = whirlwindSpinMotion(a.direction);
  return { action: a, motion: { name, tick: lastTick(tuning, weapon, name) } };
}

/** The hold Motion at `tick` (held at its last Tick). */
function playHold(a: WhirlwindAction, tick: number, tuning: TuningData, weapon: string): ActionUpdate {
  return { action: a, motion: { name: whirlwindHoldMotion(a.direction), tick: Math.min(tick, holdEnd(tuning, weapon, a.direction)) } };
}

/**
 * The Whirlwind button held starts a Whirlwind: not while Sheathed (it does not Draw), and only with a Weapon that can (`canWhirlwind`).
 * Crouching is fine. (`startAction` already refuses anything in the air unless the Fighter jumped there.)
 */
export const startWhirlwind: ActionStarter = (f, intent, ctx) => {
  if (intent.whirlwind !== true || f.sheathed || !canWhirlwind(ctx.tuning, f.weapon)) return null;
  ctx.emit({ type: 'WhirlwindPhase', fighter: ctx.fighter, phase: 'Wind-up' });
  const action: WhirlwindAction = { kind: 'Whirlwind', phase: 'Wind-up', direction: whirlwindDirection(intent.direction), ticks: 0, armed: false, turn: 0 };
  return playHold(action, 0, ctx.tuning, f.weapon);
};

function enter(a: WhirlwindAction, phase: WhirlwindPhase, ctx: ActionContext): WhirlwindAction {
  ctx.emit({ type: 'WhirlwindPhase', fighter: ctx.fighter, phase });
  return { ...a, phase, ticks: 0 };
}

export const updateWhirlwind: ActionHandler<WhirlwindAction> = (f, intent, ctx) => {
  const a = f.action;
  const t = whirlwindTimings(ctx.tuning);
  switch (a.phase) {
    case 'Wind-up': {
      if (intent.whirlwind === true) {
        const ticks = a.ticks + 1;
        const arms = !a.armed && ticks >= t.armTicks;
        if (arms) ctx.emit({ type: 'WhirlwindArmed', fighter: ctx.fighter });
        return playHold({ ...a, ticks, armed: a.armed || arms }, ticks, ctx.tuning, f.weapon);
      }
      if (a.armed) return playSpin({ ...enter(a, 'Spin', ctx), turn: 0, heading: wrapYaw(f.facing) }, ctx.tuning, f.weapon);
      ctx.emit({ type: 'WhirlwindPhase', fighter: ctx.fighter, phase: 'Cancelled' });
      return { action: IDLE_ACTION, motion: IDLE_MOTION };
    }
    case 'Spin': {
      const ticks = a.ticks + 1;
      const heading = steerHeading(a.heading ?? f.facing, intent.face ?? null, ctx.tuning);
      if (ticks >= t.spinTicks) return { action: { ...enter({ ...a, heading }, 'Recovery', ctx), turn: ctx.tuning.whirlwind.turns - 1 }, motion: IDLE_MOTION };
      return playSpin({ ...a, ticks, turn: Math.floor(ticks / t.turnTicks), heading }, ctx.tuning, f.weapon);
    }
    case 'Recovery': {
      const ticks = a.ticks + 1;
      if (ticks >= t.recoveryTicks) return { action: IDLE_ACTION, motion: IDLE_MOTION };
      // The Tick that entered Recovery began the Idle Motion at its Tick 0; it plays on one Tick at a time (the Motion Blend takes the pose back to guard).
      return { action: { ...a, ticks }, motion: advance(f.motion) };
    }
  }
};
