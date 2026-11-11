/**
 * A flail's ball swinging on its chain with the Fighter's inertia, as drawn only. `flailChainOf` is pure and hangs the ball straight
 * down; this keeps a ball's position and velocity from frame to frame, hung on a chain from the shaft's end under gravity, so it lags,
 * swings out and settles as the hand walks, turns, guards and is struck. It takes over only as far as the chain is `free` (hanging),
 * and otherwise follows the drawn ball, carrying its velocity, so a swing's end flows on into the swinging.
 *
 * Holding state, it is not a function of the Tick: scrubbing, a replay and the Final Blow Shot may swing differently. A jump in Ticks
 * (scrubbing, a new Match) or in wall time (a hidden tab) puts the ball back where the drawn chain has it, at rest.
 */
import type { Vec3 } from '../sim';
import { chainLinks, keepOut, type FlailChain } from './flailChain';
import type { WeaponTuning } from '../tuning';

/** Gravity (m/s²). */
const GRAVITY = 16;
/** How fast a swing dies away (1/s): a heavy iron ball, settling in about a second. */
export const SWING_DAMPING = 4.5;
/** The longest step taken at once (s); a longer frame is taken in several. */
const SUBSTEP = 1 / 120;
/** A frame longer than this (s), or a jump of more Ticks than `MAX_TICK_JUMP`, starts the ball afresh. */
const MAX_FRAME = 0.25;
const MAX_TICK_JUMP = 6;
/** The fastest the ball is let move (m/s), so a snap of the drawn ball (a Rollback) does not fling it. */
const MAX_SPEED = 12;

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/** One Fighter's swinging ball. */
export class FlailSwing {
  private ball: Vec3 | undefined;
  private velocity: Vec3 = ZERO;
  private tick = 0;

  /** Forget the ball: the next frame starts it where its chain draws it, at rest. */
  reset(): void {
    this.ball = undefined;
    this.velocity = ZERO;
  }

  /**
   * The chain to draw this frame, `seconds` of Duel time after the last, at Tick `tick` (fractional): `chain` with its ball swung as far
   * as it is free, and its links hung to that ball. A chain that is not free at all (sheathed, absent `free`) is drawn as it is.
   */
  step(chain: FlailChain, w: Pick<WeaponTuning, 'chain' | 'head'>, seconds: number, tick: number): FlailChain {
    const free = chain.free;
    const jumped = Math.abs(tick - this.tick) > MAX_TICK_JUMP || seconds > MAX_FRAME || seconds < 0;
    this.tick = tick;
    if (!free) {
      this.reset();
      return chain;
    }
    if (!this.ball || jumped) {
      this.ball = chain.ball;
      this.velocity = ZERO;
      return chain;
    }
    if (seconds <= 0) return this.drawn(chain, w, this.ball);
    const start = this.ball;
    let p = start;
    let v = this.velocity;
    const steps = Math.max(1, Math.ceil(seconds / SUBSTEP));
    const dt = seconds / steps;
    const fade = Math.exp(-SWING_DAMPING * dt);
    for (let k = 0; k < steps; k++) {
      v = scale({ x: v.x, y: v.y - GRAVITY * dt, z: v.z }, fade);
      let x = add(p, scale(v, dt));
      // The chain only pulls: beyond its reach the ball is brought back onto it (and its outward speed lost); within it, it is slack.
      const out = sub(x, free.end);
      const d = length(out);
      if (d > free.reach) x = add(free.end, scale(out, free.reach / d));
      x = keepOut(x, w, free.floor, free.body, free.size);
      v = scale(sub(x, p), 1 / dt);
      p = x;
    }
    // As far as it is not free, it is where the chain draws it, moving as that does.
    if (free.weight < 1) {
      p = lerp(chain.ball, p, free.weight);
      v = scale(sub(p, start), 1 / seconds);
    }
    const speed = length(v);
    this.velocity = speed > MAX_SPEED ? scale(v, MAX_SPEED / speed) : v;
    this.ball = p;
    return this.drawn(chain, w, p);
  }

  private drawn(chain: FlailChain, w: Pick<WeaponTuning, 'chain' | 'head'>, ball: Vec3): FlailChain {
    const free = chain.free!;
    return { ...chain, ball, links: chainLinks(free.end, ball, w, free.reach) };
  }
}
