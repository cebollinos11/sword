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
 * - Disconnects (Transport closed, or nothing heard for `timeoutTicks`) are surfaced.
 *
 * The host is Fighter 0 and chooses the Match options; the guest is Fighter 1.
 * It talks only through a Transport, and only Intents (plus checksums and the
 * rare resync) cross it. Drive it with `tick(localIntent)` once per Tick.
 */
import { createMatch, hashValue, IDLE_INTENT, restore, snapshot, stepMatch } from '../sim';
import type { Intent, MatchOptions, MatchState, Snapshot } from '../sim';
import { tuningDataHash, type TuningData } from '../tuning';
import { isNetMessage, PROTOCOL_VERSION, type NetMessage, type RefuseReason } from './messages';
import type { Transport } from './transport';

/** The furthest the session runs ahead of the last confirmed Tick (and so the deepest Rollback). A constant, not Tuning Data. */
export const ROLLBACK_WINDOW = 8;
/** The host sends a state checksum for every confirmed Tick that is a multiple of this. */
export const CHECKSUM_INTERVAL = 30;
/** Ticks without any message from a Running peer before it counts as disconnected. */
export const DEFAULT_TIMEOUT_TICKS = 300;
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
  /** Ticks re-simulated by a Rollback this call (0 if none). Never more than ROLLBACK_WINDOW. */
  readonly rolledBack: number;
}

export interface SessionStats {
  readonly rollbacks: number;
  readonly maxRollback: number;
  readonly stalls: number;
  readonly resyncs: number;
}

export interface RollbackSessionOptions {
  readonly role: SessionRole;
  readonly transport: Transport;
  readonly tuning: TuningData;
  /** Host only: the Match to play. The guest receives it at connect. */
  readonly match?: MatchOptions;
  /** Default DEFAULT_TIMEOUT_TICKS. */
  readonly timeoutTicks?: number;
  /** The Tick function. Defaults to `stepMatch`; tests swap it to inject divergence. */
  readonly step?: typeof stepMatch;
}

export interface RollbackSession {
  readonly role: SessionRole;
  /** The Fighter this peer controls: host 0, guest 1. */
  readonly localFighter: number;
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

const NOTHING: TickResult = { advanced: false, stalled: false, rolledBack: 0 };

function sameIntent(a: Intent, b: Intent): boolean {
  return a.move.x === b.move.x && a.move.z === b.move.z && a.direction === b.direction && a.attack === b.attack && a.block === b.block;
}

export function createRollbackSession(options: RollbackSessionOptions): RollbackSession {
  return new Session(options);
}

class Session implements RollbackSession {
  readonly role: SessionRole;
  readonly localFighter: number;
  status: SessionStatus = 'Connecting';
  state: MatchState | null = null;
  stats = { rollbacks: 0, maxRollback: 0, stalls: 0, resyncs: 0 };

  private readonly transport: Transport;
  private readonly tuning: TuningData;
  private readonly tuningHash: string;
  private readonly matchOptions: MatchOptions | undefined;
  private readonly timeoutTicks: number;
  private readonly stepFn: typeof stepMatch;
  private readonly listeners: ((e: SessionEvent) => void)[] = [];
  private inbox: NetMessage[] = [];

  /** Snapshots from the confirmed Tick up to the current Tick. */
  private readonly states = new Map<number, Snapshot<MatchState>>();
  private readonly localInputs = new Map<number, Intent>();
  private readonly remoteInputs = new Map<number, Intent>();
  /** The remote Intent each simulated Tick actually used (real or predicted). */
  private readonly usedRemote = new Map<number, Intent>();
  /** Last Tick up to which all real remote Intents are held. */
  private remoteConfirmed = 0;
  /** Last Tick up to which the peer holds all our Intents. */
  private peerAck = 0;
  /** Earliest Tick simulated with a wrong prediction, pending Rollback. */
  private rollbackFrom: number | null = null;
  private readonly hashes = new Map<number, string>();
  private readonly hostChecksums = new Map<number, string>();
  private lastHashed = 0;
  /** Guest: checksums at or before this Tick predate the last resync. */
  private resyncedAt = -1;
  private awaitingResync = false;
  private heardInputs = false;
  private helloCountdown = 0;
  private silentTicks = 0;

  constructor(o: RollbackSessionOptions) {
    this.role = o.role;
    this.localFighter = o.role === 'host' ? 0 : 1;
    this.transport = o.transport;
    this.tuning = o.tuning;
    this.tuningHash = tuningDataHash(o.tuning);
    this.timeoutTicks = o.timeoutTicks ?? DEFAULT_TIMEOUT_TICKS;
    this.stepFn = o.step ?? stepMatch;
    if (o.role === 'host' && !o.match) throw new Error('The host must choose the Match options');
    this.matchOptions = o.match;
    o.transport.onMessage((m) => {
      if (isNetMessage(m)) this.inbox.push(m);
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
    if (!this.heardInputs && --this.helloCountdown <= 0) this.sendHello();

    const rolledBack = this.rollback();
    const next = this.currentTick + 1;
    const stalled = next - this.remoteConfirmed > ROLLBACK_WINDOW;
    if (stalled) {
      this.stats.stalls++;
    } else {
      this.localInputs.set(next, localIntent);
      this.simulateNext();
    }
    this.recordConfirmed();
    this.sendInputs();
    return { advanced: !stalled, stalled, rolledBack };
  }

  // --- Simulation ---

  private simulateNext(): void {
    const prev = this.state!;
    const t = prev.tick + 1;
    const local = this.localInputs.get(t) ?? IDLE_INTENT;
    const remote = this.remoteInputs.get(Math.min(t, this.remoteConfirmed)) ?? IDLE_INTENT;
    this.usedRemote.set(t, remote);
    const intents = this.localFighter === 0 ? [local, remote] : [remote, local];
    this.state = this.stepFn(prev, intents, this.tuning);
    this.states.set(t, snapshot(this.state));
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
    while (this.currentTick < target) this.simulateNext();
  }

  /** Hash newly confirmed checksum Ticks (host: send them; guest: compare), then drop snapshots older than the confirmed Tick. */
  private recordConfirmed(): void {
    const confirmed = this.confirmedTick;
    for (let k = this.lastHashed + 1; k <= confirmed; k++) {
      if (k % CHECKSUM_INTERVAL !== 0) continue;
      const hash = hashValue(restore(this.states.get(k)!));
      this.hashes.set(k, hash);
      if (this.role === 'host') this.transport.send({ type: 'checksum', tick: k, hash } satisfies NetMessage);
      else this.compareChecksum(k);
    }
    this.lastHashed = Math.max(this.lastHashed, confirmed);
    for (const t of this.states.keys()) if (t < confirmed) this.states.delete(t);
    const old = confirmed - HISTORY_TICKS;
    for (const map of [this.localInputs, this.remoteInputs, this.usedRemote, this.hashes, this.hostChecksums])
      for (const t of map.keys()) if (t < old) map.delete(t);
  }

  // --- Messages ---

  private send(m: NetMessage): void {
    this.transport.send(m);
  }

  private sendHello(): void {
    this.helloCountdown = HELLO_INTERVAL;
    this.send({ type: 'hello', protocol: PROTOCOL_VERSION, tuningHash: this.tuningHash, ...(this.role === 'host' ? { match: this.matchOptions } : {}) });
  }

  private sendInputs(): void {
    const from = this.peerAck + 1;
    const intents: Intent[] = [];
    for (let t = from; this.localInputs.has(t); t++) intents.push(this.localInputs.get(t)!);
    this.send({ type: 'input', from, intents, ack: this.remoteConfirmed });
  }

  private handle(m: NetMessage): void {
    if (this.status === 'Refused' || this.status === 'Disconnected') return;
    switch (m.type) {
      case 'hello':
        return this.onHello(m.protocol, m.tuningHash, m.match);
      case 'refuse':
        return this.refuse(m.reason, m.tuningHash, false);
      case 'input':
        if (this.status !== 'Running') return;
        this.heardInputs = true;
        this.peerAck = Math.max(this.peerAck, m.ack);
        return this.receiveInputs(m.from, m.intents, true);
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
        if (this.role === 'guest' && this.status === 'Running') this.applyResync(m.tick, m.state, m.inputsFrom, m.inputs);
        return;
    }
  }

  private onHello(protocol: number, remoteHash: string, match: MatchOptions | undefined): void {
    if (protocol !== PROTOCOL_VERSION) return this.refuse('ProtocolMismatch', remoteHash, true);
    if (remoteHash !== this.tuningHash) return this.refuse('TuningDataMismatch', remoteHash, true);
    if (this.status !== 'Connecting') return;
    const options = this.role === 'host' ? this.matchOptions : match;
    if (!options) return;
    this.state = createMatch(this.tuning, options);
    this.states.set(0, snapshot(this.state));
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
  private receiveInputs(from: number, intents: readonly Intent[], checkPredictions: boolean): void {
    for (let i = 0; i < intents.length; i++) {
      const t = from + i;
      if (t <= this.remoteConfirmed) continue;
      if (t !== this.remoteConfirmed + 1) break;
      const intent = intents[i]!;
      this.remoteInputs.set(t, intent);
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
    const inputsFrom = this.peerAck + 1;
    const inputs: Intent[] = [];
    for (let t = inputsFrom; t <= tick; t++) inputs.push(this.localInputs.get(t)!);
    this.send({ type: 'resync', tick, state: restore(this.states.get(tick)!), inputsFrom, inputs });
    this.stats.resyncs++;
  }

  /** Guest: adopt the host's state at `tick` and re-simulate up to the current Tick. */
  private applyResync(tick: number, state: MatchState, inputsFrom: number, inputs: readonly Intent[]): void {
    if (!this.awaitingResync || tick <= this.resyncedAt || tick > this.currentTick) return;
    this.receiveInputs(inputsFrom, inputs, false);
    if (this.remoteConfirmed < tick) return;
    for (let t = tick + 1; t <= this.currentTick; t++) if (!this.localInputs.has(t)) return;
    const target = this.currentTick;
    this.states.clear();
    this.states.set(tick, snapshot(state));
    this.resimulate(tick, target);
    this.rollbackFrom = null;
    for (const t of this.hashes.keys()) if (t >= tick) this.hashes.delete(t);
    for (const t of this.hostChecksums.keys()) if (t <= tick) this.hostChecksums.delete(t);
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
