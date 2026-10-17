/**
 * The Slide: a push the Simulation gives a Fighter over a few Ticks, decelerating
 * linearly to a stop (a Kick's Shove or Knockdown). A Slide of `distance` over `ticks`
 * Ticks starts at speed 2·distance / (ticks·TICK_SECONDS) and covers exactly `distance`:
 * each Tick moves by the mean of the speed at its start and end.
 */
import { TICK_SECONDS } from './constants';
import type { Slide, Vec2 } from './state';

/** A Slide of `distance` metres over `ticks` Ticks along the unit direction (`dx`, `dz`). */
export function startSlide(dx: number, dz: number, distance: number, ticks: number): Slide {
  const speed = (2 * distance) / (ticks * TICK_SECONDS);
  return { vx: dx * speed, vz: dz * speed, ticks };
}

/** This Tick of a Slide: how far it moves the Fighter, and what is left of it (undefined once it has stopped). */
export function advanceSlide(slide: Slide): { readonly delta: Vec2; readonly next: Slide | undefined } {
  const n = slide.ticks;
  const mean = 1 - 1 / (2 * n);
  const delta = { x: slide.vx * mean * TICK_SECONDS, z: slide.vz * mean * TICK_SECONDS };
  if (n <= 1) return { delta, next: undefined };
  const keep = 1 - 1 / n;
  return { delta, next: { vx: slide.vx * keep, vz: slide.vz * keep, ticks: n - 1 } };
}
