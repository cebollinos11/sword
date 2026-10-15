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
export { secondsToTicks, TICK_RATE, TICK_SECONDS } from './constants';
export type { Direction, Intent } from './intent';
export { DIRECTIONS, IDLE_INTENT, mirrorDirection } from './intent';
export type {
  Action,
  ActionKind,
  AttackAction,
  AttackPhase,
  BlockAction,
  BlockImpact,
  Death,
  DeathBlow,
  DuelState,
  FighterState,
  IdleAction,
  MotionPlayback,
  SimState,
  StaggerAction,
  StaggerCause,
  Vec2,
} from './state';
export { ATTACK_PHASES } from './state';
export type { AttackPhaseEvent, BlockEvent, ChamberEvent, DuelEndEvent, FeintEvent, HitEvent, SimEvent, StaggerEvent, StepEvent } from './events';
export type { Foot, FootState, GaitState } from './gait';
export type { RngState } from './rng';
export { createRng, nextFloat } from './rng';
export { CENTRE_PLACEMENT, createInitialState, duelPlacements, step } from './step';
export {
  attackMotionName,
  attackTimings,
  type AttackTimings,
  blockMotionName,
  blocksAttack,
  RECOIL_MOTION,
  STAGGER_MOTION,
  staggerMotionName,
} from './actions';
export { hitDamage } from './combat';
export { chamberWindowTicks } from './chamber';
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
export { fighterPose, motionPose, playbackPose } from './pose';
export { ease, motionTime, restTargets, sampleMotion, type PoseTargets } from './motion';
export { rotateEuler, rotateX, rotateY } from './vec';
export type { Snapshot } from './snapshot';
export { snapshot, restore } from './snapshot';
export {
  createMatch,
  duelsToWin,
  stepMatch,
  type DuelStartEvent,
  type MatchConfig,
  type MatchEndEvent,
  type MatchEvent,
  type MatchOptions,
  type MatchState,
  type MatchStatus,
} from './match';
