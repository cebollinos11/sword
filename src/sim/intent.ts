import type { Vec2 } from './state';

/** The four attack/block Directions. */
export const DIRECTIONS = ['Overhead', 'Left', 'Right', 'Thrust'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/**
 * What a Controller asks its Fighter to do on one Tick. The only thing that
 * crosses the Controller–Fighter boundary (and the only thing sent between peers).
 */
export interface Intent {
  /** Desired walk direction on the ground plane; length is clamped to 1. */
  readonly move: Vec2;
  /** The Direction an Attack (or Block) started on this Tick uses. Changing it while a Wind-up is held is a Feint. */
  readonly direction: Direction;
  /** Attack button held. Pressing starts an Attack; holding holds the Wind-up; letting go Releases. */
  readonly attack: boolean;
  /** Block button held. Pressing (from Idle, or during a Wind-up as a Feint) raises a Block in `direction`; letting go drops it. */
  readonly block: boolean;
  /**
   * The yaw (radians, 0 faces +z, same convention as FighterState.facing) the
   * Fighter should turn toward, or null to keep its facing. The Fighter turns
   * the shorter way round at `fighter.turnSpeed`, so turning takes time. The
   * Local Controller fills this from the mouse/camera; the AI aims it at its
   * opponent. Movement never turns a Fighter: only this does.
   */
  readonly face: number | null;
}

export const IDLE_INTENT: Intent = Object.freeze({
  move: Object.freeze({ x: 0, z: 0 }),
  direction: 'Overhead',
  attack: false,
  block: false,
  face: null,
});
