import type { Vec2 } from './state';

/**
 * What a Controller asks its Fighter to do on one Tick. The only thing that
 * crosses the Controller–Fighter boundary. Direction, attack and block are
 * added by later tickets.
 */
export interface Intent {
  /** Desired walk direction on the ground plane; length is clamped to 1. */
  readonly move: Vec2;
}

export const IDLE_INTENT: Intent = Object.freeze({ move: Object.freeze({ x: 0, z: 0 }) });
