/**
 * The Simulation: a pure, deterministic, fixed-Tick step from
 * (state, Intents, Tuning Data) to the next state (ADR 0001).
 *
 * Rules for everything under src/sim:
 *   - no wall-clock time, no Math.random (use ./rng, held in state)
 *   - no DOM, no three.js, no rendering
 *   - never mutate an input state
 * The purity test (purity.test.ts) enforces the first two mechanically.
 */
export { TICK_RATE, TICK_SECONDS } from './constants';
export type { Direction, Intent } from './intent';
export { DIRECTIONS, IDLE_INTENT } from './intent';
export type {
  Action,
  ActionKind,
  AttackAction,
  AttackPhase,
  DuelState,
  FighterState,
  IdleAction,
  MotionPlayback,
  SimState,
  Vec2,
} from './state';
export { ATTACK_PHASES } from './state';
export type { AttackPhaseEvent, DuelEndEvent, HitEvent, SimEvent } from './events';
export type { RngState } from './rng';
export { CENTRE_PLACEMENT, createInitialState, duelPlacements, fighterPose, step } from './step';
export { attackMotionName, attackTimings, type AttackTimings } from './actions';
export { hitDamage } from './combat';
export { HIT_ZONE_BONES, hitZoneCapsules, type HitCapsule } from './hitZones';
export {
  attack,
  hold,
  intentAt,
  runDuel,
  runScript,
  scriptIntents,
  SETTLE_TICKS,
  trackLength,
  wait,
  walk,
  type DuelScript,
  type ScriptRun,
  type ScriptSegment,
  type TimedEvent,
  type Track,
} from './script';
export { hashState, hashValue } from './hash';
export type { Vec3 } from './vec';
export type { BladeTransform, JointName, Placement, SkeletonPose } from './skeleton';
export { BONES, JOINT_NAMES } from './skeleton';
export { motionPose } from './pose';
export type { Snapshot } from './snapshot';
export { snapshot, restore } from './snapshot';
