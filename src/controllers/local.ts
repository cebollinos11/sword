import { secondsToTicks, type Direction, type FighterState, type Intent, type InventoryRef, type SimState } from '../sim';
import type { Controller } from './controller';
import { getLookSensitivity } from './lookSensitivity';
import { inventoryClick, inventoryKey, type InventoryClickAction, type InventoryKey } from './inventoryKeys';

export type LocalButton = 'attack' | 'block' | 'jump' | 'crouch' | 'kick' | 'throw' | 'sheathe';

/** The key that Jumps. */
const JUMP_KEY = 'Space';

/** The key that throws a Throwing Dagger. */
const THROW_KEY = 'KeyE';

/** The key that Kicks. */
const KICK_KEY = 'KeyF';

/** The key that Sheathes the Weapon, or Draws it when Sheathed. */
const SHEATHE_KEY = 'KeyR';

/**
 * The keys held to crouch. Left Ctrl is safe to use because the page asks the browser to hand over Ctrl+W
 * (Keyboard Lock in fullscreen, an installed app) and, failing that, confirms before the tab closes (`bindLocalInput`).
 */
const CROUCH_KEYS: readonly string[] = ['KeyC', 'ControlLeft'];

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

/**
 * How long (seconds) a Wheel Attack waits for its Fighter to be able to start it (out of a Stagger, a Kick, a Block...)
 * before it is dropped, so a scroll made long ago never fires late. Release and Recovery do not count: a Wheel Attack
 * made then always follows the swing (as a Whiff Chain or a Chain).
 */
export const WHEEL_QUEUE_SECONDS = 0.5;

/** What the Local Controller needs to see of its own Fighter to start a queued Wheel Attack at the right Tick. */
export type WheelView = Pick<FighterState, 'action'>;

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
 *   one Jump (sent on one Tick), and holding it boosts that Jump higher (sent as `jumpHeld` on every Tick it is held).
 *   C held crouches (sent on every Tick it is held). F Kicks: one press is one Kick (sent on one Tick), however long it is held. E throws a dagger: a press starts one Throw,
 *   and holding E holds its Wind-up (sent as `throwHeld` on every Tick it is held), let go = the dagger leaves the hand.
 *   R Sheathes the Weapon, or Draws it when Sheathed: one press is one toggle (sent on one Tick), however long it is held.
 *   Mouse wheel up queues a quick Overhead Attack and wheel down a quick Thrust (a Wheel Attack, `wheel`).
 *   The number keys equip an inventory item (with Shift only select it) and X drops the one selected last, once each (`inventoryKeys.ts`); so does a click on the inventory screen.
 */
export class LocalController implements Controller {
  private readonly held = { attack: false, block: false, jump: false, crouch: false, kick: false, throw: false, sheathe: false };
  /** Pressed since the last sample: a click shorter than a Tick still reaches the Simulation for one Tick. */
  private readonly pressed = { attack: false, block: false, jump: false, crouch: false, kick: false, throw: false, sheathe: false };
  private readonly moving = { forward: false, back: false, left: false, right: false };
  /** The Direction of the most recent mouse gesture (what the next press will use). */
  private gestured: Direction = 'Overhead';
  /** Mouse travel since the last gesture or press. */
  private travel = { x: 0, y: 0 };
  /** The Direction sent in Intents, fixed when a button is pressed. */
  private latched: Direction = 'Overhead';
  private yawRadians = 0;
  private pitchRadians = 0;
  /** The inventory keys pressed since the last sample (`inventoryKeys.ts`), and the item the drop key drops. */
  private equipAsked: InventoryRef | undefined;
  private dropAsked: InventoryRef | undefined;
  private selected: InventoryRef | null = null;
  /** The Wheel Attack waiting to start, and the Ticks it may still wait (`WHEEL_QUEUE_SECONDS`). */
  private wheelQueued: { readonly direction: Direction; ticksLeft: number } | null = null;
  /** The Direction of the Wheel Attack whose Wind-up is playing (attack is let go so it Releases at once), or null. */
  private wheelFiring: Direction | null = null;
  /** The last sample held attack for the queued Wheel Attack from outside a Wind-up: a Wind-up now is that Attack starting. */
  private wheelPressed = false;

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
    const sensitivity = getLookSensitivity();
    this.look(dx * sensitivity, dy * sensitivity);
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

  /**
   * A mouse wheel notch: up (`'Overhead'`) or down (`'Thrust'`) queues a Wheel Attack in that Direction, a quick
   * Attack (its Wind-up plays to the held pose and Releases at once) that starts as soon as the Fighter can Attack:
   * at once when Idle, as a Whiff Chain or Chain from a swing's Release or Recovery, or once a Stagger, Kick, Block
   * and the like are over, if that is within `WHEEL_QUEUE_SECONDS`. A newer notch replaces one still waiting. It
   * ignores the aim of mouse gestures and leaves it as it was. Ignored while left mouse is held.
   */
  wheel(direction: Direction): void {
    if (this.held.attack) return;
    this.wheelQueued = { direction, ticksLeft: secondsToTicks(WHEEL_QUEUE_SECONDS) };
  }

  buttonDown(button: LocalButton): void {
    if (this.held[button]) return;
    // Left mouse takes over from any Wheel Attack.
    if (button === 'attack') this.wheelQueued = this.wheelFiring = null;
    this.held[button] = true;
    this.pressed[button] = true;
    if (button === 'jump' || button === 'crouch' || button === 'kick' || button === 'throw' || button === 'sheathe') return;
    this.latched = this.gestured;
    this.travel = { x: 0, y: 0 };
  }

  buttonUp(button: LocalButton): void {
    this.held[button] = false;
  }

  /** A key went down (`KeyboardEvent.code`, `shift` its Shift state: Shift and a number key selects an inventory item without equipping it). Unknown keys are ignored. */
  keyDown(code: string, shift = false): void {
    const move = MOVE_KEYS[code];
    if (move) this.moving[move] = true;
    else if (code === FEINT_KEY) this.feint();
    else if (code === JUMP_KEY) this.buttonDown('jump');
    else if (CROUCH_KEYS.includes(code)) this.buttonDown('crouch');
    else if (code === KICK_KEY) this.buttonDown('kick');
    else if (code === THROW_KEY) this.buttonDown('throw');
    else if (code === SHEATHE_KEY) this.buttonDown('sheathe');
    else this.inventoryKey(code, shift);
  }

  /** A number key equips and selects an item (with Shift only selects), the drop key drops the selected one (one Intent, however long it is held). */
  private inventoryKey(code: string, shift: boolean): void {
    const key = inventoryKey(code, this.selected, shift);
    if (key) this.ask(key);
  }

  /** A click or tap on an inventory screen's equip or drop control: asked on one Tick, like its key (`inventoryClick`). */
  inventoryClick(ref: InventoryRef, action: InventoryClickAction): void {
    this.ask(inventoryClick(ref, action));
  }

  private ask(key: InventoryKey): void {
    this.selected = key.selected;
    if (key.equip) this.equipAsked = key.equip;
    if (key.drop) this.dropAsked = key.drop;
  }

  keyUp(code: string): void {
    const move = MOVE_KEYS[code];
    if (move) this.moving[move] = false;
    else if (code === JUMP_KEY) this.buttonUp('jump');
    else if (CROUCH_KEYS.includes(code)) this.buttonUp('crouch');
    else if (code === KICK_KEY) this.buttonUp('kick');
    else if (code === THROW_KEY) this.buttonUp('throw');
    else if (code === SHEATHE_KEY) this.buttonUp('sheathe');
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
    this.held.attack = this.held.block = this.held.jump = this.held.crouch = this.held.kick = this.held.throw = this.held.sheathe = false;
    this.moving.forward = this.moving.back = this.moving.left = this.moving.right = false;
    this.equipAsked = this.dropAsked = undefined;
    this.wheelQueued = this.wheelFiring = null;
    this.wheelPressed = false;
  }

  /**
   * The Intent for the coming Tick. Call exactly once per Tick, with the local Fighter as it is now (before this
   * Intent is stepped), so a queued Wheel Attack starts at the right Tick; without it a Wheel Attack is a one-Tick
   * press, which starts an Attack only from Idle.
   */
  sample(self?: WheelView): Intent {
    const intent = this.sampleButtons();
    const wheel = this.wheelIntent(self);
    return wheel ? { ...intent, ...wheel } : intent;
  }

  /**
   * The attack and Direction a Wheel Attack asks for this Tick, or null when none is under way. Holding attack in
   * its Direction starts it from Idle (and from a Fall), Whiff Chains or Chains it from a swing's Release or Recovery,
   * and starts it the Tick a Stagger or the like ends; once its Wind-up is seen, attack is let go so it Releases as
   * soon as the Wind-up reaches its held pose. Attack is never held in someone else's Wind-up (that would hold or Feint it).
   */
  private wheelIntent(self: WheelView | undefined): Pick<Intent, 'attack' | 'direction'> | null {
    const action = self?.action;
    const inWindUp = action?.kind === 'Attack' && action.phase === 'Wind-up';
    if (this.wheelFiring) {
      const direction = this.wheelFiring;
      if (inWindUp) return { attack: false, direction };
      this.wheelFiring = null;
    }
    const queued = this.wheelQueued;
    if (!queued) return null;
    if (!self) {
      this.wheelQueued = null;
      return { attack: true, direction: queued.direction };
    }
    if (inWindUp) {
      if (this.wheelPressed) {
        // The Wind-up our hold started: let it go so it Releases at once.
        this.wheelPressed = false;
        this.wheelQueued = null;
        this.wheelFiring = queued.direction;
        return { attack: false, direction: queued.direction };
      }
      // Someone else's Wind-up (a left click): let it Release, and wait.
      return this.wheelWait(queued, false, false);
    }
    const following = action?.kind === 'Attack' && (action.phase === 'Release' || action.phase === 'Recovery');
    const idle = action?.kind === 'Idle' || action?.kind === 'Fall';
    return this.wheelWait(queued, following || idle, true);
  }

  /**
   * Wait on the queued Wheel Attack, holding attack for it if `hold`; time it out unless the Fighter is on its way
   * to starting it (`starting`: Idle, or in a swing's Release or Recovery).
   */
  private wheelWait(queued: { readonly direction: Direction; ticksLeft: number }, starting: boolean, hold: boolean): Pick<Intent, 'attack' | 'direction'> | null {
    this.wheelPressed = false;
    if (!starting && --queued.ticksLeft < 0) {
      this.wheelQueued = null;
      return null;
    }
    if (!hold) return null;
    this.wheelPressed = true;
    return { attack: true, direction: queued.direction };
  }

  private sampleButtons(): Intent {
    const attack = this.held.attack || this.pressed.attack;
    const block = this.held.block || this.pressed.block;
    const jump = this.pressed.jump;
    const jumpHeld = this.held.jump;
    const kick = this.pressed.kick;
    const throwing = this.pressed.throw;
    const throwHeld = this.held.throw;
    const sheathe = this.pressed.sheathe;
    const equip = this.equipAsked;
    const drop = this.dropAsked;
    this.equipAsked = this.dropAsked = undefined;
    this.pressed.attack = false;
    this.pressed.block = false;
    this.pressed.jump = false;
    this.pressed.crouch = false;
    this.pressed.kick = false;
    this.pressed.throw = false;
    this.pressed.sheathe = false;
    // A held Block follows the latest gesture: the Simulation only lets it re-aim shortly after it was raised (`block.correctionWindow`).
    if (block && !attack) this.latched = this.gestured;
    const crouch = this.held.crouch;
    const face = quantiseYaw(this.yawRadians);
    const intent: Intent = { move: this.move(face), direction: this.latched, attack, block, face, pitch: quantisePitch(this.pitchRadians) };
    return { ...intent, ...(jump && { jump }), ...(jumpHeld && { jumpHeld }), ...(crouch && { crouch }), ...(kick && { kick }), ...(throwing && { throw: throwing }), ...(throwHeld && { throwHeld }), ...(sheathe && { sheathe }), ...(equip && { equip }), ...(drop && { drop }) };
  }

  intent(state?: SimState, fighter?: number): Intent {
    return this.sample(state && fighter !== undefined ? state.fighters[fighter] : undefined);
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
