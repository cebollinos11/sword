/**
 * The Rollback session: wraps a whole Match for Player vs Player (ADR 0001),
 * for two to four Players: the host and up to three guests.
 *
 * - The peers form a star: each guest talks only to the host, over its Room
 *   link, and the host relays every guest's Intents to the other guests
 *   (ADR 0010). A guest's Intents reach another guest a hop later than the
 *   host's do; Rollback absorbs that like any other latency.
 * - Local Intents apply immediately. Every other Player's Intents are predicted
 *   (repeat their last known one) and corrected by Rollback: when a real Intent
 *   differs from the prediction, the session restores the snapshot before that
 *   Tick and re-simulates forward.
 * - It never runs more than ROLLBACK_WINDOW Ticks past the last confirmed Tick
 *   (every Player's Intents known); it stalls instead, so a Rollback never
 *   rewinds more than ROLLBACK_WINDOW Ticks.
 * - The host sends every guest the hash of every CHECKSUM_INTERVAL-th confirmed
 *   Tick. On a mismatch the guest asks for the host's state, which wins, and resyncs.
 * - Peers compare Tuning Data hashes at connect and refuse a mismatch.
 * - Time sync: each guest estimates how many Ticks it runs ahead of the host
 *   (from the Intents messages alone: latency cancels out), and the host how far
 *   it runs ahead of each guest; whoever is ahead waits a Tick now and then until
 *   they are level. Without it, a hiccup on one peer (a dropped frame, a GC pause)
 *   leaves another pinned at the edge of the Rollback window for good, stalling
 *   on every bit of network jitter.
 * - A guest who leaves (its link closes, it goes silent for `timeoutTicks`, or
 *   it refuses the host) does not end the Match: from the Tick after the last of
 *   its Intents the host holds, an AI Controller drives its Fighter, on every
 *   peer. The host decides that Tick and tells the guests. The host leaving ends
 *   the Match for everyone.
 *
 * The host chooses the Match options and the Lineup: who fights, on which
 * team, with the host as Player 0 and the guests as Players 1 to 3 (by default
 * one Fighter each, host first), and any AI Fighters with their difficulty and
 * Weapon. Each guest picks its own Weapon and its hello carries the pick; once
 * the host has every guest's, it sends each of them the Match options, the
 * Lineup, all the picks and which Player they are, and every peer builds the
 * same Match from them. A Weapon, difficulty or Lineup a peer cannot field is
 * refused like a Tuning Data mismatch.
 *
 * AI Fighters run on every peer: their Controllers are deterministic, so each
 * peer computes the same AI Intents and none cross the wire. Their memory is
 * snapshotted with every simulated Tick so a Rollback restores it, and it
 * travels with the host's state on a resync.
 *
 * It talks only through Transports, and only Intents (plus checksums, the
 * Players who left and the rare resync) cross them. Drive it with
 * `tick(localIntent)` once per Tick.
 */
import { createMatch, hashValue, IDLE_INTENT, restore, snapshot, stepMatch } from '../sim';
import type { Intent, MatchOptions, MatchState, Snapshot } from '../sim';
import { defaultWeaponName, tuningDataHash, weaponMotion, type TuningData } from '../tuning';
import {
  checkLineup,
  createAiController,
  createRemoteController,
  lineupAis,
  lineupMatch,
  lineupPlayers,
  ONE_VS_ONE,
  type Controller,
  type Lineup,
  type PeerIntentSource,
} from '../controllers';
import { parseNetMessage, PROTOCOL_VERSION, type DroppedPlayer, type IntentStream, type NetMessage, type RefuseReason } from './messages';
import type { Transport } from './transport';

/** The furthest the session runs ahead of the last confirmed Tick (and so the deepest Rollback). A constant, not Tuning Data. */
export const ROLLBACK_WINDOW = 15;
/** The host sends a state checksum for every confirmed Tick that is a multiple of this. */
export const CHECKSUM_INTERVAL = 30;
/** Ticks without any message from a peer before it counts as gone. */
export const DEFAULT_TIMEOUT_TICKS = 300;
/** The AI difficulty that takes over the Fighter of a Player who left (the first difficulty if Tuning Data has none of that name). */
export const TAKEOVER_DIFFICULTY = 'Normal';
/** Time sync: the lead (in Ticks) is averaged over this many Intents messages. */
const LEAD_SAMPLES = 32;
/** Time sync: wait a Tick when the averaged lead over a peer is at least this many Ticks... */
const LEAD_TO_WAIT = 1;
/** ...but at most once per this many Ticks, so a correction is spread out and barely visible. */
const WAIT_SPACING = 6;
/** While connecting, hello is (re)sent every this many Ticks until the peer's Intents arrive. */
const HELLO_INTERVAL = 10;
/** Intents and hashes older than this many Ticks behind the confirmed Tick are dropped. */
const HISTORY_TICKS = 600;

export type SessionRole = 'host' | 'guest';
export type SessionStatus = 'Connecting' | 'Running' | 'Refused' | 'Disconnected';

export type SessionEvent =
  | { readonly type: 'Connected' }
  | { readonly type: 'Refused'; readonly reason: RefuseReason; readonly localHash: string; readonly remoteHash: string }
  /** The Match is over for this peer: its link closed, went silent, or (guest) the host dropped it. */
  | { readonly type: 'Disconnected'; readonly reason: 'Closed' | 'Timeout' | 'Dropped' }
  /** Another Player left: the AI drives their Fighter from `tick` on. */
  | { readonly type: 'PlayerLeft'; readonly player: number; readonly tick: number }
  /** Guest only: its state at `tick` hashes differently from the host's. A resync follows. */
  | { readonly type: 'Desync'; readonly tick: number; readonly localHash: string; readonly hostHash: string }
  /** Guest only: replaced its state with the host's state at `tick` and re-simulated forward. */
  | { readonly type: 'Resynced'; readonly tick: number };

export interface TickResult {
  /** The Match advanced by one Tick. */
  readonly advanced: boolean;
  /** Running, but waiting for another Player's Intents: the window is full. */
  readonly stalled: boolean;
  /** Running, but holding back a Tick for time sync: this peer runs ahead of another. */
  readonly waited: boolean;
  /** Ticks re-simulated by a Rollback this call (0 if none). Never more than ROLLBACK_WINDOW. */
  readonly rolledBack: number;
}

export interface SessionStats {
  readonly rollbacks: number;
  readonly maxRollback: number;
  readonly stalls: number;
  /** Ticks held back by time sync. */
  readonly waits: number;
  readonly resyncs: number;
}

export interface RollbackSessionOptions {
  readonly role: SessionRole;
  /** A guest's link to the host; or a host's link to its one guest (the same as `guests: [transport]`). */
  readonly transport?: Transport;
  /** Host only: one link per guest, index p - 1 for Player p; null for a guest already gone (the AI drives its Fighter from the start). */
  readonly guests?: readonly (Transport | null)[];
  readonly tuning: TuningData;
  /** Host only: the Match to play (its `weapons` and `teams` come from the Lineup and the Players' picks). The guests receive it at connect. */
  readonly match?: MatchOptions;
  /** Host only: who fights (default ONE_VS_ONE). Its Players must be the host and one per guest. The guests receive it at connect. */
  readonly lineup?: Lineup;
  /** This peer's Weapon (a Tuning Data Weapon name). Default: the default Weapon. */
  readonly weapon?: string;
  /** Default DEFAULT_TIMEOUT_TICKS. */
  readonly timeoutTicks?: number;
  /** The Tick function. Defaults to `stepMatch`; tests swap it to inject divergence. */
  readonly step?: typeof stepMatch;
}

export interface RollbackSession {
  readonly role: SessionRole;
  /** This peer's Player number (0 for the host); -1 until a guest has it from the host. */
  readonly localPlayer: number;
  /** The Fighter this peer controls (its Player's slot in the Lineup); -1 until the Match is built. */
  readonly localFighter: number;
  /** Who fights; null until the guest has it from the host. */
  readonly lineup: Lineup | null;
  /** The Remote Controller driving the other Players' Fighters: their Intents for the Tick being simulated, real or predicted. */
  readonly remote: Controller;
  readonly status: SessionStatus;
  /** The current (possibly predicted) Match state; null until Running. Render this. */
  readonly state: MatchState | null;
  /** The Tick of `state` (0 until Running). */
  readonly currentTick: number;
  /** The last Tick for which every Player's real Intents are known. */
  readonly confirmedTick: number;
  readonly stats: SessionStats;
  /** Round-trip time in milliseconds (smoothed): a guest's to the host; the host's to its slowest guest. Null until the first answer. Cosmetic: never feeds the Simulation. */
  readonly ping: number | null;
  /** Advance one Tick with this peer's local Intent (ignored while stalled or not Running). */
  tick(localIntent: Intent): TickResult;
  /** The state hash this peer recorded for a confirmed checksum Tick (a multiple of CHECKSUM_INTERVAL), if any. */
  checksumAt(tick: number): string | undefined;
  onEvent(listener: (event: SessionEvent) => void): void;
  /** Close every link (the peers see a disconnect). */
  close(): void;
}

const NOTHING: TickResult = { advanced: false, stalled: false, waited: false, rolledBack: 0 };

/** Field-agnostic, so new Intent fields are compared too. */
function sameIntent(a: Intent, b: Intent): boolean {
  return a === b || hashValue(a) === hashValue(b);
}

/** Drop every entry of a per-Tick map whose Tick matches. */
function pruneTicks(map: Map<number, unknown>, drop: (tick: number) => boolean): void {
  for (const t of map.keys()) if (drop(t)) map.delete(t);
}

export function createRollbackSession(options: RollbackSessionOptions): RollbackSession {
  return new Session(options);
}

/** One peer this one talks to: each guest, on the host; the host, on a guest. */
interface Link {
  readonly transport: Transport;
  /** The Player at the other end: the guest's number on the host, 0 (the host) on a guest. */
  readonly peer: number;
  /** acks[p]: the last Tick up to which the peer holds all of Player p's Intents. */
  readonly acks: number[];
  silentTicks: number;
  /** Time sync: recent estimates of how many Ticks this peer runs ahead of that one. */
  readonly leads: number[];
  ping: number | null;
  /** The peer's Intents have arrived: it is Running, so hello need not be resent. */
  heardIntents: boolean;
  /** Host: the guest's Weapon pick, once its hello has arrived. */
  weapon: string | null;
  /** Host: why it was refused (its every hello is answered with the refusal again), or null. */
  refused: RefuseReason | null;
  /** Closed, silent, or refused: nothing more is sent to it or taken from it. */
  gone: boolean;
}

class Session implements RollbackSession, PeerIntentSource {
  readonly role: SessionRole;
  localPlayer: number;
  localFighter = -1;
  readonly remote: Controller = createRemoteController(this);
  status: SessionStatus = 'Connecting';
  state: MatchState | null = null;
  stats = { rollbacks: 0, maxRollback: 0, stalls: 0, waits: 0, resyncs: 0 };

  private readonly links: Link[];
  private readonly tuning: TuningData;
  private readonly tuningHash: string;
  private readonly matchOptions: MatchOptions | undefined;
  /** Host: from the options; guest: from the host's hello. */
  lineup: Lineup | null;
  /** How many Players the Match fields (0 until a guest has the Lineup). */
  private players = 0;
  /** Each Player's Fighter, and each Fighter's Player (-1 for an AI of the Lineup). */
  private fighterOf: number[] = [];
  private playerOf: number[] = [];
  /** An AI Controller per AI Fighter, the Lineup's and those driving a Player who left (null for the Players' Fighters). */
  private ais: (Controller | null)[] = [];
  /** Per Player: the Tick from which the AI drives their Fighter, because they left (null while they play). */
  private readonly takeover: (number | null)[] = [];
  /** Per Fighter taken over: its AI Controller's fresh memory, loaded on the takeover Tick (so every peer starts it alike). */
  private readonly takeoverMemory: unknown[] = [];
  /** Host: the Players who left, sent to every guest. */
  private readonly dropped: DroppedPlayer[] = [];
  /** Each AI Controller's memory after each simulated Tick, from the confirmed Tick on (null where no AI drives the Fighter yet). */
  private readonly aiMemory = new Map<number, unknown[]>();
  /** This peer's Weapon pick. */
  private readonly weapon: string;
  private readonly timeoutTicks: number;
  private readonly stepFn: typeof stepMatch;
  private readonly listeners: ((e: SessionEvent) => void)[] = [];
  private inbox: { link: Link; message: NetMessage }[] = [];
  /** Links that closed since the last Tick. */
  private closedLinks: Link[] = [];
  private lastPingAt = 0;

  /** Snapshots from the confirmed Tick up to the current Tick. */
  private readonly states = new Map<number, Snapshot<MatchState>>();
  /** Per Player: their Intents (this peer's own, as it made them; the others' real ones as they arrive). */
  private readonly intents: Map<number, Intent>[] = [];
  /** Per other Player: the Intent each simulated Tick actually used (real or predicted). */
  private readonly used: Map<number, Intent>[] = [];
  /** Per other Player: the last Tick up to which all their real Intents are held. */
  private readonly confirmed: number[] = [];
  /** Earliest Tick simulated with a wrong prediction (or before a takeover), pending Rollback. */
  private rollbackFrom: number | null = null;
  /** The Tick being simulated right now, if any (what the Remote Controller is asked about). */
  private simulating: number | null = null;
  private readonly hashes = new Map<number, string>();
  private readonly hostChecksums = new Map<number, string>();
  private lastHashed = 0;
  /** Guest: checksums at or before this Tick predate the last resync. */
  private resyncedAt = -1;
  private awaitingResync = false;
  private helloCountdown = 0;
  private ticksSinceWait = 0;

  constructor(o: RollbackSessionOptions) {
    this.role = o.role;
    this.tuning = o.tuning;
    this.tuningHash = tuningDataHash(o.tuning);
    this.timeoutTicks = o.timeoutTicks ?? DEFAULT_TIMEOUT_TICKS;
    this.stepFn = o.step ?? stepMatch;
    this.weapon = o.weapon ?? defaultWeaponName(o.tuning);
    if (!o.tuning.weapons[this.weapon]) throw new Error(`Unknown Weapon "${this.weapon}"`);
    if (o.role === 'host') {
      if (!o.match) throw new Error('The host must choose the Match options');
      this.matchOptions = o.match;
      this.lineup = o.lineup ?? ONE_VS_ONE;
      const guests = o.guests ?? (o.transport ? [o.transport] : []);
      checkLineup(o.tuning, this.lineup, guests.length + 1);
      this.localPlayer = 0;
      this.setLineup(this.lineup);
      this.links = guests.map((t, i) => this.link(t, i + 1));
      // Dropped on the first Tick, so whoever listens hears of it.
      guests.forEach((t, i) => {
        if (!t) this.closedLinks.push(this.links[i]!);
      });
    } else {
      if (!o.transport) throw new Error('A guest needs its link to the host');
      this.matchOptions = undefined;
      this.lineup = null;
      this.localPlayer = -1;
      this.links = [this.link(o.transport, 0)];
    }
    this.sendHellos();
    this.maybeStart();
  }

  /** A Link over `transport` (or a gone one, for a guest that left before the Match). */
  private link(transport: Transport | null, peer: number): Link {
    const link: Link = {
      transport: transport ?? { send() {}, onMessage() {}, onClose() {}, close() {} },
      peer,
      acks: [0, 0, 0, 0],
      silentTicks: 0,
      leads: [],
      ping: null,
      heardIntents: false,
      weapon: null,
      refused: null,
      gone: false,
    };
    if (!transport) return link;
    transport.onMessage((m) => {
      const message = parseNetMessage(m);
      // A refused guest's hello is still answered (with the refusal again); nothing else from a gone peer counts.
      if (!message || (link.gone && !(link.refused && message.type === 'hello'))) return;
      // Answered at once, not at the next Tick, so the Tick rate does not inflate the measurement.
      if (message.type === 'ping') transport.send({ type: 'pong', sent: message.sent });
      else if (message.type === 'pong') {
        const rtt = Math.max(0, performance.now() - message.sent);
        link.ping = link.ping === null ? rtt : link.ping * 0.7 + rtt * 0.3;
      } else this.inbox.push({ link, message });
    });
    transport.onClose(() => {
      if (this.role === 'guest') this.disconnect('Closed');
      else this.closedLinks.push(link);
    });
    return link;
  }

  get currentTick(): number {
    return this.state?.tick ?? 0;
  }

  get confirmedTick(): number {
    return Math.min(this.currentTick, this.othersConfirmed());
  }

  get ping(): number | null {
    let worst: number | null = null;
    for (const l of this.live()) if (l.ping !== null) worst = Math.max(worst ?? 0, l.ping);
    return worst;
  }

  onEvent(listener: (event: SessionEvent) => void): void {
    this.listeners.push(listener);
  }

  checksumAt(tick: number): string | undefined {
    return this.hashes.get(tick);
  }

  close(): void {
    for (const l of this.links) l.transport.close();
    this.disconnect('Closed');
  }

  tick(localIntent: Intent): TickResult {
    if (this.status === 'Refused' || this.status === 'Disconnected') return NOTHING;
    const inbox = this.inbox;
    this.inbox = [];
    for (const l of this.live()) if (this.status === 'Running' || this.role === 'host') l.silentTicks++;
    for (const { link, message } of inbox) {
      link.silentTicks = 0;
      if (link.refused) this.sendRefusal(link, link.refused);
      else this.handle(link, message);
    }
    for (const l of this.closedLinks.splice(0)) this.dropLink(l);
    for (const l of this.live()) {
      if (l.silentTicks <= this.timeoutTicks) continue;
      if (this.role === 'guest') {
        this.disconnect('Timeout');
        return NOTHING;
      }
      this.dropLink(l, true);
    }
    if ((this.status as SessionStatus) === 'Disconnected') return NOTHING;
    this.maybeStart();
    const now = performance.now();
    if (this.status === 'Running' && now - this.lastPingAt >= 1000) {
      this.lastPingAt = now;
      for (const l of this.live()) l.transport.send({ type: 'ping', sent: now });
    }
    if (--this.helloCountdown <= 0) this.sendHellos();
    if (this.status !== 'Running') return NOTHING;

    const rolledBack = this.rollback();
    const next = this.currentTick + 1;
    const stalled = next - this.othersConfirmed() > ROLLBACK_WINDOW;
    const waited = !stalled && this.shouldWait();
    if (stalled) {
      this.stats.stalls++;
    } else if (waited) {
      this.stats.waits++;
    } else {
      this.intents[this.localPlayer]!.set(next, localIntent);
      this.simulateNext();
    }
    this.recordConfirmed();
    for (const l of this.live()) this.sendIntents(l);
    return { advanced: !stalled && !waited, stalled, waited, rolledBack };
  }

  private live(): Link[] {
    return this.links.filter((l) => !l.gone);
  }

  // --- Players ---

  /** Learn who fights: each Player's Fighter, and fresh AI Controllers for the Lineup's AIs. */
  private setLineup(lineup: Lineup): void {
    this.lineup = lineup;
    this.players = lineupPlayers(lineup);
    this.playerOf = lineup.map((s) => (s.pilot.kind === 'Player' ? s.pilot.player : -1));
    this.fighterOf = Array.from({ length: this.players }, (_, p) => this.playerOf.indexOf(p));
    this.localFighter = this.fighterOf[this.localPlayer] ?? -1;
    this.ais = lineupAis(this.tuning, lineup);
    for (let p = 0; p < this.players; p++) {
      this.intents[p] = new Map();
      this.used[p] = new Map();
      this.confirmed[p] = 0;
      this.takeover[p] = null;
    }
  }

  /** The last Tick up to which Player p's Intents are settled: all real ones held, or Infinity once the AI has taken over after them. */
  private heldUpTo(p: number): number {
    const from = this.takeover[p];
    return from != null && this.confirmed[p]! >= from - 1 ? Infinity : this.confirmed[p]!;
  }

  /** The last Tick up to which every other Player's Intents are settled (Infinity with nobody else left). */
  private othersConfirmed(): number {
    let min = Infinity;
    for (let p = 0; p < this.players; p++) if (p !== this.localPlayer) min = Math.min(min, this.heldUpTo(p));
    return min;
  }

  /** Does an AI drive Fighter i on Tick t (one of the Lineup's AIs, or a Player's taken over)? */
  private aiDrives(i: number, t: number): boolean {
    const p = this.playerOf[i]!;
    if (p < 0) return true;
    const from = this.takeover[p];
    return from != null && t >= from;
  }

  /** Host: stop talking to a guest, and hand its Fighter to the AI after the last of its Intents held here. */
  private dropLink(link: Link, timedOut = false): void {
    if (link.gone) return;
    link.gone = true;
    if (timedOut) link.transport.close();
    this.drop(link.peer, this.status === 'Running' ? this.confirmed[link.peer]! + 1 : 1);
  }

  /** Player p left: the AI drives their Fighter from Tick `from` on. */
  private drop(p: number, from: number): void {
    if (p === this.localPlayer) return this.disconnect('Dropped');
    if (p < 0 || p >= this.players || this.takeover[p] != null) return;
    // The host never drops a Player before Ticks every peer has confirmed (it holds their Intents beyond those).
    if (this.state && from <= this.confirmedTick) return;
    this.takeover[p] = from;
    const fighter = this.fighterOf[p]!;
    const difficulties = Object.keys(this.tuning.ai.difficulties);
    const ai = createAiController(this.tuning, difficulties.includes(TAKEOVER_DIFFICULTY) ? TAKEOVER_DIFFICULTY : difficulties[0]!);
    this.ais[fighter] = ai;
    this.takeoverMemory[fighter] = ai.save?.() ?? null;
    if (this.state && from <= this.currentTick) this.rollbackFrom = Math.min(this.rollbackFrom ?? from, from);
    if (this.role === 'host') this.dropped.push({ player: p, tick: from });
    this.emit({ type: 'PlayerLeft', player: p, tick: from });
  }

  /** Host: build the Match once every guest has sent its pick (or left). */
  private maybeStart(): void {
    if (this.role !== 'host' || this.status !== 'Connecting' || this.links.some((l) => !l.gone && l.weapon === null)) return;
    const picks = [this.weapon, ...this.links.map((l) => l.weapon ?? defaultWeaponName(this.tuning))];
    this.build(this.matchOptions!, picks);
    this.sendHellos();
  }

  private build(options: MatchOptions, picks: readonly string[]): void {
    this.state = createMatch(this.tuning, lineupMatch(this.tuning, this.lineup!, picks, options));
    this.states.set(0, snapshot(this.state));
    this.aiMemory.set(0, this.saveAis(0));
    this.status = 'Running';
    for (const l of this.links) l.silentTicks = 0;
    this.emit({ type: 'Connected' });
  }

  // --- Time sync ---

  /**
   * Record how far ahead of a peer this peer runs, from an Intents message: the peer's Tick when it sent it,
   * the last of our Ticks it held then (`ack`), and our Tick now. Each side's raw advantage includes the
   * one-way latency; half their difference is the true lead, with the latency cancelled.
   */
  private sampleLead(link: Link, peerTick: number, ack: number): void {
    const localAdvantage = this.currentTick - peerTick;
    const peerAdvantage = peerTick - ack;
    link.leads.push((localAdvantage - peerAdvantage) / 2);
    if (link.leads.length > LEAD_SAMPLES) link.leads.shift();
  }

  /** Hold back this Tick to let a peer catch up? Only a peer that is ahead ever waits (the host: ahead of its slowest guest). */
  private shouldWait(): boolean {
    this.ticksSinceWait++;
    if (this.ticksSinceWait < WAIT_SPACING) return false;
    let lead = -Infinity;
    for (const l of this.live()) {
      if (l.leads.length >= LEAD_SAMPLES / 2) lead = Math.max(lead, l.leads.reduce((a, b) => a + b, 0) / l.leads.length);
    }
    if (lead < LEAD_TO_WAIT) return false;
    this.ticksSinceWait = 0;
    // Our own Tick count drops at once; a peer's view of it reaches us a round trip later. Don't count this wait twice.
    for (const l of this.live()) for (let i = 0; i < l.leads.length; i++) l.leads[i]! -= 1;
    return true;
  }

  // --- Simulation ---

  private simulateNext(): void {
    const prev = this.state!;
    const t = prev.tick + 1;
    const intents = this.playerOf.map((p, i) => {
      if (this.aiDrives(i, t)) {
        // A takeover starts every peer's AI from the same fresh memory, whatever it did in Ticks since re-simulated.
        if (p >= 0 && this.takeover[p] === t) this.ais[i]!.load?.(this.takeoverMemory[i]);
        return this.ais[i]!.intent(prev.duel, i);
      }
      if (p === this.localPlayer) return this.intents[p]!.get(t) ?? IDLE_INTENT;
      this.simulating = t;
      const intent = this.remote.intent(prev.duel, i);
      this.simulating = null;
      this.used[p]!.set(t, intent);
      return intent;
    });
    this.state = this.stepFn(prev, intents, this.tuning);
    this.states.set(t, snapshot(this.state));
    this.aiMemory.set(t, this.saveAis(t));
  }

  /** Each AI Controller's memory after Tick t (null where no AI drives the Fighter yet). */
  private saveAis(t: number): unknown[] {
    return this.ais.map((ai, i) => (ai && this.aiDrives(i, t) ? (ai.save?.() ?? null) : null));
  }

  private loadAis(memory: readonly unknown[]): void {
    this.ais.forEach((ai, i) => {
      if (ai && memory[i] != null) ai.load?.(memory[i]);
    });
  }

  /** The Intent of the Player driving `fighter` for the Tick being simulated (or the next one): real once it has arrived, else their last real one repeated. */
  peerIntent(fighter: number): Intent {
    const p = this.playerOf[fighter] ?? -1;
    const t = this.simulating ?? this.currentTick + 1;
    return this.intents[p]?.get(Math.min(t, this.confirmed[p]!)) ?? IDLE_INTENT;
  }

  /** Re-simulate from the earliest mispredicted Tick. Returns the number of Ticks re-simulated. */
  private rollback(): number {
    if (this.rollbackFrom === null) return 0;
    const base = this.rollbackFrom - 1;
    this.rollbackFrom = null;
    const target = this.currentTick;
    this.resimulate(base, target);
    const depth = target - base;
    this.stats.rollbacks++;
    this.stats.maxRollback = Math.max(this.stats.maxRollback, depth);
    return depth;
  }

  private resimulate(base: number, target: number): void {
    this.state = restore(this.states.get(base)!);
    this.loadAis(this.aiMemory.get(base)!);
    while (this.currentTick < target) this.simulateNext();
  }

  /** Hash newly confirmed checksum Ticks (host: send them; guest: compare), then drop snapshots older than the confirmed Tick. */
  private recordConfirmed(): void {
    const confirmed = this.confirmedTick;
    for (let k = this.lastHashed + 1; k <= confirmed; k++) {
      if (k % CHECKSUM_INTERVAL !== 0) continue;
      const hash = hashValue(restore(this.states.get(k)!));
      this.hashes.set(k, hash);
      if (this.role === 'host') for (const l of this.live()) l.transport.send({ type: 'checksum', tick: k, hash });
      else this.compareChecksum(k);
    }
    this.lastHashed = Math.max(this.lastHashed, confirmed);
    pruneTicks(this.states, (t) => t < confirmed);
    pruneTicks(this.aiMemory, (t) => t < confirmed);
    const old = confirmed - HISTORY_TICKS;
    for (const map of [...this.intents, ...this.used, this.hashes, this.hostChecksums]) pruneTicks(map, (t) => t < old);
  }

  // --- Messages ---

  private sendHellos(): void {
    this.helloCountdown = HELLO_INTERVAL;
    const hello = { type: 'hello', protocol: PROTOCOL_VERSION, tuningHash: this.tuningHash, weapon: this.weapon } as const;
    if (this.role === 'guest') {
      if (this.status === 'Connecting') this.links[0]!.transport.send(hello);
      return;
    }
    // The host's hello carries the Match only once every pick is in. Weapons and teams stay out of the
    // options: each peer adds them from the Lineup and the picks.
    const state = this.state;
    for (const l of this.live()) {
      if (l.heardIntents) continue;
      if (!state) {
        l.transport.send(hello);
        continue;
      }
      const { weapons: _picks, teams: _teams, ...match } = this.matchOptions!;
      const weapons = this.fighterOf.map((i) => state.config.weapons[i]!);
      l.transport.send({ ...hello, match, lineup: this.lineup!, weapons, player: l.peer });
    }
  }

  /** What Player p's Intents this peer holds, up to which Tick. */
  private have(p: number): number {
    return p === this.localPlayer ? this.currentTick : this.confirmed[p]!;
  }

  /** The Intents of Player p from `from` up to `to` (stopping at a gap). */
  private stream(p: number, from: number, to: number): IntentStream {
    const map = this.intents[p]!;
    const intents: Intent[] = [];
    for (let t = from; t <= to && map.has(t); t++) intents.push(map.get(t)!);
    return { player: p, from, intents };
  }

  /** A guest sends its own Intents; the host its own and every other guest's, each from where that peer's ack leaves off. */
  private sendIntents(link: Link): void {
    const streams: IntentStream[] = [];
    for (let p = 0; p < this.players; p++) {
      if (p === link.peer || (this.role === 'guest' && p !== this.localPlayer)) continue;
      const s = this.stream(p, link.acks[p]! + 1, this.have(p));
      if (s.intents.length > 0) streams.push(s);
    }
    const acks = Array.from({ length: this.players }, (_, p) => this.have(p));
    const dropped = this.role === 'host' && this.dropped.length > 0 ? { dropped: this.dropped } : {};
    link.transport.send({ type: 'intents', tick: this.currentTick, streams, acks, ...dropped });
  }

  private handle(link: Link, m: NetMessage): void {
    if (this.status === 'Refused' || this.status === 'Disconnected') return;
    switch (m.type) {
      case 'hello':
        return this.role === 'host' ? this.onGuestHello(link, m.protocol, m.tuningHash, m.weapon) : this.onHostHello(m);
      case 'refuse':
        // A guest refusing the host only loses that guest.
        if (this.role === 'host') return this.dropLink(link);
        return this.refuse(m.reason, m.tuningHash);
      case 'intents': {
        if (this.status !== 'Running') return;
        link.heardIntents = true;
        for (let p = 0; p < this.players; p++) {
          const ack = m.acks[p];
          if (ack !== undefined) link.acks[p] = Math.max(link.acks[p]!, Math.min(ack, this.have(p))); // it cannot hold Intents we have not got
        }
        this.sampleLead(link, m.tick, Math.min(m.acks[this.localPlayer] ?? 0, this.currentTick));
        if (this.role === 'guest') for (const d of m.dropped ?? []) this.drop(d.player, d.tick);
        for (const s of m.streams) {
          // The host takes only a guest's own Intents; a guest any other Player's, relayed by the host.
          if (s.player === this.localPlayer || s.player >= this.players || (this.role === 'host' && s.player !== link.peer)) continue;
          this.receiveIntents(s.player, s.from, s.intents, true);
        }
        return;
      }
      case 'checksum':
        if (this.role === 'guest' && this.status === 'Running' && m.tick > this.resyncedAt) {
          this.hostChecksums.set(m.tick, m.hash);
          this.compareChecksum(m.tick);
        }
        return;
      case 'resyncRequest':
        if (this.role === 'host' && this.status === 'Running') this.sendResync(link);
        return;
      case 'resync':
        if (this.role === 'guest' && this.status === 'Running') this.applyResync(m.tick, m.state, m.ai, m.streams);
        return;
    }
  }

  /** Host: a guest's hello carries its Weapon pick. */
  private onGuestHello(link: Link, protocol: number, remoteHash: string, weapon: string | undefined): void {
    const reason: RefuseReason | null =
      protocol !== PROTOCOL_VERSION ? 'ProtocolMismatch' : remoteHash !== this.tuningHash || (weapon !== undefined && !this.tuning.weapons[weapon]) ? 'TuningDataMismatch' : null;
    if (reason) {
      link.refused = reason;
      this.sendRefusal(link, reason);
      return this.dropLink(link);
    }
    if (weapon !== undefined && link.weapon === null) link.weapon = weapon;
  }

  /** Host: refuse a guest (again on each of its hellos, in case a refusal was lost). */
  private sendRefusal(link: Link, reason: RefuseReason): void {
    link.transport.send({ type: 'refuse', reason, tuningHash: this.tuningHash });
  }

  /** Guest: the host's hello, once it carries the Match, builds it. */
  private onHostHello(m: Extract<NetMessage, { type: 'hello' }>): void {
    if (m.protocol !== PROTOCOL_VERSION) return this.refuse('ProtocolMismatch', m.tuningHash, true);
    if (m.tuningHash !== this.tuningHash) return this.refuse('TuningDataMismatch', m.tuningHash, true);
    if (this.status !== 'Connecting' || !m.match || !m.lineup || !m.weapons || m.player === undefined) return;
    const { match, lineup, weapons, player } = m;
    try {
      if (!weapons.every((w) => this.tuning.weapons[w])) throw new RangeError('Unknown Weapon');
      if (player < 1 || player >= weapons.length) throw new RangeError(`No Player ${player}`);
      checkLineup(this.tuning, lineup, weapons.length);
    } catch {
      return this.refuse('TuningDataMismatch', m.tuningHash, true);
    }
    this.localPlayer = player;
    this.setLineup(lineup);
    this.build(match, weapons);
  }

  private refuse(reason: RefuseReason, remoteHash: string, tellPeer = false): void {
    if (this.status === 'Refused') return;
    this.status = 'Refused';
    if (tellPeer) this.links[0]!.transport.send({ type: 'refuse', reason, tuningHash: this.tuningHash });
    this.emit({ type: 'Refused', reason, localHash: this.tuningHash, remoteHash });
  }

  private disconnect(reason: 'Closed' | 'Timeout' | 'Dropped'): void {
    if (this.status === 'Refused' || this.status === 'Disconnected') return;
    this.status = 'Disconnected';
    this.emit({ type: 'Disconnected', reason });
    if (reason !== 'Closed') for (const l of this.links) l.transport.close();
  }

  /** Take Player p's real Intents for Ticks from `from` on; mark a Rollback where a used prediction was wrong. */
  private receiveIntents(p: number, from: number, intents: readonly Intent[], checkPredictions: boolean): void {
    const takeover = this.takeover[p] ?? Infinity;
    for (let i = 0; i < intents.length; i++) {
      const t = from + i;
      if (t <= this.confirmed[p]!) continue;
      if (t !== this.confirmed[p]! + 1 || t >= takeover) break;
      const intent = intents[i]!;
      this.intents[p]!.set(t, intent);
      this.confirmed[p] = t;
      const used = this.used[p]!.get(t);
      if (checkPredictions && t <= this.currentTick && used && !sameIntent(used, intent)) {
        this.rollbackFrom = Math.min(this.rollbackFrom ?? t, t);
      }
    }
  }

  private compareChecksum(tick: number): void {
    const hostHash = this.hostChecksums.get(tick);
    const localHash = this.hashes.get(tick);
    if (hostHash === undefined || localHash === undefined) return;
    this.hostChecksums.delete(tick);
    if (hostHash === localHash) return;
    if (!this.awaitingResync) this.emit({ type: 'Desync', tick, localHash, hostHash });
    this.awaitingResync = true;
    this.links[0]!.transport.send({ type: 'resyncRequest', tick });
  }

  /** Host: send a guest the confirmed state, plus the other Players' Intents it may still lack up to it. */
  private sendResync(link: Link): void {
    const tick = this.confirmedTick;
    const streams: IntentStream[] = [];
    for (let p = 0; p < this.players; p++) if (p !== link.peer) streams.push(this.stream(p, link.acks[p]! + 1, Math.min(tick, this.have(p))));
    link.transport.send({ type: 'resync', tick, state: restore(this.states.get(tick)!), ai: this.aiMemory.get(tick)!, streams });
    this.stats.resyncs++;
  }

  /** Guest: adopt the host's state (and its AI Controllers' memory) at `tick` and re-simulate up to the current Tick. */
  private applyResync(tick: number, state: MatchState, ai: readonly unknown[], streams: readonly IntentStream[]): void {
    if (!this.awaitingResync || tick <= this.resyncedAt || tick > this.currentTick) return;
    // parseNetMessage checked the shape; only Tuning Data can tell whether its Weapons and Motions exist, and only the Lineup who fights.
    if (!state.duel.fighters.every((f) => this.tuning.weapons[f.weapon] && weaponMotion(this.tuning, f.weapon, f.motion.name))) return;
    if (!state.config.weapons.every((w) => this.tuning.weapons[w])) return;
    const teams = this.lineup!.map((s) => s.team);
    if (state.config.teams.length !== teams.length || !state.config.teams.every((t, i) => t === teams[i])) return;
    if (state.duel.fighters.length !== teams.length || ai.length !== teams.length) return;
    // AI memory exactly where an AI drives the Fighter at `tick` (and none, or the host's, where one takes over later).
    const memoryFits = (m: unknown, i: number) => {
      const p = this.playerOf[i]!;
      if (this.aiDrives(i, tick)) return m !== null;
      return m === null || (p >= 0 && this.takeover[p] != null);
    };
    if (!ai.every(memoryFits)) return;
    for (const s of streams) if (s.player !== this.localPlayer && s.player < this.players) this.receiveIntents(s.player, s.from, s.intents, false);
    if (this.othersConfirmed() < tick) return;
    for (let t = tick + 1; t <= this.currentTick; t++) if (!this.intents[this.localPlayer]!.has(t)) return;
    const target = this.currentTick;
    this.states.clear();
    this.states.set(tick, snapshot(state));
    this.aiMemory.clear();
    this.aiMemory.set(tick, [...ai]);
    this.resimulate(tick, target);
    this.rollbackFrom = null;
    pruneTicks(this.hashes, (t) => t >= tick);
    pruneTicks(this.hostChecksums, (t) => t <= tick);
    this.lastHashed = tick - 1;
    this.resyncedAt = tick;
    this.awaitingResync = false;
    this.stats.resyncs++;
    this.emit({ type: 'Resynced', tick });
  }

  private emit(e: SessionEvent): void {
    for (const l of this.listeners) l(e);
  }
}
