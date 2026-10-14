import { describe, expect, it } from 'vitest';
import { createMemoryTransportPair } from './memoryTransport';

function collect(pairOpts: Parameters<typeof createMemoryTransportPair>[0]) {
  const pair = createMemoryTransportPair(pairOpts);
  const got: unknown[] = [];
  pair.b.onMessage((m) => got.push(m));
  return { pair, got };
}

describe('in-memory Transport pair', () => {
  it('delivers a copy of each message after the latency', () => {
    const { pair, got } = collect({ latencyMs: 50 });
    const msg = { n: 1 };
    pair.a.send(msg);
    msg.n = 2;
    pair.advance(49);
    expect(got).toEqual([]);
    pair.advance(1);
    expect(got).toEqual([{ n: 1 }]);
  });

  it('drops roughly the configured fraction of packets, reproducibly per seed', () => {
    const run = () => {
      const { pair, got } = collect({ latencyMs: 0, loss: 0.25, seed: 3 });
      for (let i = 0; i < 1000; i++) pair.a.send(i);
      pair.advance(1);
      return got;
    };
    const got = run();
    expect(got.length).toBeGreaterThan(700);
    expect(got.length).toBeLessThan(800);
    expect(run()).toEqual(got);
  });

  it('jitter can reorder messages but each arrives within latency + jitter', () => {
    const { pair, got } = collect({ latencyMs: 20, jitterMs: 30, seed: 1 });
    for (let i = 0; i < 50; i++) pair.a.send(i);
    pair.advance(19);
    expect(got).toEqual([]);
    pair.advance(31);
    expect([...got].sort((x, y) => (x as number) - (y as number))).toEqual([...Array(50).keys()]);
    expect(got).not.toEqual([...Array(50).keys()]);
  });

  it('closing either end fires onClose on both ends and stops delivery', () => {
    const { pair, got } = collect({ latencyMs: 10 });
    const closed: string[] = [];
    pair.a.onClose(() => closed.push('a'));
    pair.b.onClose(() => closed.push('b'));
    pair.a.send('lost');
    pair.b.close();
    pair.advance(100);
    pair.a.send('after');
    pair.advance(100);
    expect(closed.sort()).toEqual(['a', 'b']);
    expect(got).toEqual([]);
  });
});
