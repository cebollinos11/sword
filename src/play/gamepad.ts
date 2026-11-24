import { gestureDirection, type LocalButton, type LocalController } from '../controllers';
import { getLookSensitivity } from '../controllers/lookSensitivity';
import type { Direction } from '../sim';
import { stickKeys } from './touch';

/**
 * Standard Gamepad button indices (W3C). DualShock 4 / DualSense over Chrome on Windows
 * usually report this mapping: Cross=0, Circle=1, Square=2, Triangle=3, L1=4, R1=5, L2=6, R2=7,
 * Share=8, Options=9, L3=10, R3=11, D-pad U/D/L/R=12..15.
 */
export const PAD = {
  jump: 0,
  throw: 1,
  kick: 2,
  sheathe: 3,
  feint: 4,
  whirlwind: 5,
  block: 6,
  attack: 7,
  menu: 9,
  crouch: 10,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

/** Left-stick axes scaled into the touch joystick's pixel space so `stickKeys` keeps one dead zone. */
const MOVE_SCALE = 48;
/** Right-stick look dead zone (axis units). Below this, the stick does not turn the camera. */
export const LOOK_DEAD = 0.15;
/**
 * Right-stick aim dead zone. A harder flick than look sets Attack/Block Direction (and Feints a held Attack),
 * so small camera nudges do not re-aim.
 */
export const AIM_DEAD = 0.55;
/** Camera turn (mouse-equivalent px) per frame at full right-stick deflection. */
export const LOOK_PX = 12;
/** Analog triggers count as pressed above this (L2/R2 on a DualShock). */
export const TRIGGER_DEAD = 0.3;

const DPAD_AIM: Readonly<Record<number, Direction>> = {
  [PAD.dpadUp]: 'Overhead',
  [PAD.dpadDown]: 'Thrust',
  [PAD.dpadLeft]: 'Left',
  [PAD.dpadRight]: 'Right',
};

const HOLD_BUTTONS: ReadonlyArray<{ index: number; button: LocalButton }> = [
  { index: PAD.attack, button: 'attack' },
  { index: PAD.block, button: 'block' },
  { index: PAD.jump, button: 'jump' },
  { index: PAD.kick, button: 'kick' },
  { index: PAD.throw, button: 'throw' },
  { index: PAD.sheathe, button: 'sheathe' },
  { index: PAD.whirlwind, button: 'whirlwind' },
  { index: PAD.crouch, button: 'crouch' },
];

/** True when a Standard Gamepad button (digital or analog trigger) is down. */
export function buttonPressed(button: GamepadButton | undefined): boolean {
  if (!button) return false;
  return button.pressed || button.value > TRIGGER_DEAD;
}

/** The WASD keys a left stick holds: same 8-way sectors as the touch joystick. */
export function gamepadMoveKeys(ax: number, ay: number): Set<string> {
  return stickKeys(ax * MOVE_SCALE, ay * MOVE_SCALE);
}

/** Right-stick look delta in mouse-equivalent pixels this frame, or null inside the dead zone. */
export function gamepadLookDelta(ax: number, ay: number): { dx: number; dy: number } | null {
  if (Math.hypot(ax, ay) < LOOK_DEAD) return null;
  return { dx: ax * LOOK_PX, dy: ay * LOOK_PX };
}

/** Right-stick Direction when past the aim dead zone (Overhead / Thrust / Left / Right), else null. */
export function gamepadAimDirection(ax: number, ay: number): Direction | null {
  if (Math.hypot(ax, ay) < AIM_DEAD) return null;
  return gestureDirection(ax, ay);
}

export interface GamepadInputBinding {
  /** Feed the pad to the Controller only while true (a Match is on and the menu closed). */
  enabled: boolean;
  /** Call once per animation frame (reads `navigator.getGamepads()`). */
  poll(): void;
  dispose(): void;
}

export interface GamepadInputOptions {
  /** Options / menu button pressed (edge). The game opens pause. */
  onMenu?: () => void;
}

/**
 * Feeds a connected Gamepad (Standard mapping) to a Local Controller. Polled each frame: left stick walks,
 * right stick looks and aims Direction (a hard flick), R2/L2 Attack/Block, face buttons Jump / Throw / Kick /
 * Sheathe, L1 Feint, R1 Whirlwind, L3 Crouch, D-pad aims, Options opens the menu.
 */
export function bindGamepadInput(local: LocalController, options: GamepadInputOptions = {}): GamepadInputBinding {
  let enabled = false;
  let moveKeys = new Set<string>();
  const held = new Map<LocalButton, boolean>();
  let aimDir: Direction | null = null;
  let feintDown = false;
  let menuDown = false;
  const dpadWas = new Map<number, boolean>();

  const setMoveKeys = (keys: Set<string>) => {
    for (const k of moveKeys) if (!keys.has(k)) local.keyUp(k);
    for (const k of keys) if (!moveKeys.has(k)) local.keyDown(k);
    moveKeys = keys;
  };

  const setHeld = (button: LocalButton, on: boolean) => {
    if (held.get(button) === on) return;
    held.set(button, on);
    if (on) local.buttonDown(button);
    else local.buttonUp(button);
  };

  const releasePad = () => {
    setMoveKeys(new Set());
    for (const button of [...held.keys()]) setHeld(button, false);
    held.clear();
    feintDown = false;
    aimDir = null;
    menuDown = false;
    dpadWas.clear();
  };

  const pickPad = (): Gamepad | null => {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) return p;
    }
    return null;
  };

  return {
    get enabled() {
      return enabled;
    },
    set enabled(on: boolean) {
      if (!on) releasePad();
      enabled = on;
    },
    poll() {
      if (!enabled) return;
      const pad = pickPad();
      if (!pad) {
        releasePad();
        return;
      }

      setMoveKeys(gamepadMoveKeys(pad.axes[0] ?? 0, pad.axes[1] ?? 0));

      const rx = pad.axes[2] ?? 0;
      const ry = pad.axes[3] ?? 0;
      const look = gamepadLookDelta(rx, ry);
      if (look) {
        const s = getLookSensitivity();
        local.look(look.dx * s, look.dy * s);
      }
      // A hard flick aims; changing side while Attack is held is the Attack Feint (as a touch swipe is).
      const aim = gamepadAimDirection(rx, ry);
      if (aim && aim !== aimDir) {
        local.aim(aim);
        if (held.get('attack')) local.feint();
        aimDir = aim;
      } else if (!aim) {
        aimDir = null;
      }

      for (const { index, button } of HOLD_BUTTONS) {
        setHeld(button, buttonPressed(pad.buttons[index]));
      }

      const feint = buttonPressed(pad.buttons[PAD.feint]);
      if (feint && !feintDown) local.feint();
      feintDown = feint;

      for (const [index, direction] of Object.entries(DPAD_AIM)) {
        const i = Number(index);
        const on = buttonPressed(pad.buttons[i]);
        if (on && !dpadWas.get(i)) {
          local.aim(direction);
          if (held.get('attack')) local.feint();
        }
        dpadWas.set(i, on);
      }

      const menu = buttonPressed(pad.buttons[PAD.menu]);
      if (menu && !menuDown) options.onMenu?.();
      menuDown = menu;
    },
    dispose() {
      releasePad();
      enabled = false;
    },
  };
}
