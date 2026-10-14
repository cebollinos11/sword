/**
 * Transport: the only thing the Rollback session talks through.
 *
 * A message is any JSON-serialisable value. Delivery may be late, out of order
 * or lost (the session copes with all three); `onClose` fires once when the
 * connection to the peer is gone, whichever side closed it.
 *
 * Production: PeerJS DataConnection (#23). Tests: `createMemoryTransportPair`.
 */
export interface Transport {
  /** Send one JSON-serialisable message to the peer. A no-op once closed. */
  send(message: unknown): void;
  /** Register the handler for messages from the peer (one handler; a later call replaces it). */
  onMessage(handler: (message: unknown) => void): void;
  /** Register the handler for the connection closing (one handler; a later call replaces it). */
  onClose(handler: () => void): void;
  /** Close the connection. Both ends' `onClose` handlers fire. */
  close(): void;
}
