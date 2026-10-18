/**
 * Channels: one Transport to a peer (the Room link) split in two, so the Room
 * outlives any one Match.
 *
 * - The Room channel carries the Lobby. Closing it closes the whole link.
 * - Each Match gets its own channel, numbered by its generation (the Lobby
 *   counts Matches up). A Rollback session talks through it as through any
 *   Transport; closing it only detaches that session, the link stays up, so the
 *   host can restart with new settings without anyone reconnecting.
 *
 * Messages of a Match channel nobody holds are dropped, except the latest
 * generation ahead of the attached one: those are kept (a few) until it is
 * attached, since the peer may start that Match a moment before this side does.
 */
import type { Transport } from './transport';

export interface Channels {
  /** The Lobby's channel. `close()` closes the whole link (and so every channel). */
  readonly room: Transport;
  /**
   * The channel of Match `generation` (> 0). Attaching it detaches any older one (its `onClose`
   * fires). Its `close()` detaches it without touching the link.
   */
  match(generation: number): Transport;
  /** The link is closed (by either end). */
  readonly closed: boolean;
}

/** Messages kept for a Match generation the peer started before this side did. */
const MAX_EARLY = 64;

interface MatchChannel extends Transport {
  readonly generation: number;
  handler: ((message: unknown) => void) | null;
  closeHandler: (() => void) | null;
  detached: boolean;
  detach(): void;
}

type Wire = { c: 'r'; m: unknown } | { c: 'm'; g: number; m: unknown };

function isWire(v: unknown): v is Wire {
  if (typeof v !== 'object' || v === null) return false;
  const w = v as Partial<Record<'c' | 'g' | 'm', unknown>>;
  return w.c === 'r' || (w.c === 'm' && Number.isSafeInteger(w.g) && (w.g as number) > 0);
}

export function splitTransport(link: Transport): Channels {
  let roomHandler: ((message: unknown) => void) | null = null;
  let roomCloseHandler: (() => void) | null = null;
  let closed = false;
  let current: MatchChannel | null = null;
  let early: { generation: number; messages: unknown[] } | null = null;

  link.onMessage((raw) => {
    if (!isWire(raw)) return;
    if (raw.c === 'r') return roomHandler?.(raw.m);
    if (current && raw.g === current.generation) return current.handler?.(raw.m);
    if (current && raw.g < current.generation) return;
    if (!early || raw.g > early.generation) early = { generation: raw.g, messages: [] };
    if (raw.g === early.generation && early.messages.length < MAX_EARLY) early.messages.push(raw.m);
  });
  link.onClose(() => {
    if (closed) return;
    closed = true;
    current?.detach();
    current = null;
    roomCloseHandler?.();
  });

  const room: Transport = {
    send(m) {
      link.send({ c: 'r', m } satisfies Wire);
    },
    onMessage(handler) {
      roomHandler = handler;
    },
    onClose(handler) {
      roomCloseHandler = handler;
    },
    close() {
      link.close();
    },
  };

  return {
    room,
    get closed() {
      return closed;
    },
    match(generation) {
      if (!Number.isSafeInteger(generation) || generation < 1) throw new RangeError(`A Match generation is a positive integer, got ${generation}`);
      current?.detach();
      const channel: MatchChannel = {
        generation,
        handler: null,
        closeHandler: null,
        detached: closed,
        send(m) {
          if (!channel.detached) link.send({ c: 'm', g: generation, m } satisfies Wire);
        },
        onMessage(handler) {
          channel.handler = handler;
          // Deliver what arrived before this side attached, once someone listens.
          if (early?.generation === generation) {
            const backlog = early.messages;
            early = null;
            for (const m of backlog) if (!channel.detached) handler(m);
          }
        },
        onClose(handler) {
          channel.closeHandler = handler;
        },
        close() {
          channel.detach();
        },
        detach() {
          if (channel.detached) return;
          channel.detached = true;
          if (current === channel) current = null;
          channel.closeHandler?.();
        },
      };
      if (!closed) current = channel;
      if (early && early.generation <= generation && early.generation !== generation) early = null;
      return channel;
    },
  };
}
