/**
 * The Block Action: hold the block button to Block in the Intent's Direction (chosen on
 * press); let go to return to Idle. Whether a Block stops an Attack is decided
 * by rule, never by blade geometry (ADR 0002): see `blocksAttack`. The geometry only
 * decides when it lands: at the blade or the body, whichever the Blade Sweep reaches first.
 */
import { weaponByName, weaponMotion, type TuningData } from '../../tuning';
import { secondsToTicks, TICK_SECONDS } from '../constants';
import { mirrorDirection, type Direction } from '../intent';
import { motionTargets, type PoseTargets } from '../motion';
import type { BlockAction, BlockImpact, FighterState } from '../state';
import type { Vec3 } from '../vec';
import { IDLE_ACTION, IDLE_MOTION } from './idleAction';
import type { ActionHandler, ActionStarter } from './types';

/** The Motion that animates a Block in `direction` (one Motion file per Direction; where it holds the blade is where Blocks land). */
export const blockMotionName = (direction: Direction): string => `Block${direction}`;

/** Pressing block (from Idle) raises a Block in the Intent's Direction. */
export const startBlock: ActionStarter = (f, intent) => {
  if (!intent.block || f.sheathed) return null;
  const action: BlockAction = { kind: 'Block', direction: intent.direction, age: 0 };
  return { action, motion: { name: blockMotionName(action.direction), tick: 0 } };
};

/**
 * The Block lasts while the block button is held; the playhead stops at the end of the (non-looping) Block Motion.
 * For `block.correctionWindow` after it was raised, a changed Intent Direction re-aims it: the new Direction's
 * Motion starts from the top and the Motion Blend carries the blade across from where it was.
 */
export const updateBlock: ActionHandler<BlockAction> = (f, intent, ctx) => {
  if (!intent.block) return { action: IDLE_ACTION, motion: IDLE_MOTION };
  const a = f.action;
  const age = a.age + 1;
  if (intent.direction !== a.direction && age <= secondsToTicks(ctx.tuning.block.correctionWindow)) {
    return { action: { ...a, direction: intent.direction, age }, motion: { name: blockMotionName(intent.direction), tick: 0 } };
  }
  const motion = weaponMotion(ctx.tuning, f.weapon, f.motion.name);
  const end = motion ? secondsToTicks(motion.duration) : 0;
  return { action: { ...a, age }, motion: { name: f.motion.name, tick: Math.min(f.motion.tick + 1, end) } };
};

/**
 * The Block rule: `defender` stops an Attack in `direction` from `attacker`
 * when it is Blocking in the mirrored Direction (a Right Attack arrives on the
 * defender's left, so it needs a Left Block) and roughly faces the attacker.
 */
export function blocksAttack(defender: FighterState, attacker: FighterState, direction: Direction, tuning: TuningData): boolean {
  if (guardDirection(defender) !== mirrorDirection(direction)) return false;
  return roughlyFaces(defender, attacker, tuning);
}

/** The Direction a Fighter guards in: its Block's, or the guard a Knockdown holds; null when it guards nothing. */
export function guardDirection(f: FighterState): Direction | null {
  if (f.action.kind === 'Block') return f.action.direction;
  return f.action.kind === 'Knockdown' ? f.action.guard : null;
}

/**
 * `targets` with both hands (and so the Weapon) held as a Block in `direction` holds them, over whatever
 * the rest of the body is doing: a Fighter lying down guards from the floor. The body channels stay as they were.
 */
export function applyGuard(targets: PoseTargets, direction: Direction, tuning: TuningData, weapon: string): PoseTargets {
  const motion = weaponMotion(tuning, weapon, blockMotionName(direction));
  if (!motion) throw new Error(`No Motion "${blockMotionName(direction)}" to guard with`);
  const { rightHand, leftHand } = motionTargets(tuning, weapon, motion.name, secondsToTicks(motion.duration));
  return { ...targets, rightHand, leftHand };
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

/**
 * The Block Impact of a blow at `bladeSpeed` from `attacker` stopped by `defender`'s Block: the
 * Blade Speed over the attacker's Weapon's reference speed (clamped), scaled by the attacker's
 * Weapon's `blockImpact.dealt` and the defender's Weapon's `blockImpact.taken`.
 */
export function startBlockImpact(attacker: FighterState, defender: FighterState, direction: Direction, bladeSpeed: number, tuning: TuningData): BlockImpact {
  const dealt = weaponByName(tuning, attacker.weapon);
  const taken = weaponByName(tuning, defender.weapon);
  const clamped = Math.min(IMPACT_STRENGTH_MAX, Math.max(IMPACT_STRENGTH_MIN, bladeSpeed / dealt.speed));
  return { direction, strength: clamped * dealt.blockImpact.dealt * taken.blockImpact.taken, tick: 0 };
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
