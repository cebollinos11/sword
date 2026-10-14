import { createInitialState, step, TICK_SECONDS, type Intent, type SimState } from './sim';
import type { TuningData } from './tuning';
import { Renderer } from './render/renderer';

/** Never simulate more than this many Ticks in one rendered frame (e.g. after a background tab). */
const MAX_TICKS_PER_FRAME = 8;

/**
 * The game route: owns the wall clock and the fixed-Tick loop. The Simulation
 * is stepped at exactly TICK_RATE; the Renderer interpolates between Ticks.
 */
export function startGame(container: HTMLElement, tuning: TuningData): void {
  const renderer = new Renderer(container, tuning);

  let prev: SimState = createInitialState(tuning, 1);
  let curr: SimState = prev;
  let accumulator = 0;
  let last = performance.now();

  // Controllers arrive in later tickets; for now the lone Fighter stands Idle.
  const intents: Intent[] = [];

  function frame(now: number): void {
    accumulator += Math.min((now - last) / 1000, MAX_TICKS_PER_FRAME * TICK_SECONDS);
    last = now;
    while (accumulator >= TICK_SECONDS) {
      prev = curr;
      curr = step(curr, intents, tuning);
      accumulator -= TICK_SECONDS;
    }
    renderer.render(prev, curr, accumulator / TICK_SECONDS);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
