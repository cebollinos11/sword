import { describe, expect, it } from 'vitest';
import { createPeerTransport, type DataConnectionLike } from './peerTransport';

/** A stand-in for a PeerJS DataConnection: records sends, lets the test fire its events. */
function fakeConnection() {
  const handlers: Record<string, ((arg?: unknown) => void)[]> = {};
  const conn = {
    open: true,
    sent: [] as unknown[],
    closed: 0,
    send(data: unknown) {
      this.sent.push(data);
    },
    close() {
      this.closed++;
      this.open = false;
      fire('close');
    },
    on(event: string, handler: (arg?: unknown) => void) {
      (handlers[event] ??= []).push(handler);
    },
  };
  const fire = (event: string, arg?: unknown) => {
    for (const h of handlers[event] ?? []) h(arg);
  };
  return { conn: conn satisfies DataConnectionLike, fire };
}

describe('PeerJS Transport', () => {
  it('sends messages over the open connection and delivers received ones', () => {
    const { conn, fire } = fakeConnection();
    const transport = createPeerTransport(conn);
    const got: unknown[] = [];
    transport.onMessage((m) => got.push(m));
    transport.send({ type: 'hello', n: 1 });
    fire('data', { type: 'intents', from: 1 });
    expect(conn.sent).toEqual([{ type: 'hello', n: 1 }]);
    expect(got).toEqual([{ type: 'intents', from: 1 }]);
  });

  it('a later handler replaces the earlier one', () => {
    const { conn, fire } = fakeConnection();
    const transport = createPeerTransport(conn);
    const first: unknown[] = [];
    const second: unknown[] = [];
    transport.onMessage((m) => first.push(m));
    transport.onMessage((m) => second.push(m));
    fire('data', 1);
    expect(first).toEqual([]);
    expect(second).toEqual([1]);
  });

  it('the peer closing fires onClose once, and later sends are dropped', () => {
    const { conn, fire } = fakeConnection();
    const transport = createPeerTransport(conn);
    let closes = 0;
    transport.onClose(() => closes++);
    conn.open = false;
    fire('close');
    fire('error', new Error('gone'));
    transport.send('late');
    expect(closes).toBe(1);
    expect(conn.sent).toEqual([]);
  });

  it('a connection error counts as the connection closing', () => {
    const { conn, fire } = fakeConnection();
    const transport = createPeerTransport(conn);
    let closes = 0;
    transport.onClose(() => closes++);
    fire('error', new Error('ICE failed'));
    expect(closes).toBe(1);
  });

  it('closing locally closes the connection and fires our own onClose', () => {
    const { conn } = fakeConnection();
    let cleanups = 0;
    const transport = createPeerTransport(conn, () => cleanups++);
    let closes = 0;
    transport.onClose(() => closes++);
    transport.close();
    transport.close();
    expect(conn.closed).toBe(1);
    expect(closes).toBe(1);
    expect(cleanups).toBe(1);
  });

  it('does not send while the data channel is not open yet', () => {
    const { conn } = fakeConnection();
    conn.open = false;
    createPeerTransport(conn).send('early');
    expect(conn.sent).toEqual([]);
  });
});
