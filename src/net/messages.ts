import type { Intent, MatchOptions, MatchState } from '../sim';

/** Bumped whenever the wire format changes; peers with different protocols refuse each other. */
export const PROTOCOL_VERSION = 1;

/** Sent repeatedly while connecting. The host's hello carries the Match options. */
export interface HelloMessage {
  readonly type: 'hello';
  readonly protocol: number;
  readonly tuningHash: string;
  readonly match?: MatchOptions;
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
export interface InputMessage {
  readonly type: 'input';
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
 * Host → guest: the host's confirmed Match state at `tick`, plus the host's own
 * Intents from `inputsFrom` to `tick` that the guest may not have yet.
 */
export interface ResyncMessage {
  readonly type: 'resync';
  readonly tick: number;
  readonly state: MatchState;
  readonly inputsFrom: number;
  readonly inputs: readonly Intent[];
}

export type RefuseReason = 'TuningDataMismatch' | 'ProtocolMismatch';

export type NetMessage = HelloMessage | RefuseMessage | InputMessage | ChecksumMessage | ResyncRequestMessage | ResyncMessage;

const TYPES: ReadonlySet<string> = new Set(['hello', 'refuse', 'input', 'checksum', 'resyncRequest', 'resync']);

/** Narrow an incoming Transport message; anything unrecognised is ignored by the session. */
export function isNetMessage(m: unknown): m is NetMessage {
  return typeof m === 'object' && m !== null && TYPES.has((m as { type?: unknown }).type as string);
}
