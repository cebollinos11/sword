import { describe, expect, it } from 'vitest';
import { LocalController } from '../controllers';
import { PadGesture, stickKeys, SWIPE_PX } from './touch';

const far = SWIPE_PX + 2;

describe('Attack swipe pad', () => {
  it('a swipe picks the Direction and starts the Wind-up; lifting releases', () => {
    const local = new LocalController();
    const pad = new PadGesture(local, 'attack');
    pad.start(100, 100);
    expect(local.sample().attack).toBe(false);
    pad.move(100 - far, 100);
    expect(local.sample()).toMatchObject({ attack: true, direction: 'Left' });
    expect(local.sample().attack).toBe(true);
    pad.end();
    expect(local.sample().attack).toBe(false);
  });

  it('a tap attacks once in the last Direction', () => {
    const local = new LocalController();
    local.aim('Thrust');
    const pad = new PadGesture(local, 'attack');
    pad.start(0, 0);
    pad.end();
    expect(local.sample()).toMatchObject({ attack: true, direction: 'Thrust' });
    expect(local.sample().attack).toBe(false);
  });

  it('holding without a swipe winds up in the last Direction', () => {
    const local = new LocalController();
    local.aim('Right');
    const pad = new PadGesture(local, 'attack');
    pad.start(0, 0);
    pad.hold();
    expect(local.sample()).toMatchObject({ attack: true, direction: 'Right' });
  });

  it('swiping a new way while held is the Attack Feint', () => {
    const local = new LocalController();
    const pad = new PadGesture(local, 'attack');
    pad.start(0, 0);
    pad.move(0, -far);
    expect(local.sample().direction).toBe('Overhead');
    pad.move(0, 0 + 2);
    expect(local.sample().direction).toBe('Thrust');
  });

  it('small finger jitter is not a swipe', () => {
    const local = new LocalController();
    const pad = new PadGesture(local, 'attack');
    pad.start(0, 0);
    pad.move(SWIPE_PX - 4, 0);
    expect(local.sample().attack).toBe(false);
  });
});

describe('Block swipe pad', () => {
  it('blocks in the swiped Direction and re-blocks when swiped again', () => {
    const local = new LocalController();
    const pad = new PadGesture(local, 'block');
    pad.start(0, 0);
    pad.move(far, 0);
    expect(local.sample()).toMatchObject({ block: true, direction: 'Right' });
    pad.move(0, 0);
    expect(local.sample()).toMatchObject({ block: true, direction: 'Left' });
    pad.end();
    expect(local.sample().block).toBe(false);
  });
});

describe('joystick', () => {
  it.each([
    [0, -40, ['KeyW']],
    [0, 40, ['KeyS']],
    [40, 0, ['KeyD']],
    [-40, 0, ['KeyA']],
    [30, -30, ['KeyW', 'KeyD']],
    [-30, 30, ['KeyS', 'KeyA']],
    [5, 5, []],
  ] as const)('deflection (%d, %d) holds %j', (dx, dy, keys) => {
    expect([...stickKeys(dx, dy)].sort()).toEqual([...keys].sort());
  });
});
