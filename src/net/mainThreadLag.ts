/**
 * How long a message arriving now waits on this page's main thread before its handler runs: the CPU part of a ping.
 *
 * A ping is answered in the Transport's message handler, which runs only once the main thread is free. While a frame
 * (Ticks, Rollbacks, rendering) takes `d` ms, a message arriving at a random moment in it waits the rest of it, on average
 * `d / 2`; over a window of `T` ms of frames `d1, d2, …` that is Σd² / (2T). Each peer measures its own, and sends it back
 * in its pongs, so the pinging peer can split the round trip into the network's part and the two main threads' part.
 * Cosmetic: never feeds the Simulation.
 */
export class MainThreadLag {
  /** Milliseconds a message waits on average (smoothed over windows of WINDOW_MS). */
  estimate = 0;
  private windowStart: number | null = null;
  private squares = 0;
  private static readonly WINDOW_MS = 1000;

  /** A stretch of main-thread work from `start` to `end` (ms, `performance.now()`), e.g. one animation frame's. */
  work(start: number, end: number): void {
    this.windowStart ??= start;
    const d = Math.max(0, end - start);
    this.squares += d * d;
    const span = end - this.windowStart;
    if (span < MainThreadLag.WINDOW_MS) return;
    const wait = this.squares / (2 * span);
    this.estimate =
      this.estimate === 0 ? wait : this.estimate * 0.5 + wait * 0.5;
    this.windowStart = end;
    this.squares = 0;
  }
}

/** This page's meter: the game loop reports each frame's work to it, and online sessions read it. */
export const mainThreadLag = new MainThreadLag();
