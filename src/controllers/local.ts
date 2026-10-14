import type { Direction, Intent } from '../sim';
import type { Controller } from './controller';

export type LocalButton = 'attack' | 'block';

/** Mouse travel (px) that counts as a Direction gesture; smaller movements add up until they reach it. */
export const GESTURE_PX = 12;

/** Camera turn per pixel of horizontal mouse movement (radians). */
export const LOOK_RADIANS_PER_PX = 0.0025;

/**
 * `face` is sent on a grid of this many steps per full turn, so the same aim
 * is always the exact same number (no float noise for Rollback to mispredict).
 */
export const FACE_STEPS = 4096;

/** The key that re-aims a held Attack at the latest mouse gesture (an Attack Feint). */
export const FEINT_KEY = 'KeyQ';

const MOVE_KEYS: Readonly<Record<string, 'forward' | 'back' | 'left' | 'right'>> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
};

const TURN = 2 * Math.PI;

/** The Direction a mouse gesture asks for: the blade comes from the side the mouse moved to; up is Overhead, down is Thrust. */
function gestureDirection(dx: number, dy: number): Direction {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'Left' : 'Right';
  return dy < 0 ? 'Overhead' : 'Thrust';
}

/** Wrap an angle into (-pi, pi]. */
function wrapAngle(a: number): number {
  const w = a - TURN * Math.floor((a + Math.PI) / TURN);
  return w === -Math.PI ? Math.PI : w;
}

/** Snap a yaw to the FACE_STEPS grid, wrapped into (-pi, pi]. */
function quantiseYaw(yaw: number): number {
  const steps = Math.round((wrapAngle(yaw) * FACE_STEPS) / TURN);
  return wrapAngle((steps * TURN) / FACE_STEPS);
}

/**
 * The Local Controller: turns a human's raw mouse/key events into one Intent
 * per Tick. Pure state, no DOM: `bindLocalInput` feeds it browser events and
 * the game loop calls `sample()` once per Tick.
 *
 * - Direction: the most recent mouse gesture before attack/block is pressed
 *   (left/right/up/down = Left/Right/Overhead/Thrust); with no gesture since
 *   the last Action the last Direction is kept; Overhead before any gesture.
 * - The Direction is locked while attack is held: turning the camera during a
 *   held Wind-up is NOT a Feint. Feints are deliberate: Q re-aims a held Attack
 *   at the latest gesture (Attack Feint); right mouse during a Wind-up blocks
 *   in the latest gesture's Direction (Block Feint).
 * - Left mouse held = Wind-up, let go = Release; right mouse = Block; WASD
 *   walks relative to the camera; horizontal mouse turns the camera, and the
 *   camera yaw is sent as `face`.
 */
export class LocalController implements Controller {
  private readonly held = { attack: false, block: false };
  /** Pressed since the last sample: a click shorter than a Tick still reaches the Simulation for one Tick. */
  private readonly pressed = { attack: false, block: false };
  private readonly moving = { forward: false, back: false, left: false, right: false };
  /** The Direction of the most recent mouse gesture (what the next press will use). */
  private gestured: Direction = 'Overhead';
  /** Mouse travel since the last gesture or press. */
  private travel = { x: 0, y: 0 };
  /** The Direction sent in Intents, fixed when a button is pressed. */
  private latched: Direction = 'Overhead';
  private yawRadians = 0;

  /** The camera yaw (radians, 0 looks along +z, same convention as Fighter facing). */
  get yaw(): number {
    return this.yawRadians;
  }

  /** Point the camera (and so the Fighter's aim) at `yaw`, e.g. the Fighter's facing when a Duel starts. */
  setYaw(yaw: number): void {
    this.yawRadians = wrapAngle(yaw);
  }

  /** Relative mouse movement in screen pixels (+x right, +y down). */
  mouseMove(dx: number, dy: number): void {
    // Moving right turns right, i.e. towards -x at yaw 0: yaw decreases.
    this.yawRadians = wrapAngle(this.yawRadians - dx * LOOK_RADIANS_PER_PX);
    this.travel.x += dx;
    this.travel.y += dy;
    if (Math.hypot(this.travel.x, this.travel.y) < GESTURE_PX) return;
    this.gestured = gestureDirection(this.travel.x, this.travel.y);
    this.travel = { x: 0, y: 0 };
  }

  buttonDown(button: LocalButton): void {
    if (this.held[button]) return;
    this.held[button] = true;
    this.pressed[button] = true;
    this.latched = this.gestured;
    this.travel = { x: 0, y: 0 };
  }

  buttonUp(button: LocalButton): void {
    this.held[button] = false;
  }

  /** A key went down (`KeyboardEvent.code`). Unknown keys are ignored. */
  keyDown(code: string): void {
    const move = MOVE_KEYS[code];
    if (move) this.moving[move] = true;
    else if (code === FEINT_KEY) this.feint();
  }

  keyUp(code: string): void {
    const move = MOVE_KEYS[code];
    if (move) this.moving[move] = false;
  }

  /**
   * The deliberate Attack Feint gesture: while attack is held, re-aim it at
   * the most recent mouse gesture. The Simulation treats a changed Direction
   * during a held Wind-up as a Feint.
   */
  feint(): void {
    if (this.held.attack) this.latched = this.gestured;
  }

  /** Let go of every button and key (the window lost focus). */
  releaseAll(): void {
    this.held.attack = this.held.block = false;
    this.moving.forward = this.moving.back = this.moving.left = this.moving.right = false;
  }

  /** The Intent for the coming Tick. Call exactly once per Tick. */
  sample(): Intent {
    const attack = this.held.attack || this.pressed.attack;
    const block = this.held.block || this.pressed.block;
    this.pressed.attack = false;
    this.pressed.block = false;
    const face = quantiseYaw(this.yawRadians);
    return { move: this.move(face), direction: this.latched, attack, block, face };
  }

  intent(): Intent {
    return this.sample();
  }

  /** World-space walk direction for the held WASD keys, relative to the aim `yaw`. */
  private move(yaw: number): { x: number; z: number } {
    const fwd = Number(this.moving.forward) - Number(this.moving.back);
    const right = Number(this.moving.right) - Number(this.moving.left);
    if (fwd === 0 && right === 0) return { x: 0, z: 0 };
    // forward = (sin f, cos f); right = (-cos f, sin f)
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const x = fwd * sin - right * cos;
    const z = fwd * cos + right * sin;
    const len = Math.hypot(x, z);
    return { x: x / len + 0, z: z / len + 0 };
  }
}
