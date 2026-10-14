import type { RngState } from './rng';

/** Ground-plane vector (metres). y is up and the Arena is flat, so only x/z. */
export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

/** What a Fighter is doing right now. Attack, Block and Stagger arrive in later tickets. */
export type Action = 'Idle';

export interface FighterState {
  /** Position on the Arena floor, centre of the Arena is the origin. */
  readonly position: Vec2;
  /** Yaw in radians; 0 faces +z. */
  readonly facing: number;
  readonly hp: number;
  readonly action: Action;
}

/**
 * The complete Simulation state. Plain, JSON-like data only: everything that
 * influences the next Tick lives here so snapshot/restore and hashing are exact.
 */
export interface SimState {
  readonly tick: number;
  readonly rng: RngState;
  readonly fighters: readonly FighterState[];
}
