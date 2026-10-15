/**
 * The Block Action: hold the block button to Block in the Intent's Direction (chosen on
 * press); let go to return to Idle. Whether a Block stops an Attack is decided
 * by rule, never by blade geometry (ADR 0002): see `blocksAttack`.
 */
import type { TuningData } from '../../tuning';
import { secondsToTicks, TICK_SECONDS } from '../constants';
import { mirrorDirection, type Direction } from '../intent';
import type { PoseTargets } from '../motion';
import type { BlockAction, BlockImpact, FighterState } from '../state';
import type { Vec3 } from '../vec';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import type { ActionHandler, ActionStarter } from './types';

/** The Motion that animates a Block in `direction` (cosmetic only; one Motion file per Direction). */
export const blockMotionName = (direction: Direction): string => `Block${direction}`;

/** Pressing block (from Idle) raises a Block in the Intent's Direction. */
export const startBlock: ActionStarter = (_f, intent) => {
  if (!intent.block) return null;
  const action: BlockAction = { kind: 'Block', direction: intent.direction };
  return { action, motion: { name: blockMotionName(action.direction), tick: 0 } };
};

/** The Block lasts while the block button is held; the playhead stops at the end of the (non-looping) Block Motion. */
export const updateBlock: ActionHandler<BlockAction> = (f, intent, ctx) => {
  if (!intent.block) return { action: IDLE_ACTION, motion: IDLE_MOTION };
  const motion = ctx.tuning.motions[f.motion.name];
  const end = motion ? secondsToTicks(motion.duration) : 0;
  return { action: f.action, motion: { name: f.motion.name, tick: Math.min(f.motion.tick + 1, end) } };
};

/**
 * The Block rule: `defender` stops an Attack in `direction` from `attacker`
 * when it is Blocking in the mirrored Direction (a Right Attack arrives on the
 * defender's left, so it needs a Left Block) and roughly faces the attacker.
 */
export function blocksAttack(defender: FighterState, attacker: FighterState, direction: Direction, tuning: TuningData): boolean {
  if (defender.action.kind !== 'Block' || defender.action.direction !== mirrorDirection(direction)) return false;
  return roughlyFaces(defender, attacker, tuning);
}

/** Whether `other` lies within `block.facingHalfAngle` (Tuning Data) of `f`'s facing (used by Blocks and Chambers). */
export function roughlyFaces(f: FighterState, other: FighterState, tuning: TuningData): boolean {
  const dx = other.position.x - f.position.x;
  const dz = other.position.z - f.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist === 0) return true;
  // Facing f looks along (sin f, cos f) on the ground plane.
  const cos = (Math.sin(f.facing) * dx + Math.cos(f.facing) * dz) / dist;
  return cos >= Math.cos((tuning.block.facingHalfAngle * Math.PI) / 180);
}

/** How hard a Blocked blow can shake the hand, as multiples of a blow at the Weapon's reference Blade Speed. */
const IMPACT_STRENGTH_MIN = 0.5;
const IMPACT_STRENGTH_MAX = 1.5;

/**
 * Which way (Fighter-local: +x right, +y up, +z forward) a blow knocks the
 * sword hand of a Block in each Direction: always back towards the body, and
 * along the swing it stopped (a Left Block meets a blade coming from the left).
 */
const IMPACT_PUSH: Record<Direction, Vec3> = {
  Left: { x: 0.6, y: 0, z: -0.8 },
  Right: { x: -0.6, y: 0, z: -0.8 },
  Overhead: { x: 0, y: -0.7, z: -0.7 },
  Thrust: { x: 0, y: 0, z: -1 },
};

/** The Block Impact of a blow at `bladeSpeed` stopped by `block`. */
export function startBlockImpact(block: BlockAction, bladeSpeed: number, tuning: TuningData): BlockImpact {
  const strength = Math.min(IMPACT_STRENGTH_MAX, Math.max(IMPACT_STRENGTH_MIN, bladeSpeed / tuning.weapon.speed));
  return { direction: block.direction, strength, tick: 0 };
}

/** The Block Impact one Tick on, or undefined once it has settled (`block.impactDuration`). */
export function advanceBlockImpact(impact: BlockImpact, tuning: TuningData): BlockImpact | undefined {
  const tick = impact.tick + 1;
  return tick >= secondsToTicks(tuning.block.impactDuration) ? undefined : { ...impact, tick };
}

/**
 * The Block Impact's displacement at its Tick, as a fraction of the full give:
 * a damped spring struck from rest, so the hand is knocked back, overshoots
 * forward, and rings down to nothing by `block.impactDuration`.
 */
export function blockImpactShake(impact: BlockImpact, tuning: TuningData): number {
  const { impactFrequency, impactDuration } = tuning.block;
  const t = impact.tick * TICK_SECONDS;
  return impact.strength * Math.exp((-3 * t) / impactDuration) * Math.sin(2 * Math.PI * impactFrequency * t);
}

/** `targets` with the sword hand knocked back, the blade tipped and the torso rocked by a Block Impact. */
export function applyBlockImpact(targets: PoseTargets, impact: BlockImpact, tuning: TuningData): PoseTargets {
  const shake = blockImpactShake(impact, tuning);
  const { impactDistance, impactTilt, impactLean } = tuning.block;
  const push = IMPACT_PUSH[impact.direction];
  const d = impactDistance * shake;
  const { position, rotation } = targets.rightHand;
  return {
    ...targets,
    rightHand: {
      position: { x: position.x + push.x * d, y: position.y + push.y * d, z: position.z + push.z * d },
      rotation: { ...rotation, x: rotation.x - impactTilt * shake },
    },
    torso: { ...targets.torso, lean: targets.torso.lean - impactLean * shake },
  };
}
