/**
 * The Lobby kept in sync over the Room link.
 *
 * The host owns the Lobby: it applies every change (its own, and what guests
 * ask for) and sends each guest the whole state, on every change and every
 * HEARTBEAT_MS besides. Guests only ever send their own wishes (name, Weapon,
 * Body, ready, a Seat to move to), again in full and repeatedly, tagged with a
 * sequence number the host acknowledges. The Room link may lose or reorder
 * messages (it is tuned for Intents), and this way nothing needs to arrive
 * twice: the next copy covers a lost one.
 *
 * A Skirmish uses the same host Lobby offline, with no guests.
 */
import type { TuningData } from '../tuning';
import { RANDOM_PICK, tuningDataHash } from '../tuning';
import { isArenaName } from '../sim';
import { PROTOCOL_VERSION, splitTransport, type Channels, type Transport } from '../net';
import {
  endMatch,
  join,
  leave,
  moveMember,
  newLobby,
  startMatch,
  startProblem,
  updateMember,
  type LobbyState,
  type Member,
  type NewLobbyOptions,
  type SeatRef,
} from './lobby';
import { parseLobbyMessage, type LobbyMessage, type RefuseLobbyReason } from './messages';

/** The host sends the state at least this often; a guest its wishes at twice this. Also the join retry. */
export const HEARTBEAT_MS = 500;
/** Nothing heard for this long: the peer is gone. */
export const LOBBY_TIMEOUT_MS = 10_000;
/** The longest name a Member may have. */
export const MAX_NAME = 16;

export type LobbyStatus = 'Joining' | 'Open' | 'Closed';

/** What a player may change about themselves. */
export type MemberPatch = Partial<Pick<Member, 'name' | 'weapon' | 'body' | 'ready'>>;

export interface Lobby {
  readonly online: boolean;
  readonly isHost: boolean;
  /** This player's Member id (null while joining). */
  readonly me: number | null;
  /** null while joining. */
  readonly state: LobbyState | null;
  readonly status: LobbyStatus;
  /** Why the Lobby closed (refused, the host left, timed out), for the player. */
  readonly failure: string | null;
  /** Host: change the settings or the Seats (ignored for guests). */
  edit(change: (state: LobbyState) => LobbyState): void;
  setMine(patch: MemberPatch): void;
  moveMe(to: SeatRef): void;
  /**
   * Host: start (or restart) a Match. `played`: the Arena the Match being replaced is on now (a Rematch may have moved
   * it on from the one it started on), so a Random Map's next Match follows on from it. Returns why not, or null.
   */
  start(requireReady: boolean, played?: string): string | null;
  /** Host: end the Match for everyone. */
  backToLobby(): void;
  /**
   * The Transport for Match `generation` with Member `member`: on the host, a guest's (null if they are
   * gone); on a guest, the host's (member 0; the guests only ever talk through the host). Null offline.
   */
  matchTransport(generation: number, member: number): Transport | null;
  /** Called after every change of `state`, `status` or `me`. Returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  /** Heartbeats, retries and timeouts: call every so often (e.g. 100–250 ms) with the wall clock in ms. */
  pump(now: number): void;
  /** Leave (guest) or close the Room (host). */
  close(): void;
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) || 'Player';
}

function refuseText(reason: RefuseLobbyReason): string {
  switch (reason) {
    case 'RoomFull':
      return 'That Room is full.';
    case 'TuningDataMismatch':
      return "Your game data differs from the host's. Every player needs the same game version (reload).";
    case 'ProtocolMismatch':
      return "Your game version differs from the host's. Every player needs to reload the latest version.";
  }
}

abstract class Base {
  protected readonly listeners = new Set<() => void>();
  state: LobbyState | null = null;
  status: LobbyStatus = 'Open';
  failure: string | null = null;
  protected now = 0;

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

interface GuestLink {
  readonly channels: Channels;
  /** Their Member id once joined. */
  id: number | null;
  heard: number;
  /** The last of their sequence numbers applied. */
  seq: number;
  /** Refused: close the link at this time (after a few copies of the refusal). */
  closeAt: number | null;
}

/** The host's Lobby (also a Skirmish's, offline). */
export class HostLobby extends Base implements Lobby {
  readonly isHost = true;
  readonly me = 0;
  declare state: LobbyState;
  private readonly links = new Set<GuestLink>();
  private nextId = 1;
  private sentAt = 0;
  private readonly tuningHash: string;

  constructor(
    private readonly tuning: TuningData,
    options: NewLobbyOptions,
  ) {
    super();
    this.state = newLobby(options);
    this.tuningHash = options.online ? tuningDataHash(tuning) : '';
    this.online = options.online;
  }

  readonly online: boolean;

  /** A guest connected to the Room: it joins once its `join` arrives. */
  addGuest(transport: Transport): void {
    const link: GuestLink = { channels: splitTransport(transport), id: null, heard: this.now, seq: -1, closeAt: null };
    this.links.add(link);
    link.channels.room.onMessage((raw) => this.receive(link, parseLobbyMessage(raw)));
    link.channels.room.onClose(() => this.drop(link));
  }

  edit(change: (state: LobbyState) => LobbyState): void {
    this.set(change(this.state));
  }

  setMine(patch: MemberPatch): void {
    this.set(updateMember(this.state, 0, { ...patch, ...(patch.name !== undefined ? { name: cleanName(patch.name) } : {}), ready: true }));
  }

  moveMe(to: SeatRef): void {
    this.set(moveMember(this.state, 0, to));
  }

  start(requireReady: boolean, played?: string): string | null {
    const problem = startProblem(this.state, requireReady);
    if (!problem) this.set(startMatch(this.state, played));
    return problem;
  }

  backToLobby(): void {
    if (this.state.playing) this.set(endMatch(this.state));
  }

  matchTransport(generation: number, member: number): Transport | null {
    for (const link of this.links) {
      if (link.id === member && this.state.inMatch.includes(member) && !link.channels.closed) return link.channels.match(generation);
    }
    return null;
  }

  pump(now: number): void {
    this.now = now;
    for (const link of [...this.links]) {
      if (link.closeAt !== null && now >= link.closeAt) link.channels.room.close();
      else if (now - link.heard > LOBBY_TIMEOUT_MS) link.channels.room.close();
    }
    if (now - this.sentAt >= HEARTBEAT_MS) this.broadcast();
  }

  close(): void {
    for (const link of [...this.links]) link.channels.room.close();
    this.status = 'Closed';
    this.emit();
  }

  private set(next: LobbyState): void {
    if (next === this.state) return;
    this.state = next;
    this.broadcast();
    this.emit();
  }

  private broadcast(): void {
    this.sentAt = this.now;
    for (const link of this.links) if (link.id !== null) this.send(link, { type: 'lobby', state: this.state, you: link.id, ack: link.seq });
  }

  private send(link: GuestLink, m: LobbyMessage): void {
    link.channels.room.send(m);
  }

  private refuse(link: GuestLink, reason: RefuseLobbyReason): void {
    this.send(link, { type: 'refuse', reason });
    link.closeAt ??= this.now + 1000;
  }

  private receive(link: GuestLink, m: LobbyMessage | null): void {
    if (!m || link.closeAt !== null) return;
    link.heard = this.now;
    if (m.type === 'join') {
      if (link.id !== null) return this.send(link, { type: 'lobby', state: this.state, you: link.id, ack: link.seq });
      if (m.protocol !== PROTOCOL_VERSION) return this.refuse(link, 'ProtocolMismatch');
      if (m.tuningHash !== this.tuningHash) return this.refuse(link, 'TuningDataMismatch');
      const id = this.nextId++;
      const weapon = this.tuning.weapons[m.weapon] ? m.weapon : this.state.members[0]!.weapon;
      const joined = join(this.state, { id, name: cleanName(m.name), weapon, body: m.body, ready: false });
      if (!joined) return this.refuse(link, 'RoomFull');
      link.id = id;
      return this.set(joined);
    }
    if (m.type !== 'member' || link.id === null || m.seq < link.seq) return;
    const patch: MemberPatch = { name: cleanName(m.name), body: m.body, ready: m.ready, ...(this.tuning.weapons[m.weapon] ? { weapon: m.weapon } : {}) };
    let next = updateMember(this.state, link.id, patch);
    if (m.seq > link.seq) {
      link.seq = m.seq;
      if (m.seat) next = moveMember(next, link.id, m.seat);
      // Acknowledge at once, so the guest stops overriding the state with its own wishes.
      if (next === this.state) this.broadcast();
    }
    this.set(next);
  }

  private drop(link: GuestLink): void {
    if (!this.links.delete(link)) return;
    if (link.id !== null) this.set(leave(this.state, link.id));
  }
}

/** A guest's Lobby: a copy of the host's, plus this player's own wishes until the host has them. */
export class GuestLobby extends Base implements Lobby {
  readonly online = true;
  readonly isHost = false;
  me: number | null = null;
  status: LobbyStatus = 'Joining';
  private readonly channels: Channels;
  private readonly tuningHash: string;
  private mine: { name: string; weapon: string; body: string; ready: boolean };
  private seq = 0;
  private acked = -1;
  private move: { seq: number; to: SeatRef } | null = null;
  /** The host's last state, before this player's unacknowledged wishes are laid over it. */
  private hostState: LobbyState | null = null;
  private heard = 0;
  private sentAt = -Infinity;
  private closing = false;

  constructor(
    transport: Transport,
    private readonly tuning: TuningData,
    me: { name: string; weapon: string; body: string },
  ) {
    super();
    this.tuningHash = tuningDataHash(tuning);
    this.mine = { name: cleanName(me.name), weapon: me.weapon, body: me.body, ready: false };
    this.channels = splitTransport(transport);
    this.channels.room.onMessage((raw) => this.receive(parseLobbyMessage(raw)));
    this.channels.room.onClose(() => this.closed(this.closing ? null : 'The host closed the Room (disconnected).'));
  }

  edit(): void {}

  start(): string | null {
    return 'Only the host starts the Match.';
  }

  backToLobby(): void {}

  setMine(patch: MemberPatch): void {
    this.mine = { ...this.mine, ...patch, ...(patch.name !== undefined ? { name: cleanName(patch.name) } : {}) };
    this.seq++;
    this.sendWishes();
    this.overlay();
  }

  moveMe(to: SeatRef): void {
    this.seq++;
    this.move = { seq: this.seq, to };
    this.sendWishes();
    this.overlay();
  }

  matchTransport(generation: number, member: number): Transport | null {
    return member !== 0 || this.channels.closed ? null : this.channels.match(generation);
  }

  pump(now: number): void {
    this.now = now;
    if (this.status === 'Closed') return;
    if (this.heard === 0) this.heard = now;
    if (now - this.heard > LOBBY_TIMEOUT_MS) return this.closed('Lost the connection to the host.');
    if (this.status === 'Joining' && now - this.sentAt >= HEARTBEAT_MS) {
      this.sentAt = now;
      this.channels.room.send({ type: 'join', protocol: PROTOCOL_VERSION, tuningHash: this.tuningHash, name: this.mine.name, weapon: this.mine.weapon, body: this.mine.body } satisfies LobbyMessage);
    } else if (this.status === 'Open' && now - this.sentAt >= HEARTBEAT_MS * 2) this.sendWishes();
  }

  close(): void {
    this.closed(null);
    this.closing = true;
    this.channels.room.close();
  }

  private sendWishes(): void {
    if (this.status !== 'Open') return;
    this.sentAt = this.now;
    this.channels.room.send({ type: 'member', seq: this.seq, ...this.mine, seat: this.move?.to ?? null } satisfies LobbyMessage);
  }

  private receive(m: LobbyMessage | null): void {
    if (!m || this.status === 'Closed') return;
    this.heard = this.now;
    if (m.type === 'refuse') {
      this.closed(refuseText(m.reason));
      this.closing = true;
      return this.channels.room.close();
    }
    if (m.type !== 'lobby' || !this.valid(m.state)) return;
    const joined = this.status === 'Joining';
    if (this.hostState && m.state.generation > this.hostState.generation && this.mine.ready) {
      // A Match started, and with it everyone's ready flag reset: ready again for the next one.
      this.mine = { ...this.mine, ready: false };
      this.seq++;
    }
    this.status = 'Open';
    this.me = m.you;
    this.hostState = m.state;
    this.acked = Math.max(this.acked, m.ack);
    if (this.move && this.acked >= this.move.seq) this.move = null;
    if (joined) {
      // Adopt the Weapon and name the host gave us (it may have refused ours).
      const self = m.state.members.find((x) => x.id === m.you);
      if (self) this.mine = { ...this.mine, name: self.name, weapon: self.weapon };
      this.sendWishes();
    }
    this.overlay();
  }

  /** The host's state with this player's unacknowledged wishes laid over it (so a pick shows at once). */
  private overlay(): void {
    if (!this.hostState || this.me === null) return;
    let view = this.hostState;
    if (this.acked < this.seq) view = updateMember(view, this.me, this.mine);
    if (this.move) view = moveMember(view, this.me, this.move.to);
    const changed = JSON.stringify(view) !== JSON.stringify(this.state);
    this.state = view;
    if (changed) this.emit();
  }

  /** Everything the state names exists here (the Tuning Data hashes matched, so this guards against a broken host). */
  private valid(s: LobbyState): boolean {
    const t = this.tuning;
    if (!isArenaName(t, s.settings.arena) || (s.matchArena !== null && !isArenaName(t, s.matchArena))) return false;
    if (!s.members.every((m) => t.weapons[m.weapon])) return false;
    return s.teams.flat().every(
      (seat) => seat.kind !== 'AI' || (t.weapons[seat.weapon] && t.ai.difficulties[seat.difficulty] && (seat.style === undefined || seat.style === RANDOM_PICK || t.ai.styles[seat.style])),
    );
  }

  private closed(reason: string | null): void {
    if (this.status === 'Closed') return;
    this.status = 'Closed';
    this.failure = reason;
    this.emit();
  }
}
