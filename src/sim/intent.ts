import type { Vec2 } from './state';

/** The four attack/block Directions. */
export const DIRECTIONS = ['Overhead', 'Left', 'Right', 'Thrust'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/**
 * The Direction that meets an Attack in `d` head-on: Left and Right swap, since a
 * swing from the attacker's right arrives on the defender's left. Blocks and
 * Chambers must be in the mirrored Direction of the Attack they stop.
 */
export const mirrorDirection = (d: Direction): Direction => (d === 'Left' ? 'Right' : d === 'Right' ? 'Left' : d);

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
  /**
   * Where the Fighter looks up (+) or down (-), radians from level; absent keeps
   * its pitch. It tilts toward this at `fighter.turnSpeed`, within
   * `fighter.lookPitchMax`, and leans its torso and hips with it; its hands and
   * Weapon swing up or down about the chest, so blows and thrusts land higher or lower. The Local Controller fills it from the camera.
   */
  readonly pitch?: number;
  /**
   * Jump pressed this Tick (absent = not pressed). A Fighter standing on the ground,
   * Idle, Blocking or Attacking, leaps up at `fall.jumpSpeed` until it lands (an Idle one Falls; it can Attack or Block in the air).
   */
  readonly jump?: boolean;
  /**
   * Crouch held this Tick (absent = standing). The Fighter's `crouch` amount moves toward 1 while it is held and back to 0 when let go, at
   * `fighter.crouchSpeed`. It is not an Action: a Fighter can crouch while Attacking, Blocking or in the air, and Attack or Block while crouched.
   */
  readonly crouch?: boolean;
  /**
   * Kick pressed this Tick (absent = not pressed). An Idle Fighter that is not crouched, on the ground or in a Jump, starts a Kick:
   * a committed Action that cannot be cancelled (it can only turn). Held down, it does not repeat.
   */
  readonly kick?: boolean;
  /**
   * Throw pressed this Tick (absent = not pressed). An Idle Fighter with a dagger left, on the ground or in a Jump, starts a Throw: the dagger
   * leaves the off hand in Release. It can still walk and turn while throwing but is committed otherwise. Held down, it does not repeat.
   */
  readonly throw?: boolean;
}

export const IDLE_INTENT: Intent = Object.freeze({
  move: Object.freeze({ x: 0, z: 0 }),
  direction: 'Overhead',
  attack: false,
  block: false,
  face: null,
  kick: false,
  throw: false,
});
