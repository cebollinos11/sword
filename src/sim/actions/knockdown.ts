/**
 * The Knockdown Action (ADR 0007): the Fighter falls flat on its back (Falling, the Knockdown Motion tilting
 * the whole body), lies there for `kick.knockdownTicks` (Down, the Motion held at its end) and gets up
 * (Rising, the GetUp Motion), then is Idle again. Knocked down in the air, it lies in the air and its time lying
 * only counts on the ground: it lies the whole `kick.knockdownTicks` after it lands, and never gets up mid-air. It interrupts whatever the Fighter was doing and ends only
 * by running its course. Only once the Get-up is `GUARD_FROM_GET_UP` of the way through can it guard (hold block: `guard`
 * is the Direction held, which Blocks by the normal rule), unless it is Sheathed. Throughout it cannot turn, move, Attack, Kick or Jump. It can be hit like anyone: its Hit Zones
 * lie where the body lies.
 */
import { weaponMotion, type TuningData } from '../../tuning';
import { secondsToTicks } from '../constants';
import type { KnockdownAction } from '../state';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import { advance, type ActionHandler, type ActionUpdate } from './types';

/** The Motion that animates (and times) the fall, and is held while the Fighter lies. */
export const KNOCKDOWN_MOTION = 'Knockdown';
/** The Motion that animates (and times) the Get-up. */
export const GET_UP_MOTION = 'GetUp';

/** How far through the Get-up Motion (0 to 1) a Fighter can guard again; falling, lying and before then it holds none. */
export const GUARD_FROM_GET_UP = 0.5;

/** A Knockdown from its first Tick. */
export const knockdown = (): ActionUpdate => {
  const action: KnockdownAction = { kind: 'Knockdown', phase: 'Falling', ticks: 0, guard: null };
  return { action, motion: { name: KNOCKDOWN_MOTION, tick: 0 } };
};

/** The length in Ticks of a Motion as `weapon` plays it. */
function motionTicks(tuning: TuningData, weapon: string, name: string): number {
  const motion = weaponMotion(tuning, weapon, name);
  if (!motion) throw new Error(`No Motion "${name}" for the Knockdown Action`);
  return secondsToTicks(motion.duration);
}

export const updateKnockdown: ActionHandler<KnockdownAction> = (f, intent, ctx) => {
  const a = f.action;
  switch (a.phase) {
    case 'Falling': {
      const end = motionTicks(ctx.tuning, f.weapon, KNOCKDOWN_MOTION);
      if (f.motion.tick + 1 >= end) {
        ctx.emit({ type: 'KnockdownPhase', fighter: ctx.fighter, phase: 'Down' });
        return { action: { ...a, phase: 'Down', ticks: 0, guard: null }, motion: { name: KNOCKDOWN_MOTION, tick: end } };
      }
      return { action: { ...a, guard: null }, motion: advance(f.motion) };
    }
    case 'Down': {
      // In the air the time lying waits for the ground.
      if (f.air) return { action: { ...a, guard: null }, motion: f.motion };
      const ticks = a.ticks + 1;
      if (ticks >= ctx.tuning.kick.knockdownTicks) {
        ctx.emit({ type: 'KnockdownPhase', fighter: ctx.fighter, phase: 'Rising' });
        return { action: { ...a, phase: 'Rising', ticks: 0, guard: null }, motion: { name: GET_UP_MOTION, tick: 0 } };
      }
      return { action: { ...a, ticks, guard: null }, motion: f.motion };
    }
    case 'Rising': {
      const end = motionTicks(ctx.tuning, f.weapon, GET_UP_MOTION);
      // Pushed off the ground while getting up, it holds its pose until it lands.
      const motion = f.air ? f.motion : advance(f.motion);
      if (!f.air && f.motion.tick + 1 >= end) return { action: IDLE_ACTION, motion: IDLE_MOTION };
      // Far enough up, holding block guards in the Intent's Direction; the guard follows the Intent every Tick. A Sheathed Fighter has nothing to guard with.
      const guard = intent.block && !f.sheathed && motion.tick >= end * GUARD_FROM_GET_UP ? intent.direction : null;
      return { action: { ...a, guard }, motion };
    }
  }
};
