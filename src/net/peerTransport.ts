import type { Transport } from './transport';

/** The part of a PeerJS DataConnection the Transport uses (structural, so tests can fake it). */
export interface DataConnectionLike {
  readonly open: boolean;
  send(data: unknown): unknown;
  close(): void;
  on(event: 'data', handler: (data: unknown) => void): unknown;
  on(event: 'close', handler: () => void): unknown;
  on(event: 'error', handler: (error: unknown) => void): unknown;
}

/**
 * PeerJS refuses a JSON message of 16300 bytes or more ("Message too big for
 * JSON channel"), and a 2v2 resync is bigger than that. Anything over
 * MAX_MESSAGE_BYTES goes as Fragments of at most FRAGMENT_CHARS characters of
 * its JSON text, reassembled by the receiver.
 */
export const MAX_MESSAGE_BYTES = 12_000;
const FRAGMENT_CHARS = 5_000;
/** Incomplete messages kept while their Fragments arrive; older ones count as lost. */
const MAX_PENDING = 4;

interface Fragment {
  type: 'fragment';
  id: number;
  index: number;
  count: number;
  text: string;
}

function isFragment(data: unknown): data is Fragment {
  if (typeof data !== 'object' || data === null) return false;
  const f = data as Partial<Fragment>;
  return (
    f.type === 'fragment' &&
    Number.isInteger(f.id) &&
    Number.isInteger(f.count) &&
    Number.isInteger(f.index) &&
    f.count! > 0 &&
    f.count! <= 1000 &&
    f.index! >= 0 &&
    f.index! < f.count! &&
    typeof f.text === 'string'
  );
}

const encoder = new TextEncoder();

/**
 * Wrap a PeerJS DataConnection as a Transport for the Rollback session.
 *
 * The connection should be opened with `serialization: 'json'`. A connection
 * error is treated as the connection closing. `onClose` fires exactly once,
 * whether the peer or we closed it; `cleanup` (e.g. destroying the Peer) runs then too.
 * Large messages are split into Fragments; losing one loses the whole message,
 * which the Transport contract already allows.
 */
export function createPeerTransport(conn: DataConnectionLike, cleanup?: () => void): Transport {
  let messageHandler: ((message: unknown) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  let closed = false;
  let nextFragmentId = 0;
  const pending = new Map<number, (string | undefined)[]>();

  const closedNow = () => {
    if (closed) return;
    closed = true;
    closeHandler?.();
    cleanup?.();
  };

  const receiveFragment = (f: Fragment) => {
    let parts = pending.get(f.id);
    if (!parts) {
      parts = Array.from<string | undefined>({ length: f.count });
      pending.set(f.id, parts);
      for (const id of pending.keys()) if (pending.size > MAX_PENDING) pending.delete(id);
    }
    if (parts.length !== f.count) return;
    parts[f.index] = f.text;
    if (parts.some((p) => p === undefined)) return;
    pending.delete(f.id);
    let message: unknown;
    try {
      message = JSON.parse(parts.join(''));
    } catch {
      return;
    }
    messageHandler?.(message);
  };

  const sendRaw = (data: unknown) => {
    try {
      void conn.send(data);
    } catch {
      // The data channel went away under us; the close event follows.
    }
  };

  conn.on('data', (data) => {
    if (closed) return;
    if (isFragment(data)) receiveFragment(data);
    else messageHandler?.(data);
  });
  conn.on('close', closedNow);
  conn.on('error', closedNow);

  return {
    send(message) {
      if (closed || !conn.open) return;
      const text = JSON.stringify(message);
      if (encoder.encode(text).length <= MAX_MESSAGE_BYTES) return sendRaw(message);
      const id = nextFragmentId++;
      const count = Math.ceil(text.length / FRAGMENT_CHARS);
      for (let index = 0; index < count; index++) {
        const fragment: Fragment = { type: 'fragment', id, index, count, text: text.slice(index * FRAGMENT_CHARS, (index + 1) * FRAGMENT_CHARS) };
        sendRaw(fragment);
      }
    },
    onMessage(handler) {
      messageHandler = handler;
    },
    onClose(handler) {
      closeHandler = handler;
    },
    close() {
      if (closed) return;
      conn.close();
      closedNow();
    },
  };
}
