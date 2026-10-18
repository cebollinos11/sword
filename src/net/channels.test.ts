import { describe, expect, it } from 'vitest';
import { createMemoryTransportPair } from './memoryTransport';
import { splitTransport } from './channels';

function pair() {
  const link = createMemoryTransportPair();
  return { link, a: splitTransport(link.a), b: splitTransport(link.b) };
}

describe('Channels', () => {
  it('keeps the Room channel and a Match channel apart', () => {
    const { link, a, b } = pair();
    const room: unknown[] = [];
    const match: unknown[] = [];
    b.room.onMessage((m) => room.push(m));
    b.match(1).onMessage((m) => match.push(m));
    a.room.send('lobby');
    a.match(1).send('intents');
    link.advance(1);
    expect(room).toEqual(['lobby']);
    expect(match).toEqual(['intents']);
  });

  it('closing a Match channel detaches it but keeps the link', () => {
    const { link, a, b } = pair();
    let matchClosed = 0;
    let roomClosed = 0;
    const m1 = a.match(1);
    m1.onClose(() => matchClosed++);
    a.room.onClose(() => roomClosed++);
    m1.close();
    expect(matchClosed).toBe(1);
    expect(a.closed).toBe(false);
    const room: unknown[] = [];
    b.room.onMessage((m) => room.push(m));
    a.room.send('still here');
    link.advance(1);
    expect(room).toEqual(['still here']);
    expect(roomClosed).toBe(0);
  });

  it('drops an older generation and keeps an early one until it is attached', () => {
    const { link, a, b } = pair();
    const got: unknown[] = [];
    b.match(2).onMessage((m) => got.push(['g2', m]));
    a.match(1).send('stale');
    a.match(3).send('early');
    link.advance(1);
    expect(got).toEqual([]);
    b.match(3).onMessage((m) => got.push(['g3', m]));
    expect(got).toEqual([['g3', 'early']]);
  });

  it('attaching a newer generation detaches the older one', () => {
    const { a } = pair();
    let closed = 0;
    a.match(1).onClose(() => closed++);
    a.match(2);
    expect(closed).toBe(1);
  });

  it('closing the Room channel closes the link and every channel, on both ends', () => {
    const { a, b } = pair();
    let matchClosed = 0;
    let peerRoomClosed = 0;
    b.match(1).onClose(() => matchClosed++);
    b.room.onClose(() => peerRoomClosed++);
    a.room.close();
    expect(b.closed).toBe(true);
    expect(matchClosed).toBe(1);
    expect(peerRoomClosed).toBe(1);
  });
});
