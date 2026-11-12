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
export { foldMods, isNoMods, MODS_KEYS, modsOf, NO_MODS, setMods, type Mods } from './mods';
export { secondsToTicks, TICK_RATE, TICK_SECONDS } from './constants';
export type { Direction, Intent, InventoryRef } from './intent';
export { addItem, canChangeInventory, dropItem, equipItem, holdInventory, inventoryMods, startingInventory, useInventory, wieldedWeapon, type Dropped, type Inventory } from './inventory';
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
  DrawAction,
  FallAction,
  DuelState,
  FighterState,
  IdleAction,
  KickAction,
  KnockdownAction,
  KnockdownPhase,
  MotionPlayback,
  SimState,
  SimHall,
  HallPhase,
  SoldierBinding,
  SoldierRole,
  SheatheAction,
  Slide,
  Slow,
  StaggerAction,
  StaggerCause,
  ThrowAction,
  Vec2,
} from './state';
export { ATTACK_PHASES } from './state';
export type { AttackPhaseEvent, BlockEvent, ChainKnockdownEvent, ChamberEvent, DeathEvent, DuelEndEvent, FeintEvent, HitEvent, DaggerBlockedEvent, DaggerHitEvent, DaggerStuckEvent, DaggerThrownEvent, DrawnEvent, JumpEvent, KickLandedEvent, KickPhaseEvent, KnockdownPhaseEvent, LandEvent, SheathedEvent, SimEvent, StaggerEvent, StepEvent, WallStrikeEvent } from './events';
export type { Foot, FootState, GaitState } from './gait';
export { arenaOf, blockedAt, deadlyGround, groundBelow, insideZone, onSurface, surfaceHeight, surfacesAt, wallCrossing, wallHit, type Ground } from './arena';
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
export { CENTRE_PLACEMENT, createInitialState, defaultTeam, duelPlacements, standingFighter, step, teamPlacements } from './step';
export {
  attackMotionName,
  attackTimings,
  type AttackTimings,
  blockMotionName,
  blocksAttack,
  FALL_MOTION,
  GET_UP_MOTION,
  GUARD_FROM_GET_UP,
  KICK_MOTION,
  KNOCKDOWN_MOTION,
  kickTimings,
  type KickTimings,
  THROW_MOTION,
  throwTimings,
  type ThrowTimings,
  idleMotionFor,
  offHandFree,
  SHEATHED_IDLE_MOTION,
  SHEATHED_RUN_MOTION,
  sheatheMotionName,
  sheatheTimings,
  type SheatheKind,
  type SheatheTimings,
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
export { inDuel } from './duel';
export type { Vec3 } from './vec';
export type { BladeTransform, JointName, KickLeg, Placement, SkeletonPose } from './skeleton';
export { BONES, JOINT_NAMES, kickLegOf } from './skeleton';
export { fighterPose, motionPose, playbackPose } from './pose';
export { channelValue, ease, motionTime, restTargets, sampleMotion, type PoseTargets } from './motion';
export { authoredSeconds, motionTempo, playedSeconds } from './tempo';
export { rotateEuler, rotateX, rotateY } from './vec';
export type { Snapshot } from './snapshot';
export { snapshot, restore, deepCopy } from './snapshot';
export {
  checkRunTeams,
  checkTeams,
  createMatch,
  doorTicksNeeded,
  duelsToWin,
  hallBehind,
  hallDuel,
  MATCH_FORMATS,
  MAX_TEAM_SIZE,
  runCleared,
  runHall,
  takenExit,
  teamMembers,
  stepMatch,
  type DoorTakenEvent,
  type DuelStartEvent,
  type HallClearedEvent,
  type DroppedItem,
  type ItemDroppedEvent,
  type ItemTakenEvent,
  placeDrop,
  takeOverFighter,
  type MatchConfig,
  type MatchEndEvent,
  type MatchEvent,
  type MatchFormat,
  type MatchOptions,
  type MatchState,
  type MatchStatus,
  type RestedEvent,
  type RunEndEvent,
  type RunState,
} from './match';
export { hallDrops, PICKUP_RADIUS, pickupVisibleTo, startPickups, takePickups, type Pickup, type PickupAt, type Taken } from './pickups';
export { FLOOR_ROWS, floorGraph, MAX_HALL_EXITS, runPick, runSeed, type FloorGraph, type Hall } from './dungeon';
export {
  atRestFire,
  doorCounters,
  enemyMaxHp,
  exitDoor,
  hallKey,
  hallOf,
  hallRoster,
  inExitZone,
  REST_FIRE_RADIUS,
  restFire,
  runKit,
  runPathTo,
  presentPlayers,
  runPlayers,
  ZONE_HEIGHT,
  type HallEnemy,
  type HallRef,
  type RunStart,
} from './hall';
export { routTicks, stepBattle, type BattleEndEvent, type RoutEvent } from './battle';
export { battleArenaName, battlefieldHeight, battlefieldOf, blockWalls, groundHeight, groundOf, soldierHeight, battleMapName, battleNameFor, heightfield, inBlock, isBattleName, OPEN_FIELD, parseBattleName, pushOutOfBlocks, type Battlefield, type Heightfield, type MapObjective, type MapPoint } from './battlefield';
export { ATTACK, brainTicks, COLUMN, DEFEND, deploySquads, FALL, formationNarrow, formationSpot, LINE, LOOSE, orderSpot, placeOffset, RESPAWN, squadDue, squadNarrows, squadsPerTeam, stepSquads, type Spawned, type SquadState, type SquadStep } from './squad';
export { battleMapOf, clearanceAt, clearanceBelow, descend, destinationFields, fieldDistance, inSight, lineClear, steerToward, toward, type BattleMap, type DestinationFields, type FieldLevels } from './destinations';
export { groundNear, probeEdges, sameLevel, trace, walkCheck, walkTo } from './levels';
export { captureTicks, createObjectives, drainDue, drainTickets, limitLoser, limitTicks, owned, planTicks, respawnTicks, stepObjectives, type ObjectiveState } from './objectives';
export { planOrders } from './commander';
export { createCrowd, crowdAlive, crowdDue, FRESH_PLAYER, ringSpots, routs, soldierBody, soldierSize, soldierSizes, soldierTroops, stepCrowd, troopOf, type BattlePlayer, type CrowdFighter, type CrowdState, type Rout } from './crowd';
export { bubblePlayer, canChooseTroop, isBound, stepBubbles, takeoverSpawns, takeoverTarget, takeoverTroops, unboundSlot } from './bubble';
