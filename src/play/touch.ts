import { gestureDirection, type LocalButton, type LocalController } from '../controllers';
import type { Direction } from '../sim';
import { ensurePlayStyles } from './styles';

/** Finger travel (CSS px) on a pad that counts as a Direction swipe. */
export const SWIPE_PX = 18;
/** Holding a pad this long without swiping presses it in the last Direction (ms). */
export const PAD_HOLD_MS = 140;
/** Camera turn per CSS px of a look drag, relative to the mouse's. */
const LOOK_SCALE = 1.6;
/** Joystick throw (CSS px) at full deflection, and the dead zone below which it doesn't walk. */
const STICK_RADIUS = 48;
const STICK_DEAD = 14;

const ARROW: Readonly<Record<Direction, string>> = { Overhead: '▲', Thrust: '▼', Left: '◀', Right: '▶' };

/** True on touch-first devices (phones, tablets), where the touch controls are shown. */
export function isTouchDevice(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/**
 * One finger on a swipe pad (Attack or Block). Swiping picks the Direction and
 * presses the button; holding without a swipe presses it in the last
 * Direction; lifting lets go (a quick tap is a click). Swiping a new way while
 * an Attack is held re-aims it (the Attack Feint); on the Block pad it
 * re-blocks in the new Direction. No DOM: the pad element feeds it.
 */
export class PadGesture {
  private anchor: { x: number; y: number } | null = null;
  private pressed = false;
  private swiped: Direction | null = null;

  constructor(
    private readonly local: LocalController,
    private readonly button: LocalButton,
  ) {}

  /** The Direction swiped since the finger went down (for the pad's arrow), if any. */
  get direction(): Direction | null {
    return this.swiped;
  }

  get active(): boolean {
    return this.anchor !== null;
  }

  start(x: number, y: number): void {
    this.anchor = { x, y };
    this.pressed = false;
    this.swiped = null;
  }

  move(x: number, y: number): void {
    if (!this.anchor) return;
    const dx = x - this.anchor.x;
    const dy = y - this.anchor.y;
    if (Math.hypot(dx, dy) < SWIPE_PX) return;
    this.anchor = { x, y };
    const direction = gestureDirection(dx, dy);
    if (this.pressed && direction === this.swiped) return;
    this.swiped = direction;
    this.local.aim(direction);
    if (!this.pressed) return this.press();
    if (this.button === 'attack') {
      this.local.feint();
    } else {
      this.local.buttonUp('block');
      this.local.buttonDown('block');
    }
  }

  /** The finger has been down PAD_HOLD_MS: no swipe came, so press in the last Direction. */
  hold(): void {
    if (this.anchor && !this.pressed) this.press();
  }

  end(): void {
    if (!this.anchor) return;
    if (!this.pressed) this.press();
    this.local.buttonUp(this.button);
    this.anchor = null;
    this.swiped = null;
  }

  private press(): void {
    this.pressed = true;
    this.local.buttonDown(this.button);
  }
}

/** The WASD keys a joystick deflection holds: 8-way, so walking is the same as on the keyboard (and Rollback-friendly). */
export function stickKeys(dx: number, dy: number): Set<string> {
  const keys = new Set<string>();
  if (Math.hypot(dx, dy) < STICK_DEAD) return keys;
  // Sectors of 45 degrees: a component counts when it is within 67.5 degrees of its axis.
  const angle = Math.atan2(-dy, dx); // up is +
  const along = (a: number) => Math.cos(angle - a) > Math.cos((67.5 * Math.PI) / 180);
  if (along(Math.PI / 2)) keys.add('KeyW');
  if (along(-Math.PI / 2)) keys.add('KeyS');
  if (along(0)) keys.add('KeyD');
  if (along(Math.PI)) keys.add('KeyA');
  return keys;
}

export interface TouchInputBinding {
  /** Show the controls and feed touches to the Controller only while true (a Match is on). */
  enabled: boolean;
  dispose(): void;
}

/**
 * On-screen touch controls for a Local Controller: a floating joystick in the
 * lower left walks, the Attack and Block swipe pads in the lower right fight,
 * the Jump and Throw buttons beside them Jump and throw a dagger (a tap each), and dragging anywhere else turns the camera. Multi-touch, so you can walk,
 * look and hold an Attack at once.
 */
export function bindTouchInput(local: LocalController, container: HTMLElement): TouchInputBinding {
  ensurePlayStyles();
  const root = document.createElement('div');
  root.className = 'touch';
  root.hidden = true;

  const stickBase = document.createElement('div');
  stickBase.className = 'touch-stick';
  const stickKnob = document.createElement('div');
  stickKnob.className = 'touch-stick-knob';
  stickBase.append(stickKnob);

  const pad = (button: LocalButton, label: string) => {
    const el = document.createElement('div');
    el.className = `touch-pad touch-${button}`;
    const arrow = document.createElement('span');
    arrow.className = 'touch-pad-arrow';
    const name = document.createElement('span');
    name.className = 'touch-pad-label';
    name.textContent = label;
    el.append(arrow, name);
    return { el, arrow, gesture: new PadGesture(local, button), pointer: -1, timer: 0 };
  };
  const pads = [pad('attack', 'Attack'), pad('block', 'Block')];
  const tap = (button: LocalButton, label: string) => {
    const el = document.createElement('div');
    el.className = `touch-pad touch-${button}`;
    const name = document.createElement('span');
    name.className = 'touch-pad-label';
    name.textContent = label;
    el.append(name);
    return { el, button, pointer: -1 };
  };
  const taps = [tap('jump', 'Jump'), tap('throw', 'Throw')];
  root.append(stickBase, ...pads.map((p) => p.el), ...taps.map((t) => t.el));
  container.append(root);

  let enabled = false;
  let stick: { pointer: number; x: number; y: number; keys: Set<string> } | null = null;
  const looks = new Map<number, { x: number; y: number }>(); // pointer -> last position

  const setStickKeys = (keys: Set<string>) => {
    if (!stick) return;
    for (const k of stick.keys) if (!keys.has(k)) local.keyUp(k);
    for (const k of keys) if (!stick.keys.has(k)) local.keyDown(k);
    stick.keys = keys;
  };
  const placeKnob = (dx: number, dy: number) => {
    const len = Math.hypot(dx, dy);
    const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
    stickKnob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  };
  const endStick = () => {
    setStickKeys(new Set());
    stick = null;
    stickBase.classList.remove('active');
    stickBase.style.left = stickBase.style.top = '';
    placeKnob(0, 0);
  };
  const showArrow = (p: (typeof pads)[number]) => {
    const d = p.gesture.direction;
    p.arrow.textContent = d ? ARROW[d] : '';
  };
  const endPad = (p: (typeof pads)[number]) => {
    clearTimeout(p.timer);
    p.gesture.end();
    p.pointer = -1;
    p.el.classList.remove('active');
    showArrow(p);
  };

  const onDown = (e: PointerEvent) => {
    if (!enabled) return;
    e.preventDefault();
    const target = e.target as Element;
    const p = pads.find((q) => q.el.contains(target));
    const t = taps.find((q) => q.el.contains(target));
    if (t) {
      if (t.pointer !== -1) return;
      t.pointer = e.pointerId;
      t.el.classList.add('active');
      local.buttonDown(t.button);
    } else if (p) {
      if (p.pointer !== -1) return;
      p.pointer = e.pointerId;
      p.gesture.start(e.clientX, e.clientY);
      p.el.classList.add('active');
      p.timer = window.setTimeout(() => p.gesture.hold(), PAD_HOLD_MS);
    } else if (!stick && e.clientX < root.clientWidth * 0.45 && e.clientY > root.clientHeight * 0.35) {
      stick = { pointer: e.pointerId, x: e.clientX, y: e.clientY, keys: new Set() };
      const rect = root.getBoundingClientRect();
      stickBase.style.left = `${e.clientX - rect.left}px`;
      stickBase.style.top = `${e.clientY - rect.top}px`;
      stickBase.classList.add('active');
    } else {
      looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!enabled) return;
    const p = pads.find((q) => q.pointer === e.pointerId);
    if (p) {
      p.gesture.move(e.clientX, e.clientY);
      showArrow(p);
    } else if (stick?.pointer === e.pointerId) {
      const dx = e.clientX - stick.x;
      const dy = e.clientY - stick.y;
      placeKnob(dx, dy);
      setStickKeys(stickKeys(dx, dy));
    } else if (looks.has(e.pointerId)) {
      const last = looks.get(e.pointerId)!;
      local.look((e.clientX - last.x) * LOOK_SCALE, (e.clientY - last.y) * LOOK_SCALE);
      looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  };
  const onUp = (e: PointerEvent) => {
    const p = pads.find((q) => q.pointer === e.pointerId);
    if (p) endPad(p);
    else if (stick?.pointer === e.pointerId) endStick();
    else {
      const t = taps.find((q) => q.pointer === e.pointerId);
      if (t) endTap(t);
    }
    looks.delete(e.pointerId);
  };
  const endTap = (t: (typeof taps)[number]) => {
    t.pointer = -1;
    t.el.classList.remove('active');
    local.buttonUp(t.button);
  };
  const releaseAll = () => {
    for (const t of taps) if (t.pointer !== -1) endTap(t);
    for (const p of pads) if (p.pointer !== -1) endPad(p);
    if (stick) endStick();
    looks.clear();
  };
  const onContextMenu = (e: Event) => e.preventDefault();

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('blur', releaseAll);

  return {
    get enabled() {
      return enabled;
    },
    set enabled(on: boolean) {
      if (!on) releaseAll();
      enabled = on;
      root.hidden = !on;
    },
    dispose() {
      releaseAll();
      window.removeEventListener('blur', releaseAll);
      root.remove();
    },
  };
}
