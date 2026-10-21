/**
 * Camera Shake: the third-person camera jolts when the player's Fighter is hit, lands a Hit,
 * is kicked down or lands hard. Like impact effects, it lives outside the Simulation and only
 * listens to its events (ADR 0001). Which events shake is pure, and the shake's wobble is a
 * fixed sum of sines rather than random, so the same events always shake the same way.
 */
import type * as THREE from 'three';
import type { SimEvent } from '../sim';

/** Shake (0..1, before squaring) for being Hit... */
const HIT_TAKEN = 0.6;
/** ...for landing a Hit... */
const HIT_DEALT = 0.3;
/** ...for a Heavy Blow taken or dealt (instead of the above)... */
const HEAVY_TAKEN = 0.9;
const HEAVY_DEALT = 0.5;
/** ...for being knocked down by a Kick, and for a Landing that hurts. */
const KNOCKED_DOWN = 0.6;
const HURT_LANDING = 0.6;
/** How fast the shake dies away: per second, so a full shake lasts this many times less than a second. */
const DECAY = 1.6;
/** At full shake (and strength 1): the camera's sway sideways and up (m) and its roll (radians). */
const MAX_OFFSET = 0.2;
const MAX_ROLL = 0.05;

/** How much each of this Tick's events shakes the camera of the player whose Fighter is `me`, in event order (0..1 each). */
export function shakeFor(events: readonly SimEvent[], me: number): number[] {
  const impulses: number[] = [];
  for (const e of events) {
    if (e.type === 'Hit' && e.defender === me) impulses.push(e.heavy ? HEAVY_TAKEN : HIT_TAKEN);
    else if (e.type === 'Hit' && e.attacker === me) impulses.push(e.heavy ? HEAVY_DEALT : HIT_DEALT);
    else if (e.type === 'KickLanded' && e.defender === me && e.outcome === 'Knockdown') impulses.push(KNOCKED_DOWN);
    else if (e.type === 'Land' && e.fighter === me && e.damage > 0) impulses.push(HURT_LANDING);
  }
  return impulses;
}

/** A smooth wobble in -1..1: two sines at unrelated rates, so it never visibly repeats. */
const wobble = (t: number, phase: number) => 0.6 * Math.sin(t * 47 + phase) + 0.4 * Math.sin(t * 29 + phase * 2.3);

/**
 * Shakes a camera. Any loop that drives a Simulation calls `onTick(tick, events, me)` after each step,
 * `update(seconds)` before each draw (with the time that passed, scaled by slow-motion, 0 while paused),
 * then `apply(camera, strength)` once the camera is placed. As with ImpactEffects, each Tick shakes at most
 * once (so rollback re-simulation does not repeat a shake); call `seek(tick)` when the loop jumps.
 */
export class CameraShake {
  /** How shaken the camera is, 0..1; the sway grows with its square, so small shakes stay small. */
  private trauma = 0;
  /** Shake time, seconds: drives the wobble. */
  private clock = 0;
  private lastTick = -Infinity;

  onTick(tick: number, events: readonly SimEvent[], me: number): void {
    if (tick <= this.lastTick) return;
    this.lastTick = tick;
    for (const impulse of shakeFor(events, me)) this.trauma = Math.min(1, this.trauma + impulse);
  }

  /** The loop jumped to `tick`: stop shaking; Ticks after it will shake. */
  seek(tick: number): void {
    this.lastTick = tick;
    this.trauma = 0;
  }

  /** Let the shake die away for `seconds`. */
  update(seconds: number): void {
    const dt = Math.min(0.1, Math.max(0, seconds));
    this.clock += dt;
    this.trauma = Math.max(0, this.trauma - DECAY * dt);
  }

  /** The camera's sway right and up (m, along its own axes) and its roll (radians), at `strength` (Tuning Data `camera.shake`; 0 is off). */
  offset(strength: number): { x: number; y: number; roll: number } {
    const k = this.trauma * this.trauma * strength;
    if (k === 0) return { x: 0, y: 0, roll: 0 };
    const t = this.clock;
    return { x: k * MAX_OFFSET * wobble(t, 0), y: k * MAX_OFFSET * wobble(t, 1.7), roll: k * MAX_ROLL * wobble(t, 4.1) };
  }

  /** Sway a placed camera by the current shake. */
  apply(camera: THREE.Camera, strength: number): void {
    const { x, y, roll } = this.offset(strength);
    if (x === 0 && y === 0 && roll === 0) return;
    camera.translateX(x);
    camera.translateY(y);
    camera.rotateZ(roll);
  }
}
