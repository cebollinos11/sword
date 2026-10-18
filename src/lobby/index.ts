/**
 * The Lobby: Seats, Members and Match settings before and between Matches, and
 * its sync over the Room link. Import from `../lobby`, not from the internal files.
 */
export {
  BEST_OF,
  canSetSeat,
  endMatch,
  humanSeats,
  lobbyLineup,
  MAX_PLAYERS,
  member,
  moveMember,
  newLobby,
  seatAt,
  seatOf,
  setSeat,
  startMatch,
  startProblem,
  SUPPORTED_PLAYERS,
  TEAM_COUNT,
  teamSize,
  updateSettings,
  type LobbyLineup,
  type LobbySettings,
  type LobbyState,
  type Member,
  type NewLobbyOptions,
  type Seat,
  type SeatKind,
  type SeatRef,
} from './lobby';
export { cleanName, GuestLobby, HEARTBEAT_MS, HostLobby, LOBBY_TIMEOUT_MS, MAX_NAME, type Lobby, type LobbyStatus, type MemberPatch } from './sync';
export { parseLobbyMessage, type LobbyMessage, type RefuseLobbyReason } from './messages';
