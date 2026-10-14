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
 * Wrap a PeerJS DataConnection as a Transport for the Rollback session.
 *
 * The connection should be opened with `serialization: 'json'`. A connection
 * error is treated as the connection closing. `onClose` fires exactly once,
 * whether the peer or we closed it; `cleanup` (e.g. destroying the Peer) runs then too.
 */
export function createPeerTransport(conn: DataConnectionLike, cleanup?: () => void): Transport {
  let messageHandler: ((message: unknown) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  let closed = false;

  const closedNow = () => {
    if (closed) return;
    closed = true;
    closeHandler?.();
    cleanup?.();
  };

  conn.on('data', (data) => {
    if (!closed) messageHandler?.(data);
  });
  conn.on('close', closedNow);
  conn.on('error', closedNow);

  return {
    send(message) {
      if (closed || !conn.open) return;
      try {
        void conn.send(message);
      } catch {
        // The data channel went away under us; the close event follows.
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
