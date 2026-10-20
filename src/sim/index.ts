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
  Airborne,
  AttackAction,
  AttackPhase,
  BlockAction,
  BlockImpact,
  DaggerState,
  Death,
  DeathBlow,
  DeathCause,
  FallAction,
  DuelState,
  FighterState,
  IdleAction,
  KickAction,
  KnockdownAction,
  KnockdownPhase,
  MotionPlayback,
  SimState,
  Slide,
  Slow,
  StaggerAction,
  StaggerCause,
  ThrowAction,
  Vec2,
} from './state';
export { ATTACK_PHASES } from './state';
export type { AttackPhaseEvent, BlockEvent, ChamberEvent, DeathEvent, DuelEndEvent, FeintEvent, HitEvent, DaggerBlockedEvent, DaggerHitEvent, DaggerStuckEvent, DaggerThrownEvent, JumpEvent, KickLandedEvent, KickPhaseEvent, KnockdownPhaseEvent, LandEvent, SimEvent, StaggerEvent, StepEvent, WallStrikeEvent } from './events';
export type { Foot, FootState, GaitState } from './gait';
export { arenaOf, blockedAt, deadlyGround, groundBelow, surfaceHeight, surfacesAt, type Ground } from './arena';
export { JITTER_HEADING, JITTER_HOLD, JITTER_POS, jumpArc, jumpArcFrom, jumpHolds, jumpIsSafe, ledgeReach, levelJump, MAX_AIR_TICKS, type LevelJump, type ArcPoint, type FlightPlan, type JumpPlan, type JumpResult } from './jumpArc';
export {
  assembleArena,
  DEFAULT_GEN_PARAMS,
  DEFAULT_JUDGE_RULES,
  generateArena,
  generatedName,
  GENERATOR_VERSION,
  ARENA_SEED_RANGE,
  isArenaName,
  nextArenaName,
  nextArenaSeed,
  parseGeneratedName,
  withGeneratedArena,
  generateLayout,
  GREYBOX_KIT,
  judgeArena,
  MAX_ATTEMPTS,
  turnPoint,
  type GeneratedArena,
  type GenParams,
  type Judgement,
  type JudgeRules,
  type JudgeStats,
  type Kit,
  type Layout,
  type Piece,
  type PieceId,
  type PlacedPiece,
} from './arenaGen';
export { corners, DROP_DAMAGE_LIMIT, findPath, JUMP_HOLDS, navMesh, navPolygon, steer, type DropLink, type JumpLink, type NavLink, type NavMesh, type NavPoint, type PathOptions, type WalkLink } from './nav';
export type { RngState } from './rng';
export { createRng, nextFloat } from './rng';
export { CENTRE_PLACEMENT, createInitialState, defaultTeam, duelPlacements, step, teamPlacements } from './step';
export {
  attackMotionName,
  attackTimings,
  type AttackTimings,
  blockMotionName,
  blocksAttack,
  FALL_MOTION,
  GET_UP_MOTION,
  KICK_MOTION,
  KNOCKDOWN_MOTION,
  kickTimings,
  type KickTimings,
  THROW_MOTION,
  throwTimings,
  type ThrowTimings,
  LAND_MOTION,
  RECOIL_MOTION,
  STAGGER_MOTION,
  staggerMotionName,
} from './actions';
export { advanceDaggers, launchDagger, type DaggerSweep } from './dagger';
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
export type { BladeTransform, JointName, KickLeg, Placement, SkeletonPose } from './skeleton';
export { BONES, JOINT_NAMES, kickLegOf } from './skeleton';
export { fighterPose, motionPose, playbackPose } from './pose';
export { channelValue, ease, motionTime, restTargets, sampleMotion, type PoseTargets } from './motion';
export { rotateEuler, rotateX, rotateY } from './vec';
export type { Snapshot } from './snapshot';
export { snapshot, restore } from './snapshot';
export {
  checkTeams,
  createMatch,
  duelsToWin,
  MAX_TEAM_SIZE,
  teamMembers,
  stepMatch,
  type DuelStartEvent,
  type MatchConfig,
  type MatchEndEvent,
  type MatchEvent,
  type MatchOptions,
  type MatchState,
  type MatchStatus,
} from './match';
