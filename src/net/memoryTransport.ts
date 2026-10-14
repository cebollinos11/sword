import type { Transport } from './transport';

export interface MemoryTransportOptions {
  /** One-way delay in ms before a message can arrive. Default 0. */
  readonly latencyMs?: number;
  /** Extra one-way delay, uniform in [0, jitterMs], per message. Can reorder messages. Default 0. */
  readonly jitterMs?: number;
  /** Probability in [0, 1] that a message is dropped. Default 0. */
  readonly loss?: number;
  /** Seeds the jitter/loss generator, so a run is reproducible. Default 1. */
  readonly seed?: number;
}

/** Two connected Transport ends on a virtual clock that only moves with `advance`. */
export interface MemoryTransportPair {
  readonly a: Transport;
  readonly b: Transport;
  /** Move the virtual clock forward and deliver every message that is due, in arrival order. */
  advance(ms: number): void;
}

interface InFlight {
  readonly at: number;
  readonly seq: number;
  readonly to: End;
  readonly data: string;
}

interface End extends Transport {
  handler: ((message: unknown) => void) | null;
  closeHandler: (() => void) | null;
}

/** mulberry32: a tiny seeded generator, so loss and jitter are reproducible. */
function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An in-memory Transport pair for headless tests, with configurable latency,
 * jitter and packet loss. Messages are copied through JSON (as on the wire).
 */
export function createMemoryTransportPair(options: MemoryTransportOptions = {}): MemoryTransportPair {
  const latency = options.latencyMs ?? 0;
  const jitter = options.jitterMs ?? 0;
  const loss = options.loss ?? 0;
  const random = generator(options.seed ?? 1);
  let now = 0;
  let seq = 0;
  let closed = false;
  let queue: InFlight[] = [];

  const close = () => {
    if (closed) return;
    closed = true;
    queue = [];
    for (const end of [a, b]) end.closeHandler?.();
  };

  const makeEnd = (peer: () => End): End => ({
    handler: null,
    closeHandler: null,
    send(message) {
      if (closed) return;
      const dropped = random() < loss;
      const delay = latency + random() * jitter;
      if (!dropped) queue.push({ at: now + delay, seq: seq++, to: peer(), data: JSON.stringify(message) });
    },
    onMessage(handler) {
      this.handler = handler;
    },
    onClose(handler) {
      this.closeHandler = handler;
    },
    close,
  });

  const a: End = makeEnd(() => b);
  const b: End = makeEnd(() => a);

  return {
    a,
    b,
    advance(ms) {
      now += ms;
      for (;;) {
        if (closed) return;
        const due = queue.filter((m) => m.at <= now);
        if (due.length === 0) return;
        due.sort((x, y) => x.at - y.at || x.seq - y.seq);
        const next = due[0]!;
        queue = queue.filter((m) => m !== next);
        next.to.handler?.(JSON.parse(next.data));
      }
    },
  };
}
