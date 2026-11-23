import { describe, expect, it, vi } from 'vitest';
import { LocalController } from '../controllers';
import {
  AIM_DEAD,
  buttonPressed,
  gamepadAimDirection,
  gamepadLookDelta,
  gamepadMoveKeys,
  LOOK_DEAD,
  PAD,
  TRIGGER_DEAD,
  bindGamepadInput,
} from './gamepad';

function btn(pressed: boolean, value = pressed ? 1 : 0): GamepadButton {
  return { pressed, touched: pressed, value };
}

/** A mutable stand-in for `navigator.getGamepads()` entries (tests mutate axes/buttons between polls). */
function fakePad(partial: { axes?: number[]; buttons?: Partial<Record<number, GamepadButton>> }): Gamepad {
  const buttons = Array.from({ length: 16 }, (_, i) => partial.buttons?.[i] ?? btn(false));
  return {
    id: 'test-pad',
    index: 0,
    connected: true,
    mapping: 'standard',
    axes: partial.axes ?? [0, 0, 0, 0],
    buttons,
    timestamp: 0,
  } as unknown as Gamepad;
}

describe('gamepadMoveKeys', () => {
  it.each([
    [0, -1, ['KeyW']],
    [0, 1, ['KeyS']],
    [1, 0, ['KeyD']],
    [-1, 0, ['KeyA']],
    [0.1, 0.1, []],
  ] as const)('axes (%d, %d) hold %j', (ax, ay, keys) => {
    expect([...gamepadMoveKeys(ax, ay)].sort()).toEqual([...keys].sort());
  });
});

describe('gamepadLookDelta / gamepadAimDirection', () => {
  it('ignores a stick inside the look dead zone', () => {
    expect(gamepadLookDelta(LOOK_DEAD * 0.5, 0)).toBeNull();
    expect(gamepadAimDirection(LOOK_DEAD * 0.5, 0)).toBeNull();
  });

  it('looks before it aims', () => {
    const mid = (LOOK_DEAD + AIM_DEAD) / 2;
    expect(gamepadLookDelta(mid, 0)).not.toBeNull();
    expect(gamepadAimDirection(mid, 0)).toBeNull();
  });

  it('a hard flick aims Left / Right / Overhead / Thrust', () => {
    expect(gamepadAimDirection(-1, 0)).toBe('Left');
    expect(gamepadAimDirection(1, 0)).toBe('Right');
    expect(gamepadAimDirection(0, -1)).toBe('Overhead');
    expect(gamepadAimDirection(0, 1)).toBe('Thrust');
  });
});

describe('buttonPressed', () => {
  it('treats analog triggers past the dead zone as down', () => {
    expect(buttonPressed(btn(false, TRIGGER_DEAD + 0.05))).toBe(true);
    expect(buttonPressed(btn(false, TRIGGER_DEAD - 0.05))).toBe(false);
    expect(buttonPressed(btn(true, 0))).toBe(true);
  });
});

describe('bindGamepadInput', () => {
  it('R2 winds up an Attack in the aimed Direction; L2 Blocks', () => {
    const local = new LocalController();
    let pad = fakePad({
      axes: [0, 0, -1, 0],
      buttons: { [PAD.attack]: btn(true) },
    });
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    const binding = bindGamepadInput(local);
    binding.enabled = true;
    binding.poll();
    expect(local.sample()).toMatchObject({ attack: true, direction: 'Left' });
    pad = fakePad({
      axes: [0, 0, 1, 0],
      buttons: { [PAD.block]: btn(true) },
    });
    binding.poll();
    expect(local.sample()).toMatchObject({ attack: false, block: true, direction: 'Right' });
    binding.dispose();
    vi.unstubAllGlobals();
  });

  it('left stick walks and Cross Jumps', () => {
    const local = new LocalController();
    const pad = fakePad({
      axes: [0, -1, 0, 0],
      buttons: { [PAD.jump]: btn(true) },
    });
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    const binding = bindGamepadInput(local);
    binding.enabled = true;
    binding.poll();
    const intent = local.sample();
    expect(intent.jump).toBe(true);
    // At yaw 0, forward is +z.
    expect(intent.move.z).toBeGreaterThan(0.9);
    binding.dispose();
    vi.unstubAllGlobals();
  });

  it('D-pad aims; Options fires onMenu once per press', () => {
    const local = new LocalController();
    const onMenu = vi.fn();
    const pad = fakePad({ buttons: { [PAD.dpadDown]: btn(true), [PAD.menu]: btn(true) } });
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    const binding = bindGamepadInput(local, { onMenu });
    binding.enabled = true;
    binding.poll();
    binding.poll();
    expect(onMenu).toHaveBeenCalledTimes(1);
    local.buttonDown('attack');
    expect(local.sample().direction).toBe('Thrust');
    binding.dispose();
    vi.unstubAllGlobals();
  });

  it('disabling lets go of stick and buttons', () => {
    const local = new LocalController();
    const pad = fakePad({
      axes: [0, -1, 0, 0],
      buttons: { [PAD.attack]: btn(true) },
    });
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    const binding = bindGamepadInput(local);
    binding.enabled = true;
    binding.poll();
    binding.enabled = false;
    // buttonUp leaves the press edge for one sample (same as the mouse); walk keys are cleared at once.
    expect(local.sample().move).toEqual({ x: 0, z: 0 });
    expect(local.sample().attack).toBe(false);
    binding.dispose();
    vi.unstubAllGlobals();
  });
});
