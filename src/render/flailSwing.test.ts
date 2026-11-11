/**
 * The flail's swinging ball (drawing only): it lags behind and swings out as the shaft's end moves, settles back to hanging, never goes
 * past the chain's reach, follows the drawn chain where it is not free, and starts afresh on a jump.
 */
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../sim';
import { loadTuningData, weaponByName } from '../tuning';
import { chainLinks, type FlailChain } from './flailChain';
import { FlailSwing } from './flailSwing';

const w = weaponByName(loadTuningData(), 'Flail');
const REACH = 0.4;
const FRAME = 1 / 60;
const TICKS_PER_FRAME = 0.5;

/** A chain hanging straight down from `end`, free by `weight`, drawn at `ball` (default: hanging). */
function chain(end: Vec3, weight = 1, ball: Vec3 = { x: end.x, y: end.y - REACH, z: end.z }): FlailChain {
  return { ball, links: chainLinks(end, ball, w, REACH), free: { weight, end, reach: REACH, floor: -10 } };
}
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Run `frames` frames with the shaft's end at `endAt(k)`, returning each frame's drawn ball. */
function run(swing: FlailSwing, frames: number, endAt: (k: number) => Vec3, weight = 1, start = 0): Vec3[] {
  const out: Vec3[] = [];
  for (let k = 0; k < frames; k++) out.push(swing.step(chain(endAt(k), weight), w, FRAME, (start + k) * TICKS_PER_FRAME).ball);
  return out;
}

describe('FlailSwing', () => {
  it('starts where the chain draws the ball, and stays put while the hand is still', () => {
    const swing = new FlailSwing();
    const end = { x: 0, y: 1, z: 0 };
    for (const ball of run(swing, 60, () => end)) expect(dist(ball, { x: 0, y: 1 - REACH, z: 0 })).toBeLessThan(1e-6);
  });

  it('lags behind a hand that starts moving, then settles back under it', () => {
    const swing = new FlailSwing();
    // Still, then walking at 2 m/s along +x for half a second, then still again.
    const x = (k: number): number => (k < 10 ? 0 : 2 * FRAME * Math.min(k - 10, 30));
    const balls = run(swing, 220, (k) => ({ x: x(k), y: 1, z: 0 }));
    // Moving off, the ball trails behind the hand.
    expect(balls[20]!.x).toBeLessThan(x(20) - 0.02);
    // On stopping it swings past, then dies away to hanging.
    const past = Math.max(...balls.slice(40, 120).map((b) => b.x - x(40)));
    expect(past).toBeGreaterThan(0.02);
    const last = balls[balls.length - 1]!;
    expect(dist(last, { x: x(219), y: 1 - REACH, z: 0 })).toBeLessThan(0.01);
  });

  it('never goes past the chain, and goes slack when jerked toward the shaft', () => {
    const swing = new FlailSwing();
    // Jerked up hard: the ball cannot follow at once, so it falls inside the chain's reach.
    const balls = run(swing, 40, (k) => ({ x: 0, y: k < 5 ? 1 : 1 + Math.min(k - 5, 4) * 0.08, z: 0 }));
    balls.forEach((b, k) => expect(dist(b, { x: 0, y: k < 5 ? 1 : 1 + Math.min(k - 5, 4) * 0.08, z: 0 })).toBeLessThanOrEqual(REACH + 1e-9));
    expect(Math.min(...balls.slice(5, 12).map((b, k) => dist(b, { x: 0, y: 1 + Math.min(k, 4) * 0.08, z: 0 })))).toBeLessThan(REACH - 0.05);
  });

  it('is where the drawn chain has it when not free', () => {
    const swing = new FlailSwing();
    const end = { x: 0, y: 1, z: 0 };
    const whirled = { x: 0.3, y: 1.2, z: 0.1 };
    run(swing, 5, () => end);
    expect(swing.step(chain(end, 0, whirled), w, FRAME, 3).ball).toEqual(whirled);
  });

  it('carries a swing on when it is freed', () => {
    const swing = new FlailSwing();
    const end = { x: 0, y: 1, z: 0 };
    // The drawn ball sweeps along +x on the tip, not free, then is freed at once.
    for (let k = 0; k < 10; k++) swing.step(chain(end, 0, { x: -REACH + k * 0.05, y: 1, z: 0 }), w, FRAME, k * TICKS_PER_FRAME);
    const freed = swing.step(chain(end), w, FRAME, 10 * TICKS_PER_FRAME).ball;
    // Not dropped straight to hanging: it carries on along +x.
    expect(freed.x).toBeGreaterThan(-REACH + 9 * 0.05);
  });

  it('starts afresh after a jump in Ticks or a long frame', () => {
    const swing = new FlailSwing();
    run(swing, 20, (k) => ({ x: k * 0.05, y: 1, z: 0 }));
    const end = { x: 5, y: 1, z: 0 };
    expect(swing.step(chain(end), w, FRAME, 200).ball).toEqual({ x: 5, y: 1 - REACH, z: 0 });
    run(swing, 5, () => end, 1, 400);
    const far = { x: 9, y: 1, z: 0 };
    expect(swing.step(chain(far), w, 1, 405 * TICKS_PER_FRAME).ball).toEqual({ x: 9, y: 1 - REACH, z: 0 });
  });

  it('draws a chain that is not free at all as it is', () => {
    const swing = new FlailSwing();
    const sheathed: FlailChain = { ball: { x: 1, y: 2, z: 3 }, links: [] };
    expect(swing.step(sheathed, w, FRAME, 0)).toBe(sheathed);
  });
});
