import type { Direction, Intent } from '../sim';
import type { Controller } from './controller';

export type LocalButton = 'attack' | 'block' | 'jump' | 'crouch' | 'kick' | 'throw';

/** The key that Jumps. */
const JUMP_KEY = 'Space';

/** The key that throws a Throwing Dagger. */
const THROW_KEY = 'KeyE';

/** The key that Kicks. */
const KICK_KEY = 'KeyF';

/** The key held to crouch (not Ctrl: browsers keep Ctrl+W, which would close the tab). */
const CROUCH_KEY = 'KeyC';

/** Mouse travel (px) that counts as a Direction gesture; smaller movements add up until they reach it. */
export const GESTURE_PX = 6;

/** Camera turn per pixel of horizontal mouse movement, and tilt per pixel of vertical movement (radians). */
export const LOOK_RADIANS_PER_PX = 0.0025;

/** How far (radians) the camera may look up or down from level. */
export const MAX_LOOK_PITCH = 1.1;

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
export function gestureDirection(dx: number, dy: number): Direction {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'Left' : 'Right';
  return dy < 0 ? 'Overhead' : 'Thrust';
}

/** Wrap an angle into (-pi, pi]. */
function wrapAngle(a: number): number {
  const w = a - TURN * Math.floor((a + Math.PI) / TURN);
  return w === -Math.PI ? Math.PI : w;
}

/** Snap a pitch to the FACE_STEPS grid (same reason as `face`). */
function quantisePitch(pitch: number): number {
  return (Math.round((pitch * FACE_STEPS) / TURN) * TURN) / FACE_STEPS + 0;
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
 *   camera yaw is sent as `face`; vertical mouse tilts it up and down, sent as
 *   `pitch` (the Fighter leans its torso with it). Space Jumps: one press is
 *   one Jump (sent on one Tick), however long it is held.
 *   C held crouches (sent on every Tick it is held). F Kicks: one press is one Kick (sent on one Tick), however long it is held. E throws a dagger: a press starts one Throw,
 *   and holding E holds its Wind-up (sent as `throwHeld` on every Tick it is held), let go = the dagger leaves the hand.
 */
export class LocalController implements Controller {
  private readonly held = { attack: false, block: false, jump: false, crouch: false, kick: false, throw: false };
  /** Pressed since the last sample: a click shorter than a Tick still reaches the Simulation for one Tick. */
  private readonly pressed = { attack: false, block: false, jump: false, crouch: false, kick: false, throw: false };
  private readonly moving = { forward: false, back: false, left: false, right: false };
  /** The Direction of the most recent mouse gesture (what the next press will use). */
  private gestured: Direction = 'Overhead';
  /** Mouse travel since the last gesture or press. */
  private travel = { x: 0, y: 0 };
  /** The Direction sent in Intents, fixed when a button is pressed. */
  private latched: Direction = 'Overhead';
  private yawRadians = 0;
  private pitchRadians = 0;

  /** The camera yaw (radians, 0 looks along +z, same convention as Fighter facing). */
  get yaw(): number {
    return this.yawRadians;
  }

  /** The camera pitch (radians from level, + looks up), within MAX_LOOK_PITCH. */
  get pitch(): number {
    return this.pitchRadians;
  }

  /** Point the camera (and so the Fighter's aim) at `yaw`, looking level, e.g. the Fighter's facing when a Duel starts. */
  setYaw(yaw: number): void {
    this.yawRadians = wrapAngle(yaw);
    this.pitchRadians = 0;
  }

  /** Relative mouse movement in screen pixels (+x right, +y down). */
  mouseMove(dx: number, dy: number): void {
    this.look(dx, dy);
    this.travel.x += dx;
    this.travel.y += dy;
    if (Math.hypot(this.travel.x, this.travel.y) < GESTURE_PX) return;
    this.gestured = gestureDirection(this.travel.x, this.travel.y);
    this.travel = { x: 0, y: 0 };
  }

  /** Turn the camera by `dx` and tilt it by `dy` screen pixels without making a Direction gesture (a touch drag on the screen). */
  look(dx: number, dy = 0): void {
    // Moving right turns right, i.e. towards -x at yaw 0: yaw decreases.
    this.yawRadians = wrapAngle(this.yawRadians - dx * LOOK_RADIANS_PER_PX);
    // Moving up (-y) looks up.
    this.pitchRadians = Math.min(MAX_LOOK_PITCH, Math.max(-MAX_LOOK_PITCH, this.pitchRadians - dy * LOOK_RADIANS_PER_PX));
  }

  /** A Direction gesture made some other way than the mouse (a swipe on a touch pad): the next press uses it. */
  aim(direction: Direction): void {
    this.gestured = direction;
    this.travel = { x: 0, y: 0 };
  }

  buttonDown(button: LocalButton): void {
    if (this.held[button]) return;
    this.held[button] = true;
    this.pressed[button] = true;
    if (button === 'jump' || button === 'crouch' || button === 'kick' || button === 'throw') return;
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
    else if (code === JUMP_KEY) this.buttonDown('jump');
    else if (code === CROUCH_KEY) this.buttonDown('crouch');
    else if (code === KICK_KEY) this.buttonDown('kick');
    else if (code === THROW_KEY) this.buttonDown('throw');
  }

  keyUp(code: string): void {
    const move = MOVE_KEYS[code];
    if (move) this.moving[move] = false;
    else if (code === JUMP_KEY) this.buttonUp('jump');
    else if (code === CROUCH_KEY) this.buttonUp('crouch');
    else if (code === KICK_KEY) this.buttonUp('kick');
    else if (code === THROW_KEY) this.buttonUp('throw');
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
    this.held.attack = this.held.block = this.held.jump = this.held.crouch = this.held.kick = this.held.throw = false;
    this.moving.forward = this.moving.back = this.moving.left = this.moving.right = false;
  }

  /** The Intent for the coming Tick. Call exactly once per Tick. */
  sample(): Intent {
    const attack = this.held.attack || this.pressed.attack;
    const block = this.held.block || this.pressed.block;
    const jump = this.pressed.jump;
    const kick = this.pressed.kick;
    const throwing = this.pressed.throw;
    const throwHeld = this.held.throw;
    this.pressed.attack = false;
    this.pressed.block = false;
    this.pressed.jump = false;
    this.pressed.crouch = false;
    this.pressed.kick = false;
    this.pressed.throw = false;
    // A held Block follows the latest gesture: the Simulation only lets it re-aim shortly after it was raised (`block.correctionWindow`).
    if (block && !attack) this.latched = this.gestured;
    const crouch = this.held.crouch;
    const face = quantiseYaw(this.yawRadians);
    const intent: Intent = { move: this.move(face), direction: this.latched, attack, block, face, pitch: quantisePitch(this.pitchRadians) };
    return { ...intent, ...(jump && { jump }), ...(crouch && { crouch }), ...(kick && { kick }), ...(throwing && { throw: throwing }), ...(throwHeld && { throwHeld }) };
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
