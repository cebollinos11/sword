import { ATTACK_PHASES, DIRECTIONS, FLOOR_ROWS, isBattleName, MATCH_FORMATS, MAX_HALL_EXITS, MAX_TEAM_SIZE, MODS_KEYS, parseGeneratedName, runPlayers, runSeed, type Intent, type MatchConfig, type MatchFormat, type MatchOptions, type KnockdownPhase, type MatchState, type SoldierRole, type StaggerCause, type Vec3 } from '../sim';
import { AI_MODES, DEFENCE_KINDS, JUMP_STAGES, MAX_PLAYERS, type Lineup } from '../controllers';
import { floorArenaName } from '../sim/delver/world';
import { isSize, MAX_OBJECTIVES, MAX_SQUAD_PLACES, MAX_TROOPS } from '../tuning';

/** Bumped whenever the wire format changes; peers with different protocols refuse each other. */
export const PROTOCOL_VERSION = 29;

/** The most Fighters a Duel or a Run fields: two full teams. */
const MAX_FIGHTERS = 2 * MAX_TEAM_SIZE;
/** The most Fighters a Battle's Fighter Pool fields on the wire (Tuning Data's `battle.bubble.poolSize` says exactly how many). */
const MAX_POOL = 64;
/** The most Soldiers a Battle's Crowd holds on the wire (Tuning Data's `battle.armySize` says exactly how many). */
const MAX_SOLDIERS = 20_000;
/** The most Bodies a Troop names, as a Crowd's `look` may index. */
const MAX_LOOKS = 16;

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
 * entry per Fighter, null where no AI drives it yet; a Hall AI's on a Run's Team 1 slots), plus the other Players' Intents up to `tick`
 * that the guest may not have yet.
 */
export interface ResyncMessage {
  readonly type: 'resync';
  readonly tick: number;
  readonly state: MatchState;
  readonly ai: readonly unknown[];
  readonly streams: readonly IntentStream[];
}

/**
 * Round-trip probe: the peer answers with a `pong` carrying the same `sent` stamp (the sender's own clock), and how long a
 * message waits on its main thread before it is handled (`lag`, ms: see MainThreadLag), so the round trip splits into network and CPU.
 */
export interface PingMessage {
  readonly type: 'ping' | 'pong';
  readonly sent: number;
  /** Pong only; absent from an older peer. */
  readonly lag?: number;
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
      return isNum(m.sent) && (m.lag === undefined || (isNum(m.lag) && m.lag >= 0)) ? (m as unknown as PingMessage) : null;
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
/** One entry per Fighter of a Lineup (a Battle's names only its Players, so 1 or more): 1 to MAX_FIGHTERS of them. Whether the teams fit is for `checkLineup` to say. */
const isPerFighter = (v: unknown, item: (x: unknown) => boolean): boolean =>
  isArrayOf(v, item) && (v as unknown[]).length >= 1 && (v as unknown[]).length <= MAX_FIGHTERS;
/** One entry per Fighter in a Duel, or per slot of a Battle's Fighter Pool: 1 to MAX_POOL of them (`isFormatFighters` says how many). */
const isPerSlot = (v: unknown, item: (x: unknown) => boolean): boolean => isArrayOf(v, item) && (v as unknown[]).length >= 1 && (v as unknown[]).length <= MAX_POOL;
/** One Weapon name per Fighter. Whether the names exist is for Tuning Data to say. */
const isWeapons = (v: unknown): boolean => isPerFighter(v, isString);
/** Whether each team's size is allowed is for `checkTeams` to say. */
const isTeams = (v: unknown): boolean => isPerFighter(v, isTeam);
const isNullable = (item: (x: unknown) => boolean) => (v: unknown): boolean => v === null || item(v);
const isPlayer = (v: unknown): boolean => isInt(v) && v >= 0 && v < MAX_PLAYERS;
/** A Fighter's index: one of a Duel's or a Battle's Fighter Pool's slots. */
const isFighterIndex = (v: unknown): boolean => isInt(v) && v >= 0 && v < MAX_POOL;
const FORMAT_SET: ReadonlySet<unknown> = new Set(MATCH_FORMATS);
/**
 * The Formats a Rollback session plays: the Lobby's wire list (`MATCH_FORMATS`) and a Battle (docs/plans/big-battle.md, Stage 6).
 * `isFormatOnMap` still judges the first; a Battle is on a Battlefield only (`isLobbyFormatOnMap`: the Lobby's Battle, any Map).
 */
const SESSION_FORMATS: ReadonlySet<unknown> = new Set<MatchFormat>([...MATCH_FORMATS, 'Battle']);
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

/** A Battlefield's name (`battle:<seed>`, or a hand-built map's `battle:<map>`: whether this build has the map, the Tuning Data hash says). */
const isBattlefieldName = (v: unknown): boolean => isString(v) && isBattleName(v);

/**
 * A Format and Map that go together: a Gauntlet is played on a Random Map only (its seed is the Run seed). The Lobby's Formats
 * (`MATCH_FORMATS`) by default; `formats` the session's, where a Battle is played on a Battlefield (absent: the one its seed names).
 */
export function isFormatOnMap(format: unknown, arena: unknown, formats: ReadonlySet<unknown> = FORMAT_SET): boolean {
  if (format === undefined) return true;
  if (!formats.has(format)) return false;
  if (format === 'Battle') return arena === undefined || isBattlefieldName(arena);
  return format !== 'Gauntlet' || isRandomMapName(arena);
}
/**
 * A Format and Map a Lobby holds (docs/plans/big-battle.md, Stage 7): the session's Formats, a Battle too. A Battle sets the Lobby's Map
 * aside (it is played on a Battlefield of its own seed, named when it starts), so the Map setting is any Map the Lobby may hold.
 */
export function isLobbyFormatOnMap(format: unknown, arena: unknown): boolean {
  return format === 'Battle' ? true : isFormatOnMap(format, arena);
}
/** A Format and Map a session plays (a Battle too). */
const isSessionFormatOnMap = (format: unknown, arena: unknown): boolean => isFormatOnMap(format, arena, SESSION_FORMATS);

/** Who fights: per slot a team and a Pilot (a Player, or an AI difficulty and optional Style), and an optional AI Weapon. Tuning Data and `checkLineup` judge the rest. */
function isLineupSlot(v: unknown): boolean {
  if (!isObject(v) || !isTeam(v.team) || !isObject(v.pilot) || (v.weapon !== undefined && !isString(v.weapon)) || (v.size !== undefined && !isSize(v.size))) return false;
  const p = v.pilot;
  return (p.kind === 'Player' && isPlayer(p.player)) || (p.kind === 'AI' && isString(p.difficulty) && (p.style === undefined || isString(p.style)));
}
const isLineup = (v: unknown): v is Lineup => isPerFighter(v, isLineupSlot);

/** The most slots an inventory has on the wire (`dungeon.inventory` allows 99 of each kind); whether a slot holds an item is for the Simulation to say. */
const MAX_INVENTORY_SLOTS = 99;
const isSlot = (v: unknown): boolean => isInt(v) && v >= 0 && v < MAX_INVENTORY_SLOTS;
/** An inventory item named by kind and slot (Intent `equip` and `drop`). */
const isInventoryRef = (v: unknown): boolean => isObject(v) && (v.kind === 'weapon' || v.kind === 'relic') && isSlot(v.slot);

function isIntent(v: unknown): v is Intent {
  return isObject(v) && isVec2(v.move) && isDirection(v.direction) && isBool(v.attack) && isBool(v.block) && (v.face === null || isNum(v.face)) && (v.pitch === undefined || isNum(v.pitch)) && (v.jump === undefined || isBool(v.jump)) && (v.jumpHeld === undefined || isBool(v.jumpHeld)) &&(v.crouch === undefined || isBool(v.crouch)) && (v.kick === undefined || isBool(v.kick)) && (v.throw === undefined || isBool(v.throw)) && (v.throwHeld === undefined || isBool(v.throwHeld)) && (v.sheathe === undefined || isBool(v.sheathe)) && (v.equip === undefined || isInventoryRef(v.equip)) && (v.drop === undefined || isInventoryRef(v.drop)) && (v.troop === undefined || isInt(v.troop));
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
    isSessionFormatOnMap(v.format, v.arena) &&
    (v.humans === undefined || isHumans(v.humans)) &&
    // A Delver Run is a Gauntlet on generated Floors (`true`, or absent).
    (v.delver === undefined || (v.delver === true && v.format === 'Gauntlet'))
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
        (v.chain === undefined || (isObject(v.chain) && isDirection(v.chain.direction) && isTick(v.chain.tick))) &&
        (v.whiffChain === undefined || isDirection(v.whiffChain)) &&
        (v.chamberedBy === undefined || isArrayOf(v.chamberedBy, isFighterIndex)) &&
        (v.charge === undefined || isTick(v.charge))
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
  return isObject(v) && isVec2(v.planted) && isNum(v.y) && (v.step === null || (isObject(v.step) && isTick(v.step.tick) && isTick(v.step.ticks) && isVec2(v.step.target) && isNum(v.step.y) && (v.step.run === undefined || v.step.run === true)));
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
    (v.knockedBy === undefined || isTick(v.knockedBy)) &&
    isNum(v.facing) &&
    isNum(v.pitch) &&
    isNum(v.crouch) &&
    isTeam(v.team) &&
    isNum(v.hp) &&
    isInt(v.daggers) &&
    v.daggers >= 0 &&
    isBool(v.sheathed) &&
    isString(v.weapon) &&
    (v.size === undefined || isSize(v.size)) &&
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
    (v.mods === undefined || isMods(v.mods)) &&
    (v.inventory === undefined || isInventory(v.inventory)) &&
    (v.benched === undefined || v.benched === true) &&
    (v.soldier === undefined || isSoldierBinding(v.soldier))
  );
}

const SOLDIER_ROLES: ReadonlySet<unknown> = new Set<SoldierRole>(['Attack', 'Ally', 'Waiting']);
/** A Fighter Pool slot's Soldier: its index in the Crowd (checked against the Crowd by `isBattle`), its Promotion Tick and its role. */
const isSoldierBinding = (v: unknown): boolean => isObject(v) && isInt(v.index) && v.index >= 0 && isTick(v.since) && SOLDIER_ROLES.has(v.role);

/** A Fighter's Mods: every key of the Relic vocabulary, a finite number (a factor or a count above zero where it must be, so max HP and damage stay real numbers). */
const isMods = (v: unknown): boolean => isObject(v) && Object.keys(v).length === MODS_KEYS.length && MODS_KEYS.every((key) => isNum(v[key]) && (key === 'maxHp' ? v[key] > -1 : v[key] >= 0));

/** An inventory: a Weapon or more and its wielded index, the Relics and the equipped ones' slots (ascending, distinct, each holding one). Whether the names exist is for Tuning Data to say. */
function isInventory(v: unknown): boolean {
  if (!isObject(v) || !isArrayOf(v.weapons, isString) || !isArrayOf(v.relics, isString) || !isInt(v.weapon) || !isArrayOf(v.equipped, isInt)) return false;
  const [weapons, relics, equipped] = [v.weapons as string[], v.relics as string[], v.equipped as number[]];
  return (
    weapons.length >= 1 &&
    weapons.length <= MAX_INVENTORY_SLOTS &&
    relics.length <= MAX_INVENTORY_SLOTS &&
    v.weapon >= 0 &&
    v.weapon < weapons.length &&
    equipped.every((s, k) => s >= 0 && s < relics.length && (k === 0 || s > equipped[k - 1]!))
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
    isPerSlot(v.fighters, isFighter) &&
    isArrayOf(v.daggers, isDagger) &&
    isDuelState(v.duel) &&
    isArrayOf(v.events, isEvent) &&
    (v.hall === undefined || isSimHall(v.hall)) &&
    (v.delver === undefined || isSimDelver(v.delver)) &&
    (v.crowd === undefined || isCrowd(v.crowd, (v.fighters as unknown[]).length))
  );
}

/** One part of a Soldier's Size (its height or its thickness): in range and on the step, as `isSize` judges it. */
const isSizePart = (x: unknown): boolean => isNum(x) && isSize({ height: x, thick: 1 });

/** A Crowd's per-Soldier arrays of plain numbers. */
const CROWD_NUMBERS = ['x', 'z', 'vx', 'vz', 'heading', 'hp'] as const;
const isBit = (v: unknown): boolean => v === 0 || v === 1;

/** A Battle's Player record: the Soldier it took over (or -1), its takeovers and kills, its corpse's Pool slot (or -1), the Troop it chose to come back as, and whether it left. */
const isBattlePlayer = (v: unknown, soldiers: number, slots: number): boolean =>
  isObject(v) &&
  isInt(v.soldier) &&
  v.soldier >= -1 &&
  v.soldier < soldiers &&
  isTick(v.taken) &&
  isTick(v.kills) &&
  isInt(v.corpse) &&
  v.corpse >= -1 &&
  v.corpse < slots &&
  (v.troop === undefined || (isInt(v.troop) && v.troop >= 0 && v.troop < MAX_TROOPS)) &&
  (v.away === undefined || v.away === true);

/** The most Walk Surfaces a Battle map may have: a Soldier's and an anchor's `surface` is one of them, or -1 on the open field (the session checks the map's own count). */
const MAX_WALK_SURFACES = 65_536;
const isSurface = (x: unknown): boolean => isInt(x) && x >= -1 && x < MAX_WALK_SURFACES;

/** The most places a Squad's Formation has (a Soldier's `place`). */
const MAX_PLACES = MAX_SQUAD_PLACES;

/**
 * A Battle's Squads (`SquadState`, docs/plans/battle-objectives.md): every per-Squad array as long as the others (at most `soldiers` of
 * them, Team 0's half then Team 1's), each entry what it may hold (a Formation is 0 to 2, a count up to `MAX_PLACES`). A Floor's Squads
 * (`floor`) are the Warbands': all Team 1, as few as none.
 */
function isSquads(v: unknown, soldiers: number, floor: boolean): boolean {
  if (!isObject(v) || !Array.isArray(v.team)) return false;
  const m = v.team.length;
  if (m > soldiers || (floor ? false : m < 2 || m % 2 !== 0)) return false;
  const sized = (a: unknown, item: (x: unknown) => boolean) => isArrayOf(a, item) && (a as unknown[]).length === m;
  return (
    v.team.every((t, q) => t === (floor || q >= m / 2 ? 1 : 0)) &&
    ['x', 'z', 'heading', 'aim', 'speed'].every((k) => sized(v[k], isNum)) &&
    sized(v.shape, (x) => isInt(x) && x >= 0 && x <= 2) &&
    sized(v.living, (x) => isInt(x) && x >= 0 && x <= MAX_PLACES) &&
    sized(v.fall, isBit) &&
    // An Order is ATTACK, DEFEND or RESPAWN (0 to 2) to one of the Objectives or Bases (none, -1, on a Floor); a respawn is due at a Tick, or -1.
    sized(v.order, (x) => isInt(x) && x >= 0 && x <= 2) &&
    sized(v.target, (x) => isInt(x) && x >= (floor ? -1 : 0) && x < MAX_OBJECTIVES + 2) &&
    sized(v.since, isInt) &&
    sized(v.respawnAt, (x) => isInt(x) && x >= -1) &&
    sized(v.surface, isSurface)
  );
}

/** A Battle's Objectives (`ObjectiveState`; a Floor has none): a progress from -1 to +1 and an Owner (-1 for none, or a Team) each, as many as the map holds (at most MAX_OBJECTIVES). */
function isObjectives(v: unknown, floor: boolean): boolean {
  if (!isObject(v) || !Array.isArray(v.progress)) return false;
  const k = v.progress.length;
  return (
    (floor ? k === 0 : k >= 1) &&
    k <= MAX_OBJECTIVES &&
    v.progress.every((x) => isNum(x) && x >= -1 && x <= 1) &&
    isArrayOf(v.owner, (x) => x === -1 || x === 0 || x === 1) &&
    (v.owner as unknown[]).length === k
  );
}

/**
 * A Battle's Crowd (`CrowdState`, docs/plans/big-battle.md): every per-Soldier array as long as the others, each entry what it may
 * hold, and every index in range: a target another Soldier, a slot one of the `slots` Fighter Pool slots, a Player's Soldier one
 * of the Crowd. The Crowd's own generator, its Rout, and up to MAX_PLAYERS Players' records. How many Soldiers is Tuning Data's to say.
 * A Floor's Crowd (it has `warbands`) instead has each Soldier's `maxHp`, its Warbands (`isWarbands`), no Objectives, no tickets, no Rout and no Player records.
 */
function isCrowd(v: unknown, slots: number): boolean {
  if (!isObject(v) || !Array.isArray(v.x)) return false;
  const n = v.x.length;
  if (n > MAX_SOLDIERS) return false;
  const floor = v.warbands !== undefined;
  if (floor !== (v.maxHp !== undefined)) return false;
  const sized = (a: unknown, item: (x: unknown) => boolean) => isArrayOf(a, item) && (a as unknown[]).length === n;
  const index = (lo: number, hi: number) => (x: unknown) => isInt(x) && x >= lo && x < hi;
  return (
    CROWD_NUMBERS.every((k) => sized(v[k], isNum)) &&
    sized(v.team, isTeam) &&
    sized(v.target, index(-1, n)) &&
    sized(v.engage, isTick) &&
    sized(v.alive, isBit) &&
    sized(v.slot, index(-1, slots)) &&
    sized(v.surface, isSurface) &&
    sized(v.sizeHeight, isSizePart) &&
    sized(v.sizeThick, isSizePart) &&
    sized(v.troop, index(0, floor ? MAX_FLOOR_TROOPS : MAX_TROOPS)) &&
    sized(v.look, index(0, MAX_LOOKS)) &&
    isSquads(v.squads, n, floor) &&
    isObjectives(v.objectives, floor) &&
    (!floor || (sized(v.maxHp, (x) => isNum(x) && x > 0) && isWarbands(v.warbands, v.squads as { team: unknown[] }))) &&
    isArrayOf(v.tickets, (x) => isNum(x) && x >= 0 && (!floor || x === 0)) &&
    (v.tickets as unknown[]).length === 2 &&
    sized(v.squad, index(-1, (v.squads as { team: unknown[] }).team.length)) &&
    sized(v.place, (x) => isInt(x) && x >= 0 && x < MAX_PLACES) &&
    isObject(v.rng) &&
    isInt(v.rng.seed) &&
    (floor ? v.rout === null : v.rout === null || (isObject(v.rout) && isTeam(v.rout.team) && isTick(v.rout.tick))) &&
    isArrayOf(v.players, (p) => isBattlePlayer(p, n, slots)) &&
    (v.players as unknown[]).length <= (floor ? 0 : MAX_PLAYERS)
  );
}

/** The most Troops a Floor's Crowd may index (`battle.troops`, then the Bosses' and the elites'; `warbandsFit` checks the exact count at a resync). */
export const MAX_FLOOR_TROOPS = 64;

/** The most points a Floor's patrol loop may be read to have (a Warband's `leg`; the Floor says how many it has). */
const MAX_LOOP_POINTS = 65_535;

/**
 * A Floor's Warbands (`WarbandState`, docs/plans/delver.md, Stage 3): one entry per Squad of the Crowd in each array. The mode is GUARD to RETURN (0 to 3),
 * a Warband is a guard (a post) or a patrol (a loop) and never both, its leg and its Fighter chased and last seen are in range, and its size
 * (the Soldiers it deployed with) is a Formation's, and its rank PLAIN, ELITE or BOSS (0 to 2). Which post, loop and template exist is the Floor's to say.
 */
function isWarbands(v: unknown, squads: { team: unknown[] }): boolean {
  if (!isObject(v)) return false;
  const m = squads.team.length;
  const sized = (a: unknown, item: (x: unknown) => boolean) => isArrayOf(a, item) && (a as unknown[]).length === m;
  const from = (lo: number, hi = Infinity) => (x: unknown) => isInt(x) && x >= lo && x <= hi;
  return (
    sized(v.mode, from(0, 3)) &&
    sized(v.post, from(-1)) &&
    sized(v.patrol, from(-1)) &&
    (v.post as number[]).every((p, q) => p >= 0 !== (v.patrol as number[])[q]! >= 0) &&
    sized(v.leg, from(0, MAX_LOOP_POINTS)) &&
    sized(v.chased, from(-1, 3)) &&
    sized(v.seen, from(-1)) &&
    sized(v.size, from(1, MAX_SQUAD_PLACES)) &&
    sized(v.encounter, from(0)) &&
    sized(v.rank, from(0, 2))
  );
}

const HALL_KINDS: ReadonlySet<unknown> = new Set(['Fight', 'Elite', 'Treasure', 'Rest', 'Boss']);
const HALL_PHASES: ReadonlySet<unknown> = new Set(['Fighting', 'Cleared', 'Leaving']);
/** A Hall of a Dungeon: a Floor from 1, a row 0 to FLOOR_ROWS − 1, an index 0 to 2. */
const isHallRef = (v: unknown): boolean => isObject(v) && isInt(v.floor) && v.floor >= 1 && isInt(v.row) && v.row >= 0 && v.row < FLOOR_ROWS && isInt(v.index) && v.index >= 0 && v.index < MAX_HALL_EXITS;
/** A Run's Duel's Hall: where it is, its kind and its phase. */
const isSimHall = (v: unknown): boolean => isHallRef(v) && HALL_KINDS.has((v as Obj).kind) && HALL_PHASES.has((v as Obj).phase);

/** The most pickups a Hall's list may hold (taken ones stay in it): a resync from a peer asking for more is refused. */
const MAX_PICKUPS = 256;

/** An item lying in a Hall: its place in the list (checked by the Run), a Weapon or Relic name, an owner Fighter or none (shared), where, and whether taken. */
function isPickup(v: unknown): boolean {
  return (
    isObject(v) &&
    isInt(v.id) &&
    v.id >= 0 &&
    (v.owner === null || (isInt(v.owner) && v.owner >= 0 && v.owner < MAX_TEAM_SIZE)) &&
    (v.kind === 'weapon' || v.kind === 'relic') &&
    isString(v.item) &&
    isVec3(v.at) &&
    typeof v.taken === 'boolean' &&
    (v.group === undefined || (isInt(v.group) && v.group >= 0)) &&
    (v.by === undefined || (isInt(v.by) && v.by >= 0 && v.by < MAX_TEAM_SIZE))
  );
}

/**
 * Whether pickup `p` fits the Run: an owned one belongs to a Player Fighter and may be a pedestal (its `group` the first of its
 * owner's, itself in that group); a shared one lies where a Player dropped it (`by` a Player Fighter) and is no pedestal.
 */
function isPickupOf(p: Obj, all: readonly Obj[], players: readonly number[]): boolean {
  if (p.owner === null) return p.group === undefined && (p.by === undefined || players.includes(p.by as number));
  if (!players.includes(p.owner as number) || p.by !== undefined) return false;
  const first = p.group === undefined ? undefined : all[p.group as number];
  return p.group === undefined || (first !== undefined && first.group === p.group && first.owner === p.owner && (p.group as number) <= (p.id as number));
}

/**
 * A Run's progress: the current Hall (on Floor 1 to `floors`), the Halls entered (the current one last), its phase, one
 * Door count per exit, the Player Fighters rested, the pickups lying in it, and the Tick it started on. `players` are the Run's
 * Player Fighters (`config.players`): the ones that rest, own pickups and drop. How many exits a Hall has is Tuning Data's to say,
 * but a Hall's row bounds the Door counts: a Boss may have none (the Run's end), any other Hall has at least one.
 */
function isRun(v: unknown, players: readonly number[]): boolean {
  if (!isObject(v) || !isInt(v.floors) || v.floors < 1 || !isArrayOf(v.path, isHallRef) || (v.path as unknown[]).length < 1) return false;
  const here = { floor: v.floor, row: v.row, index: v.hall };
  const last = (v.path as Obj[])[(v.path as unknown[]).length - 1]!;
  return (
    isHallRef(here) &&
    (v.floor as number) <= v.floors &&
    last.floor === here.floor &&
    last.row === here.row &&
    last.index === here.index &&
    HALL_PHASES.has(v.phase) &&
    isArrayOf(v.doorTicks, isTick) &&
    (v.doorTicks as unknown[]).length <= MAX_HALL_EXITS &&
    (here.row === FLOOR_ROWS - 1 || (v.doorTicks as unknown[]).length >= 1) &&
    (v.phase !== 'Fighting' || (v.doorTicks as number[]).every((t) => t === 0)) &&
    isArrayOf(v.rested, (i) => isInt(i) && players.includes(i)) &&
    isPickups(v.pickups, players) &&
    isTick(v.startTick) &&
    (v.away === undefined || (isAway(v.away) && (v.away as number[]).every((i) => players.includes(i))))
  );
}

/** The pickups lying in a Hall or on a Floor: a list of at most MAX_PICKUPS, each in its place and fitting the Run's Player Fighters. */
function isPickups(v: unknown, players: readonly number[]): boolean {
  return isArrayOf(v, isPickup) && (v as unknown[]).length <= MAX_PICKUPS && (v as Obj[]).every((p, k, all) => p.id === k && isPickupOf(p, all, players));
}

const DELVER_PHASES: ReadonlySet<unknown> = new Set(['Exploring', 'Descending']);
/** The most fires a Floor's list may hold: a resync from a peer asking for more is refused. */
const MAX_FIRES = 64;

/** A Delver Run's Floor and phase as a Duel carries them (`SimDelver`): a Floor from 1, a phase, and the Players away (absent while nobody has left). */
const isSimDelver = (v: unknown): boolean => isObject(v) && isInt(v.floor) && v.floor >= 1 && DELVER_PHASES.has(v.phase) && (v.away === undefined || isAway(v.away));

/**
 * A Delver Run's progress (`DelverRun`): a Floor from 1 to `floors`, its phase, the Ticks the party has stood at the Stairs, one record per fire
 * (whether its revive is spent, and which Players took its heal, ascending), the pickups lying on the Floor and the Tick it started on.
 * `players` are the Run's Player Fighters: the ones that heal, own pickups and drop.
 */
function isDelverRun(v: unknown, players: readonly number[]): boolean {
  return (
    isObject(v) &&
    isInt(v.floors) &&
    v.floors >= 1 &&
    isSimDelver({ floor: v.floor, phase: v.phase }) &&
    (v.floor as number) <= v.floors &&
    isTick(v.stairsTicks) &&
    isArrayOf(v.restUsed, (u) => isObject(u) && isBool(u.revived) && isPlayers(u.healed) && (u.healed as number[]).every((i) => players.includes(i))) &&
    (v.restUsed as unknown[]).length <= MAX_FIRES &&
    isPickups(v.pickups, players) &&
    isTick(v.startTick) &&
    (v.away === undefined || (isAway(v.away) && (v.away as number[]).every((i) => players.includes(i))))
  );
}

/** A Delver Run's Match and its Duel are on the Arena of the Floor the Run is on: `battle:delver<F>s<S>` for its Run seed (`config.arena`'s) and Floor. */
const isFloorOfRun = (v: Obj, config: Obj): boolean => {
  const floor = (v.delver as Obj).floor as number;
  return v.arena === floorArenaName(runSeed(config.arena as string), floor) && (v.duel as Obj).arena === v.arena;
};

/** A Delver Run's Duel names the Run's Floor and phase (and the Players away), and has no Hall. */
const isDelverFloor = (duel: Obj, run: Obj): boolean =>
  duel.hall === undefined && isObject(duel.delver) && duel.delver.floor === run.floor && duel.delver.phase === run.phase && JSON.stringify(duel.delver.away) === JSON.stringify(run.away);

/** A Run's `away`, the Player Fighters an AI Takeover has taken (each one of `players`, checked by `isRun`): at least one, distinct, ascending (absent while nobody has left). */
const isAway = (v: unknown): boolean => isArrayOf(v, (i) => isInt(i) && i >= 0) && (v as number[]).length > 0 && (v as number[]).every((p, k, all) => k === 0 || p > all[k - 1]!);

/** A Run's Player Fighters: distinct Fighter indices, ascending. */
const isPlayers = (v: unknown): boolean => isArrayOf(v, (i) => isInt(i) && i >= 0) && (v as number[]).every((p, k, all) => k === 0 || p > all[k - 1]!);

/** A Run's Duel names the Run's current Hall and phase. */
const isRunHall = (hall: unknown, run: Obj): boolean =>
  isObject(hall) && hall.floor === run.floor && hall.row === run.row && hall.index === run.hall && hall.phase === run.phase && JSON.stringify(hall.away) === JSON.stringify(run.away);

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
    (config.sizes === undefined || (isArrayOf(config.sizes, isSize) && (config.sizes as unknown[]).length === (config.teams as unknown[]).length)) &&
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
    isFormatFighters(config, v.duel as Obj & { fighters: Obj[] }) &&
    (v.nextDuelTick === null || isTick(v.nextDuelTick)) &&
    (status.status === 'InProgress' || (status.status === 'Over' && isWinner(status.winner) && isTick(status.tick))) &&
    isArrayOf(v.events, isEvent) &&
    isSessionFormatOnMap(config.format, config.arena) &&
    // (A Delver Run's Arena is its Floor's, not a Random Map's: its branch below judges it.)
    (config.delver === true || isSessionFormatOnMap(config.format, v.arena)) &&
    (config.humans === undefined || isHumans(config.humans)) &&
    (config.players === undefined || (isPlayers(config.players) && (config.players as number[]).every((p) => (config.teams as number[])[p] === 0))) &&
    // A Run, and only a Run, carries its progress, and each of its Duels names its Hall.
    (v.duel as Obj & { fighters: Obj[] }).fighters.every((f, i) => f.inventory === undefined || (config.format === 'Gauntlet' && runPlayers(config as unknown as MatchConfig).includes(i))) &&
    // ...a Delver Run instead has `run` null, and its Duel names the Floor (`delver`) where a Run's names its Hall.
    (config.delver === undefined || (config.delver === true && config.format === 'Gauntlet')) &&
    (config.format === 'Gauntlet'
      ? config.delver
        ? v.run === null && isDelverRun(v.delver, runPlayers(config as unknown as MatchConfig)) && isDelverFloor(v.duel as Obj, v.delver as Obj) && config.rematchTicks === null && isFloorOfRun(v, config)
        : isRun(v.run, runPlayers(config as unknown as MatchConfig)) && isRunHall((v.duel as Obj).hall, v.run as Obj) && config.rematchTicks === null && v.delver === undefined && (v.duel as Obj).delver === undefined
      : (v.run === undefined || v.run === null) && (v.duel as Obj).hall === undefined && v.delver === undefined && (v.duel as Obj).delver === undefined) &&
    // A Battle has a Crowd, a Delver Run a Floor's (with Warbands), and no other Match has one.
    (config.format === 'Battle' ? isBattle(config, v.duel as Obj & { fighters: Obj[] }) : config.delver ? isFloorCrowd(config, v.duel as Obj & { fighters: Obj[] }) : (v.duel as Obj).crowd === undefined)
  );
}

/**
 * The Duel's Fighters for the Format: one per Lineup slot (2 to MAX_FIGHTERS), or in a Battle its whole Fighter Pool, the Players' Fighters
 * (`config.teams`) first. How big the Pool is, is Tuning Data's to say. A Delver Run's Fighters are its party (1 to MAX_TEAM_SIZE, all Team 0)
 * and then Pool slots, as a Battle's.
 */
function isFormatFighters(config: Obj, duel: Obj & { fighters: Obj[] }): boolean {
  const teams = (config.teams as unknown[]).length;
  if (config.format === 'Battle') return duel.fighters.length >= teams;
  if (config.delver) return duel.fighters.length > teams && duel.fighters.length <= MAX_POOL && teams <= MAX_TEAM_SIZE && (config.teams as number[]).every((t) => t === 0);
  return duel.fighters.length === teams && teams >= 2;
}

/**
 * A Battle's Duel: its Crowd has a record per Player (`config.teams`), and the Pool and the Crowd agree on who is bound where. A slot past the
 * Players' bound to a Soldier is that Soldier's slot, and a Soldier's slot is bound to it, or is the slot of a Player who took it over. A Player's
 * own Fighter is never bound. No Rematch, and no Run.
 */
function isBattle(config: Obj, duel: Obj & { fighters: Obj[] }): boolean {
  const crowd = duel.crowd as (Obj & { slot: number[]; x: unknown[]; players: Obj[] }) | undefined;
  const players = (config.teams as unknown[]).length;
  if (!crowd || crowd.warbands !== undefined || config.rematchTicks !== null || crowd.players.length !== players) return false;
  return isPoolBound(crowd, duel, players);
}

/**
 * A Delver Run's Duel: its Crowd is a Floor's (`warbands`, no Player records), and the Pool and the Crowd agree on who is bound where, as a Battle's
 * do with the party in the Players' place: no party Fighter is bound, and a Soldier's slot is bound to it and back.
 */
function isFloorCrowd(config: Obj, duel: Obj & { fighters: Obj[] }): boolean {
  const crowd = duel.crowd as (Obj & { slot: number[]; x: unknown[]; players: Obj[] }) | undefined;
  return !!crowd && crowd.warbands !== undefined && crowd.players.length === 0 && isPoolBound(crowd, duel, (config.teams as unknown[]).length);
}

/** The Pool and the Crowd agree: a slot from `players` on bound to a Soldier is that Soldier's slot, and a Soldier's slot is bound to it (or, in a Battle, is a Player's, who took it over). A Player's Fighter is never bound. */
function isPoolBound(crowd: Obj & { slot: number[]; x: unknown[]; players: Obj[] }, duel: { fighters: Obj[] }, players: number): boolean {
  const soldiers = crowd.x.length;
  const boundRight = duel.fighters.every((f, k) => {
    const b = f.soldier as { index: number } | undefined;
    return b === undefined || (k >= players && b.index < soldiers && crowd.slot[b.index] === k);
  });
  const slotRight = crowd.slot.every((k, s) => k < 0 || (k < players ? crowd.players[k]?.soldier === s : (duel.fighters[k]!.soldier as { index: number } | undefined)?.index === s));
  return boundRight && slotRight;
}

/** How a Fighter fell: the Tick, and the felling blow if known. */
function isDeath(v: unknown): boolean {
  if (!isObject(v) || !isTick(v.tick) || (v.cause !== 'Hit' && v.cause !== 'Fall' && v.cause !== 'Lava' && v.cause !== 'Water')) return false;
  const b = v.blow;
  return b === null || (isObject(b) && isVec3(b.point) && isNum(b.bladeSpeed) && isDirection(b.direction) && isVec2(b.from) && (b.cut === undefined || (b.direction !== 'Thrust' && isCut(b.cut))));
}

/** A Death's cut: the blade at contact (hilt and tip apart) and the unit direction it was moving. A Thrust never has one. */
function isCut(v: unknown): boolean {
  if (!isObject(v) || !isVec3(v.hilt) || !isVec3(v.tip) || !isVec3(v.travel)) return false;
  const [h, t, d] = [v.hilt, v.tip, v.travel] as [Vec3, Vec3, Vec3];
  return Math.hypot(t.x - h.x, t.y - h.y, t.z - h.z) > 0 && Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-6;
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
    (v.attackStart === null || isTick(v.attackStart)) &&
    isNum(v.rise) &&
    isNum(v.facing) &&
    (v.airStart === null || isTick(v.airStart)) &&
    isBool(v.sheathed) &&
    (v.size === undefined || isSize(v.size))
  );
}

/** One of `list` (a const array exported by the AI, so the validator never keeps its own copy). */
const isOneOf = (list: readonly string[], v: unknown): boolean => list.includes(v as string);

/** An AI Controller's memory (its `save()`): what it saw of every Fighter on its last Ticks, and its plans. */
export function isAiMemory(v: unknown): boolean {
  if (!isObject(v) || !isInt(v.lastTick) || !isNum(v.lastHp)) return false;
  const seen = isArrayOf(v.seen, (o) => isObject(o) && isTick(o.tick) && isPerSlot(o.fighters, isSighting));
  const d = v.defencePlan;
  const holdBreak = (h: unknown) => isObject(h) && isBool(h.go) && isTick(h.at);
  const defence =
    d === null ||
    (isObject(d) &&
      isTick(d.attacker) &&
      isTick(d.attackStart) &&
      isOneOf(DEFENCE_KINDS, d.kind) &&
      isDirection(d.direction) &&
      isInt(d.pressAt) &&
      (d.reads === undefined || isBool(d.reads)) &&
      (d.holdBreak === undefined || holdBreak(d.holdBreak)) &&
      (d.raiseAt === undefined || isInt(d.raiseAt)) &&
      (d.spinRead === undefined || isBool(d.spinRead)));
  const feint = v.feintPlan === null || (isObject(v.feintPlan) && isDirection(v.feintPlan.from) && isDirection(v.feintPlan.into) && isInt(v.feintPlan.at));
  const a = v.attackPlan;
  const attack =
    a === null ||
    (isObject(a) && isDirection(a.direction) && isInt(a.holdUntil) && isBool(a.reFeintRolled) && isBool(a.chainRolled) && (a.chain === null || isDirection(a.chain)) && isBool(a.chainHeld) && isInt(a.holdJumpUntil) && isBool(a.whiff) && isBool(a.team) && (a.double === undefined || isBool(a.double)) && (a.spin === undefined ? a.spinUntil === undefined : isInt(a.spin) && a.spin > 0 && isInt(a.spinUntil)));
  const t = v.throwPlan;
  const throwPlan = t === null || (isObject(t) && isTick(t.thrower) && isTick(t.startTick) && isBool(t.react));
  const r = v.jumpRun;
  const jumpRun = r === null || (isObject(r) && isTick(r.link) && isOneOf(JUMP_STAGES, r.stage) && isInt(r.deadline) && isInt(r.flew) && isBool(r.escape));
  const failedJumps = isArrayOf(v.failedJumps, (f) => isObject(f) && isTick(f.link) && isTick(f.at));
  const l = v.landing;
  const landing = l === null || (isObject(l) && isTick(l.fighter) && isTick(l.airStart) && isBool(l.go));
  const route =
    v.route === null ||
    (isObject(v.route) && isInt(v.route.from) && isInt(v.route.to) && isTick(v.route.at) && (v.route.links === null || isArrayOf(v.route.links, isTick)));
  const tactic = isObject(v.tactic) && isOneOf(AI_MODES, v.tactic.mode) && isInt(v.tactic.until);
  const st = v.strafe;
  const strafe = isObject(st) && (st.sign === 1 || st.sign === -1) && isInt(st.until) && isBool(st.flank) && isNum(st.spacing) && isBool(st.still) && isInt(st.pause) && isBool(st.hop);
  const o = v.opening;
  const opening = o === null || (isObject(o) && isTick(o.fighter) && isInt(o.seen) && isBool(o.go) && isBool(o.fits));
  const focus = v.focus === null || (isObject(v.focus) && isTick(v.focus.fighter) && isInt(v.focus.until) && isBool(v.focus.spread));
  const turn = (v.turn === null || isBool(v.turn)) && isInt(v.lineHold);
  const b = v.beat;
  const beat = b === null || (isObject(b) && isBool(b.timed) && isNum(b.need) && isNum(b.done) && isBool(b.double) && isBool(b.wild));
  const j = v.jitter;
  const jitter = j === null || (isObject(j) && isTick(j.from) && isInt(j.until) && isInt(j.at));
  return seen && defence && feint && attack && throwPlan && isNum(v.aimError) && jumpRun && failedJumps && landing && route && tactic && strafe && opening && focus && turn && beat && jitter && isInt(v.shaken);
}

/**
 * A Hall AI's memory (a Run's Team 1 slot, `src/controllers/hallAi.ts`): the Hall it last saw (`floor:row:index`, ''
 * for none yet) and that Hall's AI's memory (null in a Hall with no enemy for its slot).
 */
export function isHallAiMemory(v: unknown): boolean {
  return isObject(v) && isString(v.hall) && (v.hall === '' || /^[1-9]\d*:[0-4]:[0-2]$/.test(v.hall)) && (v.memory === null || isAiMemory(v.memory));
}
/**
 * A Pool AI's memory (a Battle's Fighter Pool slot, `src/controllers/poolAi.ts`) while its slot is bound: the binding its AI plays for and
 * that AI's memory, and the AI difficulty and Style it plays (its Troop's; the Style is '' for the Battle's own). Null while its slot is unbound.
 */
export function isPoolAiMemory(v: unknown): boolean {
  return isObject(v) && Object.keys(v).length === 4 && isSoldierBinding(v.bound) && typeof v.difficulty === 'string' && v.difficulty.length > 0 && v.difficulty.length <= 32 && typeof v.style === 'string' && v.style.length <= 32 && isAiMemory(v.memory);
}
const isAiMemoryOrNull = isNullable((v) => isAiMemory(v) || isHallAiMemory(v) || isPoolAiMemory(v));
