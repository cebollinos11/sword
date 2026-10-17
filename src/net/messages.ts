import { ATTACK_PHASES, DIRECTIONS, MAX_TEAM_SIZE, type Intent, type MatchOptions, type MatchState, type StaggerCause } from '../sim';
import type { Lineup } from '../controllers';

/** Bumped whenever the wire format changes; peers with different protocols refuse each other. */
export const PROTOCOL_VERSION = 5;

/** The most Fighters a Match fields: two full teams. */
const MAX_FIGHTERS = 2 * MAX_TEAM_SIZE;

/**
 * Sent repeatedly while connecting. Each peer's hello carries its Weapon pick; the host's
 * also carries the Match options and the Lineup (each peer adds both picks to them to build the Match).
 */
export interface HelloMessage {
  readonly type: 'hello';
  readonly protocol: number;
  readonly tuningHash: string;
  readonly weapon?: string;
  readonly match?: MatchOptions;
  readonly lineup?: Lineup;
}

/** "I refused you": lets the peer surface the refusal even if our hello was lost. */
export interface RefuseMessage {
  readonly type: 'refuse';
  readonly reason: RefuseReason;
  readonly tuningHash: string;
}

/**
 * The sender's Intents for Ticks `from`, `from + 1`, ... (every Intent the peer
 * has not acknowledged yet, so a lost packet is covered by the next one), plus
 * `ack`: the last Tick up to which the sender holds all of the peer's Intents.
 */
export interface IntentsMessage {
  readonly type: 'intents';
  readonly from: number;
  readonly intents: readonly Intent[];
  readonly ack: number;
}

/** Host → guest: the state hash of a confirmed Tick. */
export interface ChecksumMessage {
  readonly type: 'checksum';
  readonly tick: number;
  readonly hash: string;
}

/** Guest → host: my hash at `tick` differs from yours; send me your state. */
export interface ResyncRequestMessage {
  readonly type: 'resyncRequest';
  readonly tick: number;
}

/**
 * Host → guest: the host's confirmed Match state at `tick` and its AI Controllers' memory then (one
 * entry per Fighter, null for a Player's), plus the host's own Intents from `intentsFrom` to `tick`
 * that the guest may not have yet.
 */
export interface ResyncMessage {
  readonly type: 'resync';
  readonly tick: number;
  readonly state: MatchState;
  readonly ai: readonly unknown[];
  readonly intentsFrom: number;
  readonly intents: readonly Intent[];
}

export type RefuseReason = 'TuningDataMismatch' | 'ProtocolMismatch';

export type NetMessage = HelloMessage | RefuseMessage | IntentsMessage | ChecksumMessage | ResyncRequestMessage | ResyncMessage;

/**
 * Validate an incoming Transport message. Returns it typed when every field has
 * the right shape (Intents, Match options, resync state included), or null:
 * a malformed message from a broken or hostile peer is ignored, never trusted
 * deep enough to throw inside the Simulation.
 */
export function parseNetMessage(m: unknown): NetMessage | null {
  if (!isObject(m)) return null;
  switch (m.type) {
    case 'hello':
      return isInt(m.protocol) &&
        isString(m.tuningHash) &&
        (m.weapon === undefined || isString(m.weapon)) &&
        (m.match === undefined || isMatchOptions(m.match)) &&
        (m.lineup === undefined || isLineup(m.lineup))
        ? (m as unknown as HelloMessage)
        : null;
    case 'refuse':
      return REFUSE_REASONS.has(m.reason as string) && isString(m.tuningHash) ? (m as unknown as RefuseMessage) : null;
    case 'intents':
      return isTick(m.from) && isIntents(m.intents) && isTick(m.ack) ? (m as unknown as IntentsMessage) : null;
    case 'checksum':
      return isTick(m.tick) && isString(m.hash) ? (m as unknown as ChecksumMessage) : null;
    case 'resyncRequest':
      return isTick(m.tick) ? (m as unknown as ResyncRequestMessage) : null;
    case 'resync':
      return isTick(m.tick) && isTick(m.intentsFrom) && isIntents(m.intents) && isMatchState(m.state) && isArrayOf(m.ai, isAiMemoryOrNull)
        ? (m as unknown as ResyncMessage)
        : null;
    default:
      return null;
  }
}

// --- Shape checks (JSON-level: what came over the wire) ---

type Obj = Record<string, unknown>;
const REFUSE_REASONS: ReadonlySet<string> = new Set<RefuseReason>(['TuningDataMismatch', 'ProtocolMismatch']);
const DIRECTION_SET: ReadonlySet<string> = new Set<string>(DIRECTIONS);
const PHASE_SET: ReadonlySet<string> = new Set<string>(ATTACK_PHASES);
const STAGGER_CAUSES: ReadonlySet<string> = new Set<StaggerCause>(['Hit', 'Blocked', 'Chambered', 'Landed']);

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const isTick = (v: unknown): v is number => isInt(v) && v >= 0;
const isVec2 = (v: unknown): boolean => isObject(v) && isNum(v.x) && isNum(v.z);
const isVec3 = (v: unknown): boolean => isObject(v) && isNum(v.x) && isNum(v.y) && isNum(v.z);
const isDirection = (v: unknown): boolean => DIRECTION_SET.has(v as string);
const isArrayOf = (v: unknown, item: (x: unknown) => boolean): boolean => Array.isArray(v) && v.every(item);
const isTeam = (v: unknown): boolean => v === 0 || v === 1;
/** One entry per Fighter: 2 to MAX_FIGHTERS of them. */
const isPerFighter = (v: unknown, item: (x: unknown) => boolean): boolean =>
  isArrayOf(v, item) && (v as unknown[]).length >= 2 && (v as unknown[]).length <= MAX_FIGHTERS;
/** One Weapon name per Fighter. Whether the names exist is for Tuning Data to say. */
const isWeapons = (v: unknown): boolean => isPerFighter(v, isString);
/** Whether each team's size is allowed is for `checkTeams` to say. */
const isTeams = (v: unknown): boolean => isPerFighter(v, isTeam);
const isNullable = (item: (x: unknown) => boolean) => (v: unknown): boolean => v === null || item(v);

/** Who fights: per slot a team and a Pilot (a Player, or an AI difficulty), and an optional AI Weapon. Tuning Data and `checkLineup` judge the rest. */
function isLineupSlot(v: unknown): boolean {
  if (!isObject(v) || !isTeam(v.team) || !isObject(v.pilot) || (v.weapon !== undefined && !isString(v.weapon))) return false;
  const p = v.pilot;
  return (p.kind === 'Player' && (p.player === 0 || p.player === 1)) || (p.kind === 'AI' && isString(p.difficulty));
}
const isLineup = (v: unknown): v is Lineup => isPerFighter(v, isLineupSlot);

function isIntent(v: unknown): v is Intent {
  return isObject(v) && isVec2(v.move) && isDirection(v.direction) && isBool(v.attack) && isBool(v.block) && (v.face === null || isNum(v.face)) && (v.pitch === undefined || isNum(v.pitch)) && (v.jump === undefined || isBool(v.jump));
}
const isIntents = (v: unknown): v is readonly Intent[] => isArrayOf(v, isIntent);

function isMatchOptions(v: unknown): boolean {
  return (
    isObject(v) &&
    isInt(v.bestOf) &&
    v.bestOf > 0 &&
    (v.distance === undefined || (isNum(v.distance) && v.distance > 0)) &&
    (v.interDuelTicks === undefined || (isInt(v.interDuelTicks) && v.interDuelTicks >= 1)) &&
    (v.rematchTicks === undefined || v.rematchTicks === null || (isInt(v.rematchTicks) && v.rematchTicks >= 1)) &&
    (v.seed === undefined || isNum(v.seed)) &&
    (v.spacing === undefined || (isNum(v.spacing) && v.spacing > 0)) &&
    (v.weapons === undefined || isWeapons(v.weapons)) &&
    (v.teams === undefined || isTeams(v.teams)) &&
    (v.arena === undefined || (isString(v.arena) && v.arena.length > 0))
  );
}

function isAction(v: unknown): boolean {
  if (!isObject(v)) return false;
  switch (v.kind) {
    case 'Idle':
      return true;
    case 'Attack':
      return isDirection(v.direction) && PHASE_SET.has(v.phase as string) && isBool(v.landed);
    case 'Block':
      return isDirection(v.direction);
    case 'Stagger':
      return STAGGER_CAUSES.has(v.cause as string);
    case 'Fall':
      return true;
    default:
      return false;
  }
}

/** One foot of the Gait: planted on the floor, or stepping toward a target. */
function isFoot(v: unknown): boolean {
  return isObject(v) && isVec2(v.planted) && isNum(v.y) && (v.step === null || (isObject(v.step) && isTick(v.step.tick) && isVec2(v.step.target) && isNum(v.step.y)));
}

/** A Motion Blend: the pose it fades from (every Pose target channel) and how far in it is. */
function isMotionBlend(v: unknown): boolean {
  if (!isObject(v) || !isTick(v.tick) || !isObject(v.from)) return false;
  const f = v.from;
  return (
    isObject(f.rightHand) &&
    isVec3(f.rightHand.position) &&
    isVec3(f.rightHand.rotation) &&
    isObject(f.leftHand) &&
    isVec3(f.leftHand.position) &&
    isObject(f.torso) &&
    isNum(f.torso.twist) &&
    isNum(f.torso.lean) &&
    isVec3(f.hip) &&
    isVec2(f.leftFoot) &&
    isVec2(f.rightFoot)
  );
}

/** A Fighter off the ground: its velocity, the top of its arc, and how long it has flown. */
function isAirborne(v: unknown): boolean {
  return isObject(v) && isNum(v.vx) && isNum(v.vz) && isNum(v.vy) && isNum(v.peakY) && isTick(v.ticks) && isBool(v.jumped);
}

function isFighter(v: unknown): boolean {
  return (
    isObject(v) &&
    isVec2(v.position) &&
    isNum(v.y) &&
    (v.air === undefined || isAirborne(v.air)) &&
    isNum(v.facing) &&
    isNum(v.pitch) &&
    isTeam(v.team) &&
    isNum(v.hp) &&
    isString(v.weapon) &&
    isAction(v.action) &&
    isObject(v.motion) &&
    isString(v.motion.name) &&
    isTick(v.motion.tick) &&
    (v.motion.blend === undefined || isMotionBlend(v.motion.blend)) &&
    isObject(v.blade) &&
    isVec3(v.blade.hilt) &&
    isVec3(v.blade.tip) &&
    isVec3(v.blade.edge) &&
    isObject(v.gait) &&
    isFoot(v.gait.left) &&
    isFoot(v.gait.right) &&
    (v.death === undefined || isDeath(v.death))
  );
}

const isEvent = (v: unknown): boolean => isObject(v) && isString(v.type);
/** A winner is a team. */
const isWinner = isTeam;

function isDuelState(v: unknown): boolean {
  if (!isObject(v)) return false;
  if (v.status === 'Fighting') return true;
  return v.status === 'Over' && (v.winner === null || isWinner(v.winner)) && isTick(v.tick);
}

function isSimState(v: unknown): boolean {
  return (
    isObject(v) &&
    isTick(v.tick) &&
    isString(v.arena) &&
    isObject(v.rng) &&
    isInt(v.rng.seed) &&
    isPerFighter(v.fighters, isFighter) &&
    isDuelState(v.duel) &&
    isArrayOf(v.events, isEvent)
  );
}

function isMatchState(v: unknown): v is MatchState {
  if (!isObject(v) || !isObject(v.config) || !isObject(v.status)) return false;
  const { config, status } = v;
  return (
    isInt(config.bestOf) &&
    config.bestOf > 0 &&
    isNum(config.distance) &&
    isNum(config.spacing) &&
    isTeams(config.teams) &&
    isInt(config.interDuelTicks) &&
    config.interDuelTicks >= 1 &&
    (config.rematchTicks === null || (isInt(config.rematchTicks) && config.rematchTicks >= 1)) &&
    isWeapons(config.weapons) &&
    (config.weapons as unknown[]).length === (config.teams as unknown[]).length &&
    isInt(v.matchNumber) &&
    v.matchNumber >= 1 &&
    isTick(v.tick) &&
    isInt(v.duelNumber) &&
    v.duelNumber >= 1 &&
    isArrayOf(v.score, isTick) &&
    (v.score as unknown[]).length === 2 &&
    isSimState(v.duel) &&
    (v.duel as Obj & { fighters: unknown[] }).fighters.length === (config.teams as unknown[]).length &&
    (v.nextDuelTick === null || isTick(v.nextDuelTick)) &&
    (status.status === 'InProgress' || (status.status === 'Over' && isWinner(status.winner) && isTick(status.tick))) &&
    isArrayOf(v.events, isEvent)
  );
}

/** How a Fighter fell: the Tick, and the felling blow if known. */
function isDeath(v: unknown): boolean {
  if (!isObject(v) || !isTick(v.tick) || (v.cause !== 'Hit' && v.cause !== 'Fall')) return false;
  const b = v.blow;
  return b === null || (isObject(b) && isVec3(b.point) && isNum(b.bladeSpeed) && isDirection(b.direction) && isVec2(b.from));
}

/** What an AI saw of one Fighter on one Tick. */
function isSighting(v: unknown): boolean {
  return isObject(v) && isVec2(v.position) && isAction(v.action) && isTeam(v.team) && isBool(v.fallen) && (v.attackStart === null || isTick(v.attackStart));
}

/** An AI Controller's memory (its `save()`): what it saw of every Fighter on its last Ticks, and its Block and Feint plans. */
function isAiMemory(v: unknown): boolean {
  if (!isObject(v) || !isInt(v.lastTick)) return false;
  const seen = isArrayOf(v.seen, (o) => isObject(o) && isTick(o.tick) && isPerFighter(o.fighters, isSighting));
  const block = v.blockPlan === null || (isObject(v.blockPlan) && isTick(v.blockPlan.attacker) && isTick(v.blockPlan.attackStart) && isDirection(v.blockPlan.direction));
  const feint = v.feintPlan === null || (isObject(v.feintPlan) && isDirection(v.feintPlan.from) && isDirection(v.feintPlan.into) && isInt(v.feintPlan.at));
  return seen && block && feint;
}
const isAiMemoryOrNull = isNullable(isAiMemory);
