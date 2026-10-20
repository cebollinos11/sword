/**
 * The Lobby: who is in a Room (or a Skirmish), where each of them sits, and
 * the Match settings, before and between Matches. Plain data and pure
 * functions, so the host can send it to every guest as is.
 *
 * Two teams of MAX_TEAM_SIZE Seats each. A Seat is Open (a human may take it),
 * Closed, an AI (difficulty and Weapon), or a Player (a Member). Members are
 * the humans: the host is always first. A Room holds up to MAX_PLAYERS of
 * them, so no more Seats than that may be Open or taken by Players.
 *
 * Starting a Match bumps `generation` and records who plays it (`inMatch`); a
 * restart from the in-game menu is just another start. Each Match's Arena is
 * the Map setting for the first and, for a Random Map, the next seed after
 * that (`nextMatchArena`). The Lineup of a Match
 * reads the Seats team by team: Player numbers follow the Members' order.
 */
import { MAX_TEAM_SIZE, nextArenaName } from '../sim';
import { MAX_PLAYERS, type Lineup, type LineupSlot, type PlayerNumber } from '../controllers';

/** The most humans a Room holds (and a Match fields). */
export { MAX_PLAYERS };
export const TEAM_COUNT = 2;
export const BEST_OF = [1, 3, 5] as const;

export interface Member {
  /** Stable for as long as the Member stays: the host is 0, guests count up from 1. */
  readonly id: number;
  readonly name: string;
  /** Their Weapon (a Tuning Data Weapon name). */
  readonly weapon: string;
  /** The Body they are drawn as (render-only; a name the renderer does not know is drawn as a random one). */
  readonly body: string;
  /** Ready to start (guests; the host starts when everyone is). */
  readonly ready: boolean;
}

export type Seat =
  | { readonly kind: 'Open' }
  | { readonly kind: 'Closed' }
  | { readonly kind: 'Player'; readonly member: number }
  | { readonly kind: 'AI'; readonly difficulty: string; readonly weapon: string };

export type SeatKind = Seat['kind'];

export interface LobbySettings {
  /** The Arena (a Tuning Data Arena name, or a Random Map's `gen:<kit>:<seed>`: the seed of the first Match). */
  readonly arena: string;
  readonly bestOf: number;
}

export interface LobbyState {
  readonly settings: LobbySettings;
  /** Every human in the Lobby; the host first. */
  readonly members: readonly Member[];
  /** TEAM_COUNT teams of MAX_TEAM_SIZE Seats. */
  readonly teams: readonly (readonly Seat[])[];
  /** How many Matches were started; the current or last one's generation. */
  readonly generation: number;
  /** A Match is being played (the one numbered `generation`). */
  readonly playing: boolean;
  /** The Members playing it (a guest who joins meanwhile waits for the next). */
  readonly inMatch: readonly number[];
  /** The Arena Match `generation` started on, or null when none has since the Map was last set. */
  readonly matchArena: string | null;
}

export interface SeatRef {
  readonly team: number;
  readonly index: number;
}

/** What a started Match needs from the Lobby. Index p of `weapons`/`names`/`bodies`/`members` is Player p. */
export interface LobbyLineup {
  readonly lineup: Lineup;
  readonly weapons: readonly string[];
  readonly names: readonly string[];
  readonly bodies: readonly string[];
  readonly members: readonly number[];
}

export interface NewLobbyOptions {
  readonly host: { readonly name: string; readonly weapon: string; readonly body: string };
  readonly settings: LobbySettings;
  /** Online: Open Seats for three guests (one beside the host, two opposite); offline this AI opposite. */
  readonly online: boolean;
  readonly ai: { readonly difficulty: string; readonly weapon: string };
}

const OPEN: Seat = { kind: 'Open' };
const CLOSED: Seat = { kind: 'Closed' };

/** A fresh Lobby: the host on team 0; online, Open Seats for three guests (Open Seats field nobody), offline an AI on team 1. */
export function newLobby(o: NewLobbyOptions): LobbyState {
  const row = (...first: Seat[]) => [...first, ...Array.from({ length: MAX_TEAM_SIZE - first.length }, () => CLOSED)];
  const host: Seat = { kind: 'Player', member: 0 };
  return {
    settings: o.settings,
    members: [{ id: 0, name: o.host.name, weapon: o.host.weapon, body: o.host.body, ready: true }],
    teams: o.online ? [row(host, OPEN), row(OPEN, OPEN)] : [row(host), row({ kind: 'AI', ...o.ai })],
    generation: 0,
    playing: false,
    inMatch: [],
    matchArena: null,
  };
}

export function seatAt(state: LobbyState, at: SeatRef): Seat | undefined {
  return state.teams[at.team]?.[at.index];
}

/** Where a Member sits, or null. */
export function seatOf(state: LobbyState, member: number): SeatRef | null {
  for (let team = 0; team < state.teams.length; team++) {
    const index = state.teams[team]!.findIndex((s) => s.kind === 'Player' && s.member === member);
    if (index >= 0) return { team, index };
  }
  return null;
}

export function member(state: LobbyState, id: number): Member | undefined {
  return state.members.find((m) => m.id === id);
}

/** Seats a human could take or holds: Open and Player Seats. */
export function humanSeats(state: LobbyState): number {
  return state.teams.flat().filter((s) => s.kind === 'Open' || s.kind === 'Player').length;
}

/** Fighters a team would field: its Players and AIs. */
export function teamSize(state: LobbyState, team: number): number {
  return (state.teams[team] ?? []).filter((s) => s.kind === 'Player' || s.kind === 'AI').length;
}

/** May this Seat be set to `kind` (by the host)? Player Seats are the Members' own; Open Seats stay within MAX_PLAYERS. */
export function canSetSeat(state: LobbyState, at: SeatRef, kind: Exclude<SeatKind, 'Player'>): boolean {
  const seat = seatAt(state, at);
  if (!seat || seat.kind === 'Player') return false;
  if (kind === 'Open' && seat.kind !== 'Open') return humanSeats(state) < MAX_PLAYERS;
  return true;
}

function withSeat(state: LobbyState, at: SeatRef, seat: Seat): LobbyState {
  return { ...state, teams: state.teams.map((row, t) => (t === at.team ? row.map((s, i) => (i === at.index ? seat : s)) : row)) };
}

/** Set a Seat to Open, Closed or an AI (host only). Unchanged if not allowed. */
export function setSeat(state: LobbyState, at: SeatRef, seat: Exclude<Seat, { kind: 'Player' }>): LobbyState {
  return canSetSeat(state, at, seat.kind) ? withSeat(state, at, seat) : state;
}

/**
 * Move a Member to another Seat by swapping: whatever sat there (Open, Closed or an AI) takes the
 * Member's old Seat. Another Player's Seat cannot be taken. Unchanged if not allowed.
 */
export function moveMember(state: LobbyState, id: number, to: SeatRef): LobbyState {
  const from = seatOf(state, id);
  const target = seatAt(state, to);
  if (!from || !target || target.kind === 'Player') return state;
  return withSeat(withSeat(state, to, { kind: 'Player', member: id }), from, target);
}

/** A guest joins into an Open Seat of the team fielding fewer Fighters (the later team on a tie, so opposite the host); null when none is Open (the Room is full). */
export function join(state: LobbyState, m: Member): LobbyState | null {
  if (state.members.length >= MAX_PLAYERS || member(state, m.id)) return null;
  let best: SeatRef | null = null;
  for (let team = state.teams.length - 1; team >= 0; team--) {
    const index = state.teams[team]!.findIndex((s) => s.kind === 'Open');
    if (index >= 0 && (!best || teamSize(state, team) < teamSize(state, best.team))) best = { team, index };
  }
  return best && withSeat({ ...state, members: [...state.members, m] }, best, { kind: 'Player', member: m.id });
}

/** A guest leaves: their Seat opens again. */
export function leave(state: LobbyState, id: number): LobbyState {
  if (id === 0 || !member(state, id)) return state;
  const at = seatOf(state, id);
  const left: LobbyState = { ...state, members: state.members.filter((m) => m.id !== id), inMatch: state.inMatch.filter((m) => m !== id) };
  return at ? withSeat(left, at, OPEN) : left;
}

export function updateMember(state: LobbyState, id: number, patch: Partial<Omit<Member, 'id'>>): LobbyState {
  const old = member(state, id);
  if (!old) return state;
  const fresh = { ...old, ...patch };
  if (fresh.name === old.name && fresh.weapon === old.weapon && fresh.body === old.body && fresh.ready === old.ready) return state;
  return { ...state, members: state.members.map((m) => (m.id === id ? fresh : m)) };
}

/** Setting the Map (even to the one it was: a seed typed in again) starts the run of Arenas over: the next Match is on it. */
export function updateSettings(state: LobbyState, patch: Partial<LobbySettings>): LobbyState {
  return { ...state, settings: { ...state.settings, ...patch }, ...(patch.arena !== undefined ? { matchArena: null } : {}) };
}

/**
 * The Arena the next Match is played on: the Map setting, or after a Match on it, the one after the Arena last
 * played (`played`, when a Rematch online moved on from the one the Match started on): a Random Map's next seed.
 */
export function nextMatchArena(state: LobbyState, played?: string): string {
  return state.matchArena === null ? state.settings.arena : nextArenaName(played ?? state.matchArena);
}

/** Who fights, read off the Seats team by team (Open and Closed Seats field nobody). */
export function lobbyLineup(state: LobbyState): LobbyLineup {
  const seated = state.members.filter((m) => seatOf(state, m.id));
  const playerOf = (id: number) => seated.findIndex((m) => m.id === id) as PlayerNumber;
  const lineup: LineupSlot[] = [];
  state.teams.forEach((row, team) => {
    for (const s of row) {
      if (s.kind === 'Player') lineup.push({ team, pilot: { kind: 'Player', player: playerOf(s.member) } });
      else if (s.kind === 'AI') lineup.push({ team, pilot: { kind: 'AI', difficulty: s.difficulty }, weapon: s.weapon });
    }
  });
  return { lineup, weapons: seated.map((m) => m.weapon), names: seated.map((m) => m.name), bodies: seated.map((m) => m.body), members: seated.map((m) => m.id) };
}

/** Why a Match cannot start now, or null. `requireReady`: every guest must be ready (a start from the Lobby, not a restart). */
export function startProblem(state: LobbyState, requireReady: boolean): string | null {
  for (let team = 0; team < state.teams.length; team++) {
    if (teamSize(state, team) === 0) return `Team ${team + 1} needs at least one Fighter.`;
  }
  if (requireReady) {
    const waiting = state.members.find((m) => m.id !== 0 && !m.ready);
    if (waiting) return `Waiting for ${waiting.name} to be ready.`;
  }
  return null;
}

/**
 * Start (or restart) a Match: a new generation, played by every seated Member on the next Arena (`nextMatchArena`,
 * `played` as there); everyone's ready flag resets.
 */
export function startMatch(state: LobbyState, played?: string): LobbyState {
  return {
    ...state,
    matchArena: nextMatchArena(state, played),
    generation: state.generation + 1,
    playing: true,
    inMatch: lobbyLineup(state).members,
    members: state.members.map((m) => ({ ...m, ready: m.id === 0 })),
  };
}

/** Back to the Lobby: the Match ends for everyone. */
export function endMatch(state: LobbyState): LobbyState {
  return { ...state, playing: false, inMatch: [] };
}
