import { describe, expect, it } from 'vitest';
import { MainThreadLag } from './mainThreadLag';

describe('the main-thread lag meter', () => {
  it('is the average wait of a message arriving at a random moment: Σd² / 2T over each window', () => {
    const lag = new MainThreadLag();
    // A 60 Hz page whose every frame works 4 ms: a message waits 4² / (2 · 16.7) ≈ 0.5 ms.
    for (let t = 0; t <= 1000; t += 1000 / 60) lag.work(t, t + 4);
    expect(lag.estimate).toBeCloseTo(16 / (2 * (1000 / 60)), 0);
  });

  it('one long stall a second counts far more than its share of the time', () => {
    const lag = new MainThreadLag();
    // 2 ms frames, but one of 100 ms each second: a message waits ~5 ms on average, not ~0.1.
    for (let t = 0; t <= 1100; t += 20) lag.work(t, t + (t === 500 ? 100 : 2));
    expect(lag.estimate).toBeGreaterThan(4);
    expect(lag.estimate).toBeLessThan(6);
  });

  it('is 0 until a window has passed', () => {
    const lag = new MainThreadLag();
    lag.work(0, 50);
    expect(lag.estimate).toBe(0);
  });
});
