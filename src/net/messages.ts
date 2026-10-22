import { ATTACK_PHASES, DIRECTIONS, MATCH_FORMATS, MAX_TEAM_SIZE, parseGeneratedName, type Intent, type MatchOptions, type KnockdownPhase, type MatchState, type StaggerCause } from '../sim';
import { MAX_PLAYERS, type Lineup } from '../controllers';

/** Bumped whenever the wire format changes; peers with different protocols refuse each other. */
export const PROTOCOL_VERSION = 17;

/** The most Fighters a Match fields: two full teams. */
const MAX_FIGHTERS = 2 * MAX_TEAM_SIZE;

/**
 * Sent repeatedly while connecting. A guest's hello carries its Weapon pick. The host's, once it has
 * every guest's, carries the Match options, the Lineup, every Player's pick (`weapons`, index = Player
 * number) and which Player the guest it goes to is (`player`).
 */
export interface HelloMessage {
  readonly type: 'hello';
  readonly protocol: number;
  readonly tuningHash: string;
  readonly weapon?: string;
  readonly match?: MatchOptions;
  readonly lineup?: Lineup;
  readonly weapons?: readonly string[];
  readonly player?: number;
}

/** "I refused you": lets the peer surface the refusal even if our hello was lost. */
export interface RefuseMessage {
  readonly type: 'refuse';
  readonly reason: RefuseReason;
  readonly tuningHash: string;
}

/** One Player's Intents for Ticks `from`, `from + 1`, ... */
export interface IntentStream {
  readonly player: number;
  readonly from: number;
  readonly intents: readonly Intent[];
}

/** A Player who left mid-Match: the AI drives their Fighter from Tick `tick` on. */
export interface DroppedPlayer {
  readonly player: number;
  readonly tick: number;
}

/**
 * Intents, in streams: a guest sends its own; the host sends its own and relays every other
 * guest's (each stream from where the peer's ack leaves off, so a lost packet is covered by the
 * next one). `tick` is the sender's current Tick; `acks[p]` the last Tick up to which the sender
 * holds all of Player p's Intents. The host also lists the Players who left (`dropped`).
 */
export interface IntentsMessage {
  readonly type: 'intents';
  readonly tick: number;
  readonly streams: readonly IntentStream[];
  readonly acks: readonly number[];
  readonly dropped?: readonly DroppedPlayer[];
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
 * entry per Fighter, null where no AI drives it yet; a Floor AI's on a Run's Team 1 slots), plus the other Players' Intents up to `tick`
 * that the guest may not have yet.
 */
export interface ResyncMessage {
  readonly type: 'resync';
  readonly tick: number;
  readonly state: MatchState;
  readonly ai: readonly unknown[];
  readonly streams: readonly IntentStream[];
}

/** Round-trip probe: the peer answers with a `pong` carrying the same `sent` stamp (the sender's own clock). */
export interface PingMessage {
  readonly type: 'ping' | 'pong';
  readonly sent: number;
}

export type RefuseReason = 'TuningDataMismatch' | 'ProtocolMismatch';

export type NetMessage = HelloMessage | RefuseMessage | IntentsMessage | ChecksumMessage | ResyncRequestMessage | ResyncMessage | PingMessage;

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
        (m.lineup === undefined || isLineup(m.lineup)) &&
        (m.weapons === undefined || (isArrayOf(m.weapons, isString) && (m.weapons as unknown[]).length >= 1 && (m.weapons as unknown[]).length <= MAX_PLAYERS)) &&
        (m.player === undefined || isPlayer(m.player))
        ? (m as unknown as HelloMessage)
        : null;
    case 'refuse':
      return REFUSE_REASONS.has(m.reason as string) && isString(m.tuningHash) ? (m as unknown as RefuseMessage) : null;
    case 'intents':
      return isTick(m.tick) &&
        isStreams(m.streams) &&
        isArrayOf(m.acks, isTick) &&
        (m.acks as unknown[]).length <= MAX_PLAYERS &&
        (m.dropped === undefined || (isArrayOf(m.dropped, isDropped) && (m.dropped as unknown[]).length <= MAX_PLAYERS))
        ? (m as unknown as IntentsMessage)
        : null;
    case 'checksum':
      return isTick(m.tick) && isString(m.hash) ? (m as unknown as ChecksumMessage) : null;
    case 'resyncRequest':
      return isTick(m.tick) ? (m as unknown as ResyncRequestMessage) : null;
    case 'resync':
      return isTick(m.tick) && isStreams(m.streams) && isMatchState(m.state) && isArrayOf(m.ai, isAiMemoryOrNull)
        ? (m as unknown as ResyncMessage)
        : null;
    case 'ping':
    case 'pong':
      return isNum(m.sent) ? (m as unknown as PingMessage) : null;
    default:
      return null;
  }
}

// --- Shape checks (JSON-level: what came over the wire) ---

type Obj = Record<string, unknown>;
const REFUSE_REASONS: ReadonlySet<string> = new Set<RefuseReason>(['TuningDataMismatch', 'ProtocolMismatch']);
const DIRECTION_SET: ReadonlySet<string> = new Set<string>(DIRECTIONS);
const PHASE_SET: ReadonlySet<string> = new Set<string>(ATTACK_PHASES);
const KNOCKDOWN_PHASES: ReadonlySet<string> = new Set<KnockdownPhase>(['Falling', 'Down', 'Rising']);
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
const isPlayer = (v: unknown): boolean => isInt(v) && v >= 0 && v < MAX_PLAYERS;
const FORMAT_SET: ReadonlySet<unknown> = new Set(MATCH_FORMATS);
/** A Match Format this build knows (Duels or Gauntlet); absent means Duels. */
const isFormat = (v: unknown): boolean => FORMAT_SET.has(v);
/** The human Players a Run fields: 1 to Team 0's MAX_TEAM_SIZE. */
const isHumans = (v: unknown): boolean => isInt(v) && v >= 1 && v <= MAX_TEAM_SIZE;

/** A Random Map's name (`gen:<kit>:<seed>`), not a hand-made Arena. */
export function isRandomMapName(v: unknown): boolean {
  if (!isString(v)) return false;
  try {
    return parseGeneratedName(v) !== null;
  } catch {
    return false;
  }
}

/** A Format and Map that go together: a Gauntlet is played on a Random Map only (its seed is the Run seed). */
export function isFormatOnMap(format: unknown, arena: unknown): boolean {
  if (format === undefined) return true;
  return isFormat(format) && (format !== 'Gauntlet' || isRandomMapName(arena));
}

/** Who fights: per slot a team and a Pilot (a Player, or an AI difficulty and optional Style), and an optional AI Weapon. Tuning Data and `checkLineup` judge the rest. */
function isLineupSlot(v: unknown): boolean {
  if (!isObject(v) || !isTeam(v.team) || !isObject(v.pilot) || (v.weapon !== undefined && !isString(v.weapon))) return false;
  const p = v.pilot;
  return (p.kind === 'Player' && isPlayer(p.player)) || (p.kind === 'AI' && isString(p.difficulty) && (p.style === undefined || isString(p.style)));
}
const isLineup = (v: unknown): v is Lineup => isPerFighter(v, isLineupSlot);

function isIntent(v: unknown): v is Intent {
  return isObject(v) && isVec2(v.move) && isDirection(v.direction) && isBool(v.attack) && isBool(v.block) && (v.face === null || isNum(v.face)) && (v.pitch === undefined || isNum(v.pitch)) && (v.jump === undefined || isBool(v.jump)) && (v.jumpHeld === undefined || isBool(v.jumpHeld)) &&(v.crouch === undefined || isBool(v.crouch)) && (v.kick === undefined || isBool(v.kick)) && (v.throw === undefined || isBool(v.throw)) && (v.throwHeld === undefined || isBool(v.throwHeld)) && (v.sheathe === undefined || isBool(v.sheathe));
}
const isIntents = (v: unknown): v is readonly Intent[] => isArrayOf(v, isIntent);
const isStream = (v: unknown): boolean => isObject(v) && isPlayer(v.player) && isTick(v.from) && isIntents(v.intents);
/** At most one stream per Player. */
const isStreams = (v: unknown): boolean =>
  isArrayOf(v, isStream) && new Set((v as { player: number }[]).map((s) => s.player)).size === (v as unknown[]).length;
const isDropped = (v: unknown): boolean => isObject(v) && isPlayer(v.player) && isTick(v.tick) && v.tick >= 1;

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
    (v.arena === undefined || (isString(v.arena) && v.arena.length > 0)) &&
    isFormatOnMap(v.format, v.arena) &&
    (v.humans === undefined || isHumans(v.humans))
  );
}

function isAction(v: unknown): boolean {
  if (!isObject(v)) return false;
  switch (v.kind) {
    case 'Idle':
      return true;
    case 'Attack':
      return (
        isDirection(v.direction) &&
        PHASE_SET.has(v.phase as string) &&
        isBool(v.landed) &&
        (v.chain === undefined || (isObject(v.chain) && isDirection(v.chain.direction) && isTick(v.chain.tick)))
      );
    case 'Block':
      return isDirection(v.direction);
    case 'Kick':
      return PHASE_SET.has(v.phase as string) && isBool(v.landed) && (v.whiff === undefined || isTick(v.whiff));
    case 'Throw':
      return PHASE_SET.has(v.phase as string) && isTick(v.startTick) && (v.held === undefined || isTick(v.held));
    case 'Knockdown':
      return KNOCKDOWN_PHASES.has(v.phase as string) && isTick(v.ticks) && (v.guard === null || isDirection(v.guard));
    case 'Stagger':
      return STAGGER_CAUSES.has(v.cause as string) && (v.from === undefined || (v.cause === 'Hit' && isDirection(v.from)));
    case 'Fall':
    case 'Sheathe':
    case 'Draw':
      return true;
    default:
      return false;
  }
}

/** One foot of the Gait: planted on the floor, or stepping toward a target. */
function isFoot(v: unknown): boolean {
  return isObject(v) && isVec2(v.planted) && isNum(v.y) && (v.step === null || (isObject(v.step) && isTick(v.step.tick) && isTick(v.step.ticks) && isVec2(v.step.target) && isNum(v.step.y)));
}

/** A Motion Blend: the pose it fades from (every Pose target channel) and how far in it is. */
function isMotionBlend(v: unknown): boolean {
  if (!isObject(v) || !isTick(v.tick) || (v.ticks !== undefined && !isTick(v.ticks)) || !isObject(v.from)) return false;
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
  return isObject(v) && isNum(v.vx) && isNum(v.vz) && isNum(v.vy) && isNum(v.peakY) && isTick(v.ticks) && isBool(v.jumped) && (v.boost === undefined || isTick(v.boost)) && (v.launchY === undefined || isNum(v.launchY));
}

/** A Slide: its velocity and the Ticks it has left. */
function isSlide(v: unknown): boolean {
  return isObject(v) && isNum(v.vx) && isNum(v.vz) && isTick(v.ticks);
}

/** A Slow: the Ticks it has left. */
function isSlow(v: unknown): boolean {
  return isObject(v) && isTick(v.ticks);
}

function isFighter(v: unknown): boolean {
  return (
    isObject(v) &&
    isVec2(v.position) &&
    isNum(v.y) &&
    (v.air === undefined || isAirborne(v.air)) &&
    (v.slide === undefined || isSlide(v.slide)) &&
    (v.slow === undefined || isSlow(v.slow)) &&
    isNum(v.facing) &&
    isNum(v.pitch) &&
    isNum(v.crouch) &&
    isTeam(v.team) &&
    isNum(v.hp) &&
    isInt(v.daggers) &&
    v.daggers >= 0 &&
    isBool(v.sheathed) &&
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
    isObject(v.kickLeg) &&
    isVec3(v.kickLeg.knee) &&
    isVec3(v.kickLeg.toe) &&
    isObject(v.gait) &&
    isFoot(v.gait.left) &&
    isFoot(v.gait.right) &&
    (v.death === undefined || isDeath(v.death)) &&
    (v.maxHp === undefined || (isNum(v.maxHp) && v.maxHp > 0)) &&
    (v.benched === undefined || v.benched === true)
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

/** A dagger in flight: who threw it, when, and where it is going. */
function isDagger(v: unknown): boolean {
  return isObject(v) && isInt(v.owner) && v.owner >= 0 && isTeam(v.team) && isTick(v.thrownAt) && isVec3(v.position) && isVec3(v.velocity) && isTick(v.ticks);
}

function isSimState(v: unknown): boolean {
  return (
    isObject(v) &&
    isTick(v.tick) &&
    isString(v.arena) &&
    isObject(v.rng) &&
    isInt(v.rng.seed) &&
    isPerFighter(v.fighters, isFighter) &&
    isArrayOf(v.daggers, isDagger) &&
    isDuelState(v.duel) &&
    isArrayOf(v.events, isEvent) &&
    (v.floor === undefined || (isInt(v.floor) && v.floor >= 1))
  );
}

/** A Run's progress: the Floor fought (1 to `floors`), Floors cleared (0 to `floors`), and the Tick it started on. */
function isRun(v: unknown): boolean {
  return isObject(v) && isInt(v.floors) && v.floors >= 1 && isInt(v.floor) && v.floor >= 1 && v.floor <= v.floors && isInt(v.cleared) && v.cleared >= 0 && v.cleared <= v.floors && isTick(v.startTick);
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
    isString(v.arena) &&
    v.arena.length > 0 &&
    isTick(v.tick) &&
    isInt(v.duelNumber) &&
    v.duelNumber >= 1 &&
    isArrayOf(v.score, isTick) &&
    (v.score as unknown[]).length === 2 &&
    isSimState(v.duel) &&
    (v.duel as Obj & { fighters: unknown[] }).fighters.length === (config.teams as unknown[]).length &&
    (v.nextDuelTick === null || isTick(v.nextDuelTick)) &&
    (status.status === 'InProgress' || (status.status === 'Over' && isWinner(status.winner) && isTick(status.tick))) &&
    isArrayOf(v.events, isEvent) &&
    isFormatOnMap(config.format, config.arena) &&
    isFormatOnMap(config.format, v.arena) &&
    (config.humans === undefined || isHumans(config.humans)) &&
    // A Run, and only a Run, carries its progress, and each of its Duels names its Floor.
    (config.format === 'Gauntlet'
      ? isRun(v.run) && (v.duel as Obj).floor === (v.run as Obj).floor && config.rematchTicks === null
      : (v.run === undefined || v.run === null) && (v.duel as Obj).floor === undefined)
  );
}

/** How a Fighter fell: the Tick, and the felling blow if known. */
function isDeath(v: unknown): boolean {
  if (!isObject(v) || !isTick(v.tick) || (v.cause !== 'Hit' && v.cause !== 'Fall' && v.cause !== 'Lava' && v.cause !== 'Water')) return false;
  const b = v.blow;
  return b === null || (isObject(b) && isVec3(b.point) && isNum(b.bladeSpeed) && isDirection(b.direction) && isVec2(b.from));
}

/** What an AI saw of one Fighter on one Tick. */
function isSighting(v: unknown): boolean {
  return (
    isObject(v) &&
    isVec2(v.position) &&
    isNum(v.y) &&
    isVec2(v.velocity) &&
    isAction(v.action) &&
    isNum(v.motionTick) &&
    isNum(v.crouch) &&
    isBool(v.airborne) &&
    isNum(v.hp) &&
    typeof v.weapon === 'string' &&
    isTeam(v.team) &&
    isBool(v.fallen) &&
    isNum(v.pitch) &&
    isBool(v.moving) &&
    (v.attackStart === null || isTick(v.attackStart))
  );
}

const DEFENCE_KINDS = ['Block', 'Duck', 'Chamber', 'Outpace'];
const MODES = ['Neutral', 'Pressure', 'Disengage'];

/** An AI Controller's memory (its `save()`): what it saw of every Fighter on its last Ticks, and its plans. */
function isAiMemory(v: unknown): boolean {
  if (!isObject(v) || !isInt(v.lastTick) || !isNum(v.lastHp)) return false;
  const seen = isArrayOf(v.seen, (o) => isObject(o) && isTick(o.tick) && isPerFighter(o.fighters, isSighting));
  const d = v.defencePlan;
  const holdBreak = (h: unknown) => isObject(h) && isBool(h.go) && isTick(h.at);
  const defence =
    d === null ||
    (isObject(d) &&
      isTick(d.attacker) &&
      isTick(d.attackStart) &&
      DEFENCE_KINDS.includes(d.kind as string) &&
      isDirection(d.direction) &&
      isInt(d.pressAt) &&
      (d.reads === undefined || isBool(d.reads)) &&
      (d.holdBreak === undefined || holdBreak(d.holdBreak)));
  const feint = v.feintPlan === null || (isObject(v.feintPlan) && isDirection(v.feintPlan.from) && isDirection(v.feintPlan.into) && isInt(v.feintPlan.at));
  const a = v.attackPlan;
  const attack =
    a === null ||
    (isObject(a) && isDirection(a.direction) && isInt(a.holdUntil) && isBool(a.reFeintRolled) && isBool(a.chainRolled) && (a.chain === null || isDirection(a.chain)) && isBool(a.chainHeld) && isBool(a.whiff));
  const route =
    v.route === null ||
    (isObject(v.route) && isInt(v.route.from) && isInt(v.route.to) && isTick(v.route.at) && (v.route.links === null || isArrayOf(v.route.links, isTick)));
  const tactic = isObject(v.tactic) && MODES.includes(v.tactic.mode as string) && isInt(v.tactic.until);
  const strafe = isObject(v.strafe) && (v.strafe.sign === 1 || v.strafe.sign === -1) && isInt(v.strafe.until);
  const o = v.opening;
  const opening = o === null || (isObject(o) && isTick(o.fighter) && isInt(o.seen) && isBool(o.go) && isBool(o.fits));
  const focus = v.focus === null || (isObject(v.focus) && isTick(v.focus.fighter) && isInt(v.focus.until));
  return seen && defence && feint && attack && route && tactic && strafe && opening && focus;
}

/**
 * A Floor AI's memory (a Run's Team 1 slot, `src/controllers/floorAi.ts`): the Floor it last saw (-1 for none yet) and
 * that Floor's AI's memory (null on a Floor with no enemy for its slot).
 */
export function isFloorAiMemory(v: unknown): boolean {
  return isObject(v) && isInt(v.floor) && (v.floor === -1 || v.floor >= 1) && (v.memory === null || isAiMemory(v.memory));
}
const isAiMemoryOrNull = isNullable((v) => isAiMemory(v) || isFloorAiMemory(v));
