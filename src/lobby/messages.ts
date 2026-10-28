/**
 * The Lobby's messages on the Room channel. Shape checks only (what came over
 * the wire); whether the Weapons, Arenas, difficulties and Styles exist is for Tuning
 * Data to say, and the Lobby functions keep the Seats consistent.
 */
import { MAX_TEAM_SIZE } from '../sim';
import { RUN_KNOB_KEYS } from '../tuning';
import { isFormatOnMap } from '../net';
import { MAX_PLAYERS, TEAM_COUNT, type LobbyState, type SeatRef } from './lobby';

export type RefuseLobbyReason = 'RoomFull' | 'TuningDataMismatch' | 'ProtocolMismatch';

export type LobbyMessage =
  /** Guest → host, repeated until the first `lobby` arrives. */
  | { readonly type: 'join'; readonly protocol: number; readonly tuningHash: string; readonly name: string; readonly weapon: string; readonly body: string }
  /** Host → guest: the whole Lobby, the guest's Member id, and the last of its sequence numbers applied. */
  | { readonly type: 'lobby'; readonly state: LobbyState; readonly you: number; readonly ack: number }
  /** Host → guest: turned away. The link closes soon after. */
  | { readonly type: 'refuse'; readonly reason: RefuseLobbyReason }
  /** Guest → host: its wishes, in full; `seat` asks to move there (once per `seq`). */
  | {
      readonly type: 'member';
      readonly seq: number;
      readonly name: string;
      readonly weapon: string;
      readonly body: string;
      readonly ready: boolean;
      readonly seat: SeatRef | null;
    };

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const isCount = (v: unknown): v is number => isInt(v) && v >= 0;
const isShortString = (v: unknown): v is string => isString(v) && v.length <= 64;
const REASONS: ReadonlySet<unknown> = new Set<RefuseLobbyReason>(['RoomFull', 'TuningDataMismatch', 'ProtocolMismatch']);

function isSeatRef(v: unknown): v is SeatRef {
  return isObject(v) && isCount(v.team) && v.team < TEAM_COUNT && isCount(v.index) && v.index < MAX_TEAM_SIZE;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const RUN_KNOBS: ReadonlySet<string> = new Set(RUN_KNOB_KEYS);

/** A Run's knobs: numbers, each optional; `applyDungeonKnobs` holds each to its range. */
function isRunKnobs(v: unknown): boolean {
  return isObject(v) && Object.entries(v).every(([k, x]) => RUN_KNOBS.has(k) && isNum(x));
}

function isSeat(v: unknown): boolean {
  if (!isObject(v)) return false;
  switch (v.kind) {
    case 'Open':
    case 'Closed':
      return true;
    case 'Player':
      return isCount(v.member);
    case 'AI':
      return isShortString(v.difficulty) && isShortString(v.weapon) && (v.style === undefined || isShortString(v.style));
    default:
      return false;
  }
}

function isMember(v: unknown): boolean {
  return isObject(v) && isCount(v.id) && isShortString(v.name) && isShortString(v.weapon) && isShortString(v.body) && typeof v.ready === 'boolean';
}

function isLobbyState(v: unknown): v is LobbyState {
  if (!isObject(v) || !isObject(v.settings)) return false;
  const { settings, members, teams, inMatch } = v;
  return (
    isShortString(settings.arena) &&
    isInt(settings.bestOf) &&
    settings.bestOf > 0 &&
    // A Format this build knows (absent: Duels), and a Gauntlet only on a Random Map.
    isFormatOnMap(settings.format, settings.arena) &&
    (settings.run === undefined || isRunKnobs(settings.run)) &&
    Array.isArray(members) &&
    members.length >= 1 &&
    members.length <= MAX_PLAYERS &&
    members.every(isMember) &&
    Array.isArray(teams) &&
    teams.length === TEAM_COUNT &&
    teams.every((row) => Array.isArray(row) && row.length === MAX_TEAM_SIZE && row.every(isSeat)) &&
    isCount(v.generation) &&
    typeof v.playing === 'boolean' &&
    Array.isArray(inMatch) &&
    inMatch.every(isCount) &&
    (v.matchArena === null || (isShortString(v.matchArena) && isFormatOnMap(settings.format, v.matchArena)))
  );
}

/** The message typed, or null when any field has the wrong shape (a broken or hostile peer is ignored). */
export function parseLobbyMessage(m: unknown): LobbyMessage | null {
  if (!isObject(m)) return null;
  switch (m.type) {
    case 'join':
      return isInt(m.protocol) && isShortString(m.tuningHash) && isShortString(m.name) && isShortString(m.weapon) && isShortString(m.body) ? (m as unknown as LobbyMessage) : null;
    case 'lobby':
      return isLobbyState(m.state) && isCount(m.you) && isInt(m.ack) ? (m as unknown as LobbyMessage) : null;
    case 'refuse':
      return REASONS.has(m.reason) ? (m as unknown as LobbyMessage) : null;
    case 'member':
      return isInt(m.seq) && isShortString(m.name) && isShortString(m.weapon) && isShortString(m.body) && typeof m.ready === 'boolean' && (m.seat === null || isSeatRef(m.seat))
        ? (m as unknown as LobbyMessage)
        : null;
    default:
      return null;
  }
}
