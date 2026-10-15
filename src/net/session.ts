/**
 * The Rollback session: wraps a whole Match for Player vs Player (ADR 0001).
 *
 * - Local Intents apply immediately. The remote Fighter's Intents are predicted
 *   (repeat the last known one) and corrected by Rollback: when a real Intent
 *   differs from the prediction, the session restores the snapshot before that
 *   Tick and re-simulates forward.
 * - It never runs more than ROLLBACK_WINDOW Ticks past the last confirmed Tick
 *   (both Fighters' Intents known); it stalls instead, so a Rollback never
 *   rewinds more than ROLLBACK_WINDOW Ticks.
 * - The host sends the hash of every CHECKSUM_INTERVAL-th confirmed Tick. On a
 *   mismatch the guest asks for the host's state, which wins, and resyncs.
 * - Peers compare Tuning Data hashes at connect and refuse a mismatch.
 * - Time sync: each peer estimates how many Ticks it runs ahead of the other
 *   (from the Intents messages alone: latency cancels out), and the one ahead
 *   waits a Tick now and then until they are level. Without it, a hiccup on one
 *   peer (a dropped frame, a GC pause) leaves the other pinned at the edge of
 *   the Rollback window for good, stalling on every bit of network jitter.
 * - Disconnects (Transport closed, or nothing heard for `timeoutTicks`) are surfaced.
 *
 * The host chooses the Match options and the Lineup: who fights, on which
 * team, with the host as Player 0 and the guest as Player 1 (by default one
 * Fighter each, host first), and any AI Fighters with their difficulty and
 * Weapon. Each peer picks its own Weapon and its hello carries the pick (the
 * host's also carries the Match options and the Lineup); each peer builds the
 * Match from them and both picks as soon as the other's hello arrives, so both
 * build the same Match, and neither waits an extra trip. A Weapon, difficulty
 * or Lineup a peer cannot field is refused like a Tuning Data mismatch.
 *
 * AI Fighters run on both peers: their Controllers are deterministic, so each
 * peer computes the same AI Intents and none cross the wire. Their memory is
 * snapshotted with every simulated Tick so a Rollback restores it, and it
 * travels with the host's state on a resync.
 *
 * It talks only through a Transport, and only Intents (plus checksums and the
 * rare resync) cross it. Drive it with `tick(localIntent)` once per Tick.
 */
import { createMatch, hashValue, IDLE_INTENT, restore, snapshot, stepMatch } from '../sim';
import type { Intent, MatchOptions, MatchState, Snapshot } from '../sim';
import { defaultWeaponName, tuningDataHash, weaponMotion, type TuningData } from '../tuning';
import {
  checkLineup,
  createRemoteController,
  lineupAis,
  lineupMatch,
  ONE_VS_ONE,
  playerFighter,
  type Controller,
  type Lineup,
  type PeerIntentSource,
} from '../controllers';
import { parseNetMessage, PROTOCOL_VERSION, type NetMessage, type RefuseReason } from './messages';
import type { Transport } from './transport';

/** The furthest the session runs ahead of the last confirmed Tick (and so the deepest Rollback). A constant, not Tuning Data. */
export const ROLLBACK_WINDOW = 15;
/** The host sends a state checksum for every confirmed Tick that is a multiple of this. */
export const CHECKSUM_INTERVAL = 30;
/** Ticks without any message from a Running peer before it counts as disconnected. */
export const DEFAULT_TIMEOUT_TICKS = 300;
/** Time sync: the lead (in Ticks) is averaged over this many Intents messages. */
const LEAD_SAMPLES = 32;
/** Time sync: wait a Tick when the averaged lead over the peer is at least this many Ticks... */
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
  | { readonly type: 'Disconnected'; readonly reason: 'Closed' | 'Timeout' }
  /** Guest only: its state at `tick` hashes differently from the host's. A resync follows. */
  | { readonly type: 'Desync'; readonly tick: number; readonly localHash: string; readonly hostHash: string }
  /** Guest only: replaced its state with the host's state at `tick` and re-simulated forward. */
  | { readonly type: 'Resynced'; readonly tick: number };

export interface TickResult {
  /** The Match advanced by one Tick. */
  readonly advanced: boolean;
  /** Running, but waiting for the peer's Intents: the window is full. */
  readonly stalled: boolean;
  /** Running, but holding back a Tick for time sync: this peer runs ahead of the other. */
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
  readonly transport: Transport;
  readonly tuning: TuningData;
  /** Host only: the Match to play (its `weapons` and `teams` come from the Lineup and the two peers' picks). The guest receives it at connect. */
  readonly match?: MatchOptions;
  /** Host only: who fights (default ONE_VS_ONE). The guest receives it at connect. */
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
  /** The Fighter this peer controls (its Player's slot in the Lineup); -1 until the Match is built. */
  readonly localFighter: number;
  /** Who fights; null until the guest has it from the host. */
  readonly lineup: Lineup | null;
  /** The Remote Controller driving the peer's Fighter: its Intents for the Tick being simulated, real or predicted. */
  readonly remote: Controller;
  readonly status: SessionStatus;
  /** The current (possibly predicted) Match state; null until Running. Render this. */
  readonly state: MatchState | null;
  /** The Tick of `state` (0 until Running). */
  readonly currentTick: number;
  /** The last Tick for which both Fighters' real Intents are known. */
  readonly confirmedTick: number;
  readonly stats: SessionStats;
  /** Advance one Tick with this peer's local Intent (ignored while stalled or not Running). */
  tick(localIntent: Intent): TickResult;
  /** The state hash this peer recorded for a confirmed checksum Tick (a multiple of CHECKSUM_INTERVAL), if any. */
  checksumAt(tick: number): string | undefined;
  onEvent(listener: (event: SessionEvent) => void): void;
  /** Close the Transport (the peer sees a disconnect). */
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

class Session implements RollbackSession, PeerIntentSource {
  readonly role: SessionRole;
  localFighter = -1;
  /** The Fighter the peer controls; -1 until the Match is built. */
  private remoteFighter = -1;
  readonly remote: Controller = createRemoteController(this);
  status: SessionStatus = 'Connecting';
  state: MatchState | null = null;
  stats = { rollbacks: 0, maxRollback: 0, stalls: 0, waits: 0, resyncs: 0 };

  private readonly transport: Transport;
  private readonly tuning: TuningData;
  private readonly tuningHash: string;
  private readonly matchOptions: MatchOptions | undefined;
  /** Host: from the options; guest: from the host's hello. */
  lineup: Lineup | null;
  /** An AI Controller per AI Fighter (null for the Players' Fighters). */
  private ais: (Controller | null)[] = [];
  /** Each AI Controller's memory after each simulated Tick, from the confirmed Tick on (null for the Players' Fighters). */
  private readonly aiMemory = new Map<number, unknown[]>();
  /** This peer's Weapon pick. */
  private readonly weapon: string;
  private readonly timeoutTicks: number;
  private readonly stepFn: typeof stepMatch;
  private readonly listeners: ((e: SessionEvent) => void)[] = [];
  private inbox: NetMessage[] = [];

  /** Snapshots from the confirmed Tick up to the current Tick. */
  private readonly states = new Map<number, Snapshot<MatchState>>();
  private readonly localIntents = new Map<number, Intent>();
  private readonly remoteIntents = new Map<number, Intent>();
  /** The remote Intent each simulated Tick actually used (real or predicted). */
  private readonly usedRemote = new Map<number, Intent>();
  /** Last Tick up to which all real remote Intents are held. */
  private remoteConfirmed = 0;
  /** Last Tick up to which the peer holds all our Intents. */
  private peerAck = 0;
  /** Earliest Tick simulated with a wrong prediction, pending Rollback. */
  private rollbackFrom: number | null = null;
  /** The Tick being simulated right now, if any (what the Remote Controller is asked about). */
  private simulating: number | null = null;
  private readonly hashes = new Map<number, string>();
  private readonly hostChecksums = new Map<number, string>();
  private lastHashed = 0;
  /** Guest: checksums at or before this Tick predate the last resync. */
  private resyncedAt = -1;
  private awaitingResync = false;
  private heardIntents = false;
  private helloCountdown = 0;
  private silentTicks = 0;
  /** Time sync: recent estimates of how many Ticks this peer runs ahead of the other. */
  private readonly leads: number[] = [];
  private ticksSinceWait = 0;

  constructor(o: RollbackSessionOptions) {
    this.role = o.role;
    this.transport = o.transport;
    this.tuning = o.tuning;
    this.tuningHash = tuningDataHash(o.tuning);
    this.timeoutTicks = o.timeoutTicks ?? DEFAULT_TIMEOUT_TICKS;
    this.stepFn = o.step ?? stepMatch;
    if (o.role === 'host' && !o.match) throw new Error('The host must choose the Match options');
    this.matchOptions = o.match;
    this.lineup = o.role === 'host' ? (o.lineup ?? ONE_VS_ONE) : null;
    if (this.lineup) checkLineup(o.tuning, this.lineup, 2);
    this.weapon = o.weapon ?? defaultWeaponName(o.tuning);
    if (!o.tuning.weapons[this.weapon]) throw new Error(`Unknown Weapon "${this.weapon}"`);
    o.transport.onMessage((m) => {
      const message = parseNetMessage(m);
      if (message) this.inbox.push(message);
    });
    o.transport.onClose(() => this.disconnect('Closed'));
    this.sendHello();
  }

  get currentTick(): number {
    return this.state?.tick ?? 0;
  }

  get confirmedTick(): number {
    return Math.min(this.currentTick, this.remoteConfirmed);
  }

  onEvent(listener: (event: SessionEvent) => void): void {
    this.listeners.push(listener);
  }

  checksumAt(tick: number): string | undefined {
    return this.hashes.get(tick);
  }

  close(): void {
    this.transport.close();
  }

  tick(localIntent: Intent): TickResult {
    const inbox = this.inbox;
    this.inbox = [];
    if (inbox.length > 0) this.silentTicks = 0;
    for (const m of inbox) this.handle(m);
    if (this.status === 'Connecting' && --this.helloCountdown <= 0) this.sendHello();
    if (this.status !== 'Running') return NOTHING;

    if (++this.silentTicks > this.timeoutTicks) {
      this.disconnect('Timeout');
      return NOTHING;
    }
    if (!this.heardIntents && --this.helloCountdown <= 0) this.sendHello();

    const rolledBack = this.rollback();
    const next = this.currentTick + 1;
    const stalled = next - this.remoteConfirmed > ROLLBACK_WINDOW;
    const waited = !stalled && this.shouldWait();
    if (stalled) {
      this.stats.stalls++;
    } else if (waited) {
      this.stats.waits++;
    } else {
      this.localIntents.set(next, localIntent);
      this.simulateNext();
    }
    this.recordConfirmed();
    this.sendIntents();
    return { advanced: !stalled && !waited, stalled, waited, rolledBack };
  }

  // --- Time sync ---

  /**
   * Record how far ahead of the peer this peer runs, from an Intents message: the peer's Tick when it sent it
   * (its Intents run up to it), the last of our Ticks it held then (`ack`), and our Tick now. Each side's raw
   * advantage includes the one-way latency; half their difference is the true lead, with the latency cancelled.
   */
  private sampleLead(from: number, count: number, ack: number): void {
    const peerTick = from + count - 1;
    const localAdvantage = this.currentTick - peerTick;
    const peerAdvantage = peerTick - ack;
    this.leads.push((localAdvantage - peerAdvantage) / 2);
    if (this.leads.length > LEAD_SAMPLES) this.leads.shift();
  }

  /** Hold back this Tick to let the peer catch up? Only the peer that is ahead ever waits. */
  private shouldWait(): boolean {
    this.ticksSinceWait++;
    if (this.leads.length < LEAD_SAMPLES / 2 || this.ticksSinceWait < WAIT_SPACING) return false;
    const lead = this.leads.reduce((a, b) => a + b, 0) / this.leads.length;
    if (lead < LEAD_TO_WAIT) return false;
    this.ticksSinceWait = 0;
    // Our own Tick count drops at once; the peer's view of it reaches us a round trip later. Don't count this wait twice.
    for (let i = 0; i < this.leads.length; i++) this.leads[i]! -= 1;
    return true;
  }

  // --- Simulation ---

  private simulateNext(): void {
    const prev = this.state!;
    const t = prev.tick + 1;
    const local = this.localIntents.get(t) ?? IDLE_INTENT;
    this.simulating = t;
    const remote = this.remote.intent(prev.duel, this.remoteFighter);
    this.simulating = null;
    this.usedRemote.set(t, remote);
    const intents = this.ais.map((ai, i) => (i === this.localFighter ? local : i === this.remoteFighter ? remote : ai!.intent(prev.duel, i)));
    this.state = this.stepFn(prev, intents, this.tuning);
    this.states.set(t, snapshot(this.state));
    this.aiMemory.set(t, this.saveAis());
  }

  private saveAis(): unknown[] {
    return this.ais.map((ai) => ai?.save?.() ?? null);
  }

  private loadAis(memory: readonly unknown[]): void {
    this.ais.forEach((ai, i) => ai?.load?.(memory[i]));
  }

  /** The peer's Intent for the Tick being simulated (or the next one): real once it has arrived, else the last real one repeated. */
  peerIntent(): Intent {
    const t = this.simulating ?? this.currentTick + 1;
    return this.remoteIntents.get(Math.min(t, this.remoteConfirmed)) ?? IDLE_INTENT;
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
      if (this.role === 'host') this.send({ type: 'checksum', tick: k, hash });
      else this.compareChecksum(k);
    }
    this.lastHashed = Math.max(this.lastHashed, confirmed);
    pruneTicks(this.states, (t) => t < confirmed);
    pruneTicks(this.aiMemory, (t) => t < confirmed);
    const old = confirmed - HISTORY_TICKS;
    for (const map of [this.localIntents, this.remoteIntents, this.usedRemote, this.hashes, this.hostChecksums]) pruneTicks(map, (t) => t < old);
  }

  // --- Messages ---

  private send(m: NetMessage): void {
    this.transport.send(m);
  }

  private sendHello(): void {
    this.helloCountdown = HELLO_INTERVAL;
    const hello = { type: 'hello', protocol: PROTOCOL_VERSION, tuningHash: this.tuningHash, weapon: this.weapon } as const;
    if (this.role === 'guest') return this.send(hello);
    // The Match options without Weapons or teams: each peer adds them from the Lineup and both picks.
    const { weapons: _picks, teams: _teams, ...match } = this.matchOptions!;
    this.send({ ...hello, match, lineup: this.lineup! });
  }

  private sendIntents(): void {
    const from = this.peerAck + 1;
    const intents: Intent[] = [];
    for (let t = from; this.localIntents.has(t); t++) intents.push(this.localIntents.get(t)!);
    this.send({ type: 'intents', from, intents, ack: this.remoteConfirmed });
  }

  private handle(m: NetMessage): void {
    if (this.status === 'Refused' || this.status === 'Disconnected') return;
    switch (m.type) {
      case 'hello':
        return this.onHello(m.protocol, m.tuningHash, m.weapon, m.match, m.lineup);
      case 'refuse':
        return this.refuse(m.reason, m.tuningHash, false);
      case 'intents':
        if (this.status !== 'Running') return;
        this.heardIntents = true;
        this.peerAck = Math.max(this.peerAck, Math.min(m.ack, this.currentTick)); // it cannot hold Intents we have not made yet
        this.sampleLead(m.from, m.intents.length, Math.min(m.ack, this.currentTick));
        return this.receiveIntents(m.from, m.intents, true);
      case 'checksum':
        if (this.role === 'guest' && this.status === 'Running' && m.tick > this.resyncedAt) {
          this.hostChecksums.set(m.tick, m.hash);
          this.compareChecksum(m.tick);
        }
        return;
      case 'resyncRequest':
        if (this.role === 'host' && this.status === 'Running') this.sendResync();
        return;
      case 'resync':
        if (this.role === 'guest' && this.status === 'Running') this.applyResync(m.tick, m.state, m.ai, m.intentsFrom, m.intents);
        return;
    }
  }

  private onHello(protocol: number, remoteHash: string, weapon: string | undefined, match: MatchOptions | undefined, lineup: Lineup | undefined): void {
    if (protocol !== PROTOCOL_VERSION) return this.refuse('ProtocolMismatch', remoteHash, true);
    if (remoteHash !== this.tuningHash) return this.refuse('TuningDataMismatch', remoteHash, true);
    if (weapon !== undefined && !this.tuning.weapons[weapon]) return this.refuse('TuningDataMismatch', remoteHash, true);
    if (this.status !== 'Connecting' || weapon === undefined) return;
    const options = this.role === 'host' ? this.matchOptions : match;
    const fighting = this.role === 'host' ? this.lineup : (lineup ?? null);
    if (!options || !fighting) return;
    try {
      checkLineup(this.tuning, fighting, 2);
    } catch {
      return this.refuse('TuningDataMismatch', remoteHash, true);
    }
    this.lineup = fighting;
    this.localFighter = playerFighter(fighting, this.role === 'host' ? 0 : 1);
    this.remoteFighter = playerFighter(fighting, this.role === 'host' ? 1 : 0);
    this.ais = lineupAis(this.tuning, fighting);
    // The host is Player 0: its pick comes first on both peers.
    const picks = this.role === 'host' ? [this.weapon, weapon] : [weapon, this.weapon];
    this.state = createMatch(this.tuning, lineupMatch(this.tuning, fighting, picks, options));
    this.states.set(0, snapshot(this.state));
    this.aiMemory.set(0, this.saveAis());
    this.status = 'Running';
    this.silentTicks = 0;
    this.emit({ type: 'Connected' });
  }

  private refuse(reason: RefuseReason, remoteHash: string, tellPeer: boolean): void {
    if (this.status === 'Refused') return;
    this.status = 'Refused';
    if (tellPeer) this.send({ type: 'refuse', reason, tuningHash: this.tuningHash });
    this.emit({ type: 'Refused', reason, localHash: this.tuningHash, remoteHash });
  }

  private disconnect(reason: 'Closed' | 'Timeout'): void {
    if (this.status === 'Refused' || this.status === 'Disconnected') return;
    this.status = 'Disconnected';
    this.emit({ type: 'Disconnected', reason });
    if (reason === 'Timeout') this.transport.close();
  }

  /** Take real remote Intents for Ticks from `from` on; mark a Rollback where a used prediction was wrong. */
  private receiveIntents(from: number, intents: readonly Intent[], checkPredictions: boolean): void {
    for (let i = 0; i < intents.length; i++) {
      const t = from + i;
      if (t <= this.remoteConfirmed) continue;
      if (t !== this.remoteConfirmed + 1) break;
      const intent = intents[i]!;
      this.remoteIntents.set(t, intent);
      this.remoteConfirmed = t;
      const used = this.usedRemote.get(t);
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
    this.send({ type: 'resyncRequest', tick });
  }

  /** Host: send the confirmed state, plus our Intents the guest may still lack up to it. */
  private sendResync(): void {
    const tick = this.confirmedTick;
    const intentsFrom = this.peerAck + 1;
    const intents: Intent[] = [];
    for (let t = intentsFrom; t <= tick; t++) intents.push(this.localIntents.get(t)!);
    this.send({ type: 'resync', tick, state: restore(this.states.get(tick)!), ai: this.aiMemory.get(tick)!, intentsFrom, intents });
    this.stats.resyncs++;
  }

  /** Guest: adopt the host's state (and its AI Controllers' memory) at `tick` and re-simulate up to the current Tick. */
  private applyResync(tick: number, state: MatchState, ai: readonly unknown[], intentsFrom: number, intents: readonly Intent[]): void {
    if (!this.awaitingResync || tick <= this.resyncedAt || tick > this.currentTick) return;
    // parseNetMessage checked the shape; only Tuning Data can tell whether its Weapons and Motions exist, and only the Lineup who fights.
    if (!state.duel.fighters.every((f) => this.tuning.weapons[f.weapon] && weaponMotion(this.tuning, f.weapon, f.motion.name))) return;
    if (!state.config.weapons.every((w) => this.tuning.weapons[w])) return;
    const teams = this.lineup!.map((s) => s.team);
    if (state.config.teams.length !== teams.length || !state.config.teams.every((t, i) => t === teams[i])) return;
    if (state.duel.fighters.length !== teams.length || ai.length !== teams.length || !ai.every((m, i) => (m === null) === (this.ais[i] === null))) return;
    this.receiveIntents(intentsFrom, intents, false);
    if (this.remoteConfirmed < tick) return;
    for (let t = tick + 1; t <= this.currentTick; t++) if (!this.localIntents.has(t)) return;
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
